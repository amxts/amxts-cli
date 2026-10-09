// `amxts upgrade`: the packages moved in the project's style and installed
// with its package manager, the code rewritten, the build, the server's
// module from the release - each against fixtures, nothing from the network.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { CLI_API, localCore, VERSION } from '../packages/cli/src/core.mjs';
import { versionsFor } from '../packages/cli/src/registry.mjs';
import { serverMismatch, updateServer, withoutHost } from '../packages/cli/src/server-update.mjs';
import { bumpSpec, packageBumps, summary, upgrade, writeBumps } from '../packages/cli/src/upgrade.mjs';
import { amxts, CORE, NEXT_CORE, serverOf, standInProject, UPGRADE_REPORT } from './helpers';

delete process.env.AMXTS_SERVER;
delete process.env.AMXTS_SERVER_OS;

/** A folder for one test, removed after it; the test runs in it. */
async function inProject(body: (dir: string) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-upgrade-'));
	const cwd = process.cwd();
	process.chdir(dir);
	try {
		await body(dir);
	} finally {
		process.chdir(cwd);
		rmSync(dir, { recursive: true, force: true });
	}
}

function write(path: string, text: string | Buffer) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

/** A module file as the build makes one: binary, with its ABI string inside. */
const moduleOf = (version: string, hash = '0123abcd') => Buffer.concat([Buffer.from([0x4D, 0x5A, 0x90, 0]), Buffer.from(`${version}+abi.${hash}\0`)]);

/** What an install of another core changes: the stand-in's version. */
function coreVersion(dir: string, version: string) {
	for (const file of ['package.json', 'cli-api.mjs']) {
		const path = join(dir, 'node_modules', '@amxts', 'core', file);
		writeFileSync(path, readFileSync(path, 'utf8').replaceAll(CORE, version));
	}
}

/** A patch of the core this command drives. */
const PATCH = CORE.replace(/\d+$/, '5');

interface Release {
	version: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

/** A registry of these releases, as npm view gives them - `*`, a version, `latest` - and what it was asked, in order. */
function registryOf(releases: Record<string, Release[]>) {
	const asked: string[] = [];
	const versions = async (name: string, spec = '*') => {
		asked.push(`${name}@${spec}`);
		const all = releases[name] ?? [];
		return spec === '*' ? all : spec === 'latest' ? all.slice(-1) : all.filter(each => each.version === spec);
	};
	return { asked, versions };
}

/** A module of the core's minor version, and others of the minor versions around it. */
const MENU_CORE = [
	{ version: '0.1.0', peerDependencies: { '@amxts/core': '^0.0.1' } },
	{ version: '0.3.0', peerDependencies: { '@amxts/core': `^${CORE}` } },
	{ version: '0.4.0', peerDependencies: { '@amxts/core': `^${NEXT_CORE}` } },
];

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** A release folder, as AMXTS_RELEASE_URL may name one: the files and the manifest that lists them. */
function releaseFolder(dir: string, version: string, files: Record<string, Buffer>, system = 'windows') {
	for (const [name, data] of Object.entries(files)) write(join(dir, name), data);
	const manifest = { name: 'amxts', version, tag: `v${version}`, system, files: Object.entries(files).map(([name, data]) => ({ name, size: data.length, sha256: sha256(data) })) };
	write(join(dir, `amxts-${system}.json`), JSON.stringify(manifest));
	return dir;
}

describe('the packages', () => {
	test('a spec moves in the style it is written in; a folder, a tag or a range of its own stays', () => {
		expect(bumpSpec('^0.1.0', '0.2.0')).toBe('^0.2.0');
		expect(bumpSpec('~0.1.3', '0.2.0')).toBe('~0.2.0');
		expect(bumpSpec('0.1.0', '0.2.0')).toBe('0.2.0');
		expect(bumpSpec('>=0.1.0', '0.2.0-rc.1')).toBe('>=0.2.0-rc.1');
		for (const spec of ['file:../amxts', 'link:../core', 'latest', '*', '^0.1.0 || ^0.2.0', 'workspace:*']) expect(bumpSpec(spec, '0.2.0')).toBeNull();
	});

	test('every @amxts/ package moves to its own version, and package.json keeps how it is written', () => {
		const text = '{\n  "name": "my-server",\n  "dependencies": { "@amxts/menu-core": "~0.1.0" },\n  "devDependencies": {\n    "@amxts/core":   "^0.1.0",\n    "@amxts/cli": "file:../cli",\n    "typescript": "^0.1.0"\n  }\n}\n';
		const bumps = packageBumps(JSON.parse(text), { '@amxts/core': '0.2.0', '@amxts/menu-core': '0.1.3' });
		expect(bumps).toEqual([
			{ name: '@amxts/menu-core', spec: '~0.1.0', version: '0.1.3', to: '~0.1.3' },
			{ name: '@amxts/core', spec: '^0.1.0', version: '0.2.0', to: '^0.2.0' },
			{ name: '@amxts/cli', spec: 'file:../cli', version: null, to: null },
		]);
		expect(writeBumps(text, bumps)).toBe(text.replace('"~0.1.0"', '"~0.1.3"').replace('"^0.1.0",', '"^0.2.0",'));
	});

	test('each package goes to its own newest version that works with the core', async () => {
		const registry = registryOf({
			'@amxts/core': [{ version: '0.1.0' }, { version: '0.2.0', dependencies: { '@amxts/cli': '^0.2.0' } }, { version: '0.2.1', dependencies: { '@amxts/cli': '^0.2.0' } }, { version: '0.3.0' }],
			'@amxts/config-core': [{ version: '0.1.0', peerDependencies: { '@amxts/core': '^0.1.0' } }, { version: '0.1.1', peerDependencies: { '@amxts/core': '^0.2.0' } }],
			'@amxts/menu-core': [{ version: '0.2.0', peerDependencies: { '@amxts/config-core': '^0.1.1', '@amxts/core': '^0.2.0' } }, { version: '0.3.0', peerDependencies: { '@amxts/core': '^0.3.0' } }],
			'@amxts/cli': ['0.1.0', '0.2.0', '0.2.3', '0.3.0'].map(version => ({ version })),
			'@you/greeter': [{ version: '1.4.0' }],
		});
		const names = ['@amxts/config-core', '@amxts/menu-core', '@amxts/cli', '@you/greeter'];
		expect(await versionsFor(registry, '0.2.0', names)).toEqual({
			core: '0.2.0',
			versions: { '@amxts/config-core': '0.1.1', '@amxts/menu-core': '0.2.0', '@amxts/cli': '0.2.3', '@you/greeter': '1.4.0' },
		});
		expect(registry.asked).toEqual(['@amxts/core@0.2.0', ...names.map(name => `${name}@*`)]);
		// A range: its newest core.
		expect((await versionsFor(registry, '^0.2.0', [])).core).toBe('0.2.1');
		await expect(versionsFor(registry, '0.3.0', ['@amxts/config-core', '@you/nothing'])).rejects.toThrow('@amxts/config-core has no version for @amxts/core 0.3.0\n@you/nothing is not on the registry');
	});

	test('each package manager installs what moved: npm, pnpm, yarn, bun - by its lockfile', async () => {
		for (const [pm, lockfile] of [['npm', 'package-lock.json'], ['pnpm', 'pnpm-lock.yaml'], ['yarn', 'yarn.lock'], ['bun', 'bun.lock']]) {
			await inProject(async (dir) => {
				standInProject(dir, CORE, CLI_API);
				const text = (core: string, menu: string) => `{\n\t"name": "my-server",\n\t"devDependencies": {\n\t\t"@amxts/core": "^${core}",\n\t\t"@amxts/menu-core": "${menu}"\n\t}\n}\n`;
				writeFileSync(join(dir, 'package.json'), text(CORE, '0.1.0'));
				writeFileSync(join(dir, lockfile), '');
				const installed: string[] = [];
				const registry = registryOf({ '@amxts/core': [{ version: CORE }, { version: PATCH }], '@amxts/menu-core': MENU_CORE });
				// The install puts the new core in place.
				const install = async (at: string, by: string) => {
					installed.push(`${by} in ${at === dir ? 'the project' : at}`);
					coreVersion(dir, PATCH);
				};
				const outcome = await upgrade({ server: false }, { dir, registry, install });
				expect(installed).toEqual([`${pm} in the project`]);
				expect(registry.asked).toEqual(['@amxts/core@latest', '@amxts/menu-core@*']);
				expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(text(PATCH, '0.3.0'));
				expect(outcome!.packages).toEqual([
					{ name: '@amxts/core', spec: `^${CORE}`, from: CORE, version: PATCH, to: `^${PATCH}` },
					{ name: '@amxts/menu-core', spec: '0.1.0', from: null, version: '0.3.0', to: '0.3.0' },
				]);
				expect(outcome!.code).toEqual({ files: ['plugins/hello.ts'], left: UPGRADE_REPORT.left });
				expect(outcome!.build).toBe('built');
				expect(outcome!.server).toBeNull();
			});
		}
	});

	test('a core the registry does not have, or a module with no version for it, changes nothing', async () => {
		await inProject(async (dir) => {
			standInProject(dir, CORE, CLI_API);
			const text = `{ "devDependencies": { "@amxts/core": "^${CORE}", "@amxts/resemiclip": "^0.1.0" } }\n`;
			writeFileSync(join(dir, 'package.json'), text);
			const registry = registryOf({ '@amxts/core': [{ version: CORE }, { version: PATCH }], '@amxts/resemiclip': [{ version: '0.1.0', peerDependencies: { '@amxts/core': '^0.0.1' } }] });
			const install = async () => {
				throw new Error('installed');
			};
			await expect(upgrade({ to: PATCH }, { dir, registry, install })).rejects.toThrow(`@amxts/resemiclip has no version for @amxts/core ${PATCH}`);
			await expect(upgrade({ to: '9.9.9' }, { dir, registry, install })).rejects.toThrow('@amxts/core 9.9.9 is not on the registry');
			expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(text);
		});
	});

	test('a dry run says what would move and changes nothing; the rewrites wait for the new core', async () => {
		await inProject(async (dir) => {
			standInProject(dir, CORE, CLI_API);
			const text = `{ "devDependencies": { "@amxts/core": "^${CORE}" } }\n`;
			writeFileSync(join(dir, 'package.json'), text);
			const registry = registryOf({ '@amxts/core': [{ version: PATCH }] });
			const install = async () => {
				throw new Error('installed');
			};
			const outcome = await upgrade({ dryRun: true }, { dir, registry, install });
			expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(text);
			expect(outcome!.code).toBeNull();
			expect(outcome!.build).toBeNull();
			expect(outcome!.server!.line).toBe(`the module of amxts ${PATCH} goes in once @amxts/core ${PATCH} is installed`);
			expect(summary(outcome!)[0]).toBe(`Dry run: amxts ${PATCH}, nothing was changed`);
		});
	});

	test('a core of another release: the command it came with does the rest', async () => {
		await inProject(async (dir) => {
			standInProject(dir, CORE, CLI_API);
			writeFileSync(join(dir, 'package.json'), `{ "devDependencies": { "@amxts/core": "^${CORE}" } }\n`);
			const cli = join(dir, 'node_modules', '@amxts', 'cli');
			write(join(cli, 'package.json'), JSON.stringify({ name: '@amxts/cli', version: '99.0.0', type: 'module' }));
			write(join(cli, 'bin', 'amxts.mjs'), 'import { writeFileSync } from "node:fs";\nwriteFileSync("handed.json", JSON.stringify({ args: process.argv.slice(2), from: JSON.parse(process.env.AMXTS_UPGRADE_FROM) }));\n');
			const registry = registryOf({ '@amxts/core': [{ version: NEXT_CORE }] });
			const outcome = await upgrade({ server: false }, { dir, registry, install: async () => coreVersion(dir, NEXT_CORE) });
			process.exitCode = 0;
			expect(outcome).toBeNull();
			expect(JSON.parse(readFileSync(join(dir, 'handed.json'), 'utf8'))).toEqual({ args: ['upgrade', '--to', NEXT_CORE, '--no-server'], from: { '@amxts/core': CORE } });
		});
	});
});

describe('the server', () => {
	/**
	 * A server of an older release - with the compiler an older kit put in
	 * addons/amxts/tools - and a release folder of the core's version, of the
	 * files the core says a server runs. `updated`: the names of those files on
	 * the server, as an update names them.
	 */
	async function oldServer(dir: string, { tools = true } = {}) {
		const core = (await localCore())!;
		const game = join(dir, 'hlds', 'cstrike');
		write(join(dir, 'hlds', 'hlds.exe'), '');
		write(join(game, 'addons', 'amxts', 'plugins.ini'), '');
		write(join(game, 'addons', 'amxmodx', 'modules', 'amxts_amxx.dll'), moduleOf('0.0.9'));
		write(join(game, 'addons', 'amxmodx', 'configs', 'plugins.ini'), 'admin.amxx\namxts_host.amxx   ; debug\nmenufront.amxx\n');
		if (tools) {
			write(join(game, 'addons', 'amxts', 'tools', 'amxts-compile.exe'), 'old compiler');
			write(join(game, 'addons', 'amxts', 'tools', 'wamrc.exe'), 'old wamrc');
		}
		writeFileSync(join(dir, '.env'), `AMXTS_SERVER=${join(game, 'addons', 'amxts').replace(/\\/g, '/')}\n`);
		const files: { asset: string; path: string; tool: boolean }[] = core.api.release('windows').files;
		const release = releaseFolder(join(dir, 'release'), core.version, {
			...Object.fromEntries(files.map(file => [file.asset, Buffer.from(`new ${file.asset}`)])),
			'amxts_amxx.dll': moduleOf(core.version, '11111111'),
			'amxts-server-windows-x64.zip': Buffer.from('the kit'),
		});
		process.env.AMXTS_RELEASE_URL = release;
		const updated = files.filter(file => !file.tool || tools).map(file => file.path.split('/').pop()).join(', ');
		return { core, game, release, files, updated, at: (path: string) => join(game, path) };
	}

	async function withServer(body: (dir: string) => Promise<void>) {
		await inProject(async (dir) => {
			try {
				await body(dir);
			} finally {
				delete process.env.AMXTS_RELEASE_URL;
			}
		});
	}

	test('the files of the release go in, the old ones beside them; plugins.ini loses the host plugin', async () => {
		await withServer(async (dir) => {
			const { core, at, files, updated } = await oldServer(dir);
			expect(serverMismatch(core, dir)).toBe(`the server runs amxts 0.0.9, this project ${core.version} - run amxts upgrade`);
			const outcome = await updateServer(core.api, dir);
			expect(outcome).toEqual({ ok: true, line: `${updated} 0.0.9 → ${core.version} - restart the server to load it` });
			expect(readFileSync(at('addons/amxmodx/modules/amxts_amxx.dll'))).toEqual(moduleOf(core.version, '11111111'));
			expect(readFileSync(at('addons/amxmodx/modules/amxts_amxx.dll.0.0.9'))).toEqual(moduleOf('0.0.9'));
			// A file the release has replaces the server's; one it has not - the
			// compiler of a core that has none - is left as it is: nothing runs it.
			for (const tool of ['amxts-compile.exe', 'wamrc.exe']) {
				const file = files.find(each => each.path.endsWith(`/${tool}`));
				expect(readFileSync(at(`addons/amxts/tools/${tool}`), 'utf8')).toBe(file ? `new ${file.asset}` : `old ${tool === 'wamrc.exe' ? 'wamrc' : 'compiler'}`);
			}
			expect(readFileSync(at('addons/amxmodx/configs/plugins.ini'), 'utf8')).toBe('admin.amxx\nmenufront.amxx\n');
			expect(serverMismatch(core, dir)).toBeNull();
			// Again: nothing to do.
			expect(await updateServer(core.api, dir)).toEqual({ ok: true, line: `already amxts ${core.version}` });
		});
	});

	test('a server without the compiler gets the module only', async () => {
		await withServer(async (dir) => {
			const { core, at } = await oldServer(dir, { tools: false });
			expect((await updateServer(core.api, dir)).line).toStartWith('amxts_amxx.dll 0.0.9 →');
			expect(existsSync(at('addons/amxts/tools'))).toBe(false);
		});
	});

	test('a running server: nothing changes, and it says to stop it and run --server-only', async () => {
		await withServer(async (dir) => {
			const { core, at } = await oldServer(dir);
			const outcome = await updateServer(core.api, dir, { canWrite: path => !path.endsWith('.dll') });
			expect(outcome).toEqual({ ok: false, line: 'in use - stop the server and run amxts upgrade --server-only; nothing on it was changed' });
			expect(readFileSync(at('addons/amxmodx/modules/amxts_amxx.dll'))).toEqual(moduleOf('0.0.9'));
			expect(readFileSync(at('addons/amxts/tools/amxts-compile.exe'), 'utf8')).toBe('old compiler');
			expect(readFileSync(at('addons/amxmodx/configs/plugins.ini'), 'utf8')).toContain('amxts_host.amxx');
		});
	});

	test('a file that is not the one the manifest lists changes nothing', async () => {
		await withServer(async (dir) => {
			const { core, at, release } = await oldServer(dir);
			writeFileSync(join(release, 'amxts_amxx.dll'), 'something else');
			expect(updateServer(core.api, dir)).rejects.toThrow('amxts_amxx.dll from');
			expect(readFileSync(at('addons/amxmodx/modules/amxts_amxx.dll'))).toEqual(moduleOf('0.0.9'));
		});
	});

	test('a dry run reads the manifest and changes nothing', async () => {
		await withServer(async (dir) => {
			const { core, at, updated } = await oldServer(dir);
			expect((await updateServer(core.api, dir, { dryRun: true })).line).toBe(`${updated} would go from amxts 0.0.9 to ${core.version}`);
			expect(readFileSync(at('addons/amxmodx/modules/amxts_amxx.dll'))).toEqual(moduleOf('0.0.9'));
			expect(readFileSync(at('addons/amxmodx/configs/plugins.ini'), 'utf8')).toContain('amxts_host.amxx');
		});
	});

	test('no server in .env: the image to pull', async () => {
		await withServer(async (dir) => {
			const core = (await localCore())!;
			writeFileSync(join(dir, '.env'), '');
			expect(await updateServer(core.api, dir)).toEqual({ ok: true, line: `none in .env; a server in Docker: docker pull ghcr.io/amxts/server:${core.version}` });
		});
	});

	test('plugins.ini: only a line that loads the host plugin goes', () => {
		expect(withoutHost('a.amxx\r\n  amxts_host.amxx debug\r\nb.amxx')).toBe('a.amxx\r\nb.amxx');
		expect(withoutHost('; amxts_host.amxx\nmy_amxts_host.amxx\n')).toBeNull();
	});
});

test('the whole run, as a user runs it: packages, code, build, server and the summary', () => {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-upgrade-'));
	try {
		standInProject(dir, CORE, CLI_API);
		writeFileSync(join(dir, 'package.json'), `{ "name": "my-server", "devDependencies": { "@amxts/core": "^${CORE}" } }\n`);
		const game = join(serverOf(dir), '..', '..');
		write(join(serverOf(dir), 'plugins.ini'), '');
		write(join(game, 'addons', 'amxmodx', 'modules', 'amxts_amxx.dll'), moduleOf('0.0.9'));
		const release = releaseFolder(join(dir, 'release'), CORE, { 'amxts_amxx.dll': moduleOf(CORE) });

		expect(amxts(['build'], dir).out).toContain(`▲ the server runs amxts 0.0.9, this project ${CORE} - run amxts upgrade\n`);
		const dry = amxts(['upgrade', '--to', CORE, '--dry-run'], dir, { AMXTS_RELEASE_URL: release });
		expect(dry.out).toContain('task upgrade --report');
		expect(dry.out).toContain('--dry-run\n');
		expect(dry.out).not.toContain('task build');
		expect(readFileSync(join(game, 'addons', 'amxmodx', 'modules', 'amxts_amxx.dll'))).toEqual(moduleOf('0.0.9'));

		const run = amxts(['upgrade', '--to', CORE], dir, { AMXTS_RELEASE_URL: release });
		expect(run.code).toBe(0);
		const out = run.out.replace(/--report \S+/, '--report <file>').replace(/\\/g, '/').replaceAll(dir.replace(/\\/g, '/'), '<project>');
		expect(out).toBe([
			`{•} amxts ${VERSION} · upgrade`,
			`◇ Packages: amxts ${CORE}`,
			`i @amxts/core  ^${CORE} (already)`,
			'◇ Code',
			'task upgrade --report <file>',
			'◇ Build',
			'task prepare --quiet',
			'task build',
			'◇ Server: <project>/hlds/cstrike (windows)',
			`✔ amxts_amxx.dll 0.0.9 → ${CORE} (the old one: amxts_amxx.dll.0.0.9)`,
			'',
			`Upgraded to amxts ${CORE}`,
			`  @amxts/core  ${CORE} (already)`,
			'  ✔ rewritten: plugins/hello.ts',
			'  ▲ to check by hand:',
			'      plugins/hello.ts:4  reads the words after the command\'s name',
			'  ✔ built',
			`  ✔ server: amxts_amxx.dll 0.0.9 → ${CORE} - restart the server to load it`,
			'',
		].join('\n'));
		expect(amxts(['build'], dir).out).not.toContain('the server runs');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
