// The versions of the @amxts packages that go together. Every package has a
// version of its own: a module versions by its own API and names the cores it
// works with as a range (`peerDependencies`: `"@amxts/core": "^0.2.0"`); the
// core names the command and wamrc it comes with the same way. So for a core,
// each package's newest version that works with it - what `amxts upgrade`
// moves a project to, and what a new project and `amxts module add` install.
import { compareVersions, satisfies } from './core.mjs';
import { run } from './pm.mjs';
import { CliError } from './ui.mjs';

export const CORE = '@amxts/core';

/**
 * @typedef {object} Release a version of a package, as the registry has it
 * @property {string} version its version
 * @property {Record<string, string>} [dependencies] what it depends on, by range
 * @property {Record<string, string>} [peerDependencies] what it needs beside it: a module's core and modules
 * @property {Record<string, string>} [optionalDependencies] what it takes when there is one for the system: the core's wamrc
 */

/**
 * @typedef {object} Registry
 * @property {(name: string, spec?: string) => Promise<Release[]>} versions a package's versions of `spec` - `*`, a version, a tag - with what they depend on; none when it has none
 */

/**
 * The registry npm is set to - NPM_CONFIG_REGISTRY, .npmrc - through npm itself.
 * @param {string} dir the folder whose .npmrc npm reads
 * @returns {Registry} the registry
 */
export function npmRegistry(dir) {
	return {
		versions: async (name, spec = '*') => {
			const result = await run(['npm', 'view', `${name}@${spec}`, 'version', 'dependencies', 'peerDependencies', 'optionalDependencies', '--json'], { cwd: dir, quiet: true });
			if (result.code !== 0) {
				if (/E404|404 Not Found|No match found/.test(result.output)) return [];
				throw new CliError(`npm view ${name}@${spec} failed`, result.output.trim().split('\n').slice(-5).join('\n'));
			}
			// One version is an object, more a list; a version that depends on nothing, its version alone.
			return [JSON.parse(result.stdout.trim() || '[]')].flat().map(each => (typeof each === 'string' ? { version: each } : each));
		},
	};
}

/**
 * The newest of a package's releases that works with a core: one whose own
 * range for the core takes the core's version; for a package that names no
 * core, one the core's own range for it takes (the command, wamrc); else the
 * newest.
 * @param {Release[]} releases
 * @param {string} name
 * @param {Release} core
 * @returns {string | null} the version; null when none works with the core
 */
export function newestFor(releases, name, core) {
	const asked = core.dependencies?.[name] ?? core.optionalDependencies?.[name];
	const fits = (release) => {
		const range = release.peerDependencies?.[CORE] ?? release.dependencies?.[CORE];
		return range ? satisfies(core.version, range) : !asked || satisfies(release.version, asked);
	};
	return releases.filter(fits).map(each => each.version).sort(compareVersions).at(-1) ?? null;
}

/**
 * A core and, for it, the newest version of each package that works with it,
 * asked of the registry all at once. The core is a version, a tag (`latest`),
 * or a range, whose newest version it is. Throws, saying which, when the core
 * or a package has no such version.
 * @param {Registry} registry
 * @param {string} core
 * @param {string[]} names
 * @returns {Promise<{ core: string, versions: Record<string, string> }>} the core's version, and each package's
 */
export async function versionsFor(registry, core, names) {
	const range = !/^(?:\d+\.\d+\.\d+(?:-[\w.-]+)?|[a-z][\w-]*)$/i.test(core);
	const [cores, ...lists] = await Promise.all([registry.versions(CORE, range ? '*' : core), ...names.map(name => registry.versions(name))]);
	const found = cores.filter(each => !range || satisfies(each.version, core)).sort((a, b) => compareVersions(a.version, b.version)).at(-1);
	if (!found) throw new CliError(`${CORE} ${core} is not on the registry`, 'npm config get registry says which one npm asks.');
	const versions = names.map((name, i) => newestFor(lists[i], name, found));
	const missing = names.map((name, i) => !versions[i] && (lists[i].length ? `${name} has no version for ${CORE} ${found.version}` : `${name} is not on the registry`)).filter(Boolean);
	if (missing.length) throw new CliError(missing.join('\n'), `Each package takes its newest version that works with the core; a module that has none is not released for ${CORE} ${found.version} yet.`);
	return { core: found.version, versions: Object.fromEntries(names.map((name, i) => [name, versions[i]])) };
}
