// A new project - `npm create amxts@latest`, `amxts init`:
// a few questions (every one also a flag), the files, the install, and what
// to run next.
//
//   amxts init                                  asks
//   amxts init my-server --pm npm --modules menu-core --no-lint --no-git --server D:/hlds/cstrike/addons/amxts --yes
//   amxts init my-server --target hlds --yes    no server: the includes of plain HLDS
//   amxts init my-server --os linux --yes       no server here: plugins built for a Linux one
//
// The package manager is asked first: everything shown afterwards - the
// install, the next steps, the README - is written with it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import process from 'node:process';
import * as p from '@clack/prompts';
import { configEntries, loadCatalog, resolveModule, shortName, specFor, withRequired } from './catalog.mjs';
import { modulesList } from './config.mjs';
import { bunFor, CLI_DIR, CORE_RANGE, coreDirFrom, FROM_SOURCE, loadCore, needLocalCore, readJson, VERSION } from './core.mjs';
import { ensureIncludes, FETCHED, serverIncludes, targetOf, TARGETS } from './includes.mjs';
import { LINT_DEPENDENCIES, LINT_FILES, LINT_SCRIPTS } from './lint.mjs';
import { commandLine, execAmxts, installArgs, PACKAGE_MANAGERS, packageManagerOfAgent, run, runScript, versionOf } from './pm.mjs';
import { askServer, canAsk, missingServer, serverEnv } from './server.mjs';
import { HOST_SYSTEM, serverSystemOf, SYSTEMS } from './system.mjs';
import { copyTemplate, gitAuthor, writeFile } from './template.mjs';
import { c, CliError } from './ui.mjs';

/**
 * The tools a project gets besides the core and its modules. knip reads the
 * knip.json the template writes; from 6 on it counts a package imported by
 * its name as used wherever the name resolves, so a core and modules linked
 * from this machine's folders (--local) are not called unused.
 */
const TOOLS = {
	'@types/bun': '^1.4.2',
	'knip': '^6.39.0',
};

const DEFAULT_DIR = 'my-server';

/**
 * @typedef {object} InitOptions
 * @property {string} [dir] the project's folder
 * @property {string} [pm] npm, pnpm, yarn or bun
 * @property {string} [modules] the modules, comma-separated
 * @property {boolean} [lint] oxlint and oxfmt, with @antfu/eslint-config's rules
 * @property {boolean} [git] git init
 * @property {string} [server] AMXTS_SERVER for .env
 * @property {string} [target] the server the project is for without one: rehlds or hlds
 * @property {string} [os] the server's system, windows or linux, when its folder does not show it
 * @property {boolean} [install] install the dependencies
 * @property {boolean} [yes] ask nothing
 * @property {boolean} [force] write into a folder that is not empty
 * @property {boolean} [local] the core and the modules from this machine's folders
 */

/** Stops on Ctrl+C in a prompt. */
function answer(value) {
	if (p.isCancel(value)) {
		p.cancel('Nothing was created.');
		process.exit(1);
	}
	return value;
}

function isEmptyFolder(dir) {
	return !existsSync(dir) || readdirSync(dir).length === 0;
}

/** A folder's name as a package name: lowercase, dashes. */
function packageName(dir) {
	return basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'amxts-project';
}

/** @param {InitOptions} options */
export async function initProject(options) {
	const interactive = !options.yes && canAsk();
	const local = options.local ?? FROM_SOURCE;
	// --local: the core on this machine, and the official modules from the
	// folders it takes them from.
	const localCore = local ? await needLocalCore() : null;
	const localModules = localCore?.api.localModules() ?? {};

	p.intro(`${c.bold(c.cyan('amxts'))} ${c.dim(VERSION)} ${c.dim('·')} a new project`);

	// 1. The package manager, first: the rest is said in its words.
	const detected = packageManagerOfAgent() ?? 'npm';
	if (options.pm && !PACKAGE_MANAGERS.includes(options.pm)) {
		throw new CliError(`--pm ${options.pm}: amxts knows ${PACKAGE_MANAGERS.join(', ')}`);
	}
	if (options.target && !TARGETS[options.target]) {
		throw new CliError(`--target ${options.target}: rehlds (ReHLDS, ReGameDLL and ReAPI) or hlds (plain HLDS)`);
	}
	if (options.os && !SYSTEMS[options.os]) {
		throw new CliError(`--os ${options.os}: windows or linux`);
	}
	const pm = options.pm ?? (interactive
		? answer(await p.select({
				message: 'Which package manager?',
				initialValue: detected,
				options: PACKAGE_MANAGERS.map(name => ({ value: name, label: name, hint: name === detected ? 'detected' : undefined })),
			}))
		: detected);
	const pmVersion = versionOf(pm);

	// 2. Where.
	const dir = options.dir ?? (interactive
		? answer(await p.text({
				message: 'Where should the project go?',
				placeholder: DEFAULT_DIR,
				defaultValue: DEFAULT_DIR,
				validate: value => (!options.force && !isEmptyFolder(value || DEFAULT_DIR) ? 'That folder is not empty - pick another one' : undefined),
			}))
		: DEFAULT_DIR);
	const root = resolve(dir);
	if (!options.force && !isEmptyFolder(root)) {
		throw new CliError(`${root} is there and not empty`, 'Pick another folder, or add --force to write into it.');
	}

	// 3. Modules: the amxts catalog's.
	const catalog = await loadCatalog();
	const from = { catalog, local, localModules };
	let chosen;
	if (options.modules !== undefined) {
		chosen = options.modules.split(',').map(each => each.trim()).filter(Boolean);
	} else if (interactive) {
		chosen = answer(await p.multiselect({
			message: `Which modules? ${c.dim('(space to pick, enter to go on)')}`,
			required: false,
			options: catalog.map(module => ({
				value: module.name,
				label: module.name,
				hint: [module.description, module.type === 'community' && 'community', ...module.requires.map(each => `brings ${shortName(each)}`)].filter(Boolean).join(' - '),
			})),
		}));
	} else {
		chosen = [];
	}
	const modules = chosen.map(name => resolveModule(name, from));
	for (const module of modules.filter(each => !each.dir && !each.listed)) p.log.warn(`${module.name} is not in the amxts catalog: it is installed from npm as it is`);
	// What a chosen module requires is installed with it, and the config
	// lists it right after, with a comment naming who needs it.
	const installed = withRequired(modules, from);
	const entries = configEntries(installed, modules);

	// 4. oxlint and oxfmt, 5. git, 6. the server.
	const lint = options.lint ?? (interactive
		? answer(await p.confirm({ message: `Add oxlint and oxfmt? ${c.dim('(lint and format)')}`, initialValue: true }))
		: true);
	const hasGit = Boolean(versionOf('git'));
	const git = hasGit && (options.git ?? (interactive
		? answer(await p.confirm({ message: 'Initialize a git repository?', initialValue: true }))
		: true));
	const server = options.server ?? (interactive ? answer(await askServer(pm)) : '');

	// 7. Which server the project is for: its includes say, when it has them
	// (addons/amxmodx/scripting/include beside AMXTS_SERVER); else asked.
	const ownIncludes = serverIncludes(server);
	const target = options.target ?? (ownIncludes
		? targetOf(ownIncludes)
		: interactive
			? answer(await p.select({
					message: 'Which server is the project for?',
					initialValue: 'rehlds',
					options: [
						{ value: 'rehlds', label: TARGETS.rehlds, hint: 'recommended' },
						{ value: 'hlds', label: TARGETS.hlds },
					],
				}))
			: 'rehlds');

	// 8. The server's system: its folder shows it (hlds_linux or hlds.exe);
	// else asked, and kept in .env - the build compiles plugins for it.
	const shown = serverSystemOf(server);
	const os = shown ?? options.os ?? (interactive
		? answer(await p.select({
				message: 'Which system does the server run?',
				initialValue: HOST_SYSTEM,
				options: Object.entries(SYSTEMS).map(([value, label]) => ({ value, label, hint: value === HOST_SYSTEM ? 'this machine' : undefined })),
			}))
		: null);
	const osLine = os && !shown
		? `# The server's system: plugins are compiled for it.\nAMXTS_SERVER_OS=${os}\n`
		: '';

	// The files.
	const amxts = execAmxts(pm);
	const install = installArgs(pm).join(' ');
	const values = {
		'name': packageName(root),
		'author': gitAuthor(),
		'modules': modulesList(entries),
		'target': target,
		'install': install,
		'amxts': amxts,
		'run.dev': runScript(pm, 'dev'),
		'run.build': runScript(pm, 'build'),
		'run.typecheck': runScript(pm, 'typecheck'),
		'run.test': runScript(pm, 'test'),
		'run.lint': runScript(pm, 'lint'),
	};
	const flags = { lint, ...Object.fromEntries(installed.map(module => [shortName(module.name), true])) };
	const written = copyTemplate(join(CLI_DIR, 'templates', 'project'), root, values, flags, path => LINT_FILES.includes(path) && !lint);

	const core = { name: '@amxts/core', dir: localCore?.dir ?? null };
	const devDependencies = {
		[core.name]: specFor(core, root, pm, CORE_RANGE),
		...Object.fromEntries(installed.map(module => [module.name, specFor(module, root, pm)])),
		...TOOLS,
		...(lint ? LINT_DEPENDENCIES : {}),
	};
	writeFile(join(root, 'package.json'), `${JSON.stringify({
		name: values.name,
		type: 'module',
		private: true,
		scripts: {
			// The editor config in .amxts/ is not committed: it is written after every install, by amxts prepare.
			postinstall: 'amxts prepare',
			dev: 'amxts dev',
			build: 'amxts build',
			typecheck: 'amxts typecheck',
			test: 'amxts test',
			...(lint ? LINT_SCRIPTS : {}),
		},
		devDependencies: Object.fromEntries(Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b))),
	}, null, '\t')}\n`);
	written.push('package.json');
	if (pm === 'pnpm') {
		// pnpm stops an install at a dependency's build script nobody approved.
		// bun's is not needed: amxts runs the binary of its platform package.
		writeFile(join(root, 'pnpm-workspace.yaml'), '# bun\'s install script is not needed: amxts runs the binary of its platform package.\nallowBuilds:\n  bun: false\n');
		written.push('pnpm-workspace.yaml');
	}
	// Always written, the server's line empty when it was not given: the file
	// shows where it goes, and amxts dev asks for it.
	writeFile(join(root, '.env'), `${serverEnv(server ?? '')}${osLine}`);
	written.push('.env');

	const at = relative(process.cwd(), root) || '.';
	p.log.success(`Created ${c.bold(values.name)} in ${c.cyan(at)}\n${c.dim(written.sort().join('\n'))}`);
	if (server && !existsSync(server)) p.log.warn(missingServer(server));
	const required = entries.filter(each => each.by.length);
	if (required.length) p.log.info(required.map(each => `${shortName(each.name)} is listed too: ${each.by.join(', ')} needs it`).join('\n'));

	// The install.
	let installedOk = false;
	if (options.install === false) {
		p.log.info(`Not installed (--no-install): ${c.cyan(install)} does it.`);
	} else if (!pmVersion) {
		p.log.warn(`${pm} is not installed on this machine: install it, then run ${c.cyan(install)} in the project.`);
	} else {
		// A spinner in a terminal; in a log (CI, a pipe) one line before and one after.
		const spinner = process.stdout.isTTY ? p.spinner() : { start: text => p.log.step(text), stop: (text, code) => (code ? p.log.error(text) : p.log.success(text)) };
		spinner.start(`Installing dependencies with ${pm}`);
		const result = await run(installArgs(pm), { cwd: root, quiet: true });
		if (result.code === 0) {
			pinLatest(root);
			installedOk = true;
			spinner.stop(`Installed dependencies with ${pm} ${c.dim(pmVersion)}`);
		} else {
			spinner.stop(`${commandLine(installArgs(pm))} failed`, 1);
			p.log.message(result.output.trim().split('\n').slice(-15).join('\n'));
		}
	}

	// The project's core, installed: the server's includes (its own, or the
	// ones of the target fetched) and the Bun it builds with come with it.
	let projectCore = null;
	if (installedOk) {
		try {
			projectCore = await loadCore(coreDirFrom(root));
			const includes = await ensureIncludes(projectCore, root, { target });
			p.log.success(includes.from === 'server'
				? `Includes: the server's own ${c.dim(`(${includes.dir})`)}`
				: includes.from === 'fetched'
					? `Fetched ${includes.version}'s includes ${c.dim(`(${FETCHED})`)}`
					: `Includes: AMX Mod X's own, which come with the core ${c.dim(`(${TARGETS.hlds})`)}`);
		} catch (error) {
			if (!(error instanceof CliError)) throw error;
			p.log.warn(`${error.message}\n${c.dim(error.hint ?? '')}`);
		}
	}

	if (git) {
		const result = await run(['git', 'init'], { cwd: root, quiet: true });
		if (result.code === 0) p.log.success('Initialized a git repository');
		else p.log.warn(`git init failed: ${result.output.trim().split('\n')[0]}`);
	}

	// The editor config (.amxts/tsconfig.json), which the build writes too:
	// this command's own prepare, run in the project, with the project's core.
	if (projectCore && bunFor(projectCore)) {
		const result = await run([process.execPath, join(CLI_DIR, 'bin', 'amxts.mjs'), 'prepare'], { cwd: root, quiet: true });
		if (result.code === 0) p.log.success(`Prepared the editor config ${c.dim('(.amxts/tsconfig.json)')}`);
		else p.log.warn(`The editor config was not written: ${c.cyan(`${amxts} prepare`)} in the project says why.`);
	} else if (projectCore) {
		p.log.warn(`The Bun that comes with @amxts/core is not there, and amxts builds with it: run ${c.cyan(install)} again, letting ${pm} run bun's install script`);
	}

	const steps = [
		...(at === '.' ? [] : [`cd ${at}`]),
		...(installedOk ? [] : [install]),
		...(server ? [] : [`${c.dim('# in .env:')} AMXTS_SERVER=<the server's addons/amxts>`]),
		`${runScript(pm, 'dev')}    ${c.dim('# build, deploy, rebuild on save')}`,
	];
	p.note(steps.join('\n'), 'Next steps');
	p.outro(`Docs: ${c.cyan('https://amxts.github.io/docs/getting-started/quick-start')}`);
	if (options.install !== false && pmVersion && !installedOk) process.exitCode = 1;
}

/** `"latest"` in package.json, after the install, as the version it installed: `^1.6.2`. */
function pinLatest(root) {
	const path = join(root, 'package.json');
	const json = JSON.parse(readFileSync(path, 'utf8'));
	let changed = false;
	for (const [name, spec] of Object.entries(json.devDependencies ?? {})) {
		const version = spec === 'latest' && readJson(join(root, 'node_modules', name, 'package.json'))?.version;
		if (!version) continue;
		json.devDependencies[name] = `^${version}`;
		changed = true;
	}
	if (changed) writeFileSync(path, `${JSON.stringify(json, null, '\t')}\n`);
}
