// The server a project deploys to: its addons/amxts folder, AMXTS_SERVER in
// the project's .env. `amxts init` asks for it; `dev` and `build --deploy`
// ask the same when it is not set - in a terminal. Elsewhere (CI, a pipe)
// nothing is asked, and the build says it is missing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import * as p from '@clack/prompts';
import { setting } from './core.mjs';
import { runScript } from './pm.mjs';
import { c, CliError } from './ui.mjs';

// The folders a server path may name above its addons/amxts, by what is below
// them: hlds's own (cstrike/addons), the game's (addons).
const ABOVE_ADDONS = [join('cstrike', 'addons'), 'addons'];

/** A path as .env and the messages write it: with forward slashes. */
const slashes = path => path.replace(/\\/g, '/');

/**
 * The server's addons/amxts folder from a path a person gave: that folder
 * itself, or the hlds folder, cstrike or cstrike/addons above it - as the
 * core's build reads AMXTS_SERVER. A path that is not there yet is taken as
 * it is, and so is a folder named amxts or holding the module's plugins.ini.
 * @param {string} path
 * @returns {string} the folder; '' for ''
 * @throws {CliError} for a folder that is there and none of them, naming where it looked
 */
export function serverFolder(path) {
	if (!path) return '';
	const dir = resolve(path);
	if (!existsSync(dir) || basename(dir).toLowerCase() === 'amxts' || existsSync(join(dir, 'plugins.ini'))) return path;
	if (basename(dir).toLowerCase() === 'addons') return join(dir, 'amxts');
	const addons = ABOVE_ADDONS.map(below => join(dir, below)).find(folder => existsSync(folder));
	if (addons) return join(addons, 'amxts');
	const looked = [...ABOVE_ADDONS, 'plugins.ini'].map(below => slashes(join(dir, below)));
	throw new CliError(`${slashes(path)} is not a server: there is no ${looked.join(', ')}`, 'Give the server\'s folder (where hlds is), its cstrike, or cstrike/addons/amxts.');
}

/** The server's addons/amxts from a path, or null when the path is no server: for what only reads it. */
export function serverFolderOrNull(path) {
	try {
		return serverFolder(path);
	} catch {
		return null;
	}
}

/** Whether a command may ask: a terminal, and not CI. */
export function canAsk() {
	return Boolean(process.stdin.isTTY) && !p.isCI();
}

/**
 * Asks for the server: its folder, its cstrike or its addons/amxts.
 * `required`: an empty answer is not taken. The server's addons/amxts
 * (serverFolder), '' for none, or clack's cancel symbol on Ctrl+C.
 * @param {string} pm the project's package manager, for the words
 * @param {{ required?: boolean }} [options]
 */
export async function askServer(pm, { required = false } = {}) {
	const answer = await p.text({
		message: `Where is the server? ${c.dim(`its folder or its addons/amxts, for ${runScript(pm, 'dev')}${required ? '' : ' - empty to skip'}`)}`,
		placeholder: process.platform === 'win32' ? 'D:/hlds' : '/srv/hlds',
		defaultValue: '',
		validate: (value) => {
			if (!value?.trim()) return required ? 'The plugins are deployed there: the server\'s folder' : undefined;
			try {
				serverFolder(value.trim());
				return undefined;
			} catch (error) {
				return `${error.message}. ${error.hint}`;
			}
		},
	});
	return p.isCancel(answer) ? answer : serverFolder(answer.trim());
}

/** The warning for a server folder that is not there. */
export function missingServer(server) {
	return `${server} is not there yet: dev builds, and deploys once it is.`;
}

/** `.env`'s lines for the server. */
export function serverEnv(server) {
	const hint = server ? '' : '# Left empty, amxts dev asks for it - e.g. D:/hlds/cstrike/addons/amxts.\n';
	return `# Where amxts dev deploys: the addons/amxts folder of the server.\n${hint}AMXTS_SERVER=${server.replace(/\\/g, '/')}\n`;
}

/** Sets AMXTS_SERVER in the project's .env: on its line when it has one, else after what is there. */
export function saveServer(root, server) {
	const path = join(root, '.env');
	const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
	const line = /^[ \t]*AMXTS_SERVER[ \t]*=.*$/m;
	writeFileSync(path, line.test(text)
		? text.replace(line, `AMXTS_SERVER=${server.replace(/\\/g, '/')}`)
		: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${serverEnv(server)}`);
}

/**
 * AMXTS_SERVER for a command that deploys. When it is not set and the
 * command may ask, it is asked, written to .env and set for the build.
 * @param {string} root the project's folder
 * @param {string} pm its package manager
 */
export async function ensureServer(root, pm) {
	if (setting(root, 'AMXTS_SERVER') || !canAsk()) return;
	p.log.warn('AMXTS_SERVER is not set: where should the plugins go?');
	const server = await askServer(pm, { required: true });
	if (p.isCancel(server)) {
		p.cancel('Nothing was built.');
		process.exit(1);
	}
	saveServer(root, server);
	process.env.AMXTS_SERVER = server;
	p.log.success(`Wrote AMXTS_SERVER=${slashes(server)} to .env`);
	if (!existsSync(server)) p.log.warn(missingServer(server));
}
