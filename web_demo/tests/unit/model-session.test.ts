import type { InferenceSession } from 'onnxruntime-web/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import manifestJson from '../../models/manifest.json';
import { collectRuntimeCapabilities } from '../../src/runtime/capabilities';
import { parseModelManifest } from '../../src/runtime/contract';
import {
  chooseProvider,
  createOrtSession,
  fetchModelBytes,
  fetchModelManifest,
  fetchVerifiedModelBytes,
  hasWebGpuAdapter,
  loadModelSession,
  ModelSessionContractError,
  ModelSessionInitializationError,
  parseProviderPreference,
} from '../../src/runtime/model-session';

const ortMock = vi.hoisted(() => ({
  create: vi.fn(),
  env: {
    wasm: {} as {
      wasmPaths?: unknown;
      proxy?: boolean;
      numThreads?: number;
    },
  },
}));

vi.mock('onnxruntime-web/webgpu', () => ({
  env: ortMock.env,
  InferenceSession: { create: ortMock.create },
}));

const manifest = parseModelManifest(manifestJson);

function validSession(overrides: Partial<InferenceSession> = {}): InferenceSession {
  return {
    inputNames: ['input'],
    outputNames: ['logits'],
    inputMetadata: [
      {
        name: 'input',
        isTensor: true,
        type: 'float32',
        shape: [1, 3, 384, 384],
      },
    ],
    outputMetadata: [
      {
        name: 'logits',
        isTensor: true,
        type: 'float32',
        shape: [1, 1],
      },
    ],
    run: vi.fn(),
    release: vi.fn().mockResolvedValue(undefined),
    startProfiling: vi.fn(),
    endProfiling: vi.fn(),
    ...overrides,
  } as InferenceSession;
}

interface FakeReaderOptions {
  chunks?: readonly unknown[];
  failure?: unknown;
}

function streamResponse(
  options: FakeReaderOptions = {},
  headers: Record<string, string> = {},
): {
  response: Response;
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
} {
  const chunks = [...(options.chunks ?? [])];
  let index = 0;
  const read = vi.fn(async () => {
    if (index < chunks.length) {
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    }
    if (options.failure !== undefined) {
      throw options.failure;
    }
    return { done: true, value: undefined };
  });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const releaseLock = vi.fn();
  const response = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(headers),
    body: {
      getReader: () => ({ read, cancel, releaseLock }),
    },
  } as unknown as Response;
  return { response, read, cancel, releaseLock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseProviderPreference', () => {
  it.each([
    ['', 'auto'],
    ['?provider=webgpu', 'auto'],
    ['?provider=WASM', 'auto'],
    ['?provider=wasm&provider=wasm', 'auto'],
    ['?provider=wasm&provider=other', 'auto'],
    ['?unrelated=1', 'auto'],
    ['?provider=wasm', 'wasm'],
    ['?unrelated=1&provider=wasm', 'wasm'],
  ] as const)('maps %s to the closed preference %s', (search, expected) => {
    expect(parseProviderPreference(search)).toBe(expected);
  });
});

describe('ORT boundary', () => {
  it('configures the shared WebGPU build once before creating singleton provider sessions', async () => {
    const session = validSession();
    const bytes = Uint8Array.of(1, 2, 3);
    ortMock.create.mockResolvedValue(session);

    await createOrtSession('webgpu', bytes, manifest, {
      crossOriginIsolated: true,
      hardwareConcurrency: 12,
    });
    await createOrtSession('wasm', bytes, manifest, {
      crossOriginIsolated: false,
      hardwareConcurrency: 1,
    });

    expect(ortMock.env.wasm.wasmPaths).toEqual({
      mjs: '/assets/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: '/assets/ort-wasm-simd-threaded.asyncify.wasm',
    });
    expect(ortMock.env.wasm.proxy).toBe(false);
    expect(ortMock.env.wasm.numThreads).toBe(4);
    expect(ortMock.create).toHaveBeenNthCalledWith(1, bytes, {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all',
    });
    expect(ortMock.create).toHaveBeenNthCalledWith(2, bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  });

  it('reports no adapter for an absent API, a null adapter, or a rejected request', async () => {
    const nullRequest = vi.fn().mockResolvedValue(null);
    const undefinedRequest = vi.fn().mockResolvedValue(undefined);
    const rejectedRequest = vi.fn().mockRejectedValue(new Error('blocked'));

    await expect(hasWebGpuAdapter({})).resolves.toBe(false);
    await expect(hasWebGpuAdapter({ gpu: { requestAdapter: nullRequest } })).resolves.toBe(false);
    await expect(
      hasWebGpuAdapter({ gpu: { requestAdapter: undefinedRequest } }),
    ).resolves.toBe(false);
    await expect(
      hasWebGpuAdapter({ gpu: { requestAdapter: rejectedRequest } }),
    ).resolves.toBe(false);
    expect(nullRequest).toHaveBeenCalledOnce();
    expect(undefinedRequest).toHaveBeenCalledOnce();
    expect(rejectedRequest).toHaveBeenCalledOnce();
  });
});

describe('chooseProvider', () => {
  it('uses WebGPU when an adapter and a valid WebGPU session are available', async () => {
    const session = validSession();
    const create = vi.fn().mockResolvedValue(session);

    const result = await chooseProvider({
      preference: 'auto',
      modelBytes: Uint8Array.of(1),
      manifest,
      hasWebGpuAdapter: vi.fn().mockResolvedValue(true),
      create,
    });

    expect(result).toEqual({ session, provider: 'webgpu', manifest });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toBe('webgpu');
  });

  it('goes directly to WASM when no WebGPU adapter is available', async () => {
    const session = validSession();
    const create = vi.fn().mockResolvedValue(session);

    const result = await chooseProvider({
      preference: 'auto',
      modelBytes: Uint8Array.of(1),
      manifest,
      hasWebGpuAdapter: vi.fn().mockResolvedValue(false),
      create,
    });

    expect(result.provider).toBe('wasm');
    expect(result.fallbackReason).toMatch(/adapter.*unavailable/i);
    expect(create.mock.calls.map(([provider]) => provider)).toEqual(['wasm']);
  });

  it('goes directly to WASM when the injected adapter check rejects', async () => {
    const session = validSession();
    const create = vi.fn().mockResolvedValue(session);

    const result = await chooseProvider({
      preference: 'auto',
      modelBytes: Uint8Array.of(1),
      manifest,
      hasWebGpuAdapter: vi.fn().mockRejectedValue(new Error('adapter\nprobe rejected')),
      create,
    });

    expect(result.provider).toBe('wasm');
    expect(result.fallbackReason).toBe('adapter probe rejected');
    expect(create.mock.calls.map(([provider]) => provider)).toEqual(['wasm']);
  });

  it('records a sanitized WebGPU creation error and reuses identical artifacts for WASM', async () => {
    const bytes = Uint8Array.of(7, 8, 9);
    const wasmSession = validSession();
    const attempts: Array<{ provider: string; bytes: Uint8Array; seenManifest: unknown }> = [];
    const create = vi.fn(async (provider, seenBytes, seenManifest) => {
      attempts.push({ provider, bytes: seenBytes, seenManifest });
      if (provider === 'webgpu') {
        throw new Error('gpu\ninit\tfailed');
      }
      return wasmSession;
    });

    const result = await chooseProvider({
      preference: 'auto',
      modelBytes: bytes,
      manifest,
      hasWebGpuAdapter: vi.fn().mockResolvedValue(true),
      create,
    });

    expect(result.provider).toBe('wasm');
    expect(result.fallbackReason).toBe('gpu init failed');
    expect(attempts.map(({ provider }) => provider)).toEqual(['webgpu', 'wasm']);
    expect(attempts[0]?.bytes).toBe(bytes);
    expect(attempts[1]?.bytes).toBe(bytes);
    expect(attempts[0]?.seenManifest).toBe(manifest);
    expect(attempts[1]?.seenManifest).toBe(manifest);
  });

  it('skips every WebGPU call for the forced WASM preference', async () => {
    const adapterCheck = vi.fn().mockResolvedValue(true);
    const session = validSession();
    const create = vi.fn().mockResolvedValue(session);

    const result = await chooseProvider({
      preference: 'wasm',
      modelBytes: Uint8Array.of(1),
      manifest,
      hasWebGpuAdapter: adapterCheck,
      create,
    });

    expect(result).toEqual({ session, provider: 'wasm', manifest });
    expect(adapterCheck).not.toHaveBeenCalled();
    expect(create.mock.calls.map(([provider]) => provider)).toEqual(['wasm']);
  });

  it('throws a typed error with both sanitized provider diagnostics when both creations fail', async () => {
    const create = vi.fn(async (provider: string) => {
      throw new Error(provider === 'webgpu' ? 'gpu\nfailed' : 'wasm\tfailed');
    });

    const promise = chooseProvider({
      preference: 'auto',
      modelBytes: Uint8Array.of(1),
      manifest,
      hasWebGpuAdapter: vi.fn().mockResolvedValue(true),
      create,
    });

    await expect(promise).rejects.toMatchObject({
      name: 'ModelSessionInitializationError',
      diagnostics: [
        { provider: 'webgpu', message: 'gpu failed' },
        { provider: 'wasm', message: 'wasm failed' },
      ],
    });
    await expect(promise).rejects.toBeInstanceOf(ModelSessionInitializationError);
  });

  it('releases a created session with an invalid tensor contract and does not disguise it as fallback', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const invalidSession = validSession({
      inputMetadata: [
        { name: 'input', isTensor: true, type: 'float32', shape: [1, 3, 224, 224] },
      ],
      release,
    });
    const create = vi.fn().mockResolvedValue(invalidSession);

    const promise = chooseProvider({
      preference: 'auto',
      modelBytes: Uint8Array.of(1),
      manifest,
      hasWebGpuAdapter: vi.fn().mockResolvedValue(true),
      create,
    });

    await expect(promise).rejects.toBeInstanceOf(ModelSessionContractError);
    expect(release).toHaveBeenCalledOnce();
    expect(create.mock.calls.map(([provider]) => provider)).toEqual(['webgpu']);
  });
});

describe('manifest and streamed model loading', () => {
  it('fetches and parses the manifest exactly once', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(manifestJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const parsed = await fetchModelManifest({ fetch: fetcher });

    expect(parsed).toEqual(manifest);
    expect(parsed).not.toBe(manifestJson);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/models/manifest.json');
  });

  it('streams one fetch directly into exact-size bytes and reports monotonic progress', async () => {
    const fixture = streamResponse(
      { chunks: [Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)] },
      { 'Content-Length': '5' },
    );
    const fetcher = vi.fn().mockResolvedValue(fixture.response);
    const progress = vi.fn();

    const bytes = await fetchModelBytes(
      { file: 'tiny.onnx', bytes: 5 },
      { fetch: fetcher, onProgress: progress },
    );

    expect(bytes).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
    expect(bytes.byteLength).toBe(5);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/models/tiny.onnx');
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { loaded: 0, total: 5 },
      { loaded: 2, total: 5 },
      { loaded: 5, total: 5 },
    ]);
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.releaseLock).toHaveBeenCalledOnce();
  });

  it('verifies the exact five streamed bytes and applies cache override only to the model', async () => {
    const fixture = streamResponse({
      chunks: [Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)],
    });
    const fetcher = vi.fn().mockResolvedValue(fixture.response);
    const verifier = vi.fn().mockResolvedValue(undefined);
    const expectedSha256 = 'a'.repeat(64);

    const bytes = await fetchVerifiedModelBytes(
      { file: 'tiny.onnx', bytes: 5, sha256: expectedSha256 },
      { fetch: fetcher, modelCache: 'reload', verifySha256: verifier },
    );

    expect(bytes).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
    expect(fetcher).toHaveBeenCalledWith('/models/tiny.onnx', { cache: 'reload' });
    expect(verifier).toHaveBeenCalledOnce();
    expect(verifier).toHaveBeenCalledWith(bytes, expectedSha256);
  });

  it('stops before provider selection and session creation when verification fails', async () => {
    const integrityFailure = new Error('downloaded model failed verification');
    const modelFixture = streamResponse({
      chunks: [new Uint8Array(manifest.model.bytes)],
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(manifestJson), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(modelFixture.response);
    const verifySha256 = vi.fn().mockRejectedValue(integrityFailure);
    const hasAdapter = vi.fn().mockResolvedValue(true);
    const create = vi.fn().mockResolvedValue(validSession());

    await expect(
      loadModelSession({
        fetch: fetcher,
        modelCache: 'reload',
        verifySha256,
        hasWebGpuAdapter: hasAdapter,
        create,
      }),
    ).rejects.toBe(integrityFailure);

    expect(fetcher).toHaveBeenNthCalledWith(1, '/models/manifest.json', undefined);
    expect(fetcher).toHaveBeenNthCalledWith(2, `/models/${manifest.model.file}`, {
      cache: 'reload',
    });
    expect(verifySha256).toHaveBeenCalledWith(expect.any(Uint8Array), manifest.model.sha256);
    expect(hasAdapter).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(ortMock.create).not.toHaveBeenCalled();
  });

  it('preserves an abort raised while model verification is pending', async () => {
    const modelFixture = streamResponse({
      chunks: [new Uint8Array(manifest.model.bytes)],
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(manifestJson), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(modelFixture.response);
    let resolveVerification: (() => void) | undefined;
    const verifySha256 = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveVerification = resolve;
        }),
    );
    const hasAdapter = vi.fn().mockResolvedValue(true);
    const create = vi.fn().mockResolvedValue(validSession());
    const controller = new AbortController();
    const abortError = new DOMException('Model load was cancelled', 'AbortError');

    const loading = loadModelSession({
      fetch: fetcher,
      signal: controller.signal,
      verifySha256,
      hasWebGpuAdapter: hasAdapter,
      create,
    });
    await vi.waitFor(() => expect(verifySha256).toHaveBeenCalledOnce());

    controller.abort(abortError);
    resolveVerification?.();

    await expect(loading).rejects.toBe(abortError);
    expect(hasAdapter).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(ortMock.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'mismatched Content-Length',
      response: () => streamResponse({ chunks: [Uint8Array.of(1, 2, 3)] }, { 'Content-Length': '4' }),
      expectedBytes: 3,
      error: /content-length.*4.*expected 3/i,
    },
    {
      name: 'invalid Content-Length',
      response: () => streamResponse({ chunks: [Uint8Array.of(1, 2, 3)] }, { 'Content-Length': 'three' }),
      expectedBytes: 3,
      error: /content-length.*invalid/i,
    },
    {
      name: 'overflow',
      response: () => streamResponse({ chunks: [Uint8Array.of(1, 2), Uint8Array.of(3, 4)] }),
      expectedBytes: 3,
      error: /exceeded.*3/i,
    },
    {
      name: 'truncation',
      response: () => streamResponse({ chunks: [Uint8Array.of(1, 2)] }),
      expectedBytes: 3,
      error: /ended at 2.*expected 3/i,
    },
  ])('cancels the reader on $name', async ({ response, expectedBytes, error }) => {
    const fixture = response();

    await expect(
      fetchModelBytes(
        { file: 'tiny.onnx', bytes: expectedBytes },
        { fetch: vi.fn().mockResolvedValue(fixture.response) },
      ),
    ).rejects.toThrow(error);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.releaseLock).toHaveBeenCalledOnce();
  });

  it('cancels the reader and preserves AbortError when reading is aborted', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const fixture = streamResponse({ chunks: [Uint8Array.of(1)] });
    const controller = new AbortController();
    controller.abort(abortError);

    await expect(
      fetchModelBytes(
        { file: 'tiny.onnx', bytes: 1 },
        {
          fetch: vi.fn().mockResolvedValue(fixture.response),
          signal: controller.signal,
        },
      ),
    ).rejects.toBe(abortError);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it('rejects a missing response body before allocating model output', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    } as Response;

    await expect(
      fetchModelBytes(
        { file: 'tiny.onnx', bytes: 1 },
        { fetch: vi.fn().mockResolvedValue(response) },
      ),
    ).rejects.toThrow(/readable body/i);
  });

  it('rejects non-byte reader chunks and cancels the reader', async () => {
    const fixture = streamResponse({ chunks: ['not bytes'] });

    await expect(
      fetchModelBytes(
        { file: 'tiny.onnx', bytes: 1 },
        { fetch: vi.fn().mockResolvedValue(fixture.response) },
      ),
    ).rejects.toThrow(/uint8array/i);
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });
});

describe('collectRuntimeCapabilities', () => {
  it('returns only the privacy-bounded browser/runtime fields', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({
      info: {
        vendor: 'must-not-be-returned',
        architecture: 'must-not-be-returned',
        device: 'must-not-be-returned',
      },
    });

    const capabilities = await collectRuntimeCapabilities('webgpu', {
      navigator: {
        userAgent: 'Test Browser/1.0',
        hardwareConcurrency: 8,
        gpu: { requestAdapter },
      },
      crossOriginIsolated: true,
      webAssembly: {},
    });

    expect(capabilities).toEqual({
      userAgent: 'Test Browser/1.0',
      crossOriginIsolated: true,
      webGpuApiAvailable: true,
      webGpuAdapterAvailable: true,
      wasmAvailable: true,
      hardwareConcurrency: 8,
      actualProvider: 'webgpu',
    });
    expect(Object.keys(capabilities).sort()).toEqual(
      [
        'actualProvider',
        'crossOriginIsolated',
        'hardwareConcurrency',
        'userAgent',
        'wasmAvailable',
        'webGpuAdapterAvailable',
        'webGpuApiAvailable',
      ].sort(),
    );
  });

  it('handles a rejected adapter request without exposing the error', async () => {
    const requestAdapter = vi.fn().mockRejectedValue(new Error('private adapter details'));

    const capabilities = await collectRuntimeCapabilities('wasm', {
      navigator: {
        userAgent: 'Fallback Browser',
        hardwareConcurrency: 2,
        gpu: { requestAdapter },
      },
      crossOriginIsolated: false,
      webAssembly: {},
    });

    expect(capabilities.webGpuApiAvailable).toBe(true);
    expect(capabilities.webGpuAdapterAvailable).toBe(false);
    expect(capabilities.actualProvider).toBe('wasm');
    expect(JSON.stringify(capabilities)).not.toContain('private adapter details');
  });
});
