import { Buffer } from 'node:buffer';
// The includes of the server a project is for: the server's own when
// AMXTS_SERVER has them, else fetched for amxts.config.ts's target, as the
// core pins the release - and the archive they come in, read without unzip.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { deflateRawSync } from 'node:zlib';
// @ts-ignore - bun:test types not available during type checking
import { afterAll, describe, expect, test } from 'bun:test';
import { configTarget } from '../packages/cli/src/config.mjs';
import { ensureIncludes, targetOf, unzip } from '../packages/cli/src/includes.mjs';

/** A .zip of these files: the first stored, the rest deflated, as a release archive has them. */
function zip(files: Record<string, string>) {
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	Object.entries(files).forEach(([name, text], i) => {
		const raw = new TextEncoder().encode(text);
		const data = i === 0 ? raw : new Uint8Array(deflateRawSync(raw));
		const path = new TextEncoder().encode(name);
		const header = new DataView(new ArrayBuffer(30));
		header.setUint32(0, 0x04034B50, true);
		header.setUint16(8, i === 0 ? 0 : 8, true);
		header.setUint32(18, data.length, true);
		header.setUint32(22, raw.length, true);
		header.setUint16(26, path.length, true);
		const entry = new DataView(new ArrayBuffer(46));
		entry.setUint32(0, 0x02014B50, true);
		entry.setUint16(10, i === 0 ? 0 : 8, true);
		entry.setUint32(20, data.length, true);
		entry.setUint32(24, raw.length, true);
		entry.setUint16(28, path.length, true);
		entry.setUint32(42, offset, true);
		local.push(new Uint8Array(header.buffer), path, data);
		central.push(new Uint8Array(entry.buffer), path);
		offset += 30 + path.length + data.length;
	});
	const size = central.reduce((sum, part) => sum + part.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054B50, true);
	end.setUint16(8, Object.keys(files).length, true);
	end.setUint16(10, Object.keys(files).length, true);
	end.setUint32(12, size, true);
	end.setUint32(16, offset, true);
	return new Uint8Array(Buffer.concat([...local, ...central, new Uint8Array(end.buffer)]));
}

const ARCHIVE = zip({
	'addons/amxmodx/modules/reapi_amxx.dll': 'MZ',
	'addons/amxmodx/scripting/include/reapi.inc': '#include <reapi_engine>\n',
	'addons/amxmodx/scripting/include/reapi_engine.inc': 'native RegisterHookChain();\n',
});
// The server comes from the project's .env here, not from the environment the tests run in.
delete process.env.AMXTS_SERVER;

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// A release on this machine: the archive, and one that is not what the core pins.
const release = Bun.serve({
	port: 0,
	fetch: (request: Request) => new URL(request.url).pathname === '/reapi.zip' ? new Response(ARCHIVE) : new Response('no', { status: 404 }),
});
afterAll(() => release.stop(true));

/** A stand-in core that pins the archive above. */
function core(url = `http://localhost:${release.port}/reapi.zip`, hash = sha256(ARCHIVE)) {
	const reapi = { name: 'ReAPI', version: '5.26.0.338', license: 'GPL-3.0', home: 'https://github.com/rehlds/ReAPI', url, sha256: hash, include: 'addons/amxmodx/scripting/include/' };
	return { dir: '', version: '2.0.0', fromSource: false, api: { includeSources: () => ({ reapi }) } } as any;
}

test('a release archive is read: stored and deflated files, folders left out', () => {
	const files = unzip(ARCHIVE);
	expect([...files.keys()]).toEqual(['addons/amxmodx/modules/reapi_amxx.dll', 'addons/amxmodx/scripting/include/reapi.inc', 'addons/amxmodx/scripting/include/reapi_engine.inc']);
	expect(new TextDecoder().decode(files.get('addons/amxmodx/scripting/include/reapi_engine.inc'))).toBe('native RegisterHookChain();\n');
	expect(() => unzip(new Uint8Array(64))).toThrow('not a zip archive');
});

test('target in amxts.config.ts', async () => {
	expect(await configTarget('export default defineConfig({ modules: [], target: "hlds" });')).toBe('hlds');
	expect(await configTarget('export default defineConfig({ modules: [] });')).toBeNull();
});

describe('the includes a project gets', () => {
	test('a server with its includes: the server\'s own, and they say what it is', async () => {
		await inTempAsync(async (dir) => {
			const include = join(dir, 'hlds', 'cstrike', 'addons', 'amxmodx', 'scripting', 'include');
			mkdirSync(include, { recursive: true });
			writeFileSync(join(include, 'amxmodx.inc'), '');
			writeFileSync(join(dir, '.env'), `AMXTS_SERVER=${join(dir, 'hlds', 'cstrike', 'addons', 'amxts').replace(/\\/g, '/')}\n`);
			expect(await ensureIncludes(core('http://localhost:1/nothing'), dir, { target: 'rehlds' })).toEqual({ from: 'server', target: 'hlds', dir: include });
			writeFileSync(join(include, 'reapi.inc'), '');
			expect(targetOf(include)).toBe('rehlds');
			expect(existsSync(join(dir, '.amxts'))).toBe(false);
		});
	});

	test('rehlds without a server: ReAPI\'s includes fetched into .amxts/include, once', async () => {
		await inTempAsync(async (dir) => {
			const first = await ensureIncludes(core(), dir, { target: 'rehlds' });
			expect(first).toMatchObject({ from: 'fetched', target: 'rehlds', version: 'ReAPI 5.26.0.338', fetched: true });
			expect(readFileSync(join(dir, '.amxts', 'include', 'reapi_engine.inc'), 'utf8')).toBe('native RegisterHookChain();\n');
			expect(existsSync(join(dir, '.amxts', 'include', 'reapi_amxx.dll'))).toBe(false);
			// Fetched already: the stand-in's URL is not asked again.
			const again = await ensureIncludes(core('http://localhost:1/nothing'), dir, { target: 'rehlds' });
			expect(again.fetched).toBeUndefined();
		});
	});

	test('hlds: nothing fetched, and what rehlds fetched goes', async () => {
		await inTempAsync(async (dir) => {
			await ensureIncludes(core(), dir, { target: 'rehlds' });
			expect(await ensureIncludes(core(), dir, { target: 'hlds' })).toEqual({ from: 'core', target: 'hlds', dir: null });
			expect(existsSync(join(dir, '.amxts', 'include'))).toBe(false);
		});
	});

	test('a download that fails, or is not the pinned file, says what to do', async () => {
		await inTempAsync(async (dir) => {
			const missing = ensureIncludes(core(`http://localhost:${release.port}/gone.zip`), dir, { target: 'rehlds' });
			await expect(missing).rejects.toThrow('Could not download ReAPI 5.26.0.338\'s includes');
			const other = ensureIncludes(core(undefined, '0'.repeat(64)), dir, { target: 'rehlds' });
			await expect(other).rejects.toThrow('is not the file the core pins');
			expect(existsSync(join(dir, '.amxts', 'include'))).toBe(false);
		});
	});
});

/** A folder for one test, removed after it. */
async function inTempAsync(body: (dir: string) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-cli-'));
	try {
		await body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
