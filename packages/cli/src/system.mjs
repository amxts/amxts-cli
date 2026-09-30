// Which system a project's server runs, Windows or Linux: the build compiles
// each plugin in that system's object format, and a plugin built for one does
// not load on the other.
//
// The build decides it (the core's `serverSystem()`, through cli-api): --os,
// AMXTS_SERVER_OS in .env, what the AMXTS_SERVER folder holds, this machine.
// `amxts init` needs it before a core is installed, so it reads the server's
// folder the same way here - hlds_linux or hlds.exe beside the game - and
// asks when there is nothing to read.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

/** The systems, as `--os` and AMXTS_SERVER_OS name them. */
export const SYSTEMS = { windows: 'Windows', linux: 'Linux' };

/** This machine's system. */
export const HOST_SYSTEM = process.platform === 'win32' ? 'windows' : 'linux';

/**
 * What the server's files say it runs, or null: `server` is its addons/amxts,
 * so hlds is three folders up.
 * @param {string} server
 * @returns {'windows' | 'linux' | null} the system, or null
 */
export function serverSystemOf(server) {
	if (!server) return null;
	const hlds = resolve(server, '..', '..', '..');
	if (existsSync(join(hlds, 'hlds_linux'))) return 'linux';
	if (existsSync(join(hlds, 'hlds.exe'))) return 'windows';
	return null;
}
