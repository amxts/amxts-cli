// The amxts command: the table of its commands, their help, and one place
// where a failure becomes one line with a hint.
//
//   amxts <command> [options]      amxts --help, amxts <command> --help
//
// It runs on Node. Commands that make or change a project (init, module,
// info) run here; the ones that compile (build, dev, typecheck, check,
// prepare) are tasks of the project's core, which runs them on Bun
// (core.mjs); test runs the project's Vitest, or bun test.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { GLOBAL_FLAGS, parseArgs } from './args.mjs';
import { needBun, needProject, projectCore, runTask, runTaskOrExit, setting, startTask, VERSION } from './core.mjs';
import { prepare, TARGETS } from './includes.mjs';
import { stopTree, takeLock } from './lock.mjs';
import { detectPackageManager, PACKAGE_MANAGERS, run } from './pm.mjs';
import { serverMismatch } from './server-update.mjs';
import { ensureServer } from './server.mjs';
import { SYSTEMS } from './system.mjs';
import { banner, c, CliError, closest, log, report } from './ui.mjs';

/** --os, for the commands that compile: the plugins are built for that system. */
const OS_FLAG = { type: 'string', value: Object.keys(SYSTEMS).join('|'), description: 'The server\'s system, when AMXTS_SERVER does not show it: the plugins are compiled for it' };

/** The line for a server whose module is of another release than the project's core. */
function warnServer(core, os) {
	const line = serverMismatch(core, needProject(), os);
	if (line) log.warn(line);
}

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
	server: { type: 'string', value: 'path', description: 'The server: its folder, its cstrike or its addons/amxts; .env keeps the addons/amxts as AMXTS_SERVER, and the build takes its includes' },
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
		usage: 'amxts dev [--os windows|linux] [--docker] [--no-tui] [--takeover]',
		flags: {
			os: OS_FLAG,
			docker: { type: 'boolean', description: 'For the Docker server that mounts this project: build for Linux into dist/ on every save, which it reloads, and show its console' },
			tui: { type: 'boolean', description: 'The panel under the build\'s lines, in a terminal (--no-tui, or AMXTS_TUI=plain, for the lines alone)' },
			takeover: { type: 'boolean', description: 'Stop the amxts dev already running for this project, and run here' },
		},
		examples: ['amxts dev', 'amxts dev --os linux', 'amxts dev --docker', 'amxts dev --takeover'],
		async run({ values }) {
			if (values.docker && values.os && values.os !== 'linux')
				throw new CliError('The Docker server is Linux: --docker builds for Linux.', 'Leave out --os.');
			const core = await projectCore();
			const root = needProject();
			const { devPanel, wantsPanel } = await import('./dev-panel.mjs');
			// The panel has the logo in it; the build's lines alone start with it.
			const panel = wantsPanel({ tui: values.tui });
			if (!panel) banner(core.version, 'dev', { logo: true });
			takeLock(root, { takeover: values.takeover, say: log.info });
			// The container reads dist/ where it is: nothing to deploy, and AMXTS_SERVER is not asked.
			if (!values.docker) {
				await ensureServer(root, detectPackageManager());
				warnServer(core, osArgs(values));
			}
			await prepare(core, { quiet: true });
			const args = values.docker ? ['--watch', '--docker', '--os', 'linux'] : ['--deploy', '--watch', ...osArgs(values)];
			if (panel) {
				const { rconTarget } = await import('./rcon.mjs');
				devPanel(core, args, { target: rconTarget(root), deployTo: values.docker ? '' : setting(root, 'AMXTS_SERVER').replace(/\\/g, '/') });
				return;
			}
			const child = startTask(core, 'build', args);
			// --takeover from another terminal: the build goes with this.
			for (const signal of ['SIGTERM', 'SIGHUP']) {
				process.on(signal, () => {
					stopTree(child.pid);
					process.exit(0);
				});
			}
			child.on('exit', code => process.exit(code ?? 1));
		},
	},
	rcon: {
		description: 'Send a command to the project\'s server over rcon and print its answer',
		usage: 'amxts rcon <command> [--json]',
		flags: {
			json: { type: 'boolean', description: 'Print { server, command, reply } - or { server, command, error } - as JSON' },
		},
		examples: ['amxts rcon amxts_plugins', 'amxts rcon status --json', 'amxts rcon changelevel de_dust2'],
		async run({ values, positionals }) {
			const command = positionals.join(' ').trim();
			if (!command) throw new CliError('amxts rcon: which command?', 'amxts rcon amxts_plugins');
			const { rcon, rconTarget } = await import('./rcon.mjs');
			const target = rconTarget(needProject());
			if (!target) throw new CliError('AMXTS_SERVER is not set: rcon reaches the server it names', 'Set it in .env beside package.json: AMXTS_SERVER=D:/hlds/cstrike/addons/amxts');
			if (!target.password) throw new CliError(`rcon is not set up: no rcon_password in ${target.cfg}`, 'Add a line  rcon_password "something"  to it and restart the server.');
			const server = `${target.host}:${target.port}`;
			const answer = await rcon(target, command);
			if (values.json) {
				console.log(JSON.stringify({ server, command, ...answer }));
				if ('error' in answer) process.exitCode = 1;
				return;
			}
			if ('reply' in answer) {
				process.stdout.write(answer.reply.endsWith('\n') || !answer.reply ? answer.reply : `${answer.reply}\n`);
				return;
			}
			throw answer.error === 'no answer'
				? new CliError(`The server at ${server} does not answer`, 'Is it running? AMXTS_PORT in .env names a port other than 27015.')
				: new CliError(`The server refused the rcon_password of ${target.cfg}`, 'The server reads it as it starts: restart it after a change.');
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
			warnServer(core, os);
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
		description: 'Run the project\'s tests on a fake server (Vitest when the project has it, else bun test)',
		usage: 'amxts test [test runner options]',
		passThrough: true,
		examples: ['amxts test', 'amxts test hello', 'amxts test --watch'],
		async run({ raw }) {
			const core = await projectCore();
			// A project with Vitest tests on Node; any other on bun test.
			const vitest = join(needProject(), 'node_modules', 'vitest', 'vitest.mjs');
			const result = await run(existsSync(vitest)
				? [process.execPath, vitest, ...(raw.includes('--watch') ? [] : ['run']), ...raw]
				: [needBun(core, 'runs tests'), 'test', ...raw]);
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
		description: 'Move the project to the latest amxts: its packages, its code, the build and the server',
		usage: 'amxts upgrade [--to <version>] [--no-server] [--server-only] [--dry-run]',
		flags: {
			to: { type: 'string', value: 'version', description: 'The version to move to (the latest on the registry by default)' },
			server: { type: 'boolean', description: 'Update the server in AMXTS_SERVER: its module, from the release (--no-server to leave it)' },
			serverOnly: { type: 'boolean', description: 'Only update the server - once it is stopped, when the upgrade found it running' },
			dryRun: { type: 'boolean', description: 'Say what would change, and change nothing' },
		},
		examples: ['amxts upgrade', 'amxts upgrade --dry-run', 'amxts upgrade --to 0.2.0 --no-server', 'amxts upgrade --server-only'],
		async run({ values }) {
			const { upgrade } = await import('./upgrade.mjs');
			await upgrade({ to: values.to, server: values.server !== false, serverOnly: values.serverOnly, dryRun: values.dryRun });
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
