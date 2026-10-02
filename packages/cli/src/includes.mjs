// The includes a project's build looks in besides its own includes/: the ones
// its server has. They serve what needs Pawn's declarations - a plugin's
// include contract, the natives and forwards of other Pawn plugins, a Pawn
// test suite - while the API itself comes generated with the core.
//
// - AMXTS_SERVER set, and addons/amxmodx/scripting/include beside it: the
//   build reads the server's own, exactly what is installed there. Nothing
//   is fetched.
// - Otherwise `target` in amxts.config.ts says which server the project is
//   for: "rehlds" (ReHLDS, ReGameDLL and ReAPI; the default) - ReAPI's
//   includes, fetched into .amxts/include from the release the core's API is
//   generated from (its cli-api's includeSources()), sha256 checked; "hlds" -
//   nothing to fetch, AMX Mod X's own includes come with the core.
//
// `amxts prepare` (after every install) and every build make sure of it;
// `amxts init` does it as it creates the project, and asks the target when no
// server is known. Everything here is plain Node - fetch and node:zlib - the
// same on Windows and Linux.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { inflateRawSync } from 'node:zlib';
import { readConfigTarget } from './config.mjs';
import { findProject, runTaskOrExit, setting } from './core.mjs';
import { serverFolderOrNull } from './server.mjs';
import { c, CliError, log } from './ui.mjs';

/** The servers a project can be for, as `target` in amxts.config.ts and `--target` name them. */
export const TARGETS = {
	rehlds: 'ReHLDS + ReGameDLL + ReAPI',
	hlds: 'plain HLDS',
};

/** Where the command puts the includes it fetches, in the project. */
export const FETCHED = '.amxts/include';

const STAMP = 'source.json';

/** The server's own includes: addons/amxmodx/scripting/include beside AMXTS_SERVER (addons/amxts), or null when it is not there. */
export function serverIncludes(server) {
	if (!server) return null;
	const dir = resolve(server, '..', 'amxmodx', 'scripting', 'include');
	return existsSync(dir) ? dir : null;
}

/** Which server a folder of includes is from: ReAPI's reapi.inc says rehlds. */
export function targetOf(includes) {
	return existsSync(join(includes, 'reapi.inc')) ? 'rehlds' : 'hlds';
}

/**
 * The files of a .zip, by their path inside it: stored and deflated
 * entries, which is what a release archive has.
 * @param {Uint8Array} zip
 * @returns {Map<string, Uint8Array>} the files
 */
export function unzip(zip) {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	let end = -1;
	for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xFFFF); at--) {
		if (view.getUint32(at, true) === 0x06054B50) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new Error('not a zip archive');
	const files = new Map();
	const decoder = new TextDecoder();
	let at = view.getUint32(end + 16, true);
	for (let i = view.getUint16(end + 10, true); i > 0; i--) {
		if (view.getUint32(at, true) !== 0x02014B50) throw new Error('a broken zip archive');
		const method = view.getUint16(at + 10, true);
		const size = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const local = view.getUint32(at + 42, true);
		const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
		if (name.endsWith('/')) continue;
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const data = zip.subarray(start, start + size);
		if (method === 0) files.set(name, data);
		else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(data)));
		else throw new Error(`${name}: compression method ${method}`);
	}
	return files;
}

/**
 * Downloads a source as the core pins it and gives its .inc files by name.
 * @param {{ name: string, version: string, url: string, sha256: string, include?: string }} source
 */
export async function fetchIncludes(source) {
	const hint = `Check the connection, then run amxts prepare - or set AMXTS_SERVER to a server with ${source.name}, whose own includes the build takes.`;
	let data;
	try {
		const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
		if (!response.ok) throw new Error(`${source.url} answered ${response.status}`);
		data = new Uint8Array(await response.arrayBuffer());
	} catch (error) {
		throw new CliError(`Could not download ${source.name} ${source.version}'s includes: ${error.message}`, hint);
	}
	const sha256 = createHash('sha256').update(data).digest('hex');
	if (sha256 !== source.sha256) {
		throw new CliError(`${source.name} ${source.version} from ${source.url} is not the file the core pins (sha256 ${sha256})`, 'The release was changed under the same URL; update @amxts/core, or set AMXTS_SERVER to use the server\'s own includes.');
	}
	const files = new Map();
	if (!source.url.endsWith('.zip')) {
		files.set(basename(new URL(source.url).pathname), data);
		return files;
	}
	for (const [path, content] of unzip(data)) {
		if (path.startsWith(source.include ?? '') && path.endsWith('.inc')) files.set(basename(path), content);
	}
	return files;
}

/**
 * @typedef {object} Includes
 * @property {'server' | 'fetched' | 'core'} from the server's own, fetched into .amxts/include, or AMX Mod X's that come with the core
 * @property {'rehlds' | 'hlds'} target the server they are for
 * @property {string | null} dir where they are
 * @property {string} [version] what was fetched: "ReAPI 5.26.0.338"
 * @property {boolean} [fetched] fetched just now
 */

/**
 * Makes sure the project has the includes of the server it is for, and says
 * where they are. A download that fails is a CliError that says what to do.
 * @param {import('./core.mjs').Core} core the project's core
 * @param {string} root the project's folder
 * @param {{ target?: string }} [options] the target, when the config is not written yet
 * @returns {Promise<Includes>} where the includes are
 */
export async function ensureIncludes(core, root, options = {}) {
	const own = serverIncludes(serverFolderOrNull(setting(root, 'AMXTS_SERVER')));
	if (own) return { from: 'server', target: targetOf(own), dir: own };

	const target = options.target ?? (await readConfigTarget(root)) ?? 'rehlds';
	const dir = join(root, FETCHED);
	if (target === 'hlds') {
		rmSync(dir, { recursive: true, force: true });
		return { from: 'core', target, dir: null };
	}
	const source = core.api.includeSources?.().reapi;
	if (!source) throw new CliError(`@amxts/core ${core.version} does not say which ReAPI release to fetch`, 'Update the core.');
	const version = `${source.name} ${source.version}`;
	const stamp = join(dir, STAMP);
	try {
		if (JSON.parse(readFileSync(stamp, 'utf8')).sha256 === source.sha256) return { from: 'fetched', target, dir, version };
	} catch {}

	const files = await fetchIncludes(source);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of files) writeFileSync(join(dir, name), content);
	writeFileSync(stamp, `${JSON.stringify({ name: source.name, version: source.version, license: source.license, home: source.home, sha256: source.sha256 }, null, '\t')}\n`);
	return { from: 'fetched', target, dir, version, fetched: true };
}

/**
 * What `amxts prepare` does, and dev, build and typecheck first: the
 * server's includes, then the core's prepare task (the editor config). An
 * include that cannot be fetched is a warning - the build needs one only
 * where a plugin names it, and says so there. `quiet`, for a command that
 * says what the project is itself (dev, build, typecheck): the core's line
 * about the editor config only with --debug.
 * @param {import('./core.mjs').Core} core the project's core
 * @param {{ quiet?: boolean }} [options]
 */
export async function prepare(core, { quiet = false } = {}) {
	const root = findProject() ?? process.cwd();
	try {
		const includes = await ensureIncludes(core, root);
		if (includes.fetched) log.success(`Fetched ${includes.version}'s includes ${c.dim(`(${FETCHED})`)}`);
	} catch (error) {
		if (!(error instanceof CliError)) throw error;
		log.warn(error.message);
		if (error.hint) log.hint(error.hint);
	}
	runTaskOrExit(core, 'prepare', quiet ? ['--quiet'] : []);
}
