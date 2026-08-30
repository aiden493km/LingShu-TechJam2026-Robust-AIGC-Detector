import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const webDemoRoot = fileURLToPath(new URL('../../', import.meta.url));

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lingshu-online-preflight-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runPreflight(distDirectory: string) {
  return spawnSync(process.execPath, ['tools/preflight_online_build.mjs', distDirectory], {
    cwd: webDemoRoot,
    encoding: 'utf8',
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('online build preflight', () => {
  it('allows a missing output directory that Vite may create', async () => {
    const root = await makeTemporaryDirectory();
    const result = runPreflight(join(root, 'dist-online'));

    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a directory junction without touching its target', async () => {
    const root = await makeTemporaryDirectory();
    const target = join(root, 'target');
    const linkedOutput = join(root, 'dist-online');
    await mkdir(target);
    await writeFile(join(target, 'sentinel.txt'), 'do-not-touch');
    await symlink(target, linkedOutput, 'junction');

    const result = runPreflight(linkedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symlink|junction/i);
    expect(await readFile(join(target, 'sentinel.txt'), 'utf8')).toBe('do-not-touch');
  });
});
