// What `amxts dev` stands on: the banner's colour and drawing, one dev per
// project (the lock), rcon against a stand-in server, and the panel's reading
// of what the core's build prints.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { CLI_API } from '../packages/cli/src/core.mjs';
import { createFeed } from '../packages/cli/src/dev-feed.mjs';
import { bar, buildPart, buildProgress, errorBlock, fit, highlight, latin, panelLines, pluginLines, runPart, serverName, took, wantsPanel } from '../packages/cli/src/dev-panel.mjs';
import { lockPath, takeLock } from '../packages/cli/src/lock.mjs';
import { cfgPassword, mapNames, packet, pluginStates, rcon, replyText, serverState } from '../packages/cli/src/rcon.mjs';
import { badge, bannerText, editorLink, link, LOGO, logoGlyphs, logoLines, logoPaint } from '../packages/cli/src/ui.mjs';
import { updateLine } from '../packages/cli/src/update-check.mjs';
import { fakeServer, REPLIES } from './fake-server.mjs';
import { amxts, CORE, inTemp, serverOf, standInProject } from './helpers';

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\x1B\[[\d;]*m/g, '');

describe('the banner', () => {
	test('amxts yellow in 24 bits, plain yellow in 16 colours, none without a terminal, in CI or with NO_COLOR', () => {
		const tty = true;
		expect(logoPaint({ tty, env: { COLORTERM: 'truecolor' }, depth: 4 })('{•}')).toBe('\x1B[38;2;242;201;76m{•}\x1B[39m');
		expect(logoPaint({ tty, env: {}, depth: 24 })('{•}')).toBe('\x1B[38;2;242;201;76m{•}\x1B[39m');
		expect(logoPaint({ tty, env: {}, depth: 4 })('{•}')).toBe('\x1B[33m{•}\x1B[39m');
		expect(logoPaint({ tty: false, env: {}, depth: 24 })('{•}')).toBe('{•}');
		expect(logoPaint({ tty, env: { CI: 'true' }, depth: 24 })('{•}')).toBe('{•}');
		expect(logoPaint({ tty, env: { CI: 'false' }, depth: 4 })('{•}')).toBe('\x1B[33m{•}\x1B[39m');
		expect(logoPaint({ tty, env: { NO_COLOR: '' }, depth: 24 })('{•}')).toBe('{•}');
		expect(logoPaint({ tty: false, env: { FORCE_COLOR: '1' }, depth: 4 })('{•}')).toBe('\x1B[33m{•}\x1B[39m');
		expect(badge('READY', 'ready', { tty, env: {}, depth: 24 })).toBe('\x1B[1;48;2;242;201;76;38;2;21;24;29m READY \x1B[0m');
		expect(badge('READY', 'ready', { tty: false, env: {}, depth: 24 })).toBe('[READY]');
	});

	test('a link opens a file at its line in the editor: VS Code\'s, or Cursor\'s', () => {
		expect(editorLink('D:\\my server\\plugins\\hello.ts', 3, 26, {})).toBe('vscode://file/D:/my%20server/plugins/hello.ts:3:26');
		expect(editorLink('/home/me/hello.ts', 3, 26, { TERM_PROGRAM: 'cursor' })).toBe('cursor://file/home/me/hello.ts:3:26');
		expect(editorLink(join(process.cwd(), 'hello.ts'), 3, 26, { TERM_PROGRAM: 'Orca' })).toBe(`${pathToFileURL(join(process.cwd(), 'hello.ts')).href}:3:26`);
		expect(link('hello.ts:3:26', 'vscode://file/x', { tty: true, env: {}, depth: 24 })).toBe('\x1B]8;;vscode://file/x\x1B\\hello.ts:3:26\x1B]8;;\x1B\\');
		expect(link('hello.ts:3:26', 'vscode://file/x', { tty: false, env: {}, depth: 24 })).toBe('hello.ts:3:26');
	});

	test('the logo in braille dots where the font has them, {•} in Windows\' own console, {*} where the text is not UTF-8', () => {
		expect(logoGlyphs({ WT_SESSION: 'x' }, 'win32')).toBe('box');
		expect(logoGlyphs({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe('box');
		expect(logoGlyphs({}, 'win32')).toBe('bullet');
		expect(logoGlyphs({ LANG: 'en_US.UTF-8' }, 'linux')).toBe('box');
		expect(logoGlyphs({ LANG: 'en_US.UTF-8', TERM: 'linux' }, 'linux')).toBe('bullet');
		expect(logoGlyphs({ LANG: 'C' }, 'linux')).toBe('ascii');
		const where = { tty: false, env: {}, depth: 4 };
		expect(plain(bannerText('0.2.4', 'dev', { logo: true, glyphs: 'box', where }))).toBe([LOGO[0], `${LOGO[1]}   amxts 0.2.4 · dev`, LOGO[2], LOGO[3]].join('\n'));
		expect(plain(bannerText('0.2.4', 'dev', { logo: true, glyphs: 'bullet', where }))).toBe('{•} amxts 0.2.4 · dev');
		expect(plain(bannerText('0.2.4', 'build', { glyphs: 'box', where }))).toBe('{•} amxts 0.2.4 · build');
		expect(plain(bannerText('0.2.4', 'build', { glyphs: 'ascii', where }))).toBe('{*} amxts 0.2.4 · build');
	});
});

describe('one amxts dev per project', () => {
	/** A process that holds the project's lock as a dev would: its script is `holder.mjs`. */
	function holder(dir: string) {
		const script = join(dir, 'holder.mjs');
		writeFileSync(script, 'setInterval(() => {}, 1000);\n');
		const child = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [script], { stdio: 'ignore' });
		mkdirSync(join(dir, '.amxts'), { recursive: true });
		writeFileSync(lockPath(dir), JSON.stringify({ pid: child.pid, since: '2026-10-07T10:00:00.000Z', script }));
		return { child, script };
	}

	/** A folder for an async test, removed after it. */
	async function inTempAsync(body: (dir: string) => Promise<void>) {
		const dir = mkdtempSync(join(tmpdir(), 'amxts-cli-'));
		try {
			await body(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	test('a second one is refused, with where the first runs', () => inTempAsync(async (dir) => {
		const { child } = holder(dir);
		try {
			await new Promise(done => setTimeout(done, 300));
			expect(() => takeLock(dir, { script: 'other.mjs' })).toThrow(`amxts dev is already running in another terminal (pid ${child.pid}, since `);
			expect(JSON.parse(readFileSync(lockPath(dir), 'utf8')).pid).toBe(child.pid);
		} finally {
			child.kill();
		}
	}), 30_000);

	test('--takeover stops the first, read by its command line, and takes the lock', () => inTempAsync(async (dir) => {
		const { child } = holder(dir);
		const exited = new Promise(done => child.on('exit', done));
		await new Promise(done => setTimeout(done, 300));
		const said: string[] = [];
		takeLock(dir, { takeover: true, script: 'other.mjs', say: line => said.push(line) });
		await exited;
		expect(said[0]).toContain(`(pid ${child.pid})`);
		expect(JSON.parse(readFileSync(lockPath(dir), 'utf8')).pid).toBe(process.pid);
	}), 30_000);

	test('a lock whose process is gone, or is another program now, is taken over quietly', () => {
		inTemp((dir) => {
			mkdirSync(join(dir, '.amxts'));
			// A pid nobody has, then the process that runs the tests, which is not that script.
			for (const pid of [2 ** 22 + 7, process.ppid]) {
				writeFileSync(lockPath(dir), JSON.stringify({ pid, since: '2026-10-07T10:00:00.000Z', script: join(dir, 'gone', 'amxts.mjs') }));
				expect(() => takeLock(dir, { script: 'mine.mjs' })).not.toThrow();
			}
			expect(JSON.parse(readFileSync(lockPath(dir), 'utf8')).script).toBe('mine.mjs');
		});
	});
});

describe('rcon', () => {
	test('a packet is four 0xFF and the text; a reply loses them, its `l` and its NULs', () => {
		expect([...packet('challenge rcon')]).toEqual([255, 255, 255, 255, ...Buffer.from('challenge rcon\n')]);
		expect(replyText(Buffer.from([255, 255, 255, 255, ...Buffer.from('lhello\n\0\0')]))).toBe('hello\n');
		expect(replyText(Buffer.from('no head'))).toBe('');
		expect(cfgPassword('hostname "x"\n  rcon_password "se cret"\r\nsv_lan 1')).toBe('se cret');
		expect(cfgPassword('rcon_password plain')).toBe('plain');
		expect(cfgPassword('// rcon_password "x"')).toBe('');
	});

	test('a command runs over the challenge, its reply joined from its packets; a wrong password and no server are said', async () => {
		const server = await fakeServer();
		try {
			const target = { host: '127.0.0.1', port: server.port, password: 'secret', cfg: 'server.cfg' };
			expect(await rcon(target, 'status')).toEqual({ reply: REPLIES.status });
			expect(server.heard).toEqual(['status']);
			expect(await rcon({ ...target, password: 'wrong' }, 'status')).toEqual({ error: 'bad password' });
		} finally {
			server.close();
		}
		const closed = await fakeServer();
		closed.close();
		expect(await rcon({ host: '127.0.0.1', port: closed.port, password: 'secret', cfg: '' }, 'status', 300)).toEqual({ error: 'no answer' });
	});

	test('the server\'s map, players and FPS; each plugin\'s state; the maps', () => {
		expect(serverState(REPLIES.status, REPLIES.stats)).toEqual({ map: 'de_dust2', players: 2, max: 32, fps: 999.5 });
		expect(serverState('')).toEqual({ map: undefined, players: undefined, max: undefined, fps: undefined });
		expect(pluginStates(REPLIES.amxts_plugins)).toEqual([
			{ name: 'hello', state: 'running', about: 'Hello 1.0.0  by you' },
			{ name: 'broken', state: 'refused', about: 'does not compile: hello.ts(3,1)' },
		]);
		expect(mapNames(REPLIES['maps *'])).toEqual(['cs_office', 'de_dust2', 'de_inferno']);
	});

	test('amxts rcon prints the reply, --json wraps it, and an error is not exit code 0', async () => {
		// In a process of its own: the command runs while this one waits for it.
		const server = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [join(import.meta.dir, 'fake-server.mjs')], { env: { ...process.env, AMXTS_PORT: '0' } });
		try {
			const port = await new Promise<string>(done => server.stdout.on('data', data => done(/:(\d+),/.exec(String(data))![1])));
			inTemp((dir) => {
				standInProject(dir, CORE, CLI_API);
				const cfg = join(serverOf(dir), '..', '..', 'server.cfg');
				const env = { AMXTS_PORT: port };
				expect(amxts(['rcon', 'status'], dir, env)).toEqual({ code: 1, out: `✖ rcon is not set up: no rcon_password in ${cfg.replace(/\\/g, '/')}\n  Add a line  rcon_password "something"  to it and restart the server.\n` });
				writeFileSync(cfg, 'rcon_password "secret"\n');
				expect(amxts(['rcon', 'amxts_plugins'], dir, env)).toEqual({ code: 0, out: REPLIES.amxts_plugins });
				const json = amxts(['rcon', 'stats', '--json'], dir, env);
				expect(json.code).toBe(0);
				expect(JSON.parse(json.out)).toEqual({ server: `127.0.0.1:${port}`, command: 'stats', reply: REPLIES.stats });
				writeFileSync(cfg, 'rcon_password "wrong"\n');
				expect(amxts(['rcon', 'status', '--json'], dir, env).code).toBe(1);
				expect(amxts(['rcon', 'status'], dir, env).out).toContain('✖ The server refused the rcon_password of');
			});
		} finally {
			server.kill();
		}
	}, 60_000);
});

/** What the core's build prints in a dev run: the start, a save, a failed save, a save that fixes it. */
const RECORDED = [
	'',
	'  Core      @amxts/core 0.2.4',
	'  Modules   menu-core 0.2.1 · config-core 0.2.0 \x1B[2m(for menu-core)\x1B[22m',
	'  Server    D:/hlds/cstrike/addons/amxts · Windows · ReHLDS · running',
	'  Plugins   2 in plugins/',
	'',
	'\x1B[36m◇\x1B[39m compiling \x1B[1mhello\x1B[22m \x1B[2m1/2\x1B[22m',
	'\x1B[36m◇\x1B[39m compiling \x1B[1mbye\x1B[22m \x1B[2m2/2\x1B[22m',
	'\x1B[32m✔\x1B[39m \x1B[1mbye\x1B[22m \x1B[2m· 4.1s\x1B[22m',
	'\x1B[32m✔\x1B[39m \x1B[1mhello\x1B[22m \x1B[2m· 6.5s\x1B[22m',
	'\x1B[36mi\x1B[39m new plugin \x1B[1mbye\x1B[22m: added to plugins.ini',
	'\x1B[32m✔\x1B[39m \x1B[2m12:27:33\x1B[22m deployed, the server reloaded \x1B[1mhello, bye\x1B[22m \x1B[2m(7.2s)\x1B[22m',
	'\x1B[36m◇\x1B[39m watching \x1B[36mplugins\x1B[39m - save a plugin and it goes to the server \x1B[2m(Ctrl+C stops)\x1B[22m',
];
const SAVED = [
	'\x1B[36m◇\x1B[39m compiling \x1B[1mhello\x1B[22m \x1B[2m1/1\x1B[22m',
	'\x1B[32m✔\x1B[39m \x1B[1mhello\x1B[22m \x1B[2m· 6.1s\x1B[22m',
	'\x1B[32m✔\x1B[39m \x1B[2m12:32:32\x1B[22m plugins/hello.ts changed: deployed, the server reloaded \x1B[1mhello\x1B[22m \x1B[2m(6.6s)\x1B[22m',
];
const BROKEN = [
	'\x1B[36m◇\x1B[39m compiling \x1B[1mhello\x1B[22m \x1B[2m1/1\x1B[22m',
	'\x1B[31m✖\x1B[39m \x1B[1mhello\x1B[22m does not compile:',
	'plugins/hello.ts:3:26 - TS2322 Type \'~lib/string/String\' is not assignable to type \'f64\'.',
	' 3 │ const greeting: number = "Hi";',
	'   │                          ~~~~',
	'  \x1B[2mThe server keeps the last good build.\x1B[22m',
];

describe('the panel', () => {
	test('reads the start: the header, what compiles, the deploy, watching', () => {
		const feed = createFeed();
		const kinds = RECORDED.map(line => feed.push(line));
		expect(kinds).toEqual([null, 'header', 'header', 'header', 'header', null, 'compiling', 'compiling', 'compiled', 'compiled', null, 'rebuilt', 'watching']);
		expect(feed.count).toBe(2);
		expect(feed.header.Server).toBe('D:/hlds/cstrike/addons/amxts · Windows · ReHLDS · running');
		expect(feed.last).toEqual({ files: [], plugins: ['hello', 'bye'], compile: 6.5, total: 7.2, outcome: 'deployed, the server reloaded hello, bye', reloaded: true, at: '12:27:33' });
		expect(feed.counts()).toEqual({ built: 2, failed: 0 });
		expect(feed.watching).toBe(true);
	});

	test('reads a save, an error and its lines, then the save that fixes it', () => {
		const feed = createFeed();
		for (const line of [...RECORDED, ...SAVED]) feed.push(line);
		expect(feed.last).toMatchObject({ files: ['plugins/hello.ts'], plugins: ['hello'], compile: 6.1, total: 6.6, reloaded: true });
		for (const line of BROKEN) feed.push(line);
		expect(feed.broken).toBe(true);
		expect(feed.error).toEqual(['hello does not compile:', 'plugins/hello.ts:3:26 - TS2322 Type \'~lib/string/String\' is not assignable to type \'f64\'.', ' 3 │ const greeting: number = "Hi";', '   │                          ~~~~', '  The server keeps the last good build.']);
		expect(feed.counts()).toEqual({ built: 1, failed: 1 });
		for (const line of SAVED) feed.push(line);
		expect(feed.broken).toBe(false);
		expect(feed.counts()).toEqual({ built: 2, failed: 0 });
	});

	test('reads what a deploy without a server, or without a reload, says', () => {
		const feed = createFeed();
		feed.push('✔ deployed hello - the server is not running (16.8s)');
		expect(feed.last).toMatchObject({ plugins: ['hello'], compile: undefined, reloaded: false, outcome: 'deployed hello - the server is not running', at: '' });
		feed.push('✔ 1:02:03 PM built hello, bye into dist (2.0s)');
		expect(feed.last).toMatchObject({ plugins: ['hello', 'bye'], at: '1:02:03 PM' });
		feed.push('✔ hello not deployed: there is no D:/x (1.0s)');
		expect(feed.last?.plugins).toEqual(['hello']);
	});

	test('shows the server, the plugins, the last rebuild, the state and the keys', () => {
		const feed = createFeed();
		for (const line of [...RECORDED, ...SAVED]) feed.push(line);
		const where = { tty: false, env: {}, depth: 4 };
		const state = { feed, server: { status: 'up', map: 'de_dust2', players: 2, max: 32, fps: 999.5 }, deployTo: 'D:/hlds/cstrike/addons/amxts', choosing: false, input: '', maps: ['cs_office', 'de_dust2', 'de_inferno'], players: 2, title: 'amxts 0.2.4 · dev', where, glyphs: 'box' };
		expect(panelLines(state).map(plain)).toEqual([
			'',
			`${LOGO[0]}   amxts 0.2.4 · dev`,
			`${LOGO[1]}   server   de_dust2 · 2/32 players · 1000 fps · D:/hlds`,
			`${LOGO[2]}   plugins  ✔ 2 built  ✖ 0 failed · 2 in the project`,
			`${LOGO[3]}   last     plugins/hello.ts → hello · compile 6.1s · deploy 0.5s · reloaded on the server, 2 players kept · 12:32:32`,
			'',
			'✔ [READY] watching for changes',
			'r rebuild · p plugins · l log · e last error · c clear · m map · R round · o docs · ? help · q quit',
		]);
		for (const line of BROKEN) feed.push(line);
		const broken = panelLines({ ...state, server: { status: 'unset', cfg: 'D:/hlds/cstrike/server.cfg' }, choosing: true, input: 'de_', glyphs: 'bullet' }).map(plain);
		// As tall as ever: a panel that changes its height would move the log.
		expect(broken).toHaveLength(8);
		expect(broken.slice(1, 3)).toEqual(['      amxts 0.2.4 · dev', '{•}   server   rcon is not set up: no rcon_password in D:/hlds/cstrike/server.cfg · D:/hlds']);
		expect(broken[6]).toBe('✖ [ERROR] hello does not compile: · e shows it · the server keeps the last good build');
		expect(broken[7]).toBe('map de_█  de_dust2 de_inferno · Enter changes it · Esc cancels');
		// A view takes the panel's place, as tall: the help, the plugins, the error.
		const help = panelLines({ ...state, view: '?' }).map(plain);
		expect(help).toHaveLength(8);
		expect(help[1]).toBe(`  r  ${'build every plugin again, deploy it'.padEnd(36)}  m  ${'change the map'.padEnd(36)}`);
		expect(help[7]).toBe('? or Esc closes the help');
		const plugins = panelLines({ ...state, view: 'p', states: pluginStates(REPLIES.amxts_plugins) }).map(plain);
		expect(plugins).toEqual(['', '  hello   running  Hello 1.0.0  by you', '  broken  refused  does not compile: hello.ts(3,1)', '', '', '', '', 'p or Esc closes the plugins']);
		const error = panelLines({ ...state, view: 'e' }).map(plain);
		expect(error.slice(1, 6)).toEqual([
			'  ✖ hello does not compile',
			'    Type \'string\' is not assignable to type \'number\'.  TS2322',
			'    plugins/hello.ts:3:26',
			'    ❯ 3 │ const greeting: number = "Hi";',
			'        │                          ~~~~',
		]);
		expect(panelLines({ ...state, feed: createFeed(), view: 'e' }).map(plain)[1]).toBe('  ✔ no error since dev started');
	});

	test('an error is a block: what does not compile, the message in TypeScript\'s words, the place, the source around it', () => {
		const feed = createFeed();
		for (const line of BROKEN) feed.push(line);
		const source = ['plugin({ name: "Hello" });', '', 'const greeting: number = "Hi";', 'server.addCommand("/hp");'];
		expect(errorBlock(feed.error, { read: () => source }).map(plain)).toEqual([
			'✖ hello does not compile',
			'',
			'  Type \'string\' is not assignable to type \'number\'.  TS2322',
			'  plugins/hello.ts:3:26',
			'    2 │ ',
			'  ❯ 3 │ const greeting: number = "Hi";',
			'      │                          ~~~~',
			'    4 │ server.addCommand("/hp");',
			'',
			'  The server keeps the last good build.',
		]);
		// The file gone: the line the core showed; an error of another shape as it came.
		expect(errorBlock(feed.error, { read: () => [] }).map(plain)[4]).toBe('  ❯ 3 │ const greeting: number = "Hi";');
		expect(errorBlock(['AMXTS_SERVER is not set', '  set it in .env']).map(plain)).toEqual(['✖ AMXTS_SERVER is not set', '  set it in .env']);
		const code = 'const greeting: number = "Hi"; // 1 `two` Menu';
		expect(plain(highlight(code))).toBe(code);
	});

	test('the map changing has its bar, by the time the last change took', () => {
		const feed = createFeed();
		for (const line of RECORDED) feed.push(line);
		const state = { feed, server: { status: 'up' }, deployTo: '', choosing: false, input: '', maps: [], changing: { map: 'de_inferno', since: Date.now() - 1000 }, mapTime: 2, where: { tty: false, env: {}, depth: 4 }, glyphs: 'ascii' };
		expect(plain(panelLines(state)[6])).toMatch(/^\S \[MAP\] changing to de_inferno {2}={24} 5\d% · 1\.\ds$/);
	});

	test('a light runs across the logo while a build runs, in 24 bits only', () => {
		const truecolor = { tty: true, env: {}, depth: 24 };
		const still = logoLines(null, { glyphs: 'box', where: truecolor });
		expect(still[0]).toBe(`\x1B[38;2;242;201;76m${LOGO[0]}\x1B[39m`);
		const lit = logoLines(0, { glyphs: 'box', where: truecolor });
		expect(lit[0].startsWith('\x1B[38;2;255;236;150m')).toBe(true);
		expect(lit.map(plain)).toEqual(LOGO);
		expect(logoLines(0, { glyphs: 'box', where: { tty: true, env: {}, depth: 4 } })[0]).toBe(`\x1B[33m${LOGO[0]}\x1B[39m`);
	});

	test('p prints each plugin: the server\'s states, else the build\'s', () => {
		const feed = createFeed();
		for (const line of [...RECORDED, ...BROKEN]) feed.push(line);
		expect(pluginLines(pluginStates(REPLIES.amxts_plugins), feed).map(plain)).toEqual(['  hello   running  Hello 1.0.0  by you', '  broken  refused  does not compile: hello.ts(3,1)']);
		expect(pluginLines([], feed).map(plain)).toEqual(['  hello  failed   the server does not say: rcon', '  bye    built    the server does not say: rcon']);
		expect(pluginLines([], createFeed()).map(plain)).toEqual(['  no plugin built yet']);
	});

	test('a key works in the Russian layout too; the server is named by its folder, shortened', () => {
		expect(['к', 'з', 'д', 'у', 'с', 'ь', 'К', 'щ', ',', 'й', 'r', 'R'].map(latin)).toEqual(['r', 'p', 'l', 'e', 'c', 'm', 'R', 'o', '?', 'q', 'r', 'R']);
		expect(serverName('D:/hlds/cstrike/addons/amxts')).toBe('D:/hlds');
		expect(serverName('C:/Users/me/servers/hns/cstrike/addons/amxts')).toBe('…/servers/hns');
		expect(serverName('/srv/hlds/addons/amxts/')).toBe('/srv/hlds');
	});

	test('a build\'s bar: the plugins done, or the time so far against the last compile, short of done', () => {
		const since = Date.parse('2026-10-07T12:00:00Z');
		expect(buildPart({ done: 0, total: 1, since }, 6, since + 3000)).toBe(0.5);
		expect(buildPart({ done: 0, total: 1, since }, 6, since + 60_000)).toBe(0.95);
		expect(buildPart({ done: 1, total: 2, since }, 6, since + 600)).toBe(0.5);
		expect(buildPart({ done: 2, total: 2, since }, 6, since)).toBe(0.95);
		expect(plain(bar(0.5, 4))).toBe('====');
		expect([took(321), took(3100)]).toEqual(['321ms', '3.1s']);
		expect(runPart({ total: 0.7, boot: 1.3 }, since, since + 1000)).toBe(0.5);
		expect(runPart(null, since, since + 5000)).toBe(0.5);
		expect(runPart({ total: 1 }, since, since + 9000)).toBe(0.95);
		// One bar for a build: what comes before the compile fills it by the time, the compile the rest - never back.
		const feed = createFeed();
		const before = buildProgress({ part: 0, base: null }, feed, since, since + 5000);
		expect(before.part).toBe(0.5);
		feed.push('◇ compiling hello 1/1');
		feed.building!.since = since + 5000;
		const compiling = buildProgress(before, feed, since, since + 5000);
		expect(compiling).toEqual({ part: 0.5, base: 0.5 });
		expect(buildProgress(compiling, feed, since, since + 10_000).part).toBeCloseTo(0.5 + 0.45 * (0.5 / 0.95));
		feed.push('✔ deployed, the server reloaded hello (6.0s)');
		feed.push('◇ watching plugins');
		expect(buildProgress(compiling, feed, since)).toEqual({ part: 0, base: null });
	});

	test('a line is cut to the window with its colours closed; the panel only in a big enough terminal', () => {
		expect(fit('\x1B[1mabcdef\x1B[22m', 4)).toBe('\x1B[1mabc…\x1B[0m');
		expect(fit('abc', 4)).toBe('abc');
		const terminal = { isTTY: true, columns: 120, rows: 40 };
		expect(wantsPanel({ env: {}, stdout: terminal, stdin: terminal })).toBe(true);
		expect(wantsPanel({ tui: false, env: {}, stdout: terminal, stdin: terminal })).toBe(false);
		expect(wantsPanel({ env: { AMXTS_TUI: 'plain' }, stdout: terminal, stdin: terminal })).toBe(false);
		expect(wantsPanel({ env: { CI: 'true' }, stdout: terminal, stdin: terminal })).toBe(false);
		expect(wantsPanel({ env: {}, stdout: { ...terminal, rows: 10 }, stdin: terminal })).toBe(false);
		expect(wantsPanel({ env: {}, stdout: { isTTY: false }, stdin: terminal })).toBe(false);
	});
});

describe('the update line', () => {
	test('a newer core is said from the last check, which runs once a day, in a terminal only', () => {
		inTemp((dir) => {
			const file = join(dir, 'update.json');
			const checks: string[] = [];
			const check = (at: string) => checks.push(at);
			const now = Date.parse('2026-10-07T12:00:00Z');
			expect(updateLine('0.2.4', 'npm', { env: {}, tty: true, now, file, check })).toBeNull();
			expect(checks).toEqual([file]);
			writeFileSync(file, JSON.stringify({ checked: now, latest: '0.2.5' }));
			expect(updateLine('0.2.4', 'npm', { env: {}, tty: true, now: now + 1000, file, check })).toBe('amxts 0.2.5 is out: npx amxts upgrade');
			expect(updateLine('0.2.5', 'npm', { env: {}, tty: true, now, file, check })).toBeNull();
			expect(checks).toHaveLength(1);
			expect(updateLine('0.2.4', 'pnpm', { env: {}, tty: true, now: now + 25 * 60 * 60 * 1000, file, check })).toBe('amxts 0.2.5 is out: pnpm amxts upgrade');
			expect(checks).toHaveLength(2);
			for (const off of [{ env: { AMXTS_IGNORE_UPDATE_CHECK: '1' }, tty: true }, { env: {}, tty: false }, { env: { CI: 'true' }, tty: true }]) {
				expect(updateLine('0.2.4', 'npm', { ...off, now: now + 99 * 60 * 60 * 1000, file, check })).toBeNull();
			}
			expect(checks).toHaveLength(2);
			expect(existsSync(file)).toBe(true);
		});
	});
});
