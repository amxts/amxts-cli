// The amxts command: its arguments, the config edit `module add` makes, a
// project and a module `init` writes, and what the command line says on a typo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../packages/cli/src/args.mjs';
import { configEntries, resolveModule, specFor, withRequired } from '../packages/cli/src/catalog.mjs';
import { addToConfig, configModules } from '../packages/cli/src/config.mjs';
import { localCore } from '../packages/cli/src/core.mjs';
import { LINT_DEPENDENCIES } from '../packages/cli/src/lint.mjs';
import { fill } from '../packages/cli/src/template.mjs';
import { closest } from '../packages/cli/src/ui.mjs';
import { amxts, BIN, inTemp, node, ROOT } from './helpers';

const CREATE = join(ROOT, 'packages', 'create-amxts', 'index.mjs');

describe('arguments', () => {
	const flags = { pm: { type: 'string' as const }, lint: { type: 'boolean' as const }, yes: { type: 'boolean' as const, alias: 'y' } };

	test('--flag value, --flag=value, --no-flag, an alias and positionals', () => {
		const { values, positionals } = parseArgs(['my-server', '--pm', 'npm', '--no-lint', '-y'], flags, 'init');
		expect(values).toEqual({ pm: 'npm', lint: false, yes: true });
		expect(positionals).toEqual(['my-server']);
		expect(parseArgs(['--pm=pnpm'], flags, 'init').values.pm).toBe('pnpm');
	});

	test('an unknown flag names the closest one', () => {
		expect(() => parseArgs(['--lnt'], flags, 'init')).toThrow('Unknown option --lnt for init');
		try {
			parseArgs(['--lnt'], flags, 'init');
		} catch (error) {
			expect((error as { hint: string }).hint).toBe('Did you mean --lint?');
		}
	});

	test('a typo is one edit away, a swap of letters included', () => {
		const commands = ['init', 'dev', 'build', 'typecheck', 'test', 'module', 'check', 'prepare', 'upgrade', 'info'];
		expect(closest('buidl', commands)).toBe('build');
		expect(closest('tset', commands)).toBe('test');
		expect(closest('typechek', commands)).toBe('typecheck');
		expect(closest('deploy', commands)).toBe(null);
	});
});

describe('amxts.config.ts', () => {
	test('a module goes into the list as the list is written: one per line', async () => {
		const text = [
			'// the project',
			'export default defineConfig({',
			'\tmodules: [',
			'\t\t"@amxts/config-core",',
			'\t],',
			'\tmenus: { file: "menu" }, // options',
			'});',
			'',
		].join('\n');
		const { text: out, added } = await addToConfig(text, ['@amxts/menu-core']);
		expect(added).toEqual(['@amxts/menu-core']);
		expect(out).toBe(text.replace('"@amxts/config-core",', '"@amxts/config-core",\n\t\t"@amxts/menu-core",'));
		expect(await configModules(out)).toEqual(['@amxts/config-core', '@amxts/menu-core']);
	});

	test('on one line, in its quotes; twice is once', async () => {
		const text = `export default defineConfig({ modules: ['@amxts/config-core'] });\n`;
		expect((await addToConfig(text, ['@amxts/menu-core', '@amxts/menu-core'])).text).toBe(`export default defineConfig({ modules: ['@amxts/config-core', '@amxts/menu-core'] });\n`);
		expect((await addToConfig(text, ['@amxts/config-core'])).added).toEqual([]);
	});

	test('an empty list, no list, an empty config', async () => {
		expect((await addToConfig('export default defineConfig({\n\tmodules: [],\n});\n', ['a'])).text).toBe('export default defineConfig({\n\tmodules: ["a"],\n});\n');
		expect((await addToConfig('export default defineConfig({\n\toutDir: "out",\n});\n', ['a'])).text).toBe('export default defineConfig({\n\tmodules: ["a"],\n\toutDir: "out",\n});\n');
		expect((await addToConfig('export default defineConfig({});\n', ['a'])).text).toBe('export default defineConfig({\n\tmodules: ["a"],\n});\n');
	});

	test('a module another one needs goes right after it, with a comment: the list goes one per line', async () => {
		const entries = [{ name: '@amxts/menu-core', by: [] }, { name: '@amxts/config-core', by: ['menu-core'] }];
		const both = '\tmodules: [\n\t\t"@amxts/menu-core",\n\t\t"@amxts/config-core", // needed by menu-core\n\t],\n';
		expect((await addToConfig('export default defineConfig({\n\tmodules: [],\n});\n', entries)).text).toBe(`export default defineConfig({\n${both}});\n`);
		expect((await addToConfig('export default defineConfig({});\n', entries)).text).toBe(`export default defineConfig({\n${both}});\n`);
		// On one line: written one per line, the ones there first.
		expect((await addToConfig(`export default defineConfig({\n\tmodules: ['@amxts/resemiclip'],\n});\n`, entries)).text)
			.toBe(`export default defineConfig({\n\tmodules: [\n\t\t'@amxts/resemiclip',\n\t\t'@amxts/menu-core',\n\t\t'@amxts/config-core', // needed by menu-core\n\t],\n});\n`);
		// One per line: after the last one's comma and comment.
		const listed = 'export default defineConfig({\n\tmodules: [\n\t\t"@amxts/resemiclip" // semiclip\n\t],\n});\n';
		expect((await addToConfig(listed, entries)).text).toBe(listed.replace('"@amxts/resemiclip" // semiclip', '"@amxts/resemiclip", // semiclip\n\t\t"@amxts/menu-core",\n\t\t"@amxts/config-core", // needed by menu-core'));
	});

	test('a module listed already is not listed twice, and no comment is needed then', async () => {
		const entries = [{ name: '@amxts/menu-core', by: [] }, { name: '@amxts/config-core', by: ['menu-core'] }];
		const { text, added } = await addToConfig('export default defineConfig({\n\tmodules: ["@amxts/config-core"],\n});\n', entries);
		expect(added).toEqual(['@amxts/menu-core']);
		expect(text).toBe('export default defineConfig({\n\tmodules: ["@amxts/config-core", "@amxts/menu-core"],\n});\n');
	});

	test('a config it cannot read is an error that says what to add', async () => {
		await expect(addToConfig('const config = {};\nexport default config;\n', ['a'])).rejects.toThrow('has no `export default defineConfig');
	});
});

describe('modules by name', () => {
	// the copy of the catalog the command ships, and a community module
	const snapshot = join(ROOT, 'packages', 'cli', 'src', 'modules.json');
	const votes = { name: 'votes', npm: 'amxts-votes', repo: 'someone/amxts-votes', description: 'Map and kick votes', category: 'gameplay', type: 'community', maintainers: [{ github: 'someone' }], requires: [] };
	const catalog = [...JSON.parse(readFileSync(snapshot, 'utf8')), votes];

	test('a name in the catalog is its package; any other name is itself, not listed', () => {
		expect(resolveModule('menu-core', { catalog })).toMatchObject({ name: '@amxts/menu-core', requires: ['@amxts/config-core'], listed: true });
		expect(resolveModule('votes', { catalog })).toMatchObject({ name: 'amxts-votes', tagline: 'Map and kick votes', listed: true });
		expect(resolveModule('amxts-votes', { catalog }).listed).toBe(true);
		expect(resolveModule('@you/greeter', { catalog })).toMatchObject({ name: '@you/greeter', listed: false });
		expect(() => resolveModule('Not A Name', { catalog })).toThrow('is not a package name');
	});

	test('a module is followed by what it requires, and that by what it requires', () => {
		const chain = [
			{ name: 'a', npm: 'amxts-a', requires: ['amxts-b'] },
			{ name: 'b', npm: 'amxts-b', requires: ['amxts-c'] },
			{ name: 'c', npm: 'amxts-c', requires: [] },
			{ name: 'd', npm: 'amxts-d', requires: ['amxts-c'] },
		];
		const from = { catalog: chain };
		const chosen = ['a', 'd'].map(name => resolveModule(name, from));
		expect(configEntries(withRequired(chosen, from), chosen)).toEqual([
			{ name: 'amxts-a', by: [] },
			{ name: 'amxts-b', by: ['amxts-a'] },
			{ name: 'amxts-c', by: ['amxts-b', 'amxts-d'] },
			{ name: 'amxts-d', by: [] },
		]);
	});

	test('module add lists what the module requires right after it, unless the config has it', () => {
		inTemp((dir) => {
			writeFileSync(join(dir, 'package.json'), '{ "name": "project" }');
			const add = () => node(BIN, ['module', 'add', 'menu-core', '--skip-install'], dir, { AMXTS_CATALOG: snapshot });
			const config = join(dir, 'amxts.config.ts');
			expect(add().code).toBe(0);
			expect(readFileSync(config, 'utf8')).toBe('export default defineConfig({\n\tmodules: [\n\t\t"@amxts/menu-core",\n\t\t"@amxts/config-core", // needed by menu-core\n\t],\n});\n');
			writeFileSync(config, 'export default defineConfig({\n\tmodules: ["@amxts/config-core"],\n});\n');
			expect(add().code).toBe(0);
			expect(readFileSync(config, 'utf8')).toBe('export default defineConfig({\n\tmodules: ["@amxts/config-core", "@amxts/menu-core"],\n});\n');
		});
	});

	test('--local: the folder the core on this machine takes it from, as a file: spec relative to the project', async () => {
		const core = await localCore();
		const module = resolveModule('config-core', { catalog, local: true, localModules: core!.api.localModules() });
		expect(module.dir).toBeTruthy();
		expect(specFor(module, join(module.dir!, '..', 'project'))).toBe('file:../config-core');
		expect(specFor(module, join(module.dir!, '..', 'project'), 'pnpm')).toBe('link:../config-core');
		expect(module.tagline).toBe('Configs in INI, YAML or JSON, read into typed objects and written back');
	});

	test('--local without the core\'s folder for an official module is an error; a community one comes from npm', () => {
		expect(() => resolveModule('menu-core', { catalog, local: true, localModules: {} })).toThrow('--local: the core has no folder for @amxts/menu-core');
		expect(resolveModule('votes', { catalog, local: true, localModules: {} }).dir).toBe(null);
	});

	test('module list offers what the catalog has - AMXTS_CATALOG, else the registry, else the copy the command ships', () => {
		inTemp((dir) => {
			writeFileSync(join(dir, 'package.json'), '{ "name": "project" }');
			writeFileSync(join(dir, 'modules.json'), JSON.stringify([votes]));
			const list = (from: string) => node(BIN, ['module', 'list'], dir, { AMXTS_CATALOG: from, npm_config_user_agent: 'npm/11' }).out;
			expect(list(join(dir, 'modules.json'))).toContain('In the amxts catalog\n  ○ votes       Map and kick votes (community) - npx amxts module add votes');
			expect(list(join(dir, 'missing.json'))).toContain('○ menu-core');
		});
	});
});

test('a template keeps a block for a flag that is on, and its opposite for one that is off', () => {
	const text = ['a', '// #if menu-core', 'menu', '// #endif', '// #if !lint', 'no lint', '// #endif', '{{name}}'].join('\n');
	expect(fill(text, { name: 'x' }, { 'menu-core': true, 'lint': true })).toBe('a\nmenu\nx');
	expect(fill(text, { name: 'x' }, {})).toBe('a\nno lint\nx');
});

describe('the command line', () => {
	test('--help lists the commands; a command has its own', () => {
		const help = amxts(['--help']);
		expect(help.code).toBe(0);
		for (const command of ['init', 'dev', 'build', 'typecheck', 'test', 'module', 'check', 'info']) expect(help.out).toContain(`  ${command}`);
		expect(amxts(['module', '--help']).out).toContain('amxts module add menu-core');
	});

	test('a typo is one line and a suggestion', () => {
		const typo = amxts(['buidl']);
		expect(typo.code).toBe(1);
		expect(typo.out).toBe('✖ Unknown command buidl\n  Did you mean amxts build?\n');
	});

	test('create-amxts is amxts init', () => {
		const help = node(CREATE, ['--help']);
		expect(help.code).toBe(0);
		expect(help.out).toContain('amxts init [folder] [options]');
	});

	test('init writes a project from the flags, without asking', () => {
		inTemp((dir) => {
			const run = amxts(['init', 'my-server', '--pm', 'npm', '--modules', 'menu-core', '--no-git', '--no-install', '--server', 'D:/hlds/cstrike/addons/amxts', '--yes'], dir);
			expect(run.code).toBe(0);
			const root = join(dir, 'my-server');
			const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
			expect(pkg.name).toBe('my-server');
			expect(Object.keys(pkg.scripts)).toEqual(['postinstall', 'dev', 'build', 'typecheck', 'test', 'lint', 'lint:fix']);
			// menu-core brings config-core: both installed, both listed.
			expect(Object.keys(pkg.devDependencies)).toEqual(['@amxts/config-core', '@amxts/core', '@amxts/menu-core', '@types/bun', 'knip', ...Object.keys(LINT_DEPENDENCIES)].sort((a, b) => a.localeCompare(b)));
			// From a checkout the core and the modules are linked from this machine.
			expect(pkg.devDependencies['@amxts/core']).toStartWith('file:');
			expect(readFileSync(join(root, 'amxts.config.ts'), 'utf8')).toContain('\tmodules: [\n\t\t"@amxts/menu-core",\n\t\t"@amxts/config-core", // needed by menu-core\n\t],\n');
			// No includes at that server: the default target, ReHLDS with ReAPI.
			expect(readFileSync(join(root, 'amxts.config.ts'), 'utf8')).toContain('target: "rehlds",');
			const plugin = readFileSync(join(root, 'plugins', 'hello.ts'), 'utf8');
			// The modules' namespaces are auto-imported: the plugin uses them without an import line.
			expect(plugin).toContain('menus.create(');
			expect(plugin).toContain('configs.load(');
			expect(plugin).not.toContain('import ');
			expect(plugin).not.toContain('#if');
			expect(readFileSync(join(root, '.env'), 'utf8')).toContain('AMXTS_SERVER=D:/hlds/cstrike/addons/amxts');
			expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.env');
			for (const file of ['.oxlintrc.json', '.oxfmtrc.json', '.gitattributes', 'knip.json', '.vscode/settings.json', '.vscode/extensions.json']) expect(existsSync(join(root, file))).toBe(true);
			expect(existsSync(join(root, '.git'))).toBe(false);
			expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(false);
			expect(run.out).toContain('npm install');
			expect(run.out).toContain('npm run dev');
			// The docs' page itself, not an old address that redirects to it.
			expect(run.out).toContain('Docs: https://amxts.github.io/docs/getting-started/quick-start');
		});
	});

	test('init without modules and the lint: the plugin uses the core only, the package manager words the steps', () => {
		inTemp((dir) => {
			const run = amxts(['init', 'plain', '--pm', 'pnpm', '--modules', '', '--target', 'hlds', '--no-lint', '--no-git', '--no-install', '--no-local', '--yes'], dir);
			expect(run.code).toBe(0);
			const root = join(dir, 'plain');
			const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
			expect(pkg.scripts.lint).toBeUndefined();
			expect(pkg.devDependencies).toEqual({ '@amxts/core': '^0.1.0', '@types/bun': '^1.4.2', 'knip': '^6.39.0' });
			expect(readFileSync(join(root, 'plugins', 'hello.ts'), 'utf8')).not.toContain('@amxts/menu-core');
			expect(readFileSync(join(root, 'amxts.config.ts'), 'utf8')).toContain('modules: [],');
			expect(readFileSync(join(root, 'amxts.config.ts'), 'utf8')).toContain('target: "hlds",');
			// No server given: .env still names the setting, empty, for amxts dev to ask.
			expect(readFileSync(join(root, '.env'), 'utf8')).toMatch(/^AMXTS_SERVER=$/m);
			for (const file of ['.oxlintrc.json', '.oxfmtrc.json', '.gitattributes']) expect(existsSync(join(root, file))).toBe(false);
			expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('`pnpm dev`');
			// pnpm is told bun's install script is not needed, so it does not stop the install.
			expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain('allowBuilds:');
			expect(run.out).toContain('pnpm install');
		});
	});

	test('a project and a module pass their own format check as written', () => {
		inTemp((dir) => {
			expect(amxts(['init', 'my-server', '--modules', 'menu-core', '--no-git', '--no-install', '--yes'], dir).code).toBe(0);
			expect(amxts(['init', '--module', 'greeter', '--natives', '--pm', 'npm'], dir).code).toBe(0);
			for (const root of ['my-server', 'greeter']) {
				const check = node(join(ROOT, 'node_modules', 'oxfmt', 'bin', 'oxfmt'), ['--check'], join(dir, root));
				expect(check.out).toContain('All matched files use the correct format.');
			}
		});
	});

	test('init takes the server a project is for from its includes, and --target is rehlds or hlds', () => {
		inTemp((dir) => {
			const include = join(dir, 'hlds', 'cstrike', 'addons', 'amxmodx', 'scripting', 'include');
			mkdirSync(include, { recursive: true });
			writeFileSync(join(include, 'amxmodx.inc'), '');
			const server = join(dir, 'hlds', 'cstrike', 'addons', 'amxts').replace(/\\/g, '/');
			expect(amxts(['init', 'plain', '--modules', '', '--server', server, '--no-lint', '--no-git', '--no-install', '--yes'], dir).code).toBe(0);
			expect(readFileSync(join(dir, 'plain', 'amxts.config.ts'), 'utf8')).toContain('target: "hlds",');
			const wrong = amxts(['init', 'other', '--target', 'rehds', '--no-install', '--yes'], dir);
			expect(wrong.code).toBe(1);
			expect(wrong.out).toContain('--target rehds: rehlds (ReHLDS, ReGameDLL and ReAPI) or hlds (plain HLDS)');
		});
	});

	test('init --module writes a module package with its playground, natives with --natives', () => {
		inTemp((dir) => {
			const run = amxts(['init', '--module', '@you/kill-feed', '--natives', '--pm', 'npm'], dir);
			expect(run.code).toBe(0);
			const root = join(dir, 'kill-feed');
			const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
			expect(pkg.name).toBe('@you/kill-feed');
			expect(pkg.amxts).toEqual({ module: 'src/index.ts', natives: 'src/natives.ts', include: 'include/kill_feed.inc' });
			expect(pkg.peerDependencies).toEqual({ '@amxts/core': '^0.1.0' });
			// From a checkout the module develops against the core on this machine.
			expect(pkg.devDependencies['@amxts/core']).toStartWith('file:');
			expect(Object.keys(pkg.scripts)).toEqual(['build', 'check', 'test', 'lint', 'lint:fix']);
			expect(readFileSync(join(root, 'src', 'natives.ts'), 'utf8')).toContain('export function kill_feed_greet(player: Player)');
			expect(readFileSync(join(root, 'src', 'index.ts'), 'utf8')).toContain('defineModule<KillFeedOptions>');
			expect(readFileSync(join(root, 'src', 'index.ts'), 'utf8')).toContain('imports: [{ from: "@you/kill-feed", as: "killFeed" }],');
			expect(readFileSync(join(root, 'playground', 'plugins', 'welcome.ts'), 'utf8')).toContain('server.addCommand("/hello", ({ player }) => killFeed.greet(player));');
			expect(JSON.parse(readFileSync(join(root, 'playground', 'package.json'), 'utf8')).devDependencies).toEqual({ '@you/kill-feed': 'file:..' });
			for (const file of ['LICENSE', 'README.md', 'README.ru.md', 'test/kill-feed.test.ts', '.gitignore', '.oxlintrc.json']) expect(existsSync(join(root, file))).toBe(true);
		});
	});
});
