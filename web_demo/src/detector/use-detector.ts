import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import {
  createInitialDetectorState,
  detectorReducer,
  type DetectorState,
  type ImageDetails,
  type WorkflowStage,
} from './machine';
import {
  collectRuntimeEnvironment,
  inspectRuntimeEnvironment,
  type RuntimeEnvironmentInspection,
  type RuntimeEnvironmentSnapshot,
} from '../runtime/capabilities';
import { runDetection, type DetectionResult } from '../runtime/infer';
import {
  loadModelSession,
  type LoadModelSessionOptions,
  type LoadedModelSession,
  ModelSessionInitializationError,
  type ProviderDiagnostic,
} from '../runtime/model-session';
import {
  preprocessValidatedImage,
  type PreprocessedImage,
} from '../runtime/preprocess';
import {
  readAndValidateImageFile,
  type SupportedImageFormat,
} from '../runtime/upload';

export interface DetectorOperation {
  readonly generation: number;
  readonly signal: AbortSignal;
}

export class OperationGate {
  private generation = 0;
  private controller: AbortController | undefined;

  begin(): DetectorOperation {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.generation += 1;
    return { generation: this.generation, signal: controller.signal };
  }

  isCurrent(operation: DetectorOperation): boolean {
    return (
      operation.generation === this.generation &&
      operation.signal === this.controller?.signal &&
      !operation.signal.aborted
    );
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.generation += 1;
  }
}

export class PreviewUrlOwner {
  private value: string | null = null;

  constructor(private readonly revoke: (url: string) => void = URL.revokeObjectURL.bind(URL)) {}

  get current(): string | null {
    return this.value;
  }

  replace(nextUrl: string): void {
    if (this.value !== null && this.value !== nextUrl) {
      this.revoke(this.value);
    }
    this.value = nextUrl;
  }

  clear(): void {
    if (this.value === null) {
      return;
    }
    const previous = this.value;
    this.value = null;
    this.revoke(previous);
  }
}

export function requireSingleFile(files: readonly File[] | FileList): File {
  if (files.length === 0) {
    throw new Error('Choose one image to analyze. JPEG, PNG, and WebP are supported.');
  }
  if (files.length !== 1) {
    throw new Error('Choose one image at a time. Remove the extra files and try again.');
  }
  const file = files[0];
  if (file === undefined) {
    throw new Error('Choose one image to analyze. JPEG, PNG, and WebP are supported.');
  }
  return file;
}

export interface ValidatedImageBytes {
  readonly buffer: ArrayBuffer;
  readonly format: SupportedImageFormat;
}

export interface PrepareSelectedImageOptions {
  readonly file: File;
  readonly isCurrent: () => boolean;
  readonly readAndValidate: (file: File) => Promise<ValidatedImageBytes>;
  readonly createObjectUrl: (file: File) => string;
  readonly onValidated: (previewUrl: string) => void;
  readonly preprocess: (
    buffer: ArrayBuffer,
    format: SupportedImageFormat,
  ) => Promise<PreprocessedImage>;
}

export interface PreparedSelectedImage {
  readonly previewUrl: string;
  readonly preprocessed: PreprocessedImage;
}

export async function prepareSelectedImage(
  options: PrepareSelectedImageOptions,
): Promise<PreparedSelectedImage | undefined> {
  const validated = await options.readAndValidate(options.file);
  if (!options.isCurrent()) {
    return undefined;
  }

  const previewUrl = options.createObjectUrl(options.file);
  options.onValidated(previewUrl);
  const preprocessed = await options.preprocess(validated.buffer, validated.format);
  if (!options.isCurrent()) {
    return undefined;
  }

  return { previewUrl, preprocessed };
}

export interface DetectorDependencies {
  readonly loadModel: (options: LoadModelSessionOptions) => Promise<LoadedModelSession>;
  readonly collectEnvironment: () =>
    | RuntimeEnvironmentSnapshot
    | Promise<RuntimeEnvironmentSnapshot>;
  readonly inspectEnvironment: () => RuntimeEnvironmentInspection;
  readonly readAndValidate: (file: File) => Promise<ValidatedImageBytes>;
  readonly preprocess: (
    buffer: ArrayBuffer,
    format: SupportedImageFormat,
  ) => Promise<PreprocessedImage>;
  readonly detect: (
    session: LoadedModelSession['session'],
    provider: LoadedModelSession['provider'],
    tensor: Float32Array,
    manifest: LoadedModelSession['manifest'],
  ) => Promise<DetectionResult>;
  readonly createObjectUrl: (file: File) => string;
  readonly revokeObjectUrl: (url: string) => void;
}

function browserDependencies(): DetectorDependencies {
  return {
    loadModel: loadModelSession,
    collectEnvironment: collectRuntimeEnvironment,
    inspectEnvironment: inspectRuntimeEnvironment,
    readAndValidate: readAndValidateImageFile,
    preprocess: preprocessValidatedImage,
    detect: runDetection,
    createObjectUrl: (file) => URL.createObjectURL(file),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}

function sanitizedDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || 'Unknown local runtime failure').slice(0, 300);
}

interface ModelFailureDetails {
  readonly message: string;
  readonly providerDiagnostics: readonly ProviderDiagnostic[];
}

function modelFailureDetails(error: unknown): ModelFailureDetails {
  if (error instanceof ModelSessionInitializationError) {
    const attemptedProviders = new Set(
      error.diagnostics.map(({ provider }) => provider),
    );
    const message =
      attemptedProviders.has('webgpu') && attemptedProviders.has('wasm')
        ? 'Both local execution providers failed to initialize. Retry the model load.'
        : attemptedProviders.size === 1
          ? `The attempted ${[...attemptedProviders][0]!.toUpperCase()} provider failed to initialize. Retry the model load.`
          : 'Local execution provider initialization failed. Retry the model load.';
    return {
      message,
      providerDiagnostics: error.diagnostics.map(({ provider, message }) => ({
        provider,
        message,
      })),
    };
  }
  return {
    message: `The local FP32 model could not be initialized. ${sanitizedDetail(error)} Retry the model load.`,
    providerDiagnostics: [],
  };
}

function workflowErrorMessage(stage: WorkflowStage, error: unknown): string {
  const detail = sanitizedDetail(error);
  switch (stage) {
    case 'validation':
      return detail;
    case 'preprocessing':
      return `The image could not be prepared locally. ${detail} Choose another image and try again.`;
    case 'inference':
      return `Local inference did not complete. ${detail} Reset the detector and try again.`;
  }
}

async function releaseModel(model: LoadedModelSession): Promise<void> {
  try {
    await model.session.release();
  } catch {
    // Cleanup must not surface a second error or overwrite the detector state.
  }
}

type Listener = () => void;
type ModelErrorState = Extract<DetectorState, { phase: 'error'; kind: 'model' }>;

export class DetectorController {
  private state: DetectorState = createInitialDetectorState();
  private readonly listeners = new Set<Listener>();
  private readonly gate = new OperationGate();
  private readonly previews: PreviewUrlOwner;
  private model: LoadedModelSession | undefined;
  private activeLoad: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly dependencies: DetectorDependencies = browserDependencies()) {
    this.previews = new PreviewUrlOwner(dependencies.revokeObjectUrl);
  }

  readonly getSnapshot = (): DetectorState => this.state;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(event: Parameters<typeof detectorReducer>[1]): void {
    const next = detectorReducer(this.state, event);
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private collectModelEnvironment(
    operation: DetectorOperation,
    failedState: ModelErrorState,
  ): void {
    void Promise.resolve()
      .then(() => this.dependencies.collectEnvironment())
      .then((environment) => {
        if (
          this.gate.isCurrent(operation) &&
          !this.disposed &&
          this.state === failedState
        ) {
          this.publish({ type: 'model-environment-collected', environment });
        }
      })
      .catch(() => {
        // Adapter probing is optional diagnostics. Keep the synchronous snapshot on failure.
      });
  }

  private async performModelLoad(): Promise<void> {
    const operation = this.gate.begin();
    try {
      const model = await this.dependencies.loadModel({
        signal: operation.signal,
        onProgress: (progress) => {
          if (this.gate.isCurrent(operation) && !this.disposed) {
            this.publish({ type: 'model-progressed', progress });
          }
        },
      });
      if (!this.gate.isCurrent(operation) || this.disposed) {
        await releaseModel(model);
        return;
      }
      this.model = model;
      this.publish({ type: 'model-ready', model });
    } catch (error) {
      if (!this.gate.isCurrent(operation) || this.disposed) {
        return;
      }
      this.publish({
        type: 'model-failed',
        ...modelFailureDetails(error),
        environment: {
          ...this.dependencies.inspectEnvironment(),
          webGpuAdapterAvailable: null,
        },
      });
      const failedState = this.state;
      if (
        this.gate.isCurrent(operation) &&
        !this.disposed &&
        failedState.phase === 'error' &&
        failedState.kind === 'model'
      ) {
        this.collectModelEnvironment(operation, failedState);
      }
    }
  }

  private beginModelLoad(): Promise<void> {
    const active = this.activeLoad;
    if (active !== undefined) {
      return active.then(() => {
        if (!this.disposed && this.model === undefined && this.state.phase === 'booting') {
          return this.beginModelLoad();
        }
      });
    }

    const work = this.performModelLoad();
    const tracked = work.finally(() => {
      if (this.activeLoad === tracked) {
        this.activeLoad = undefined;
      }
    });
    this.activeLoad = tracked;
    return tracked;
  }

  async start(): Promise<void> {
    if (
      this.disposed ||
      this.model !== undefined ||
      this.state.phase !== 'booting'
    ) {
      return;
    }
    await this.beginModelLoad();
  }

  readonly selectFile = async (files: readonly File[] | FileList): Promise<void> => {
    if (this.disposed || this.model === undefined) {
      return;
    }

    const operation = this.gate.begin();
    this.previews.clear();

    let file: File;
    try {
      file = requireSingleFile(files);
    } catch (error) {
      this.publish({
        type: 'workflow-failed',
        stage: 'validation',
        message: workflowErrorMessage('validation', error),
      });
      return;
    }

    this.publish({ type: 'file-selected', fileName: file.name });
    let stage: WorkflowStage = 'validation';

    try {
      const prepared = await prepareSelectedImage({
        file,
        isCurrent: () => this.gate.isCurrent(operation) && !this.disposed,
        readAndValidate: this.dependencies.readAndValidate,
        createObjectUrl: (selected) => {
          stage = 'preprocessing';
          return this.dependencies.createObjectUrl(selected);
        },
        onValidated: (previewUrl) => {
          this.previews.replace(previewUrl);
          this.publish({ type: 'validation-succeeded', previewUrl });
        },
        preprocess: this.dependencies.preprocess,
      });
      if (prepared === undefined || !this.gate.isCurrent(operation)) {
        return;
      }

      const image: ImageDetails = {
        fileName: file.name,
        previewUrl: prepared.previewUrl,
        originalWidth: prepared.preprocessed.originalWidth,
        originalHeight: prepared.preprocessed.originalHeight,
        orientedWidth: prepared.preprocessed.orientedWidth,
        orientedHeight: prepared.preprocessed.orientedHeight,
      };
      this.publish({ type: 'preprocessing-succeeded', image });
      stage = 'inference';
      const detection = await this.dependencies.detect(
        this.model.session,
        this.model.provider,
        prepared.preprocessed.tensor,
        this.model.manifest,
      );
      if (!this.gate.isCurrent(operation) || this.disposed) {
        return;
      }
      this.publish({ type: 'inference-succeeded', result: detection });
    } catch (error) {
      if (!this.gate.isCurrent(operation) || this.disposed) {
        return;
      }
      this.previews.clear();
      this.publish({
        type: 'workflow-failed',
        stage,
        message: workflowErrorMessage(stage, error),
      });
    }
  };

  readonly reset = (): void => {
    if (this.disposed) {
      return;
    }
    this.gate.cancel();
    this.previews.clear();
    this.publish({ type: 'reset' });
  };

  readonly retryModel = async (): Promise<void> => {
    if (this.disposed || this.state.phase !== 'error' || this.state.kind !== 'model') {
      return;
    }
    this.gate.cancel();
    this.previews.clear();
    this.publish({ type: 'retry-model' });
    await this.beginModelLoad();
  };

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.gate.cancel();
    this.previews.clear();
    this.listeners.clear();
    const model = this.model;
    this.model = undefined;
    if (model !== undefined) {
      await releaseModel(model);
    }
  }
}

export interface UseDetectorResult {
  readonly state: DetectorState;
  readonly selectFile: (files: readonly File[] | FileList) => Promise<void>;
  readonly reset: () => void;
  readonly retryModel: () => Promise<void>;
}

export function useDetector(): UseDetectorResult {
  const controllerRef = useRef<DetectorController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new DetectorController();
  }
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.start();
    return () => {
      void controller.dispose();
    };
  }, [controller]);

  return useMemo(
    () => ({
      state,
      selectFile: controller.selectFile,
      reset: controller.reset,
      retryModel: controller.retryModel,
    }),
    [controller, state],
  );
}
