// The modules the amxts command knows by their names - the amxts catalog,
// the registry github.com/amxts/modules - and how a name given on the
// command line becomes a package to install.
//
//   menu-core                  the catalog's menu-core: @amxts/menu-core, from npm
//   @you/greeter               that package, from npm - with a warning when
//                              the catalog does not list it
//   ../greeter, file:../x      the package in that folder
//   menu-core --local          the folder the core on this machine takes an
//                              official module from (its package.json's
//                              `file:` link) - until they are on npm
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { readJson } from './core.mjs';
import { CliError } from './ui.mjs';

export const OFFICIAL_SCOPE = '@amxts';

/** The registry's modules.json: CI rebuilds it on every change to the catalog. */
export const CATALOG_URL = 'https://raw.githubusercontent.com/amxts/modules/main/modules.json';

/**
 * @typedef {object} CatalogModule a module of the catalog, as modules.json lists it
 * @property {string} name its name in the catalog: "menu-core"
 * @property {string} npm its package: "@amxts/menu-core"
 * @property {string} repo its GitHub repository: "amxts/menu-core"
 * @property {string} description what it is, in a line
 * @property {string} category its category: "ui", "config"...
 * @property {'official' | 'community'} type official: by the amxts team, under @amxts
 * @property {string[]} requires the other modules of the catalog it needs, by npm name
 */

/** A modules.json as read: an array of modules with names, each with its `requires`; else an error. */
function checked(modules) {
	if (!Array.isArray(modules) || !modules.every(each => typeof each?.name === 'string' && typeof each.npm === 'string')) throw new Error('not a modules.json');
	return modules.map(each => ({ ...each, requires: each.requires ?? [] }));
}

/** A modules.json from a file: a path or a file: URL. */
const readCatalog = source => checked(JSON.parse(readFileSync(source, 'utf8')));

/** A modules.json from a URL, or from a file when it is not one. */
async function fetchCatalog(source) {
	if (!/^https?:/.test(source)) return readCatalog(source);
	const response = await fetch(source, { signal: AbortSignal.timeout(3000) });
	if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
	return checked(await response.json());
}

/** @type {Promise<CatalogModule[]> | undefined} */
let catalog;

/**
 * The catalog, read once per run: the registry's modules.json, or - offline,
 * or when it does not answer in 3 seconds - the copy this package was
 * published with. `AMXTS_CATALOG` reads another URL or a file instead.
 * @returns {Promise<CatalogModule[]>} the catalog's modules
 */
export function loadCatalog() {
	catalog ??= fetchCatalog(process.env.AMXTS_CATALOG || CATALOG_URL).catch(() => readCatalog(new URL('./modules.json', import.meta.url)));
	return catalog;
}

export const shortName = name => name.replace(/^@[^/]+\//, '');

/** A package folder's tagline: the italic line under its README's title, else its description. */
export function taglineOf(dir) {
	const readme = join(dir, 'README.md');
	if (existsSync(readme)) {
		const line = readFileSync(readme, 'utf8').split(/\r?\n/).find(each => /^\*[^*].*\*$/.test(each.trim()));
		if (line) return line.trim().slice(1, -1);
	}
	return readJson(join(dir, 'package.json'))?.description ?? '';
}

const looksLikePath = arg => arg.startsWith('file:') || arg.startsWith('.') || isAbsolute(arg) || /^[a-z]:[\\/]/i.test(arg);

/**
 * @typedef {object} ModuleRef
 * @property {string} name the package name: "@amxts/menu-core"
 * @property {string | null} dir its folder, when it is installed from one
 * @property {string} tagline what it is, in a line: its README's, else its description
 * @property {string[]} requires the other modules it needs, as far as known before installing it
 * @property {boolean} listed whether the catalog lists it
 */

/**
 * What a name on the command line means.
 * @param {string} arg
 * @param {{ catalog?: CatalogModule[], local?: boolean, localModules?: Record<string, string>, cwd?: string }} options
 *   `catalog`: loadCatalog()'s modules; `localModules`: where the core on
 *   this machine takes the official modules from (its cli-api's
 *   localModules()), for `local`
 * @returns {ModuleRef} the package, and its folder when it comes from one
 */
export function resolveModule(arg, { catalog = [], local = false, localModules = {}, cwd = process.cwd() } = {}) {
	if (looksLikePath(arg)) {
		const dir = resolve(cwd, arg.replace(/^file:/, ''));
		const json = readJson(join(dir, 'package.json'));
		if (!json?.name) throw new CliError(`${arg} is not a package: no package.json with a name there`);
		return { name: json.name, dir, tagline: taglineOf(dir), requires: requiresOf(json), listed: catalog.some(each => each.npm === json.name) };
	}

	const listed = catalog.find(each => each.name === arg || each.npm === arg);
	const name = listed?.npm ?? arg;
	if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@.+)?$/i.test(name)) {
		throw new CliError(`"${arg}" is not a package name`, 'A module is named as npm names it: menu-core, @amxts/menu-core, @you/greeter, or a folder: ../greeter');
	}
	if (local && listed?.type === 'official') {
		const dir = localModules[name];
		if (!dir) throw new CliError(`--local: the core has no folder for ${name}`, `Its package.json links the official modules with file: - ${name} is not among them.`);
		return { name, dir, tagline: taglineOf(dir), requires: listed.requires, listed: true };
	}
	return { name, dir: null, tagline: listed?.description ?? '', requires: listed?.requires ?? [], listed: Boolean(listed) };
}

/**
 * The modules, each followed by what it requires and was not given - and
 * what that requires, in turn: the order `modules` lists them in.
 * @param {ModuleRef[]} modules
 * @param {{ catalog?: CatalogModule[], local?: boolean, localModules?: Record<string, string> }} options how a required one is resolved
 * @returns {ModuleRef[]} the modules with all they require
 */
export function withRequired(modules, options) {
	const names = new Set(modules.map(each => each.name));
	const all = [];
	const next = modules.toReversed();
	while (next.length) {
		const module = next.pop();
		all.push(module);
		const required = module.requires.filter(name => !names.has(name)).map(name => resolveModule(name, options));
		for (const each of required) names.add(each.name);
		next.push(...required.toReversed());
	}
	return all;
}

/**
 * @typedef {object} ConfigEntry a module as `modules` in amxts.config.ts lists it
 * @property {string} name its package: "@amxts/config-core"
 * @property {string[]} [by] the modules that need it, when it is listed for them: "menu-core"
 */

/**
 * What `modules` lists for the chosen modules: withRequired()'s order, a
 * module that was not chosen with the ones that need it.
 * @param {ModuleRef[]} all withRequired()'s modules
 * @param {ModuleRef[]} chosen the ones asked for
 * @returns {ConfigEntry[]} the entries
 */
export function configEntries(all, chosen) {
	return all.map(module => ({
		name: module.name,
		by: chosen.includes(module) ? [] : all.filter(other => other.requires.includes(module.name)).map(other => shortName(other.name)),
	}));
}

/** The other @amxts modules a package says it needs: its peer dependencies but the core. */
function requiresOf(json) {
	return Object.keys(json.peerDependencies ?? {}).filter(name => name.startsWith(`${OFFICIAL_SCOPE}/`) && name !== '@amxts/core');
}

/**
 * The spec a package.json gives a package: the version asked for, or a link
 * to its folder. A link, not a copy: a copy is what the package would publish
 * (npm pack), and the core's folder has more than that - the patched
 * compiler, the generated API. npm links a `file:` folder; pnpm and yarn copy
 * it and link a `link:` one.
 */
export function specFor(ref, projectDir, pm = 'npm', version = 'latest') {
	if (!ref.dir) return version;
	// bun copies a file: folder and fails on it on Windows; its own link:
	// takes a package registered with `bun link`, so it is registered first.
	if (pm === 'bun') return bunLink(ref);
	const path = relative(projectDir, ref.dir).replace(/\\/g, '/');
	const protocol = pm === 'pnpm' || pm === 'yarn' ? 'link:' : 'file:';
	return `${protocol}${isAbsolute(path) ? path : path.startsWith('.') ? path : `./${path}`}`;
}

/** What the package manager is given to install it: its folder or its name. */
export function installTarget(ref, projectDir, pm) {
	return ref.dir ? specFor(ref, projectDir, pm) : ref.name;
}

const bunLinked = new Set();

/** `link:<name>` for bun, after `bun link` in the package's folder registered it. */
function bunLink(ref) {
	if (!bunLinked.has(ref.dir)) {
		spawnSync('bun', ['link'], { cwd: ref.dir, stdio: 'ignore' });
		bunLinked.add(ref.dir);
	}
	return `link:${ref.name}`;
}
