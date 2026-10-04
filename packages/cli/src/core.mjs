// The core a command works with, and Bun, which runs the core's build.
//
// The command is a package of its own, @amxts/cli; the core is the project's
// - its node_modules/@amxts/core, found from the folder the command runs in.
// The command talks to it only through
// `@amxts/core/cli-api`: the core's version, the contract version (`cliApi`),
// and the tasks it runs (`task()`). A core this command cannot drive is an
// error that says which of the two to update.
//
// Creating a project or a module needs no core: they run on their own.
// `--local` takes the core from this machine instead of npm (localCore()).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addArgs, commandLine, detectPackageManager, execAmxts, versionOf } from './pm.mjs';
import { CliError, debug } from './ui.mjs';

/** The command's own package folder: packages/cli in its repository. */
export const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI_PACKAGE = readJson(join(CLI_DIR, 'package.json'));
export const VERSION = String(CLI_PACKAGE.version);

/** The cores this command works with: the range a new project asks for. */
export const CORE_RANGE = '^0.2.0';
/** The version of `@amxts/core/cli-api` this command speaks. */
export const CLI_API = 5;

/**
 * Run from a checkout of the command's repository (npm link, a clone) rather
 * than from npm: then a new project takes the core and the official modules
 * from this machine by default, as --local says: the checkout is for working
 * on them together.
 */
export const FROM_SOURCE = existsSync(join(CLI_DIR, '..', '..', '.git')) && readJson(join(CLI_DIR, '..', '..', 'package.json'))?.name === 'amxts-cli';

/** A JSON file's contents, or null when it is missing or not JSON. */
export function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

/** A setting as the build sees it: the environment, else the project's .env (which Bun reads). */
export function setting(dir, name) {
	if (process.env[name]) return process.env[name];
	const env = join(dir, '.env');
	if (!existsSync(env)) return '';
	const line = readFileSync(env, 'utf8').split(/\r?\n/).find(each => each.trim().split('=')[0].trim() === name);
	return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^(["'])(.*)\1$/, '$2') : '';
}

/**
 * @typedef {object} Core
 * @property {string} dir its folder (a link resolved to its target)
 * @property {string} version its version
 * @property {boolean} fromSource whether it is a checkout rather than a package from npm
 * @property {typeof import('@amxts/core/cli-api')} api what it offers the command
 */

/** The project's folder: the nearest one up with a package.json, or null. */
export function findProject(from = process.cwd()) {
	for (let at = resolve(from); ; at = dirname(at)) {
		if (existsSync(join(at, 'package.json'))) return at;
		if (dirname(at) === at) return null;
	}
}

/** Where @amxts/core is installed for a folder, resolved from it as Node resolves it; null when it is not. */
export function coreDirFrom(dir) {
	try {
		return dirname(createRequire(join(dir, 'package.json')).resolve('@amxts/core/package.json'));
	} catch {
		return null;
	}
}

const loaded = new Map();

/** "2.1.0" as [2, 1, 0]; a pre-release tag is left out. */
function parts(version) {
	return String(version).split('-')[0].split('.').map(each => Number.parseInt(each, 10) || 0);
}

/** Whether a version is in a caret range: `^0.1.0` takes 0.1.x from 0.1.0 up. */
export function satisfies(version, range = CORE_RANGE) {
	const [major, minor, patch] = parts(version);
	const [wantMajor, wantMinor, wantPatch] = parts(range.replace(/^\^/, ''));
	if (major !== wantMajor) return false;
	// Below 1.0 the minor is the breaking number: ^0.1.0 does not take 0.2.0.
	if (major === 0 && minor !== wantMinor) return false;
	return minor > wantMinor || (minor === wantMinor && patch >= wantPatch);
}

/** Whether a version is past a caret range, not below it: its major, or below 1.0 its minor, is the higher. */
function pastRange(version, range = CORE_RANGE) {
	const [major, minor] = parts(version);
	const [wantMajor, wantMinor] = parts(range.replace(/^\^/, ''));
	return major !== wantMajor ? major > wantMajor : major === 0 && minor > wantMinor;
}

/** What to do about a core this command cannot drive: update the command when the core is the newer, else the core. */
function updateHint(coreIsNewer) {
	const pm = detectPackageManager();
	return coreIsNewer
		? `Update the command: npm install -g @amxts/cli@latest - a project's own ${pm === 'npm' ? 'npx amxts' : `${pm} amxts`} comes with its core`
		: `Move the project to amxts ${VERSION}: ${execAmxts(pm)} upgrade`;
}

/**
 * The core in a folder, checked: its version is one this command works with,
 * and it speaks the same `cli-api`.
 * @param {string} dir the core's folder
 * @returns {Promise<Core>} the core, ready to drive
 */
export async function loadCore(dir) {
	if (loaded.has(dir)) return loaded.get(dir);
	const version = String(readJson(join(dir, 'package.json'))?.version ?? '0.0.0');
	if (!satisfies(version)) {
		throw new CliError(`@amxts/core ${version} is not a core amxts ${VERSION} works with (${CORE_RANGE})`, updateHint(pastRange(version)));
	}
	let api;
	try {
		const entry = createRequire(join(dir, 'package.json')).resolve('@amxts/core/cli-api');
		api = await import(pathToFileURL(entry).href);
	} catch (error) {
		if (debug()) throw error;
		throw new CliError(`@amxts/core ${version} has no cli-api, which amxts ${VERSION} runs it through`, updateHint(false));
	}
	if (api.cliApi !== CLI_API) {
		throw new CliError(`@amxts/core ${version} speaks cli-api ${api.cliApi}, amxts ${VERSION} speaks ${CLI_API}`, updateHint(api.cliApi > CLI_API));
	}
	/** @type {Core} */
	const core = { dir, version, fromSource: Boolean(api.fromSource), api };
	loaded.set(dir, core);
	return core;
}

/** The project's folder, or an error that says how to create one. */
export function needProject(from = process.cwd()) {
	const project = findProject(from);
	if (project) return project;
	throw new CliError('This folder is not in a project: no package.json here or above', 'Create one with: npm create amxts@latest');
}

/**
 * The core installed for a folder, checked; null when there is none.
 * @returns {Promise<Core | null>} the core, or null
 */
export async function installedCore(from = process.cwd()) {
	const dir = coreDirFrom(from);
	return dir ? loadCore(dir) : null;
}

/**
 * The project's core: @amxts/core as the folder the command runs in has it
 * installed. An error that says how to install it when it is not.
 * @returns {Promise<Core>} the core, ready to drive
 */
export async function projectCore(from = process.cwd()) {
	const core = await installedCore(from);
	if (core) return core;
	const project = needProject(from);
	throw new CliError('@amxts/core is not installed in this project', `Install it: ${commandLine(addArgs(detectPackageManager(project), ['@amxts/core']))}`);
}

/**
 * The core on this machine, for --local: the folder AMXTS_CORE names, else the
 * one the command itself resolves - its checkout links the core beside it
 * (its package.json's `file:` link), and an installed command sits next to
 * the project's core. Null when there is none.
 * @returns {Promise<Core | null>} the core, or null
 */
export async function localCore() {
	const dir = process.env.AMXTS_CORE ? resolve(process.env.AMXTS_CORE) : coreDirFrom(CLI_DIR);
	return dir && existsSync(join(dir, 'package.json')) ? loadCore(dir) : null;
}

/** The local core, or an error that says how to point the command at one. */
export async function needLocalCore() {
	const core = await localCore();
	if (core) return core;
	throw new CliError('--local: there is no core on this machine to take', 'Set AMXTS_CORE to the core\'s folder (a checkout of @amxts/core), or run npm install in the command\'s checkout, which links the core beside it.');
}

/**
 * The TypeScript parser, which amxts.config.ts is read with: the project's
 * core's, else the one on this machine.
 * @returns {Promise<typeof import('typescript')>} the typescript module
 */
export async function coreTypeScript(from = process.cwd()) {
	const core = await installedCore(from) ?? await localCore();
	if (!core) throw new CliError('amxts reads amxts.config.ts with the core\'s TypeScript, and @amxts/core is not installed here', 'Install the project\'s dependencies first.');
	return core.api.typescript();
}

const BUN_HINT = [
	'Bun comes with @amxts/core: install the project\'s dependencies again, letting',
	'the package manager run bun\'s install script. Where it cannot (no package',
	'for this platform), install Bun yourself and run the command again:',
	'  npm install -g bun',
	process.platform === 'win32' ? '  or: powershell -c "irm bun.sh/install.ps1 | iex"' : '  or: curl -fsSL https://bun.sh/install | bash',
].join('\n');

let pathVersion;

/** The version of a Bun on PATH, or null when there is none. */
function bunOnPath() {
	pathVersion ??= versionOf('bun');
	return pathVersion;
}

/**
 * The Bun the core's tasks and tests run on: the one installed with the core
 * (its cli-api's bunBinary(), from the `bun` package it depends on), else a
 * Bun on PATH, as `bun`; null when there is neither.
 * @param {Core | null} [core]
 * @returns {string | null} the binary, or `bun`
 */
export function bunFor(core) {
	const own = core?.api.bunBinary?.();
	if (own) return own;
	return bunOnPath() ? 'bun' : null;
}

/** The version of the Bun bunFor() gives, or null. */
export function bunVersion(core) {
	const binary = bunFor(core);
	if (!binary) return null;
	if (binary === 'bun') return bunOnPath();
	const run = spawnSync(binary, ['--version'], { encoding: 'utf8' });
	return run.status === 0 ? run.stdout.trim() : null;
}

/** The Bun to run, or an error that says how to get one. */
export function needBun(core, what = 'builds plugins') {
	const binary = bunFor(core);
	if (!binary) throw new CliError(`amxts ${what} with Bun, and there is none: not with @amxts/core, not on PATH`, BUN_HINT);
	return binary;
}

/**
 * Runs one of the core's tasks in the current folder, its output straight to
 * the terminal: `prepare`, `build`, `check`, `typecheck`. Returns its exit code.
 * @param {Core} core
 * @param {string} name
 * @param {string[]} [args]
 */
export function runTask(core, name, args = []) {
	const task = core.api.task(name, args);
	const env = { ...process.env, ...(debug() ? { AMXTS_DEBUG: '1' } : {}) };
	if (task.runtime === 'node') {
		return spawnSync(process.execPath, task.args, { stdio: 'inherit', env }).status ?? 1;
	}
	const binary = needBun(core);
	// A Bun on PATH goes through the shell on Windows, where it may be
	// bun.cmd; a path with a space is quoted for it.
	const result = binary === 'bun' && process.platform === 'win32'
		? spawnSync(commandLine(['bun', ...task.args]), { stdio: 'inherit', shell: true, env })
		: spawnSync(binary, task.args, { stdio: 'inherit', env });
	if (result.error) throw new CliError(`Bun did not start: ${result.error.message}`, BUN_HINT);
	return result.status ?? 1;
}

/** Runs a task and stops with its exit code when it fails. */
export function runTaskOrExit(core, name, args = []) {
	const code = runTask(core, name, args);
	if (code !== 0) process.exit(code);
}
