import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The production utility is intentionally a plain ESM module.
import { buildIntegrityManifest } from '../../tools/write_dist_integrity.mjs';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dist-integrity-'));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(contents: Uint8Array | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('dist integrity writer', () => {
  it('writes an exact deterministic manifest for nested files', async () => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    const nestedContents = Uint8Array.from([0, 1, 2, 255]);
    const rootContents = 'alpha\n';

    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'assets', 'z.bin'), nestedContents);
    await writeFile(join(dist, 'a.txt'), rootContents, 'utf8');
    await writeFile(join(dist, 'integrity.json'), '{"stale":true}\n', 'utf8');
    await writeFile(join(dist, '.integrity.json.stale.tmp'), 'temporary', 'utf8');

    const expected = {
      schema_version: 1,
      files: [
        {
          path: 'a.txt',
          bytes: Buffer.byteLength(rootContents),
          sha256: sha256(rootContents),
        },
        {
          path: 'assets/z.bin',
          bytes: nestedContents.byteLength,
          sha256: sha256(nestedContents),
        },
      ],
    };

    const firstManifest = await buildIntegrityManifest(dist);
    const firstBytes = await readFile(join(dist, 'integrity.json'));

    expect(firstManifest).toEqual(expected);
    expect(firstBytes.toString('utf8')).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(firstManifest.files.map((entry: { path: string }) => entry.path)).toEqual([
      'a.txt',
      'assets/z.bin',
    ]);
    expect(firstManifest.files.every((entry: { path: string }) => !entry.path.includes('\\'))).toBe(
      true,
    );

    const secondManifest = await buildIntegrityManifest(dist);
    const secondBytes = await readFile(join(dist, 'integrity.json'));

    expect(secondManifest).toEqual(expected);
    expect(secondBytes.equals(firstBytes)).toBe(true);
  });

  it('rejects a missing dist directory', async () => {
    const root = await makeTemporaryDirectory();

    await expect(buildIntegrityManifest(join(root, 'missing'))).rejects.toThrow(
      /dist directory.*does not exist/i,
    );
  });

  it('rejects a dist path that is not a directory', async () => {
    const root = await makeTemporaryDirectory();
    const file = join(root, 'not-a-directory');
    await writeFile(file, 'file', 'utf8');

    await expect(buildIntegrityManifest(file)).rejects.toThrow(/dist path.*directory/i);
  });

  it('rejects symlink entries without following them', async (context) => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    const target = join(root, 'outside');
    await mkdir(dist);
    await mkdir(target);
    await writeFile(join(target, 'outside.txt'), 'outside', 'utf8');

    try {
      await symlink(target, join(dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (['EACCES', 'EPERM', 'ENOTSUP'].includes(code)) {
        context.skip(`symlinks are unavailable on this host (${code})`);
        return;
      }
      throw error;
    }

    await expect(buildIntegrityManifest(dist)).rejects.toThrow(/symlink.*linked|linked.*symlink/i);
  });
});
