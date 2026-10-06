// How the command finds the project's core and checks it can drive it: the
// version range, and the `@amxts/core/cli-api` contract.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { CLI_API, CORE_RANGE, localCore, satisfies, VERSION } from '../packages/cli/src/core.mjs';
import { amxts, CORE, inTemp, NEXT_CORE, standInProject } from './helpers';

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

test('a module\'s range for the core, as npm reads it', () => {
	expect(satisfies('0.2.3', '~0.2.1')).toBe(true);
	expect(satisfies('0.3.0', '~0.2.1')).toBe(false);
	expect(satisfies('0.3.0', '>=0.2.0 <0.4.0')).toBe(true);
	expect(satisfies('0.4.0', '>=0.2.0 <0.4.0')).toBe(false);
	expect(satisfies('0.3.1', '^0.2.0 || ^0.3.0')).toBe(true);
	expect(satisfies('0.2.0', '0.2.0')).toBe(true);
	expect(satisfies('0.2.1', '0.2.0')).toBe(false);
	expect(satisfies('0.0.6', '^0.0.5')).toBe(false);
	expect(satisfies('9.9.9', '*')).toBe(true);
});

describe('the project\'s core', () => {
	test('the command runs the core\'s task in the project', () => {
		inTemp((dir) => {
			standInProject(dir, CORE, CLI_API);
			const run = amxts(['prepare'], dir);
			expect(run.out).toBe('task prepare\n');
			expect(run.code).toBe(0);
		});
	});

	test('a bun task runs on the Bun the core comes with', () => {
		inTemp((dir) => {
			standInProject(dir, CORE, CLI_API);
			const run = amxts(['build'], dir);
			expect(run.out).toContain('task build\n');
			expect(run.code).toBe(0);
		});
	});

	test('build prepares quietly - the build says what the project is - and prepare says what it wrote', () => {
		inTemp((dir) => {
			standInProject(dir, CORE, CLI_API);
			const run = amxts(['build'], dir);
			expect(run.out).toBe(`amxts ${CORE} · build\ntask prepare --quiet\ntask build\n`);
			expect(amxts(['prepare'], dir).out).toBe('task prepare\n');
		});
	});

	test('test runs the project\'s Vitest when it has one', () => {
		inTemp((dir) => {
			standInProject(dir, CORE, CLI_API);
			mkdirSync(join(dir, 'node_modules', 'vitest'));
			writeFileSync(join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'console.log("vitest", ...process.argv.slice(2));\n');
			const run = amxts(['test', 'hello'], dir);
			expect(run.out).toBe('vitest run hello\n');
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

	test('an older core: move the project to this command\'s release', () => {
		inTemp((dir) => {
			standInProject(dir, '0.0.5', CLI_API);
			const run = amxts(['build'], dir);
			expect(run.code).toBe(1);
			expect(run.out).toContain(`✖ @amxts/core 0.0.5 is not a core amxts ${VERSION} works with (${CORE_RANGE})\n  Move the project to amxts ${VERSION}: npx amxts upgrade\n`);
		});
	});

	test('a newer core: update the command', () => {
		inTemp((dir) => {
			standInProject(dir, NEXT_CORE, CLI_API);
			const run = amxts(['build'], dir);
			expect(run.code).toBe(1);
			expect(run.out).toContain(`✖ @amxts/core ${NEXT_CORE} is not a core amxts ${VERSION} works with (${CORE_RANGE})\n  Update the command: npm install -g @amxts/cli@latest`);
		});
	});

	test('a core without the cli-api, and one that speaks another', () => {
		inTemp((dir) => {
			standInProject(dir, CORE);
			expect(amxts(['build'], dir).out).toContain(`✖ @amxts/core ${CORE} has no cli-api, which amxts ${VERSION} runs it through\n  Move the project to amxts ${VERSION}: npx amxts upgrade`);
		});
		inTemp((dir) => {
			standInProject(dir, CORE, CLI_API + 1);
			expect(amxts(['build'], dir).out).toContain(`✖ @amxts/core ${CORE} speaks cli-api ${CLI_API + 1}, amxts ${VERSION} speaks ${CLI_API}\n  Update the command`);
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
