// How the amxts command talks: colors when the terminal has them, one line
// per step, and an error as one line with a hint under it. The stack of an
// error is printed only with --debug (or AMXTS_DEBUG=1).
import process from 'node:process';

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

/** The line a command starts with: `amxts 0.1.0 · build`. */
export function banner(version, what) {
	console.log(`${c.bold(c.cyan('amxts'))} ${c.dim(version)}${what ? c.dim(` · ${what}`) : ''}`);
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
