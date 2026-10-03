// What the tests share: running the command as a user runs it - in a
// terminal too - a project with a stand-in core, and a folder that is gone
// after the test.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(ROOT, 'packages', 'cli', 'bin', 'amxts.mjs');

/** The environment a command runs in: no colors, as from a shell - no package manager's agent, which `bun run test` would pass on and the command would take for the user's. */
function environment(env: Record<string, string>) {
	const { FORCE_COLOR: _, npm_config_user_agent: __, ...inherited } = process.env;
	return { ...inherited, NO_COLOR: '1', ...env };
}

/** Runs a script with Node: its exit code and everything it printed. */
export function node(script: string, args: string[], cwd = process.cwd(), env: Record<string, string> = {}) {
	const run = spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', [script, ...args], { cwd, encoding: 'utf8', env: environment(env) });
	return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

/** Runs the amxts command in a folder. */
export function amxts(args: string[], cwd = process.cwd(), env: Record<string, string> = {}) {
	return node(BIN, args, cwd, env);
}

/** Runs the amxts command as in a terminal, not in CI, typing `input` - `\r` is Enter - into what it asks. */
export function amxtsInTerminal(args: string[], cwd: string, input: string) {
	const terminal = pathToFileURL(join(ROOT, 'test', 'terminal.mjs')).href;
	const run = spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', ['--import', terminal, BIN, ...args], { cwd, input, encoding: 'utf8', env: environment({ CI: 'false' }) });
	return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

/** A folder for one test, removed after it. */
export function inTemp(body: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-cli-'));
	try {
		body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The server folder of a stand-in project: its addons/amxts, with the includes beside it. */
export function serverOf(dir: string) {
	return join(dir, 'hlds', 'cstrike', 'addons', 'amxts').replace(/\\/g, '/');
}

/**
 * A project with a stand-in core in its node_modules: a package.json with this
 * version, and a cli-api (when `api` is given) whose tasks run `task.mjs` with
 * Node, which prints what it was asked for - and `prepare` the modules
 * amxts.config.ts lists. Its server has its includes, so nothing is fetched
 * before a task; `.env` names it unless `env` says what .env holds.
 */
export function standInProject(dir: string, version: string, api?: number, env = `AMXTS_SERVER=${serverOf(dir)}\n`) {
	writeFileSync(join(dir, 'package.json'), '{ "name": "my-server", "private": true }\n');
	mkdirSync(join(dir, 'hlds', 'cstrike', 'addons', 'amxmodx', 'scripting', 'include'), { recursive: true });
	writeFileSync(join(dir, '.env'), env);
	const core = join(dir, 'node_modules', '@amxts', 'core');
	mkdirSync(core, { recursive: true });
	const exports = api === undefined ? { './*': './*' } : { './cli-api': './cli-api.mjs', './package.json': './package.json' };
	writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@amxts/core', version, type: 'module', exports }));
	if (api === undefined) return;
	writeFileSync(join(core, 'task.mjs'), [
		'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
		'const args = process.argv.slice(2);',
		'console.log("task", ...args);',
		'if (args[0] === "prepare" && existsSync("amxts.config.ts")) console.log(readFileSync("amxts.config.ts", "utf8").match(/modules: .*/)[0]);',
		// The upgrade's report: one change and one place to check by hand.
		`if (args[0] === "upgrade" && args.includes("--report")) writeFileSync(args[args.indexOf("--report") + 1], JSON.stringify(${JSON.stringify(UPGRADE_REPORT)}));`,
		'',
	].join('\n'));
	writeFileSync(join(core, 'cli-api.mjs'), [
		'import { readFileSync } from "node:fs";',
		'import { createRequire } from "node:module";',
		'import { fileURLToPath } from "node:url";',
		`export const version = ${JSON.stringify(version)};`,
		`export const cliApi = ${api};`,
		'export const fromSource = false;',
		'export const task = (name, args = []) => ({ runtime: name === "build" ? "bun" : "node", args: [fileURLToPath(new URL("./task.mjs", import.meta.url)), name, ...args] });',
		// Its Bun is the runtime these tests run on, by its path: not a Bun on PATH.
		`export const bunBinary = () => ${JSON.stringify(process.execPath)};`,
		// The TypeScript amxts.config.ts is read with: this repository's.
		`export const typescript = () => createRequire(${JSON.stringify(join(ROOT, 'package.json'))})("typescript");`,
		// A Windows server; its release is the folder AMXTS_RELEASE_URL names, with the module only.
		'export const serverSystem = () => ({ system: "windows", from: "host" });',
		'export const release = system => ({ version, url: process.env.AMXTS_RELEASE_URL ?? "", manifest: "amxts-" + system + ".json", files: [{ asset: "amxts_amxx.dll", path: "addons/amxmodx/modules/amxts_amxx.dll", tool: false }], image: "ghcr.io/amxts/server:" + version });',
		'export const moduleVersion = (file) => { try { return /(\\d+\\.\\d+\\.\\d+)\\+abi\\./.exec(readFileSync(file, "latin1"))?.[1] ?? null; } catch { return null; } };',
		'',
	].join('\n'));
}

/** What the stand-in core's upgrade task reports. */
export const UPGRADE_REPORT = {
	changes: [{ file: 'plugins/hello.ts', line: 1, from: '~/facade', to: '@amxts/core' }],
	left: [{ file: 'plugins/hello.ts', line: 4, why: 'reads the words after the command\'s name' }],
};
