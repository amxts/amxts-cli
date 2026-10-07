// `amxts dev` in a terminal: the build's lines scroll, and a panel stays on
// the window's last rows - the server, the plugins, the last rebuild, the
// state and the keys. The build is the core's task, its output read through
// dev-feed.mjs; the server is asked over rcon (rcon.mjs).
//
// Drawn with plain ANSI: the rows above the panel are the terminal's
// scrolling region, where the lines go and scroll into its history; the panel
// is written at the bottom rows by their numbers.
//
// Without a terminal, in CI, in a small window, with --no-tui or
// AMXTS_TUI=plain, dev prints the build's lines as they come (main.mjs).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { startTask } from './core.mjs';
import { createFeed, plain } from './dev-feed.mjs';
import { stopTree } from './lock.mjs';
import { mapNames, pluginStates, rcon, serverState } from './rcon.mjs';
import { badge, c, editorLink, isCI, link, logoGlyphs, logoLines, logoPaint, vivid } from './ui.mjs';

/** The page `o` opens. */
export const DOCS = 'https://amxts.github.io/docs/getting-started/cli#dev';
/** How often the server is asked how it is, in ms. */
const POLL = 10_000;
/** The build's lines kept for `l`. */
const HISTORY = 2000;

const KEYS = [
	['r', 'rebuild', 'build every plugin again, deploy it'],
	['p', 'plugins', 'each plugin\'s state on the server'],
	['l', 'log', 'the build\'s lines, each compile too'],
	['e', 'last error', 'the last error again'],
	['c', 'clear', 'clear the screen'],
	['m', 'map', 'change the map'],
	['R', 'round', 'restart the round (sv_restart 1)'],
	['o', 'docs', 'open the docs in the browser'],
	['?', 'help', 'this help: ? or Esc closes it'],
	['q', 'quit', 'stop dev (Ctrl+C too)'],
];

// The Russian layout's letters as the keys they sit on: `к` is `r`, `К` is `R`,
// `,` (Shift+/ there) is `?` - a key works whichever layout is on.
const RU = 'йцукенгшщзхъфывапролджэячсмитьбю';
const EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
const LAYOUT = new Map([...RU].flatMap((letter, index) => [[letter, EN[index]], [letter.toUpperCase(), EN[index].toUpperCase()]]));
LAYOUT.set(',', '?');

/** A typed character as the key it is on a Latin layout. */
export function latin(text) {
	return LAYOUT.get(text) ?? text;
}

// The compiler's names for types a plugin writes in TypeScript's words, where
// one stands for one only. The core's messages are the compiler's; this is
// the panel's reading of them until the core says them itself.
const TYPE_NAMES = [[/~lib\/string\/String/g, 'string'], [/'f64'/g, '\'number\''], [/'bool'/g, '\'boolean\'']];

// What a line of TypeScript is made of, as an error shows it: a comment,
// a string, a keyword, a number, a type.
const TOKENS = /(\/\/.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|default|new|class|extends|implements|interface|type|enum|true|false|null|undefined|typeof|instanceof|as|async|await|of|in|this|throw|try|catch|finally)\b|\b(\d+(?:\.\d+)?)\b|\b(number|string|boolean|void|any|never|unknown|[A-Z]\w*)\b/g;

/** A line of source in colours: keywords magenta, strings green, numbers yellow, types cyan, comments dim. */
export function highlight(line) {
	return line.replace(TOKENS, (token, comment, text, keyword, number) => {
		if (comment) return c.dim(token);
		if (text) return c.green(token);
		if (keyword) return c.magenta(token);
		if (number) return c.yellow(token);
		return c.cyan(token);
	});
}

/** The lines of a source file, or none when it cannot be read. */
function sourceLines(file) {
	try {
		return readFileSync(file, 'utf8').split(/\r?\n/);
	} catch {
		return [];
	}
}

/**
 * The last error as the panel shows it: what does not compile in bold, then
 * each problem - its message in TypeScript's words with its code, the place,
 * and the source with a line around it (`context`), the part at fault red -
 * then what the build adds. The core's lines (`file:line:col - CODE message`,
 * the source line, `~` under it) are read here; an error of another shape is
 * shown as it came.
 * @param {string[]} lines the error's lines, without colours: feed.error
 * @param {{ context?: number, brief?: boolean, read?: (file: string) => string[] }} [options] lines of source around; `brief` - no blank lines, nothing the build adds (for `e`); how a file is read
 * @returns {string[]} the lines to show
 */
export function errorBlock(lines, { context = 1, brief = false, read = sourceLines } = {}) {
	const shaped = lines.some(line => line.endsWith(' does not compile:') || /^\S+:\d+:\d+ - \w+ /.test(line));
	if (!shaped) return [`${c.red('✖')} ${lines[0] ?? ''}`, ...lines.slice(1)];
	const out = [];
	let problem = null;
	const flush = () => {
		if (!problem) return;
		const { file, row, col, code, message, snippet, width } = problem;
		const source = read(file);
		const at = Number(row);
		const text = source[at - 1] ?? snippet;
		const from = Number(col) - 1;
		const rows = [...Array.from({ length: context }, (_, index) => at - context + index), at, ...Array.from({ length: context }, (_, index) => at + 1 + index)]
			.filter(number => number === at || source[number - 1] !== undefined);
		const gutter = String(Math.max(...rows)).length;
		const numbered = number => `${c.dim(`${String(number).padStart(gutter)} │`)}`;
		// The place opens the file at it in the editor, where the terminal takes links.
		out.push(`  ${c.bold(message)}  ${c.dim(code)}`, `  ${link(c.cyan(`${file}:${row}:${col}`), editorLink(resolve(file), row, col))}`);
		for (const number of rows) {
			if (number !== at) {
				out.push(`    ${numbered(number)} ${highlight(source[number - 1])}`);
				continue;
			}
			out.push(`  ${c.red('❯')} ${numbered(number)} ${highlight(text.slice(0, from))}${c.red(text.slice(from, from + width))}${highlight(text.slice(from + width))}`);
			if (width) out.push(`    ${c.dim(`${' '.repeat(gutter)} │`)} ${' '.repeat(from)}${c.red('~'.repeat(width))}`);
		}
		problem = null;
	};
	for (const raw of lines) {
		const line = TYPE_NAMES.reduce((text, [name, word]) => text.replace(name, word), raw);
		const title = /^(?:✖ )?(\S+) does not compile:$/.exec(line);
		const place = /^(\S+?):(\d+):(\d+) - (\w+) (.*)$/.exec(line);
		const source = /^\s*\d+\s*│ ?(.*)$/.exec(line);
		const marks = /^\s*│(\s*)(~+)\s*$/.exec(line);
		if (title) {
			flush();
			out.push(`${out.length && !brief ? '\n' : ''}${c.red('✖')} ${c.bold(title[1])} ${c.red('does not compile')}`, ...(brief ? [] : ['']));
		} else if (place) {
			flush();
			problem = { file: place[1], row: place[2], col: place[3], code: place[4], message: place[5], snippet: '', width: 0 };
		} else if (problem && marks) {
			problem.width = marks[2].length;
		} else if (problem && source) {
			problem.snippet = source[1];
		} else if (!line.trim()) {
			flush();
		} else {
			flush();
			if (!brief) out.push('', `  ${c.dim(line.trim())}`);
		}
	}
	flush();
	return out.flatMap(line => line.split('\n'));
}

/** Whether dev shows the panel: a terminal both ways, big enough, not CI, not asked for plain lines. */
export function wantsPanel({ tui = true, env = process.env, stdout = process.stdout, stdin = process.stdin } = {}) {
	if (tui === false || env.AMXTS_TUI === 'plain' || isCI(env) || !stdout.isTTY || !stdin.isTTY) return false;
	return (stdout.columns ?? 0) >= 60 && (stdout.rows ?? 0) >= 16;
}

/** A coloured line cut to `width` columns, its colours kept and closed. */
export function fit(line, width) {
	if ([...plain(line)].length <= width) return line;
	let seen = 0;
	let out = '';
	// eslint-disable-next-line no-control-regex
	for (const [token] of line.matchAll(/\x1B\[[\d;]*m|\x1B\]8;[^\x1B]*\x1B\\|[\s\S]/gu)) {
		if (token.length > 1 && token.startsWith('\x1B')) {
			out += token;
			continue;
		}
		if (seen === width - 1) return `${out}…\x1B[0m`;
		out += token;
		seen++;
	}
	return out;
}

const seconds = value => `${value.toFixed(1)}s`;
const dot = c.dim(' · ');

/** The server's folder from its addons/amxts, its last two folders when longer: `…/steam/hlds`. */
export function serverName(deployTo) {
	const folder = deployTo.replace(/\/+$/, '').replace(/\/(?:cstrike\/)?addons\/amxts$/i, '');
	const parts = folder.split('/');
	return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : folder;
}

/** The server's part of the panel. */
function serverText(server, deployTo) {
	const where = deployTo ? c.dim(serverName(deployTo)) : c.dim('dist/ - the Docker server reads it');
	const how = {
		none: '',
		unset: c.yellow(`rcon is not set up: no rcon_password in ${server.cfg}`),
		checking: c.dim('asking it over rcon…'),
		down: c.yellow('not running'),
		bad: c.red(`refused the rcon_password of ${server.cfg}`),
		up: [server.map && c.bold(server.map), server.players !== undefined && `${server.players}/${server.max} players`, server.fps !== undefined && `${Math.round(server.fps)} fps`].filter(Boolean).join(dot),
	}[server.status];
	// The folder last: a long one is what the window cuts.
	return how ? `${how}${dot}${where}` : where;
}

/** The last good rebuild: what changed, what it built, how long each part took, what the server did. */
function rebuildText(last, players) {
	if (!last) return c.dim('nothing deployed yet');
	const deploy = last.compile === undefined ? last.total : Math.max(0, last.total - last.compile);
	const outcome = last.reloaded
		? c.green(`reloaded on the server${players === undefined ? '' : `, ${players} player${players === 1 ? '' : 's'} kept`}`)
		: last.outcome.includes(' - ') ? c.yellow(last.outcome.slice(last.outcome.indexOf(' - ') + 3).replace(/:$/, ' - see above')) : c.dim(last.outcome);
	return [
		`${last.files.length ? last.files.join(', ') : 'start'} ${c.dim('→')} ${c.bold(last.plugins.join(', ') || '-')}`,
		last.boot !== undefined && `launch ${seconds(last.boot)}`,
		last.compile !== undefined && `compile ${seconds(last.compile)}`,
		`${last.outcome.startsWith('deployed') ? 'deploy' : 'write'} ${seconds(deploy)}`,
		outcome,
		last.at && c.dim(last.at),
	].filter(Boolean).join(dot);
}

/** Whether a build runs: one compiles, or the first has not ended. */
const busy = feed => Boolean(feed.building) || (!feed.watching && !feed.broken);

/** A bar of `=`, lit to `part` (0 to 1), `width` cells. */
export function bar(part, width) {
	const full = Math.round(width * Math.min(1, Math.max(0, part)));
	return `${logoPaint()('='.repeat(full))}${c.dim('='.repeat(width - full))}`;
}

/** A time as a build line says it: `321ms` under a second, `3.1s` from one. */
export function took(ms) {
	return ms < 1000 ? `${Math.round(ms)}ms` : seconds(ms / 1000);
}

/**
 * How far a build is, 0 to 1: the plugins done of all, or the time so far
 * against the time the last compile took (they compile side by side) - short
 * of done until the core says so; a structured feed from it would say each
 * step. Compiled, it deploys: 0.95.
 */
export function buildPart({ done, total, since }, expected, now = Date.now()) {
	return Math.min(0.95, Math.max(done / total, (now - since) / 1000 / expected));
}

/**
 * How far a build with nothing compiling yet is, 0 to 1: the time so far
 * against the whole of the last one (10 seconds before there is one), short of
 * done until the core says so.
 */
export function runPart(last, since, now = Date.now()) {
	const expected = last ? last.total + (last.boot ?? 0) : 10;
	return Math.min(0.95, (now - since) / 1000 / expected);
}

/**
 * The build's bar from one moment to the next, `{ part, base }`: it never goes
 * back. What comes before a compile fills it by the time, and a compile, once
 * it starts, fills what is left from where the bar is (`base`).
 * @param {{ part: number, base: number | null }} was
 */
export function buildProgress(was, feed, since, now = Date.now()) {
	if (!busy(feed)) return { part: 0, base: null };
	const base = feed.building && was.base === null ? was.part : was.base;
	const raw = feed.building ? buildPart(feed.building, feed.expected, now) : runPart(feed.last, since, now);
	const part = base === null ? raw : base + (0.95 - base) * (raw / 0.95);
	return { part: Math.max(was.part, Math.min(0.95, part)), base };
}

const SPINNER = { box: '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', bullet: '|/-\\', ascii: '|/-\\' };

/**
 * The state, on a badge: building - a spinner, a bar, the plugins done of all
 * and the time so far - an error, the map changing (the bar by the last
 * change's time, 5 seconds before one), or ready.
 * @param {{ map: string, since: number } | null} changing the map `m` changes to
 * @param {number | undefined} mapTime seconds the last change took
 * @param {number | undefined} shown how far the build's bar is (buildProgress), else worked out from this moment alone
 */
function stateText(feed, tick, since, changing, mapTime, shown) {
	const frames = SPINNER[logoGlyphs()];
	if (feed.broken) return `${c.red('✖')} ${badge('ERROR', 'error')} ${feed.error[0]}${c.dim(` · e shows it${feed.last ? ' · the server keeps the last good build' : ''}`)}`;
	if (changing) {
		const part = Math.min(0.95, (Date.now() - changing.since) / 1000 / (mapTime ?? 5));
		return `${c.cyan(frames[tick % frames.length])} ${badge('MAP', 'busy')} changing to ${c.bold(changing.map)}  ${bar(part, 24)} ${Math.round(part * 100)}%${dot}${c.dim(took(Date.now() - changing.since))}`;
	}
	if (busy(feed)) {
		const building = feed.building;
		const doing = !building ? 'building and deploying' : building.done >= building.total ? 'deploying' : `compiling ${c.bold(building.what)}`;
		const part = shown ?? (building ? buildPart(building, feed.expected) : runPart(feed.last, since));
		const count = building ? `${dot}${c.dim(`${building.done}/${building.total}`)}` : '';
		return `${c.cyan(frames[tick % frames.length])} ${badge('BUILDING', 'busy')} ${doing}  ${bar(part, 24)} ${Math.round(part * 100)}%${count}${dot}${c.dim(took(Date.now() - (building?.since ?? since)))}`;
	}
	return `${c.green('✔')} ${badge('READY', 'ready')} ${c.dim('watching for changes')}`;
}

/**
 * The panel's lines, before they are cut to the window.
 * @param {object} state
 * @param {ReturnType<typeof createFeed>} state.feed
 * @param {object} state.server what rcon said: status, map, players, max, fps, cfg
 * @param {string} state.deployTo AMXTS_SERVER, '' for none
 * @param {boolean} state.choosing whether `m` asks for a map
 * @param {null | '?' | 'p' | 'e'} [state.view] what the key opened in the panel: the keys, the plugins, the last error
 * @param {{ name: string, state: string, about: string }[]} [state.states] what amxts_plugins said, for `p`
 * @param {{ map: string, since: number } | null} [state.changing] the map `m` changes to, till the server is on it
 * @param {number} [state.mapTime] seconds the last change of the map took
 * @param {number} [state.part] how far the build's bar is (buildProgress)
 * @param {string} state.input what is typed for `m`
 * @param {string[]} state.maps the server's maps
 * @param {number | undefined} state.players the players the last reload kept
 * @param {number} state.tick the spinner's frame
 * @param {number} state.since when the build started, in ms
 * @param {string} state.title `amxts 0.2.4 · dev`, beside the logo
 * @param {object} [state.where] the output, as logoLines takes it
 * @param {string} [state.glyphs] what it draws with (logoGlyphs)
 * @returns {string[]} always as many: a panel that changes its height moves the log
 */
export function panelLines({ feed, server, deployTo, choosing, view = null, states = [], changing = null, mapTime, part, input, maps, players, tick = 0, since = Date.now(), title = '', where, glyphs = logoGlyphs() }) {
	const key = logoPaint(where);
	const label = text => c.dim(text.padEnd(9));
	const { built, failed } = feed.counts();
	const found = maps.filter(map => map.includes(input));
	// The logo on the left, a light running across it: from beyond its left
	// edge to beyond its right one (it is 8 wide), so a round starts unseen.
	const logo = logoLines((tick * 0.5) % 16 - 4, { glyphs, where });
	if (view) {
		// A view takes the place of the server and the plugins: as tall as ever, its rows five.
		const cell = ([letter, , what]) => `${c.bold(key(letter))}  ${what.padEnd(36)}`;
		const half = KEYS.length / 2;
		const views = {
			'?': ['the help', KEYS.slice(0, half).map((each, index) => `  ${cell(each)}  ${cell(KEYS[half + index])}`)],
			'p': ['the plugins', pluginLines(states, feed)],
			'e': ['the error', feed.error.length ? errorBlock(feed.error, { context: 0, brief: true }).map(line => `  ${line}`) : [`  ${c.green('✔')} no error since dev started`]],
		};
		const [what, rows] = views[view];
		const shown = rows.length > 5 ? [...rows.slice(0, 4), c.dim(`  … ${rows.length - 4} more${view === 'e' ? ' - l shows the log' : ''}`)] : rows;
		return ['', ...shown, ...Array.from({ length: 5 - shown.length }).fill(''), '', `${c.bold(key(view))} ${c.dim('or')} ${c.bold(key('Esc'))} ${c.dim(`closes ${what}`)}`];
	}
	return [
		'',
		...[
			title,
			`${label('server')}${serverText(server, deployTo)}`,
			`${label('plugins')}${c.green(`✔ ${built} built`)}  ${failed ? c.red(`✖ ${failed} failed`) : c.dim('✖ 0 failed')}${feed.count ? c.dim(` · ${feed.count} in the project`) : ''}`,
			`${label('last')}${rebuildText(feed.last, players)}`,
		].map((line, index) => `${logo[index]}   ${line}`),
		'',
		stateText(feed, tick, since, changing, mapTime, part),
		choosing
			? `${c.bold(key('map'))} ${input}${key('█')}  ${c.dim(found.slice(0, 12).join(' ') || 'no such map')}${dot}${c.dim('Enter changes it · Esc cancels')}`
			: KEYS.map(([letter, name]) => `${c.bold(key(letter))} ${c.dim(name)}`).join(dot),
	];
}

/**
 * Each plugin and its state, as `p` prints them: what the server's
 * `amxts_plugins` said, else what the build knows.
 * @param {{ name: string, state: string, about: string }[]} states
 * @param {ReturnType<typeof createFeed>} feed
 */
export function pluginLines(states, feed) {
	const rows = states.length
		? states.map(each => [each.name, each.state, each.about])
		: [...feed.plugins].map(([name, state]) => [name, state, 'the server does not say: rcon']);
	if (!rows.length) return [c.dim('  no plugin built yet')];
	const wide = Math.max(...rows.map(([name]) => name.length));
	const paint = { running: c.green, refused: c.red, failed: c.red, unloaded: c.yellow };
	return rows.map(([name, state, about]) => `  ${c.bold(name.padEnd(wide))}  ${(paint[state] ?? c.dim)(state.padEnd(9))}${c.dim(about)}`);
}

/** Opens a page in the browser by the system's own means: no shell. */
function openPage(url) {
	const [file, args] = process.platform === 'win32'
		? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
		: [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
	const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
	child.on('error', () => {});
	child.unref();
}

/**
 * Runs the build under the panel until `q`.
 * @param {import('./core.mjs').Core} core
 * @param {string[]} args the build task's
 * @param {{ target: import('./rcon.mjs').RconTarget | null, deployTo: string }} server
 */
export function devPanel(core, args, { target, deployTo }) {
	const out = process.stdout;
	const stdin = process.stdin;
	const feed = createFeed();
	/** @type {{ line: string, hidden: boolean }[]} */
	const history = [];
	const state = {
		feed,
		server: { status: !target ? 'none' : target.password ? 'checking' : 'unset', cfg: target?.cfg },
		deployTo,
		choosing: false,
		view: null,
		states: [],
		changing: null,
		mapTime: undefined,
		input: '',
		maps: [],
		players: undefined,
		tick: 0,
		title: `${c.bold('amxts')} ${c.dim(`${core.version} · dev`)}`,
		since: Date.now(),
	};
	/** Whether the panel's rows are set apart: the first draw does it, and again after `c` or a new window size. */
	let placed = false;
	/** The window's clear, written with the next draw. */
	let wipe = '';
	let queued = [];
	let timer = null;
	let child = null;
	let restarting = false;
	let polling = false;
	/** The build's bar, which never goes back (buildProgress). */
	let progress = { part: 0, base: null };

	// The log's place is kept with the cursor's save (ESC 7) and restore (ESC 8);
	// the panel is always as tall, so the region is set once.
	const flush = () => {
		timer = null;
		const { rows, columns } = out;
		progress = buildProgress(progress, feed, state.since);
		const lines = panelLines({ ...state, part: busy(feed) ? progress.part : undefined }).map(line => vivid(fit(line, columns - 1)));
		const top = rows - lines.length;
		// A clear goes in the same write as what is drawn after it: nothing jumps.
		let text = wipe;
		wipe = '';
		if (!placed) {
			// Room at the bottom, wherever the cursor is, and the rows above it for the log.
			text += `${'\n'.repeat(lines.length)}\x1B[${lines.length}A\x1B7\x1B[1;${top}r`;
			placed = true;
		}
		text += `\x1B8${queued.map(line => `\x1B[2K${vivid(line)}\n`).join('')}\x1B7`;
		text += lines.map((line, index) => `\x1B[${top + 1 + index};1H\x1B[2K${line}`).join('');
		text += '\x1B8';
		out.write(text);
		queued = [];
	};
	const redraw = () => {
		timer ??= setTimeout(flush, 16);
	};
	const print = (...lines) => {
		queued.push(...lines);
		redraw();
	};
	/** The window cleared - with the terminal's history too, for `c`. */
	const clear = (scrollback = true) => {
		queued = [];
		placed = false;
		wipe = `\x1B[r\x1B[2J${scrollback ? '\x1B[3J' : ''}\x1B[H`;
		redraw();
	};

	const ask = async (command) => {
		if (!target?.password) {
			print(`${c.yellow('▲')} ${state.server.status === 'none' ? 'no server to ask: AMXTS_SERVER is not set' : `rcon is not set up: add  rcon_password "something"  to ${target.cfg} and restart the server`}`);
			return null;
		}
		const answer = await rcon(target, command);
		if ('error' in answer) {
			print(`${c.red('✖')} rcon ${command}: ${answer.error === 'no answer' ? 'the server does not answer' : `the server refused the rcon_password of ${target.cfg}`}`);
			return null;
		}
		return answer.reply;
	};
	/** A command of the keys: said, sent, and what the server answered under it. */
	const run = async (command) => {
		print(`${c.cyan('◇')} ${command}`);
		const reply = await ask(command);
		if (reply?.trim()) print(...reply.trimEnd().split('\n').map(line => c.dim(`  ${line}`)));
		return reply;
	};
	const poll = async () => {
		if (!target?.password || polling) return;
		polling = true;
		try {
			const status = await rcon(target, 'status');
			if ('error' in status) {
				state.server = { status: status.error === 'no answer' ? 'down' : 'bad', cfg: target.cfg };
			} else {
				const stats = await rcon(target, 'stats');
				state.server = { status: 'up', cfg: target.cfg, ...serverState(status.reply, 'reply' in stats ? stats.reply : '') };
				if (state.changing && state.server.map === state.changing.map) {
					state.mapTime = (Date.now() - state.changing.since) / 1000;
					print(`${c.green('✔')} the server is on ${c.bold(state.changing.map)} ${c.dim(`(${seconds(state.mapTime)})`)}`);
					state.changing = null;
				}
				if (state.view === 'p') {
					const list = await rcon(target, 'amxts_plugins');
					state.states = 'reply' in list ? pluginStates(list.reply) : [];
				}
			}
		} finally {
			polling = false;
			redraw();
		}
	};
	/** `changelevel`, then the server asked every half a second till it is on the map - a minute at most. */
	const changeMap = async (map) => {
		state.changing = { map, since: Date.now() };
		if (await run(`changelevel ${map}`) === null) {
			state.changing = null;
			return;
		}
		const watch = setInterval(() => {
			if (state.changing && Date.now() - state.changing.since > 60_000) {
				print(`${c.yellow('▲')} the server is not on ${c.bold(map)} after a minute`);
				state.changing = null;
			}
			if (!state.changing) clearInterval(watch);
			else void poll();
		}, 500);
	};

	let errorTimer = null;
	const showError = () => {
		clearTimeout(errorTimer);
		errorTimer = null;
		print(...errorBlock(feed.error));
	};

	const start = () => {
		state.since = Date.now();
		// A build started again is busy until it watches, even with nothing to compile.
		feed.watching = false;
		feed.started = Date.now();
		feed.broken = false;
		// Blank lines before the build says anything of its own are the header's.
		let leading = true;
		child = startTask(core, 'build', args, { pipe: true });
		for (const stream of [child.stdout, child.stderr]) {
			createInterface({ input: stream }).on('line', (line) => {
				const kind = feed.push(line);
				// The header and watching are the panel's to say, in no log; what
				// compiles the panel says too, and `l` shows it.
				const panels = kind === 'header' || kind === 'watching' || (leading && !line.trim());
				const hidden = panels || kind === 'compiling';
				if (!hidden) leading = false;
				if (!panels) history.push({ line, hidden });
				if (history.length > HISTORY) history.shift();
				if (kind === 'rebuilt') {
					state.players = feed.last?.reloaded && state.server.status === 'up' ? state.server.players : undefined;
					void poll();
				}
				// An error is shown whole once its lines stop coming: a block, read from them all.
				if (kind === 'error') {
					clearTimeout(errorTimer);
					errorTimer = setTimeout(showError, 40);
					return;
				}
				if (errorTimer) showError();
				if (hidden) redraw();
				else print(line);
			});
		}
		child.on('exit', (code) => {
			if (restarting) {
				restarting = false;
				start();
				return;
			}
			quit(code || 1);
		});
	};

	/**
	 * Stops dev: the window cleared - its history kept - and a line of what
	 * happened left, the build's error with it when the build stopped on its own.
	 */
	function quit(code = 0) {
		if (timer) clearTimeout(timer);
		const words = code
			? [...(feed.error.length ? [...errorBlock(feed.error), ''] : []), `${c.red('✖')} the build stopped${code === 1 ? '' : ` (exit code ${code})`}`]
			: [`${c.green('✔')} amxts dev stopped`];
		out.write(`\x1B[r\x1B[2J\x1B[H\x1B[?25h\x1B[?2004l${words.map(vivid).join('\n')}\n`);
		if (stdin.isTTY) stdin.setRawMode(false);
		if (child && child.exitCode === null) {
			child.removeAllListeners('exit');
			stopTree(child.pid);
		}
		process.exit(code);
	}

	const mapKey = (text, key) => {
		if (key.name === 'escape') {
			state.choosing = false;
		} else if (key.name === 'backspace') {
			state.input = state.input.slice(0, -1);
		} else if (key.name === 'return') {
			const found = state.maps.filter(map => map.includes(state.input));
			const map = found.includes(state.input) ? state.input : found[0];
			state.choosing = false;
			if (map) void changeMap(map);
		} else if (text && /^[\w.-]$/.test(text)) {
			state.input += text;
		}
		redraw();
	};

	/** Opens a view in the panel - `?`, `p` or `e` - or closes it when it is open. */
	const toggle = (view) => {
		state.view = state.view === view ? null : view;
		redraw();
	};

	const actions = {
		r() {
			// One at a time: a build that runs is let finish.
			if (restarting || busy(feed)) return;
			print(`${c.cyan('◇')} rebuilding every plugin`);
			restarting = true;
			stopTree(child.pid);
		},
		p() {
			toggle('p');
			void poll();
		},
		l() {
			print(...(history.length ? [c.dim(`── the build's last ${history.length} lines ──`), ...history.map(each => each.line), c.dim('──')] : [c.dim('the build has said nothing yet')]));
		},
		'e': () => toggle('e'),
		c() {
			clear();
		},
		async m() {
			const reply = await ask('maps *');
			if (reply === null) return;
			state.maps = mapNames(reply);
			state.input = '';
			state.choosing = true;
			redraw();
		},
		'R': () => run('sv_restart 1'),
		o() {
			print(`${c.cyan('◇')} opened the docs of amxts dev in the browser ${c.dim(`(${DOCS})`)}`);
			openPage(DOCS);
		},
		'?': () => toggle('?'),
		'q': () => quit(0),
	};

	// Esc alone is told from the start of a key's sequence after 50 ms, not readline's 500.
	emitKeypressEvents(stdin, { escapeCodeTimeout: 50 });
	stdin.setRawMode(true);
	stdin.resume();
	// Pasted text is no keys: a terminal brackets a paste (ESC[200~ … ESC[201~,
	// asked for below), and one without brackets sends it in one piece of
	// several characters, where a key is one.
	let pasting = false;
	let piece = false;
	stdin.prependListener('data', (chunk) => {
		const text = String(chunk);
		piece = text.length > 1 && !text.startsWith('\x1B');
	});
	stdin.on('keypress', (text, key = {}) => {
		if (key.name === 'paste-start' || key.name === 'paste-end') {
			pasting = key.name === 'paste-start';
			return undefined;
		}
		if (key.ctrl && key.name === 'c') return quit(0);
		// What is pasted goes into the map's name only.
		if (pasting || piece) return state.choosing && !key.ctrl ? mapKey(latin(text), {}) : undefined;
		if (key.ctrl || key.meta) return undefined;
		if (state.choosing) return mapKey(latin(text), key);
		if (key.name === 'escape' && state.view) return toggle(state.view);
		return actions[latin(text)]?.();
	});
	// A window that changed size reflows what is on it: drawn anew from the log.
	out.on('resize', () => {
		clear(false);
		print(...history.filter(each => !each.hidden).slice(-(out.rows - 12)).map(each => each.line));
	});
	for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => quit(0));
	process.on('exit', () => out.write('\x1B[r\x1B[?25h\x1B[?2004l'));

	// The cursor hidden, pastes bracketed.
	out.write('\x1B[?25l\x1B[?2004h');
	start();
	void poll();
	setInterval(poll, POLL).unref();
	// The light runs across the logo, and the spinner turns while a build runs.
	setInterval(() => {
		state.tick++;
		redraw();
	}, 100).unref();
	redraw();
}
