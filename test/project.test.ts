// What the commands that work on a project do around the core's tasks:
// `module add` prepares after it lists the module.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { CLI_API } from '../packages/cli/src/core.mjs';
import { amxts, inTemp, ROOT, standInProject } from './helpers';

/** The catalog the command ships: no network in a test. */
const CATALOG = { AMXTS_CATALOG: join(ROOT, 'packages', 'cli', 'src', 'modules.json') };

test('module add lists the module in amxts.config.ts, then prepares: the editor config names it', () => {
	inTemp((dir) => {
		standInProject(dir, '0.1.0', CLI_API);
		writeFileSync(join(dir, 'amxts.config.ts'), 'export default defineConfig({\n\tmodules: [],\n});\n');
		const run = amxts(['module', 'add', 'menu-core', '--skip-install'], dir, CATALOG);
		expect(run.code).toBe(0);
		expect(run.out).toContain('✔ Added @amxts/menu-core to amxts.config.ts\ntask prepare\nmodules: ["@amxts/menu-core"],\n');
	});
});
