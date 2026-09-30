// What the tests share: running the command as a user runs it, and a folder
// that is gone after the test.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(ROOT, 'packages', 'cli', 'bin', 'amxts.mjs');

/**
 * Runs a script with Node, without colors and as from a shell - no package
 * manager's agent, which `bun run test` would pass on and the command would
 * take for the user's: its exit code and everything it printed.
 */
export function node(script: string, args: string[], cwd = process.cwd(), env: Record<string, string> = {}) {
	const { FORCE_COLOR: _, npm_config_user_agent: __, ...inherited } = process.env;
	const run = spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', [script, ...args], { cwd, encoding: 'utf8', env: { ...inherited, NO_COLOR: '1', ...env } });
	return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

/** Runs the amxts command in a folder. */
export function amxts(args: string[], cwd = process.cwd()) {
	return node(BIN, args, cwd);
}

/** A folder for one test, removed after it. */
export function inTemp(body: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-cli-'));
	try {
		body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
