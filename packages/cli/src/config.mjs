// amxts.config.ts, read and edited as source: the TypeScript parser finds
// `modules` in `export default defineConfig({ ... })`, and an edit touches
// only the text it adds - the user's formatting, comments and other options
// stay as they are. The parser is the core's TypeScript (core.mjs), so the
// command itself does not install it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coreTypeScript } from './core.mjs';
import { CliError } from './ui.mjs';

export const CONFIG_FILE = 'amxts.config.ts';

/** @type {typeof import('typescript')} */
let ts;

/** Loads the parser, once. */
async function useTypeScript() {
	ts ??= await coreTypeScript();
}

/** The object `export default defineConfig({ ... })` (or `export default { ... }`) gives. */
function configObject(file) {
	for (const statement of file.statements) {
		if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
		let expression = statement.expression;
		while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
		if (ts.isCallExpression(expression)) expression = expression.arguments[0];
		if (expression && ts.isObjectLiteralExpression(expression)) return expression;
	}
	return null;
}

function parse(text) {
	return ts.createSourceFile(CONFIG_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** The object's `key: ...` property, or null. */
function propertyOf(object, key) {
	return object.properties.find(property => ts.isPropertyAssignment(property)
		&& (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
		&& property.name.text === key) ?? null;
}

/** The names a `modules` property lists: none when it is missing or not a list written out. */
function namesIn(property) {
	return property && ts.isArrayLiteralExpression(property.initializer)
		? property.initializer.elements.filter(ts.isStringLiteralLike).map(element => element.text)
		: [];
}

/** What `read` makes of the project's amxts.config.ts, or null without the file. */
function readConfig(dir, read) {
	const path = join(dir, CONFIG_FILE);
	return existsSync(path) ? read(readFileSync(path, 'utf8')) : null;
}

/** The module names amxts.config.ts lists; null when it has no config object to read. */
export async function configModules(text) {
	await useTypeScript();
	const object = configObject(parse(text));
	return object ? namesIn(propertyOf(object, 'modules')) : null;
}

/** The project's amxts.config.ts modules, or null without the file. */
export async function readConfigModules(dir) {
	return readConfig(dir, configModules);
}

/** `target` as amxts.config.ts writes it - "rehlds" or "hlds" - or null when it does not. */
export async function configTarget(text) {
	await useTypeScript();
	const object = configObject(parse(text));
	const property = object && propertyOf(object, 'target');
	return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null;
}

/** The project's amxts.config.ts target, or null without the file or the property. */
export async function readConfigTarget(dir) {
	return readConfig(dir, configTarget);
}

/**
 * @typedef {import('./catalog.mjs').ConfigEntry} ConfigEntry
 * @typedef {{ text: string, comment: string }} Item an entry as the list writes it: quoted, and its comment
 */

/** An entry in these quotes, with a comment naming the modules that need it. */
function itemOf(entry, quote = '"') {
	return {
		text: `${quote}${entry.name.replaceAll(quote, `\\${quote}`)}${quote}`,
		comment: entry.by?.length ? ` // needed by ${entry.by.join(', ')}` : '',
	};
}

/** Items one per line, each after a line break and this indent. */
function linesOf(items, indent) {
	return items.map(each => `\n${indent}${each.text},${each.comment}`).join('');
}

/** A list of items for a property at `indent`: on one line, or one per line when one has a comment. */
function listOf(items, indent, unit) {
	return items.some(each => each.comment)
		? `[${linesOf(items, indent + unit)}\n${indent}]`
		: `[${items.map(each => each.text).join(', ')}]`;
}

/** `modules`' list for a new config, its property at `indent`. */
export function modulesList(entries, indent = '\t') {
	return listOf(entries.map(each => itemOf(each)), indent, '\t');
}

/** A new amxts.config.ts with these modules. */
export function newConfig(entries) {
	return `export default defineConfig({\n\tmodules: ${modulesList(entries)},\n});\n`;
}

/** The whitespace a line starts with. */
function indentAt(text, position) {
	const start = text.lastIndexOf('\n', position - 1) + 1;
	return text.slice(start).match(/^[ \t]*/)[0];
}

/** The text's indent step: a tab, unless it indents with spaces. */
const unitOf = text => (/\n\t/.test(text) || !/\n {2}/.test(text) ? '\t' : '  ');

/**
 * The config with these modules added to `modules`, in the quotes and the
 * layout the list already has: one per line, or on one line - one per line
 * when an entry has a comment.
 *
 * @param {string} text
 * @param {(string | ConfigEntry)[]} modules the names, or entries that say who needs them
 * @returns {Promise<{ text: string, added: string[] }>} the new text, and the names it did not list before
 */
export async function addToConfig(text, modules) {
	await useTypeScript();
	const entries = modules.map(each => (typeof each === 'string' ? { name: each } : each));
	const file = parse(text);
	const object = configObject(file);
	if (!object) {
		throw new CliError(`${CONFIG_FILE} has no \`export default defineConfig({ ... })\` to add the module to`, `Add it by hand: modules: ${modulesList(entries)}`);
	}
	const property = propertyOf(object, 'modules');
	const listed = namesIn(property);
	const adding = entries.filter((entry, i) => !listed.includes(entry.name) && entries.findIndex(each => each.name === entry.name) === i);
	const added = adding.map(each => each.name);
	if (added.length === 0) return { text, added };

	if (property && !ts.isArrayLiteralExpression(property.initializer)) {
		throw new CliError(`${CONFIG_FILE}: modules is not a list written out`, `Add it by hand: ${added.map(name => JSON.stringify(name)).join(', ')}`);
	}

	const firstString = property?.initializer.elements.find(ts.isStringLiteralLike);
	const items = adding.map(entry => itemOf(entry, firstString ? firstString.getText(file)[0] : '"'));
	const commented = items.some(each => each.comment);
	const unit = unitOf(text);
	const replace = (start, end, insert) => ({ text: text.slice(0, start) + insert + text.slice(end), added });

	if (property) {
		const array = property.initializer;
		const elements = array.elements;
		const indent = indentAt(text, property.getStart(file));
		const last = elements.at(-1);
		if (!last) return replace(array.getStart(file), array.end, listOf(items, indent, unit));
		const line = position => file.getLineAndCharacterOfPosition(position).line;
		// The end of the last element's line, past its comma and its comment.
		const lineEnd = last.end + text.slice(last.end).search(/\r?\n|$/);
		if (line(elements[0].getStart(file)) > line(array.getStart(file)) && array.end - 1 > lineEnd) {
			// One per line: the new ones go after the last one's line, with a
			// comma after it when it has none.
			const comma = elements.hasTrailingComma ? '' : ',';
			const lines = linesOf(items, indentAt(text, elements[0].getStart(file)));
			return { text: text.slice(0, last.end) + comma + text.slice(last.end, lineEnd) + lines + text.slice(lineEnd), added };
		}
		if (!commented) return replace(last.end, last.end, items.map(each => `, ${each.text}`).join(''));
		// On one line, and a comment to write: the list goes one per line.
		return replace(array.getStart(file), array.end, listOf([...elements.map(each => ({ text: each.getText(file), comment: '' })), ...items], indent, unit));
	}

	// No `modules` yet: it goes first in the object.
	const first = object.properties[0];
	if (first) {
		const start = first.getStart(file);
		const indent = indentAt(text, start);
		const entry = `modules: ${listOf(items, indent, unit)},`;
		const sameLine = file.getLineAndCharacterOfPosition(start).line === file.getLineAndCharacterOfPosition(object.getStart(file)).line;
		return replace(start, start, sameLine ? `${entry} ` : `${entry}\n${indent}`);
	}
	const indent = indentAt(text, object.getStart(file));
	return replace(object.getStart(file), object.end, `{\n${indent}${unit}modules: ${listOf(items, indent + unit, unit)},\n${indent}}`);
}
