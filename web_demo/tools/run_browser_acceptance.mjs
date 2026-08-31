#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const PARITY_DIRECTORY = path.join('web_demo', '.generated-tests', 'parity');
const PARITY_MANIFEST = path.join(PARITY_DIRECTORY, 'manifest.json');
const PARITY_MANIFEST_REPORT_PATH = 'web_demo/.generated-tests/parity/manifest.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MODEL_SHA256 =
  'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69';
const MODEL_BYTES = 88_123_029;
const ORT_RUNTIME_RELATIVE = path.join(
  'web_demo',
  'dist',
  'assets',
  'ort-wasm-simd-threaded.asyncify.wasm',
);
const FROZEN_THRESHOLD = 0.55657113;
const DISTRIBUTION_VERIFIED_LINE = 'VERIFIED FP32 model and WebDemo distribution';
const MAX_PROBABILITY_ERROR = 0.01;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const READY_TIMEOUT_MS = 120_000;
const MODEL_TIMEOUT_MS = 180_000;
const INFERENCE_TIMEOUT_MS = 180_000;
const PROCESS_OUTPUT_LIMIT = 1024 * 1024;
const FRESH_COPY_NAME = 'LingShu 评委 本地复现';
export const RESULT_RETURN_CONTROL_NAME = 'Back to detector home';
export const ERROR_RESET_CONTROL_NAME = 'Reset detector';

const DEMO_SOURCES = [
  'demo_images/f1.png',
  'demo_images/f2.png',
  'demo_images/f3.png',
  'demo_images/f4.png',
  'demo_images/f5.png',
  'demo_images/r1.png',
  'demo_images/r2.png',
  'demo_images/r3.png',
  'demo_images/r4.png',
  'demo_images/r5.png',
];

const FIXTURE_SOURCES = [
  'web_demo/tests/fixtures/exif-orientation-6.jpg',
  'web_demo/tests/fixtures/grayscale.png',
  'web_demo/tests/fixtures/near-threshold-synthetic.png',
  'web_demo/tests/fixtures/non-square.png',
  'web_demo/tests/fixtures/rgba-hidden-rgb.png',
];

export const EXPECTED_PARITY_SOURCES = [...DEMO_SOURCES, ...FIXTURE_SOURCES];

function progress(message) {
  process.stderr.write(`[browser-acceptance] ${message}\n`);
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectExactKeys(value, keys, label) {
  invariant(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} keys must be exactly ${expected.join(', ')}`,
  );
  return value;
}

function finiteProbability(value, label) {
  invariant(
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
    `${label} must be a finite probability in [0, 1]`,
  );
  return value;
}

function sameNumberArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value)
  );
}

export class ReadyLineParser {
  #buffer = '';
  #ready;

  #consume(line) {
    if (!line.startsWith('READY')) {
      return undefined;
    }

    const match = /^READY (http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/)$/.exec(line);
    if (match === null) {
      throw new Error(`Invalid READY announcement: ${JSON.stringify(line)}`);
    }
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port > 65_535) {
      throw new Error(`Invalid READY port: ${String(match[2])}`);
    }
    if (this.#ready !== undefined) {
      throw new Error(`Server printed multiple READY announcements (${this.#ready.href}, ${match[1]})`);
    }

    const parsed = new URL(match[1]);
    invariant(parsed.pathname === '/' && parsed.search === '' && parsed.hash === '', 'READY URL must name the server root');
    this.#ready = { href: parsed.href, origin: parsed.origin, port };
    return this.#ready;
  }

  push(chunk) {
    invariant(typeof chunk === 'string', 'READY parser chunks must be strings');
    this.#buffer += chunk;
    let found;
    while (true) {
      const newline = this.#buffer.indexOf('\n');
      if (newline < 0) {
        break;
      }
      let line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      const parsed = this.#consume(line);
      if (parsed !== undefined) {
        found = parsed;
      }
    }
    return found;
  }

  finish() {
    if (this.#buffer === '') {
      return undefined;
    }
    let line = this.#buffer;
    this.#buffer = '';
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    return this.#consume(line);
  }
}

export function inspectRequestUrl(requestUrl, allowedOrigin) {
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { kind: 'blocked-network', origin: 'invalid-url' };
  }

  if (['blob:', 'data:', 'about:'].includes(parsed.protocol)) {
    return { kind: 'non-network', origin: parsed.origin };
  }
  if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin === allowedOrigin) {
    return { kind: 'allowed-network', origin: parsed.origin };
  }
  return { kind: 'blocked-network', origin: parsed.origin };
}

export function inspectWebSocketUrl(requestUrl, allowedHttpOrigin) {
  let parsed;
  let allowed;
  try {
    parsed = new URL(requestUrl);
    allowed = new URL(allowedHttpOrigin);
  } catch {
    return { kind: 'blocked-network', origin: 'invalid-url' };
  }

  if (!['http:', 'https:'].includes(allowed.protocol)) {
    return { kind: 'blocked-network', origin: parsed.origin };
  }
  const expected = new URL(allowed.origin);
  expected.protocol = allowed.protocol === 'http:' ? 'ws:' : 'wss:';
  if (['ws:', 'wss:'].includes(parsed.protocol) && parsed.origin === expected.origin) {
    return { kind: 'allowed-network', origin: parsed.origin };
  }
  return { kind: 'blocked-network', origin: parsed.origin };
}

function validateDimensions(value, label) {
  invariant(isRecord(value), `${label} must be an object`);
  invariant(Number.isInteger(value.width) && value.width > 0, `${label}.width must be positive`);
  invariant(Number.isInteger(value.height) && value.height > 0, `${label}.height must be positive`);
}

export function sameDimensions(actual, expected) {
  return (
    isRecord(actual) &&
    isRecord(expected) &&
    actual.width === expected.width &&
    actual.height === expected.height
  );
}

export function validateParityManifest(value) {
  invariant(isRecord(value), 'parity manifest must be an object');
  invariant(value.schema_version === 1, 'parity manifest schema_version must equal 1');
  invariant(isRecord(value.tensor), 'parity manifest tensor must be an object');
  invariant(sameNumberArray(value.tensor.shape, [1, 3, 384, 384]), 'parity tensor shape must be [1,3,384,384]');
  invariant(value.tensor.dtype === 'float32', 'parity tensor dtype must be float32');
  invariant(value.tensor.byte_order === 'little-endian', 'parity tensor byte order must be little-endian');
  invariant(value.tensor.layout === 'NCHW', 'parity tensor layout must be NCHW');
  invariant(value.tensor.float_count === 442_368, 'parity tensor float count must be 442368');
  invariant(value.tensor.bytes === 1_769_472, 'parity tensor byte count must be 1769472');
  invariant(isRecord(value.model), 'parity manifest model must be an object');
  invariant(
    value.model.source === 'web_demo/models/baseline2_njr_fp32.onnx',
    'parity manifest model source must be the deployed browser model',
  );
  invariant(value.model.file === 'baseline2_njr_fp32.onnx', 'parity manifest must use the deployed FP32 model');
  invariant(value.model.bytes === MODEL_BYTES, `parity model byte count must equal ${MODEL_BYTES}`);
  invariant(value.model.sha256 === MODEL_SHA256, `parity model SHA-256 must equal ${MODEL_SHA256}`);
  invariant(value.model.input_name === 'input', 'parity model input must be named input');
  invariant(value.model.output_name === 'logits', 'parity model output must be named logits');
  invariant(value.threshold === FROZEN_THRESHOLD, `parity threshold must equal ${FROZEN_THRESHOLD}`);
  invariant(Array.isArray(value.images), 'parity manifest images must be an array');
  invariant(value.images.length === 15, 'parity manifest must contain exactly 15 images');

  const sources = value.images.map((row) => (isRecord(row) ? row.source : undefined));
  invariant(
    EXPECTED_PARITY_SOURCES.every((source, index) => sources[index] === source),
    'parity source order must be the exact ten demo images plus five committed fixtures',
  );

  const seenIds = new Set();
  for (const [index, row] of value.images.entries()) {
    const label = `parity images[${index}]`;
    invariant(isRecord(row), `${label} must be an object`);
    invariant(typeof row.id === 'string' && /^[A-Za-z0-9._-]+$/.test(row.id), `${label}.id is invalid`);
    invariant(!seenIds.has(row.id), `${label}.id is duplicated`);
    seenIds.add(row.id);
    invariant(typeof row.reference === 'string' && /^tensors\/[A-Za-z0-9._-]+\.f32$/.test(row.reference), `${label}.reference is invalid`);
    validateDimensions(row.original_dimensions, `${label}.original_dimensions`);
    validateDimensions(row.oriented_dimensions, `${label}.oriented_dimensions`);
    invariant(isRecord(row.tensor), `${label}.tensor must be an object`);
    invariant(sameNumberArray(row.tensor.shape, [1, 3, 384, 384]), `${label}.tensor shape is invalid`);
    invariant(row.tensor.float_count === 442_368, `${label}.tensor float count is invalid`);
    invariant(row.tensor.bytes === 1_769_472, `${label}.tensor byte count is invalid`);
    invariant(typeof row.tensor.sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.tensor.sha256), `${label}.tensor SHA-256 is invalid`);
    invariant(typeof row.logit === 'number' && Number.isFinite(row.logit), `${label}.logit must be finite`);
    const probability = finiteProbability(row.probability, `${label}.probability`);
    const expectedLabel = probability >= FROZEN_THRESHOLD ? 'AIGC' : 'Real';
    invariant(row.label === expectedLabel, `${label}.label disagrees with the frozen threshold`);
  }
  return value;
}

export function parseDemoPredictions(value) {
  invariant(Array.isArray(value), 'demo predictions must be an array');
  invariant(value.length === DEMO_SOURCES.length, 'demo predictions must contain exactly ten rows');
  const output = new Map();
  for (const [index, expectedSource] of DEMO_SOURCES.entries()) {
    const row = value[index];
    invariant(isRecord(row), `demo predictions[${index}] must be an object`);
    const source = `demo_images/${row.image_path}`;
    invariant(source === expectedSource, `demo prediction order mismatch at index ${index}`);
    invariant(!output.has(source), `duplicate demo prediction ${source}`);
    output.set(source, finiteProbability(row.pred, `demo prediction ${source}`));
  }
  return output;
}

export function compareProbability(reference, actual, threshold = FROZEN_THRESHOLD) {
  finiteProbability(reference, 'reference probability');
  finiteProbability(actual, 'actual probability');
  finiteProbability(threshold, 'decision threshold');
  const absoluteError = Math.abs(reference - actual);
  const expectedLabel = reference >= threshold ? 'AIGC' : 'Real';
  const actualLabel = actual >= threshold ? 'AIGC' : 'Real';
  return {
    absoluteError,
    expectedLabel,
    actualLabel,
    thresholdFlip: expectedLabel !== actualLabel,
    withinTolerance: absoluteError <= MAX_PROBABILITY_ERROR,
  };
}

function nonEmptyString(value, label) {
  invariant(typeof value === 'string' && value.trim() !== '', `${label} must be a non-empty string`);
  return value;
}

function parseLocalRootUrl(value, label) {
  nonEmptyString(value, label);
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/$/.exec(value);
  invariant(match !== null, `${label} must be an exact 127.0.0.1 server root`);
  const port = Number(match[1]);
  invariant(port <= 65_535, `${label} port is invalid`);
  const parsed = new URL(value);
  return { href: parsed.href, origin: parsed.origin, port };
}

function validateGpuEvidence(value, label) {
  expectExactKeys(
    value,
    value?.error === undefined
      ? ['adapterAvailable', 'adapterInfo', 'apiAvailable']
      : ['adapterAvailable', 'adapterInfo', 'apiAvailable', 'error'],
    label,
  );
  invariant(typeof value.apiAvailable === 'boolean', `${label}.apiAvailable must be boolean`);
  invariant(typeof value.adapterAvailable === 'boolean', `${label}.adapterAvailable must be boolean`);
  invariant(value.apiAvailable || !value.adapterAvailable, `${label} cannot have an adapter without the WebGPU API`);
  invariant(value.adapterInfo === null || isRecord(value.adapterInfo), `${label}.adapterInfo must be null or an object`);
  if (isRecord(value.adapterInfo)) {
    expectExactKeys(
      value.adapterInfo,
      ['architecture', 'description', 'device', 'vendor'],
      `${label}.adapterInfo`,
    );
    for (const key of ['vendor', 'architecture', 'device', 'description']) {
      invariant(typeof value.adapterInfo[key] === 'string', `${label}.adapterInfo.${key} must be a string`);
    }
  }
  if (value.error !== undefined) nonEmptyString(value.error, `${label}.error`);
}

export function validateProviderEvidence(value, allowedOrigin) {
  expectExactKeys(
    value,
    [
      'consoleMessages',
      'crossOriginIsolated',
      'expectedProvider',
      'fallbackNote',
      'fallbackNoteVisible',
      'gpu',
      'images',
      'maxAbsoluteError',
      'mode',
      'requestOrigins',
      'requestPaths',
      'thresholdFlips',
      'webGpuDisabledByHarness',
      'webSocketOrigins',
      'workflowChecks',
    ],
    'provider evidence',
  );
  invariant(
    value.mode === 'normal' || value.mode === 'fallback' || value.mode === 'wasm',
    'provider evidence mode is invalid',
  );
  invariant(value.expectedProvider === 'WebGPU' || value.expectedProvider === 'WASM', 'expected provider is invalid');
  validateGpuEvidence(value.gpu, `${value.mode} GPU evidence`);
  invariant(
    value.webGpuDisabledByHarness === (value.mode === 'fallback'),
    `${value.mode}.webGpuDisabledByHarness is inconsistent`,
  );
  invariant(
    value.fallbackNote === null || typeof value.fallbackNote === 'string',
    `${value.mode}.fallbackNote must be null or a string`,
  );
  invariant(
    typeof value.fallbackNoteVisible === 'boolean',
    `${value.mode}.fallbackNoteVisible must be boolean`,
  );
  invariant(value.crossOriginIsolated === true, `${value.mode} must record cross-origin isolation`);
  invariant(Array.isArray(value.images) && value.images.length === 15, `${value.mode} must contain 15 image results`);

  for (const [index, row] of value.images.entries()) {
    const label = `${value.mode} images[${index}]`;
    expectExactKeys(
      row,
      [
        'absoluteError',
        'elapsedMs',
        'label',
        'probability',
        'provider',
        'reference',
        'referenceProbability',
        'source',
        'thresholdFlip',
      ],
      label,
    );
    invariant(row.source === EXPECTED_PARITY_SOURCES[index], `${label}.source is out of order`);
    const expectedReference = index < DEMO_SOURCES.length ? 'demo_predictions_cpu' : 'pillow_fp32_onnx';
    invariant(row.reference === expectedReference, `${label}.reference is invalid`);
    const referenceProbability = finiteProbability(row.referenceProbability, `${label}.referenceProbability`);
    const probability = finiteProbability(row.probability, `${label}.probability`);
    invariant(typeof row.absoluteError === 'number' && Number.isFinite(row.absoluteError), `${label}.absoluteError must be finite`);
    const calculatedError = Math.abs(referenceProbability - probability);
    invariant(Math.abs(row.absoluteError - calculatedError) <= 1e-12, `${label}.absoluteError is inconsistent`);
    invariant(row.absoluteError <= MAX_PROBABILITY_ERROR, `${label}.absoluteError exceeds the gate`);
    invariant(row.thresholdFlip === false, `${label} records a frozen-threshold flip`);
    invariant(row.provider === value.expectedProvider, `${label}.provider disagrees with expectedProvider`);
    invariant(typeof row.elapsedMs === 'number' && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0, `${label}.elapsedMs is invalid`);
    const expectedLabel = referenceProbability >= FROZEN_THRESHOLD ? 'AIGC' : 'Real';
    const actualLabel = probability >= FROZEN_THRESHOLD ? 'AIGC' : 'Real';
    invariant(row.label === expectedLabel && row.label === actualLabel, `${label}.label is inconsistent`);
  }

  invariant(
    typeof value.maxAbsoluteError === 'number' && Number.isFinite(value.maxAbsoluteError),
    `${value.mode}.maxAbsoluteError must be finite`,
  );
  const observedMaximum = Math.max(...value.images.map(({ absoluteError }) => absoluteError));
  invariant(Math.abs(value.maxAbsoluteError - observedMaximum) <= 1e-12, `${value.mode}.maxAbsoluteError is inconsistent`);
  invariant(value.maxAbsoluteError <= MAX_PROBABILITY_ERROR, `${value.mode}.maxAbsoluteError exceeds the gate`);
  invariant(value.thresholdFlips === 0, `${value.mode}.thresholdFlips must equal zero`);
  invariant(Array.isArray(value.requestOrigins), `${value.mode}.requestOrigins must be an array`);
  invariant(
    value.requestOrigins.length === 1 && value.requestOrigins[0] === allowedOrigin,
    `${value.mode}.requestOrigins must contain only the selected server`,
  );
  invariant(Array.isArray(value.webSocketOrigins), `${value.mode}.webSocketOrigins must be an array`);
  const expectedWebSocketOrigin = new URL(allowedOrigin);
  expectedWebSocketOrigin.protocol = expectedWebSocketOrigin.protocol === 'http:' ? 'ws:' : 'wss:';
  invariant(
    value.webSocketOrigins.every((origin) => origin === expectedWebSocketOrigin.origin),
    `${value.mode}.webSocketOrigins contains a remote or wrong-origin endpoint`,
  );
  invariant(new Set(value.webSocketOrigins).size === value.webSocketOrigins.length, `${value.mode}.webSocketOrigins contains duplicates`);
  invariant(isRecord(value.requestPaths), `${value.mode}.requestPaths must be an object`);
  for (const [requestPath, count] of Object.entries(value.requestPaths)) {
    invariant(requestPath.startsWith('/') && !requestPath.includes('://'), `${value.mode}.requestPaths contains an invalid path`);
    invariant(Number.isInteger(count) && count > 0, `${value.mode}.requestPaths count must be a positive integer`);
  }
  const rootRequest = value.mode === 'wasm' ? '/?provider=wasm' : '/';
  for (const requiredPath of [
    rootRequest,
    '/models/manifest.json',
    '/models/baseline2_njr_fp32.onnx',
    '/assets/ort-wasm-simd-threaded.asyncify.wasm',
  ]) {
    invariant(value.requestPaths[requiredPath] >= 1, `${value.mode}.requestPaths omitted ${requiredPath}`);
  }
  invariant(Array.isArray(value.consoleMessages), `${value.mode}.consoleMessages must be an array`);
  invariant(value.consoleMessages.every((message) => typeof message === 'string'), `${value.mode}.consoleMessages must contain strings`);
  invariant(value.workflowChecks === (value.mode === 'wasm'), `${value.mode}.workflowChecks is inconsistent`);
  invariant(
    value.mode !== 'wasm' || value.expectedProvider === 'WASM',
    'forced WASM evidence must record the WASM provider',
  );
  invariant(
    value.mode !== 'normal' || value.expectedProvider === (value.gpu.adapterAvailable ? 'WebGPU' : 'WASM'),
    'normal evidence provider disagrees with adapter availability',
  );
  if (value.mode === 'fallback') {
    invariant(value.expectedProvider === 'WASM', 'automatic fallback evidence must record the WASM provider');
    invariant(
      value.gpu.apiAvailable === false && value.gpu.adapterAvailable === false,
      'automatic fallback must make WebGPU unavailable before the app starts',
    );
    nonEmptyString(value.fallbackNote, 'automatic fallback compatibility note');
    invariant(
      value.fallbackNote.startsWith('Compatibility note:') &&
        value.fallbackNote.includes('same FP32 model is running with WASM'),
      'automatic fallback must expose the visible compatibility note',
    );
  } else if (value.mode === 'wasm' || value.expectedProvider === 'WebGPU') {
    invariant(value.fallbackNote === null, `${value.mode} must not record an automatic fallback note`);
  } else {
    nonEmptyString(value.fallbackNote, 'normal automatic-fallback compatibility note');
  }
  const shouldShowFallbackNote =
    value.mode === 'fallback' ||
    (value.mode === 'normal' && value.expectedProvider === 'WASM');
  invariant(
    value.fallbackNoteVisible === shouldShowFallbackNote,
    `${value.mode} fallback-note visibility is inconsistent`,
  );
  return value;
}

function validateProviderSet(value, allowedOrigin, label) {
  invariant(isRecord(value), `${label} providers must be an object`);
  invariant(
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(['fallback', 'normal', 'wasm']),
    `${label} provider set must contain exactly normal, fallback, and wasm`,
  );
  invariant(value.normal?.mode === 'normal', `${label} normal provider evidence is missing`);
  invariant(value.fallback?.mode === 'fallback', `${label} automatic fallback evidence is missing`);
  invariant(value.wasm?.mode === 'wasm', `${label} forced-WASM evidence is missing`);
  validateProviderEvidence(value.normal, allowedOrigin);
  validateProviderEvidence(value.fallback, allowedOrigin);
  validateProviderEvidence(value.wasm, allowedOrigin);
}

function validateFailureEvidence(value, label) {
  expectExactKeys(value, ['diagnostic', 'exitCode'], `${label} evidence`);
  invariant(Number.isInteger(value.exitCode) && value.exitCode !== 0, `${label} must record a nonzero exit code`);
  nonEmptyString(value.diagnostic, `${label}.diagnostic`);
}

export function validateAcceptanceReport(value) {
  expectExactKeys(
    value,
    [
      'artifactFailures',
      'commit',
      'freshCopy',
      'gates',
      'generatedAt',
      'model',
      'parityManifest',
      'passed',
      'platform',
      'portFallback',
      'runtime',
      'schemaVersion',
      'source',
      'threshold',
    ],
    'acceptance report including parity manifest',
  );
  invariant(value.schemaVersion === 1, 'acceptance report schemaVersion must equal 1');
  invariant(value.passed === true, 'acceptance report must record a pass');
  nonEmptyString(value.generatedAt, 'acceptance report generatedAt');
  const generatedAt = new Date(value.generatedAt);
  invariant(!Number.isNaN(generatedAt.valueOf()) && generatedAt.toISOString() === value.generatedAt, 'acceptance report generatedAt must be canonical ISO-8601');
  invariant(typeof value.commit === 'string' && /^[0-9a-f]{40}$/.test(value.commit), 'acceptance report commit must be a full Git SHA-1');
  expectExactKeys(value.parityManifest, ['path', 'sha256'], 'acceptance report parity manifest');
  invariant(
    value.parityManifest.path === PARITY_MANIFEST_REPORT_PATH,
    'acceptance report parity manifest path is invalid',
  );
  invariant(
    typeof value.parityManifest.sha256 === 'string' &&
      SHA256_PATTERN.test(value.parityManifest.sha256),
    'acceptance report parity manifest SHA-256 must be lowercase hexadecimal',
  );
  expectExactKeys(value.platform, ['arch', 'platform', 'release'], 'acceptance report platform');
  for (const key of ['platform', 'release', 'arch']) nonEmptyString(value.platform[key], `acceptance report platform.${key}`);
  expectExactKeys(
    value.runtime,
    ['edge', 'edgeExecutable', 'node', 'python'],
    'acceptance report runtime',
  );
  for (const key of ['node', 'python', 'edge', 'edgeExecutable']) nonEmptyString(value.runtime[key], `acceptance report runtime.${key}`);
  expectExactKeys(value.model, ['bytes', 'sha256'], 'acceptance report model');
  invariant(value.model.bytes === MODEL_BYTES, `acceptance report model bytes must equal ${MODEL_BYTES}`);
  invariant(value.model.sha256 === MODEL_SHA256, 'acceptance report model SHA-256 is invalid');
  invariant(value.threshold === FROZEN_THRESHOLD, 'acceptance report threshold is invalid');
  expectExactKeys(
    value.gates,
    ['imagesPerProvider', 'maxProbabilityError'],
    'acceptance report gates',
  );
  invariant(value.gates.maxProbabilityError === MAX_PROBABILITY_ERROR, 'acceptance report probability gate is invalid');
  invariant(value.gates.imagesPerProvider === 15, 'acceptance report image-count gate is invalid');

  expectExactKeys(
    value.portFallback,
    ['occupation', 'occupiedPort', 'passed', 'selectedPort'],
    'acceptance report portFallback',
  );
  invariant(value.portFallback.occupiedPort === 8765, 'acceptance report must occupy port 8765');
  invariant(
    value.portFallback.occupation === 'acceptance-holder' || value.portFallback.occupation === 'preexisting',
    'acceptance report port occupation is invalid',
  );
  invariant(
    Number.isInteger(value.portFallback.selectedPort) &&
      value.portFallback.selectedPort >= 1 &&
      value.portFallback.selectedPort <= 65_535 &&
      value.portFallback.selectedPort !== 8765,
    'acceptance report fallback port is invalid',
  );
  invariant(value.portFallback.passed === true, 'acceptance report port fallback must pass');

  expectExactKeys(
    value.source,
    ['providers', 'serverUrl', 'terminationUnreachable'],
    'acceptance report source evidence',
  );
  const sourceUrl = parseLocalRootUrl(value.source.serverUrl, 'acceptance report source.serverUrl');
  invariant(sourceUrl.port === value.portFallback.selectedPort, 'source server URL disagrees with fallback port');
  validateProviderSet(value.source.providers, sourceUrl.origin, 'source');
  invariant(value.source.terminationUnreachable === true, 'source server termination must make its URL unreachable');

  expectExactKeys(
    value.artifactFailures,
    ['corruptModel', 'missingWasm'],
    'acceptance report artifactFailures',
  );
  validateFailureEvidence(value.artifactFailures.corruptModel, 'corrupt model');
  validateFailureEvidence(value.artifactFailures.missingWasm, 'missing WASM');

  expectExactKeys(
    value.freshCopy,
    [
      'batchCheck',
      'directoryName',
      'excluded',
      'npmInstallRun',
      'providers',
      'serverUrl',
      'sourceCommit',
      'terminationUnreachable',
      'trackedFileCount',
    ],
    'acceptance report freshCopy',
  );
  invariant(value.freshCopy.directoryName === FRESH_COPY_NAME, 'fresh-copy directory name is invalid');
  invariant(
    value.freshCopy.sourceCommit === value.commit,
    'fresh-copy sourceCommit must equal the exact tested commit',
  );
  invariant(Number.isInteger(value.freshCopy.trackedFileCount) && value.freshCopy.trackedFileCount > 0, 'fresh-copy tracked file count is invalid');
  invariant(
    JSON.stringify(value.freshCopy.excluded) === JSON.stringify(['.git', 'node_modules', '.venv', 'web_models']),
    'fresh-copy exclusions are invalid',
  );
  invariant(value.freshCopy.npmInstallRun === false, 'fresh-copy acceptance must not run npm install');
  expectExactKeys(
    value.freshCopy.batchCheck,
    ['exitCode', 'output'],
    'fresh-copy batchCheck',
  );
  invariant(value.freshCopy.batchCheck.exitCode === 0, 'fresh-copy BAT --check must exit zero');
  invariant(
    typeof value.freshCopy.batchCheck.output === 'string' &&
      value.freshCopy.batchCheck.output.includes(DISTRIBUTION_VERIFIED_LINE),
    'fresh-copy BAT --check must record distribution verification',
  );
  const freshUrl = parseLocalRootUrl(value.freshCopy.serverUrl, 'acceptance report freshCopy.serverUrl');
  validateProviderSet(value.freshCopy.providers, freshUrl.origin, 'fresh copy');
  invariant(value.freshCopy.terminationUnreachable === true, 'fresh-copy server termination must make its URL unreachable');
  return value;
}

function validateTrackedPath(relativePath) {
  invariant(typeof relativePath === 'string' && relativePath.length > 0, 'unsafe tracked path: empty');
  invariant(!relativePath.includes('\\'), `unsafe tracked path: ${relativePath}`);
  invariant(!path.posix.isAbsolute(relativePath), `unsafe tracked path: ${relativePath}`);
  invariant(path.posix.normalize(relativePath) === relativePath, `unsafe tracked path: ${relativePath}`);
  const components = relativePath.split('/');
  invariant(
    components.every((component) => component !== '' && component !== '.' && component !== '..'),
    `unsafe tracked path: ${relativePath}`,
  );
  invariant(!components[0].includes(':'), `unsafe tracked path: ${relativePath}`);
  return components;
}

export function parseTrackedFiles(buffer) {
  invariant(Buffer.isBuffer(buffer), 'git ls-files output must be a Buffer');
  const files = [];
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    invariant(end >= 0, 'git ls-files output must be NUL terminated');
    const bytes = buffer.subarray(start, end);
    const decoded = bytes.toString('utf8');
    invariant(Buffer.from(decoded, 'utf8').equals(bytes), 'unsafe tracked path: invalid UTF-8');
    validateTrackedPath(decoded);
    files.push(decoded);
    start = end + 1;
  }
  return files;
}

export function shouldExcludeTrackedPath(relativePath) {
  const components = validateTrackedPath(relativePath);
  const lowered = components.map((component) => component.toLowerCase());
  return (
    lowered.includes('.git') ||
    lowered.includes('.venv') ||
    lowered.includes('node_modules') ||
    lowered[0] === 'web_models'
  );
}

export function buildBatchInvocation(launcherPath, arguments_) {
  invariant(typeof launcherPath === 'string' && launcherPath.length > 0, 'BAT launcher path is required');
  invariant(!launcherPath.includes('"') && !launcherPath.includes('\r') && !launcherPath.includes('\n'), 'BAT launcher path contains unsupported characters');
  invariant(Array.isArray(arguments_), 'BAT launcher arguments must be an array');
  for (const argument of arguments_) {
    invariant(typeof argument === 'string' && /^--[a-z][a-z-]*$|^[0-9]+$/.test(argument), `unsafe BAT argument: ${String(argument)}`);
  }
  const commandLine = ['call "%LINGSHU_DEMO_LAUNCHER%"', ...arguments_].join(' ');
  return {
    commandLine,
    commandArguments: ['/d', '/s', '/c', commandLine],
    detached: false,
    environment: { LINGSHU_DEMO_LAUNCHER: launcherPath },
    windowsVerbatimArguments: true,
  };
}

function appendBounded(current, chunk) {
  const combined = current + chunk;
  return combined.length <= PROCESS_OUTPUT_LIMIT
    ? combined
    : combined.slice(combined.length - PROCESS_OUTPUT_LIMIT);
}

export function shouldTerminateProcessTree(platform, mode) {
  return platform === 'win32' || mode === 'launcher';
}

export function assertSuccessfulProcessTreeTermination(
  result,
  processId,
  { processExited = false } = {},
) {
  invariant(isRecord(result), 'taskkill result must be an object');
  invariant(typeof processExited === 'boolean', 'processExited must be boolean');
  const diagnostic = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();
  invariant(
    result.code === 0 || processExited,
    `Could not terminate demo process tree at PID ${String(processId)}${
      diagnostic === '' ? '' : `: ${diagnostic}`
    }`,
  );
  return result;
}

export function terminateWindowsProcessTreeSync(
  processId,
  spawnSyncImplementation = spawnSync,
) {
  invariant(Number.isInteger(processId) && processId > 0, 'Windows process-tree PID is invalid');
  const result = spawnSyncImplementation(
    'taskkill.exe',
    ['/PID', String(processId), '/T', '/F'],
    {
      encoding: 'utf8',
      maxBuffer: PROCESS_OUTPUT_LIMIT,
      timeout: 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return assertSuccessfulProcessTreeTermination(
    {
      code: result.status,
      signal: result.signal,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${result.error === undefined ? '' : ` ${result.error.message}`}`,
    },
    processId,
  );
}

export async function runCleanupActions(actions, primaryError) {
  invariant(Array.isArray(actions), 'cleanup actions must be an array');
  const cleanupErrors = [];
  for (const [index, entry] of actions.entries()) {
    invariant(isRecord(entry), `cleanup actions[${index}] must be an object`);
    const label = nonEmptyString(entry.label, `cleanup actions[${index}].label`);
    invariant(typeof entry.action === 'function', `cleanup action ${label} must be a function`);
    try {
      await entry.action();
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : String(error);
      cleanupErrors.push(new Error(`${label} cleanup failed: ${diagnostic}`, { cause: error }));
    }
  }
  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Browser acceptance failed and one or more cleanup actions also failed',
    );
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'One or more browser acceptance cleanup actions failed');
  }
  if (primaryError !== undefined) throw primaryError;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function sha256File(filePath) {
  const digest = createHash('sha256');
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', rejectHash);
    stream.once('end', resolveHash);
  });
  return digest.digest('hex');
}

export function parseParityManifestBytes(bytes) {
  invariant(Buffer.isBuffer(bytes), 'parity manifest bytes must be a Buffer');
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `Parity manifest is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {
    manifest: validateParityManifest(value),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function spawnCaptured(command, arguments_, options = {}) {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    detached: options.detached ?? false,
    windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = appendBounded(stdout, chunk);
    options.onStdout?.(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk);
    options.onStderr?.(chunk);
  });
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  return {
    child,
    exit,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function runCaptured(command, arguments_, options = {}) {
  const running = spawnCaptured(command, arguments_, options);
  let timeout;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const result = await Promise.race([
    running.exit,
    new Promise((_, rejectTimeout) => {
      timeout = setTimeout(() => {
        const timeoutError = new Error(`Process timed out after ${timeoutMs} ms: ${command}`);
        if (
          options.killTreeOnTimeout === true &&
          process.platform === 'win32' &&
          running.child.pid !== undefined
        ) {
          try {
            terminateWindowsProcessTreeSync(running.child.pid);
          } catch (cleanupError) {
            rejectTimeout(
              new AggregateError(
                [timeoutError, cleanupError],
                `Process timeout cleanup failed for PID ${String(running.child.pid)}`,
              ),
            );
            return;
          }
        } else if (
          options.killTreeOnTimeout === true &&
          options.detached === true &&
          running.child.pid !== undefined &&
          process.platform !== 'win32'
        ) {
          try {
            process.kill(-running.child.pid, 'SIGKILL');
          } catch {
            running.child.kill('SIGKILL');
          }
        } else {
          running.child.kill();
        }
        rejectTimeout(timeoutError);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
  return { ...result, stdout: running.stdout, stderr: running.stderr };
}

function pythonCandidates(repositoryRoot) {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      { command: path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe'), prefix: [] },
      { command: 'py', prefix: ['-3'] },
      { command: 'python', prefix: [] },
    );
  } else {
    candidates.push(
      { command: path.join(repositoryRoot, '.venv', 'bin', 'python'), prefix: [] },
      { command: 'python3', prefix: [] },
      { command: 'python', prefix: [] },
    );
  }
  return candidates;
}

async function discoverPython(repositoryRoot) {
  for (const candidate of pythonCandidates(repositoryRoot)) {
    const result = spawnSync(
      candidate.command,
      [
        ...candidate.prefix,
        '-c',
        'import sys; print(".".join(map(str, sys.version_info[:3]))); raise SystemExit(sys.version_info < (3, 11))',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.status === 0) {
      return {
        ...candidate,
        version: result.stdout.trim(),
      };
    }
  }
  throw new Error('Python 3.11+ is required for browser acceptance');
}

function executableFromPath(name) {
  const pathValue = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension.toLowerCase()}`);
      try {
        const result = spawnSync(candidate, ['--version'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.status === 0) return candidate;
      } catch {
        // Continue through the finite PATH candidate list.
      }
    }
  }
  return undefined;
}

async function discoverEdge() {
  const candidates = [];
  if (process.env.LINGSHU_EDGE_EXECUTABLE) {
    candidates.push(process.env.LINGSHU_EDGE_EXECUTABLE);
  }
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (base) candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else {
    for (const name of ['microsoft-edge', 'microsoft-edge-stable']) {
      const located = executableFromPath(name);
      if (located) candidates.push(located);
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const information = await stat(candidate);
      if (information.isFile()) return path.resolve(candidate);
    } catch {
      // Try the next known installed-Edge location.
    }
  }
  throw new Error(`Installed Microsoft Edge was not found (checked: ${candidates.join(', ')})`);
}

function serverCommand(repositoryRoot, python, mode) {
  if (mode === 'direct') {
    return {
      command: python.command,
      arguments: [
        ...python.prefix,
        path.join(repositoryRoot, 'web_demo', 'tools', 'serve_demo.py'),
        '--no-browser',
      ],
      environment: process.env,
      detached: false,
    };
  }

  if (process.platform === 'win32') {
    const launcher = path.join(repositoryRoot, 'web_demo', 'start-demo.bat');
    const invocation = buildBatchInvocation(launcher, ['--no-browser']);
    return {
      command: process.env.ComSpec ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
      arguments: invocation.commandArguments,
      environment: { ...process.env, ...invocation.environment },
      detached: invocation.detached,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    };
  }

  return {
    command: '/bin/sh',
    arguments: [path.join(repositoryRoot, 'web_demo', 'start-demo.sh'), '--no-browser'],
    environment: process.env,
    detached: true,
  };
}

async function startDemoServer(repositoryRoot, python, mode) {
  const specification = serverCommand(repositoryRoot, python, mode);
  const parser = new ReadyLineParser();
  let readyResolve;
  let readyReject;
  let settled = false;
  let protocolError;
  const readyPromise = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const running = spawnCaptured(specification.command, specification.arguments, {
    cwd: repositoryRoot,
    env: specification.environment,
    detached: specification.detached,
    windowsVerbatimArguments: specification.windowsVerbatimArguments,
    onStdout(chunk) {
      try {
        const ready = parser.push(chunk);
        if (ready !== undefined && !settled) {
          settled = true;
          readyResolve(ready);
        }
      } catch (error) {
        const readyWasAlreadySettled = settled;
        protocolError = error;
        if (!settled) {
          settled = true;
          readyReject(error);
        }
        if (
          readyWasAlreadySettled &&
          shouldTerminateProcessTree(process.platform, mode) &&
          process.platform === 'win32' &&
          running.child.pid !== undefined
        ) {
          try {
            terminateWindowsProcessTreeSync(running.child.pid);
          } catch (cleanupError) {
            protocolError = new AggregateError(
              [error, cleanupError],
              `Late READY protocol failure cleanup failed for PID ${String(running.child.pid)}`,
            );
          }
        } else if (readyWasAlreadySettled) {
          running.child.kill();
        }
      }
    },
  });

  void running.exit.then((result) => {
    try {
      parser.finish();
    } catch (error) {
      protocolError = error;
    }
    if (!settled) {
      settled = true;
      readyReject(
        new Error(
          `Demo server exited before READY (code=${String(result.code)}, signal=${String(result.signal)}):\n${running.stdout}${running.stderr}`,
        ),
      );
    }
  }).catch((error) => {
    if (!settled) {
      settled = true;
      readyReject(error);
    }
  });

  let timeout;
  try {
    const ready = await Promise.race([
      readyPromise,
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(
          () => rejectTimeout(new Error(`Timed out waiting ${READY_TIMEOUT_MS} ms for server READY`)),
          READY_TIMEOUT_MS,
        );
      }),
    ]);
    return {
      ...running,
      ready,
      mode,
      get protocolError() {
        return protocolError;
      },
    };
  } catch (error) {
    try {
      await terminateDemoServer({ ...running, mode });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Demo server READY failed and process cleanup also failed (mode=${mode})`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForProcessExit(running, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      running.exit,
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => rejectTimeout(new Error('Process did not terminate in time')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function confirmProcessExited(running, graceMs = 250) {
  if (running.child.exitCode !== null || running.child.signalCode !== null) return true;
  try {
    await waitForProcessExit(running, graceMs);
    return true;
  } catch {
    return false;
  }
}

async function terminateDemoServer(running) {
  if (running.child.exitCode !== null || running.child.signalCode !== null) {
    return running.exit;
  }

  if (
    process.platform === 'win32' &&
    shouldTerminateProcessTree(process.platform, running.mode)
  ) {
    const termination = await runCaptured('taskkill.exe', ['/PID', String(running.child.pid), '/T', '/F'], {
      timeoutMs: 15_000,
    });
    assertSuccessfulProcessTreeTermination(termination, running.child.pid, {
      processExited: await confirmProcessExited(running),
    });
  } else if (
    shouldTerminateProcessTree(process.platform, running.mode) &&
    running.child.pid !== undefined
  ) {
    try {
      process.kill(-running.child.pid, 'SIGTERM');
    } catch {
      running.child.kill('SIGTERM');
    }
  } else {
    running.child.kill('SIGTERM');
  }

  try {
    return await waitForProcessExit(running, 15_000);
  } catch {
    if (process.platform === 'win32' && running.child.pid !== undefined) {
      const termination = await runCaptured('taskkill.exe', ['/PID', String(running.child.pid), '/T', '/F'], {
        timeoutMs: 15_000,
      });
      assertSuccessfulProcessTreeTermination(termination, running.child.pid, {
        processExited: await confirmProcessExited(running),
      });
    } else {
      running.child.kill('SIGKILL');
    }
    return waitForProcessExit(running, 15_000);
  }
}

async function httpResponse(href, { timeoutMs = 3_000, host } = {}) {
  return new Promise((resolveStatus, rejectStatus) => {
    const request = http.get(
      href,
      {
        agent: false,
        ...(host === undefined ? {} : { headers: { Host: host } }),
      },
      (response) => {
      response.resume();
        response.once('end', () =>
          resolveStatus({ status: response.statusCode ?? 0, headers: response.headers }),
        );
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error('HTTP request timed out')));
    request.once('error', rejectStatus);
  });
}

async function assertUrlReachable(href) {
  const response = await httpResponse(href);
  invariant(response.status === 200, `Demo URL ${href} returned HTTP ${response.status}, expected 200`);
  invariant(
    response.headers['cross-origin-opener-policy'] === 'same-origin',
    'Demo root omitted Cross-Origin-Opener-Policy',
  );
  invariant(
    response.headers['cross-origin-embedder-policy'] === 'require-corp',
    'Demo root omitted Cross-Origin-Embedder-Policy',
  );
}

async function assertWrongHostRejected(ready) {
  const response = await httpResponse(ready.href, {
    host: `localhost:${ready.port}`,
  });
  invariant(response.status === 421, `Wrong Host header returned HTTP ${response.status}, expected 421`);
}

async function assertUrlUnreachable(href, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await httpResponse(href, { timeoutMs: 1_000 });
    } catch {
      return;
    }
    await delay(100);
  }
  throw new Error(`Demo URL remained reachable after launcher termination: ${href}`);
}

async function closeServer(server) {
  if (server === null) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function occupyDefaultPort() {
  const holder = net.createServer();
  holder.unref();
  const outcome = await new Promise((resolveListen, rejectListen) => {
    holder.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolveListen({ server: null, occupation: 'preexisting' });
      } else {
        rejectListen(error);
      }
    });
    holder.listen({ host: '127.0.0.1', port: 8765, exclusive: true }, () => {
      resolveListen({ server: holder, occupation: 'acceptance-holder' });
    });
  });
  return outcome;
}

async function ensureParityReferences(repositoryRoot, python) {
  const result = await runCaptured(
    python.command,
    [
      ...python.prefix,
      path.join(repositoryRoot, 'web_demo', 'tools', 'generate_parity_references.py'),
      '--repository-root',
      repositoryRoot,
      '--output',
      PARITY_DIRECTORY.replaceAll(path.sep, '/'),
    ],
    { cwd: repositoryRoot, timeoutMs: 600_000 },
  );
  invariant(
    result.code === 0,
    `Parity reference generation failed (code ${String(result.code)}):\n${result.stdout}${result.stderr}`,
  );
}

function containedPath(container, relativePath, label) {
  validateTrackedPath(relativePath.replaceAll(path.sep, '/'));
  const resolvedContainer = path.resolve(container);
  const candidate = path.resolve(resolvedContainer, ...relativePath.replaceAll('\\', '/').split('/'));
  const relative = path.relative(resolvedContainer, candidate);
  invariant(relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative), `${label} escapes its container`);
  return candidate;
}

async function loadParityReferences(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, PARITY_MANIFEST);
  const parsed = parseParityManifestBytes(await readFile(manifestPath));
  const { manifest } = parsed;
  const parityRoot = path.dirname(manifestPath);
  for (const row of manifest.images) {
    const referencePath = containedPath(parityRoot, row.reference, `parity reference ${row.reference}`);
    const information = await lstat(referencePath);
    invariant(information.isFile() && !information.isSymbolicLink(), `parity reference must be a regular file: ${row.reference}`);
    invariant(information.size === row.tensor.bytes, `parity reference byte count mismatch: ${row.reference}`);
    invariant(await sha256File(referencePath) === row.tensor.sha256, `parity reference SHA-256 mismatch: ${row.reference}`);
    const sourcePath = containedPath(repositoryRoot, row.source, `parity source ${row.source}`);
    invariant((await stat(sourcePath)).isFile(), `parity source is missing: ${row.source}`);
  }
  return parsed;
}

async function loadDemoPredictions(repositoryRoot) {
  const value = JSON.parse(
    await readFile(path.join(repositoryRoot, 'results', 'demo_predictions_cpu.json'), 'utf8'),
  );
  return parseDemoPredictions(value);
}

function networkAudit() {
  return {
    origins: new Set(),
    webSocketOrigins: new Set(),
    paths: new Map(),
    violations: [],
    pageErrors: [],
    consoleMessages: [],
  };
}

export async function installNetworkBoundary(context, allowedOrigin, audit) {
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    const inspection = inspectRequestUrl(requestUrl, allowedOrigin);
    if (inspection.kind === 'allowed-network') {
      const parsed = new URL(requestUrl);
      audit.origins.add(parsed.origin);
      const key = `${parsed.pathname}${parsed.search}`;
      audit.paths.set(key, (audit.paths.get(key) ?? 0) + 1);
      await route.continue();
      return;
    }
    if (inspection.kind === 'blocked-network') {
      audit.violations.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await context.routeWebSocket('**/*', async (webSocketRoute) => {
    const requestUrl = webSocketRoute.url();
    const inspection = inspectWebSocketUrl(requestUrl, allowedOrigin);
    if (inspection.kind === 'allowed-network') {
      audit.webSocketOrigins.add(inspection.origin);
      webSocketRoute.connectToServer();
      return;
    }
    audit.violations.push(requestUrl);
    await webSocketRoute.close({
      code: 1008,
      reason: 'Blocked by browser acceptance network boundary',
    });
  });
}

export async function closeAndSnapshotNetworkAudit(
  context,
  audit,
  allowedOrigin,
  resourceUrls,
) {
  invariant(Array.isArray(resourceUrls), 'resource URL evidence must be an array');
  await context.close();
  for (const resourceUrl of resourceUrls) {
    const inspection = inspectRequestUrl(resourceUrl, allowedOrigin);
    if (inspection.kind === 'blocked-network') audit.violations.push(resourceUrl);
  }
  invariant(
    audit.violations.length === 0,
    `Remote or wrong-origin requests observed: ${audit.violations.join(', ')}`,
  );
  invariant(
    audit.pageErrors.length === 0,
    `Browser page errors observed: ${audit.pageErrors.join('; ')}`,
  );
  invariant(
    audit.origins.size === 1 && audit.origins.has(allowedOrigin),
    'Request origin audit must contain only the selected server',
  );
  return {
    requestOrigins: [...audit.origins].sort(),
    webSocketOrigins: [...audit.webSocketOrigins].sort(),
    requestPaths: Object.fromEntries(
      [...audit.paths.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    consoleMessages: [...audit.consoleMessages],
  };
}

async function currentPhase(page) {
  const phase = await page.locator('.detector-stage').getAttribute('data-phase');
  return phase === null ? '' : `Current phase: ${phase}`;
}

async function alertText(page) {
  const locator = page.locator('[role="alert"]');
  if ((await locator.count()) === 0) return '';
  return (await locator.first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';
}

async function waitForPhaseOutcome(page, desired, timeoutMs) {
  await page.waitForFunction(
    ({ desiredPhase }) => {
      const phase = document.querySelector('.detector-stage')?.getAttribute('data-phase');
      return phase === desiredPhase || phase === 'error';
    },
    { desiredPhase: desired },
    { timeout: timeoutMs },
  );
  const phase = await currentPhase(page);
  if (phase === 'Current phase: error' && desired !== 'error') {
    throw new Error(`Browser detector entered error while waiting for ${desired}: ${await alertText(page)}`);
  }
  invariant(phase === `Current phase: ${desired}`, `Expected phase ${desired}, observed ${phase}`);
}

async function waitForModelReady(page) {
  await waitForPhaseOutcome(page, 'ready', MODEL_TIMEOUT_MS);
  await page.locator('input[type="file"]:not([disabled])').waitFor({ state: 'attached' });
}

async function probeWebGpu(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) {
      return { apiAvailable: false, adapterAvailable: false, adapterInfo: null };
    }
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { apiAvailable: true, adapterAvailable: false, adapterInfo: null };
      const info = adapter.info;
      return {
        apiAvailable: true,
        adapterAvailable: true,
        adapterInfo: {
          vendor: info?.vendor ?? '',
          architecture: info?.architecture ?? '',
          device: info?.device ?? '',
          description: info?.description ?? '',
        },
      };
    } catch (error) {
      return {
        apiAvailable: true,
        adapterAvailable: false,
        adapterInfo: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function definitionValue(page, term) {
  const dt = page.getByText(term, { exact: true });
  invariant(await dt.count() === 1, `Expected one result detail term ${term}`);
  return (await dt.locator('xpath=following-sibling::dd[1]').textContent())?.trim() ?? '';
}

function parseDimensions(text) {
  const match = /^Original (\d+) × (\d+) · Oriented (\d+) × (\d+)$/.exec(text);
  invariant(match !== null, `Could not parse preview dimensions: ${JSON.stringify(text)}`);
  return {
    original: { width: Number(match[1]), height: Number(match[2]) },
    oriented: { width: Number(match[3]), height: Number(match[4]) },
  };
}

async function readDetectionResult(page) {
  const progress = page.locator('#confidence-progress');
  invariant(await progress.count() === 1, 'Success state must expose one confidence progress element');
  const probability = await progress.evaluate((element) => element.value);
  finiteProbability(probability, 'browser probability');
  const label = (await page.locator('.decision-word').textContent())?.trim() ?? '';
  const provider = await definitionValue(page, 'Provider');
  const elapsedText = await definitionValue(page, 'Inference elapsed');
  const elapsedMs = Number.parseFloat(elapsedText);
  invariant(Number.isFinite(elapsedMs) && elapsedMs >= 0, `Invalid inference elapsed value: ${elapsedText}`);
  const dimensions = parseDimensions(
    (await page.locator('.dimension-line').textContent())?.replace(/\s+/g, ' ').trim() ?? '',
  );
  const preview = await page.locator('.preview-figure img').evaluate((image) => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    source: image.currentSrc,
  }));
  invariant(preview.complete && preview.naturalWidth > 0 && preview.source.startsWith('blob:'), 'Validated preview did not load from browser memory');
  return { probability, label, provider, elapsedMs, dimensions };
}

async function resetAndAssert(page, controlName = RESULT_RETURN_CONTROL_NAME) {
  await page.getByRole('button', { name: controlName }).click();
  await waitForPhaseOutcome(page, 'ready', 10_000);
  invariant(await page.locator('.preview-figure').count() === 0, 'Reset must clear the preview');
  invariant(await page.locator('#confidence-progress').count() === 0, 'Reset must clear the result');
  invariant(await page.locator('input[type="file"]').isEnabled(), 'Reset must re-enable image selection');
}

async function runInvalidAndOversizedChecks(page) {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('this is not an image', 'utf8'),
  });
  await waitForPhaseOutcome(page, 'error', 10_000);
  invariant((await alertText(page)).includes('Choose a valid JPEG, PNG, or WebP image.'), 'Invalid-image error was not actionable');
  invariant(await page.locator('.preview-figure').count() === 0, 'Invalid image must not retain a preview');
  await resetAndAssert(page, ERROR_RESET_CONTROL_NAME);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'lingshu-oversize-'));
  const oversizedPath = path.join(temporaryDirectory, 'oversized.png');
  try {
    const handle = await open(oversizedPath, 'w');
    try {
      await handle.truncate(MAX_IMAGE_BYTES + 1);
    } finally {
      await handle.close();
    }
    await input.setInputFiles(oversizedPath);
    await waitForPhaseOutcome(page, 'error', 10_000);
    invariant((await alertText(page)).includes('exceeds the 25 MiB limit'), 'Oversized-image error was not actionable');
    invariant(await page.locator('.preview-figure').count() === 0, 'Oversized image must not retain a preview');
    await resetAndAssert(page, ERROR_RESET_CONTROL_NAME);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function sourceReference(row, demoPredictions) {
  if (demoPredictions.has(row.source)) {
    return { kind: 'demo_predictions_cpu', probability: demoPredictions.get(row.source) };
  }
  return { kind: 'pillow_fp32_onnx', probability: row.probability };
}

async function runProviderSuite({
  browser,
  server,
  targetRepositoryRoot,
  parity,
  demoPredictions,
  providerMode,
  workflowChecks,
}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const audit = networkAudit();
  await installNetworkBoundary(context, server.ready.origin, audit);
  if (providerMode === 'fallback') {
    await context.addInitScript(() => {
      const descriptor = { configurable: true, get: () => undefined };
      for (const target of [Object.getPrototypeOf(navigator), navigator]) {
        try {
          Object.defineProperty(target, 'gpu', descriptor);
        } catch {
          // The post-load capability probe below is the authoritative gate.
        }
      }
    });
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => audit.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      audit.consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });

  const pageUrl = new URL(server.ready.href);
  if (providerMode === 'wasm') pageUrl.searchParams.set('provider', 'wasm');
  const results = [];
  let resourceUrls = [];
  let suiteCore;
  let operationError;
  try {
    progress(`${providerMode}: opening ${pageUrl.href}`);
    const response = await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    invariant(response !== null && response.status() === 200, `Demo navigation failed at ${pageUrl.href}`);
    await waitForModelReady(page);
    progress(`${providerMode}: model ready`);
    invariant(await page.evaluate(() => window.crossOriginIsolated), 'Built demo must be cross-origin isolated');
    const gpu = await probeWebGpu(page);
    if (providerMode === 'fallback') {
      invariant(
        gpu.apiAvailable === false && gpu.adapterAvailable === false,
        'Acceptance harness could not make WebGPU unavailable before the app script',
      );
    }
    const expectedProvider = providerMode === 'wasm' || providerMode === 'fallback'
      ? 'WASM'
      : gpu.adapterAvailable
        ? 'WebGPU'
        : 'WASM';
    const fallbackNoteLocator = page.locator('.fallback-note');
    if (
      providerMode === 'fallback' ||
      (providerMode === 'normal' && expectedProvider === 'WASM')
    ) {
      await fallbackNoteLocator.first().waitFor({ state: 'visible' });
    }
    const fallbackNote = (await fallbackNoteLocator.count()) === 0
      ? null
      : (await fallbackNoteLocator.first().textContent())?.replace(/\s+/g, ' ').trim() ?? null;
    const fallbackNoteVisible =
      fallbackNote !== null && (await fallbackNoteLocator.first().isVisible());
    if (providerMode === 'fallback') {
      invariant(
        fallbackNote?.startsWith('Compatibility note:') === true &&
          fallbackNote.includes('same FP32 model is running with WASM'),
        'Automatic WebGPU fallback did not expose its nonblocking compatibility note',
      );
    }
    const input = page.locator('input[type="file"]');
    invariant(await input.count() === 1, 'Demo must expose exactly one file input');

    for (const [index, row] of parity.images.entries()) {
      const imagePath = containedPath(targetRepositoryRoot, row.source, `browser input ${row.source}`);
      await input.setInputFiles(imagePath);
      await waitForPhaseOutcome(page, 'success', INFERENCE_TIMEOUT_MS);
      const actual = await readDetectionResult(page);
      const reference = sourceReference(row, demoPredictions);
      const comparison = compareProbability(reference.probability, actual.probability, parity.threshold);
      invariant(actual.provider === expectedProvider, `${row.source}: expected ${expectedProvider}, observed ${actual.provider}`);
      invariant(comparison.withinTolerance, `${row.source}: probability error ${comparison.absoluteError} exceeds ${MAX_PROBABILITY_ERROR}`);
      invariant(!comparison.thresholdFlip, `${row.source}: browser probability flips the frozen decision threshold`);
      invariant(actual.label === comparison.actualLabel, `${row.source}: UI label disagrees with browser probability`);
      invariant(actual.label === comparison.expectedLabel, `${row.source}: UI label disagrees with frozen reference`);
      invariant(
        sameDimensions(actual.dimensions.original, row.original_dimensions),
        `${row.source}: original dimensions disagree with Pillow reference`,
      );
      invariant(
        sameDimensions(actual.dimensions.oriented, row.oriented_dimensions),
        `${row.source}: oriented dimensions disagree with Pillow reference`,
      );
      results.push({
        source: row.source,
        reference: reference.kind,
        referenceProbability: reference.probability,
        probability: actual.probability,
        absoluteError: comparison.absoluteError,
        label: actual.label,
        provider: actual.provider,
        elapsedMs: actual.elapsedMs,
        thresholdFlip: comparison.thresholdFlip,
      });
      progress(
        `${providerMode}: ${index + 1}/${parity.images.length} ${row.source} ` +
          `p=${actual.probability.toFixed(6)} error=${comparison.absoluteError.toFixed(6)}`,
      );
      await resetAndAssert(page);
    }

    if (workflowChecks) {
      await runInvalidAndOversizedChecks(page);
    }

    resourceUrls = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name),
    );
    suiteCore = {
      mode: providerMode,
      expectedProvider,
      gpu,
      webGpuDisabledByHarness: providerMode === 'fallback',
      fallbackNote,
      fallbackNoteVisible,
      crossOriginIsolated: true,
      images: results,
      maxAbsoluteError: Math.max(...results.map(({ absoluteError }) => absoluteError)),
      thresholdFlips: results.filter(({ thresholdFlip }) => thresholdFlip).length,
      workflowChecks,
    };
  } catch (error) {
    operationError = error;
  }

  let networkEvidence;
  try {
    networkEvidence = await closeAndSnapshotNetworkAudit(
      context,
      audit,
      server.ready.origin,
      resourceUrls,
    );
  } catch (auditError) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, auditError],
        `${providerMode} browser workflow and post-close network audit both failed`,
      );
    }
    throw auditError;
  }
  if (operationError !== undefined) throw operationError;
  invariant(suiteCore !== undefined, `${providerMode} provider suite produced no evidence`);
  return { ...suiteCore, ...networkEvidence };
}

async function runBothProviders(browser, server, targetRepositoryRoot, parity, demoPredictions) {
  const normal = await runProviderSuite({
    browser,
    server,
    targetRepositoryRoot,
    parity,
    demoPredictions,
    providerMode: 'normal',
    workflowChecks: false,
  });
  const fallback = await runProviderSuite({
    browser,
    server,
    targetRepositoryRoot,
    parity,
    demoPredictions,
    providerMode: 'fallback',
    workflowChecks: false,
  });
  const wasm = await runProviderSuite({
    browser,
    server,
    targetRepositoryRoot,
    parity,
    demoPredictions,
    providerMode: 'wasm',
    workflowChecks: true,
  });
  invariant(
    normal.images.length === 15 && fallback.images.length === 15 && wasm.images.length === 15,
    'Each provider scenario must process all 15 images',
  );
  invariant(fallback.expectedProvider === 'WASM', 'Automatic no-WebGPU scenario did not fall back to WASM');
  invariant(wasm.expectedProvider === 'WASM', 'Forced WASM mode did not require WASM');
  const nearThreshold = 'web_demo/tests/fixtures/near-threshold-synthetic.png';
  for (const suite of [normal, fallback, wasm]) {
    const row = suite.images.find(({ source }) => source === nearThreshold);
    invariant(row !== undefined && !row.thresholdFlip, `${suite.mode}: near-threshold fixture changed decision`);
  }
  return { normal, fallback, wasm };
}

async function copyRuntimeSkeleton(repositoryRoot, label) {
  const base = await mkdtemp(path.join(os.tmpdir(), `lingshu-${label}-`));
  const root = path.join(base, 'repository');
  await mkdir(path.join(root, 'web_demo', 'tools'), { recursive: true });
  await copyFile(
    path.join(repositoryRoot, 'web_demo', 'tools', 'serve_demo.py'),
    path.join(root, 'web_demo', 'tools', 'serve_demo.py'),
  );
  await copyFile(
    path.join(repositoryRoot, 'web_demo', 'tools', 'verify_distribution.py'),
    path.join(root, 'web_demo', 'tools', 'verify_distribution.py'),
  );
  await cp(path.join(repositoryRoot, 'web_demo', 'dist'), path.join(root, 'web_demo', 'dist'), {
    recursive: true,
    errorOnExist: true,
  });
  await cp(path.join(repositoryRoot, 'web_demo', 'models'), path.join(root, 'web_demo', 'models'), {
    recursive: true,
    errorOnExist: true,
  });
  return { base, root };
}

async function runExpectedStartupFailure(repositoryRoot, python, mutate, expectedPattern, label) {
  const temporary = await copyRuntimeSkeleton(repositoryRoot, label);
  try {
    await mutate(temporary.root);
    const result = await runCaptured(
      python.command,
      [
        ...python.prefix,
        path.join(temporary.root, 'web_demo', 'tools', 'serve_demo.py'),
        '--no-browser',
      ],
      { cwd: temporary.root, timeoutMs: 120_000 },
    );
    const output = `${result.stdout}${result.stderr}`;
    invariant(result.code !== 0, `${label} disposable server unexpectedly exited zero`);
    invariant(!output.includes('READY '), `${label} disposable server announced READY`);
    invariant(expectedPattern.test(output), `${label} diagnostic was not actionable:\n${output}`);
    return { exitCode: result.code, diagnostic: output.replace(/\s+/g, ' ').trim().slice(0, 1_000) };
  } finally {
    await rm(temporary.base, { recursive: true, force: true });
  }
}

async function runArtifactFailureChecks(repositoryRoot, python) {
  const corruptModel = await runExpectedStartupFailure(
    repositoryRoot,
    python,
    async (root) => {
      const modelPath = path.join(root, 'web_demo', 'models', 'baseline2_njr_fp32.onnx');
      const handle = await open(modelPath, 'r+');
      try {
        const buffer = Buffer.alloc(1);
        await handle.read(buffer, 0, 1, 0);
        buffer[0] ^= 0xff;
        await handle.write(buffer, 0, 1, 0);
      } finally {
        await handle.close();
      }
    },
    /model SHA-256 mismatch/i,
    'corrupt-model',
  );
  const missingWasm = await runExpectedStartupFailure(
    repositoryRoot,
    python,
    async (root) => {
      await rm(path.join(root, ORT_RUNTIME_RELATIVE));
    },
    /ORT runtime .*missing|ORT runtime .*not a regular file/i,
    'missing-wasm',
  );
  return { corruptModel, missingWasm };
}

async function gitTrackedFiles(repositoryRoot) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  invariant(result.status === 0, `git ls-files failed: ${result.stderr?.toString('utf8') ?? ''}`);
  return parseTrackedFiles(result.stdout).filter((relativePath) => !shouldExcludeTrackedPath(relativePath));
}

async function createTrackedFreshCopy(repositoryRoot, sourceCommit) {
  invariant(
    typeof sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(sourceCommit),
    'fresh-copy source commit must be a full Git SHA-1',
  );
  const base = await mkdtemp(path.join(os.tmpdir(), 'lingshu-fresh-copy-'));
  const copyRoot = path.join(base, FRESH_COPY_NAME);
  await mkdir(copyRoot);
  const files = await gitTrackedFiles(repositoryRoot);
  try {
    for (const relativePath of files) {
      const components = validateTrackedPath(relativePath);
      const source = path.resolve(repositoryRoot, ...components);
      const destination = path.resolve(copyRoot, ...components);
      const sourceRelative = path.relative(path.resolve(repositoryRoot), source);
      const destinationRelative = path.relative(path.resolve(copyRoot), destination);
      invariant(!sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative), `tracked source escapes repository: ${relativePath}`);
      invariant(!destinationRelative.startsWith('..') && !path.isAbsolute(destinationRelative), `tracked destination escapes copy: ${relativePath}`);
      const information = await lstat(source);
      invariant(information.isFile() && !information.isSymbolicLink(), `tracked entry must be a regular file: ${relativePath}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      if (process.platform !== 'win32') {
        await chmod(destination, information.mode & 0o777);
      }
    }
    for (const forbidden of ['.git', '.venv', 'node_modules', 'web_models']) {
      try {
        await access(path.join(copyRoot, forbidden));
        throw new Error(`Fresh copy contains forbidden path: ${forbidden}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const required of [
      'web_demo/start-demo.bat',
      'web_demo/dist/index.html',
      'web_demo/models/baseline2_njr_fp32.onnx',
    ]) {
      invariant((await stat(containedPath(copyRoot, required, required))).isFile(), `Fresh copy is missing ${required}`);
    }
    return {
      base,
      root: copyRoot,
      fileCount: files.length,
      sourceCommit,
      validated: false,
    };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function deleteValidatedFreshCopy(fresh) {
  invariant(fresh.validated === true, 'Refusing to delete an unvalidated fresh copy');
  const resolvedBase = await realpath(fresh.base);
  const resolvedRoot = await realpath(fresh.root);
  invariant(path.basename(resolvedRoot) === FRESH_COPY_NAME, 'Fresh-copy deletion target has the wrong name');
  invariant(path.dirname(resolvedRoot) === resolvedBase, 'Fresh-copy deletion target escaped its mkdtemp base');
  await rm(resolvedRoot, { recursive: true, force: false });
  await rmdir(resolvedBase);
}

async function runBatchCheck(repositoryRoot) {
  invariant(process.platform === 'win32', 'The formal Unicode BAT acceptance requires Windows');
  const launcher = path.join(repositoryRoot, 'web_demo', 'start-demo.bat');
  const invocation = buildBatchInvocation(launcher, ['--check']);
  const result = await runCaptured(
    process.env.ComSpec ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
    invocation.commandArguments,
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...invocation.environment },
      detached: invocation.detached,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      timeoutMs: 120_000,
      killTreeOnTimeout: true,
    },
  );
  const output = `${result.stdout}${result.stderr}`;
  invariant(result.code === 0, `Fresh-copy BAT --check failed:\n${output}`);
  invariant(
    output.includes(DISTRIBUTION_VERIFIED_LINE),
    'Fresh-copy BAT --check omitted verification success',
  );
  invariant(!output.includes('READY '), 'Fresh-copy BAT --check must not start a server');
  return { exitCode: result.code, output: output.replace(/\s+/g, ' ').trim() };
}

function captureTrackedGitState(repositoryRoot) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  invariant(head.status === 0, `git rev-parse HEAD failed: ${head.stderr}`);
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: PROCESS_OUTPUT_LIMIT,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  invariant(status.status === 0, `git tracked-state inspection failed: ${status.stderr}`);
  return { head: head.stdout.trim(), porcelain: status.stdout };
}

export function assertSameCleanTrackedGitState(initial, current) {
  invariant(isRecord(initial), 'initial Git state must be an object');
  invariant(isRecord(current), 'current Git state must be an object');
  invariant(
    typeof initial.head === 'string' && /^[0-9a-f]{40}$/.test(initial.head),
    'initial Git HEAD must be a full SHA-1',
  );
  invariant(
    typeof current.head === 'string' && /^[0-9a-f]{40}$/.test(current.head),
    'current Git HEAD must be a full SHA-1',
  );
  invariant(initial.porcelain === '', 'Tracked index/worktree must be clean at acceptance start');
  invariant(current.porcelain === '', 'Tracked index/worktree must remain clean before the report');
  invariant(current.head === initial.head, 'Git HEAD changed during browser acceptance');
  return initial.head;
}

async function writeAtomicJson(destination, value) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);
}

async function main() {
  const repositoryRoot = DEFAULT_REPOSITORY_ROOT;
  progress(`repository ${repositoryRoot}`);
  const initialGitState = captureTrackedGitState(repositoryRoot);
  const testedCommit = assertSameCleanTrackedGitState(initialGitState, initialGitState);
  progress(`testing clean commit ${testedCommit}`);
  const python = await discoverPython(repositoryRoot);
  const edgeExecutable = await discoverEdge();
  progress(`Python ${python.version}; Edge ${edgeExecutable}`);
  await ensureParityReferences(repositoryRoot, python);
  const parityInput = await loadParityReferences(repositoryRoot);
  const parity = parityInput.manifest;
  const demoPredictions = await loadDemoPredictions(repositoryRoot);
  progress('15 parity references and 10 frozen demo predictions verified');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    executablePath: edgeExecutable,
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--no-first-run',
    ],
  });

  let sourceServer;
  let holder;
  let fresh;
  let freshServer;
  let sourceReady;
  let freshReady;
  let validatedReport;
  let executionError;
  try {
    holder = await occupyDefaultPort();
    sourceServer = await startDemoServer(repositoryRoot, python, 'direct');
    sourceReady = sourceServer.ready;
    progress(`source server ready at ${sourceReady.href}`);
    invariant(sourceServer.ready.port !== 8765, 'Occupied 8765 did not force a fallback loopback port');
    await closeServer(holder.server);
    holder = { ...holder, server: null };
    await assertUrlReachable(sourceServer.ready.href);
    await assertWrongHostRejected(sourceServer.ready);
    const sourceProviders = await runBothProviders(
      browser,
      sourceServer,
      repositoryRoot,
      parity,
      demoPredictions,
    );
    invariant(sourceServer.protocolError === undefined, `Source server protocol failed: ${sourceServer.protocolError}`);
    await terminateDemoServer(sourceServer);
    await assertUrlUnreachable(sourceServer.ready.href);
    sourceServer = undefined;

    progress('source server terminated; running disposable artifact-failure checks');
    const artifactFailures = await runArtifactFailureChecks(repositoryRoot, python);

    fresh = await createTrackedFreshCopy(repositoryRoot, testedCommit);
    progress(`fresh tracked copy created at ${fresh.root}`);
    const batchCheck = await runBatchCheck(fresh.root);
    progress('fresh-copy BAT --check passed');
    freshServer = await startDemoServer(fresh.root, python, 'launcher');
    freshReady = freshServer.ready;
    progress(`fresh-copy launcher ready at ${freshReady.href}`);
    await assertUrlReachable(freshServer.ready.href);
    await assertWrongHostRejected(freshServer.ready);
    const freshProviders = await runBothProviders(
      browser,
      freshServer,
      fresh.root,
      parity,
      demoPredictions,
    );
    invariant(freshServer.protocolError === undefined, `Fresh server protocol failed: ${freshServer.protocolError}`);
    await terminateDemoServer(freshServer);
    await assertUrlUnreachable(freshServer.ready.href);
    freshServer = undefined;
    progress('fresh-copy launcher terminated; validating acceptance evidence');

    const report = {
      schemaVersion: 1,
      passed: true,
      generatedAt: new Date().toISOString(),
      commit: testedCommit,
      parityManifest: {
        path: PARITY_MANIFEST_REPORT_PATH,
        sha256: parityInput.sha256,
      },
      platform: { platform: process.platform, release: os.release(), arch: os.arch() },
      runtime: {
        node: process.version,
        python: python.version,
        edge: await browser.version(),
        edgeExecutable,
      },
      model: { bytes: MODEL_BYTES, sha256: MODEL_SHA256 },
      threshold: FROZEN_THRESHOLD,
      gates: { maxProbabilityError: MAX_PROBABILITY_ERROR, imagesPerProvider: 15 },
      portFallback: {
        occupiedPort: 8765,
        occupation: holder.occupation,
        selectedPort: sourceReady.port,
        passed: true,
      },
      source: {
        serverUrl: sourceReady.href,
        providers: sourceProviders,
        terminationUnreachable: true,
      },
      artifactFailures,
      freshCopy: {
        directoryName: FRESH_COPY_NAME,
        sourceCommit: fresh.sourceCommit,
        trackedFileCount: fresh.fileCount,
        excluded: ['.git', 'node_modules', '.venv', 'web_models'],
        npmInstallRun: false,
        batchCheck,
        serverUrl: freshReady.href,
        providers: freshProviders,
        terminationUnreachable: true,
      },
    };
    validatedReport = validateAcceptanceReport(report);
    fresh.validated = true;
    await deleteValidatedFreshCopy(fresh);
    fresh = undefined;
  } catch (error) {
    executionError = error;
    if (fresh !== undefined) {
      process.stderr.write(`Fresh copy preserved for diagnosis: ${fresh.root}\n`);
    }
  }
  await runCleanupActions(
    [
      {
        label: 'occupied port holder',
        action: () => closeServer(holder?.server ?? null),
      },
      {
        label: 'source demo server',
        action: () =>
          sourceServer === undefined ? Promise.resolve() : terminateDemoServer(sourceServer),
      },
      {
        label: 'fresh-copy demo server',
        action: () =>
          freshServer === undefined ? Promise.resolve() : terminateDemoServer(freshServer),
      },
      { label: 'Microsoft Edge browser', action: () => browser.close() },
    ],
    executionError,
  );
  invariant(validatedReport !== undefined, 'Acceptance completed without validated report evidence');
  assertSameCleanTrackedGitState(initialGitState, captureTrackedGitState(repositoryRoot));
  await writeAtomicJson(
    path.join(
      repositoryRoot,
      'web_demo',
      '.generated-tests',
      'browser-acceptance',
      'latest.json',
    ),
    validatedReport,
  );
  progress('acceptance passed and validated disposable copy was removed');
  process.stdout.write(`${JSON.stringify(validatedReport, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const diagnostics = error instanceof AggregateError
      ? [error.stack ?? error.message, ...error.errors.map((nested, index) => {
          const detail = nested instanceof Error ? nested.stack ?? nested.message : String(nested);
          return `Nested error ${index + 1}: ${detail}`;
        })].join('\n')
      : error instanceof Error
        ? error.stack ?? error.message
        : String(error);
    process.stderr.write(`${diagnostics}\n`);
    process.exitCode = 1;
  });
}
