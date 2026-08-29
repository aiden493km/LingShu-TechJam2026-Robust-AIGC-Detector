import { preprocessImage } from '../../src/runtime/preprocess';

const TENSOR_FLOAT_COUNT = 442_368;
const TENSOR_BYTES = TENSOR_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const MEAN_ERROR_LIMIT = 0.02;
const MAX_ERROR_LIMIT = 0.5;
const RGBA_IMAGE_ID = 'web_demo__tests__fixtures__rgba-hidden-rgb';

interface Dimensions {
  width: number;
  height: number;
}

interface ManifestImage {
  id: string;
  reference: string;
  original_dimensions: Dimensions;
  oriented_dimensions: Dimensions;
  tensor: {
    bytes: number;
    float_count: number;
    sha256: string;
  };
}

interface ParityManifest {
  images: ManifestImage[];
}

interface HarnessResult {
  id: string;
  floatCount: number;
  meanAbsoluteError: number | null;
  maxAbsoluteError: number | null;
  originalDimensions: Dimensions | null;
  orientedDimensions: Dimensions | null;
  dimensionsMatch: boolean;
  rgbaHiddenRgbPreserved: boolean | null;
  failures: string[];
}

interface PendingJob {
  id: string;
  promise: Promise<HarnessResult>;
  resolve: (result: HarnessResult) => void;
}

interface HarnessApi {
  ready: true;
  prepare: (id: string) => void;
  waitForResult: (id: string) => Promise<HarnessResult>;
}

declare global {
  interface Window {
    __lingshuPreprocessParity: HarnessApi;
  }
}

const input = document.querySelector<HTMLInputElement>('#parity-file');
const status = document.querySelector<HTMLOutputElement>('#parity-status');
if (!input || !status) {
  throw new Error('Parity harness controls are missing');
}

const manifestPromise = fetch('/.generated-tests/parity/manifest.json').then(async (response) => {
  if (!response.ok) {
    throw new Error(`Parity manifest fetch failed with HTTP ${response.status}`);
  }
  return (await response.json()) as ParityManifest;
});

let pendingJob: PendingJob | null = null;

function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
  );
}

function dimensionsEqual(actual: Dimensions, expected: Dimensions): boolean {
  return actual.width === expected.width && actual.height === expected.height;
}

function referenceUrl(reference: string): string {
  const encoded = reference.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `/.generated-tests/parity/${encoded}`;
}

async function compareFile(id: string, file: File): Promise<HarnessResult> {
  const manifest = await manifestPromise;
  const image = manifest.images.find((candidate) => candidate.id === id);
  if (!image) {
    throw new Error(`Parity manifest does not contain ${id}`);
  }
  const preprocessed = await preprocessImage(file);
  const response = await fetch(referenceUrl(image.reference));
  if (!response.ok) {
    throw new Error(`Tensor reference fetch failed with HTTP ${response.status}`);
  }
  const reference = await response.arrayBuffer();
  if (reference.byteLength !== TENSOR_BYTES || image.tensor.bytes !== TENSOR_BYTES) {
    throw new Error(`Tensor reference for ${id} has an invalid byte count`);
  }
  if (image.tensor.float_count !== TENSOR_FLOAT_COUNT) {
    throw new Error(`Tensor reference for ${id} has an invalid float count`);
  }
  const observedSha256 = await sha256Hex(reference);
  if (observedSha256 !== image.tensor.sha256) {
    throw new Error(`Tensor reference SHA-256 mismatch for ${id}`);
  }
  if (preprocessed.tensor.length !== TENSOR_FLOAT_COUNT) {
    throw new Error(`Browser tensor for ${id} has ${preprocessed.tensor.length} floats`);
  }

  const referenceView = new DataView(reference);
  let absoluteErrorTotal = 0;
  let maxAbsoluteError = 0;
  for (let index = 0; index < TENSOR_FLOAT_COUNT; index += 1) {
    const expected = referenceView.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
    const actual = preprocessed.tensor[index]!;
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
      throw new Error(`Tensor ${id} contains a non-finite value at index ${index}`);
    }
    const absoluteError = Math.abs(actual - expected);
    absoluteErrorTotal += absoluteError;
    maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
  }
  const meanAbsoluteError = absoluteErrorTotal / TENSOR_FLOAT_COUNT;
  const originalDimensions = {
    width: preprocessed.originalWidth,
    height: preprocessed.originalHeight,
  };
  const orientedDimensions = {
    width: preprocessed.orientedWidth,
    height: preprocessed.orientedHeight,
  };
  const dimensionsMatch =
    dimensionsEqual(originalDimensions, image.original_dimensions) &&
    dimensionsEqual(orientedDimensions, image.oriented_dimensions);
  const withinTensorGates =
    meanAbsoluteError <= MEAN_ERROR_LIMIT && maxAbsoluteError <= MAX_ERROR_LIMIT;

  return {
    id,
    floatCount: TENSOR_FLOAT_COUNT,
    meanAbsoluteError,
    maxAbsoluteError,
    originalDimensions,
    orientedDimensions,
    dimensionsMatch,
    rgbaHiddenRgbPreserved: id === RGBA_IMAGE_ID ? withinTensorGates : null,
    failures: [],
  };
}

function failedResult(id: string, error: unknown): HarnessResult {
  return {
    id,
    floatCount: 0,
    meanAbsoluteError: null,
    maxAbsoluteError: null,
    originalDimensions: null,
    orientedDimensions: null,
    dimensionsMatch: false,
    rgbaHiddenRgbPreserved: id === RGBA_IMAGE_ID ? false : null,
    failures: [error instanceof Error ? error.message : String(error)],
  };
}

input.addEventListener('change', () => {
  const job = pendingJob;
  const file = input.files?.[0];
  if (!job) {
    status.value = 'No parity job prepared';
    return;
  }
  if (!file) {
    const result = failedResult(job.id, new Error('No file was uploaded'));
    status.value = result.failures[0]!;
    job.resolve(result);
    return;
  }
  status.value = `Processing ${job.id}`;
  void compareFile(job.id, file)
    .then((result) => {
      status.value = `Processed ${job.id}`;
      job.resolve(result);
    })
    .catch((error: unknown) => {
      const result = failedResult(job.id, error);
      status.value = result.failures[0]!;
      job.resolve(result);
    });
});

window.__lingshuPreprocessParity = {
  ready: true,
  prepare(id) {
    let resolveResult!: (result: HarnessResult) => void;
    const promise = new Promise<HarnessResult>((resolve) => {
      resolveResult = resolve;
    });
    pendingJob = { id, promise, resolve: resolveResult };
    input.value = '';
    status.value = `Prepared ${id}`;
  },
  waitForResult(id) {
    if (!pendingJob || pendingJob.id !== id) {
      return Promise.reject(new Error(`Parity job ${id} was not prepared`));
    }
    return pendingJob.promise;
  },
};
