import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The production utility is intentionally a plain ESM module.
import { copyOrtRuntime, defaultDistDirectory, ORT_RUNTIME_BYTES, ORT_RUNTIME_NAME, ORT_RUNTIME_SHA256, resolveOrtRuntimeSource } from '../../tools/copy_ort_runtime.mjs';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ort-runtime-copy-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeSizedFile(path: string, bytes = ORT_RUNTIME_BYTES): Promise<void> {
  const handle = await open(path, 'w');
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('ORT runtime packaging', () => {
  it('resolves the pinned asyncify runtime through the package export', async () => {
    const source = resolveOrtRuntimeSource();
    const stats = await lstat(source);

    expect(source.replaceAll('\\', '/')).toMatch(
      /\/onnxruntime-web\/dist\/ort-wasm-simd-threaded\.asyncify\.wasm$/,
    );
    expect(stats.isFile()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.size).toBe(25_749_873);
  });

  it('derives the production dist directory from the utility module, not cwd', () => {
    expect(defaultDistDirectory().replaceAll('\\', '/')).toMatch(/\/web_demo\/dist\/$/);
  });

  it('rejects a source whose byte count differs from the frozen runtime', async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, ORT_RUNTIME_NAME);
    const dist = join(root, 'dist');
    await writeFile(source, Uint8Array.of(0, 1, 2));

    await expect(copyOrtRuntime({ sourcePath: source, distDirectory: dist })).rejects.toThrow(
      /source byte count.*25749873.*found 3/i,
    );
  });

  it('rejects a source that is not a regular file', async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, ORT_RUNTIME_NAME);
    await mkdir(source);

    await expect(
      copyOrtRuntime({ sourcePath: source, distDirectory: join(root, 'dist') }),
    ).rejects.toThrow(/source.*regular file/i);
  });

  it('rejects same-size source contents outside the frozen SHA-256 contract', async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, ORT_RUNTIME_NAME);
    await makeSizedFile(source);

    await expect(
      copyOrtRuntime({ sourcePath: source, distDirectory: join(root, 'dist') }),
    ).rejects.toThrow(/source SHA-256.*503d17cb.*bf549/i);
  });

  it('stream-copies exactly one runtime and verifies identical bytes and hash', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');

    const result = await copyOrtRuntime({ sourcePath: source, distDirectory: dist });
    const destination = join(dist, 'assets', ORT_RUNTIME_NAME);

    expect(result).toEqual({
      bytes: ORT_RUNTIME_BYTES,
      destinationPath: destination,
      sha256: ORT_RUNTIME_SHA256,
      sourcePath: source,
    });
    expect(await sha256(destination)).toBe(result.sha256);
    expect(await readdir(join(dist, 'assets'))).toEqual([ORT_RUNTIME_NAME]);
  });

  it('rejects an additional asyncify runtime sibling before copying', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');
    const assets = join(dist, 'assets');
    await mkdir(assets, { recursive: true });
    await writeFile(
      join(assets, 'ort-wasm-simd-threaded.asyncify-oldhash.wasm'),
      'duplicate',
    );

    await expect(copyOrtRuntime({ sourcePath: source, distDirectory: dist })).rejects.toThrow(
      /additional ORT runtime sibling.*oldhash/i,
    );
  });

  it('rejects a JSEP ORT runtime sibling before copying', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');
    const assets = join(dist, 'assets');
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, 'ort-wasm-simd-threaded.jsep.wasm'), 'duplicate');

    await expect(copyOrtRuntime({ sourcePath: source, distDirectory: dist })).rejects.toThrow(
      /additional ORT runtime sibling.*jsep/i,
    );
  });

  it('rejects an ORT runtime nested anywhere below dist assets', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');
    const nested = join(dist, 'assets', 'nested');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'ort-wasm-simd-threaded.wasm'), 'duplicate');

    await expect(copyOrtRuntime({ sourcePath: source, distDirectory: dist })).rejects.toThrow(
      /additional ORT runtime.*nested.*ort-wasm/i,
    );
  });

  it('rejects an additional asyncify runtime sibling that appears after copying', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');

    await expect(
      copyOrtRuntime({
        sourcePath: source,
        distDirectory: dist,
        testHooks: {
          afterCopy: async ({ assetsDirectory }: { assetsDirectory: string }) => {
            await writeFile(
              join(assetsDirectory, 'ort-wasm-simd-threaded.asyncify-race.wasm'),
              'duplicate',
            );
          },
        },
      }),
    ).rejects.toThrow(/additional ORT runtime sibling.*race/i);
  });

  it('rejects a case-variant ORT runtime sibling that appears after copying', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');

    await expect(
      copyOrtRuntime({
        sourcePath: source,
        distDirectory: dist,
        testHooks: {
          afterCopy: async ({ assetsDirectory }: { assetsDirectory: string }) => {
            await writeFile(join(assetsDirectory, 'ORT-WASM-SIMD-THREADED.JSPI.WASM'), 'duplicate');
          },
        },
      }),
    ).rejects.toThrow(/additional ORT runtime sibling.*jspi/i);
  });

  it('rejects a destination whose contents change before post-copy verification', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');

    await expect(
      copyOrtRuntime({
        sourcePath: source,
        distDirectory: dist,
        testHooks: {
          afterCopy: async ({ destinationPath }: { destinationPath: string }) => {
            const bytes = await readFile(destinationPath);
            bytes[0] = 1;
            await writeFile(destinationPath, bytes);
          },
        },
      }),
    ).rejects.toThrow(/destination SHA-256.*source/i);
  });

  it('rejects source and destination identity before truncating the runtime', async () => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'dist');
    const assets = join(dist, 'assets');
    const source = join(assets, ORT_RUNTIME_NAME);
    await mkdir(assets, { recursive: true });
    await makeSizedFile(source);
    const before = await lstat(source);

    await expect(copyOrtRuntime({ sourcePath: source, distDirectory: dist })).rejects.toThrow(
      /source.*destination.*same file/i,
    );
    expect((await lstat(source)).size).toBe(before.size);
  });
});
