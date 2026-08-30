import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildOutputDirectory, runtimeAssetFileName } from '../../vite.config';

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

  it('keeps the local build in dist and sends online builds to dist-online', () => {
    expect(buildOutputDirectory()).toBe('dist');
    expect(buildOutputDirectory('production')).toBe('dist');
    expect(buildOutputDirectory('online')).toBe('dist-online');
  });

  it('runs Vite, the ORT copier, and the integrity writer in strict order', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toBe(
      'node tools/normalize_build_inputs.mjs && vite build && node tools/copy_ort_runtime.mjs && node tools/write_dist_integrity.mjs',
    );
  });

  it('runs the isolated online distribution pipeline in strict order', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['build:online']).toBe(
      'node tools/normalize_build_inputs.mjs && vite build --mode online && node tools/prepare_online_dist.mjs && node tools/copy_ort_runtime.mjs dist-online && node tools/write_dist_integrity.mjs dist-online && node tools/verify_online_dist.mjs',
    );
  });

  it('normalizes Vite and copied public text inputs before the build', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'lingshu-build-text-'));
    const webDemoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const expectedTextFiles = [
      'index.html',
      'public/brands/README.md',
      'public/brands/github-mark.svg',
      'public/fonts/OFL-League-Gothic.txt',
    ];

    try {
      await mkdir(join(temporaryRoot, 'public', 'brands'), { recursive: true });
      await mkdir(join(temporaryRoot, 'public', 'fonts'), { recursive: true });
      for (const relativePath of expectedTextFiles) {
        await writeFile(join(temporaryRoot, relativePath), 'first\r\nsecond\rthird\n', 'utf8');
      }

      const result = spawnSync(
        process.execPath,
        ['tools/normalize_build_inputs.mjs', temporaryRoot],
        { cwd: webDemoRoot, encoding: 'utf8' },
      );

      expect(result.status, result.stderr).toBe(0);
      for (const relativePath of expectedTextFiles) {
        expect(await readFile(join(temporaryRoot, relativePath), 'utf8')).toBe(
          'first\nsecond\nthird\n',
        );
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('exposes the committed built-app browser acceptance runner', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['test:browser-acceptance']).toBe(
      'node tools/run_browser_acceptance.mjs',
    );
  });

  it('tracks the browser model despite broad model ignores', async () => {
    const gitignore = await readFile(new URL('../../../.gitignore', import.meta.url), 'utf8');

    expect(gitignore).toContain('*.onnx');
    expect(gitignore).toContain('web_models/');
    expect(gitignore.match(/^!web_demo\/models\/baseline2_njr_fp32\.onnx$/gm)).toHaveLength(1);
    expect(gitignore).toContain('web_demo/dist-online/');
  });

  it('excludes local and model-bearing content from Vercel uploads', async () => {
    expect(await readFile(new URL('../../.vercelignore', import.meta.url), 'utf8')).toBe(
      'dist/\ndist-online/\nmodels/*.onnx\n.generated-tests/\n.runtime-cache/\nruntime/\nstart-demo.bat\nstart-demo.command\nstart-demo.sh\n',
    );
  });

  it('pins Vite input text and copied public text assets to LF', async () => {
    const attributes = await readFile(new URL('../../../.gitattributes', import.meta.url), 'utf8');

    for (const rule of [
      'web_demo/index.html text eol=lf',
      'web_demo/public/brands/*.md text eol=lf',
      'web_demo/public/brands/*.svg text eol=lf',
      'web_demo/public/fonts/*.txt text eol=lf',
    ]) {
      expect(attributes).toContain(rule);
    }
  });
});
