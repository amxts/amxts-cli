// The package manager a project uses - npm, pnpm, yarn or bun - and the
// commands each one spells its own way.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

const LOCKFILES = [
	['bun.lock', 'bun'],
	['bun.lockb', 'bun'],
	['pnpm-lock.yaml', 'pnpm'],
	['yarn.lock', 'yarn'],
	['package-lock.json', 'npm'],
];

/** The package manager that started this process - `npm create`, `pnpm dlx`, `bunx` - from its user agent. */
export function packageManagerOfAgent(agent = process.env.npm_config_user_agent ?? '') {
	const name = agent.split('/')[0];
	return PACKAGE_MANAGERS.includes(name) ? name : null;
}

/**
 * The project's package manager: its lockfile, its package.json's
 * "packageManager", the one running this command, else npm.
 */
export function detectPackageManager(dir = process.cwd()) {
	for (let at = resolve(dir); ; at = dirname(at)) {
		for (const [file, pm] of LOCKFILES) {
			if (existsSync(join(at, file))) return pm;
		}
		const pkg = join(at, 'package.json');
		if (existsSync(pkg)) {
			try {
				const field = JSON.parse(readFileSync(pkg, 'utf8')).packageManager;
				const name = typeof field === 'string' ? field.split('@')[0] : '';
				if (PACKAGE_MANAGERS.includes(name)) return name;
			} catch {}
		}
		if (dirname(at) === at) break;
	}
	return packageManagerOfAgent() ?? 'npm';
}

/** The version of an installed package manager (or bun, git), or null when it is not there. */
export function versionOf(tool) {
	// Through the shell on Windows, where npm and bun are .cmd files.
	const run = process.platform === 'win32'
		? spawnSync(`${tool} --version`, { encoding: 'utf8', shell: true, windowsHide: true })
		: spawnSync(tool, ['--version'], { encoding: 'utf8' });
	if (run.status !== 0 || !run.stdout) return null;
	return run.stdout.trim().split('\n')[0].replace(/^v/, '');
}

/** `npm install`, `pnpm install`... - what installs a project's dependencies. */
export function installArgs(pm) {
	return [pm, 'install'];
}

/** What adds packages as dev dependencies. */
export function addArgs(pm, packages) {
	if (pm === 'npm') return ['npm', 'install', '-D', ...packages];
	if (pm === 'bun') return ['bun', 'add', '-d', ...packages];
	return [pm, 'add', '-D', ...packages];
}

/** How a package.json script is run: `npm run dev`, `pnpm dev`. */
export function runScript(pm, script) {
	return pm === 'npm' || pm === 'bun' ? `${pm} run ${script}` : `${pm} ${script}`;
}

/** How the project's amxts command is run: `npx amxts`, `pnpm amxts`. */
export function execAmxts(pm) {
	return { npm: 'npx amxts', pnpm: 'pnpm amxts', yarn: 'yarn amxts', bun: 'bunx amxts' }[pm] ?? 'npx amxts';
}

/**
 * The folders a project's package.json takes packages from - `link:` and
 * `file:` specs: the core and the modules of this machine (--local).
 * @param {string} projectDir
 * @param {string[]} [more] folders about to be added
 * @returns {string[]} the folders
 */
export function linkedFolders(projectDir, more = []) {
	let json = {};
	try {
		json = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
	} catch {}
	const specs = Object.values({ ...json.dependencies, ...json.devDependencies });
	const linked = specs.filter(spec => /^(?:link|file):(?:[./]|[a-z]:)/i.test(spec)).map(spec => resolve(projectDir, spec.replace(/^\w+:/, '')));
	return [...new Set([...linked, ...more])];
}

/**
 * Runs an install and leaves the `node_modules/.bin` of each linked folder
 * as it was. yarn 1 installs a `link:` folder's dependencies into the
 * project and points that folder's own `.bin` at them: the core's `tsc`,
 * `amxts` and `bun` would start the project's copies.
 * @param {string[]} argv
 * @param {string[]} linked the linked folders, `linkedFolders`
 * @param {Parameters<typeof run>[1]} [options]
 */
export async function installLinked(argv, linked, options) {
	const bins = linked.map(dir => join(dir, 'node_modules', '.bin'));
	const saved = bins.map(binsOf);
	const result = await run(argv, options);
	bins.forEach((dir, i) => putBack(dir, saved[i]));
	return result;
}

/** A `.bin` folder's entries: a link's target, or a file's bytes. Null when there is none. */
function binsOf(dir) {
	if (!existsSync(dir)) return null;
	return new Map(readdirSync(dir).map((name) => {
		const path = join(dir, name);
		const stat = lstatSync(path);
		return [name, stat.isSymbolicLink() ? { link: readlinkSync(path) } : { data: readFileSync(path), mode: stat.mode }];
	}));
}

/** Writes a `.bin` folder back as `binsOf` read it; what the install added goes. */
function putBack(dir, saved) {
	if (!saved) return;
	mkdirSync(dir, { recursive: true });
	for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true });
	for (const [name, entry] of saved) {
		if (entry.link) symlinkSync(entry.link, join(dir, name));
		else writeFileSync(join(dir, name), entry.data, { mode: entry.mode });
	}
}

/** A command line as it is shown, and as Windows' shell runs it: arguments with spaces, or with what that shell reads (`^0.2.0`), quoted. */
export function commandLine(argv) {
	return argv.map(arg => (/[\s^&|<>]/.test(arg) ? `"${arg}"` : arg)).join(' ');
}

/**
 * Runs a command. Through the shell on Windows, where npm and bun may be
 * .cmd files; `quiet` collects the output instead of showing it, for a
 * spinner, and hands it back for an error.
 *
 * @returns {Promise<{ code: number, output: string, stdout: string }>} its exit code, and its output when quiet - all of it, and what went to stdout alone
 */
export function run(argv, { cwd = process.cwd(), quiet = false, env } = {}) {
	return new Promise((done) => {
		const windows = process.platform === 'win32';
		const [command, ...args] = windows ? [commandLine(argv)] : argv;
		const child = spawn(command, args, {
			cwd,
			env: env ? { ...process.env, ...env } : process.env,
			shell: windows,
			stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
			windowsHide: true,
		});
		let output = '';
		let stdout = '';
		child.stdout?.on('data', (chunk) => {
			output += chunk;
			stdout += chunk;
		});
		child.stderr?.on('data', (chunk) => {
			output += chunk;
		});
		child.on('error', error => done({ code: 127, output: `${output}${error.message}`, stdout }));
		child.on('close', code => done({ code: code ?? 1, output, stdout }));
	});
}
