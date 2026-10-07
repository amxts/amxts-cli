// The line that says a newer amxts is out: `amxts 0.2.5 is out: npx amxts
// upgrade`. Read from a file the last check wrote, so it costs a command
// nothing; once a day a check runs in a process of its own, left behind, and
// writes it again. Only in a terminal, not in CI; AMXTS_IGNORE_UPDATE_CHECK=1
// turns it off.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './core.mjs';
import { execAmxts } from './pm.mjs';
import { isCI } from './ui.mjs';

/** Where the last check is kept: `{ checked, latest }`. */
export const UPDATE_FILE = join(homedir(), '.cache', 'amxts', 'update.json');
const DAY = 24 * 60 * 60 * 1000;

function save(file, data) {
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify(data)}\n`);
	} catch {}
}

/**
 * The line about a newer core than the project's, or null; starts the day's
 * check when the last one is older.
 * @param {string} version the project's core
 * @param {string} pm its package manager, for the words
 * @param {{ env?: Record<string, string | undefined>, tty?: boolean, now?: number, file?: string, check?: (file: string) => void }} [options]
 */
export function updateLine(version, pm, { env = process.env, tty = Boolean(process.stdout.isTTY), now = Date.now(), file = UPDATE_FILE, check = startCheck } = {}) {
	if (env.AMXTS_IGNORE_UPDATE_CHECK === '1' || !tty || isCI(env)) return null;
	let last = {};
	try {
		last = JSON.parse(readFileSync(file, 'utf8'));
	} catch {}
	if (!(now - (last.checked ?? 0) < DAY)) {
		// Written first: a second command in the same minute does not check again.
		save(file, { ...last, checked: now });
		check(file);
	}
	return last.latest && compareVersions(last.latest, version) > 0 ? `amxts ${last.latest} is out: ${execAmxts(pm)} upgrade` : null;
}

/** Starts the check in a process of its own, which the command does not wait for. */
function startCheck(file) {
	try {
		spawn(process.execPath, [fileURLToPath(import.meta.url), file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
	} catch {}
}

// The check itself: the latest @amxts/core on the registry npm is set to.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const file = process.argv[2];
	const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/?$/, '/');
	try {
		const response = await fetch(`${registry}@amxts/core/latest`, { signal: AbortSignal.timeout(10_000) });
		const { version } = await response.json();
		if (typeof version === 'string') save(file, { checked: Date.now(), latest: version });
	} catch {}
}
