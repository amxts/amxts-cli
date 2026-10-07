// A stand-in for a running server's rcon: it answers `challenge rcon`, checks
// the password and replies to the commands the panel and `amxts rcon` send,
// a long reply in two packets as the server sends one. Run alone, it listens
// on AMXTS_PORT (27015) with the password `secret`, until stopped.
import { Buffer } from 'node:buffer';
import { createSocket } from 'node:dgram';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HEAD = Buffer.from([255, 255, 255, 255]);

export const REPLIES = {
	'status': 'hostname:  amxts test\nversion :  48/1.1.2.7/Stdio 8684 secure  (10)\ntcp/ip  :  127.0.0.1:27015\nmap     :  de_dust2 at: 0 x, 0 y, 0 z\nplayers :  2 active (32 max)\n\n#      name userid uniqueid frag time ping loss adr\n2 users\n',
	'stats': 'CPU   In    Out   Uptime  Users   FPS    Players\n 1.00  0.00  0.00       5     1  999.50       2\n',
	'amxts_plugins': '[amxts] 2 plugin(s): 1 running, 0 unloaded, 1 refused\n  hello   running   Hello 1.0.0  by you\n  broken  refused   does not compile: hello.ts(3,1)\n',
	'maps *': 'Dir:  maps\nde_dust2.bsp\nde_inferno.bsp\ncs_office.bsp\n',
};

/**
 * Starts the stand-in on a port (0: any free one).
 * @returns {Promise<{ port: number, heard: string[], close: () => void }>} its port, the commands it ran, and how to stop it
 */
export function fakeServer({ password = 'secret', port = 0 } = {}) {
	const socket = createSocket('udp4');
	const heard = [];
	let map = 'de_dust2';
	const send = (text, to) => socket.send(Buffer.concat([HEAD, Buffer.from(text, 'latin1')]), to.port, to.address);
	socket.on('message', (packet, from) => {
		const text = packet.subarray(4).toString('latin1').trim();
		if (text === 'challenge rcon') return send('challenge rcon 4242\n\0', from);
		const match = /^rcon 4242 "([^"]*)" (.*)$/.exec(text);
		if (!match) return undefined;
		if (match[1] !== password) return send('lBad rcon_password.\n\0', from);
		heard.push(match[2]);
		const reload = /^amxts_reload (\S+)$/.exec(match[2]);
		// changelevel changes the map `status` says, and answers nothing - as the server does.
		map = /^changelevel (\S+)$/.exec(match[2])?.[1] ?? map;
		const reply = (REPLIES[match[2]] ?? (reload ? `[amxts] reloading ${reload[1]}\n[amxts] loaded ${reload[1]}.aot\n` : '')).replace('de_dust2 at', `${map} at`);
		// The second half comes in a packet of its own.
		const half = Math.ceil(reply.length / 2);
		send(`l${reply.slice(0, half)}\0`, from);
		return send(`l${reply.slice(half)}\0`, from);
	});
	return new Promise(done => socket.bind(port, '127.0.0.1', () => done({ port: socket.address().port, heard, close: () => socket.close() })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	// AMXTS_PORT=0 takes any free port: the line says which.
	void fakeServer({ port: Number(process.env.AMXTS_PORT ?? 27015) })
		.then(server => console.log(`fake server on 127.0.0.1:${server.port}, rcon_password secret`));
}
