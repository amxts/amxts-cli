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

/** A new amxts.config.ts with these modules. */
export function newConfig(names) {
	return `export default defineConfig({\n\tmodules: [${names.map(name => JSON.stringify(name)).join(', ')}],\n});\n`;
}

/** The whitespace a line starts with. */
function indentAt(text, position) {
	const start = text.lastIndexOf('\n', position - 1) + 1;
	return text.slice(start).match(/^[ \t]*/)[0];
}

/**
 * The config with these modules added to `modules`, in the quotes and the
 * layout the list already has: one per line, or on one line.
 *
 * @returns {Promise<{ text: string, added: string[] }>} the new text, and the names it did not list before
 */
export async function addToConfig(text, names) {
	await useTypeScript();
	const file = parse(text);
	const object = configObject(file);
	if (!object) {
		throw new CliError(`${CONFIG_FILE} has no \`export default defineConfig({ ... })\` to add the module to`, `Add it by hand: modules: [${names.map(name => JSON.stringify(name)).join(', ')}]`);
	}
	const property = propertyOf(object, 'modules');
	const listed = namesIn(property);
	const added = names.filter((name, i) => !listed.includes(name) && names.indexOf(name) === i);
	if (added.length === 0) return { text, added };

	if (property && !ts.isArrayLiteralExpression(property.initializer)) {
		throw new CliError(`${CONFIG_FILE}: modules is not a list written out`, `Add it by hand: ${added.map(name => JSON.stringify(name)).join(', ')}`);
	}

	const firstString = property?.initializer.elements.find(ts.isStringLiteralLike);
	const quote = firstString ? firstString.getText(file)[0] : '"';
	const quoted = added.map(name => `${quote}${name.replaceAll(quote, `\\${quote}`)}${quote}`);

	if (property) {
		const array = property.initializer;
		const elements = array.elements;
		if (elements.length === 0) {
			return { text: `${text.slice(0, array.getStart(file))}[${quoted.join(', ')}]${text.slice(array.end)}`, added };
		}
		const last = elements[elements.length - 1];
		const line = position => file.getLineAndCharacterOfPosition(position).line;
		const multiline = line(elements[0].getStart(file)) !== line(array.getStart(file));
		const insert = multiline
			? quoted.map(each => `,\n${indentAt(text, elements[0].getStart(file))}${each}`).join('')
			: quoted.map(each => `, ${each}`).join('');
		return { text: text.slice(0, last.end) + insert + text.slice(last.end), added };
	}

	// No `modules` yet: it goes first in the object.
	const entry = `modules: [${quoted.join(', ')}],`;
	const first = object.properties[0];
	if (first) {
		const start = first.getStart(file);
		const sameLine = file.getLineAndCharacterOfPosition(start).line === file.getLineAndCharacterOfPosition(object.getStart(file)).line;
		const insert = sameLine ? `${entry} ` : `${entry}\n${indentAt(text, start)}`;
		return { text: text.slice(0, start) + insert + text.slice(start), added };
	}
	const unit = /\n\t/.test(text) || !/\n {2}/.test(text) ? '\t' : '  ';
	const indent = indentAt(text, object.getStart(file));
	return { text: `${text.slice(0, object.getStart(file))}{\n${indent}${unit}${entry}\n${indent}}${text.slice(object.end)}`, added };
}
