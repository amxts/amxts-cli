// `amxts module add` installs a module and lists it in amxts.config.ts in one
// step; `amxts module list` shows what the config lists and what is installed:
//
//   amxts module add menu-core           npm install -D @amxts/menu-core @amxts/config-core,
//                                        both into modules in amxts.config.ts - config-core
//                                        after menu-core, "// needed by menu-core" -
//                                        then amxts prepare, which names them for the editor
//   amxts module add @you/greeter        any package from npm - with a warning
//                                        when the amxts catalog does not list it
//   amxts module add ../greeter          a module from its folder
//   amxts module list                    what the config lists, what is installed,
//                                        what else the catalog has
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configEntries, installTarget, loadCatalog, resolveModule, taglineOf, withRequired } from './catalog.mjs';
import { addToConfig, CONFIG_FILE, newConfig, readConfigModules } from './config.mjs';
import { FROM_SOURCE, installedCore, needLocalCore, needProject, readJson } from './core.mjs';
import { prepare } from './includes.mjs';
import { addArgs, commandLine, detectPackageManager, execAmxts, run, versionOf } from './pm.mjs';
import { c, CliError, log } from './ui.mjs';

/**
 * @param {string[]} names
 * @param {{ local?: boolean, skipInstall?: boolean, skipConfig?: boolean }} options
 */
export async function moduleAdd(names, options = {}) {
	if (names.length === 0) throw new CliError('Which module?', 'amxts module add menu-core   (or a package name, or a folder)');
	const dir = needProject();
	const pm = detectPackageManager(dir);

	// --local, the default when the project's core is a checkout: the official
	// modules from the folders that core takes them from.
	const core = await installedCore(dir);
	const local = options.local ?? (core ? core.fromSource : FROM_SOURCE);
	const [source, catalog] = await Promise.all([local && !core?.fromSource ? needLocalCore() : core, loadCatalog()]);
	const localModules = local ? source.api.localModules() : {};
	const from = { catalog, local, localModules };
	const wanted = names.map(name => resolveModule(name, from));
	for (const module of wanted.filter(each => !each.dir && !each.listed)) log.warn(`${module.name} is not in the amxts catalog: it is installed from npm as it is`);
	const project = readJson(join(dir, 'package.json'));
	const deps = { ...project?.dependencies, ...project?.devDependencies };
	// What a module needs comes along, unless the project has it: yarn does
	// not install peer dependencies by itself.
	const all = withRequired(wanted, from);
	const toInstall = all.filter(module => wanted.includes(module) || !deps[module.name]);

	if (!options.skipInstall) {
		if (!versionOf(pm)) throw new CliError(`${pm} is not installed, and this project uses it`, `Install ${pm}, or add the package by hand and run amxts module add ${names.join(' ')} --skip-install.`);
		const argv = addArgs(pm, toInstall.map(module => installTarget(module, dir, pm)));
		log.step(`${commandLine(argv)}`);
		const result = await run(argv, { cwd: dir });
		if (result.code !== 0) throw new CliError(`${commandLine(argv)} failed`, 'The package manager says why, above.');
	}

	// Only a package that is a module goes into the config, with what it
	// requires right after it.
	const notModules = wanted.filter((module) => {
		const json = readJson(join(dir, 'node_modules', module.name, 'package.json')) ?? (module.dir ? readJson(join(module.dir, 'package.json')) : null);
		return json && !json.amxts?.module;
	});
	for (const module of notModules) log.warn(`${module.name} is not an amxts module (its package.json has no "amxts" field): installed, not added to ${CONFIG_FILE}`);
	const entries = configEntries(all.filter(module => !notModules.includes(module)), wanted);
	if (options.skipConfig || entries.length === 0) return;
	if (!await addModules(dir, entries)) return;

	// The editor config names the modules the config lists: prepared again
	// now that it lists these - the install's own prepare ran before.
	const projectCore = await installedCore(dir);
	if (projectCore) await prepare(projectCore);
}

/**
 * Lists modules in amxts.config.ts, a new one when there is none. Whether it changed.
 * @param {string} dir
 * @param {import('./catalog.mjs').ConfigEntry[]} entries
 */
async function addModules(dir, entries) {
	const path = join(dir, CONFIG_FILE);
	const names = entries.map(each => each.name).join(', ');
	if (!existsSync(path)) {
		writeFileSync(path, newConfig(entries));
		log.success(`Created ${CONFIG_FILE} with ${names}`);
		return true;
	}
	const { text, added } = await addToConfig(readFileSync(path, 'utf8'), entries);
	if (added.length === 0) {
		log.info(`${CONFIG_FILE} lists ${names} already`);
		return false;
	}
	writeFileSync(path, text);
	log.success(`Added ${added.map(name => c.bold(name)).join(', ')} to ${CONFIG_FILE}`);
	return true;
}

/** Every installed package with an "amxts" field: node_modules and its scopes. */
function installedModules(dir) {
	const found = new Map();
	const add = (packageDir) => {
		const json = readJson(join(packageDir, 'package.json'));
		if (json?.name && json.amxts?.module && !found.has(json.name)) {
			const requires = Object.keys(json.peerDependencies ?? {}).filter(name => name !== '@amxts/core');
			found.set(json.name, { name: json.name, version: json.version ?? '', dir: packageDir, requires });
		}
	};
	const modulesDir = join(dir, 'node_modules');
	if (existsSync(modulesDir)) {
		for (const name of readdirSync(modulesDir)) {
			if (name.startsWith('.')) continue;
			if (name.startsWith('@')) {
				for (const inner of readdirSync(join(modulesDir, name))) add(join(modulesDir, name, inner));
			} else {
				add(join(modulesDir, name));
			}
		}
	}
	return found;
}

export async function moduleList() {
	const dir = needProject();
	const [listed, catalog] = await Promise.all([readConfigModules(dir), loadCatalog()]);
	const names = listed ?? [];
	const installed = installedModules(dir);
	const available = catalog.filter(module => !installed.has(module.npm));
	const add = `${execAmxts(detectPackageManager(dir))} module add`;
	const pad = Math.max(10, ...[...names, ...installed.keys(), ...available.map(module => module.name)].map(name => name.length));
	const row = (mark, name, rest) => console.log(`  ${mark} ${name.padEnd(pad)}  ${rest}`);

	console.log(c.bold(listed === null ? `No ${CONFIG_FILE} here` : `In ${CONFIG_FILE}`));
	if (listed && listed.length === 0) console.log(c.dim('  no modules yet'));
	for (const name of names) {
		const module = installed.get(name);
		if (module) row(c.green('✔'), name, `${c.dim(module.version)}  ${taglineOf(module.dir)}`);
		else row(c.red('✖'), name, c.red(`not installed - ${add} ${name}`));
	}

	const others = [...installed.values()].filter(module => !names.includes(module.name));
	if (others.length) {
		console.log(c.bold('\nInstalled, not in the config'));
		for (const module of others) {
			const by = names.filter(name => installed.get(name)?.requires.includes(module.name));
			row(c.yellow('•'), module.name, `${c.dim(module.version)}  ${c.dim(by.length ? `comes along: ${by.join(', ')} needs it` : `not used - add it to modules to use it`)}`);
		}
	}

	if (available.length) {
		console.log(c.bold('\nIn the amxts catalog'));
		for (const module of available) row(c.dim('○'), module.name, c.dim(`${module.description}${module.type === 'community' ? ' (community)' : ''} - ${add} ${module.name}`));
	}
}
