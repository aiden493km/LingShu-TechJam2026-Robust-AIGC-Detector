import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { APP_NAME, consumeSelectedFiles, DetectorScreen } from '../../src/App';
import type { DetectorState } from '../../src/detector/machine';
import type { LoadedModelSession } from '../../src/runtime/model-session';

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
    expect(html).toContain('Loading model');
    expect(html).toContain('<progress');
    expect(html).toContain('44061514');
    expect(html).toContain('JPEG, PNG, or WebP');
    expect(html).toContain('25 MiB');
    expect(html).toContain('never uploaded or saved');
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
    expect(html).toContain('0.777300');
    expect(html).toContain('AIGC');
    expect(html).toContain('0.55657113');
    expect(html).toContain('WASM');
    expect(html).toContain('42.5 ms');
    expect(html).toContain('v1.0.0');
    expect(html).toContain('FP32');
    expect(html).toContain('WebGPU adapter unavailable');
  });

  it('renders distinct recovery controls for model and workflow errors', () => {
    const modelError = render({
      phase: 'error',
      kind: 'model',
      message: 'The model could not be initialized. Retry the model load.',
    });
    const workflowError = render({
      phase: 'error',
      kind: 'workflow',
      stage: 'inference',
      message: 'Local inference did not complete. Reset and try again.',
      model: model(),
    });

    expect(modelError).toContain('Retry model');
    expect(workflowError).toContain('Reset detector');
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
});
