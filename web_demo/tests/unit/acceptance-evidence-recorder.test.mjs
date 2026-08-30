import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { EXPECTED_PARITY_SOURCES } from '../../tools/run_browser_acceptance.mjs';
import {
  assertSameCleanGitState,
  buildFormalEvidence,
  recordAcceptanceEvidence,
  validatePreprocessEvidence,
} from '../../tools/record_acceptance_evidence.mjs';

const MODEL_SHA256 =
  'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69';
const MODEL_BYTES = 88_123_029;
const THRESHOLD = 0.55657113;
const ORT_MJS = {
  path: 'assets/ort-wasm-simd-threaded.asyncify.mjs',
  bytes: 51_407,
  sha256: '5d25483158d53d8f34d0e9c06a654d56c8dca4ebdf370ea0982ef11315a00e0e',
};
const ORT_WASM = {
  path: 'assets/ort-wasm-simd-threaded.asyncify.wasm',
  bytes: 25_749_873,
  sha256: '503d17cb7411b79781b9fad1cf0978f03cf06b050c7d399c730e914f473bf549',
};

function imageId(source) {
  return source.replace(/\.[^.]+$/u, '').replaceAll('/', '__');
}

function parityManifest() {
  return {
    schema_version: 1,
    preprocessing: 'inference.preprocess_image',
    tensor: {
      shape: [1, 3, 384, 384],
      dtype: 'float32',
      byte_order: 'little-endian',
      layout: 'NCHW',
      float_count: 442_368,
      bytes: 1_769_472,
    },
    model: {
      source: 'web_demo/models/baseline2_njr_fp32.onnx',
      file: 'baseline2_njr_fp32.onnx',
      bytes: MODEL_BYTES,
      sha256: MODEL_SHA256,
      input_name: 'input',
      output_name: 'logits',
    },
    threshold: THRESHOLD,
    images: EXPECTED_PARITY_SOURCES.map((source, index) => ({
      id: imageId(source),
      source,
      reference: `tensors/${imageId(source)}.f32`,
      original_dimensions: { width: 320 + index, height: 240 + index },
      oriented_dimensions: { width: 320 + index, height: 240 + index },
      tensor: {
        shape: [1, 3, 384, 384],
        float_count: 442_368,
        bytes: 1_769_472,
        sha256: `${index.toString(16).padStart(2, '0')}${'0'.repeat(62)}`,
      },
      logit: 0,
      probability: 0.5,
      label: 'Real',
    })),
  };
}

function providerEvidence(mode, provider, origin) {
  const images = EXPECTED_PARITY_SOURCES.map((source, index) => ({
    source,
    reference: index < 10 ? 'demo_predictions_cpu' : 'pillow_fp32_onnx',
    referenceProbability: 0.5,
    probability: 0.5,
    absoluteError: 0,
    label: 'Real',
    provider,
    elapsedMs: 1,
    thresholdFlip: false,
  }));
  const fallback = mode === 'fallback';
  return {
    mode,
    expectedProvider: provider,
    gpu: {
      apiAvailable: !fallback,
      adapterAvailable: mode === 'normal' && provider === 'WebGPU',
      adapterInfo: null,
    },
    webGpuDisabledByHarness: fallback,
    fallbackNote: fallback
      ? 'Compatibility note: WebGPU adapter unavailable. The same FP32 model is running with WASM.'
      : null,
    fallbackNoteVisible: fallback,
    crossOriginIsolated: true,
    images,
    maxAbsoluteError: 0,
    thresholdFlips: 0,
    requestOrigins: [origin],
    webSocketOrigins: [],
    requestPaths: {
      [mode === 'wasm' ? '/?provider=wasm' : '/']: 1,
      '/models/manifest.json': 1,
      '/models/baseline2_njr_fp32.onnx': 1,
      '/assets/ort-wasm-simd-threaded.asyncify.wasm': 1,
    },
    consoleMessages: [],
    workflowChecks: mode === 'wasm',
  };
}

function providers(origin) {
  return {
    normal: providerEvidence('normal', 'WebGPU', origin),
    fallback: providerEvidence('fallback', 'WASM', origin),
    wasm: providerEvidence('wasm', 'WASM', origin),
  };
}

function acceptanceReport(commit = 'a'.repeat(40), manifestSha256 = 'b'.repeat(64)) {
  const sourceOrigin = 'http://127.0.0.1:8766';
  const freshOrigin = 'http://127.0.0.1:8767';
  return {
    schemaVersion: 1,
    passed: true,
    generatedAt: '2026-08-30T00:00:00.000Z',
    commit,
    parityManifest: {
      path: 'web_demo/.generated-tests/parity/manifest.json',
      sha256: manifestSha256,
    },
    platform: { platform: 'win32', release: '10.0.0', arch: 'x64' },
    runtime: {
      node: 'v24.19.0',
      python: '3.12.10',
      edge: '151.0.4129.107',
      edgeExecutable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    },
    model: { bytes: MODEL_BYTES, sha256: MODEL_SHA256 },
    threshold: THRESHOLD,
    gates: { maxProbabilityError: 0.01, imagesPerProvider: 15 },
    portFallback: {
      occupiedPort: 8765,
      occupation: 'acceptance-holder',
      selectedPort: 8766,
      passed: true,
    },
    source: {
      serverUrl: `${sourceOrigin}/`,
      providers: providers(sourceOrigin),
      terminationUnreachable: true,
    },
    artifactFailures: {
      corruptModel: { exitCode: 1, diagnostic: 'model SHA-256 mismatch' },
      missingWasm: { exitCode: 1, diagnostic: 'ORT runtime WASM is missing' },
    },
    freshCopy: {
      directoryName: 'LingShu 评委 本地复现',
      sourceCommit: commit,
      trackedFileCount: 100,
      excluded: ['.git', 'node_modules', '.venv', 'web_models'],
      npmInstallRun: false,
      batchCheck: { exitCode: 0, output: 'Distribution verification passed.' },
      serverUrl: `${freshOrigin}/`,
      providers: providers(freshOrigin),
      terminationUnreachable: true,
    },
  };
}

function preprocessReport(manifestSha256 = 'b'.repeat(64)) {
  const manifest = parityManifest();
  return {
    schema_version: 1,
    generated_at: '2026-08-30T00:01:00.000Z',
    manifest: {
      path: 'web_demo/.generated-tests/parity/manifest.json',
      sha256: manifestSha256,
    },
    browser: { name: 'Microsoft Edge', version: '151.0.4129.107' },
    gates: {
      image_count: 15,
      tensor_float_count: 442_368,
      mean_absolute_error_maximum: 0.02,
      maximum_absolute_error_maximum: 0.5,
      exif_dimensions_match: true,
      rgba_hidden_rgb_preserved: true,
      local_requests_only: true,
    },
    summary: { passed: true, passedCount: 15, totalCount: 15, failures: [] },
    request_urls: ['http://127.0.0.1:4173/tests/browser/preprocess-harness.html'],
    websocket_urls: [],
    blocked_requests: [],
    browser_errors: [],
    images: manifest.images.map((image) => ({
      dimensionsMatch: true,
      failures: [],
      floatCount: 442_368,
      id: image.id,
      maxAbsoluteError: 0.01,
      meanAbsoluteError: 0.001,
      orientedDimensions: image.oriented_dimensions,
      originalDimensions: image.original_dimensions,
      rgbaHiddenRgbPreserved:
        image.source === 'web_demo/tests/fixtures/rgba-hidden-rgb.png' ? true : null,
    })),
  };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function runGit(repositoryRoot, arguments_) {
  const result = spawnSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function writeJson(filePath, value) {
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, encoded, 'utf8');
  return { encoded, sha256: sha256(encoded) };
}

async function createEvidenceRepository() {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'lingshu-evidence-recorder-'));
  runGit(repositoryRoot, ['init', '--quiet']);
  runGit(repositoryRoot, ['config', 'user.email', 'evidence@example.invalid']);
  runGit(repositoryRoot, ['config', 'user.name', 'Evidence Test']);
  await writeFile(
    path.join(repositoryRoot, '.gitignore'),
    'web_demo/.generated-tests/\n',
    'utf8',
  );
  await writeJson(path.join(repositoryRoot, 'web_demo', 'package-lock.json'), packageLock());
  await writeJson(
    path.join(repositoryRoot, 'web_demo', 'dist', 'integrity.json'),
    integrityManifest(),
  );
  runGit(repositoryRoot, ['add', '.gitignore', 'web_demo/package-lock.json', 'web_demo/dist/integrity.json']);
  runGit(repositoryRoot, ['commit', '--quiet', '-m', 'test: seed evidence repository']);
  const commit = runGit(repositoryRoot, ['rev-parse', 'HEAD']);

  const manifest = parityManifest();
  const manifestFile = await writeJson(
    path.join(repositoryRoot, 'web_demo', '.generated-tests', 'parity', 'manifest.json'),
    manifest,
  );
  const acceptance = acceptanceReport(commit, manifestFile.sha256);
  const acceptanceFile = await writeJson(
    path.join(
      repositoryRoot,
      'web_demo',
      '.generated-tests',
      'browser-acceptance',
      'latest.json',
    ),
    acceptance,
  );
  const preprocess = preprocessReport(manifestFile.sha256);
  const preprocessFile = await writeJson(
    path.join(
      repositoryRoot,
      'web_demo',
      '.generated-tests',
      'parity',
      'browser-results.json',
    ),
    preprocess,
  );
  return {
    repositoryRoot,
    commit,
    hashes: {
      browserAcceptance: acceptanceFile.sha256,
      preprocessParity: preprocessFile.sha256,
      parityManifest: manifestFile.sha256,
    },
  };
}

function packageLock() {
  return {
    lockfileVersion: 3,
    packages: {
      '': {
        dependencies: { 'onnxruntime-web': '1.29.0' },
        devDependencies: { 'playwright-core': '1.62.1', vite: '8.2.2' },
      },
      'node_modules/onnxruntime-web': { version: '1.29.0' },
      'node_modules/playwright-core': { version: '1.62.1' },
      'node_modules/vite': { version: '8.2.2' },
    },
  };
}

function integrityManifest() {
  return {
    schema_version: 1,
    files: [
      { path: 'index.html', bytes: 123, sha256: 'c'.repeat(64) },
      { ...ORT_MJS },
      { ...ORT_WASM },
    ],
  };
}

function actualOrtArtifacts() {
  return {
    ortWorker: { ...ORT_MJS },
    ortWasm: { ...ORT_WASM },
  };
}

async function fixtureArtifactIdentityReader(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  if (normalized.endsWith(`/web_demo/dist/${ORT_MJS.path}`)) return { ...ORT_MJS };
  if (normalized.endsWith(`/web_demo/dist/${ORT_WASM.path}`)) return { ...ORT_WASM };
  throw new Error(`Unexpected artifact path: ${filePath}`);
}

describe('formal acceptance evidence recorder', () => {
  it('exposes the fixed-path recorder as a package command', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );

    expect(packageJson.scripts['record:acceptance-evidence']).toBe(
      'node tools/record_acceptance_evidence.mjs',
    );
  });

  it('documents evidence order, commit ownership, and interpretation boundaries', async () => {
    const readme = await readFile(
      new URL('../../../results/web_demo_acceptance/README.md', import.meta.url),
      'utf8',
    );

    expect(readme).toMatch(
      /test:browser-acceptance[\s\S]*test:preprocess-parity[\s\S]*record:acceptance-evidence/u,
    );
    expect(readme).toMatch(/testedCommit[\s\S]*direct\s+parent/i);
    expect(readme).toMatch(/timing.*machine-specific/is);
    expect(readme).toMatch(/parity.*not.*accuracy/is);
    expect(readme).toMatch(/replac[\s\S]*browser-results\.json/i);
  });

  it('accepts the exact passing 15-image tensor report', () => {
    const manifest = parityManifest();
    const manifestSha256 = 'b'.repeat(64);
    const report = preprocessReport(manifestSha256);

    expect(
      validatePreprocessEvidence({
        report,
        manifest,
        manifestSha256,
        acceptanceReport: acceptanceReport(),
      }),
    ).toBe(report);
  });

  it('requires browser acceptance, preprocess evidence, and raw manifest bytes to agree', () => {
    const acceptance = acceptanceReport();
    acceptance.parityManifest.sha256 = 'c'.repeat(64);

    expect(() =>
      validatePreprocessEvidence({
        report: preprocessReport(),
        manifest: parityManifest(),
        manifestSha256: 'b'.repeat(64),
        acceptanceReport: acceptance,
      }),
    ).toThrow(/acceptance.*manifest.*SHA-256|manifest.*three-way|manifest.*match/i);
  });

  it('binds every fixture reference probability to the parsed parity manifest', () => {
    const acceptance = acceptanceReport();
    const fixtureIndex = 10;
    const row = acceptance.source.providers.normal.images[fixtureIndex];
    row.referenceProbability = 0.51;
    row.probability = 0.51;

    expect(() =>
      validatePreprocessEvidence({
        report: preprocessReport(),
        manifest: parityManifest(),
        manifestSha256: 'b'.repeat(64),
        acceptanceReport: acceptance,
      }),
    ).toThrow(/fixture reference probability.*manifest/i);
  });

  it('hashes actual artifact bytes instead of accepting declared metadata', async () => {
    const recorder = await import('../../tools/record_acceptance_evidence.mjs');
    expect(recorder.hashRegularArtifactFile).toBeTypeOf('function');
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'lingshu-artifact-hash-'));
    const artifactPath = path.join(temporary, 'runtime.wasm');
    try {
      await writeFile(artifactPath, Buffer.from([0, 1, 2, 3]));
      await expect(
        recorder.hashRegularArtifactFile(artifactPath, 'assets/runtime.wasm'),
      ).resolves.toEqual({
        path: 'assets/runtime.wasm',
        bytes: 4,
        sha256: sha256(Buffer.from([0, 1, 2, 3])),
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('rejects extra nested manifest fields instead of silently recording them', () => {
    const manifest = parityManifest();
    manifest.tensor.unreviewed = true;

    expect(() =>
      validatePreprocessEvidence({
        report: preprocessReport(),
        manifest,
        manifestSha256: 'b'.repeat(64),
        acceptanceReport: acceptanceReport(),
      }),
    ).toThrow(/tensor.*keys.*exactly/i);
  });

  it('builds a self-contained formal report from exact locked evidence', () => {
    const acceptance = acceptanceReport();
    const manifest = parityManifest();
    const preprocess = preprocessReport();
    const generatedAt = '2026-08-30T00:02:00.000Z';
    const rawHashes = {
      browserAcceptance: '1'.repeat(64),
      preprocessParity: '2'.repeat(64),
      parityManifest: 'b'.repeat(64),
    };

    const formal = buildFormalEvidence({
      acceptanceReport: acceptance,
      preprocessReport: preprocess,
      parityManifest: manifest,
      rawHashes,
      packageLock: packageLock(),
      integrityManifest: integrityManifest(),
      actualOrtArtifacts: actualOrtArtifacts(),
      generatedAt,
      testedCommit: acceptance.commit,
    });

    expect(formal).toMatchObject({
      schemaVersion: 1,
      passed: true,
      generatedAt,
      testedCommit: acceptance.commit,
      commands: [
        'npm.cmd run test:browser-acceptance',
        'npm.cmd run test:preprocess-parity',
        'npm.cmd run record:acceptance-evidence',
      ],
      environment: {
        platform: acceptance.platform,
        browser: { name: 'Microsoft Edge', version: acceptance.runtime.edge },
        runtime: {
          node: acceptance.runtime.node,
          python: acceptance.runtime.python,
        },
        lockedVersions: {
          onnxruntimeWeb: '1.29.0',
          playwrightCore: '1.62.1',
          vite: '8.2.2',
        },
      },
      artifacts: {
        model: {
          path: 'web_demo/models/baseline2_njr_fp32.onnx',
          bytes: MODEL_BYTES,
          sha256: MODEL_SHA256,
        },
        ortWorker: ORT_MJS,
        ortWasm: ORT_WASM,
        threshold: THRESHOLD,
      },
    });
    expect(formal.browserAcceptance).toEqual(acceptance);
    expect(formal.tensorParity.report).toEqual(preprocess);
    expect(formal.tensorParity.referenceManifest).toEqual(manifest);
    expect(formal.sourceReports).toEqual({
      browserAcceptance: {
        path: 'web_demo/.generated-tests/browser-acceptance/latest.json',
        sha256: rawHashes.browserAcceptance,
      },
      preprocessParity: {
        path: 'web_demo/.generated-tests/parity/browser-results.json',
        sha256: rawHashes.preprocessParity,
      },
      parityManifest: {
        path: 'web_demo/.generated-tests/parity/manifest.json',
        sha256: rawHashes.parityManifest,
      },
    });
  });

  it.each([
    [
      'wrong tensor gate',
      ({ report }) => {
        report.gates.mean_absolute_error_maximum = 0.021;
      },
      /mean absolute error gate/i,
    ],
    [
      'one tensor error over the bound',
      ({ report }) => {
        report.images[0].maxAbsoluteError = 0.51;
      },
      /maximum absolute error|summary/i,
    ],
    [
      'remote request origin',
      ({ report }) => {
        report.request_urls.push('https://remote.example/telemetry');
      },
      /non-loopback request/i,
    ],
    [
      'blocked browser request',
      ({ report }) => {
        report.blocked_requests.push('https://remote.example/telemetry');
      },
      /blocked requests/i,
    ],
    [
      'manifest digest mismatch',
      ({ manifestSha }) => {
        manifestSha.value = 'c'.repeat(64);
      },
      /manifest SHA-256.*match/i,
    ],
    [
      'browser version mismatch',
      ({ report }) => {
        report.browser.version = '150.0.0.0';
      },
      /Edge versions.*match/i,
    ],
    [
      'threshold mismatch',
      ({ acceptance }) => {
        acceptance.threshold = 0.5;
      },
      /threshold/i,
    ],
  ])('rejects %s', (_label, mutate, expectedError) => {
    const manifest = parityManifest();
    const report = preprocessReport();
    const acceptance = acceptanceReport();
    const manifestSha = { value: 'b'.repeat(64) };
    mutate({ manifest, report, acceptance, manifestSha });

    expect(() =>
      validatePreprocessEvidence({
        report,
        manifest,
        manifestSha256: manifestSha.value,
        acceptanceReport: acceptance,
      }),
    ).toThrow(expectedError);
  });

  it('rejects unlocked runtime versions and altered ORT integrity identities', () => {
    const base = {
      acceptanceReport: acceptanceReport(),
      preprocessReport: preprocessReport(),
      parityManifest: parityManifest(),
      rawHashes: {
        browserAcceptance: '1'.repeat(64),
        preprocessParity: '2'.repeat(64),
        parityManifest: 'b'.repeat(64),
      },
      packageLock: packageLock(),
      integrityManifest: integrityManifest(),
      actualOrtArtifacts: actualOrtArtifacts(),
      generatedAt: '2026-08-30T00:02:00.000Z',
      testedCommit: 'a'.repeat(40),
    };
    base.packageLock.packages[''].devDependencies['playwright-core'] = '1.62.0';
    expect(() => buildFormalEvidence(base)).toThrow(/playwright-core.*locked version/i);

    base.packageLock = packageLock();
    base.integrityManifest.files.find(({ path: artifactPath }) => artifactPath === ORT_WASM.path)
      .sha256 = '0'.repeat(64);
    expect(() => buildFormalEvidence(base)).toThrow(/integrity identity.*wasm/i);

    base.integrityManifest = integrityManifest();
    base.actualOrtArtifacts.ortWasm.sha256 = '0'.repeat(64);
    expect(() => buildFormalEvidence(base)).toThrow(/actual.*wasm|committed.*wasm|artifact.*wasm/i);
  });

  it('writes only the fixed formal path after a clean unchanged Git recheck', async () => {
    const fixture = await createEvidenceRepository();
    try {
      const artifactIdentityReader = vi.fn(fixtureArtifactIdentityReader);
      const formal = await recordAcceptanceEvidence({
        repositoryRoot: fixture.repositoryRoot,
        now: () => new Date('2026-08-30T00:02:00.000Z'),
        artifactIdentityReader,
      });
      const outputDirectory = path.join(
        fixture.repositoryRoot,
        'results',
        'web_demo_acceptance',
      );
      const output = JSON.parse(
        await readFile(path.join(outputDirectory, 'latest.json'), 'utf8'),
      );

      expect(formal).toEqual(output);
      expect(output.testedCommit).toBe(fixture.commit);
      expect(output.sourceReports).toMatchObject({
        browserAcceptance: { sha256: fixture.hashes.browserAcceptance },
        preprocessParity: { sha256: fixture.hashes.preprocessParity },
        parityManifest: { sha256: fixture.hashes.parityManifest },
      });
      expect(await readdir(outputDirectory)).toEqual(['latest.json']);
      expect(artifactIdentityReader).toHaveBeenCalledTimes(2);
      expect(
        artifactIdentityReader.mock.calls.map(([filePath]) =>
          filePath.replaceAll('\\', '/').replace(`${fixture.repositoryRoot.replaceAll('\\', '/')}/`, ''),
        ),
      ).toEqual([
        `web_demo/dist/${ORT_MJS.path}`,
        `web_demo/dist/${ORT_WASM.path}`,
      ]);
    } finally {
      await rm(fixture.repositoryRoot, { recursive: true, force: true });
    }
  });

  it('does not write when the final Git state is dirty or changed', async () => {
    const fixture = await createEvidenceRepository();
    let reads = 0;
    const gitStateReader = () => {
      reads += 1;
      return reads === 1
        ? { head: fixture.commit, porcelain: '' }
        : { head: fixture.commit, porcelain: ' M web_demo/package-lock.json\n' };
    };
    const outputPath = path.join(
      fixture.repositoryRoot,
      'results',
      'web_demo_acceptance',
      'latest.json',
    );
    try {
      await expect(
        recordAcceptanceEvidence({
          repositoryRoot: fixture.repositoryRoot,
          now: () => new Date('2026-08-30T00:02:00.000Z'),
          gitStateReader,
          artifactIdentityReader: fixtureArtifactIdentityReader,
        }),
      ).rejects.toThrow(/remain clean.*formal write/i);
      await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(reads).toBe(2);
    } finally {
      await rm(fixture.repositoryRoot, { recursive: true, force: true });
    }
  });

  it('rejects a changed HEAD even when both tracked snapshots are otherwise clean', () => {
    expect(() =>
      assertSameCleanGitState(
        { head: 'a'.repeat(40), porcelain: '' },
        { head: 'b'.repeat(40), porcelain: '' },
      ),
    ).toThrow(/HEAD changed/i);
  });
});
