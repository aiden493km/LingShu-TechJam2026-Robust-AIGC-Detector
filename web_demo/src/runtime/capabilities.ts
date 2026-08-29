import type { ExecutionProvider } from './model-session';

export interface CapabilityNavigator {
  readonly userAgent: string;
  readonly hardwareConcurrency: number;
  readonly gpu?: {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<unknown | null>;
  };
}

export interface CapabilityEnvironment {
  readonly navigator: CapabilityNavigator;
  readonly crossOriginIsolated: boolean;
  readonly webAssembly: unknown;
}

export interface RuntimeCapabilities {
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly webGpuApiAvailable: boolean;
  readonly webGpuAdapterAvailable: boolean;
  readonly wasmAvailable: boolean;
  readonly hardwareConcurrency: number;
  readonly actualProvider: ExecutionProvider;
}

function currentEnvironment(): CapabilityEnvironment {
  const browserNavigator: CapabilityNavigator =
    typeof navigator === 'undefined'
      ? { userAgent: '', hardwareConcurrency: 1 }
      : navigator;
  return {
    navigator: browserNavigator,
    crossOriginIsolated:
      typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated,
    webAssembly: typeof WebAssembly === 'undefined' ? undefined : WebAssembly,
  };
}

export async function collectRuntimeCapabilities(
  actualProvider: ExecutionProvider,
  environment: CapabilityEnvironment = currentEnvironment(),
): Promise<RuntimeCapabilities> {
  const gpu = environment.navigator.gpu;
  let webGpuAdapterAvailable = false;
  if (gpu !== undefined) {
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      webGpuAdapterAvailable = adapter !== null && adapter !== undefined;
    } catch {
      webGpuAdapterAvailable = false;
    }
  }

  return {
    userAgent: environment.navigator.userAgent,
    crossOriginIsolated: environment.crossOriginIsolated,
    webGpuApiAvailable: gpu !== undefined,
    webGpuAdapterAvailable,
    wasmAvailable:
      typeof environment.webAssembly === 'object' ||
      typeof environment.webAssembly === 'function',
    hardwareConcurrency: environment.navigator.hardwareConcurrency,
    actualProvider,
  };
}
