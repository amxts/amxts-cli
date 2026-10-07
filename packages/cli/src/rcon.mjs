// rcon to the project's server: GoldSrc's, over UDP. A packet starts with four
// 0xFF; `challenge rcon` is answered with a number, and `rcon <number>
// "<password>" <command>` with what the command printed, an `l` after the
// 0xFFs, in as many packets as it takes.
//
// The server is the one AMXTS_SERVER names: on this machine (127.0.0.1), on
// AMXTS_PORT (27015 by default), with the rcon_password of its server.cfg -
// what the build reloads plugins with.
import { Buffer } from 'node:buffer';
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setting } from './core.mjs';
import { serverFolderOrNull } from './server.mjs';

const HEAD = Buffer.from([255, 255, 255, 255]);

/** A connectionless packet: four 0xFF, then the text. */
export function packet(text) {
	return Buffer.concat([HEAD, Buffer.from(`${text}\n`, 'latin1')]);
}

/** The text of a reply: after the four 0xFF and an `l` (a printed reply), without the trailing NULs. */
export function replyText(buffer) {
	if (buffer.length < 4 || !buffer.subarray(0, 4).equals(HEAD)) return '';
	return buffer.subarray(4).toString('latin1').replace(/^l/, '').replace(/\0+$/, '');
}

/** The rcon_password a server.cfg sets, or ''. */
export function cfgPassword(text) {
	return text.match(/^\s*rcon_password\s+"?([^"\r\n]*)"?/m)?.[1]?.trim() ?? '';
}

/**
 * @typedef {object} RconTarget
 * @property {string} host its address
 * @property {number} port its UDP port
 * @property {string} password '' when none is set
 * @property {string} cfg the server.cfg the password is read from, for the words
 */

/** The project's server as rcon reaches it; null without AMXTS_SERVER. */
export function rconTarget(root) {
	const server = serverFolderOrNull(setting(root, 'AMXTS_SERVER'));
	if (!server) return null;
	const cfg = join(server, '..', '..', 'server.cfg').replace(/\\/g, '/');
	return {
		host: '127.0.0.1',
		port: Number(setting(root, 'AMXTS_PORT') || 27015),
		password: existsSync(cfg) ? cfgPassword(readFileSync(cfg, 'utf8')) : '',
		cfg,
	};
}

/**
 * Sends one packet and collects what comes back until it goes quiet; null
 * when nothing does.
 */
function ask(socket, target, text, wait) {
	return new Promise((done) => {
		let reply = null;
		let timer;
		function finish() {
			clearTimeout(timer);
			socket.off('message', heard);
			socket.off('error', finish);
			done(reply);
		}
		function heard(buffer) {
			reply = (reply ?? '') + replyText(buffer);
			clearTimeout(timer);
			timer = setTimeout(finish, 150);
		}
		timer = setTimeout(finish, wait);
		socket.on('message', heard);
		// Windows answers a closed port with an error rather than silence.
		socket.once('error', finish);
		socket.send(packet(text), target.port, target.host);
	});
}

/**
 * Runs a command on the server: what it printed, or why it did not run -
 * `no answer` (the server is not running there) or `bad password`.
 * @param {RconTarget} target
 * @param {string} command
 * @returns {Promise<{ reply: string } | { error: 'no answer' | 'bad password' }>} the reply, or why there is none
 */
export async function rcon(target, command, wait = 2000) {
	const socket = createSocket('udp4');
	try {
		const challenge = (await ask(socket, target, 'challenge rcon', 1000))?.match(/challenge rcon (\d+)/)?.[1];
		if (!challenge) return { error: 'no answer' };
		const reply = await ask(socket, target, `rcon ${challenge} "${target.password}" ${command}`, wait);
		if (reply === null) return { error: 'no answer' };
		if (/^Bad rcon_password/i.test(reply)) return { error: 'bad password' };
		return { reply };
	} finally {
		socket.close();
	}
}

/**
 * What `status` and `stats` say of the server: its map, players and FPS.
 * @returns {{ map?: string, players?: number, max?: number, fps?: number }} what was found
 */
export function serverState(status, stats = '') {
	const map = /^map\s*:\s*(\S+)/m.exec(status)?.[1];
	const players = /^players\s*:\s*(\d+) active \((\d+) max\)/m.exec(status);
	// stats: a row of headings, then a row of numbers under them.
	const rows = stats.split('\n').map(line => line.trim().split(/\s+/));
	const at = rows.findIndex(row => row.includes('FPS'));
	const fps = at >= 0 ? Number(rows[at + 1]?.[rows[at].indexOf('FPS')]) : Number.NaN;
	return {
		map,
		players: players ? Number(players[1]) : undefined,
		max: players ? Number(players[2]) : undefined,
		fps: Number.isFinite(fps) ? fps : undefined,
	};
}

/**
 * The plugins `amxts_plugins` lists: `  name  state  about`.
 * @returns {{ name: string, state: string, about: string }[]} one per plugin
 */
export function pluginStates(reply) {
	return [...reply.matchAll(/^ {2}(\S+)\s+(running|unloaded|refused|waiting|loading)(?: +(\S.*))?$/gm)]
		.map(([, name, state, about = '']) => ({ name, state, about: about.trim() }));
}

/** The maps `maps *` lists, without `.bsp`. */
export function mapNames(reply) {
	return [...new Set([...reply.matchAll(/^\s*([\w.-]+)\.bsp\b/gim)].map(match => match[1]))].sort();
}
