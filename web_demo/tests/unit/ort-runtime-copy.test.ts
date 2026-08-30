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
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The production utility is intentionally a plain ESM module.
import { copyOrtRuntime, defaultDistDirectory, ORT_RUNTIME_BYTES, ORT_RUNTIME_MJS_BYTES, ORT_RUNTIME_MJS_NAME, ORT_RUNTIME_MJS_SHA256, ORT_RUNTIME_NAME, ORT_RUNTIME_SHA256, resolveOrtRuntimeMjsSource, resolveOrtRuntimeSource } from '../../tools/copy_ort_runtime.mjs';

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
  it('keeps both frozen runtime artifacts byte-exact across Git checkouts', async () => {
    const attributes = await readFile(new URL('../../../.gitattributes', import.meta.url), 'utf8');

    expect(attributes).toContain('web_demo/dist/** -text');
    expect(attributes).toContain(
      'web_demo/dist/assets/ort-wasm-simd-threaded.asyncify.mjs binary -diff -merge',
    );
    expect(attributes).toContain(
      'web_demo/dist/assets/ort-wasm-simd-threaded.asyncify.wasm binary -diff -merge',
    );
  });

  it('resolves the pinned asyncify runtime through the package export', async () => {
    const source = resolveOrtRuntimeSource();
    const stats = await lstat(source);

    expect(source.replaceAll('\\', '/')).toMatch(
      /\/onnxruntime-web\/dist\/ort-wasm-simd-threaded\.asyncify\.wasm$/,
    );
    expect(stats.isFile()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.size).toBe(25_749_873);
    expect(await sha256(source)).toBe(
      '503d17cb7411b79781b9fad1cf0978f03cf06b050c7d399c730e914f473bf549',
    );
  });

  it('resolves the pinned asyncify worker entrypoint through the package export', async () => {
    const source = resolveOrtRuntimeMjsSource();
    const stats = await lstat(source);

    expect(source.replaceAll('\\', '/')).toMatch(
      /\/onnxruntime-web\/dist\/ort-wasm-simd-threaded\.asyncify\.mjs$/,
    );
    expect(stats.isFile()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.size).toBe(51_407);
    expect(await sha256(source)).toBe(
      '5d25483158d53d8f34d0e9c06a654d56c8dca4ebdf370ea0982ef11315a00e0e',
    );
  });

  it('derives the production dist directory from the utility module, not cwd', () => {
    expect(defaultDistDirectory().replaceAll('\\', '/')).toMatch(/\/web_demo\/dist\/$/);
  });

  it('accepts one output directory argument and rejects additional CLI arguments', async () => {
    const root = await makeTemporaryDirectory();
    const dist = join(root, 'custom-dist');
    const webDemoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const copyResult = spawnSync(process.execPath, ['tools/copy_ort_runtime.mjs', dist], {
      cwd: webDemoRoot,
      encoding: 'utf8',
    });

    expect(copyResult.status, copyResult.stderr).toBe(0);
    expect(await lstat(join(dist, 'assets', ORT_RUNTIME_NAME))).toMatchObject({
      size: ORT_RUNTIME_BYTES,
    });

    const invalidResult = spawnSync(
      process.execPath,
      ['tools/copy_ort_runtime.mjs', dist, 'unexpected'],
      { cwd: webDemoRoot, encoding: 'utf8' },
    );
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr).toContain(
      'Usage: node tools/copy_ort_runtime.mjs [dist-directory]',
    );
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

    const mjsSource = resolveOrtRuntimeMjsSource();
    const mjsDestination = join(dist, 'assets', ORT_RUNTIME_MJS_NAME);
    expect(result).toEqual({
      mjs: {
        bytes: ORT_RUNTIME_MJS_BYTES,
        destinationPath: mjsDestination,
        sha256: ORT_RUNTIME_MJS_SHA256,
        sourcePath: mjsSource,
      },
      wasm: {
        bytes: ORT_RUNTIME_BYTES,
        destinationPath: destination,
        sha256: ORT_RUNTIME_SHA256,
        sourcePath: source,
      },
    });
    expect(await sha256(destination)).toBe(result.wasm.sha256);
    expect(await sha256(mjsDestination)).toBe(result.mjs.sha256);
    expect((await readdir(join(dist, 'assets'))).sort()).toEqual(
      [ORT_RUNTIME_MJS_NAME, ORT_RUNTIME_NAME].sort(),
    );
  });

  it('rejects an asyncify worker entrypoint whose byte count differs from the frozen runtime', async () => {
    const root = await makeTemporaryDirectory();
    const mjsSource = join(root, ORT_RUNTIME_MJS_NAME);
    await writeFile(mjsSource, Uint8Array.of(0, 1, 2));

    await expect(
      copyOrtRuntime({
        mjsSourcePath: mjsSource,
        distDirectory: join(root, 'dist'),
      }),
    ).rejects.toThrow(/MJS source byte count.*51407.*found 3/i);
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

  it('rejects an unexpected ORT JavaScript runtime sibling before copying', async () => {
    const root = await makeTemporaryDirectory();
    const source = resolveOrtRuntimeSource();
    const dist = join(root, 'dist');
    const assets = join(dist, 'assets');
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, 'ort-wasm-simd-threaded.jsep.mjs'), 'duplicate');

    await expect(copyOrtRuntime({ sourcePath: source, distDirectory: dist })).rejects.toThrow(
      /additional ORT runtime.*jsep\.mjs/i,
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
          afterCopy: async ({
            destinationPaths,
          }: {
            destinationPaths: { wasm: string };
          }) => {
            const destinationPath = destinationPaths.wasm;
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
