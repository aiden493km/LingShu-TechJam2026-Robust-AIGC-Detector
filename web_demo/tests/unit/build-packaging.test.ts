import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { runtimeAssetFileName } from '../../vite.config';

const ORT_RUNTIME_NAME = 'ort-wasm-simd-threaded.asyncify.wasm';

describe('static runtime build configuration', () => {
  it('gives only the exact ORT asyncify asset a stable output path', () => {
    expect(runtimeAssetFileName({ name: ORT_RUNTIME_NAME, names: [] })).toBe(
      `assets/${ORT_RUNTIME_NAME}`,
    );
    expect(runtimeAssetFileName({ name: undefined, names: [ORT_RUNTIME_NAME] })).toBe(
      `assets/${ORT_RUNTIME_NAME}`,
    );
    expect(
      runtimeAssetFileName({
        name: 'ort-wasm-simd-threaded.asyncify-copy.wasm',
        names: ['ort-wasm-simd-threaded.asyncify-copy.wasm'],
      }),
    ).toBe('assets/[name]-[hash][extname]');
    expect(runtimeAssetFileName({ name: 'logo.svg', names: ['logo.svg'] })).toBe(
      'assets/[name]-[hash][extname]',
    );
  });

  it('runs Vite, the ORT copier, and the integrity writer in strict order', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toBe(
      'vite build && node tools/copy_ort_runtime.mjs && node tools/write_dist_integrity.mjs',
    );
  });

  it('tracks only the approved ONNX model as an ordinary binary Git blob', async () => {
    const gitignore = await readFile(new URL('../../../.gitignore', import.meta.url), 'utf8');
    const attributes = await readFile(
      new URL('../../../.gitattributes', import.meta.url),
      'utf8',
    );

    expect(gitignore).toContain('*.onnx');
    expect(gitignore).toContain('web_models/');
    expect(gitignore.match(/^!web_demo\/models\/baseline2_njr_fp32\.onnx$/gm)).toHaveLength(1);
    expect(attributes.trim()).toBe(
      'web_demo/models/baseline2_njr_fp32.onnx binary -diff -merge',
    );
    expect(attributes).not.toMatch(/filter\s*=\s*lfs/i);
  });
});
