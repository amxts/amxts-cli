// One `amxts dev` per project: two would build and deploy at the same time.
// The one running holds .amxts/dev.lock - its pid, when it started and its
// script. A second one stops with where the first runs; --takeover stops the
// first instead, once its command line shows it is still that amxts dev - a
// pid alone could be a new process by now. A lock whose process is gone is
// taken over quietly.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { CliError } from './ui.mjs';

/** The lock of a project's dev. */
export const lockPath = root => join(root, '.amxts', 'dev.lock');

/** Whether a process is there: a signal 0 reaches it, or it is someone else's. */
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

/** A process's command line, or '' when it cannot be read. */
export function commandLineOf(pid) {
	try {
		if (process.platform === 'win32') {
			return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`], { encoding: 'utf8', windowsHide: true }).trim();
		}
		if (process.platform === 'linux') return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
		return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

/** The lock's holder, when it is still the dev that wrote it: alive, and running the same script. */
function holder(lock) {
	if (!lock?.pid || lock.pid === process.pid || !alive(lock.pid)) return null;
	const line = commandLineOf(lock.pid).replace(/\\/g, '/');
	return line.includes(String(lock.script).replace(/\\/g, '/')) ? lock : null;
}

/** Stops a process and what it started: on Windows the whole tree, elsewhere it stops its own (dev does, on SIGTERM). */
export function stopTree(pid) {
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
	} else {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {}
	}
}

/** Stops a process (stopTree) and waits up to `wait` ms for it to be gone. */
function stop(pid, wait = 5000) {
	stopTree(pid);
	const until = Date.now() + wait;
	while (alive(pid) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	return !alive(pid);
}

/**
 * Takes the project's dev lock, released when this process exits.
 * @param {string} root the project's folder
 * @param {{ takeover?: boolean, script?: string, say?: (line: string) => void }} [options]
 * @throws {CliError} when another dev holds it and `takeover` is not given
 */
export function takeLock(root, { takeover = false, script = process.argv[1], say = () => {} } = {}) {
	const path = lockPath(root);
	let lock = null;
	try {
		lock = JSON.parse(readFileSync(path, 'utf8'));
	} catch {}
	const other = holder(lock);
	if (other) {
		const since = new Date(other.since).toLocaleString();
		if (!takeover) {
			throw new CliError(`amxts dev is already running in another terminal (pid ${other.pid}, since ${since})`, 'Stop it there, or take it over: amxts dev --takeover');
		}
		// Read again just before stopping it: the pid must still be that dev.
		if (holder(other) && !stop(other.pid)) throw new CliError(`amxts dev (pid ${other.pid}) did not stop`, 'Stop it in its terminal, then run amxts dev again.');
		say(`stopped the amxts dev that ran since ${since} (pid ${other.pid})`);
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ pid: process.pid, since: new Date().toISOString(), script })}\n`);
	process.on('exit', () => {
		try {
			if (JSON.parse(readFileSync(path, 'utf8')).pid === process.pid) rmSync(path, { force: true });
		} catch {}
	});
}
