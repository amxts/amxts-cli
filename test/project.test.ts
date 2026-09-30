// What the commands that work on a project do around the core's tasks:
// `module add` prepares after it lists the module, `dev` and `build --deploy`
// ask for the server when .env does not name it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { CLI_API } from '../packages/cli/src/core.mjs';
import { saveServer } from '../packages/cli/src/server.mjs';
import { amxts, amxtsInTerminal, inTemp, ROOT, serverOf, standInProject } from './helpers';

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

describe('the server a command deploys to', () => {
	const OS = '# The server\'s system: plugins are compiled for it.\nAMXTS_SERVER_OS=windows\n';

	test('.env gets AMXTS_SERVER on its line, or after what it holds', () => {
		inTemp((dir) => {
			writeFileSync(join(dir, '.env'), OS.trimEnd());
			saveServer(dir, 'D:\\hlds\\cstrike\\addons\\amxts');
			expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(`${OS}# Where amxts dev deploys: the addons/amxts folder of the server.\nAMXTS_SERVER=D:/hlds/cstrike/addons/amxts\n`);
			saveServer(dir, 'E:/hlds/cstrike/addons/amxts');
			expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(`${OS}# Where amxts dev deploys: the addons/amxts folder of the server.\nAMXTS_SERVER=E:/hlds/cstrike/addons/amxts\n`);
		});
	});

	test('dev without one asks for it in a terminal, keeps it in .env and goes on', () => {
		inTemp((dir) => {
			standInProject(dir, '0.1.0', CLI_API, OS);
			const run = amxtsInTerminal(['dev'], dir, `${serverOf(dir)}\r`);
			expect(run.out).toContain('Where is the server?');
			expect(run.out).toContain('task build --deploy --watch');
			expect(run.code).toBe(0);
			expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(`${OS}# Where amxts dev deploys: the addons/amxts folder of the server.\nAMXTS_SERVER=${serverOf(dir)}\n`);
		});
	});

	test('elsewhere nothing is asked: the build says it is missing', () => {
		inTemp((dir) => {
			standInProject(dir, '0.1.0', CLI_API, OS);
			const run = amxts(['build', '--deploy'], dir);
			expect(run.out).not.toContain('Where is the server?');
			expect(run.out).toContain('task build --deploy');
			expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(OS);
		});
	});
});
