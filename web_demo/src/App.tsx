import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';

import type { DetectorState, ImageDetails, PreviewImage } from './detector/machine';
import { useDetector, type UseDetectorResult } from './detector/use-detector';
import { DEPLOYMENT_MODE, modelDeliveryCopy } from './runtime/deployment';
import type { LoadedModelSession } from './runtime/model-session';
import { DetectorEvidence } from './site/DetectorEvidence';
import { DissolveTitle } from './site/DissolveTitle';
import { ProjectView } from './site/ProjectViews';
import { RouteLink } from './site/RouteLink';
import { SignalField } from './site/SignalField';
import { detectorPresentation, formatConfidence } from './site/presentation';
import { routeFromHash, SITE_NAVIGATION, type SiteRoute } from './site/routes';
import {
  appendRecentDetection,
  createRecentThumbnail,
  type RecentDetection,
} from './site/session-history';

export const APP_NAME = 'LingShu Robust AIGC Detector';
export const REPOSITORY_URL =
  'https://github.com/aiden493km/LingShu-TechJam2026-Robust-AIGC-Detector';
const delivery = modelDeliveryCopy(DEPLOYMENT_MODE);

export type DetectorScreenProps = UseDetectorResult & {
  readonly currentRoute?: SiteRoute;
};

export function consumeSelectedFiles(
  input: Pick<HTMLInputElement, 'files' | 'value'>,
): readonly File[] {
  const files = input.files === null ? [] : Array.from(input.files);
  input.value = '';
  return files;
}

export function requestImageSelection(input: Pick<HTMLInputElement, 'click'> | null): void {
  input?.click();
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

function fileNameForState(state: DetectorState): string | undefined {
  if (state.phase === 'validating') {
    return state.fileName;
  }
  return imageForState(state)?.fileName;
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

function workflowLabel(state: DetectorState): string {
  switch (state.phase) {
    case 'booting':
      return 'Model loading';
    case 'ready':
      return 'Model ready';
    case 'validating':
      return 'Validating image';
    case 'preprocessing':
      return 'Preprocessing image';
    case 'inferring':
      return 'Running inference';
    case 'success':
      return 'Analysis complete';
    case 'error':
      return state.kind === 'model' ? 'Model unavailable' : 'Workflow stopped';
  }
}

type ModelErrorState = Extract<DetectorState, { phase: 'error'; kind: 'model' }>;

function availability(available: boolean | null): string {
  if (available === null) {
    return 'Unknown';
  }
  return available ? 'Available' : 'Unavailable';
}

function ContactIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="5" r="2.25" />
      <circle cx="6" cy="19" r="2.25" />
      <circle cx="18" cy="12" r="2.25" />
      <path d="M6 7.25v9.5M8.25 6.2c4 .3 3.7 5.8 7.5 5.8" />
    </svg>
  );
}

const CONTACT_EMAIL = 'zhiyi012@e.ntu.edu.sg';

async function copyContactEmail() {
  try {
    await navigator.clipboard.writeText(CONTACT_EMAIL);
  } catch {
    const field = document.createElement('textarea');
    field.value = CONTACT_EMAIL;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
}

function ContactControl() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ left: 16, top: 16 });
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (trigger === null || popover === null) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(288, window.innerWidth - 32);
    const panelHeight = popover.offsetHeight || 122;
    const left = Math.max(16, Math.min(triggerRect.left, window.innerWidth - panelWidth - 16));
    const roomAbove = triggerRect.top - panelHeight - 10;
    const top = roomAbove >= 16 ? roomAbove : Math.min(window.innerHeight - panelHeight - 16, triggerRect.bottom + 10);
    setPopoverPosition({ left, top: Math.max(16, top) });
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const positionFrame = window.requestAnimationFrame(updatePopoverPosition);
    const closeFromOutside = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    window.addEventListener('resize', updatePopoverPosition);
    return () => {
      window.cancelAnimationFrame(positionFrame);
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
      window.removeEventListener('resize', updatePopoverPosition);
    };
  }, [isOpen, updatePopoverPosition]);

  const handleCopy = async () => {
    await copyContactEmail();
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1600);
  };

  return (
    <div className="contact-control" ref={controlRef}>
      <button
        className="contact-trigger"
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls="contact-popover"
        onClick={() => setIsOpen((open) => !open)}
      >
        <ContactIcon /><span>CONTACT</span>
      </button>
      <div
        id="contact-popover"
        className={`contact-popover${isOpen ? ' is-open' : ''}`}
        ref={popoverRef}
        aria-hidden={!isOpen}
        style={{ left: popoverPosition.left, top: popoverPosition.top }}
      >
        <span className="contact-kicker">DIRECT CONTACT</span>
        <span className="contact-email">{CONTACT_EMAIL}</span>
        <button className="contact-copy" type="button" onClick={() => void handleCopy()}>
          {isCopied ? 'COPIED' : 'COPY EMAIL'}
        </button>
      </div>
    </div>
  );
}

function ModelRuntimeDiagnostics({ state }: { readonly state: ModelErrorState }) {
  const environment = state.environment;
  return (
    <div className="runtime-diagnostics" aria-label="Local runtime diagnostics">
      <section className="diagnostic-group" aria-labelledby="browser-environment-heading">
        <h4 id="browser-environment-heading">Browser environment</h4>
        <dl className="diagnostic-list">
          <div><dt>User agent</dt><dd>{environment.userAgent || 'Unavailable'}</dd></div>
          <div><dt>Cross-origin isolation</dt><dd>{environment.crossOriginIsolated ? 'Enabled' : 'Disabled'}</dd></div>
          <div><dt>WebGPU API</dt><dd>{availability(environment.webGpuApiAvailable)}</dd></div>
          <div><dt>WebGPU adapter</dt><dd>{availability(environment.webGpuAdapterAvailable)}</dd></div>
          <div><dt>WebAssembly</dt><dd>{availability(environment.wasmAvailable)}</dd></div>
          <div><dt>Hardware concurrency</dt><dd>{environment.hardwareConcurrency}</dd></div>
        </dl>
      </section>
      {state.providerDiagnostics.length > 0 ? (
        <section className="diagnostic-group" aria-labelledby="provider-diagnostics-heading">
          <h4 id="provider-diagnostics-heading">Provider initialization</h4>
          <dl className="diagnostic-list provider-diagnostics">
            {state.providerDiagnostics.map(({ provider, message }) => (
              <div key={provider}><dt>{provider.toUpperCase()}</dt><dd>{message}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function PhaseStatus({ state }: { readonly state: DetectorState }) {
  switch (state.phase) {
    case 'booting': {
      const percent = state.progress.total > 0
        ? Math.min(100, (state.progress.loaded / state.progress.total) * 100)
        : 0;
      return (
        <div className="phase-content loading-state">
          <p className="phase-name">{delivery.title}</p>
          <p>{delivery.detail}</p>
          <progress aria-label={delivery.progressLabel} value={state.progress.loaded} max={state.progress.total} />
          <p className="progress-copy">{formatBytes(state.progress.loaded)} / {formatBytes(state.progress.total)} bytes · {percent.toFixed(0)}%</p>
        </div>
      );
    }
    case 'ready':
      return <div className="phase-content empty-state"><p className="phase-name">Ready for one image</p><p>Select or drop a supported still image to begin local validation.</p></div>;
    case 'validating':
      return <div className="phase-content loading-state"><p className="phase-name">Validating image bytes</p><p>The file signature, size, structure, animation, and safe dimensions are checked first.</p></div>;
    case 'preprocessing':
      return <div className="phase-content loading-state"><p className="phase-name">Preprocessing image</p><p>Applying EXIF orientation, RGB conversion, bicubic resize, and FP32 normalization.</p></div>;
    case 'inferring':
      return <div className="phase-content loading-state"><p className="phase-name">Running local inference</p><p>The prepared tensor is being evaluated by the cached FP32 model.</p></div>;
    case 'success': {
      const confidence = state.result.probability;
      return (
        <div className="phase-content success-state">
          <p className="result-label">Decision</p>
          <h2 className="decision-word">{state.result.label}</h2>
          <p className="confidence-label">AIGC confidence</p>
          <p className="confidence-value">{formatConfidence(confidence)}</p>
          <progress id="confidence-progress" className="sr-only" max={1} value={confidence}>AIGC confidence {formatConfidence(confidence)}</progress>
          <div className="confidence-scale" aria-hidden="true"><span style={{ '--score': confidence } as React.CSSProperties} /></div>
          <dl className="result-details">
            <div><dt>Frozen threshold</dt><dd>{state.model.manifest.threshold.aigc.toFixed(8)}</dd></div>
            <div><dt>Provider</dt><dd>{formatProvider(state.result.provider)}</dd></div>
            <div><dt>Model</dt><dd>B2-NJR · {state.model.manifest.model.precision}</dd></div>
            <div><dt>Inference elapsed</dt><dd>{state.result.elapsedMs.toFixed(1)} ms</dd></div>
            <div><dt>Model identity</dt><dd>{state.model.manifest.source.tag}</dd></div>
          </dl>
          <p className="processing-complete">Processing complete</p>
        </div>
      );
    }
    case 'error':
      return state.kind === 'model' ? (
        <div className="phase-content model-error-content">
          <div className="error-state" role="alert"><p className="phase-name">Model initialization failed</p><p>{state.message}</p></div>
          <ModelRuntimeDiagnostics state={state} />
        </div>
      ) : (
        <div className="phase-content error-state" role="alert"><p className="phase-name">Image workflow stopped</p><p>{state.message}</p></div>
      );
  }
}

function SiteRail({ state, currentRoute }: { readonly state: DetectorState; readonly currentRoute: SiteRoute }) {
  const model = modelForState(state);
  const runtime = model === undefined ? 'Runtime check' : formatProvider(model.provider);
  const status = state.phase === 'booting' ? 'Pending' : state.phase === 'error' ? 'Attention' : 'Ready';
  const hasSelectedImage = fileNameForState(state) !== undefined;
  return (
    <aside className="site-rail">
      <RouteLink className="wordmark" href="#/detector" aria-label={APP_NAME}>LINGSHU<span className="sr-only">{APP_NAME}</span></RouteLink>
      <nav className="site-navigation" aria-label="Primary navigation">
        {SITE_NAVIGATION.map((item) => (
          <RouteLink key={item.id} href={item.href as `#/${string}`} aria-current={currentRoute === item.id ? 'page' : undefined}>
            {item.label}{currentRoute === item.id ? <span className="active-dot" aria-hidden="true" /> : null}
          </RouteLink>
        ))}
      </nav>
      <div className="rail-status" aria-live="polite">
        <p className="rail-label">MODEL NOW</p><p className="rail-model">B2-NJR</p><p>{status}</p>
        <p className="rail-label">LOCAL RUNTIME</p><p>{runtime}</p>
        <p className="rail-privacy">{hasSelectedImage ? 'IMAGE IN MEMORY' : 'NO IMAGE SELECTED'}</p><span className="sr-only">Local FP32 · no upload</span>
      </div>
      <div className="rail-links">
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer"><img src="/brands/github-mark.svg" alt="" aria-hidden="true" /><span>GitHub</span></a>
        <ContactControl />
      </div>
    </aside>
  );
}

function LocalFieldCard({ state }: { readonly state: DetectorState }) {
  if (state.phase === 'booting') {
    const percent = state.progress.total > 0
      ? Math.min(100, (state.progress.loaded / state.progress.total) * 100)
      : 0;
    return (
      <div className="local-field-loading" aria-live="polite">
        <strong>{delivery.title}</strong>
        <span className="sr-only">{delivery.detail}</span>
        <progress aria-label={delivery.progressLabel} value={state.progress.loaded} max={state.progress.total} />
        <span>{percent.toFixed(0)}% · FP32</span>
        <span className="sr-only">Image bytes remain in browser memory. They are never uploaded or saved.</span>
      </div>
    );
  }
  const model = modelForState(state);
  return (
    <div className={`local-field-card${model === undefined ? ' is-error' : ' is-ready'}`}>
      <span>LOCAL FIELD</span>
      <strong>{model === undefined ? 'CHECK RUNTIME' : 'MODEL READY'}</strong>
      <span>{model === undefined ? 'FP32' : formatProvider(model.provider)}</span>
      <span className="local-privacy-status"><b>LOCAL PRIVACY</b><em>IN-MEMORY ONLY</em></span>
      <span className="sr-only">Image bytes remain in browser memory. They are never uploaded or saved.</span>
    </div>
  );
}

function IdleActions({ state, canSelect, retryModel, reset }: { readonly state: DetectorState; readonly canSelect: boolean; readonly retryModel: UseDetectorResult['retryModel']; readonly reset: UseDetectorResult['reset'] }) {
  if (state.phase === 'error') {
    return state.kind === 'model' ? <button className="primary-action" type="button" onClick={() => void retryModel()}>Retry model</button> : <button className="primary-action" type="button" onClick={reset}>Reset detector</button>;
  }
  return <label className={`primary-action${canSelect ? '' : ' is-disabled'}`} htmlFor="image-file-input">UPLOAD IMAGE</label>;
}

function AnalysisPreview({ state }: { readonly state: DetectorState }) {
  const image = imageForState(state);
  const fileName = fileNameForState(state);
  if (image === undefined) {
    return <div className="analysis-preview preview-pending" aria-busy="true"><SignalField /><p>{fileName ?? 'Preparing local preview'}</p></div>;
  }
  return (
    <figure className="analysis-preview preview-figure">
      <img src={image.previewUrl} alt={`Local preview of ${image.fileName}`} />
      <figcaption>
        <strong>{image.fileName}</strong>
        {hasDimensions(image) ? <span className="dimension-line">Original {image.originalWidth} × {image.originalHeight} · Oriented {image.orientedWidth} × {image.orientedHeight}</span> : <span className="dimension-line">Reading original and oriented dimensions…</span>}
        <span>IMAGE HELD IN MEMORY</span>
      </figcaption>
    </figure>
  );
}

export function DetectorScreen({ state, selectFile, reset, retryModel, currentRoute = 'detector' }: DetectorScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [recentDetections, setRecentDetections] = useState<readonly RecentDetection[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingThumbnailRef = useRef<{
    readonly id: string;
    readonly fileName: string;
    readonly thumbnail: Promise<string | undefined>;
  } | null>(null);
  const selectionSequenceRef = useRef(0);
  const recordedResultRef = useRef<string | null>(null);
  const machinePresentation = detectorPresentation(state.phase);
  const presentation = isReturning ? 'returning' : machinePresentation;
  const model = modelForState(state);
  const canSelect = model !== undefined;
  const isBusy = ['booting', 'validating', 'preprocessing', 'inferring'].includes(state.phase);
  const score = state.phase === 'success' ? state.result.probability : undefined;
  const handleFiles = (files: readonly File[] | FileList) => {
    const selected = Array.from(files);
    const file = selected.length === 1 ? selected[0] : undefined;
    if (file !== undefined) {
      selectionSequenceRef.current += 1;
      pendingThumbnailRef.current = {
        id: `${file.lastModified}-${file.size}-${selectionSequenceRef.current}`,
        fileName: file.name,
        thumbnail: createRecentThumbnail(file).catch(() => undefined),
      };
    }
    void selectFile(selected);
  };

  const recordCurrentSuccess = useCallback(async () => {
    if (state.phase !== 'success') {
      return;
    }
    const resultId = `${state.image.previewUrl}-${state.result.elapsedMs}`;
    if (recordedResultRef.current === resultId) {
      return;
    }
    const pending = pendingThumbnailRef.current;
    if (pending === null || pending.fileName !== state.image.fileName) {
      return;
    }
    recordedResultRef.current = resultId;
    const thumbnailUrl = await pending.thumbnail;
    if (thumbnailUrl === undefined) {
      return;
    }
    setRecentDetections((history) => appendRecentDetection(history, {
      id: pending.id,
      thumbnailUrl,
      fileName: state.image.fileName,
      label: state.result.label,
      confidence: state.result.probability,
    }));
  }, [state]);

  useEffect(() => {
    void recordCurrentSuccess();
  }, [recordCurrentSuccess]);

  const handleReturnToHome = async () => {
    if (isReturning) {
      return;
    }
    await recordCurrentSuccess();
    setIsReturning(true);
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      reset();
      setIsReturning(false);
    }, reduceMotion ? 40 : 760);
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = consumeSelectedFiles(event.currentTarget);
    if (files.length > 0) handleFiles(files);
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (canSelect) { event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); setIsDragging(false);
    if (canSelect) handleFiles(Array.from(event.dataTransfer.files));
  };
  return (
    <div className={`application-frame presentation-${presentation} phase-${state.phase}`} data-route={currentRoute}>
      <div className="hero-grid">
        <SiteRail state={state} currentRoute={currentRoute} />
        <main id="main-content" className="detector-shell">
        <input ref={fileInputRef} id="image-file-input" className="file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={!canSelect} onChange={handleFileChange} />
        <section className={`detector-stage${isDragging ? ' is-dragging' : ''}`} data-presentation={presentation} data-phase={state.phase} aria-label="Local image detector" aria-busy={isBusy} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <section className="idle-hero" aria-hidden={presentation !== 'idle'}>
            <DissolveTitle />
            <LocalFieldCard state={state} />
            <p className="model-word">B2-NJR</p>
            <p className="hero-description">Local browser inference for robust real-vs-AIGC image detection.</p>
            <div className="hero-action-cluster">
              <div className="hero-actions"><IdleActions state={state} canSelect={canSelect} retryModel={retryModel} reset={reset} /><RouteLink className="secondary-action" href="#/technology">VIEW MODEL DETAILS</RouteLink></div>
              <p className="upload-contract">Single still JPEG, PNG, or WebP · 25 MiB maximum</p>
            </div>
            {presentation === 'idle' && (state.phase === 'error' || model?.fallbackReason !== undefined) ? <div className="idle-phase-panel"><PhaseStatus state={state} />{model?.fallbackReason === undefined ? null : <p className="fallback-note">Compatibility note: {model.fallbackReason}. The same FP32 model is running with WASM.</p>}</div> : null}
          </section>
          <section className="analysis-layer" aria-hidden={presentation === 'idle'}>
            {presentation === 'idle' ? null : <>
            <header className="analysis-header">
              <button className="analysis-back" type="button" aria-label="Back to detector home" onClick={() => void handleReturnToHome()} disabled={isReturning}>
                <span className="back-arrow" aria-hidden="true" />
              </button>
              <SignalField />
              <p>ROBUST AIGC DETECTOR <span aria-hidden="true">/</span> <strong>{workflowLabel(state).toUpperCase()}</strong></p>
            </header>
            <div className="analysis-workspace">
              <AnalysisPreview state={state} />
              <section className="analysis-result" aria-live="polite">
                <PhaseStatus state={state} />
                {model?.fallbackReason !== undefined ? <p className="fallback-note">Compatibility note: {model.fallbackReason}. The same FP32 model is running with WASM.</p> : null}
                <div className="analysis-actions"><button className="primary-action" type="button" aria-label="Choose a replacement image" onClick={() => requestImageSelection(fileInputRef.current)}>REPLACE IMAGE</button><RouteLink className="secondary-action" href="#/technology">VIEW MODEL DETAILS</RouteLink></div>
              </section>
            </div>
            </>}
          </section>
        </section>
        </main>
      </div>
      <DetectorEvidence score={score} recentDetections={recentDetections} />
    </div>
  );
}

function useSiteRoute(): SiteRoute {
  const [route, setRoute] = useState<SiteRoute>(() => typeof window === 'undefined' ? 'detector' : routeFromHash(window.location.hash));
  useEffect(() => {
    const handleHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  return route;
}

export function App() {
  const detector = useDetector();
  const route = useSiteRoute();
  if (route === 'detector') return <DetectorScreen {...detector} currentRoute={route} />;
  return (
    <div className="application-frame project-frame" data-route={route}>
      <div className="hero-grid">
        <SiteRail state={detector.state} currentRoute={route} />
        <ProjectView route={route} />
      </div>
    </div>
  );
}
