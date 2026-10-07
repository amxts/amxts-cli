// How the amxts command talks: colors when the terminal has them, one line
// per step, and an error as one line with a hint under it. The stack of an
// error is printed only with --debug (or AMXTS_DEBUG=1).
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Whether the output takes colors: a terminal, and NO_COLOR not set; FORCE_COLOR wins. */
function colorful(stream = process.stdout) {
	if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
	if (process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return false;
	return Boolean(stream.isTTY);
}

const enabled = colorful();

function paint(open, close) {
	return text => (enabled ? `\x1B[${open}m${text}\x1B[${close}m` : String(text));
}

export const c = {
	bold: paint(1, 22),
	dim: paint(2, 22),
	red: paint(31, 39),
	green: paint(32, 39),
	yellow: paint(33, 39),
	blue: paint(34, 39),
	magenta: paint(35, 39),
	cyan: paint(36, 39),
	gray: paint(90, 39),
};

/** An error the user can do something about: the message, and what to do. */
export class CliError extends Error {
	/**
	 * @param {string} message one line: what went wrong
	 * @param {string} [hint] one or more lines: what to do about it
	 */
	constructor(message, hint) {
		super(message);
		this.name = 'CliError';
		this.hint = hint;
	}
}

export const debug = () => process.argv.includes('--debug') || process.env.AMXTS_DEBUG === '1';

export const log = {
	info: text => console.log(`${c.cyan('i')} ${text}`),
	success: text => console.log(`${c.green('✔')} ${text}`),
	warn: text => console.log(`${c.yellow('▲')} ${text}`),
	step: text => console.log(`${c.cyan('◇')} ${text}`),
	error: text => process.stderr.write(`${c.red('✖')} ${text}\n`),
	hint: text => process.stderr.write(`${String(text).split('\n').map(line => `  ${c.dim(line)}`).join('\n')}\n`),
};

/** An error, printed as the user should see it: one line and its hint; the stack only with --debug. */
export function report(error) {
	if (error instanceof CliError) {
		log.error(error.message);
		if (error.hint) log.hint(error.hint);
	} else {
		const [first, ...rest] = (error instanceof Error ? error.message : String(error)).trim().split('\n');
		log.error(first);
		if (rest.length) process.stderr.write(`${rest.map(line => `  ${line}`).join('\n')}\n`);
		if (!debug()) log.hint('Run it again with --debug to see where it happened.');
	}
	if (debug() && error instanceof Error && error.stack) process.stderr.write(`${c.gray(error.stack)}\n`);
}

/** Whether a run is CI's: `CI` set to anything but `false`. */
export function isCI(env = process.env) {
	return Boolean(env.CI) && env.CI !== 'false' && env.CI !== '0';
}

/**
 * What characters the output can draw: `box` - any (the panel's spinner and
 * bar); `bullet` - the logo's `{•}` but not the box characters, for Windows'
 * own console, whose fonts may miss them; `ascii` - none of them, where the
 * text is not UTF-8: the logo is `{*}`.
 */
export function logoGlyphs(env = process.env, platform = process.platform) {
	if (platform === 'win32') {
		const modern = env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuTask || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' || /^(?:xterm|alacritty)/.test(env.TERM ?? '');
		return modern ? 'box' : 'bullet';
	}
	if (!/utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || 'UTF-8')) return 'ascii';
	return env.TERM === 'linux' ? 'bullet' : 'box';
}

/**
 * The logo's colour, amxts yellow (#F2C94C): in 24 bits where the terminal
 * has them, plain yellow in one of 16 colours, none without a terminal, in CI
 * or with NO_COLOR - FORCE_COLOR wins, as for every colour here.
 * @param {{ tty?: boolean, env?: Record<string, string | undefined>, depth?: number }} [where] the output: a terminal, its environment and its colour depth in bits
 * @returns {(text: string) => string} what paints a text
 */
export function logoPaint(where) {
	return [text => text, text => `\x1B[33m${text}\x1B[39m`, text => `\x1B[38;2;242;201;76m${text}\x1B[39m`][brandDepth(where)];
}

/** How amxts yellow is drawn (logoPaint): 0 - not at all, 1 - plain yellow, 2 - in 24 bits. */
function brandDepth({ tty = Boolean(process.stdout.isTTY), env = process.env, depth = process.stdout.getColorDepth?.(env) ?? 4 } = {}) {
	const forced = env.FORCE_COLOR && env.FORCE_COLOR !== '0';
	if (!forced && (!tty || isCI(env) || env.NO_COLOR !== undefined || env.TERM === 'dumb')) return 0;
	return depth >= 24 || env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' ? 2 : 1;
}

// The 16 colours as amxts draws them in 24 bits: green, red, yellow (amxts
// yellow), blue, magenta, cyan - lit, where a terminal's own may be pale.
const VIVID = { 31: '248;113;113', 32: '74;222;128', 33: '242;201;76', 34: '96;165;250', 35: '232;121;249', 36: '34;211;238' };

/** A line with its 16 colours drawn vivid, where the terminal has 24 bits; as it is elsewhere. */
export function vivid(line, where) {
	if (brandDepth(where) !== 2) return line;
	// eslint-disable-next-line no-control-regex
	return line.replace(/\x1B\[(3[1-6])m/g, (_, code) => `\x1B[38;2;${VIVID[code]}m`);
}

/**
 * A text the terminal makes a link of (OSC 8), where colours are on; the text
 * alone elsewhere.
 */
export function link(text, url, where) {
	return brandDepth(where) ? `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\` : text;
}

/**
 * The link that opens a file at a line and column in the editor: Orca's own
 * in Orca's terminal, else VS Code's, or Cursor's where the terminal or EDITOR
 * is Cursor's. A `file://` link elsewhere would open a `.ts` in whatever the
 * system opens it with - a video player, on some.
 */
export function editorLink(file, line, col, env = process.env) {
	// Orca opens a file:// link in its own editor, the line and column after it.
	if (env.TERM_PROGRAM === 'Orca') return `${pathToFileURL(file).href}:${line}:${col}`;
	const scheme = /cursor/i.test(`${env.TERM_PROGRAM ?? ''} ${env.EDITOR ?? ''} ${env.VISUAL ?? ''}`) ? 'cursor' : 'vscode';
	// `vscode://file/D:/x.ts:3:26`, `vscode://file/home/me/x.ts:3:26`: the path absolute.
	const path = file.replace(/\\/g, '/');
	return `${scheme}://file${path.startsWith('/') ? '' : '/'}${encodeURI(path)}:${line}:${col}`;
}

/**
 * A state as a word on a ground of its colour - ` READY ` on amxts yellow,
 * ` BUILDING ` on cyan, ` ERROR ` on red; `[READY]` without colours.
 * @param {string} text
 * @param {'ready' | 'busy' | 'error'} tone
 */
export function badge(text, tone, where) {
	const depth = brandDepth(where);
	if (!depth) return `[${text}]`;
	const ground = {
		ready: depth === 2 ? '48;2;242;201;76;38;2;21;24;29' : '43;30',
		busy: depth === 2 ? '48;2;34;211;238;38;2;21;24;29' : '46;30',
		error: depth === 2 ? '48;2;239;68;68;97' : '41;97',
	}[tone];
	return `\x1B[1;${ground}m ${text} \x1B[0m`;
}

// The logo in a line: the braces and the dot.
const MARK = { box: '{•}', bullet: '{•}', ascii: '{*}' };

// The logo - the crosshair: its arms, the braces and the dot - in braille
// dots, four lines of them, the logo's SVG rasterised to 16 by 16.
export const LOGO = ['⠀⢀⡀⢸⡇⢀⡀⠀', '⣀⡿⠁⣀⣀⠈⢿⣀', '⠉⣷⡀⠉⠉⢀⣾⠉', '⠀⠈⠁⢸⡇⠈⠁⠀'];

/**
 * The logo's four lines, painted. `wave`: a light that runs across it - its
 * place, in columns - while something runs, in 24 bits; the plain colour
 * without it. Where the font may have no braille, the mark in a line instead
 * (`{•}` on the second).
 * @param {number | null} [wave]
 * @param {{ glyphs?: string, where?: object }} [options] how the output draws (logoGlyphs, and the output as logoPaint takes it)
 * @returns {string[]} four lines, each as wide
 */
export function logoLines(wave = null, { glyphs = logoGlyphs(), where } = {}) {
	if (glyphs !== 'box') return ['   ', logoPaint(where)(MARK[glyphs]), '   ', '   '];
	const depth = brandDepth(where);
	if (depth < 2 || wave === null) return LOGO.map(line => logoPaint(where)(line));
	// From a darker gold to a pale one, amxts yellow between.
	// One spot of light, gone a few columns away from its place.
	const shade = column => Math.exp(-((column - wave) ** 2) / 4);
	const mix = light => [[150, 110, 30], [255, 236, 150]].reduce((low, high) => low.map((each, index) => Math.round(each + (high[index] - each) * light)));
	return LOGO.map(line => `${[...line].map((dot, column) => `\x1B[38;2;${mix(shade(column)).join(';')}m${dot}`).join('')}\x1B[39m`);
}

/**
 * The line a command starts with: the logo, `{•} amxts 0.2.4 · build`. With
 * `logo` (dev, a new project) the logo in its four lines, the words beside the
 * second.
 * @param {string} version
 * @param {string} [what]
 * @param {{ logo?: boolean, glyphs?: string, where?: object }} [options] how the output draws (logoGlyphs, and the output as logoPaint takes it)
 */
export function bannerText(version, what, { logo = false, glyphs = logoGlyphs(), where } = {}) {
	const words = `${c.bold('amxts')} ${c.dim(version)}${what ? c.dim(` · ${what}`) : ''}`;
	if (!logo || glyphs !== 'box') return `${logoPaint(where)(MARK[glyphs] ?? MARK.bullet)} ${words}`;
	return logoLines(null, { glyphs, where }).map((line, index) => (index === 1 ? `${line}   ${words}` : line)).join('\n');
}

/** Prints the line a command starts with (bannerText). */
export function banner(version, what, options) {
	console.log(bannerText(version, what, options));
}

/** The closest of `known` to `given`, when it is close enough to be a typo. */
export function closest(given, known) {
	let best = null;
	let distance = Infinity;
	for (const each of known) {
		const d = levenshtein(given.toLowerCase(), each.toLowerCase());
		if (d < distance) {
			best = each;
			distance = d;
		}
	}
	const prefix = given.length >= 2 ? known.find(each => each.startsWith(given)) : undefined;
	if (prefix) return prefix;
	return distance <= (given.length <= 3 ? 1 : 2) ? best : null;
}

/** Edits between two words, a swap of neighbours counted as one: `buidl` is one from `build`. */
function levenshtein(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array.from({ length: b.length }, (_, j) => (i === 0 ? j + 1 : 0))]);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	}
	return d[a.length][b.length];
}
