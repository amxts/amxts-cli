// The package manager a project uses - npm, pnpm, yarn or bun - and the
// commands each one spells its own way.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/** A command line as it is shown: arguments with spaces quoted. */
export function commandLine(argv) {
	return argv.map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
}

/**
 * Runs a command. Through the shell on Windows, where npm and bun may be
 * .cmd files; `quiet` collects the output instead of showing it, for a
 * spinner, and hands it back for an error.
 *
 * @returns {Promise<{ code: number, output: string }>} its exit code, and its output when quiet
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
		child.stdout?.on('data', (chunk) => {
			output += chunk;
		});
		child.stderr?.on('data', (chunk) => {
			output += chunk;
		});
		child.on('error', error => done({ code: 127, output: `${output}${error.message}` }));
		child.on('close', code => done({ code: code ?? 1, output }));
	});
}
