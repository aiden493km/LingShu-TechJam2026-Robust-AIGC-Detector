const statusElement = document.querySelector('#status');
const resultElement = document.querySelector('#result');

const MODEL_FILES = {
  fp32: '/models/baseline2_njr_fp32.onnx',
  fp16: '/models/baseline2_njr_fp16.onnx',
  int8: '/models/baseline2_njr_int8.onnx',
};

const FROZEN_THRESHOLD = 0.55657113;
const SAMPLE_ELEMENTS = 3 * 384 * 384;

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function summarize(reference, candidate) {
  const errors = reference.map((value, index) =>
    Math.abs(value - candidate[index]),
  );
  const thresholdFlipIndices = reference.flatMap((value, index) =>
    (value >= FROZEN_THRESHOLD) !==
    (candidate[index] >= FROZEN_THRESHOLD)
      ? [index]
      : [],
  );

  return {
    sample_count: reference.length,
    max_abs_error: Math.max(...errors),
    mean_abs_error:
      errors.reduce((total, value) => total + value, 0) / errors.length,
    threshold_flip_count: thresholdFlipIndices.length,
    threshold_flip_indices: thresholdFlipIndices,
  };
}

async function gpuAdapterInfo() {
  if (!navigator.gpu) {
    return { available: false };
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    return { available: true, adapter_found: false };
  }

  const info = adapter.info;
  return {
    available: true,
    adapter_found: true,
    vendor: info?.vendor ?? null,
    architecture: info?.architecture ?? null,
    device: info?.device ?? null,
    description: info?.description ?? null,
  };
}

async function run() {
  const parameters = new URLSearchParams(window.location.search);
  const variant = parameters.get('variant');
  const executionProvider = parameters.get('ep');
  const fixture = parameters.get('fixture') ?? 'demo';
  if (!MODEL_FILES[variant]) {
    throw new Error(`Unsupported model variant: ${variant}`);
  }
  if (!['webgpu', 'wasm'].includes(executionProvider)) {
    throw new Error(`Unsupported execution provider: ${executionProvider}`);
  }
  if (!/^[a-z0-9_-]+$/.test(fixture)) {
    throw new Error(`Unsupported fixture name: ${fixture}`);
  }

  statusElement.textContent = 'Loading runtime and fixtures…';
  const runtimeModule =
    executionProvider === 'webgpu'
      ? '/node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs'
      : '/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
  const ort = await import(runtimeModule);
  ort.env.logLevel = 'warning';
  ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
  ort.env.wasm.numThreads = Math.min(
    4,
    navigator.hardwareConcurrency || 1,
  );

  const [metadataResponse, inputsResponse] = await Promise.all([
    fetch(`/models/${fixture}_inputs.json`),
    fetch(`/models/${fixture}_inputs_f32.bin`),
  ]);
  if (!metadataResponse.ok || !inputsResponse.ok) {
    throw new Error('Failed to load benchmark fixtures');
  }
  const metadata = await metadataResponse.json();
  const inputBuffer = await inputsResponse.arrayBuffer();
  const inputs = new Float32Array(inputBuffer);

  statusElement.textContent = `Downloading ${variant} model…`;
  const downloadStarted = performance.now();
  const modelResponse = await fetch(MODEL_FILES[variant]);
  if (!modelResponse.ok) {
    throw new Error(`Failed to download ${MODEL_FILES[variant]}`);
  }
  const modelBuffer = await modelResponse.arrayBuffer();
  const modelDownloadMs = performance.now() - downloadStarted;

  statusElement.textContent = `Creating ${executionProvider} session…`;
  const sessionStarted = performance.now();
  const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
  });
  const sessionCreateMs = performance.now() - sessionStarted;

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const firstInput = inputs.subarray(0, SAMPLE_ELEMENTS);
  const warmupStarted = performance.now();
  await session.run({
    [inputName]: new ort.Tensor(
      'float32',
      firstInput,
      [1, 3, 384, 384],
    ),
  });
  const warmupInferenceMs = performance.now() - warmupStarted;

  statusElement.textContent = 'Running measured samples…';
  const probabilities = [];
  const inferenceMs = [];
  for (let index = 0; index < metadata.names.length; index += 1) {
    const start = index * SAMPLE_ELEMENTS;
    const input = inputs.subarray(start, start + SAMPLE_ELEMENTS);
    const inferenceStarted = performance.now();
    const outputs = await session.run({
      [inputName]: new ort.Tensor(
        'float32',
        input,
        [1, 3, 384, 384],
      ),
    });
    inferenceMs.push(performance.now() - inferenceStarted);
    probabilities.push(sigmoid(Number(outputs[outputName].data[0])));
  }

  const result = {
    variant,
    fixture,
    execution_provider: executionProvider,
    cross_origin_isolated: window.crossOriginIsolated,
    hardware_concurrency: navigator.hardwareConcurrency,
    gpu: await gpuAdapterInfo(),
    user_agent: navigator.userAgent,
    model_bytes: modelBuffer.byteLength,
    model_download_ms: modelDownloadMs,
    session_create_ms: sessionCreateMs,
    warmup_inference_ms: warmupInferenceMs,
    inference_ms: inferenceMs,
    average_inference_ms:
      inferenceMs.reduce((total, value) => total + value, 0) /
      inferenceMs.length,
    comparison: summarize(
      metadata.reference_probabilities,
      probabilities,
    ),
    probabilities: Object.fromEntries(
      metadata.names.map((name, index) => [name, probabilities[index]]),
    ),
  };

  window.__benchmarkResult = result;
  statusElement.textContent = 'Complete';
  resultElement.textContent = JSON.stringify(result, null, 2);
}

run().catch((error) => {
  const failure = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  window.__benchmarkError = failure;
  statusElement.textContent = 'Failed';
  resultElement.textContent = JSON.stringify(failure, null, 2);
});
