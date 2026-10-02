// An install that links folders of this machine (--local) leaves their own
// node_modules/.bin as they were: yarn 1 points a link: folder's .bin at the
// project's packages, so the core's tsc, amxts and bun would start those.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { installLinked, linkedFolders, versionOf } from '../packages/cli/src/pm.mjs';
import { inTemp } from './helpers';

/** A folder with a package.json, and files in it. */
function folder(dir: string, json: object, files: Record<string, string> = {}) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify(json));
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
}

test('the linked folders are the link: and file: specs, with the ones about to be added', () => {
	inTemp((dir) => {
		folder(join(dir, 'project'), { devDependencies: { '@amxts/core': 'link:../core', 'a': 'file:./a', 'b': '^1.0.0', 'c': 'link:@scope/c' } });
		expect(linkedFolders(join(dir, 'project'), [join(dir, 'menu')])).toEqual([join(dir, 'core'), join(dir, 'project', 'a'), join(dir, 'menu')]);
	});
});

test.skipIf(!versionOf('yarn'))('yarn installing a link: folder leaves the folder\'s .bin as it was', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'amxts-cli-'));
	try {
		await yarnInstall(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 120_000);

async function yarnInstall(dir: string) {
	const tool = { name: 'tool', version: '1.0.0', bin: { tool: 'cli.js' } };
	folder(join(dir, 'tool'), tool, { 'cli.js': 'console.log(1)\n' });
	folder(join(dir, 'core'), { name: 'core', version: '1.0.0', dependencies: { tool: 'file:../tool' } }, {
		'node_modules/tool/package.json': JSON.stringify(tool),
		'node_modules/tool/cli.js': 'console.log(1)\n',
		'node_modules/.bin/tool': 'the core\'s own\n',
	});
	const project = join(dir, 'project');
	folder(project, { name: 'project', version: '1.0.0', private: true, devDependencies: { core: 'link:../core' } });

	const result = await installLinked(['yarn', 'install', '--non-interactive', '--no-lockfile'], linkedFolders(project), { cwd: project, quiet: true });

	expect(result.code).toBe(0);
	expect(existsSync(join(project, 'node_modules', '.bin'))).toBe(true);
	expect(readdirSync(join(dir, 'core', 'node_modules', '.bin'))).toEqual(['tool']);
	expect(readFileSync(join(dir, 'core', 'node_modules', '.bin', 'tool'), 'utf8')).toBe('the core\'s own\n');
}
