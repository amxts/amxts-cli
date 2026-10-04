// `amxts upgrade`: a project moved to another amxts release in one command.
//
//   amxts upgrade [--to <version>] [--no-server] [--server-only] [--dry-run]
//
// 1. The packages: the core to the latest version on the registry npm is set
//    to, or to --to; every other @amxts/ package in package.json - the
//    official modules, the command - to its own newest version that works
//    with that core (registry.mjs), in the style the project writes its
//    ranges (`^0.1.0` → `^0.2.0`); then the project's own package manager
//    installs.
// 2. The code: the new core's rewrites (its `upgrade` task), each change listed.
// 3. The build: `amxts build`.
// 4. The server in AMXTS_SERVER: its module, and its compiler where it has
//    one, from the release of the new version (server-update.mjs).
// 5. A summary: the versions, the files rewritten, what to check by hand and
//    the server's result.
//
// A command of one release drives cores of that release only, so once the
// packages are installed a command of another version hands the rest to the
// project's new one: `amxts upgrade --to <version>` again, with the versions
// it started from in AMXTS_UPGRADE_FROM.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { coreDirFrom, loadCore, needProject, readJson, runTask, satisfies, VERSION } from './core.mjs';
import { prepare } from './includes.mjs';
import { commandLine, detectPackageManager, installArgs, installLinked, linkedFolders } from './pm.mjs';
import { CORE, npmRegistry, versionsFor } from './registry.mjs';
import { updateServer } from './server-update.mjs';
import { banner, c, CliError, log } from './ui.mjs';

const VERSION_TEXT = /^v?(\d+\.\d+\.\d+(?:-[\d.a-z-]+)?)$/i;

/** A spec upgrade moves: a version, with `^`, `~`, `=` or `>=` before it. */
const MOVABLE = /^([~^]|>?=)?\d+\.\d+\.\d+(?:-[\d.a-z-]+)?$/i;

/**
 * A spec at another version, in the style it was written: `^0.1.0` →
 * `^0.2.0`, `~0.1.0` → `~0.2.0`, `0.1.0` → `0.2.0`. Null for a spec upgrade
 * leaves as it is: a folder (`file:`, `link:`), a tag, a range of its own.
 * @param {string} spec
 * @param {string} version
 */
export function bumpSpec(spec, version) {
	const match = MOVABLE.exec(spec.trim());
	return match ? `${match[1] ?? ''}${version}` : null;
}

/**
 * @typedef {object} Bump
 * @property {string} name the package
 * @property {string} spec as package.json has it
 * @property {string | null} version the version it goes to; null when it is left as it is
 * @property {string | null} to the spec at that version; null when it is left as it is
 */

/** The @amxts/ packages of a project's package.json, with their specs. */
function amxtsPackages(pkg) {
	return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) => name.startsWith('@amxts/')).map(([name, spec]) => ({ name, spec: String(spec) }));
}

/**
 * The @amxts/ packages of a project's package.json, and their specs at the versions they go to.
 * @param {Record<string, any>} pkg
 * @param {Record<string, string | null>} versions each package's new version, by name
 * @returns {Bump[]} the packages
 */
export function packageBumps(pkg, versions) {
	return amxtsPackages(pkg).map(({ name, spec }) => {
		const to = versions[name] ? bumpSpec(spec, versions[name]) : null;
		return { name, spec, version: to && versions[name], to };
	});
}

/** package.json's text with the specs moved, everything else as it was written. */
export function writeBumps(text, bumps) {
	return bumps.filter(bump => bump.to && bump.to !== bump.spec).reduce((out, bump) => {
		const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return out.replace(new RegExp(`("${escape(bump.name)}"\\s*:\\s*")${escape(bump.spec)}"`, 'g'), `$1${bump.to}"`);
	}, text);
}

/** The version of a package the project has installed, or null. */
function installedVersion(dir, name) {
	return readJson(join(dir, 'node_modules', name, 'package.json'))?.version ?? null;
}

/** Runs the project's install, quietly, with a line before and after; its output when it fails. */
async function installProject(dir, pm) {
	const argv = installArgs(pm);
	log.step(`Installing with ${pm}`);
	const result = await installLinked(argv, linkedFolders(dir), { cwd: dir, quiet: true });
	if (result.code !== 0) {
		throw new CliError(`${commandLine(argv)} failed`, result.output.trim().split('\n').slice(-15).join('\n'));
	}
	log.success(`Installed with ${pm}`);
}

/** The command a project's core runs - `npx amxts` - by its folder, or null. */
function projectCommand(coreDir) {
	try {
		return join(createRequire(join(coreDir, 'package.json')).resolve('@amxts/cli/package.json'), '..');
	} catch {
		return null;
	}
}

/**
 * The code step: the core's rewrites, listed as they are made; with
 * `dryRun`, listed only. What they changed and left, from the task's report.
 */
function rewriteCode(core, dryRun) {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-upgrade-'));
	try {
		const report = join(dir, 'report.json');
		if (runTask(core, 'upgrade', ['--report', report, ...(dryRun ? ['--dry-run'] : [])]) !== 0) {
			throw new CliError('The code was not upgraded', 'The error is above.');
		}
		return JSON.parse(readFileSync(report, 'utf8'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * @typedef {object} Outcome
 * @property {string} version the release the project moves to: the core's version
 * @property {{ name: string, from: string | null, version: string | null, to: string | null, spec: string }[]} packages each @amxts/ package, and the version and spec it goes to; null when left as it is
 * @property {{ files: string[], left: { file: string, line: number, why: string }[] } | null} code what the rewrites changed and left; null when they did not run
 * @property {'built' | 'failed' | null} build how the build went; null when it did not run
 * @property {import('./server-update.mjs').ServerOutcome | null} server the server step's result; null with --no-server
 * @property {boolean} dryRun whether nothing was changed
 */

/**
 * What `amxts upgrade` prints last.
 * @param {Outcome} outcome
 * @returns {string[]} the lines
 */
export function summary(outcome) {
	const lines = [];
	const would = outcome.dryRun ? 'would be ' : '';
	const moved = outcome.packages.filter(each => each.to);
	const width = Math.max(0, ...moved.map(each => each.name.length));
	lines.push(c.bold(outcome.dryRun ? `Dry run: amxts ${outcome.version}, nothing was changed` : `Upgraded to amxts ${outcome.version}`));
	for (const each of moved) lines.push(`  ${each.name.padEnd(width)}  ${each.from === each.version ? `${each.version} ${c.dim('(already)')}` : `${each.from ?? each.spec} ${c.dim('→')} ${each.version}`}`);
	for (const each of outcome.packages.filter(one => !one.to)) lines.push(`  ${each.name.padEnd(width)}  ${each.spec} ${c.dim('(left as it is)')}`);
	if (outcome.code) {
		lines.push(outcome.code.files.length ? `  ${c.green('✔')} ${would}rewritten: ${outcome.code.files.join(', ')}` : `  ${c.green('✔')} the code already uses this API`);
		if (outcome.code.left.length) {
			lines.push(`  ${c.yellow('▲')} to check by hand:`);
			for (const each of outcome.code.left) lines.push(`      ${c.dim(`${each.file}:${each.line}`)}  ${each.why}`);
		}
	}
	if (outcome.build) lines.push(outcome.build === 'built' ? `  ${c.green('✔')} built` : `  ${c.red('✖')} the build failed: see above`);
	if (outcome.server) lines.push(`  ${outcome.server.ok ? c.green('✔') : c.yellow('▲')} server: ${outcome.server.line}`);
	return lines;
}

/**
 * `amxts upgrade`.
 * @param {{ to?: string, server?: boolean, serverOnly?: boolean, dryRun?: boolean }} options
 * @param {{ dir?: string, registry?: import('./registry.mjs').Registry, install?: typeof installProject }} [deps] what the tests replace
 * @returns {Promise<Outcome | null>} what was done; null when it was handed to the project's command
 */
export async function upgrade({ to, server = true, serverOnly = false, dryRun = false }, { dir = needProject(), registry = npmRegistry(dir), install = installProject } = {}) {
	const handedFrom = process.env.AMXTS_UPGRADE_FROM ? JSON.parse(process.env.AMXTS_UPGRADE_FROM) : null;
	if (!handedFrom) banner(VERSION, dryRun ? 'upgrade --dry-run' : 'upgrade');
	if (to !== undefined && !VERSION_TEXT.test(to)) throw new CliError(`--to ${to}: a version, such as 0.2.0`);

	if (serverOnly) {
		const core = await loadCore(coreDirFrom(dir) ?? needCore());
		/** @type {Outcome} */
		const outcome = { version: core.version, packages: [], code: null, build: null, server: await updateServer(core.api, dir, { dryRun }), dryRun };
		console.log(['', ...summary(outcome)].join('\n'));
		return outcome;
	}

	const pkg = readJson(join(dir, 'package.json')) ?? {};
	const { version, versions } = handedFrom ? installed(dir, pkg, VERSION_TEXT.exec(to)[1]) : await newest(registry, dir, pkg, to ? VERSION_TEXT.exec(to)[1] : 'latest');
	const bumps = packageBumps(pkg, versions);
	const from = handedFrom ?? Object.fromEntries(bumps.map(bump => [bump.name, installedVersion(dir, bump.name)]));
	const moving = bumps.filter(bump => bump.to && (bump.to !== bump.spec || from[bump.name] !== bump.version));

	if (!handedFrom) {
		log.step(`Packages: amxts ${version}${to ? '' : c.dim(' (latest)')}`);
		for (const bump of bumps) log.info(`${bump.name}  ${bump.spec} ${!bump.to ? c.dim('(left as it is)') : moving.includes(bump) ? `${c.dim('→')} ${bump.to}` : c.dim('(already)')}`);
		if (!dryRun && moving.length) {
			const path = join(dir, 'package.json');
			writeFileSync(path, writeBumps(readFileSync(path, 'utf8'), bumps));
			await install(dir, detectPackageManager(dir));
		}
	}

	// A core this command cannot drive is handed, with the rest, to the command it came with.
	const coreDir = coreDirFrom(dir);
	const coreVersion = coreDir ? readJson(join(coreDir, 'package.json'))?.version : null;
	const command = !dryRun && coreVersion && !satisfies(coreVersion) ? projectCommand(coreDir) : null;
	const commandVersion = command ? readJson(join(command, 'package.json'))?.version : null;
	if (command && commandVersion && commandVersion !== VERSION) {
		log.step(`Going on with the project's amxts ${commandVersion}`);
		const args = [join(command, 'bin', 'amxts.mjs'), 'upgrade', '--to', version, ...(server ? [] : ['--no-server'])];
		const result = spawnSync(process.execPath, args, { cwd: dir, stdio: 'inherit', env: { ...process.env, AMXTS_UPGRADE_FROM: JSON.stringify(from) } });
		process.exitCode = result.status ?? 1;
		return null;
	}

	// With the new core installed - or, in a dry run, the installed one when it is already that version.
	const core = coreDir && (!dryRun || from[CORE] === version) ? await loadCore(coreDir) : null;
	/** @type {Outcome} */
	const outcome = {
		version,
		packages: bumps.map(bump => ({ name: bump.name, spec: bump.spec, from: from[bump.name], version: bump.version, to: bump.to })),
		code: null,
		build: null,
		server: null,
		dryRun,
	};

	if (core) {
		log.step(dryRun ? 'Code: what the rewrites would change' : 'Code');
		const report = rewriteCode(core, dryRun);
		outcome.code = { files: [...new Set(report.changes.map(change => change.file))], left: report.left };
	} else {
		log.step(`Code: rewritten by @amxts/core ${version} once it is installed`);
	}

	if (core && !dryRun) {
		log.step('Build');
		await prepare(core, { quiet: true });
		outcome.build = runTask(core, 'build') === 0 ? 'built' : 'failed';
	}

	if (server) {
		outcome.server = core
			? await updateServer(core.api, dir, { dryRun })
			: { ok: true, line: `the module of amxts ${version} goes in once @amxts/core ${version} is installed` };
	}
	console.log(['', ...summary(outcome)].join('\n'));
	return outcome;
}

/**
 * The core of `core` - a version, or `latest` - and the version each @amxts/
 * package of the project goes to: the core's own, the others' newest that
 * works with it. Only a package whose spec moves is asked for, and nothing
 * when the project has that core already and nothing else moves.
 */
async function newest(registry, dir, pkg, core) {
	const names = amxtsPackages(pkg).filter(each => each.name !== CORE && MOVABLE.test(each.spec.trim())).map(each => each.name);
	if (!names.length && installedVersion(dir, CORE) === core) return { version: core, versions: { [CORE]: core } };
	const found = await versionsFor(registry, core, names);
	return { version: found.core, versions: { ...found.versions, [CORE]: found.core } };
}

/** The versions the command that handed the upgrade on installed: the core's, and each package's. */
function installed(dir, pkg, version) {
	return { version, versions: Object.fromEntries(amxtsPackages(pkg).map(each => [each.name, installedVersion(dir, each.name)])) };
}

function needCore() {
	throw new CliError('@amxts/core is not installed in this project', 'Run amxts upgrade without --server-only first.');
}
