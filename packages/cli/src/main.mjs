// The amxts command: the table of its commands, their help, and one place
// where a failure becomes one line with a hint.
//
//   amxts <command> [options]      amxts --help, amxts <command> --help
//
// It runs on Node. Commands that make or change a project (init, module,
// info) run here; the ones that compile (build, dev, typecheck, check,
// prepare) are tasks of the project's core, which runs them on Bun
// (core.mjs); test runs bun test.
import process from 'node:process';
import { GLOBAL_FLAGS, parseArgs } from './args.mjs';
import { needBun, needProject, projectCore, runTask, runTaskOrExit, VERSION } from './core.mjs';
import { prepare, TARGETS } from './includes.mjs';
import { detectPackageManager, PACKAGE_MANAGERS, run } from './pm.mjs';
import { ensureServer } from './server.mjs';
import { SYSTEMS } from './system.mjs';
import { banner, c, CliError, closest, log, report } from './ui.mjs';

/** --os, for the commands that compile: the plugins are built for that system. */
const OS_FLAG = { type: 'string', value: Object.keys(SYSTEMS).join('|'), description: 'The server\'s system, when AMXTS_SERVER does not show it: the plugins are compiled for it' };

/** --os as the build task takes it. */
function osArgs(values) {
	if (values.os === undefined) return [];
	if (!SYSTEMS[values.os]) throw new CliError(`--os ${values.os}: windows or linux`);
	return ['--os', values.os];
}

const INIT_FLAGS = {
	pm: { type: 'string', value: PACKAGE_MANAGERS.join('|'), description: 'The package manager (asked first; the one running the command is picked)' },
	modules: { type: 'string', value: 'list', description: 'Modules to add, comma-separated: menu-core,config-core ("" for none)' },
	lint: { type: 'boolean', description: 'oxlint and oxfmt, with @antfu/eslint-config\'s rules (--no-lint to leave them out)' },
	git: { type: 'boolean', description: 'git init (--no-git to skip)' },
	server: { type: 'string', value: 'path', description: 'The server\'s addons/amxts folder, written to .env as AMXTS_SERVER; the build takes its includes' },
	os: { type: 'string', value: Object.keys(SYSTEMS).join('|'), description: 'The server\'s system, when the server\'s folder does not show it: written to .env as AMXTS_SERVER_OS' },
	target: { type: 'string', value: Object.keys(TARGETS).join('|'), description: 'The server the project is for, when no server is given: rehlds - ReHLDS, ReGameDLL and ReAPI (recommended) - or hlds' },
	install: { type: 'boolean', description: 'Install the dependencies (--no-install to skip)' },
	yes: { type: 'boolean', alias: 'y', description: 'Ask nothing: the defaults for what no flag says' },
	force: { type: 'boolean', description: 'Write into a folder that is not empty' },
	local: { type: 'boolean', description: 'Take the core and the official modules from the folders on this machine, not npm; AMXTS_CORE names the core folder' },
	module: { type: 'string', value: 'name', description: 'Create a module package instead: greeter, @you/greeter' },
	natives: { type: 'boolean', description: 'With --module: natives for Pawn plugins (src/natives.ts)' },
	dir: { type: 'string', value: 'folder', description: 'With --module: the folder (the module\'s name by default)' },
};

/**
 * @typedef {object} Command
 * @property {string} description a line for the command list
 * @property {string} usage how it is called
 * @property {Record<string, any>} [flags] its options, for the parser and the help
 * @property {string[]} [examples] command lines for the help
 * @property {boolean} [passThrough] its arguments go to the tool it runs as they are
 * @property {(args: { values: Record<string, any>, positionals: string[], raw?: string[] }) => unknown} run what it does
 */

/** @type {Record<string, Command>} */
export const COMMANDS = {
	init: {
		description: 'Create a project - or a module package, with --module',
		usage: 'amxts init [folder] [options]',
		flags: INIT_FLAGS,
		examples: [
			'amxts init',
			'amxts init my-server --pm npm --modules menu-core --no-git --yes',
			'amxts init --module @you/greeter --natives',
		],
		async run({ values, positionals }) {
			if (values.module !== undefined) {
				const { initModule } = await import('./init-module.mjs');
				return initModule({ module: values.module, natives: values.natives, dir: values.dir ?? positionals[0], pm: values.pm, local: values.local });
			}
			const { initProject } = await import('./init.mjs');
			return initProject({ ...values, dir: positionals[0] });
		},
	},
	dev: {
		description: 'Build, deploy to the server in AMXTS_SERVER, and again on every save',
		usage: 'amxts dev [--os windows|linux] [--docker]',
		flags: {
			os: OS_FLAG,
			docker: { type: 'boolean', description: 'For the Docker server that mounts this project: build for Linux into dist/ on every save, which it reloads, and show its console' },
		},
		examples: ['amxts dev', 'amxts dev --os linux', 'amxts dev --docker'],
		async run({ values }) {
			if (values.docker && values.os && values.os !== 'linux')
				throw new CliError('The Docker server is Linux: --docker builds for Linux.', 'Leave out --os.');
			const core = await projectCore();
			banner(core.version, 'dev');
			// The container reads dist/ where it is: nothing to deploy, and AMXTS_SERVER is not asked.
			if (!values.docker) await ensureServer(needProject(), detectPackageManager());
			await prepare(core, { quiet: true });
			if (values.docker) runTaskOrExit(core, 'build', ['--watch', '--docker', '--os', 'linux']);
			else runTaskOrExit(core, 'build', ['--deploy', '--watch', ...osArgs(values)]);
		},
	},
	build: {
		description: 'Build the plugins and the modules into outDir (dist/), with plugins.ini',
		usage: 'amxts build [--deploy] [--watch] [--os windows|linux]',
		flags: {
			deploy: { type: 'boolean', description: 'Also copy them to AMXTS_SERVER and reload the server' },
			watch: { type: 'boolean', description: 'Build again on every save - for a server that reads dist/ itself, such as the Docker one' },
			os: OS_FLAG,
		},
		examples: ['amxts build', 'amxts build --deploy', 'amxts build --os linux', 'amxts build --os linux --watch'],
		async run({ values }) {
			const os = osArgs(values);
			const core = await projectCore();
			banner(core.version, 'build');
			if (values.deploy) await ensureServer(needProject(), detectPackageManager());
			await prepare(core, { quiet: true });
			runTaskOrExit(core, 'build', [...(values.deploy ? ['--deploy'] : []), ...(values.watch ? ['--watch'] : []), ...os]);
		},
	},
	typecheck: {
		description: 'Check the plugins and amxts.config.ts as the editor does',
		usage: 'amxts typecheck',
		examples: ['amxts typecheck'],
		async run() {
			const core = await projectCore();
			banner(core.version, 'typecheck');
			await prepare(core, { quiet: true });
			if (runTask(core, 'typecheck') !== 0) {
				throw new CliError('The plugins have type errors', 'They are listed above, file:line first.');
			}
			log.success('No type errors');
		},
	},
	test: {
		description: 'Run the project\'s tests on a fake server (bun test)',
		usage: 'amxts test [bun test options]',
		passThrough: true,
		examples: ['amxts test', 'amxts test hello', 'amxts test --watch'],
		async run({ raw }) {
			const result = await run([needBun(await projectCore(), 'runs tests'), 'test', ...raw]);
			process.exitCode = result.code;
		},
	},
	module: {
		description: 'Add a module to the project, or list its modules',
		usage: 'amxts module add <name...> | amxts module list',
		flags: {
			local: { type: 'boolean', description: 'add: an official module from the folder the core takes it from, not npm' },
			skipInstall: { type: 'boolean', description: 'add: only list it in amxts.config.ts' },
			skipConfig: { type: 'boolean', description: 'add: only install it' },
		},
		examples: ['amxts module add menu-core', 'amxts module add @you/greeter', 'amxts module add ../greeter', 'amxts module list'],
		async run({ values, positionals }) {
			const [action, ...names] = positionals;
			const { moduleAdd, moduleList } = await import('./module.mjs');
			if (action === 'add') return moduleAdd(names, values);
			if (action === 'list' || action === 'ls') return moduleList();
			const guess = action ? closest(action, ['add', 'list']) : null;
			throw new CliError(action ? `amxts module has no "${action}"` : 'amxts module: add or list?', guess ? `Did you mean amxts module ${guess}?` : 'amxts module add <name> | amxts module list');
		},
	},
	check: {
		description: 'In a module package: check it is ready to publish',
		usage: 'amxts check',
		examples: ['amxts check'],
		async run() {
			runTaskOrExit(await projectCore(), 'check');
		},
	},
	prepare: {
		description: 'Fetch the server\'s includes and write .amxts/tsconfig.json for the editor (build does it too)',
		usage: 'amxts prepare',
		async run() {
			await prepare(await projectCore());
		},
	},
	upgrade: {
		description: 'Rewrite the project\'s code to the API of the core it has installed',
		usage: 'amxts upgrade',
		examples: ['amxts upgrade'],
		async run() {
			const core = await projectCore();
			banner(core.version, 'upgrade');
			runTaskOrExit(core, 'upgrade');
		},
	},
	info: {
		description: 'Versions and settings, for a bug report',
		usage: 'amxts info',
		async run() {
			const { info } = await import('./info.mjs');
			await info();
		},
	},
};

/** `skipInstall` as the command line spells it: `skip-install`. */
function kebab(name) {
	return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function flagLines(flags) {
	const rows = Object.entries({ ...flags, ...GLOBAL_FLAGS })
		.map(([name, flag]) => [`${flag.alias ? `-${flag.alias}, ` : '    '}--${kebab(name)}${flag.type === 'string' ? ` <${flag.value ?? 'value'}>` : ''}`, flag.description ?? '']);
	const width = Math.max(...rows.map(([left]) => left.length));
	return rows.map(([left, right]) => `  ${c.cyan(left.padEnd(width))}  ${right}`);
}

export function printHelp(name) {
	if (name) {
		const command = COMMANDS[name];
		console.log([
			`${command.description}`,
			'',
			`${c.bold('Usage')}  ${c.cyan(command.usage)}`,
			'',
			c.bold('Options'),
			...flagLines(command.flags ?? {}),
			...(command.examples ? ['', c.bold('Examples'), ...command.examples.map(example => `  ${c.dim('$')} ${example}`)] : []),
			'',
		].join('\n'));
		return;
	}
	const names = Object.keys(COMMANDS);
	const width = Math.max(...names.map(each => each.length));
	console.log([
		`${c.bold(c.cyan('amxts'))} ${c.dim(VERSION)} - TypeScript plugins for AMX Mod X`,
		'',
		`${c.bold('Usage')}  ${c.cyan('amxts <command> [options]')}`,
		'',
		c.bold('Commands'),
		...names.map(each => `  ${c.cyan(each.padEnd(width))}  ${COMMANDS[each].description}`),
		'',
		c.bold('Options'),
		`  ${c.cyan('-h, --help'.padEnd(13))}  Show help`,
		`  ${c.cyan('-v, --version'.padEnd(13))}  Show the version`,
		`  ${c.cyan('    --debug'.padEnd(13))}  Show the stack of an error`,
		'',
		`${c.dim('A command\'s options and examples:')} amxts <command> --help`,
		`${c.dim('A new project:')} npm create amxts@latest`,
		'',
	].join('\n'));
}

/** Flags as the parser takes them: `skip-install` for skipInstall. */
function parserFlags(flags = {}) {
	return Object.fromEntries(Object.entries(flags).map(([name, flag]) => [kebab(name), flag]));
}

function camel(values) {
	return Object.fromEntries(Object.entries(values).map(([name, value]) => [name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
}

/**
 * Runs a command line: `["build", "--deploy"]`.
 * @param {string[]} argv
 */
export async function main(argv) {
	try {
		const [name, ...rest] = argv;
		if (!name || name === '--help' || name === '-h' || name === 'help') {
			const topic = name === 'help' ? rest[0] : undefined;
			printHelp(topic && COMMANDS[topic] ? topic : undefined);
			return;
		}
		if (name === '--version' || name === '-v') {
			console.log(VERSION);
			return;
		}
		const command = COMMANDS[name];
		if (!command) {
			const guess = closest(name, Object.keys(COMMANDS));
			throw new CliError(`Unknown command ${c.bold(name)}`, guess ? `Did you mean ${c.cyan(`amxts ${guess}`)}?` : 'amxts --help lists the commands.');
		}
		if (rest.includes('--help') || rest.includes('-h')) {
			printHelp(name);
			return;
		}
		if (command.passThrough) {
			await command.run({ values: {}, positionals: [], raw: rest.filter(arg => arg !== '--debug') });
			return;
		}
		const { values, positionals } = parseArgs(rest, parserFlags(command.flags), name);
		await command.run({ values: camel(values), positionals });
	} catch (error) {
		report(error);
		process.exitCode = 1;
	}
}
