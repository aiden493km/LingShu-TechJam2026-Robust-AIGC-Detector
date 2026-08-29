import { MODEL_BYTES } from '../runtime/contract';
import type { RuntimeEnvironmentSnapshot } from '../runtime/capabilities';
import type { DetectionResult } from '../runtime/infer';
import type {
  LoadedModelSession,
  ModelLoadProgress,
  ProviderDiagnostic,
} from '../runtime/model-session';

export interface PreviewImage {
  readonly fileName: string;
  readonly previewUrl: string;
}

export interface ImageDetails extends PreviewImage {
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly orientedWidth: number;
  readonly orientedHeight: number;
}

export type WorkflowStage = 'validation' | 'preprocessing' | 'inference';

export type DetectorState =
  | {
      readonly phase: 'booting';
      readonly progress: ModelLoadProgress;
    }
  | {
      readonly phase: 'ready';
      readonly model: LoadedModelSession;
    }
  | {
      readonly phase: 'validating';
      readonly model: LoadedModelSession;
      readonly fileName: string;
    }
  | {
      readonly phase: 'preprocessing';
      readonly model: LoadedModelSession;
      readonly image: PreviewImage;
    }
  | {
      readonly phase: 'inferring';
      readonly model: LoadedModelSession;
      readonly image: ImageDetails;
    }
  | {
      readonly phase: 'success';
      readonly model: LoadedModelSession;
      readonly image: ImageDetails;
      readonly result: DetectionResult;
    }
  | {
      readonly phase: 'error';
      readonly kind: 'model';
      readonly message: string;
      readonly environment: RuntimeEnvironmentSnapshot;
      readonly providerDiagnostics: readonly ProviderDiagnostic[];
    }
  | {
      readonly phase: 'error';
      readonly kind: 'workflow';
      readonly stage: WorkflowStage;
      readonly message: string;
      readonly model: LoadedModelSession;
    };

export type DetectorEvent =
  | { readonly type: 'model-progressed'; readonly progress: ModelLoadProgress }
  | { readonly type: 'model-ready'; readonly model: LoadedModelSession }
  | {
      readonly type: 'model-failed';
      readonly message: string;
      readonly environment: RuntimeEnvironmentSnapshot;
      readonly providerDiagnostics: readonly ProviderDiagnostic[];
    }
  | { readonly type: 'file-selected'; readonly fileName: string }
  | { readonly type: 'validation-succeeded'; readonly previewUrl: string }
  | { readonly type: 'preprocessing-succeeded'; readonly image: ImageDetails }
  | { readonly type: 'inference-succeeded'; readonly result: DetectionResult }
  | {
      readonly type: 'workflow-failed';
      readonly stage: WorkflowStage;
      readonly message: string;
    }
  | { readonly type: 'reset' }
  | { readonly type: 'retry-model' };

export function createInitialDetectorState(): DetectorState {
  return {
    phase: 'booting',
    progress: { loaded: 0, total: MODEL_BYTES },
  };
}

function stateModel(state: DetectorState): LoadedModelSession | undefined {
  switch (state.phase) {
    case 'ready':
    case 'validating':
    case 'preprocessing':
    case 'inferring':
    case 'success':
      return state.model;
    case 'error':
      return state.kind === 'workflow' ? state.model : undefined;
    case 'booting':
      return undefined;
  }
}

export function detectorReducer(state: DetectorState, event: DetectorEvent): DetectorState {
  switch (event.type) {
    case 'model-progressed':
      return state.phase === 'booting' ? { phase: 'booting', progress: event.progress } : state;
    case 'model-ready':
      return state.phase === 'booting' ? { phase: 'ready', model: event.model } : state;
    case 'model-failed':
      return state.phase === 'booting'
        ? {
            phase: 'error',
            kind: 'model',
            message: event.message,
            environment: event.environment,
            providerDiagnostics: event.providerDiagnostics,
          }
        : state;
    case 'file-selected': {
      const model = stateModel(state);
      return model === undefined
        ? state
        : { phase: 'validating', model, fileName: event.fileName };
    }
    case 'validation-succeeded':
      return state.phase === 'validating'
        ? {
            phase: 'preprocessing',
            model: state.model,
            image: { fileName: state.fileName, previewUrl: event.previewUrl },
          }
        : state;
    case 'preprocessing-succeeded':
      return state.phase === 'preprocessing'
        ? { phase: 'inferring', model: state.model, image: event.image }
        : state;
    case 'inference-succeeded':
      return state.phase === 'inferring'
        ? { phase: 'success', model: state.model, image: state.image, result: event.result }
        : state;
    case 'workflow-failed': {
      const model = stateModel(state);
      return model === undefined
        ? state
        : {
            phase: 'error',
            kind: 'workflow',
            stage: event.stage,
            message: event.message,
            model,
          };
    }
    case 'reset': {
      const model = stateModel(state);
      return model === undefined ? state : { phase: 'ready', model };
    }
    case 'retry-model':
      return state.phase === 'error' && state.kind === 'model'
        ? createInitialDetectorState()
        : state;
  }
}
