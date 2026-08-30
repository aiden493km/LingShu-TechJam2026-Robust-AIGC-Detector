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

export interface RuntimeEnvironmentInspection {
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly webGpuApiAvailable: boolean;
  readonly wasmAvailable: boolean;
  readonly hardwareConcurrency: number;
}

export interface RuntimeEnvironmentSnapshot extends RuntimeEnvironmentInspection {
  readonly webGpuAdapterAvailable: boolean | null;
}

export interface ResolvedRuntimeEnvironmentSnapshot extends RuntimeEnvironmentInspection {
  readonly webGpuAdapterAvailable: boolean;
}

export interface RuntimeCapabilities extends ResolvedRuntimeEnvironmentSnapshot {
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

export function inspectRuntimeEnvironment(
  environment: CapabilityEnvironment = currentEnvironment(),
): RuntimeEnvironmentInspection {
  const gpu = environment.navigator.gpu;
  return {
    userAgent: environment.navigator.userAgent,
    crossOriginIsolated: environment.crossOriginIsolated,
    webGpuApiAvailable: gpu !== undefined,
    wasmAvailable:
      typeof environment.webAssembly === 'object' ||
      typeof environment.webAssembly === 'function',
    hardwareConcurrency: environment.navigator.hardwareConcurrency,
  };
}

export async function collectRuntimeEnvironment(
  environment: CapabilityEnvironment = currentEnvironment(),
): Promise<ResolvedRuntimeEnvironmentSnapshot> {
  const inspection = inspectRuntimeEnvironment(environment);
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
    ...inspection,
    webGpuAdapterAvailable,
  };
}

export async function collectRuntimeCapabilities(
  actualProvider: ExecutionProvider,
  environment: CapabilityEnvironment = currentEnvironment(),
): Promise<RuntimeCapabilities> {
  return {
    ...(await collectRuntimeEnvironment(environment)),
    actualProvider,
  };
}
