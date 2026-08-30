import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  EXPECTED_PARITY_SOURCES,
  assertSuccessfulProcessTreeTermination,
  buildBatchInvocation,
  compareProbability,
  inspectWebSocketUrl,
  inspectRequestUrl,
  installNetworkBoundary,
  parseDemoPredictions,
  parseTrackedFiles,
  ReadyLineParser,
  sameDimensions,
  shouldTerminateProcessTree,
  shouldExcludeTrackedPath,
  validateAcceptanceReport,
  validateParityManifest,
} from '../../tools/run_browser_acceptance.mjs';

const MODEL_SHA256 =
  'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69';

function parityManifest() {
  return {
    schema_version: 1,
    tensor: {
      shape: [1, 3, 384, 384],
      dtype: 'float32',
      byte_order: 'little-endian',
      layout: 'NCHW',
      float_count: 442368,
      bytes: 1769472,
    },
    model: {
      source: 'web_demo/models/baseline2_njr_fp32.onnx',
      file: 'baseline2_njr_fp32.onnx',
      bytes: 88123029,
      sha256: MODEL_SHA256,
      input_name: 'input',
      output_name: 'logits',
    },
    threshold: 0.55657113,
    images: EXPECTED_PARITY_SOURCES.map((source, index) => ({
      id: source.replace(/\.[^.]+$/, '').replaceAll('/', '__'),
      source,
      reference: `tensors/sample-${index}.f32`,
      original_dimensions: { width: 384, height: 384 },
      oriented_dimensions: { width: 384, height: 384 },
      tensor: {
        shape: [1, 3, 384, 384],
        float_count: 442368,
        bytes: 1769472,
        sha256: `${index.toString(16).padStart(2, '0')}${'0'.repeat(62)}`,
      },
      logit: index - 7,
      probability: index / 14,
      label: index / 14 >= 0.55657113 ? 'AIGC' : 'Real',
    })),
  };
}

describe('READY output parsing', () => {
  it('accepts one exact 127.0.0.1 URL split across chunks', () => {
    const parser = new ReadyLineParser();

    expect(parser.push('REA')).toBeUndefined();
    expect(parser.push('DY http://127.0.0.1:8766/\r')).toBeUndefined();
    expect(parser.push('\n')).toEqual({
      href: 'http://127.0.0.1:8766/',
      origin: 'http://127.0.0.1:8766',
      port: 8766,
    });
  });

  it.each([
    'READY http://localhost:8765/',
    'READY http://127.0.0.1:8765/path',
    'READY https://127.0.0.1:8765/',
    'READY http://127.0.0.1:0/',
    'READY http://127.0.0.1:8765/?query=yes',
  ])('rejects a non-contract READY line: %s', (line) => {
    const parser = new ReadyLineParser();
    expect(() => parser.push(`${line}\n`)).toThrow(/READY/i);
  });

  it('rejects a second READY announcement', () => {
    const parser = new ReadyLineParser();
    parser.push('READY http://127.0.0.1:8765/\n');

    expect(() => parser.push('READY http://127.0.0.1:8766/\n')).toThrow(/multiple READY/i);
  });
});

describe('browser request boundary', () => {
  const origin = 'http://127.0.0.1:8766';

  it('allows only HTTP requests at the exact selected origin', () => {
    expect(inspectRequestUrl(`${origin}/assets/app.js`, origin)).toEqual({
      kind: 'allowed-network',
      origin,
    });
    expect(inspectRequestUrl(`${origin}/models/model.onnx?x=1`, origin).kind).toBe(
      'allowed-network',
    );
    expect(inspectRequestUrl('http://127.0.0.1:8765/', origin).kind).toBe(
      'blocked-network',
    );
    expect(inspectRequestUrl('https://127.0.0.1:8766/', origin).kind).toBe(
      'blocked-network',
    );
    expect(inspectRequestUrl('http://localhost:8766/', origin).kind).toBe(
      'blocked-network',
    );
  });

  it('does not mistake blob and data preview URLs for network egress', () => {
    expect(inspectRequestUrl(`blob:${origin}/preview`, origin).kind).toBe('non-network');
    expect(inspectRequestUrl('data:image/png;base64,AAAA', origin).kind).toBe('non-network');
  });

  it('allows only the matching WebSocket origin for the selected HTTP server', () => {
    expect(inspectWebSocketUrl('ws://127.0.0.1:8766/events', origin)).toEqual({
      kind: 'allowed-network',
      origin: 'ws://127.0.0.1:8766',
    });
    expect(inspectWebSocketUrl('ws://127.0.0.1:8765/events', origin).kind).toBe(
      'blocked-network',
    );
    expect(inspectWebSocketUrl('wss://127.0.0.1:8766/events', origin).kind).toBe(
      'blocked-network',
    );
    expect(inspectWebSocketUrl('ws://localhost:8766/events', origin).kind).toBe(
      'blocked-network',
    );
  });

  it('routes WebSockets before pages exist and never connects a blocked origin', async () => {
    let webSocketHandler;
    const context = {
      route: vi.fn(async () => {}),
      routeWebSocket: vi.fn(async (_pattern, handler) => {
        webSocketHandler = handler;
      }),
    };
    const audit = {
      origins: new Set(),
      webSocketOrigins: new Set(),
      paths: new Map(),
      violations: [],
    };
    await installNetworkBoundary(context, origin, audit);

    expect(context.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));
    const allowed = {
      url: () => 'ws://127.0.0.1:8766/events',
      connectToServer: vi.fn(),
      close: vi.fn(async () => {}),
    };
    await webSocketHandler(allowed);
    expect(allowed.connectToServer).toHaveBeenCalledOnce();
    expect(allowed.close).not.toHaveBeenCalled();
    expect(audit.webSocketOrigins).toEqual(new Set(['ws://127.0.0.1:8766']));

    const blocked = {
      url: () => 'wss://remote.example/events',
      connectToServer: vi.fn(),
      close: vi.fn(async () => {}),
    };
    await webSocketHandler(blocked);
    expect(blocked.connectToServer).not.toHaveBeenCalled();
    expect(blocked.close).toHaveBeenCalledWith({
      code: 1008,
      reason: 'Blocked by browser acceptance network boundary',
    });
    expect(audit.violations).toContain('wss://remote.example/events');
  });
});

describe('frozen score references', () => {
  it('compares dimensions by values, independent of JSON property order', () => {
    expect(sameDimensions({ width: 300, height: 200 }, { height: 200, width: 300 })).toBe(true);
    expect(sameDimensions({ width: 300, height: 200 }, { height: 300, width: 200 })).toBe(false);
  });

  it('requires the exact ten demo plus five fixture order', () => {
    const validated = validateParityManifest(parityManifest());

    expect(validated.images).toHaveLength(15);
    expect(validated.images.map(({ source }) => source)).toEqual(EXPECTED_PARITY_SOURCES);
  });

  it('rejects the obsolete ten-plus-four interpretation', () => {
    const manifest = parityManifest();
    manifest.images.pop();

    expect(() => validateParityManifest(manifest)).toThrow(/15|parity source/i);
  });

  it('rejects a mismatched deployed model identity', () => {
    const manifest = parityManifest();
    manifest.model.sha256 = '0'.repeat(64);

    expect(() => validateParityManifest(manifest)).toThrow(/model SHA-256/i);
  });

  it('parses all ten unique demo probabilities in frozen order', () => {
    const rows = [
      ...['f1', 'f2', 'f3', 'f4', 'f5'],
      ...['r1', 'r2', 'r3', 'r4', 'r5'],
    ].map((name, index) => ({ image_path: `${name}.png`, pred: index / 10 }));

    expect([...parseDemoPredictions(rows).keys()]).toEqual(
      rows.map(({ image_path }) => `demo_images/${image_path}`),
    );
  });

  it('reports both absolute error and frozen-threshold flips', () => {
    expect(compareProbability(0.558, 0.557, 0.55657113)).toEqual({
      absoluteError: 0.0010000000000000009,
      expectedLabel: 'AIGC',
      actualLabel: 'AIGC',
      thresholdFlip: false,
      withinTolerance: true,
    });
    expect(compareProbability(0.558, 0.55, 0.55657113)).toMatchObject({
      thresholdFlip: true,
      withinTolerance: true,
    });
    expect(compareProbability(0.9, 0.88, 0.55657113)).toMatchObject({
      thresholdFlip: false,
      withinTolerance: false,
    });
  });
});

describe('tracked-only fresh copy', () => {
  it('tree-terminates both direct and BAT-launched servers on Windows', () => {
    expect(shouldTerminateProcessTree('win32', 'direct')).toBe(true);
    expect(shouldTerminateProcessTree('win32', 'launcher')).toBe(true);
    expect(shouldTerminateProcessTree('linux', 'launcher')).toBe(true);
    expect(shouldTerminateProcessTree('linux', 'direct')).toBe(false);
  });

  it('fails immediately with the taskkill diagnostic when tree termination is denied', () => {
    expect(() =>
      assertSuccessfulProcessTreeTermination(
        { code: 1, signal: null, stdout: '', stderr: 'ERROR: Access denied' },
        1234,
      ),
    ).toThrow(/PID 1234.*Access denied/i);
    expect(
      assertSuccessfulProcessTreeTermination(
        { code: 0, signal: null, stdout: 'SUCCESS', stderr: '' },
        1234,
      ),
    ).toBeTruthy();
  });

  it.each([
    '.git/config',
    '.venv/Scripts/python.exe',
    'web_demo/node_modules/react/index.js',
    'web_models/baseline2_njr_fp16.onnx',
  ])('excludes %s', (path) => {
    expect(shouldExcludeTrackedPath(path)).toBe(true);
  });

  it.each([
    'web_demo/models/baseline2_njr_fp32.onnx',
    'web_demo/dist/index.html',
    'web_demo/start-demo.bat',
    'demo_images/f1.png',
  ])('keeps %s', (path) => {
    expect(shouldExcludeTrackedPath(path)).toBe(false);
  });

  it('parses NUL-delimited Git paths and rejects traversal', () => {
    expect(parseTrackedFiles(Buffer.from('README.md\0web_demo/dist/index.html\0'))).toEqual([
      'README.md',
      'web_demo/dist/index.html',
    ]);
    expect(() => parseTrackedFiles(Buffer.from('../outside\0'))).toThrow(/unsafe tracked path/i);
  });

  it('passes the BAT path through an environment variable instead of command text', () => {
    const invocation = buildBatchInvocation('C:\\Temp\\LingShu 评委 本地复现\\web_demo\\start-demo.bat', [
      '--no-browser',
    ]);

    expect(invocation.commandLine).toBe('call "%LINGSHU_DEMO_LAUNCHER%" --no-browser');
    expect(invocation.commandArguments).toEqual([
      '/d',
      '/s',
      '/c',
      'call "%LINGSHU_DEMO_LAUNCHER%" --no-browser',
    ]);
    expect(invocation.detached).toBe(false);
    expect(invocation.windowsVerbatimArguments).toBe(true);
    expect(invocation.environment.LINGSHU_DEMO_LAUNCHER).toContain('LingShu 评委 本地复现');
    expect(invocation.commandLine).not.toContain('评委');
  });

  it('executes a real BAT through cmd.exe from a Unicode fresh-copy path', async () => {
    if (process.platform !== 'win32') return;
    const base = await mkdtemp(path.join(os.tmpdir(), 'lingshu-unicode-bat-'));
    const root = path.join(base, 'LingShu 评委 本地复现');
    const launcher = path.join(root, 'web_demo', 'start-demo.bat');
    try {
      await mkdir(path.dirname(launcher), { recursive: true });
      await writeFile(launcher, '@echo off\r\necho UNICODE_BAT_OK\r\n', 'utf8');
      const invocation = buildBatchInvocation(launcher, ['--check']);
      const commandShell =
        process.env.ComSpec ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
      const result = spawnSync(commandShell, invocation.commandArguments, {
        cwd: root,
        detached: invocation.detached,
        env: { ...process.env, ...invocation.environment },
        encoding: 'utf8',
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('UNICODE_BAT_OK');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('acceptance evidence schema', () => {
  function providerEvidence(mode, provider, origin) {
    const images = EXPECTED_PARITY_SOURCES.map((source, index) => ({
      source,
      reference: index < 10 ? 'demo_predictions_cpu' : 'pillow_fp32_onnx',
      referenceProbability: index / 15,
      probability: index / 15,
      absoluteError: 0,
      label: index / 15 >= 0.55657113 ? 'AIGC' : 'Real',
      provider,
      elapsedMs: 1,
      thresholdFlip: false,
    }));
    return {
      mode,
      expectedProvider: provider,
      gpu: { apiAvailable: true, adapterAvailable: provider === 'WebGPU', adapterInfo: null },
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

  function report() {
    const sourceOrigin = 'http://127.0.0.1:8766';
    const freshOrigin = 'http://127.0.0.1:8767';
    return {
      schemaVersion: 1,
      passed: true,
      generatedAt: '2026-08-30T00:00:00.000Z',
      commit: 'a'.repeat(40),
      platform: { platform: 'win32', release: '10.0.0', arch: 'x64' },
      runtime: {
        node: 'v22.0.0',
        python: 'Python 3.12.0',
        edge: '140.0.0.0',
        edgeExecutable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      },
      model: { bytes: 88123029, sha256: MODEL_SHA256 },
      threshold: 0.55657113,
      gates: { maxProbabilityError: 0.01, imagesPerProvider: 15 },
      portFallback: {
        occupiedPort: 8765,
        occupation: 'acceptance-holder',
        selectedPort: 8766,
        passed: true,
      },
      source: {
        serverUrl: `${sourceOrigin}/`,
        providers: {
          normal: providerEvidence('normal', 'WebGPU', sourceOrigin),
          wasm: providerEvidence('wasm', 'WASM', sourceOrigin),
        },
        terminationUnreachable: true,
      },
      artifactFailures: {
        corruptModel: { exitCode: 1, diagnostic: 'model SHA-256 mismatch' },
        missingWasm: { exitCode: 1, diagnostic: 'ORT runtime is missing' },
      },
      freshCopy: {
        directoryName: 'LingShu 评委 本地复现',
        trackedFileCount: 100,
        excluded: ['.git', 'node_modules', '.venv', 'web_models'],
        npmInstallRun: false,
        batchCheck: { exitCode: 0, output: 'Distribution verification passed.' },
        serverUrl: `${freshOrigin}/`,
        providers: {
          normal: providerEvidence('normal', 'WebGPU', freshOrigin),
          wasm: providerEvidence('wasm', 'WASM', freshOrigin),
        },
        terminationUnreachable: true,
      },
    };
  }

  it('accepts a complete source and Unicode fresh-copy report', () => {
    expect(validateAcceptanceReport(report())).toBeTruthy();
  });

  it.each([
    ['missing image', (value) => value.source.providers.normal.images.pop()],
    ['threshold flip', (value) => { value.freshCopy.providers.wasm.images[0].thresholdFlip = true; }],
    ['remote origin', (value) => { value.source.providers.normal.requestOrigins = ['https://remote.example']; }],
    ['remote WebSocket', (value) => { value.source.providers.normal.webSocketOrigins = ['wss://remote.example']; }],
    ['NaN probability', (value) => { value.source.providers.wasm.images[0].probability = Number.NaN; }],
    ['successful corrupt model', (value) => { value.artifactFailures.corruptModel.exitCode = 0; }],
  ])('rejects malformed evidence: %s', (_label, mutate) => {
    const value = report();
    mutate(value);
    expect(() => validateAcceptanceReport(value)).toThrow();
  });
});
