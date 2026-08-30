import * as ort from 'onnxruntime-web/webgpu';

import type { ModelManifest } from './contract';
import { classifyProbability, sigmoid, type DetectionLabel } from './math';
import type { ExecutionProvider } from './model-session';

const INPUT_ELEMENTS = 3 * 384 * 384;
const INPUT_DIMS = [1, 3, 384, 384] as const;
const OUTPUT_DIMS = [1, 1] as const;

export interface DetectionResult {
  readonly logit: number;
  readonly probability: number;
  readonly label: DetectionLabel;
  readonly provider: ExecutionProvider;
  readonly elapsedMs: number;
}

export type RuntimeClock = () => number;

function defaultClock(): number {
  return performance.now();
}

function hasExactDims(value: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((dimension, index) => value[index] === dimension)
  );
}

function readLogit(output: unknown, outputName: string): number {
  if (typeof output !== 'object' || output === null) {
    throw new Error(`Missing inference output ${JSON.stringify(outputName)}`);
  }
  if (!('type' in output) || output.type !== 'float32') {
    throw new Error(`Inference output ${JSON.stringify(outputName)} must be float32`);
  }
  if (!('dims' in output) || !hasExactDims(output.dims, OUTPUT_DIMS)) {
    throw new Error(
      `Inference output ${JSON.stringify(outputName)} must have dimensions [1,1]`,
    );
  }
  if (!('data' in output) || !(output.data instanceof Float32Array)) {
    throw new Error(
      `Inference output ${JSON.stringify(outputName)} data must be a Float32Array`,
    );
  }
  if (output.data.length !== 1) {
    throw new Error(`Inference output ${JSON.stringify(outputName)} must contain one logit`);
  }
  const logit = output.data[0];
  if (logit === undefined || !Number.isFinite(logit)) {
    throw new Error(`Inference output ${JSON.stringify(outputName)} must contain a finite logit`);
  }
  return logit;
}

export async function runDetection(
  session: ort.InferenceSession,
  provider: ExecutionProvider,
  tensor: Float32Array,
  manifest: ModelManifest,
  now: RuntimeClock = defaultClock,
): Promise<DetectionResult> {
  if (!(tensor instanceof Float32Array)) {
    throw new TypeError('Detector input must be a Float32Array');
  }
  if (tensor.length !== INPUT_ELEMENTS) {
    throw new RangeError(
      `Detector input must contain exactly ${INPUT_ELEMENTS} float32 values; received ${tensor.length}`,
    );
  }

  const inputName = manifest.model.input.name;
  const outputName = manifest.model.output.name;
  const input = new ort.Tensor('float32', tensor, [...INPUT_DIMS]);
  const startedAt = now();
  const outputs = await session.run({ [inputName]: input }, [outputName]);
  const finishedAt = now();
  const elapsedMs = finishedAt - startedAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`Inference clock returned an invalid elapsed time: ${String(elapsedMs)}`);
  }

  const logit = readLogit(outputs[outputName], outputName);
  const probability = sigmoid(logit);
  return {
    logit,
    probability,
    label: classifyProbability(probability),
    provider,
    elapsedMs,
  };
}
