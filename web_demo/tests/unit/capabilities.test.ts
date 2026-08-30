import { describe, expect, it, vi } from 'vitest';

import {
  collectRuntimeCapabilities,
  collectRuntimeEnvironment,
  inspectRuntimeEnvironment,
  type CapabilityEnvironment,
} from '../../src/runtime/capabilities';

function environment(
  overrides: Partial<CapabilityEnvironment> = {},
): CapabilityEnvironment {
  return {
    navigator: {
      userAgent: 'Local Browser 1.0',
      hardwareConcurrency: 12,
      gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
    },
    crossOriginIsolated: true,
    webAssembly: WebAssembly,
    ...overrides,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('runtime environment diagnostics', () => {
  it('captures synchronous browser facts without claiming an adapter result', () => {
    const requestAdapter = vi.fn().mockResolvedValue({});
    const snapshot = inspectRuntimeEnvironment(
      environment({
        navigator: {
          userAgent: 'Judge Browser',
          hardwareConcurrency: 8,
          gpu: { requestAdapter },
        },
        crossOriginIsolated: false,
        webAssembly: undefined,
      }),
    );

    expect(snapshot).toEqual({
      userAgent: 'Judge Browser',
      crossOriginIsolated: false,
      webGpuApiAvailable: true,
      wasmAvailable: false,
      hardwareConcurrency: 8,
    });
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('awaits the WebGPU adapter probe and returns a provider-neutral environment snapshot', async () => {
    const adapter = deferred<unknown | null>();
    const requestAdapter = vi.fn(() => adapter.promise);
    const pending = collectRuntimeEnvironment(
      environment({
        navigator: {
          userAgent: 'Async Browser',
          hardwareConcurrency: 4,
          gpu: { requestAdapter },
        },
      }),
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    adapter.resolve({});

    await expect(pending).resolves.toEqual({
      userAgent: 'Async Browser',
      crossOriginIsolated: true,
      webGpuApiAvailable: true,
      webGpuAdapterAvailable: true,
      wasmAvailable: true,
      hardwareConcurrency: 4,
    });
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
  });

  it('keeps the existing actual-provider capability contract', async () => {
    await expect(collectRuntimeCapabilities('wasm', environment())).resolves.toEqual({
      userAgent: 'Local Browser 1.0',
      crossOriginIsolated: true,
      webGpuApiAvailable: true,
      webGpuAdapterAvailable: true,
      wasmAvailable: true,
      hardwareConcurrency: 12,
      actualProvider: 'wasm',
    });
  });
});
