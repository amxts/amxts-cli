// `amxts info`: what a bug report needs - the versions of
// everything the build depends on, the project, its modules and its server.
// It works anywhere: outside a project it says so and goes on.
import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { readConfigModules } from './config.mjs';
import { bunFor, bunVersion, CLI_DIR, installedCore, readJson, setting, VERSION } from './core.mjs';
import { detectPackageManager, versionOf } from './pm.mjs';
import { c, CliError } from './ui.mjs';

/** The project's core, or why it cannot be used: not installed, or not one this command works with. */
async function core(dir) {
	try {
		const found = await installedCore(dir);
		return { core: found, problem: found ? '' : c.dim('not installed here') };
	} catch (error) {
		if (error instanceof CliError) return { core: null, problem: c.red(`${error.message} - ${error.hint}`) };
		throw error;
	}
}

/**
 * The system the build compiles for, as the core decides it from .env and the
 * server's folder: "Linux (hlds_linux)". A core without serverSystem() builds
 * for this machine.
 */
function serverSystem(found, dir, server) {
	if (!found) return c.dim('unknown without the core');
	if (!found.api.serverSystem) return c.dim('this machine\'s (the core does not tell)');
	try {
		const env = { ...process.env, AMXTS_SERVER: server, AMXTS_SERVER_OS: setting(dir, 'AMXTS_SERVER_OS') };
		const decided = found.api.serverSystem([], env);
		const note = decided.from === 'host' ? c.dim(' - set AMXTS_SERVER, AMXTS_SERVER_OS or pass --os when the server runs another') : '';
		return `${found.api.describeSystem(decided)}${note}`;
	} catch (error) {
		return c.red(error.message);
	}
}

export async function info() {
	const dir = process.cwd();
	const project = readJson(join(dir, 'package.json'));
	const pm = detectPackageManager(dir);
	const { core: found, problem } = await core(dir);
	const tools = found?.api.toolchain();
	const modules = found ? await readConfigModules(dir) : null;
	const server = setting(dir, 'AMXTS_SERVER');
	const system = serverSystem(found, dir, server);
	const bun = bunFor(found);
	const bunV = bunVersion(found);

	const rows = [
		['Operating system', `${process.platform === 'win32' ? 'Windows' : process.platform} ${release()} (${process.arch})`],
		['Node.js', process.version.replace(/^v/, '')],
		['Bun', bunV ? `${bunV} ${c.dim(bun === 'bun' ? '(on PATH)' : bun)}` : c.red('none - not with @amxts/core, not on PATH; the build needs it')],
		['Package manager', `${pm} ${versionOf(pm) ?? c.red('not installed')}`],
		['@amxts/cli', `${VERSION} ${c.dim(CLI_DIR)}`],
		['@amxts/core', found ? `${found.version} ${c.dim(found.dir)}` : problem],
		...(tools
			? [
					['AssemblyScript', `${tools.assemblyscript.version ?? '?'} + amxts patch${tools.assemblyscript.built ? '' : c.red(' (not built: runtime/deps/assemblyscript)')}`],
					['WAMR', `${tools.wamr.version ?? '?'} + amxts patch, wamrc ${tools.wamr.wamrc ? 'found' : c.red('missing')}`],
				]
			: []),
		['Project', project ? `${project.name ?? '(no name)'} ${c.dim(dir)}` : c.dim('none here (no package.json)')],
		['Modules', modules === null
			? c.dim(found ? 'no amxts.config.ts' : 'unknown without the core')
			: modules.length === 0
				? c.dim('none')
				: modules.map((name) => {
						const version = readJson(join(dir, 'node_modules', name, 'package.json'))?.version;
						return version ? `${name} ${version}` : `${name} ${c.red('(not installed)')}`;
					}).join(', ')],
		['AMXTS_SERVER', server ? `${server}${existsSync(server) ? '' : c.red(' (not found)')}` : c.dim('not set')],
		['Server system', system],
		['AMXTS_DOCS_LANG', setting(dir, 'AMXTS_DOCS_LANG') || c.dim('en')],
	];
	const width = Math.max(...rows.map(([label]) => label.length));
	console.log(c.bold('amxts info') + c.dim(' - paste this into a bug report'));
	console.log();
	for (const [label, value] of rows) console.log(`  ${c.dim(label.padEnd(width))}  ${value}`);
	console.log();
}
