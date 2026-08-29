import * as ort from 'onnxruntime-web/webgpu';

import { parseModelManifest, type ModelManifest } from './contract';

export type ExecutionProvider = 'webgpu' | 'wasm';
export type ProviderPreference = 'auto' | 'wasm';

export interface ModelLoadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface RuntimeEnvironment {
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number;
}

export interface WebGpuNavigator {
  readonly gpu?: {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<unknown | null>;
  };
}

export interface ProviderDiagnostic {
  readonly provider: ExecutionProvider;
  readonly message: string;
}

export interface LoadedModelSession {
  readonly session: ort.InferenceSession;
  readonly provider: ExecutionProvider;
  readonly manifest: ModelManifest;
  readonly fallbackReason?: string;
}

export class ModelSessionInitializationError extends Error {
  override readonly name = 'ModelSessionInitializationError';
  readonly diagnostics: readonly ProviderDiagnostic[];

  constructor(diagnostics: readonly ProviderDiagnostic[]) {
    const detail = diagnostics
      .map(({ provider, message }) => `${provider}: ${message}`)
      .join('; ');
    super(`Unable to initialize the FP32 detector${detail.length > 0 ? ` (${detail})` : ''}`);
    this.diagnostics = diagnostics.map(({ provider, message }) => ({ provider, message }));
  }
}

export class ModelSessionContractError extends Error {
  override readonly name = 'ModelSessionContractError';
}

export class ModelDownloadError extends Error {
  override readonly name = 'ModelDownloadError';
}

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchOptions {
  readonly fetch?: FetchFunction;
  readonly signal?: AbortSignal;
}

export interface ModelFetchOptions extends FetchOptions {
  readonly onProgress?: (progress: ModelLoadProgress) => void;
}

export interface ModelDownloadDescriptor {
  readonly file: string;
  readonly bytes: number;
}

export interface ChooseProviderOptions {
  readonly preference: ProviderPreference;
  readonly modelBytes: Uint8Array;
  readonly manifest: ModelManifest;
  readonly hasWebGpuAdapter: () => Promise<boolean>;
  readonly create: (
    provider: ExecutionProvider,
    modelBytes: Uint8Array,
    manifest: ModelManifest,
  ) => Promise<ort.InferenceSession>;
}

export interface LoadModelSessionOptions extends ModelFetchOptions {
  readonly search?: string;
  readonly environment?: RuntimeEnvironment;
  readonly navigator?: WebGpuNavigator;
  readonly hasWebGpuAdapter?: () => Promise<boolean>;
  readonly create?: ChooseProviderOptions['create'];
}

const WASM_PATH = '/assets/ort-wasm-simd-threaded.asyncify.wasm';
const DIAGNOSTIC_LIMIT = 300;
let ortConfigured = false;

function currentEnvironment(): RuntimeEnvironment {
  const concurrency =
    typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency;
  return {
    crossOriginIsolated:
      typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated,
    hardwareConcurrency: concurrency,
  };
}

function currentNavigator(): WebGpuNavigator {
  return typeof navigator === 'undefined' ? {} : navigator;
}

function currentSearch(): string {
  return typeof location === 'undefined' ? '' : location.search;
}

function defaultFetch(): FetchFunction {
  if (typeof globalThis.fetch !== 'function') {
    throw new ModelDownloadError('The browser Fetch API is unavailable');
  }
  return globalThis.fetch.bind(globalThis) as FetchFunction;
}

function fetchInit(signal: AbortSignal | undefined): RequestInit | undefined {
  return signal === undefined ? undefined : { signal };
}

function sanitizeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized.length > 0 ? normalized : 'Unknown initialization failure').slice(
    0,
    DIAGNOSTIC_LIMIT,
  );
}

export function parseProviderPreference(search: string): ProviderPreference {
  const values = new URLSearchParams(search).getAll('provider');
  return values.length === 1 && values[0] === 'wasm' ? 'wasm' : 'auto';
}

export function configureOrtRuntime(environment: RuntimeEnvironment = currentEnvironment()): void {
  if (ortConfigured) {
    return;
  }

  const reportedConcurrency = environment.hardwareConcurrency;
  const hardwareConcurrency =
    Number.isFinite(reportedConcurrency) && reportedConcurrency >= 1
      ? Math.floor(reportedConcurrency)
      : 1;
  ort.env.wasm.wasmPaths = { wasm: WASM_PATH };
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = environment.crossOriginIsolated
    ? Math.min(4, hardwareConcurrency)
    : 1;
  ortConfigured = true;
}

export async function createOrtSession(
  provider: ExecutionProvider,
  modelBytes: Uint8Array,
  _manifest: ModelManifest,
  environment: RuntimeEnvironment = currentEnvironment(),
): Promise<ort.InferenceSession> {
  configureOrtRuntime(environment);
  return ort.InferenceSession.create(modelBytes, {
    executionProviders: [provider],
    graphOptimizationLevel: 'all',
  });
}

export async function hasWebGpuAdapter(
  browserNavigator: WebGpuNavigator = currentNavigator(),
): Promise<boolean> {
  if (browserNavigator.gpu === undefined) {
    return false;
  }

  try {
    const adapter = await browserNavigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

function sameValues(
  actual: readonly (number | string)[],
  expected: readonly number[],
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value)
  );
}

function assertNames(
  kind: 'input' | 'output',
  actual: readonly string[],
  expected: string,
): void {
  if (actual.length !== 1 || actual[0] !== expected) {
    throw new ModelSessionContractError(
      `Session must expose exactly one ${kind} named ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`,
    );
  }
}

function assertMetadata(
  kind: 'input' | 'output',
  actual: readonly ort.InferenceSession.ValueMetadata[],
  expected: { readonly name: string; readonly dtype: 'float32'; readonly shape: readonly number[] },
): void {
  const metadata = actual[0];
  if (
    actual.length !== 1 ||
    metadata === undefined ||
    metadata.name !== expected.name ||
    !metadata.isTensor ||
    metadata.type !== expected.dtype ||
    !sameValues(metadata.shape, expected.shape)
  ) {
    throw new ModelSessionContractError(
      `Session ${kind} metadata must be tensor ${JSON.stringify(expected.name)} ${expected.dtype} ${JSON.stringify(expected.shape)}`,
    );
  }
}

export async function validateSessionContract(
  session: ort.InferenceSession,
  manifest: ModelManifest,
): Promise<void> {
  try {
    assertNames('input', session.inputNames, manifest.model.input.name);
    assertNames('output', session.outputNames, manifest.model.output.name);
    assertMetadata('input', session.inputMetadata, manifest.model.input);
    assertMetadata('output', session.outputMetadata, manifest.model.output);
  } catch (error) {
    const contractMessage = sanitizeDiagnostic(error);
    let releaseFailure: string | undefined;
    try {
      await session.release();
    } catch (releaseError) {
      releaseFailure = sanitizeDiagnostic(releaseError);
    }
    throw new ModelSessionContractError(
      releaseFailure === undefined
        ? contractMessage
        : `${contractMessage}; session release failed: ${releaseFailure}`,
    );
  }
}

async function createValidatedSession(
  provider: ExecutionProvider,
  options: ChooseProviderOptions,
): Promise<ort.InferenceSession> {
  const session = await options.create(provider, options.modelBytes, options.manifest);
  await validateSessionContract(session, options.manifest);
  return session;
}

export async function chooseProvider(
  options: ChooseProviderOptions,
): Promise<LoadedModelSession> {
  const diagnostics: ProviderDiagnostic[] = [];
  let fallbackReason: string | undefined;

  if (options.preference === 'auto') {
    let adapterAvailable = false;
    try {
      adapterAvailable = await options.hasWebGpuAdapter();
      if (!adapterAvailable) {
        fallbackReason = 'WebGPU adapter unavailable';
      }
    } catch (error) {
      fallbackReason = sanitizeDiagnostic(error);
    }

    if (adapterAvailable) {
      try {
        const session = await createValidatedSession('webgpu', options);
        return { session, provider: 'webgpu', manifest: options.manifest };
      } catch (error) {
        if (error instanceof ModelSessionContractError) {
          throw error;
        }
        fallbackReason = sanitizeDiagnostic(error);
      }
    }

    diagnostics.push({
      provider: 'webgpu',
      message: fallbackReason ?? 'WebGPU adapter unavailable',
    });
  }

  try {
    const session = await createValidatedSession('wasm', options);
    return fallbackReason === undefined
      ? { session, provider: 'wasm', manifest: options.manifest }
      : { session, provider: 'wasm', manifest: options.manifest, fallbackReason };
  } catch (error) {
    if (error instanceof ModelSessionContractError) {
      throw error;
    }
    diagnostics.push({ provider: 'wasm', message: sanitizeDiagnostic(error) });
    throw new ModelSessionInitializationError(diagnostics);
  }
}

async function cancelBody(response: Response, reason: unknown): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Preserve the original response failure.
  }
}

export async function fetchModelManifest(
  options: FetchOptions = {},
): Promise<ModelManifest> {
  const fetcher = options.fetch ?? defaultFetch();
  const response = await fetcher('/models/manifest.json', fetchInit(options.signal));
  if (typeof response !== 'object' || response === null || response.ok !== true) {
    if (typeof response === 'object' && response !== null) {
      await cancelBody(response, 'manifest response rejected');
    }
    const status =
      typeof response === 'object' && response !== null
        ? `HTTP ${String(response.status)}`
        : 'an invalid response';
    throw new ModelDownloadError(`Failed to fetch /models/manifest.json: ${status}`);
  }
  return parseModelManifest(await response.json());
}

interface ByteReader {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel(reason?: unknown): Promise<unknown>;
  releaseLock(): void;
}

function responseReader(response: Response): ByteReader {
  const body = response.body as unknown;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('getReader' in body) ||
    typeof body.getReader !== 'function'
  ) {
    throw new ModelDownloadError('Model response must provide a readable body');
  }
  const reader = body.getReader() as unknown;
  if (
    typeof reader !== 'object' ||
    reader === null ||
    !('read' in reader) ||
    typeof reader.read !== 'function' ||
    !('cancel' in reader) ||
    typeof reader.cancel !== 'function' ||
    !('releaseLock' in reader) ||
    typeof reader.releaseLock !== 'function'
  ) {
    throw new ModelDownloadError('Model response body returned an invalid stream reader');
  }
  return reader as ByteReader;
}

function expectedContentLength(response: Response, expectedBytes: number): void {
  const headers = response.headers as unknown;
  if (
    typeof headers !== 'object' ||
    headers === null ||
    !('get' in headers) ||
    typeof headers.get !== 'function'
  ) {
    throw new ModelDownloadError('Model response returned invalid headers');
  }
  const value = headers.get('Content-Length');
  if (value === null) {
    return;
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ModelDownloadError(`Model Content-Length is invalid: ${JSON.stringify(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed !== expectedBytes) {
    throw new ModelDownloadError(
      `Model Content-Length ${value} does not match expected ${expectedBytes}`,
    );
  }
}

async function streamModelResponse(
  response: Response,
  expectedBytes: number,
  signal: AbortSignal | undefined,
  onProgress: ((progress: ModelLoadProgress) => void) | undefined,
): Promise<Uint8Array> {
  const reader = responseReader(response);
  let completed = false;
  try {
    expectedContentLength(response, expectedBytes);
    signal?.throwIfAborted();
    const output = new Uint8Array(expectedBytes);
    let loaded = 0;
    onProgress?.({ loaded, total: expectedBytes });

    while (true) {
      const readResult = await reader.read();
      if (
        typeof readResult !== 'object' ||
        readResult === null ||
        typeof readResult.done !== 'boolean'
      ) {
        throw new ModelDownloadError('Model stream reader returned an invalid result');
      }
      if (readResult.done) {
        break;
      }
      if (!(readResult.value instanceof Uint8Array)) {
        throw new ModelDownloadError('Model stream chunks must be Uint8Array values');
      }
      if (loaded + readResult.value.byteLength > expectedBytes) {
        throw new ModelDownloadError(
          `Model stream exceeded expected ${expectedBytes} bytes`,
        );
      }
      output.set(readResult.value, loaded);
      loaded += readResult.value.byteLength;
      onProgress?.({ loaded, total: expectedBytes });
    }

    if (loaded !== expectedBytes) {
      throw new ModelDownloadError(
        `Model stream ended at ${loaded} bytes; expected ${expectedBytes}`,
      );
    }
    completed = true;
    return output;
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original stream failure.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      if (completed) {
        throw new ModelDownloadError('Failed to release the completed model stream reader');
      }
    }
  }
}

export async function fetchModelBytes(
  descriptor: ModelDownloadDescriptor,
  options: ModelFetchOptions = {},
): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9._-]+$/.test(descriptor.file)) {
    throw new ModelDownloadError(`Invalid model filename ${JSON.stringify(descriptor.file)}`);
  }
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) {
    throw new ModelDownloadError(`Invalid expected model byte count ${String(descriptor.bytes)}`);
  }

  const fetcher = options.fetch ?? defaultFetch();
  const path = `/models/${descriptor.file}`;
  const response = await fetcher(path, fetchInit(options.signal));
  if (typeof response !== 'object' || response === null || response.ok !== true) {
    if (typeof response === 'object' && response !== null) {
      await cancelBody(response, 'model response rejected');
    }
    const status =
      typeof response === 'object' && response !== null
        ? `HTTP ${String(response.status)}`
        : 'an invalid response';
    throw new ModelDownloadError(`Failed to fetch ${path}: ${status}`);
  }

  return streamModelResponse(response, descriptor.bytes, options.signal, options.onProgress);
}

export async function loadModelSession(
  options: LoadModelSessionOptions = {},
): Promise<LoadedModelSession> {
  const environment = options.environment ?? currentEnvironment();
  configureOrtRuntime(environment);
  const fetcher = options.fetch ?? defaultFetch();
  const sharedFetchOptions: FetchOptions =
    options.signal === undefined ? { fetch: fetcher } : { fetch: fetcher, signal: options.signal };
  const manifest = await fetchModelManifest(sharedFetchOptions);
  const modelFetchOptions: ModelFetchOptions = {
    ...sharedFetchOptions,
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };
  const modelBytes = await fetchModelBytes(manifest.model, modelFetchOptions);
  const browserNavigator = options.navigator ?? currentNavigator();

  return chooseProvider({
    preference: parseProviderPreference(options.search ?? currentSearch()),
    modelBytes,
    manifest,
    hasWebGpuAdapter:
      options.hasWebGpuAdapter ?? (() => hasWebGpuAdapter(browserNavigator)),
    create:
      options.create ??
      ((provider, bytes, parsedManifest) =>
        createOrtSession(provider, bytes, parsedManifest, environment)),
  });
}
