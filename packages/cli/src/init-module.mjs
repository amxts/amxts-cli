// A new module package from templates/module/ - a working module, its
// playground project and a test:
//
//   amxts init --module greeter            ./greeter, package "greeter"
//   amxts init --module @you/greeter       ./greeter, package "@you/greeter"
//   amxts init --module greeter --natives  with src/natives.ts: natives for Pawn plugins
//   amxts init --module greeter --dir x    into ./x
//
// The template has the name in its forms and the author (git config
// user.name) as {{placeholders}}; `// #if natives` blocks are kept only with
// --natives. The core is a peer dependency, the range this command works with;
// with --local (the default from a checkout) it is also a dev dependency
// linked to the core on this machine, since it is not on npm to install.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { shortName, specFor } from './catalog.mjs';
import { CLI_DIR, CORE_RANGE, FROM_SOURCE, needLocalCore } from './core.mjs';
import { LINT_DEPENDENCIES, LINT_SCRIPTS } from './lint.mjs';
import { detectPackageManager, execAmxts, installArgs, runScript } from './pm.mjs';
import { copyTemplate, gitAuthor, writeFile } from './template.mjs';
import { c, CliError, log } from './ui.mjs';

export const MODULE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z][a-z0-9-]*$/;

/**
 * @param {{ module: string, natives?: boolean, dir?: string, pm?: string, local?: boolean }} options
 */
export async function initModule(options) {
	const pkgName = options.module;
	if (!MODULE_NAME.test(pkgName)) {
		throw new CliError(`"${pkgName}" is not a package name for a module`, 'Lowercase letters, digits and dashes: greeter, @you/greeter');
	}
	const natives = Boolean(options.natives);

	/** The package's name without its scope: the module's name - "kill-feed". */
	const name = shortName(pkgName);
	const words = name.split('-').filter(Boolean);
	const camel = words.map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1))).join('');
	const title = words.map(word => word[0].toUpperCase() + word.slice(1)).join(' ');

	const values = {
		name,
		package: pkgName,
		title,
		camel,
		configKey: camel,
		Options: `${title.replace(/ /g, '')}Options`,
		include: name.replace(/-/g, '_'),
		year: String(new Date().getFullYear()),
		author: gitAuthor(),
	};

	const dir = resolve(options.dir ?? name);
	if (existsSync(dir) && readdirSync(dir).length > 0) {
		throw new CliError(`${dir} is there and not empty`, 'Pick another folder with --dir.');
	}

	const pm = options.pm ?? detectPackageManager();
	const localCore = (options.local ?? FROM_SOURCE) ? await needLocalCore() : null;

	const written = copyTemplate(join(CLI_DIR, 'templates', 'module'), dir, values, { natives }, path => path === 'src/natives.ts' && !natives);

	const amxts = { module: 'src/index.ts' };
	if (natives) Object.assign(amxts, { natives: 'src/natives.ts', include: `include/${values.include}.inc` });

	writeFile(join(dir, 'package.json'), `${JSON.stringify({
		name: pkgName,
		type: 'module',
		version: '0.1.0',
		description: `${title} for amxts plugins.`,
		license: 'MIT',
		keywords: ['amxts-module', 'amxmodx', 'counter-strike'],
		exports: { '.': './src/index.ts' },
		types: './src/index.ts',
		files: ['README.md', 'README.ru.md', ...(natives ? ['include'] : []), 'src'],
		amxts,
		scripts: {
			build: 'amxts build',
			check: 'amxts check',
			test: 'amxts test',
			...LINT_SCRIPTS,
		},
		peerDependencies: { '@amxts/core': CORE_RANGE },
		devDependencies: Object.fromEntries(Object.entries({
			...(localCore ? { '@amxts/core': specFor({ name: '@amxts/core', dir: localCore.dir }, dir, pm) } : {}),
			...LINT_DEPENDENCIES,
			'@types/bun': '^1.4.2',
			'typescript': '^6.0.3',
		}).sort(([a], [b]) => a.localeCompare(b))),
	}, null, '\t')}\n`);
	written.push('package.json');

	// The playground is a project of its own that takes the module by its path,
	// as a project takes one from npm.
	writeFile(join(dir, 'playground', 'package.json'), `${JSON.stringify({
		name: `${name}-playground`,
		type: 'module',
		private: true,
		devDependencies: { [pkgName]: 'file:..' },
	}, null, '\t')}\n`);
	written.push('playground/package.json');

	const at = relative(process.cwd(), dir) || '.';
	for (const file of written.sort()) console.log(`  ${c.dim(`${at}/`)}${file}`);
	console.log();
	log.success(`${c.bold(pkgName)} is in ${c.cyan(at)}`);

	console.log(`\n  Next:\n`);
	for (const line of [
		`cd ${at}`,
		installArgs(pm).join(' '),
		...(natives ? [`${execAmxts(pm)} build   ${c.dim(`# writes include/${values.include}.inc from src/natives.ts`)}`] : []),
		runScript(pm, 'test'),
	]) console.log(`    ${c.cyan(line)}`);
	console.log();
}
