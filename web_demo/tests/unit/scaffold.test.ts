import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  APP_NAME,
  consumeSelectedFiles,
  DetectorScreen,
  LocalFieldCard,
  PhaseStatus,
  requestImageSelection,
} from '../../src/App';
import type { DetectorState } from '../../src/detector/machine';
import type { RuntimeEnvironmentSnapshot } from '../../src/runtime/capabilities';
import { modelDeliveryCopy, type DeploymentMode } from '../../src/runtime/deployment';
import type { LoadedModelSession } from '../../src/runtime/model-session';
import { DetectorEvidence } from '../../src/site/DetectorEvidence';
import type { RecentDetection } from '../../src/site/session-history';

const runtimeEnvironment: RuntimeEnvironmentSnapshot = {
  userAgent: 'Judge Browser 1.0 (Local)',
  crossOriginIsolated: false,
  webGpuApiAvailable: true,
  webGpuAdapterAvailable: false,
  wasmAvailable: true,
  hardwareConcurrency: 8,
};

function model(): LoadedModelSession {
  return {
    session: { release: vi.fn() } as unknown as LoadedModelSession['session'],
    provider: 'wasm',
    fallbackReason: 'WebGPU adapter unavailable',
    manifest: {
      model: { precision: 'FP32' },
      source: { tag: 'v1.0.0' },
      threshold: { aigc: 0.55657113 },
    } as LoadedModelSession['manifest'],
  };
}

function render(state: DetectorState): string {
  return renderToStaticMarkup(
    createElement(DetectorScreen, {
      state,
      selectFile: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      retryModel: vi.fn().mockResolvedValue(undefined),
    }),
  );
}

type LoadingViewProps = {
  readonly state: Extract<DetectorState, { phase: 'booting' }>;
  readonly delivery: ReturnType<typeof modelDeliveryCopy>;
};

describe('frontend scaffold', () => {
  it('uses the frozen product name', () => {
    expect(APP_NAME).toBe('LingShu Robust AIGC Detector');
  });

  it('renders the local identity, determinate boot progress, and privacy promise', () => {
    const html = render({
      phase: 'booting',
      progress: { loaded: 44_061_514, total: 88_123_029 },
    });

    expect(html).toContain(APP_NAME);
    expect(html).toContain('Local FP32 · no upload');
    expect(html).toContain('>Pending</p>');
    expect(html).toContain('class="local-field-loading"');
    expect(html).not.toContain('class="local-field-card"');
    expect(html).not.toContain('class="idle-phase-panel"');
    expect(html).toContain('LOADING LOCAL MODEL');
    expect(html).toContain('Verifying and preparing the local FP32 session.');
    expect(html).toContain('aria-label="Local FP32 model loading progress"');
    expect(html).toContain('<progress');
    expect(html).toContain('44061514');
    expect(html).toContain('JPEG, PNG, or WebP');
    expect(html).toContain('25 MiB');
    expect(html).toContain('never uploaded or saved');
  });

  const loadingState: LoadingViewProps['state'] = {
    phase: 'booting',
    progress: { loaded: 44_061_514, total: 88_123_029 },
  };

  it.each([
    ['phase content', PhaseStatus],
    ['local field card', LocalFieldCard],
  ])('renders explicit local and online delivery copy in the %s', (_name, LoadingView) => {
    for (const mode of ['local', 'online'] satisfies readonly DeploymentMode[]) {
      const delivery = modelDeliveryCopy(mode);
      const html = renderToStaticMarkup(
        createElement(LoadingView, { state: loadingState, delivery }),
      );

      expect(html).toContain(delivery.title);
      expect(html).toContain(delivery.detail);
      expect(html).toContain(`aria-label="${delivery.progressLabel}"`);
    }
  });

  it('renders one keyboard file input and the complete successful result metadata', () => {
    const loaded = model();
    const html = render({
      phase: 'success',
      model: loaded,
      image: {
        fileName: '<script>alert(1)</script>.png',
        previewUrl: 'blob:validated-image',
        originalWidth: 1600,
        originalHeight: 900,
        orientedWidth: 900,
        orientedHeight: 1600,
      },
      result: {
        logit: 1.25,
        probability: 0.77729986,
        label: 'AIGC',
        provider: 'wasm',
        elapsedMs: 42.5,
      },
    });

    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"');
    expect(html).not.toContain('multiple=""');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;.png');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('1600 × 900');
    expect(html).toContain('900 × 1600');
    expect(html).toContain('AIGC confidence');
    expect(html).toContain('0.77729986');
    expect(html).toContain('AIGC');
    expect(html).toContain('0.55657113');
    expect(html).toContain('WASM');
    expect(html).toContain('42.5 ms');
    expect(html).toContain('v1.0.0');
    expect(html).toContain('FP32');
    expect(html).toContain('WebGPU adapter unavailable');
    expect(html).toContain('IMAGE IN MEMORY');
    expect(html).not.toContain('NO IMAGE UPLOAD');
    expect(html).toContain('aria-label="Choose a replacement image"');
    expect(html).not.toContain('aria-label="Reset detector"');
  });

  it('renders the approved Semantic Signal idle hero around the existing upload control', () => {
    const html = render({ phase: 'ready', model: model() });

    expect(html).toContain('data-presentation="idle"');
    expect(html).toContain('class="display-title"');
    expect(html).toContain('ROBUST');
    expect(html).toContain('AIGC');
    expect(html).toContain('DETECTOR');
    expect(html).toContain('class="model-word"');
    expect(html).toContain('class="local-field-card is-ready"');
    expect(html).toContain('>Ready</p>');
    expect(html).toContain('UPLOAD IMAGE');
    expect(html).toContain('VIEW MODEL DETAILS');
    expect(html).toContain('Single still JPEG, PNG, or WebP · 25 MiB maximum');
    expect(html).toContain('MODEL NOW');
    expect(html).toContain('NO IMAGE SELECTED');
    expect(html).toContain('src="/brands/github-mark.svg"');
    expect(html).toContain('aria-controls="contact-popover"');
    expect(html).toContain('class="contact-popover"');
    expect(html).toContain('zhiyi012@e.ntu.edu.sg');
    expect(html).toContain('COPY EMAIL');
    expect(html).toContain('CONTACT');
    expect(html).toContain('LOCAL PRIVACY');
    expect(html).toContain('IN-MEMORY ONLY');
    expect(html).not.toContain('class="privacy-note"');
    expect(html).toContain('FROZEN THRESHOLD');
    expect(html).toContain('aria-label="Frozen threshold waveform from 0.0 to 1.0"');
    expect(html).toContain('ROBUSTNESS PROTOCOL');
    expect(html).toContain('NJR · 14 FIXED CONDITIONS');
    expect(html).not.toContain('MODEL DEVELOPMENT LOG');
    expect(html).toContain('class="evidence-strip"');
    expect(html).not.toContain('class="signal-field"');
  });

  it('renders all three successful session thumbnails without replacing earlier entries', () => {
    const recentDetections: readonly RecentDetection[] = ['three', 'two', 'one'].map(
      (id, index) => ({
        id,
        thumbnailUrl: `data:image/jpeg;base64,${id}`,
        fileName: `${id}.png`,
        label: index === 1 ? 'Real' : 'AIGC',
        confidence: 0.9 - index * 0.1,
      }),
    );
    const html = renderToStaticMarkup(
      createElement(DetectorEvidence, {
        score: 0.9,
        recentDetections,
      }),
    );

    expect(html).toContain('three.png');
    expect(html).toContain('two.png');
    expect(html).toContain('one.png');
    expect(html.match(/class="recent-thumbnail"/g)).toHaveLength(3);
    expect(html.match(/class="recent-verdict/g)).toHaveLength(3);
    expect(html.match(/>AIGC<\/figcaption>/g)).toHaveLength(2);
    expect(html).toContain('>REAL</figcaption>');
  });

  it('resolves a successful upload into the image-left result-right analysis state', () => {
    const html = render({
      phase: 'success',
      model: model(),
      image: {
        fileName: 'judge-image.png',
        previewUrl: 'blob:judge-image',
        originalWidth: 1024,
        originalHeight: 1024,
        orientedWidth: 1024,
        orientedHeight: 1024,
      },
      result: {
        logit: 14.9,
        probability: 0.99999966,
        label: 'AIGC',
        provider: 'wasm',
        elapsedMs: 18.2,
      },
    });

    expect(html).toContain('data-presentation="analysis"');
    expect(html).toContain('class="analysis-workspace"');
    expect(html).toContain('ANALYSIS COMPLETE');
    expect(html).toContain('0.99999966');
    expect(html).toContain('REPLACE IMAGE');
    expect(html).toContain('RECENT IMAGES');
    expect(html).toContain('aria-label="Back to detector home"');
    expect(html).toContain('class="back-arrow"');
    expect(html).not.toContain('←');
  });

  it('renders distinct recovery controls for model and workflow errors', () => {
    const modelError = render({
      phase: 'error',
      kind: 'model',
      message: 'The model manifest could not be downloaded. Retry the model load.',
      environment: runtimeEnvironment,
      providerDiagnostics: [],
    });
    const workflowError = render({
      phase: 'error',
      kind: 'workflow',
      stage: 'inference',
      message: 'Local inference did not complete. Reset and try again.',
      model: model(),
    });

    expect(modelError).toContain('Retry model');
    expect(modelError).toContain('The model manifest could not be downloaded');
    expect(modelError).toContain('Judge Browser 1.0 (Local)');
    expect(modelError).toContain('Cross-origin isolation');
    expect(modelError).toContain('WebGPU API');
    expect(modelError).toContain('WebGPU adapter');
    expect(modelError).toContain('WebAssembly');
    expect(modelError).toContain('Hardware concurrency');
    expect(modelError).not.toContain('Provider initialization');
    expect(workflowError).toContain('Reset detector');
  });

  it('renders complete, separate uppercase provider diagnostics without a classification result', () => {
    const webGpuMessage = `WebGPU ${'w'.repeat(293)}`;
    const wasmMessage = `WASM ${'a'.repeat(295)}`;
    const html = render({
      phase: 'error',
      kind: 'model',
      message: 'Both local execution providers failed to initialize. Retry the model load.',
      environment: runtimeEnvironment,
      providerDiagnostics: [
        { provider: 'webgpu', message: webGpuMessage },
        { provider: 'wasm', message: wasmMessage },
      ],
    });

    expect(html).toContain('Provider initialization');
    expect(html).toContain('WEBGPU');
    expect(html).toContain('WASM');
    expect(html).toContain(webGpuMessage);
    expect(html).toContain(wasmMessage);
    expect(html).not.toContain('AIGC confidence');
  });

  it('labels an uncompleted adapter probe as unknown instead of unavailable', () => {
    const html = render({
      phase: 'error',
      kind: 'model',
      message: 'The local FP32 model could not be initialized. Retry the model load.',
      environment: {
        ...runtimeEnvironment,
        webGpuAdapterAvailable: null,
      },
      providerDiagnostics: [],
    });

    expect(html).toContain('WebGPU adapter</dt><dd>Unknown');
    expect(html).toContain('Retry model');
  });

  it('clears the native file input so reset can select the same file again', () => {
    const file = { name: 'same-image.png' } as File;
    const input = {
      files: { 0: file, length: 1, item: () => file },
      value: 'C:\\fakepath\\same-image.png',
    } as unknown as HTMLInputElement;

    expect(consumeSelectedFiles(input)).toEqual([file]);
    expect(input.value).toBe('');

    input.value = 'C:\\fakepath\\same-image.png';
    expect(consumeSelectedFiles(input)).toEqual([file]);
    expect(input.value).toBe('');
  });

  it('opens the existing file picker without resetting the completed result first', () => {
    const click = vi.fn();

    requestImageSelection({ click });

    expect(click).toHaveBeenCalledOnce();
  });
});
