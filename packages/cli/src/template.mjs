// The starters in templates/ are written as the files they become, with
// {{placeholders}} and conditional blocks:
//
//   // #if menu-core            kept only when the flag is on
//   // #if !lint                kept only when it is off
//   // #endif
//
// (`<!-- #if x -->` in Markdown, `# #if x` in .gitignore). A file named `_x`
// is written as `.x`: npm leaves a .gitignore out of a published package.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The {{author}} a starter is written with: git's user.name, else "you". */
export function gitAuthor() {
	return spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' }).stdout?.trim() || 'you';
}

const IF = /^\s*(?:\/\/|<!--|#)\s*#if\s+(!?)([\w-]+)/;
const ENDIF = /^\s*(?:\/\/|<!--|#)\s*#endif\b/;

/**
 * @param {string} text
 * @param {Record<string, string>} values
 * @param {Record<string, boolean>} flags
 */
export function fill(text, values, flags = {}) {
	const lines = [];
	let keep = true;
	for (const line of text.split('\n')) {
		const open = line.match(IF);
		if (open) {
			keep = open[1] === '!' ? !flags[open[2]] : Boolean(flags[open[2]]);
			continue;
		}
		if (ENDIF.test(line)) {
			keep = true;
			continue;
		}
		if (keep) lines.push(line);
	}
	return lines.join('\n').replace(/\{\{([\w.-]+)\}\}/g, (whole, key) => values[key] ?? whole);
}

/**
 * Writes a template folder into `to`. `skip` leaves a file out by its path in
 * the template; a file that fills to nothing but blank lines is left out too.
 * Returns the paths written, relative to `to`.
 */
export function copyTemplate(from, to, values, flags = {}, skip = () => false, base = '') {
	const written = [];
	for (const entry of readdirSync(from)) {
		const source = join(from, entry);
		const path = base ? `${base}/${entry}` : entry;
		if (skip(path)) continue;
		const name = fill(entry.replace(/^_/, '.'), values, flags);
		if (statSync(source).isDirectory()) {
			written.push(...copyTemplate(source, join(to, name), values, flags, skip, path).map(each => `${name}/${each}`));
			continue;
		}
		const text = fill(readFileSync(source, 'utf8'), values, flags);
		if (!/\S/.test(text)) continue;
		mkdirSync(to, { recursive: true });
		writeFileSync(join(to, name), text);
		written.push(name);
	}
	return written;
}

/** Writes one file, making its folder. */
export function writeFile(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}
