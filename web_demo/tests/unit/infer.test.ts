import type { InferenceSession } from 'onnxruntime-web/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import manifestJson from '../../models/manifest.json';
import { parseModelManifest } from '../../src/runtime/contract';
import { runDetection } from '../../src/runtime/infer';

const ortMock = vi.hoisted(() => {
  class FakeTensor {
    readonly type: string;
    readonly data: unknown;
    readonly dims: readonly number[];

    constructor(type: string, data: unknown, dims: readonly number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }

  return { FakeTensor };
});

vi.mock('onnxruntime-web/webgpu', () => ({
  Tensor: ortMock.FakeTensor,
}));

const manifest = parseModelManifest(manifestJson);
const INPUT_ELEMENTS = 3 * 384 * 384;

function sessionWithRun(run: ReturnType<typeof vi.fn>): InferenceSession {
  return {
    run,
    inputNames: ['input'],
    outputNames: ['logits'],
    inputMetadata: [],
    outputMetadata: [],
    release: vi.fn().mockResolvedValue(undefined),
    startProfiling: vi.fn(),
    endProfiling: vi.fn(),
  } as unknown as InferenceSession;
}

function outputTensor(
  logit: number,
  overrides: Partial<{ type: string; dims: readonly number[]; data: unknown }> = {},
): InstanceType<typeof ortMock.FakeTensor> {
  return new ortMock.FakeTensor(
    overrides.type ?? 'float32',
    overrides.data ?? Float32Array.of(logit),
    overrides.dims ?? [1, 1],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runDetection', () => {
  it('runs the exact float32 input/output contract and returns the measured classification', async () => {
    const input = new Float32Array(INPUT_ELEMENTS);
    const run = vi.fn().mockResolvedValue({ logits: outputTensor(0) });
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112.5);

    const result = await runDetection(sessionWithRun(run), 'webgpu', input, manifest, now);

    expect(run).toHaveBeenCalledOnce();
    const feeds = run.mock.calls[0]?.[0] as Record<string, InstanceType<typeof ortMock.FakeTensor>>;
    expect(Object.keys(feeds)).toEqual(['input']);
    expect(feeds.input).toBeInstanceOf(ortMock.FakeTensor);
    expect(feeds.input?.type).toBe('float32');
    expect(feeds.input?.dims).toEqual([1, 3, 384, 384]);
    expect(feeds.input?.data).toBe(input);
    expect(run.mock.calls[0]?.[1]).toEqual(['logits']);
    expect(result).toEqual({
      logit: 0,
      probability: 0.5,
      label: 'Real',
      provider: 'webgpu',
      elapsedMs: 12.5,
    });
  });

  it.each([
    { name: 'plain array', value: Array(INPUT_ELEMENTS).fill(0), error: /float32array/i },
    { name: 'short tensor', value: new Float32Array(INPUT_ELEMENTS - 1), error: /442368/i },
    { name: 'long tensor', value: new Float32Array(INPUT_ELEMENTS + 1), error: /442368/i },
  ])('rejects an invalid $name before session execution', async ({ value, error }) => {
    const run = vi.fn();

    await expect(
      runDetection(
        sessionWithRun(run),
        'wasm',
        value as Float32Array,
        manifest,
        () => 0,
      ),
    ).rejects.toThrow(error);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'missing output', outputs: {}, error: /missing.*logits/i },
    {
      name: 'wrong output type',
      outputs: { logits: outputTensor(0, { type: 'float64' }) },
      error: /float32/i,
    },
    {
      name: 'wrong output dimensions',
      outputs: { logits: outputTensor(0, { dims: [1] }) },
      error: /\[1,1\]/i,
    },
    {
      name: 'wrong output data type',
      outputs: { logits: outputTensor(0, { data: Float64Array.of(0) }) },
      error: /float32array/i,
    },
    {
      name: 'wrong output data length',
      outputs: { logits: outputTensor(0, { data: Float32Array.of(0, 1) }) },
      error: /one logit/i,
    },
    {
      name: 'NaN logit',
      outputs: { logits: outputTensor(Number.NaN) },
      error: /finite logit/i,
    },
    {
      name: 'infinite logit',
      outputs: { logits: outputTensor(Number.POSITIVE_INFINITY) },
      error: /finite logit/i,
    },
  ])('rejects $name', async ({ outputs, error }) => {
    const run = vi.fn().mockResolvedValue(outputs);

    await expect(
      runDetection(
        sessionWithRun(run),
        'wasm',
        new Float32Array(INPUT_ELEMENTS),
        manifest,
        vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1),
      ),
    ).rejects.toThrow(error);
  });

  it('rejects a failed run after a success instead of returning the previous result', async () => {
    const failure = new Error('inference failed');
    const run = vi
      .fn()
      .mockResolvedValueOnce({ logits: outputTensor(1) })
      .mockRejectedValueOnce(failure);
    const session = sessionWithRun(run);
    const input = new Float32Array(INPUT_ELEMENTS);

    const first = await runDetection(session, 'wasm', input, manifest, () => 1);
    expect(first.probability).toBeGreaterThan(manifest.threshold.aigc);
    await expect(runDetection(session, 'wasm', input, manifest, () => 2)).rejects.toBe(failure);
  });
});
