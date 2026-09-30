// The server's system: what the build compiles plugins for. `init` reads it
// off the server's folder or keeps --os in .env; `build` and `dev` pass --os on.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { serverSystemOf } from '../packages/cli/src/system.mjs';
import { amxts, inTemp } from './helpers';

/** An install with hlds' own file in it; its addons/amxts. */
function server(dir: string, hlds: string): string {
	mkdirSync(join(dir, 'cstrike/addons/amxts'), { recursive: true });
	writeFileSync(join(dir, hlds), '');
	return join(dir, 'cstrike/addons/amxts');
}

test('the system is read off the server: hlds_linux or hlds.exe beside the game', () => {
	inTemp((dir) => {
		expect(serverSystemOf(server(join(dir, 'l'), 'hlds_linux'))).toBe('linux');
		expect(serverSystemOf(server(join(dir, 'w'), 'hlds.exe'))).toBe('windows');
		expect(serverSystemOf(join(dir, 'none/cstrike/addons/amxts'))).toBeNull();
		expect(serverSystemOf('')).toBeNull();
	});
});

test('init keeps --os in .env when the server does not show it, and not when it does', () => {
	inTemp((dir) => {
		const flags = ['--modules', '', '--no-lint', '--no-git', '--no-install', '--yes'];
		expect(amxts(['init', 'remote', '--os', 'linux', ...flags], dir).code).toBe(0);
		expect(readFileSync(join(dir, 'remote', '.env'), 'utf8')).toContain('AMXTS_SERVER_OS=linux');

		const linux = server(join(dir, 'hlds'), 'hlds_linux');
		expect(amxts(['init', 'local', '--server', linux, '--os', 'windows', ...flags], dir).code).toBe(0);
		expect(readFileSync(join(dir, 'local', '.env'), 'utf8')).not.toContain('AMXTS_SERVER_OS');

		const wrong = amxts(['init', 'other', '--os', 'mac', ...flags], dir);
		expect(wrong.code).toBe(1);
		expect(wrong.out).toContain('--os mac: windows or linux');
	});
});

test('build and dev take --os and refuse a system they do not know', () => {
	inTemp((dir) => {
		const build = amxts(['build', '--os', 'mac'], dir);
		expect(build.code).toBe(1);
		expect(build.out).toContain('--os mac: windows or linux');
		expect(amxts(['build', '--help'], dir).out).toContain('--os <windows|linux>');
		expect(amxts(['dev', '--help'], dir).out).toContain('--os <windows|linux>');
	});
});
