import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
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
    const nestedTempContents = 'kept because it is not a root writer temp';
    const rootContents = 'alpha\n';
    const staleTemp = join(dist, '.integrity.json.stale.tmp');

    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'assets', 'z.bin'), nestedContents);
    await writeFile(
      join(dist, 'assets', '.integrity.json.nested.tmp'),
      nestedTempContents,
      'utf8',
    );
    await writeFile(join(dist, 'a.txt'), rootContents, 'utf8');
    await writeFile(join(dist, 'integrity.json'), '{"stale":true}\n', 'utf8');
    await writeFile(staleTemp, 'temporary', 'utf8');

    const expected = {
      schema_version: 1,
      files: [
        {
          path: 'a.txt',
          bytes: Buffer.byteLength(rootContents),
          sha256: sha256(rootContents),
        },
        {
          path: 'assets/.integrity.json.nested.tmp',
          bytes: Buffer.byteLength(nestedTempContents),
          sha256: sha256(nestedTempContents),
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
      'assets/.integrity.json.nested.tmp',
      'assets/z.bin',
    ]);
    expect(firstManifest.files.every((entry: { path: string }) => !entry.path.includes('\\'))).toBe(
      true,
    );
    await expect(lstat(staleTemp)).rejects.toMatchObject({ code: 'ENOENT' });

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

  it('rejects a writer-owned temporary path that is not a regular file', async () => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    await mkdir(join(dist, '.integrity.json.not-a-file.tmp'), { recursive: true });

    await expect(buildIntegrityManifest(dist)).rejects.toThrow(
      /writer-owned temporary.*regular file/i,
    );
  });

  it('aborts when a directory identity changes after it is read', async () => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    const nested = join(dist, 'nested');
    const moved = join(root, 'moved-nested');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'asset.txt'), 'asset', 'utf8');
    let swapped = false;

    await expect(
      buildIntegrityManifest(dist, {
        afterDirectoryRead: async ({ absolutePath, path }: { absolutePath: string; path: string }) => {
          if (path === 'nested') {
            await rename(absolutePath, moved);
            await mkdir(absolutePath);
            swapped = true;
          }
        },
      }),
    ).rejects.toThrow(/directory.*nested.*changed/i);
    expect(swapped).toBe(true);
  });

  it('aborts when a file identity changes after it is opened', async () => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    const asset = join(dist, 'asset.txt');
    const moved = join(root, 'moved-asset.txt');
    await mkdir(dist);
    await writeFile(asset, 'original', 'utf8');
    let swapped = false;

    await expect(
      buildIntegrityManifest(dist, {
        afterFileOpen: async ({ absolutePath, path }: { absolutePath: string; path: string }) => {
          if (path === 'asset.txt') {
            await rename(absolutePath, moved);
            await writeFile(absolutePath, 'replacement', 'utf8');
            swapped = true;
          }
        },
      }),
    ).rejects.toThrow(/entry asset\.txt changed while hashing/i);
    expect(swapped).toBe(true);
  });

  it('rejects a requested root swapped before realpath resolution', async (context) => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    const moved = join(root, 'moved-dist');
    const outside = join(root, 'outside');
    await mkdir(dist);
    await mkdir(outside);
    await writeFile(join(dist, 'asset.txt'), 'asset', 'utf8');
    let swapped = false;
    let unsupportedCode = '';
    let observedError: unknown;

    try {
      await buildIntegrityManifest(dist, {
        afterRootLstat: async () => {
          await rename(dist, moved);
          try {
            await symlink(outside, dist, process.platform === 'win32' ? 'junction' : 'dir');
            swapped = true;
          } catch (error) {
            unsupportedCode =
              error !== null && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : '';
            await rename(moved, dist);
          }
        },
      });
    } catch (error) {
      observedError = error;
    }

    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(unsupportedCode)) {
      context.skip(`symlinks are unavailable on this host (${unsupportedCode})`);
      return;
    }

    expect(swapped).toBe(true);
    expect(observedError).toBeInstanceOf(Error);
    expect((observedError as Error).message).toMatch(/dist root.*(changed|identity)/i);
    await expect(lstat(join(outside, 'integrity.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a junction or symlink escape without traversing it', async (context) => {
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
    expect(await readFile(join(target, 'outside.txt'), 'utf8')).toBe('outside');
  });
});
