// The server step of `amxts upgrade`: the server in AMXTS_SERVER gets the
// module of the project's core - and the compiler for `.ts` written on the
// server, where it has one - from that version's GitHub Release.
//
// The release's manifest (amxts-<system>.json) names each file with its
// sha256. Nothing on the server changes until every file it needs is
// downloaded and checked, and none of the files it replaces is in use: a
// running Windows server holds its module, which cannot be written then.
// The file it replaces stays beside it, with its version
// (amxts_amxx.dll.0.1.0). What an older release put into AMX Mod X goes: an
// `amxts_host.amxx` line of its plugins.ini, that plugin and its list -
// amxts needs no plugin. And amxts_amxx goes on the first line of
// modules.ini: a module listed above it keeps its forwards from amxts plugins.
//
// Also the check `amxts dev` and `build` start with: the release the
// server's module is of, read from the module file (the core's
// moduleVersion()), against the project's core.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compareVersions, setting } from './core.mjs';
import { serverFolderOrNull } from './server.mjs';
import { c, CliError, log } from './ui.mjs';

/** A path as the messages write it. */
const slashes = path => path.replace(/\\/g, '/');

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** A file of a release: a URL's, or a folder's (AMXTS_RELEASE_URL may name one). */
export async function releaseFile(base, name) {
	if (!/^https?:\/\//.test(base)) return readFileSync(join(base, name));
	const url = new URL(name, base.endsWith('/') ? base : `${base}/`);
	const response = await fetch(url);
	if (!response.ok) throw new CliError(`${url} answered ${response.status}`, 'The release may not be published yet, or the network is down.');
	return Buffer.from(await response.arrayBuffer());
}

/** Whether a file can be written: false while a process holds it - a module a running server loaded. */
export function writable(path) {
	try {
		closeSync(openSync(path, 'r+'));
		return true;
	} catch (error) {
		// EBUSY: a module Windows has loaded; ETXTBSY: a tool Linux is running.
		if (['EBUSY', 'ETXTBSY', 'EPERM', 'EACCES'].includes(error.code)) return false;
		throw error;
	}
}

/** The files of an older release's plugin in AMX Mod X, from the game folder. */
const LEFTOVERS = ['addons/amxmodx/plugins/amxts_host.amxx', 'addons/amxmodx/configs/plugins-amxts.ini'];

/** AMX Mod X's plugins.ini with its `amxts_host.amxx` lines left out; null when it has none. */
export function withoutHost(text) {
	const lines = text.split(/(?<=\n)/);
	const kept = lines.filter(line => !/^\s*amxts_host\.amxx\b/i.test(line));
	return kept.length === lines.length ? null : kept.join('');
}

/** A line's module in modules.ini, as AMX Mod X reads it: the first word, after a `>`; '' for none. */
function moduleOfLine(line) {
	const word = line.trim().replace(/^>\s*/, '').split(/\s/)[0];
	return word.startsWith(';') ? '' : word;
}

/** AMX Mod X's modules.ini with `amxts_amxx` as its first module, the line moved or added; null when it is first already. */
export function withAmxtsFirst(text) {
	const lines = text.split(/(?<=\n)/).filter(line => line);
	const ours = line => /^amxts(?:_amxx)?$/i.test(moduleOfLine(line));
	if (ours(lines.find(line => moduleOfLine(line)) ?? '')) return null;
	const kept = lines.filter(line => !ours(line));
	const first = kept.findIndex(line => moduleOfLine(line));
	const at = first < 0 ? kept.length : first;
	if (at > 0 && !kept[at - 1].endsWith('\n')) kept[at - 1] += '\n';
	kept.splice(at, 0, `amxts_amxx${text.includes('\r\n') ? '\r\n' : '\n'}`);
	return kept.join('');
}

/** The settings the core's serverSystem() reads, as the build sees them: the environment, else .env. */
function serverEnv(dir) {
	return { AMXTS_SERVER: setting(dir, 'AMXTS_SERVER'), AMXTS_SERVER_OS: setting(dir, 'AMXTS_SERVER_OS') };
}

/**
 * The server's game folder and the files of `api`'s release for its system, or null when .env names no server that is there.
 * @param {typeof import('@amxts/core/cli-api')} api
 * @param {string} dir the project
 * @param {string[]} [argv] --os, when the command was given one
 */
function serverOf(api, dir, argv = []) {
	const amxts = serverFolderOrNull(setting(dir, 'AMXTS_SERVER'));
	if (!amxts || !existsSync(amxts)) return null;
	const { system } = api.serverSystem(argv, serverEnv(dir));
	return { amxts, game: resolve(amxts, '..', '..'), system, release: api.release(system) };
}

/**
 * The line `amxts dev` and `build` start with when the server's module is of
 * another release than the project's core; null when it is the same, or
 * there is no module to read. `warn` when they are of different lines: the
 * module loads no plugin of another line, while within one it loads them all.
 * @param {import('./core.mjs').Core} core
 * @param {string} dir the project
 * @param {string[]} [argv] --os, when the command was given one
 * @returns {{ line: string, warn: boolean } | null}
 */
export function serverMismatch(core, dir, argv = []) {
	const server = serverOf(core.api, dir, argv);
	const running = server && core.api.moduleVersion(join(server.game, server.release.files[0].path));
	if (!running || running === core.version) return null;
	const lineOf = version => version.split('.').slice(0, 2).join('.');
	return {
		line: compareVersions(core.version, running) > 0
			? `amxts ${core.version} is out for the server (it runs ${running}): amxts upgrade puts it in`
			: `the server runs a newer amxts, ${running}: amxts upgrade updates this project`,
		warn: lineOf(running) !== lineOf(core.version),
	};
}

/**
 * @typedef {object} ServerOutcome
 * @property {boolean} ok whether the server is as it should be, or nothing was asked of it
 * @property {string} line what happened, for the summary
 */

/**
 * The server step.
 * @param {typeof import('@amxts/core/cli-api')} api the project's core, of the version the server moves to
 * @param {string} dir the project
 * @param {{ dryRun?: boolean, canWrite?: typeof writable }} [options] `canWrite`: what the tests replace
 * @returns {Promise<ServerOutcome>} what happened
 */
export async function updateServer(api, dir, { dryRun = false, canWrite = writable } = {}) {
	const named = setting(dir, 'AMXTS_SERVER');
	const version = api.version;
	if (!named) {
		const image = api.release('linux').image;
		log.step('Server: no AMXTS_SERVER in .env');
		return { ok: true, line: `none in .env; a server in Docker: docker pull ${image}` };
	}
	const server = serverOf(api, dir);
	if (!server) {
		log.step(`Server: ${slashes(named)} is not there`);
		return { ok: false, line: `${slashes(named)} is not there: nothing was updated` };
	}
	const { game, system, release } = server;
	const [module] = release.files;
	const modulePath = join(game, module.path);
	log.step(`Server: ${slashes(game)} ${c.dim(`(${system})`)}`);
	if (!existsSync(modulePath)) {
		return { ok: false, line: `there is no ${module.asset} in ${slashes(dirname(modulePath))}: install the server kit of amxts ${version}` };
	}

	const before = api.moduleVersion(modulePath) ?? 'old';
	const manifest = JSON.parse((await releaseFile(release.url, release.manifest)).toString('utf8'));
	if (manifest.version !== version) throw new CliError(`${release.manifest} is of amxts ${manifest.version}, not ${version}`, `It was read from ${release.url}.`);
	const files = release.files
		.filter(file => !file.tool || existsSync(join(game, file.path)))
		.map((file) => {
			const entry = manifest.files.find(one => one.name === file.asset);
			if (!entry) throw new CliError(`${release.manifest} lists no ${file.asset}`, `It was read from ${release.url}.`);
			const path = join(game, file.path);
			return { ...file, path, sha256: entry.sha256, same: existsSync(path) && sha256(readFileSync(path)) === entry.sha256 };
		});
	const changing = files.filter(file => !file.same);
	const pluginsIni = join(game, 'addons', 'amxmodx', 'configs', 'plugins.ini');
	const cleaned = existsSync(pluginsIni) ? withoutHost(readFileSync(pluginsIni, 'utf8')) : null;
	const leftovers = LEFTOVERS.map(path => join(game, path)).filter(path => existsSync(path));
	const tidied = [...(cleaned === null ? [] : [pluginsIni]), ...leftovers].map(slashes).join(', ');
	const modulesIni = join(game, 'addons', 'amxmodx', 'configs', 'modules.ini');
	const ordered = existsSync(modulesIni) ? withAmxtsFirst(readFileSync(modulesIni, 'utf8')) : null;
	const names = changing.map(file => file.path.split(/[\\/]/).pop()).join(', ');

	if (dryRun) {
		for (const file of changing) log.info(`would put ${file.asset} of ${version} at ${slashes(file.path)}`);
		if (tidied) log.info(`would take an older amxts's plugin out of ${tidied}`);
		if (ordered !== null) log.info(`would put amxts_amxx on the first line of ${slashes(modulesIni)}`);
		return { ok: true, line: changing.length ? `${names} would go from amxts ${before} to ${version}` : `already amxts ${version}` };
	}

	const busy = changing.filter(file => existsSync(file.path) && !canWrite(file.path));
	if (busy.length) {
		log.warn(`${busy.map(file => slashes(file.path)).join(', ')} is in use: the server is running`);
		log.hint(`Stop the server, then run: amxts upgrade --server-only`);
		return { ok: false, line: `in use - stop the server and run amxts upgrade --server-only; nothing on it was changed` };
	}

	// Every file downloaded and checked before the first is replaced.
	const downloads = await Promise.all(changing.map(async (file) => {
		const data = await releaseFile(release.url, file.asset);
		if (sha256(data) !== file.sha256) throw new CliError(`${file.asset} from ${release.url} is not the one ${release.manifest} lists (sha256)`, 'Nothing on the server was changed. Run it again; if it says the same, the download is broken.');
		return { ...file, data };
	}));
	for (const file of downloads) {
		const old = existsSync(file.path) ? statSync(file.path) : null;
		if (old) {
			rmSync(`${file.path}.${before}`, { force: true });
			renameSync(file.path, `${file.path}.${before}`);
		}
		writeFileSync(file.path, file.data, { mode: old?.mode ?? 0o755 });
		log.success(`${file.path.split(/[\\/]/).pop()} ${c.dim(`${before} →`)} ${version}${old ? c.dim(` (the old one: ${file.path.split(/[\\/]/).pop()}.${before})`) : ''}`);
	}
	if (cleaned !== null) writeFileSync(pluginsIni, cleaned);
	for (const path of leftovers) rmSync(path, { force: true });
	if (tidied) log.success(`Took an older amxts's plugin out of ${tidied}: amxts needs no plugin`);
	if (ordered !== null) {
		writeFileSync(modulesIni, ordered);
		log.success(`Put amxts_amxx on the first line of ${slashes(modulesIni)}: a module above it keeps its forwards from amxts plugins`);
	}
	const also = [tidied && 'the old plugin taken out', ordered !== null && 'amxts_amxx first in modules.ini'].filter(Boolean).join(', ');
	if (!changing.length) return { ok: true, line: `already amxts ${version}${also ? `, ${also}` : ''}` };
	return { ok: true, line: `${names} ${before} → ${version} - restart the server to load it` };
}
