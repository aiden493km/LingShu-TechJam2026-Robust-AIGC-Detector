import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error Production utilities are intentionally plain ESM modules.
import { copyOrtRuntime } from '../../tools/copy_ort_runtime.mjs';
// @ts-expect-error Production utilities are intentionally plain ESM modules.
import { buildIntegrityManifest } from '../../tools/write_dist_integrity.mjs';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lingshu-online-dist-'));
  temporaryDirectories.push(directory);
  return directory;
}

function frozenManifest(): string {
  return `${JSON.stringify({
    schema_version: 1,
    model: {
      file: 'baseline2_njr_fp32.onnx',
      bytes: 88123029,
      sha256: 'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69',
      format: 'ONNX',
      precision: 'FP32',
      opset: 18,
    },
    threshold: { aigc: 0.55657113 },
  })}\n`;
}

async function loadPrepareOnlineDist(): Promise<{
  prepareOnlineDist: (options: { distDirectory: string; manifestPath: string }) => Promise<void>;
}> {
  return import(new URL('../../tools/prepare_online_dist.mjs', import.meta.url).href);
}

async function loadVerifyOnlineDist(): Promise<{
  verifyOnlineDist: (distDirectory: string) => Promise<void>;
}> {
  return import(new URL('../../tools/verify_online_dist.mjs', import.meta.url).href);
}

async function createVerifiedOnlineDist(root: string): Promise<string> {
  const sourceManifest = join(root, 'manifest.json');
  const distDirectory = join(root, 'dist-online');
  await writeFile(sourceManifest, frozenManifest());
  const { prepareOnlineDist } = await loadPrepareOnlineDist();
  await prepareOnlineDist({ distDirectory, manifestPath: sourceManifest });
  await writeFile(join(distDirectory, 'index.html'), '<!doctype html>');
  await copyOrtRuntime({ distDirectory });
  await buildIntegrityManifest(distDirectory);
  return distDirectory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('online distribution packaging', () => {
  it('copies the frozen model manifest as the only model output', async () => {
    const root = await makeTemporaryDirectory();
    const sourceManifest = join(root, 'source-manifest.json');
    const distDirectory = join(root, 'dist-online');
    const sourceBytes = frozenManifest();
    await writeFile(sourceManifest, sourceBytes);

    const { prepareOnlineDist } = await loadPrepareOnlineDist();
    await prepareOnlineDist({ distDirectory, manifestPath: sourceManifest });

    expect(await readFile(join(distDirectory, 'models', 'manifest.json'), 'utf8')).toBe(
      sourceBytes,
    );
    expect(await (await import('node:fs/promises')).readdir(join(distDirectory, 'models'))).toEqual([
      'manifest.json',
    ]);
  });

  it('rejects an ONNX entry already present in the online output', async () => {
    const root = await makeTemporaryDirectory();
    const sourceManifest = join(root, 'source-manifest.json');
    const distDirectory = join(root, 'dist-online');
    await writeFile(sourceManifest, frozenManifest());
    await mkdir(join(distDirectory, 'assets'), { recursive: true });
    await writeFile(join(distDirectory, 'assets', 'leaked-model.onnx'), 'forbidden');

    const { prepareOnlineDist } = await loadPrepareOnlineDist();
    await expect(
      prepareOnlineDist({ distDirectory, manifestPath: sourceManifest }),
    ).rejects.toThrow(/onnx/i);
  });

  it('rejects a manifest that does not match the frozen model contract', async () => {
    const root = await makeTemporaryDirectory();
    const sourceManifest = join(root, 'source-manifest.json');
    await writeFile(sourceManifest, frozenManifest().replace('88123029', '1'));

    const { prepareOnlineDist } = await loadPrepareOnlineDist();
    await expect(
      prepareOnlineDist({
        distDirectory: join(root, 'dist-online'),
        manifestPath: sourceManifest,
      }),
    ).rejects.toThrow(/bytes.*88123029/i);
  });

  it('verifies a manifest-only online distribution with the frozen ORT runtime', async () => {
    const root = await makeTemporaryDirectory();
    const distDirectory = await createVerifiedOnlineDist(root);

    const { verifyOnlineDist } = await loadVerifyOnlineDist();
    await expect(verifyOnlineDist(distDirectory)).resolves.toBeUndefined();
  });

  it('rejects model siblings and ONNX entries during online distribution verification', async () => {
    const root = await makeTemporaryDirectory();
    const distDirectory = await createVerifiedOnlineDist(root);
    await writeFile(join(distDirectory, 'models', 'other.json'), '{}');

    const { verifyOnlineDist } = await loadVerifyOnlineDist();
    await expect(verifyOnlineDist(distDirectory)).rejects.toThrow(/unexpected.*models/i);

    await rm(join(distDirectory, 'models', 'other.json'));
    await writeFile(join(distDirectory, 'models', 'leaked.onnx.data'), 'forbidden');
    await expect(verifyOnlineDist(distDirectory)).rejects.toThrow(/onnx/i);
  });

  it('requires integrity.json to remain a regular file', async () => {
    const root = await makeTemporaryDirectory();
    const distDirectory = await createVerifiedOnlineDist(root);
    await rm(join(distDirectory, 'integrity.json'));
    await mkdir(join(distDirectory, 'integrity.json'));

    const { verifyOnlineDist } = await loadVerifyOnlineDist();
    await expect(verifyOnlineDist(distDirectory)).rejects.toThrow(/integrity\.json.*regular/i);
  });
});
