// The server a project deploys to: its addons/amxts folder, AMXTS_SERVER in
// the project's .env. `amxts init` asks for it; `dev` and `build --deploy`
// ask the same when it is not set - in a terminal. Elsewhere (CI, a pipe)
// nothing is asked, and the build says it is missing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import * as p from '@clack/prompts';
import { setting } from './core.mjs';
import { runScript } from './pm.mjs';
import { c } from './ui.mjs';

/** Whether a command may ask: a terminal, and not CI. */
export function canAsk() {
	return Boolean(process.stdin.isTTY) && !p.isCI();
}

/**
 * Asks for the server's addons/amxts folder. `required`: an empty answer is
 * not taken. The answer, or clack's cancel symbol on Ctrl+C.
 * @param {string} pm the project's package manager, for the words
 * @param {{ required?: boolean }} [options]
 */
export function askServer(pm, { required = false } = {}) {
	return p.text({
		message: `Where is the server? ${c.dim(`its addons/amxts folder, for ${runScript(pm, 'dev')}${required ? '' : ' - empty to skip'}`)}`,
		placeholder: process.platform === 'win32' ? 'D:/hlds/cstrike/addons/amxts' : '/srv/hlds/cstrike/addons/amxts',
		defaultValue: '',
		validate: value => (required && !value?.trim() ? 'The plugins are deployed there: the server\'s addons/amxts folder' : undefined),
	});
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
	p.log.success(`Wrote AMXTS_SERVER=${server.replace(/\\/g, '/')} to .env`);
	if (!existsSync(server)) p.log.warn(missingServer(server));
}
