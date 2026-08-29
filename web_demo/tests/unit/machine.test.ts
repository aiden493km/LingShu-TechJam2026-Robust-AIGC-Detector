import { describe, expect, it, vi } from 'vitest';

import {
  createInitialDetectorState,
  detectorReducer,
  type DetectorState,
  type ImageDetails,
} from '../../src/detector/machine';
import {
  DetectorController,
  OperationGate,
  PreviewUrlOwner,
  prepareSelectedImage,
  requireSingleFile,
  type DetectorDependencies,
} from '../../src/detector/use-detector';
import type {
  RuntimeEnvironmentInspection,
  RuntimeEnvironmentSnapshot,
} from '../../src/runtime/capabilities';
import type { DetectionResult } from '../../src/runtime/infer';
import {
  ModelSessionInitializationError,
  type LoadedModelSession,
} from '../../src/runtime/model-session';

const environmentSnapshot: RuntimeEnvironmentSnapshot = {
  userAgent: 'Judge Browser 1.0',
  crossOriginIsolated: true,
  webGpuApiAvailable: true,
  webGpuAdapterAvailable: false,
  wasmAvailable: true,
  hardwareConcurrency: 8,
};

const environmentInspection: RuntimeEnvironmentInspection = {
  userAgent: environmentSnapshot.userAgent,
  crossOriginIsolated: true,
  webGpuApiAvailable: true,
  wasmAvailable: true,
  hardwareConcurrency: 8,
};

function loadedModel(overrides: Partial<LoadedModelSession> = {}): LoadedModelSession {
  return {
    session: {
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as LoadedModelSession['session'],
    provider: 'wasm',
    manifest: {
      model: { precision: 'FP32' },
      source: { tag: 'v1.0.0' },
      threshold: { aigc: 0.55657113 },
    } as LoadedModelSession['manifest'],
    fallbackReason: 'WebGPU adapter unavailable',
    ...overrides,
  };
}

const image: ImageDetails = {
  fileName: 'judge-image.png',
  previewUrl: 'blob:judge-image',
  originalWidth: 1600,
  originalHeight: 900,
  orientedWidth: 900,
  orientedHeight: 1600,
};

const result: DetectionResult = {
  logit: 1.25,
  probability: 0.77729986,
  label: 'AIGC',
  provider: 'wasm',
  elapsedMs: 42.5,
};

function reachInferring(model = loadedModel()): DetectorState {
  let state: DetectorState = createInitialDetectorState();
  state = detectorReducer(state, { type: 'model-ready', model });
  state = detectorReducer(state, { type: 'file-selected', fileName: image.fileName });
  state = detectorReducer(state, {
    type: 'validation-succeeded',
    previewUrl: image.previewUrl,
  });
  return detectorReducer(state, { type: 'preprocessing-succeeded', image });
}

describe('detectorReducer', () => {
  it('moves through every successful phase with determinate model progress', () => {
    const model = loadedModel();
    let state: DetectorState = createInitialDetectorState();

    expect(state).toEqual({
      phase: 'booting',
      progress: { loaded: 0, total: 88_123_029 },
    });

    state = detectorReducer(state, {
      type: 'model-progressed',
      progress: { loaded: 40_000_000, total: 88_123_029 },
    });
    expect(state).toMatchObject({ phase: 'booting', progress: { loaded: 40_000_000 } });

    state = detectorReducer(state, { type: 'model-ready', model });
    expect(state).toEqual({ phase: 'ready', model });

    state = detectorReducer(state, { type: 'file-selected', fileName: image.fileName });
    expect(state).toEqual({ phase: 'validating', model, fileName: image.fileName });

    state = detectorReducer(state, {
      type: 'validation-succeeded',
      previewUrl: image.previewUrl,
    });
    expect(state).toEqual({
      phase: 'preprocessing',
      model,
      image: { fileName: image.fileName, previewUrl: image.previewUrl },
    });

    state = detectorReducer(state, { type: 'preprocessing-succeeded', image });
    expect(state).toEqual({ phase: 'inferring', model, image });

    state = detectorReducer(state, { type: 'inference-succeeded', result });
    expect(state).toEqual({ phase: 'success', model, image, result });
  });

  it('synchronously clears the previous score when a new file is selected', () => {
    const model = loadedModel();
    const success = detectorReducer(reachInferring(model), {
      type: 'inference-succeeded',
      result,
    });

    const next = detectorReducer(success, {
      type: 'file-selected',
      fileName: '<img src=x onerror=alert(1)>.png',
    });

    expect(next).toEqual({
      phase: 'validating',
      model,
      fileName: '<img src=x onerror=alert(1)>.png',
    });
    expect('result' in next).toBe(false);
    expect('image' in next).toBe(false);
  });

  it.each([
    { start: 'validating' as const, stage: 'validation' as const },
    { start: 'preprocessing' as const, stage: 'preprocessing' as const },
    { start: 'inferring' as const, stage: 'inference' as const },
  ])('removes image and result data after a $stage failure', ({ start, stage }) => {
    const model = loadedModel();
    const inferring = reachInferring(model);
    const states = {
      validating: detectorReducer(
        { phase: 'success', model, image, result },
        { type: 'file-selected', fileName: image.fileName },
      ),
      preprocessing: detectorReducer(
        detectorReducer(
          { phase: 'success', model, image, result },
          { type: 'file-selected', fileName: image.fileName },
        ),
        { type: 'validation-succeeded', previewUrl: image.previewUrl },
      ),
      inferring,
    } satisfies Record<typeof start, DetectorState>;

    const failed = detectorReducer(states[start], {
      type: 'workflow-failed',
      stage,
      message: 'Choose another supported image and try again.',
    });

    expect(failed).toEqual({
      phase: 'error',
      kind: 'workflow',
      stage,
      message: 'Choose another supported image and try again.',
      model,
    });
    expect('result' in failed).toBe(false);
    expect('image' in failed).toBe(false);
  });

  it('reset returns to ready while preserving the cached model session', () => {
    const model = loadedModel();
    const success = detectorReducer(reachInferring(model), {
      type: 'inference-succeeded',
      result,
    });

    const reset = detectorReducer(success, { type: 'reset' });

    expect(reset).toEqual({ phase: 'ready', model });
    expect(reset.phase === 'ready' ? reset.model.session : undefined).toBe(model.session);
    expect(model.session.release).not.toHaveBeenCalled();
  });

  it('keeps WebGPU fallback context non-blocking through work and reset', () => {
    const model = loadedModel({ fallbackReason: 'WebGPU initialization failed safely' });
    const inferring = reachInferring(model);

    expect(inferring.phase).toBe('inferring');
    expect(inferring.phase === 'inferring' ? inferring.model.fallbackReason : undefined).toBe(
      'WebGPU initialization failed safely',
    );

    const reset = detectorReducer(inferring, { type: 'reset' });
    expect(reset).toEqual({ phase: 'ready', model });
  });

  it('distinguishes model boot failure and supports an explicit retry', () => {
    const failed = detectorReducer(createInitialDetectorState(), {
      type: 'model-failed',
      message: 'The local FP32 model could not be initialized. Retry the model load.',
      environment: environmentSnapshot,
      providerDiagnostics: [],
    });

    expect(failed).toEqual({
      phase: 'error',
      kind: 'model',
      message: 'The local FP32 model could not be initialized. Retry the model load.',
      environment: environmentSnapshot,
      providerDiagnostics: [],
    });

    expect(detectorReducer(failed, { type: 'retry-model' })).toEqual(
      createInitialDetectorState(),
    );
  });
});

describe('detector workflow helpers', () => {
  it('requires exactly one image before starting work', () => {
    const file = { name: 'one.png' } as File;

    expect(requireSingleFile([file])).toBe(file);
    expect(() => requireSingleFile([])).toThrow(/choose one image/i);
    expect(() => requireSingleFile([file, file])).toThrow(/one image at a time/i);
  });

  it('aborts the old operation and rejects its late generation', () => {
    const gate = new OperationGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(first.signal.aborted).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(gate.isCurrent(second)).toBe(false);
  });

  it('revokes an old preview before replacement and clears once on reset or unmount', () => {
    const events: string[] = [];
    const previews = new PreviewUrlOwner((url) => events.push(`revoke:${url}`));

    previews.replace('blob:first');
    previews.replace('blob:second');
    expect(events).toEqual(['revoke:blob:first']);
    expect(previews.current).toBe('blob:second');

    previews.clear();
    previews.clear();
    expect(events).toEqual(['revoke:blob:first', 'revoke:blob:second']);
    expect(previews.current).toBeNull();
  });

  it('reads the selected file once, creates a preview only after byte validation, and reuses the bytes', async () => {
    const bytes = new ArrayBuffer(12);
    const read = vi.fn().mockResolvedValue({ buffer: bytes, format: 'webp' as const });
    const preprocess = vi.fn().mockResolvedValue({
      tensor: new Float32Array(3),
      originalWidth: 12,
      originalHeight: 8,
      orientedWidth: 12,
      orientedHeight: 8,
    });
    const order: string[] = [];
    const file = { name: 'single-read.webp' } as File;

    const prepared = await prepareSelectedImage({
      file,
      isCurrent: () => true,
      readAndValidate: async (selected) => {
        order.push('validate');
        return read(selected);
      },
      createObjectUrl: (selected) => {
        order.push('preview');
        expect(selected).toBe(file);
        return 'blob:validated';
      },
      onValidated: (previewUrl) => {
        order.push('validated');
        expect(previewUrl).toBe('blob:validated');
      },
      preprocess: async (buffer, format) => {
        order.push('preprocess');
        return preprocess(buffer, format);
      },
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(preprocess).toHaveBeenCalledWith(bytes, 'webp');
    expect(order).toEqual(['validate', 'preview', 'validated', 'preprocess']);
    expect(prepared?.previewUrl).toBe('blob:validated');
  });

  it('does not create a preview or preprocess when validation resolves after cancellation', async () => {
    let resolveValidation:
      | ((value: { buffer: ArrayBuffer; format: 'png' }) => void)
      | undefined;
    const validation = new Promise<{ buffer: ArrayBuffer; format: 'png' }>((resolve) => {
      resolveValidation = resolve;
    });
    const gate = new OperationGate();
    const operation = gate.begin();
    const createObjectUrl = vi.fn();
    const preprocess = vi.fn();

    const pending = prepareSelectedImage({
      file: { name: 'late.png' } as File,
      isCurrent: () => gate.isCurrent(operation),
      readAndValidate: () => validation,
      createObjectUrl,
      onValidated: vi.fn(),
      preprocess,
    });
    gate.cancel();
    resolveValidation?.({ buffer: new ArrayBuffer(1), format: 'png' });

    await expect(pending).resolves.toBeUndefined();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(preprocess).not.toHaveBeenCalled();
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controllerDependencies(
  overrides: Partial<DetectorDependencies> = {},
): DetectorDependencies {
  return {
    loadModel: vi.fn().mockResolvedValue(loadedModel()),
    collectEnvironment: vi.fn().mockReturnValue(environmentSnapshot),
    inspectEnvironment: vi.fn().mockReturnValue(environmentInspection),
    readAndValidate: vi.fn().mockResolvedValue({
      buffer: new ArrayBuffer(8),
      format: 'png' as const,
    }),
    preprocess: vi.fn().mockResolvedValue({
      tensor: new Float32Array(3 * 384 * 384),
      originalWidth: 640,
      originalHeight: 480,
      orientedWidth: 640,
      orientedHeight: 480,
    }),
    detect: vi.fn().mockResolvedValue(result),
    createObjectUrl: vi.fn().mockReturnValue('blob:current'),
    revokeObjectUrl: vi.fn(),
    ...overrides,
  };
}

describe('DetectorController', () => {
  it('loads one cached session, reports progress, and reuses it for repeated images', async () => {
    const model = loadedModel();
    const bytes = new ArrayBuffer(16);
    const dependencies = controllerDependencies({
      loadModel: vi.fn(async ({ onProgress }) => {
        onProgress?.({ loaded: 44_000_000, total: 88_123_029 });
        return model;
      }),
      readAndValidate: vi.fn().mockResolvedValue({ buffer: bytes, format: 'png' }),
    });
    const controller = new DetectorController(dependencies);

    await controller.start();
    expect(controller.getSnapshot()).toEqual({ phase: 'ready', model });

    const first = { name: 'first.png' } as File;
    const firstRun = controller.selectFile([first]);
    expect(controller.getSnapshot()).toEqual({
      phase: 'validating',
      model,
      fileName: 'first.png',
    });
    await firstRun;
    expect(controller.getSnapshot()).toMatchObject({ phase: 'success', result });

    await controller.selectFile([{ name: 'second.png' } as File]);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'success', result });
    expect(dependencies.loadModel).toHaveBeenCalledTimes(1);
    expect(dependencies.collectEnvironment).not.toHaveBeenCalled();
    expect(dependencies.readAndValidate).toHaveBeenCalledTimes(2);
    expect(dependencies.preprocess).toHaveBeenNthCalledWith(1, bytes, 'png');
    expect(dependencies.detect).toHaveBeenCalledTimes(2);
    expect(model.session.release).not.toHaveBeenCalled();
  });

  it('keeps reset synchronous and prevents a late inference from restoring stale output', async () => {
    const lateResult = deferred<DetectionResult>();
    const model = loadedModel();
    const dependencies = controllerDependencies({
      loadModel: vi.fn().mockResolvedValue(model),
      detect: vi.fn(() => lateResult.promise),
    });
    const controller = new DetectorController(dependencies);
    await controller.start();

    const pending = controller.selectFile([{ name: 'late.png' } as File]);
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe('inferring'));
    controller.reset();

    expect(controller.getSnapshot()).toEqual({ phase: 'ready', model });
    expect(dependencies.revokeObjectUrl).toHaveBeenCalledWith('blob:current');
    expect(model.session.release).not.toHaveBeenCalled();

    lateResult.resolve(result);
    await pending;
    expect(controller.getSnapshot()).toEqual({ phase: 'ready', model });
  });

  it('clears the current preview and result after preprocessing or inference failure', async () => {
    const model = loadedModel();
    const dependencies = controllerDependencies({
      loadModel: vi.fn().mockResolvedValue(model),
      preprocess: vi.fn().mockRejectedValue(new Error('decoder\u0000 failed   locally')),
    });
    const controller = new DetectorController(dependencies);
    await controller.start();

    await controller.selectFile([{ name: 'broken.png' } as File]);

    expect(controller.getSnapshot()).toEqual({
      phase: 'error',
      kind: 'workflow',
      stage: 'preprocessing',
      model,
      message:
        'The image could not be prepared locally. decoder failed locally Choose another image and try again.',
    });
    expect(dependencies.revokeObjectUrl).toHaveBeenCalledWith('blob:current');
    expect('result' in controller.getSnapshot()).toBe(false);
    expect('image' in controller.getSnapshot()).toBe(false);
  });

  it('releases a model session that resolves after unmount and never publishes it', async () => {
    const lateModel = deferred<LoadedModelSession>();
    const model = loadedModel();
    const dependencies = controllerDependencies({
      loadModel: vi.fn(() => lateModel.promise),
    });
    const controller = new DetectorController(dependencies);

    const loading = controller.start();
    await controller.dispose();
    lateModel.resolve(model);
    await loading;

    expect(model.session.release).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe('booting');
  });

  it('separates model initialization errors and retries with a new generation', async () => {
    const model = loadedModel();
    const loadModel = vi
      .fn()
      .mockRejectedValueOnce(new Error('runtime\u0000 unavailable'))
      .mockResolvedValueOnce(model);
    const controller = new DetectorController(controllerDependencies({ loadModel }));

    await controller.start();
    expect(controller.getSnapshot()).toEqual({
      phase: 'error',
      kind: 'model',
      message:
        'The local FP32 model could not be initialized. runtime unavailable Retry the model load.',
      environment: environmentSnapshot,
      providerDiagnostics: [],
    });

    await controller.retryModel();
    expect(controller.getSnapshot()).toEqual({ phase: 'ready', model });
    expect(loadModel).toHaveBeenCalledTimes(2);
  });

  it('preserves separate full WebGPU and WASM diagnostics from a typed initialization failure', async () => {
    const webGpuMessage = `WebGPU ${'w'.repeat(293)}`;
    const wasmMessage = `WASM ${'a'.repeat(295)}`;
    const error = new ModelSessionInitializationError([
      { provider: 'webgpu', message: webGpuMessage },
      { provider: 'wasm', message: wasmMessage },
    ]);
    const collectEnvironment = vi.fn().mockReturnValue(environmentSnapshot);
    const controller = new DetectorController(
      controllerDependencies({
        loadModel: vi.fn().mockRejectedValue(error),
        collectEnvironment,
      }),
    );

    await controller.start();

    expect(controller.getSnapshot()).toEqual({
      phase: 'error',
      kind: 'model',
      message: 'Both local execution providers failed to initialize. Retry the model load.',
      environment: environmentSnapshot,
      providerDiagnostics: [
        { provider: 'webgpu', message: webGpuMessage },
        { provider: 'wasm', message: wasmMessage },
      ],
    });
    expect(collectEnvironment).toHaveBeenCalledTimes(1);
    expect(webGpuMessage).toHaveLength(300);
    expect(wasmMessage).toHaveLength(300);
  });

  it('names only the provider that was actually attempted in forced-provider mode', async () => {
    const wasmMessage = 'WASM session creation failed locally';
    const controller = new DetectorController(
      controllerDependencies({
        loadModel: vi.fn().mockRejectedValue(
          new ModelSessionInitializationError([
            { provider: 'wasm', message: wasmMessage },
          ]),
        ),
      }),
    );

    await controller.start();

    expect(controller.getSnapshot()).toEqual({
      phase: 'error',
      kind: 'model',
      message: 'The attempted WASM provider failed to initialize. Retry the model load.',
      environment: environmentSnapshot,
      providerDiagnostics: [{ provider: 'wasm', message: wasmMessage }],
    });
  });

  it('falls back to synchronous facts when asynchronous capability collection fails', async () => {
    const controller = new DetectorController(
      controllerDependencies({
        loadModel: vi.fn().mockRejectedValue(new Error('manifest unavailable')),
        collectEnvironment: vi.fn().mockRejectedValue(new Error('adapter probe failed')),
        inspectEnvironment: vi.fn().mockReturnValue(environmentInspection),
      }),
    );

    await controller.start();

    expect(controller.getSnapshot()).toEqual({
      phase: 'error',
      kind: 'model',
      message:
        'The local FP32 model could not be initialized. manifest unavailable Retry the model load.',
      environment: {
        ...environmentInspection,
        webGpuAdapterAvailable: null,
      },
      providerDiagnostics: [],
    });
  });

  it('does not publish asynchronous diagnostics after the model operation becomes stale', async () => {
    const diagnostics = deferred<RuntimeEnvironmentSnapshot>();
    const collectEnvironment = vi.fn(() => diagnostics.promise);
    const controller = new DetectorController(
      controllerDependencies({
        loadModel: vi.fn().mockRejectedValue(new Error('manifest failed')),
        collectEnvironment,
      }),
    );

    const loading = controller.start();
    await vi.waitFor(() => expect(collectEnvironment).toHaveBeenCalledTimes(1));
    controller.reset();
    diagnostics.resolve(environmentSnapshot);
    await loading;

    expect(controller.getSnapshot()).toEqual(createInitialDetectorState());
  });

  it('does not publish asynchronous diagnostics after disposal', async () => {
    const diagnostics = deferred<RuntimeEnvironmentSnapshot>();
    const collectEnvironment = vi.fn(() => diagnostics.promise);
    const controller = new DetectorController(
      controllerDependencies({
        loadModel: vi.fn().mockRejectedValue(new Error('model download failed')),
        collectEnvironment,
      }),
    );

    const loading = controller.start();
    await vi.waitFor(() => expect(collectEnvironment).toHaveBeenCalledTimes(1));
    await controller.dispose();
    diagnostics.resolve(environmentSnapshot);
    await loading;

    expect(controller.getSnapshot()).toEqual(createInitialDetectorState());
  });

  it('does not swallow a retry fired before the failed active load reaches its finally cleanup', async () => {
    const model = loadedModel();
    const loadModel = vi
      .fn()
      .mockRejectedValueOnce(new Error('first load failed'))
      .mockResolvedValueOnce(model);
    const controller = new DetectorController(controllerDependencies({ loadModel }));
    let retry: Promise<void> | undefined;
    const unsubscribe = controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (state.phase === 'error' && state.kind === 'model' && retry === undefined) {
        retry = controller.retryModel();
      }
    });

    await controller.start();
    await retry;
    unsubscribe();

    expect(controller.getSnapshot()).toEqual({ phase: 'ready', model });
    expect(loadModel).toHaveBeenCalledTimes(2);
  });
});
