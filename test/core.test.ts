// How the command finds the project's core and checks it can drive it: the
// version range, and the `@amxts/core/cli-api` contract.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { CLI_API, localCore, satisfies } from '../packages/cli/src/core.mjs';
import { amxts, inTemp } from './helpers';

/**
 * A project with a stand-in core in its node_modules: a package.json with this
 * version, and a cli-api (when `api` is given) whose tasks run `task.mjs` with
 * Node, which prints what it was asked for. Its server has its includes, so
 * nothing is fetched before a task.
 */
function project(dir: string, version: string, api?: number) {
	writeFileSync(join(dir, 'package.json'), '{ "name": "my-server", "private": true }\n');
	mkdirSync(join(dir, 'hlds', 'cstrike', 'addons', 'amxmodx', 'scripting', 'include'), { recursive: true });
	writeFileSync(join(dir, '.env'), `AMXTS_SERVER=${join(dir, 'hlds', 'cstrike', 'addons', 'amxts').replace(/\\/g, '/')}\n`);
	const core = join(dir, 'node_modules', '@amxts', 'core');
	mkdirSync(core, { recursive: true });
	const exports = api === undefined ? { './*': './*' } : { './cli-api': './cli-api.mjs', './package.json': './package.json' };
	writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@amxts/core', version, type: 'module', exports }));
	if (api === undefined) return;
	writeFileSync(join(core, 'task.mjs'), 'console.log("task", ...process.argv.slice(2));\n');
	writeFileSync(join(core, 'cli-api.mjs'), [
		'import { fileURLToPath } from "node:url";',
		`export const version = ${JSON.stringify(version)};`,
		`export const cliApi = ${api};`,
		'export const fromSource = false;',
		'export const task = (name, args = []) => ({ runtime: name === "build" ? "bun" : "node", args: [fileURLToPath(new URL("./task.mjs", import.meta.url)), name, ...args] });',
		// Its Bun is the runtime these tests run on, by its path: not a Bun on PATH.
		`export const bunBinary = () => ${JSON.stringify(process.execPath)};`,
		'',
	].join('\n'));
}

test('a core version is one the command works with: the same major, from the range up', () => {
	expect(satisfies('2.0.0', '^2.0.0')).toBe(true);
	expect(satisfies('2.4.1', '^2.0.0')).toBe(true);
	expect(satisfies('2.0.0-beta.1', '^2.0.0')).toBe(true);
	expect(satisfies('1.9.9', '^2.0.0')).toBe(false);
	expect(satisfies('3.0.0', '^2.0.0')).toBe(false);
	expect(satisfies('2.1.0', '^2.2.0')).toBe(false);
});

test('below 1.0 the minor is the breaking number', () => {
	expect(satisfies('0.1.0', '^0.1.0')).toBe(true);
	expect(satisfies('0.1.7', '^0.1.0')).toBe(true);
	expect(satisfies('0.2.0', '^0.1.0')).toBe(false);
	expect(satisfies('0.0.9', '^0.1.0')).toBe(false);
	expect(satisfies('1.0.0', '^0.1.0')).toBe(false);
});

describe('the project\'s core', () => {
	test('the command runs the core\'s task in the project', () => {
		inTemp((dir) => {
			project(dir, '0.1.0', CLI_API);
			const run = amxts(['prepare'], dir);
			expect(run.out).toBe('task prepare\n');
			expect(run.code).toBe(0);
		});
	});

	test('a bun task runs on the Bun the core comes with', () => {
		inTemp((dir) => {
			project(dir, '0.1.0', CLI_API);
			const run = amxts(['build'], dir);
			expect(run.out).toContain('task build\n');
			expect(run.code).toBe(0);
		});
	});

	test('no core: how to install it', () => {
		inTemp((dir) => {
			writeFileSync(join(dir, 'package.json'), '{ "name": "my-server", "private": true }\n');
			const run = amxts(['build'], dir);
			expect(run.code).toBe(1);
			expect(run.out).toBe('✖ @amxts/core is not installed in this project\n  Install it: npm install -D @amxts/core\n');
		});
	});

	test('an older core: update the core', () => {
		inTemp((dir) => {
			project(dir, '0.0.5', CLI_API);
			const run = amxts(['build'], dir);
			expect(run.code).toBe(1);
			expect(run.out).toContain('✖ @amxts/core 0.0.5 is not a core amxts 0.1.0 works with (^0.1.0)\n  Update the core: npm install -D @amxts/core@latest\n');
		});
	});

	test('a newer core: update the command', () => {
		inTemp((dir) => {
			project(dir, '0.2.0', CLI_API);
			const run = amxts(['build'], dir);
			expect(run.code).toBe(1);
			expect(run.out).toContain('✖ @amxts/core 0.2.0 is not a core amxts 0.1.0 works with (^0.1.0)\n  Update the command: npm install -g @amxts/cli@latest');
		});
	});

	test('a core without the cli-api, and one that speaks another', () => {
		inTemp((dir) => {
			project(dir, '0.1.0');
			expect(amxts(['build'], dir).out).toContain('✖ @amxts/core 0.1.0 has no cli-api, which amxts 0.1.0 runs it through\n  Update the core');
		});
		inTemp((dir) => {
			project(dir, '0.1.3', CLI_API + 1);
			expect(amxts(['build'], dir).out).toContain(`✖ @amxts/core 0.1.3 speaks cli-api ${CLI_API + 1}, amxts 0.1.0 speaks ${CLI_API}\n  Update the command`);
		});
	});
});

test('the core on this machine: the one the checkout links, driven through its cli-api', async () => {
	const core = await localCore();
	expect(core).not.toBeNull();
	expect(satisfies(core!.version)).toBe(true);
	expect(core!.api.cliApi).toBe(CLI_API);
	expect(core!.api.task('build', ['--deploy']).runtime).toBe('bun');
	expect(Object.keys(core!.api.localModules())).toEqual(expect.arrayContaining(['@amxts/config-core', '@amxts/menu-core']));
});
