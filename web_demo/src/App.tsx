import { useState, type ChangeEvent, type DragEvent } from 'react';

import type { DetectorState, ImageDetails, PreviewImage } from './detector/machine';
import { useDetector, type UseDetectorResult } from './detector/use-detector';
import type { LoadedModelSession } from './runtime/model-session';

export const APP_NAME = 'LingShu Robust AIGC Detector';

export type DetectorScreenProps = UseDetectorResult;

export function consumeSelectedFiles(
  input: Pick<HTMLInputElement, 'files' | 'value'>,
): readonly File[] {
  const files = input.files === null ? [] : Array.from(input.files);
  input.value = '';
  return files;
}

function modelForState(state: DetectorState): LoadedModelSession | undefined {
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

function imageForState(state: DetectorState): PreviewImage | undefined {
  switch (state.phase) {
    case 'preprocessing':
    case 'inferring':
    case 'success':
      return state.image;
    case 'booting':
    case 'ready':
    case 'validating':
    case 'error':
      return undefined;
  }
}

function hasDimensions(image: PreviewImage): image is ImageDetails {
  return 'originalWidth' in image;
}

function formatProvider(provider: LoadedModelSession['provider']): string {
  return provider === 'webgpu' ? 'WebGPU' : 'WASM';
}

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

function PhaseStatus({ state }: { readonly state: DetectorState }) {
  switch (state.phase) {
    case 'booting': {
      const percent =
        state.progress.total > 0
          ? Math.min(100, (state.progress.loaded / state.progress.total) * 100)
          : 0;
      return (
        <div className="phase-content loading-state">
          <p className="phase-name">Loading model</p>
          <p>
            Verifying and preparing the local FP32 session. The detector becomes available after
            all model bytes are loaded.
          </p>
          <progress
            aria-label="Local FP32 model loading progress"
            value={state.progress.loaded}
            max={state.progress.total}
          />
          <p className="progress-copy">
            {formatBytes(state.progress.loaded)} / {formatBytes(state.progress.total)} bytes ·{' '}
            {percent.toFixed(0)}%
          </p>
        </div>
      );
    }
    case 'ready':
      return (
        <div className="phase-content empty-state">
          <p className="phase-name">Ready for one image</p>
          <p>Select or drop a supported still image to begin local validation.</p>
        </div>
      );
    case 'validating':
      return (
        <div className="phase-content loading-state">
          <p className="phase-name">Validating image bytes</p>
          <p>The file signature, size, structure, animation, and safe dimensions are checked first.</p>
        </div>
      );
    case 'preprocessing':
      return (
        <div className="phase-content loading-state">
          <p className="phase-name">Preprocessing image</p>
          <p>Applying EXIF orientation, RGB conversion, bicubic resize, and FP32 normalization.</p>
        </div>
      );
    case 'inferring':
      return (
        <div className="phase-content loading-state">
          <p className="phase-name">Running local inference</p>
          <p>The prepared tensor is being evaluated by the cached FP32 model.</p>
        </div>
      );
    case 'success': {
      const confidence = state.result.probability;
      return (
        <div className="phase-content success-state">
          <div className="result-heading">
            <div>
              <p className="result-label">Decision</p>
              <h3>{state.result.label}</h3>
            </div>
            <p className="confidence-value">{confidence.toFixed(6)}</p>
          </div>
          <label className="confidence-label" htmlFor="confidence-progress">
            AIGC confidence
          </label>
          <progress
            id="confidence-progress"
            className="confidence-progress"
            value={confidence}
            max={1}
          />
          <dl className="result-details">
            <div>
              <dt>Frozen threshold</dt>
              <dd>{state.model.manifest.threshold.aigc.toFixed(8)}</dd>
            </div>
            <div>
              <dt>Execution provider</dt>
              <dd>{formatProvider(state.result.provider)}</dd>
            </div>
            <div>
              <dt>Inference elapsed</dt>
              <dd>{state.result.elapsedMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>Model identity</dt>
              <dd>
                {state.model.manifest.source.tag} · {state.model.manifest.model.precision}
              </dd>
            </div>
          </dl>
        </div>
      );
    }
    case 'error':
      return (
        <div className="phase-content error-state" role="alert">
          <p className="phase-name">
            {state.kind === 'model' ? 'Model initialization failed' : 'Image workflow stopped'}
          </p>
          <p>{state.message}</p>
        </div>
      );
  }
}

export function DetectorScreen({ state, selectFile, reset, retryModel }: DetectorScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const model = modelForState(state);
  const image = imageForState(state);
  const canSelect = model !== undefined;
  const isBusy =
    state.phase === 'booting' ||
    state.phase === 'validating' ||
    state.phase === 'preprocessing' ||
    state.phase === 'inferring';

  const handleFiles = (files: readonly File[] | FileList) => {
    void selectFile(files);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = consumeSelectedFiles(event.currentTarget);
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (canSelect) {
      event.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (canSelect) {
      handleFiles(Array.from(event.dataTransfer.files));
    }
  };

  return (
    <main className="detector-shell">
      <header className="page-header">
        <div className="title-row">
          <h1>{APP_NAME}</h1>
          <p className="local-identity">Local FP32 · no upload</p>
        </div>
        <p className="intro">
          Inspect one still image with the frozen B2-NJR browser model. Validation,
          preprocessing, and inference run on this device.
        </p>
      </header>

      <div className="workspace">
        <section className="upload-pane" aria-labelledby="image-input-heading">
          <div className="section-heading">
            <h2 id="image-input-heading">Image input</h2>
            <p>One JPEG, PNG, or WebP still image · maximum 25 MiB</p>
          </div>

          <div
            className={`drop-target${isDragging ? ' is-dragging' : ''}${canSelect ? '' : ' is-disabled'}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-disabled={!canSelect}
            aria-busy={isBusy}
          >
            <p className="drop-title">
              {canSelect ? 'Drop one image here' : 'Waiting for the local model'}
            </p>
            <p>or choose a file from this device</p>
            <label className="file-control">
              <input
                className="file-input"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                disabled={!canSelect}
                onChange={handleFileChange}
              />
              <span className="select-button">Choose image</span>
            </label>
          </div>

          {image === undefined ? (
            <div className="preview-empty">
              <p>No image retained.</p>
              <p>A preview appears only after byte-level validation succeeds.</p>
            </div>
          ) : (
            <figure className="preview-figure">
              <img src={image.previewUrl} alt={`Local preview of ${image.fileName}`} />
              <figcaption>
                <strong>{image.fileName}</strong>
                {hasDimensions(image) ? (
                  <span className="dimension-line">
                    Original {image.originalWidth} × {image.originalHeight} · Oriented{' '}
                    {image.orientedWidth} × {image.orientedHeight}
                  </span>
                ) : (
                  <span className="dimension-line">Reading original and oriented dimensions…</span>
                )}
              </figcaption>
            </figure>
          )}
        </section>

        <section className="analysis-pane" aria-labelledby="detector-status-heading">
          <div className="section-heading">
            <h2 id="detector-status-heading">Detector status</h2>
            <p aria-live="polite">Current phase: {state.phase}</p>
          </div>

          <PhaseStatus state={state} />

          {model?.fallbackReason !== undefined ? (
            <p className="fallback-note">
              Compatibility note: {model.fallbackReason}. The same FP32 model is running with WASM.
            </p>
          ) : null}

          <div className="actions">
            {state.phase === 'error' && state.kind === 'model' ? (
              <button type="button" onClick={() => void retryModel()}>
                Retry model
              </button>
            ) : model !== undefined && state.phase !== 'ready' ? (
              <button type="button" onClick={reset}>
                Reset detector
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="privacy-note">
        <strong>Local privacy boundary.</strong>{' '}
        Image bytes remain in browser memory. They are never uploaded or saved.
      </footer>
    </main>
  );
}

export function App() {
  const detector = useDetector();
  return <DetectorScreen {...detector} />;
}
