#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXPECTED_MODEL_BYTES = 88_123_029;
export const EXPECTED_MODEL_SHA256 =
  'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69';
export const EXPECTED_MODEL_PATH = '/models/baseline2_njr_fp32.onnx';
export const FROZEN_THRESHOLD = 0.55657113;
export const MAX_PROBABILITY_ERROR = 0.01;

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': EXPECTED_CSP,
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
const DEMO_SOURCES = Object.freeze([
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
]);
const ALLOWED_HEADER_KINDS = new Set(['root', 'manifest', 'model', 'ort-mjs', 'ort-wasm']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|secret|token)/i;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const MAX_ARRAY_LENGTH = 128;
const MAX_STRING_LENGTH = 2_000;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const MODEL_TIMEOUT_MS = 240_000;
const INFERENCE_TIMEOUT_MS = 180_000;
const HTTP_TIMEOUT_MS = 240_000;
const ORT_MJS_PATH = '/assets/ort-wasm-simd-threaded.asyncify.mjs';
const ORT_WASM_PATH = '/assets/ort-wasm-simd-threaded.asyncify.wasm';
const RECORDED_HEADER_NAMES = Object.freeze([
  'content-security-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
  'cache-control',
  'vercel-cdn-cache-control',
  'content-type',
  'content-length',
  'etag',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  invariant(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
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

function nonNegativeInteger(value, label) {
  invariant(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
  return value;
}

function safePath(value, label) {
  invariant(typeof value === 'string' && value.startsWith('/'), `${label} must be a root-relative path`);
  invariant(!value.includes('?') && !value.includes('#'), `${label} must not contain a query or fragment`);
  invariant(!value.includes('..') && value.length <= 300, `${label} must be a bounded safe path`);
  return value;
}

export function parseOnlineUrl(value) {
  invariant(typeof value === 'string' && value.length > 0, 'Online deployment URL is required');
  invariant(value.trim() === value, 'Online deployment URL must not contain surrounding whitespace');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Online deployment URL must be a valid HTTPS URL');
  }
  invariant(parsed.protocol === 'https:', 'Online deployment URL must use HTTPS');
  invariant(parsed.username === '' && parsed.password === '', 'Online deployment URL must not contain credentials');
  invariant(parsed.search === '', 'Online deployment URL must not contain a query');
  invariant(parsed.hash === '', 'Online deployment URL must not contain a fragment');
  invariant(parsed.pathname === '/' || parsed.pathname === '', 'Online deployment URL must be a root URL');
  invariant(parsed.hostname.length > 0, 'Online deployment URL must contain a hostname');
  return `${parsed.origin}/`;
}

export function parseCliArguments(arguments_) {
  invariant(Array.isArray(arguments_), 'CLI arguments must be an array');
  invariant(arguments_.length === 1, 'Expected exactly one HTTPS Preview or Production root URL');
  return parseOnlineUrl(arguments_[0]);
}

export function classifyRequest(value, deploymentOrigin) {
  const deploymentUrl = new URL(parseOnlineUrl(deploymentOrigin));
  let requestUrl;
  try {
    requestUrl = new URL(value);
  } catch {
    return 'external';
  }
  if (requestUrl.origin !== deploymentUrl.origin) return 'external';
  return requestUrl.pathname === EXPECTED_MODEL_PATH ? 'model' : 'same-origin';
}

export function validateProgressSamples(samples) {
  invariant(Array.isArray(samples), 'Model progress evidence must be an array');
  invariant(samples.length >= 3 && samples.length <= MAX_ARRAY_LENGTH, 'Model progress evidence must contain 3 to 128 bounded samples');
  let previous = -1;
  let hasIntermediate = false;
  for (const [index, sample] of samples.entries()) {
    exactKeys(sample, ['loaded', 'total'], `model progress sample ${index}`);
    nonNegativeInteger(sample.loaded, `model progress sample ${index}.loaded`);
    invariant(sample.total === EXPECTED_MODEL_BYTES, `model progress sample ${index}.total must equal ${EXPECTED_MODEL_BYTES}`);
    invariant(sample.loaded <= sample.total, `model progress sample ${index}.loaded exceeds total`);
    invariant(sample.loaded >= previous, 'Model progress must be monotonic');
    if (sample.loaded > 0 && sample.loaded < sample.total) hasIntermediate = true;
    previous = sample.loaded;
  }
  invariant(samples[0].loaded === 0, 'Model progress must start at zero loaded bytes');
  invariant(samples.at(-1).loaded === EXPECTED_MODEL_BYTES, `Model progress terminal sample must equal ${EXPECTED_MODEL_BYTES}`);
  invariant(hasIntermediate, 'Model progress must contain a real intermediate byte sample');
  return samples;
}

export function compactProgressSamples(samples, maximum = MAX_ARRAY_LENGTH) {
  invariant(Array.isArray(samples) && samples.length > 0, 'Model progress samples are required');
  invariant(Number.isSafeInteger(maximum) && maximum >= 3 && maximum <= MAX_ARRAY_LENGTH, 'Progress sample bound must be an integer from 3 to 128');
  if (samples.length <= maximum) return validateProgressSamples(samples.map((sample) => ({ ...sample })));
  const compacted = [samples[0]];
  const interiorSlots = maximum - 2;
  for (let slot = 1; slot <= interiorSlots; slot += 1) {
    const index = Math.round((slot * (samples.length - 1)) / (interiorSlots + 1));
    if (index > 0 && index < samples.length - 1 && compacted.at(-1) !== samples[index]) {
      compacted.push(samples[index]);
    }
  }
  compacted.push(samples.at(-1));
  return validateProgressSamples(compacted.map((sample) => ({ ...sample })));
}

function lowerCaseHeaderRecord(headers) {
  invariant(isRecord(headers), 'Response headers must be an object');
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    invariant(typeof value === 'string' && value.length <= 2_000, `Response header ${key} must be a bounded string`);
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

export function validateResponseHeaders(headers, kind) {
  invariant(ALLOWED_HEADER_KINDS.has(kind), `Unsupported response header kind ${String(kind)}`);
  const normalized = lowerCaseHeaderRecord(headers);
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    invariant(normalized[name] === expected, `${kind} ${name} must equal ${expected}`);
  }
  const mutable = kind === 'root' || kind === 'manifest';
  const expectedCache = mutable
    ? 'public, max-age=0, must-revalidate'
    : 'public, max-age=31536000, immutable';
  invariant(normalized['cache-control'] === expectedCache, `${kind} cache-control must equal ${expectedCache}`);
  if (normalized['vercel-cdn-cache-control'] !== undefined) {
    invariant(normalized['vercel-cdn-cache-control'] === expectedCache, `${kind} Vercel-CDN-Cache-Control must equal ${expectedCache}`);
  }
  const contentType = normalized['content-type'] ?? '';
  if (kind === 'root') invariant(contentType.toLowerCase().startsWith('text/html'), 'root content-type must be text/html');
  if (kind === 'manifest') invariant(/^(application|text)\/json\b/i.test(contentType), 'manifest content-type must be JSON');
  if (kind === 'model') {
    invariant(/^application\/octet-stream\b/i.test(contentType), 'model content-type must be application/octet-stream');
    if (normalized['content-length'] !== undefined) {
      invariant(normalized['content-length'] === String(EXPECTED_MODEL_BYTES), `model content-length must equal ${EXPECTED_MODEL_BYTES}`);
    }
  }
  if (kind === 'ort-mjs') invariant(/^(application|text)\/javascript\b/i.test(contentType), 'ORT MJS content-type must be JavaScript');
  if (kind === 'ort-wasm') invariant(/^application\/wasm\b/i.test(contentType), 'ORT WASM content-type must be application/wasm');
  return normalized;
}

export function compareOnlinePrediction(reference, actual, threshold = FROZEN_THRESHOLD) {
  finiteProbability(reference, 'reference probability');
  finiteProbability(actual, 'browser probability');
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

function assertBoundedSafeValue(value, label = 'evidence', depth = 0) {
  invariant(depth <= 10, `${label} nesting is not bounded`);
  if (typeof value === 'string') {
    invariant(value.length <= MAX_STRING_LENGTH, `${label} string is not bounded`);
    const urlMatches = value.match(/https?:\/\/[^\s]+/gi) ?? [];
    for (const candidate of urlMatches) {
      let parsed;
      try {
        parsed = new URL(candidate.replace(/[),.;]+$/, ''));
      } catch {
        continue;
      }
      invariant(parsed.search === '' && parsed.hash === '', `${label} must not record URL query or fragment data`);
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    invariant(value.length <= MAX_ARRAY_LENGTH, `${label} array is not bounded`);
    value.forEach((entry, index) => assertBoundedSafeValue(entry, `${label}[${index}]`, depth + 1));
    return;
  }
  invariant(isRecord(value), `${label} contains an unsupported value`);
  for (const [key, entry] of Object.entries(value)) {
    invariant(!SENSITIVE_KEY_PATTERN.test(key), `${label} contains sensitive field ${key}`);
    assertBoundedSafeValue(entry, `${label}.${key}`, depth + 1);
  }
}

function validateHeaderEvidence(value) {
  exactKeys(value, ['resources'], 'headers evidence');
  invariant(Array.isArray(value.resources) && value.resources.length >= 5 && value.resources.length <= 20, 'headers.resources must contain 5 to 20 bounded checks');
  const byKind = new Map();
  for (const [index, resource] of value.resources.entries()) {
    exactKeys(resource, ['headers', 'kind', 'path', 'status'], `headers.resources[${index}]`);
    invariant(ALLOWED_HEADER_KINDS.has(resource.kind), `headers.resources[${index}].kind is invalid`);
    invariant(!byKind.has(resource.kind), `headers.resources contains duplicate ${resource.kind}`);
    safePath(resource.path, `headers.resources[${index}].path`);
    invariant(resource.status === 200, `${resource.kind} status must equal 200`);
    validateResponseHeaders(resource.headers, resource.kind);
    byKind.set(resource.kind, resource);
  }
  for (const kind of ALLOWED_HEADER_KINDS) invariant(byKind.has(kind), `headers.resources is missing ${kind}`);
  invariant(byKind.get('root').path === '/', 'root header path must equal /');
  invariant(byKind.get('manifest').path === '/models/manifest.json', 'manifest header path is invalid');
  invariant(byKind.get('model').path === EXPECTED_MODEL_PATH, 'model header path is invalid');
  invariant(byKind.get('ort-mjs').path.endsWith('.mjs'), 'ORT MJS header path is invalid');
  invariant(byKind.get('ort-wasm').path.endsWith('.wasm'), 'ORT WASM header path is invalid');
}

function validatePrediction(value, index, provider) {
  exactKeys(
    value,
    ['absoluteError', 'label', 'probability', 'provider', 'referenceProbability', 'source', 'thresholdFlip'],
    `${provider} prediction ${index}`,
  );
  invariant(value.source === DEMO_SOURCES[index], `${provider} prediction ${index} source order is invalid`);
  finiteProbability(value.referenceProbability, `${value.source} referenceProbability`);
  finiteProbability(value.probability, `${value.source} probability`);
  const comparison = compareOnlinePrediction(value.referenceProbability, value.probability);
  invariant(Math.abs(value.absoluteError - comparison.absoluteError) <= Number.EPSILON * 4, `${value.source} absoluteError is inconsistent`);
  invariant(value.label === comparison.actualLabel, `${value.source} label is inconsistent`);
  invariant(value.provider === provider, `${value.source} provider is inconsistent`);
  invariant(value.thresholdFlip === comparison.thresholdFlip, `${value.source} thresholdFlip is inconsistent`);
  invariant(comparison.withinTolerance, `${value.source} probability error exceeds ${MAX_PROBABILITY_ERROR}`);
  invariant(!comparison.thresholdFlip, `${value.source} prediction flips the frozen threshold`);
}

function validateProviderRuns(value) {
  invariant(Array.isArray(value) && value.length === 2, 'providerRuns must contain exactly WebGPU and WASM');
  const expected = ['webgpu', 'wasm'];
  value.forEach((run, index) => {
    exactKeys(run, ['crossOriginIsolated', 'mode', 'predictions', 'provider'], `providerRuns[${index}]`);
    invariant(run.mode === expected[index], `providerRuns[${index}].mode must be ${expected[index]}`);
    invariant(run.provider === expected[index], `providerRuns[${index}].provider must be ${expected[index]}`);
    invariant(run.crossOriginIsolated === true, `${run.mode} must be cross-origin isolated`);
    invariant(Array.isArray(run.predictions) && run.predictions.length === 10, `${run.mode} must contain exactly 10 predictions`);
    run.predictions.forEach((prediction, predictionIndex) => validatePrediction(prediction, predictionIndex, run.provider));
  });
}

function validatePrivacy(value) {
  exactKeys(value, ['disallowedMethods', 'externalOrigins', 'imageRequests', 'requestCount', 'requests'], 'privacy evidence');
  nonNegativeInteger(value.requestCount, 'privacy.requestCount');
  invariant(value.requestCount <= 1_000, 'privacy.requestCount must be bounded at 1000');
  invariant(Array.isArray(value.externalOrigins) && value.externalOrigins.length === 0, 'privacy external origins must be empty');
  invariant(Array.isArray(value.disallowedMethods) && value.disallowedMethods.length === 0, 'privacy disallowed methods must be empty');
  invariant(value.imageRequests === 0, 'privacy imageRequests must equal zero');
  invariant(Array.isArray(value.requests) && value.requests.length <= 100, 'privacy requests must be bounded at 100 entries');
  let counted = 0;
  for (const [index, request] of value.requests.entries()) {
    exactKeys(request, ['count', 'kind', 'method', 'path'], `privacy.requests[${index}]`);
    invariant(SAFE_METHODS.has(request.method), `privacy.requests[${index}] method is disallowed`);
    invariant(request.kind === 'same-origin' || request.kind === 'model', `privacy.requests[${index}] kind is invalid`);
    safePath(request.path, `privacy.requests[${index}].path`);
    invariant(Number.isSafeInteger(request.count) && request.count >= 1, `privacy.requests[${index}].count is invalid`);
    counted += request.count;
  }
  invariant(counted === value.requestCount, 'privacy.requestCount must equal the bounded request aggregate');
}

function validateCache(value) {
  exactKeys(value, ['interpretation', 'observations', 'reloadModelRequests'], 'cache evidence');
  nonNegativeInteger(value.reloadModelRequests, 'cache.reloadModelRequests');
  invariant(value.reloadModelRequests <= 2, 'cache.reloadModelRequests must be bounded');
  invariant(Array.isArray(value.observations) && value.observations.length >= 1 && value.observations.length <= 10, 'cache observations must contain 1 to 10 entries');
  for (const [index, observation] of value.observations.entries()) {
    exactKeys(observation, ['encodedBodySize', 'path', 'transferSize'], `cache.observations[${index}]`);
    invariant(observation.path === EXPECTED_MODEL_PATH, `cache.observations[${index}].path is invalid`);
    nonNegativeInteger(observation.transferSize, `cache.observations[${index}].transferSize`);
    nonNegativeInteger(observation.encodedBodySize, `cache.observations[${index}].encodedBodySize`);
  }
  invariant(typeof value.interpretation === 'string' && /no permanent-cache claim/i.test(value.interpretation), 'cache interpretation must avoid a permanent-cache claim');
}

export function validateOnlineEvidence(value) {
  assertBoundedSafeValue(value);
  invariant(Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_EVIDENCE_BYTES, 'Online evidence JSON is not bounded');
  exactKeys(
    value,
    [
      'browser',
      'cache',
      'console',
      'crossOriginIsolated',
      'deploymentUrl',
      'generatedAt',
      'headers',
      'model',
      'offline',
      'passed',
      'privacy',
      'providerRuns',
      'providers',
      'schema_version',
      'testedCommit',
      'thresholdFlips',
    ],
    'online evidence',
  );
  invariant(value.schema_version === 1, 'online evidence schema_version must equal 1');
  invariant(value.passed === true, 'online evidence must be passing');
  invariant(typeof value.generatedAt === 'string' && new Date(value.generatedAt).toISOString() === value.generatedAt, 'online evidence generatedAt must be an ISO timestamp');
  invariant(typeof value.testedCommit === 'string' && SHA1_PATTERN.test(value.testedCommit), 'testedCommit must be a 40-character lowercase hexadecimal commit');
  invariant(parseOnlineUrl(value.deploymentUrl) === value.deploymentUrl, 'deploymentUrl must be a normalized HTTPS root URL');
  exactKeys(value.browser, ['name', 'version'], 'browser evidence');
  invariant(value.browser.name === 'Microsoft Edge', 'browser must be Microsoft Edge');
  invariant(typeof value.browser.version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(value.browser.version), 'browser version is invalid');
  validateHeaderEvidence(value.headers);
  exactKeys(value.model, ['bytes', 'path', 'progress', 'sha256'], 'model evidence');
  invariant(value.model.path === EXPECTED_MODEL_PATH, 'model path is invalid');
  invariant(value.model.bytes === EXPECTED_MODEL_BYTES, `model bytes must equal ${EXPECTED_MODEL_BYTES}`);
  invariant(value.model.sha256 === EXPECTED_MODEL_SHA256, 'model SHA-256 is invalid');
  validateProgressSamples(value.model.progress);
  invariant(Array.isArray(value.providers) && value.providers.length === 2 && value.providers[0] === 'webgpu' && value.providers[1] === 'wasm', 'providers must be exactly webgpu and wasm');
  validateProviderRuns(value.providerRuns);
  invariant(value.crossOriginIsolated === true, 'crossOriginIsolated must be true');
  invariant(value.thresholdFlips === 0, 'thresholdFlips must equal zero');
  validatePrivacy(value.privacy);
  validateCache(value.cache);
  exactKeys(value.offline, ['completed', 'label', 'probability', 'provider', 'source'], 'offline evidence');
  invariant(value.offline.completed === true, 'offline inference must complete');
  invariant(DEMO_SOURCES.includes(value.offline.source), 'offline source must be a committed demo image');
  invariant(value.offline.provider === 'webgpu', 'offline inference must retain the WebGPU provider');
  finiteProbability(value.offline.probability, 'offline probability');
  invariant(value.offline.label === (value.offline.probability >= FROZEN_THRESHOLD ? 'AIGC' : 'Real'), 'offline label is inconsistent');
  exactKeys(value.console, ['errors', 'pageErrors', 'warnings'], 'console evidence');
  for (const name of ['errors', 'pageErrors', 'warnings']) {
    invariant(Array.isArray(value.console[name]) && value.console[name].length <= 20, `console.${name} must be a bounded array`);
    invariant(value.console[name].every((entry) => typeof entry === 'string' && entry.length <= 500), `console.${name} entries must be bounded strings`);
  }
  invariant(value.console.errors.length === 0 && value.console.pageErrors.length === 0, 'browser console/page errors must be empty');
  return value;
}

function reportProgress(message) {
  process.stderr.write(`[online-acceptance] ${message}\n`);
}

function captureGitState(repositoryRoot) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  invariant(head.status === 0, `git rev-parse HEAD failed: ${head.stderr}`);
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  invariant(status.status === 0, `git status failed: ${status.stderr}`);
  return { head: head.stdout.trim(), porcelain: status.stdout };
}

export function assertSameCleanGitState(initial, current) {
  exactKeys(initial, ['head', 'porcelain'], 'initial Git state');
  exactKeys(current, ['head', 'porcelain'], 'current Git state');
  invariant(SHA1_PATTERN.test(initial.head), 'initial Git HEAD must be a full commit hash');
  invariant(SHA1_PATTERN.test(current.head), 'current Git HEAD must be a full commit hash');
  invariant(initial.porcelain === '', 'Git tree must be clean before online acceptance');
  invariant(current.porcelain === '', 'Git tree must remain clean before candidate evidence is written');
  invariant(current.head === initial.head, 'Git HEAD changed during online acceptance');
  return initial.head;
}

function recordedHeaders(headers) {
  const result = {};
  for (const name of RECORDED_HEADER_NAMES) {
    const value = headers.get(name);
    if (value !== null) result[name] = value;
  }
  return result;
}

async function fetchChecked(url, fetchImplementation = globalThis.fetch) {
  invariant(typeof fetchImplementation === 'function', 'Fetch API is required for online acceptance');
  const response = await fetchImplementation(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  invariant(response.status === 200, `${url} returned HTTP ${response.status}`);
  invariant(response.url === url, `${url} did not remain at the requested same-origin URL`);
  return response;
}

async function readBoundedText(response, maximumBytes, label) {
  const body = await response.arrayBuffer();
  invariant(body.byteLength <= maximumBytes, `${label} response exceeded ${maximumBytes} bytes`);
  return Buffer.from(body).toString('utf8');
}

function resourceCheck(kind, pathname, response) {
  const headers = recordedHeaders(response.headers);
  validateResponseHeaders(headers, kind);
  return { kind, path: pathname, status: response.status, headers };
}

async function hashModelResponse(response) {
  invariant(response.body !== null, 'Model response must have a readable body');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    invariant(bytes <= EXPECTED_MODEL_BYTES, 'Online model response exceeded the expected byte count');
    hash.update(buffer);
  }
  const sha256 = hash.digest('hex');
  invariant(bytes === EXPECTED_MODEL_BYTES, `Online model bytes ${bytes} do not equal ${EXPECTED_MODEL_BYTES}`);
  invariant(sha256 === EXPECTED_MODEL_SHA256, `Online model SHA-256 ${sha256} does not match the frozen model`);
  return { bytes, sha256 };
}

async function probeInitialDelivery(deploymentUrl, fetchImplementation = globalThis.fetch) {
  const rootUrl = new URL('/', deploymentUrl).href;
  const rootResponse = await fetchChecked(rootUrl, fetchImplementation);
  const rootCheck = resourceCheck('root', '/', rootResponse);
  await readBoundedText(rootResponse, 2 * 1024 * 1024, 'root HTML');

  const manifestPath = '/models/manifest.json';
  const manifestUrl = new URL(manifestPath, deploymentUrl).href;
  const manifestResponse = await fetchChecked(manifestUrl, fetchImplementation);
  const manifestCheck = resourceCheck('manifest', manifestPath, manifestResponse);
  const manifest = JSON.parse(await readBoundedText(manifestResponse, 128 * 1024, 'model manifest'));
  invariant(manifest?.schema_version === 1, 'Online model manifest schema_version must equal 1');
  invariant(manifest?.model?.file === path.posix.basename(EXPECTED_MODEL_PATH), 'Online manifest model filename is invalid');
  invariant(manifest?.model?.bytes === EXPECTED_MODEL_BYTES, 'Online manifest model byte count is invalid');
  invariant(manifest?.model?.sha256 === EXPECTED_MODEL_SHA256, 'Online manifest model SHA-256 is invalid');

  const modelUrl = new URL(EXPECTED_MODEL_PATH, deploymentUrl).href;
  const modelResponse = await fetchChecked(modelUrl, fetchImplementation);
  const modelCheck = resourceCheck('model', EXPECTED_MODEL_PATH, modelResponse);
  const model = await hashModelResponse(modelResponse);
  return { resources: [rootCheck, manifestCheck, modelCheck], model };
}

async function probeRuntimeResource(deploymentUrl, pathname, kind, fetchImplementation = globalThis.fetch) {
  const response = await fetchChecked(new URL(pathname, deploymentUrl).href, fetchImplementation);
  const check = resourceCheck(kind, pathname, response);
  await response.body?.cancel('metadata and headers recorded');
  return check;
}

function executableFromPath(name) {
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension.toLowerCase()}`);
      const result = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status === 0) return candidate;
    }
  }
  return undefined;
}

async function discoverEdge() {
  const candidates = [];
  if (process.env.LINGSHU_EDGE_EXECUTABLE) candidates.push(process.env.LINGSHU_EDGE_EXECUTABLE);
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (base) candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else {
    for (const name of ['microsoft-edge', 'microsoft-edge-stable']) {
      const candidate = executableFromPath(name);
      if (candidate) candidates.push(candidate);
    }
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      if ((await stat(candidate)).isFile()) return path.resolve(candidate);
    } catch {
      // Continue through the finite installed-Edge candidate list.
    }
  }
  throw new Error(`Installed Microsoft Edge was not found (checked: ${candidates.join(', ')})`);
}

function createNetworkAudit() {
  return {
    requestCount: 0,
    requests: new Map(),
    externalOrigins: new Set(),
    disallowedMethods: new Set(),
    imageRequests: 0,
    modelRequests: 0,
    errors: [],
    warnings: [],
    pageErrors: [],
  };
}

function recordRequest(audit, method, kind, pathname) {
  audit.requestCount += 1;
  const key = `${method}\u0000${kind}\u0000${pathname}`;
  const current = audit.requests.get(key) ?? { method, kind, path: pathname, count: 0 };
  current.count += 1;
  audit.requests.set(key, current);
  if (kind === 'model') audit.modelRequests += 1;
}

async function installRequestBoundary(context, deploymentUrl, audit) {
  const allowedOrigin = new URL(deploymentUrl).origin;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = request.url();
    if (requestUrl.startsWith('blob:') || requestUrl.startsWith('data:')) {
      await route.continue();
      return;
    }
    const parsed = new URL(requestUrl);
    const method = request.method().toUpperCase();
    const kind = classifyRequest(requestUrl, deploymentUrl);
    const body = request.postDataBuffer();
    if (!SAFE_METHODS.has(method)) audit.disallowedMethods.add(method);
    if (body !== null && body.byteLength > 0) audit.imageRequests += 1;
    if (kind === 'external') {
      audit.externalOrigins.add(parsed.origin);
      await route.abort('blockedbyclient');
      return;
    }
    recordRequest(audit, method, kind, parsed.pathname);
    if (!SAFE_METHODS.has(method) || (body !== null && body.byteLength > 0)) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', async (webSocketRoute) => {
    const parsed = new URL(webSocketRoute.url());
    if (parsed.origin === allowedOrigin.replace(/^https:/, 'wss:')) {
      webSocketRoute.connectToServer();
      return;
    }
    audit.externalOrigins.add(parsed.origin);
    await webSocketRoute.close({ code: 1008, reason: 'Blocked by online acceptance boundary' });
  });
}

async function installProgressProbe(page) {
  await page.addInitScript(({ expectedBytes }) => {
    window.__lingshuOnlineProgress = [];
    let last = '';
    const capture = () => {
      const element = document.querySelector('progress[aria-label="FP32 model download progress"]');
      if (!(element instanceof HTMLProgressElement)) return;
      const sample = { loaded: element.value, total: element.max };
      const serialized = `${sample.loaded}/${sample.total}`;
      if (sample.total === expectedBytes && serialized !== last) {
        window.__lingshuOnlineProgress.push(sample);
        last = serialized;
      }
    };
    const start = () => {
      capture();
      new MutationObserver(capture).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      setInterval(capture, 10);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }, { expectedBytes: EXPECTED_MODEL_BYTES });
}

async function waitForPhase(page, desired, timeout) {
  await page.waitForFunction(
    (phase) => {
      const current = document.querySelector('.detector-stage')?.getAttribute('data-phase');
      return current === phase || current === 'error';
    },
    desired,
    { timeout },
  );
  const phase = await page.locator('.detector-stage').getAttribute('data-phase');
  if (phase === 'error' && desired !== 'error') {
    const message = (await page.locator('[role="alert"]').first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';
    throw new Error(`Detector entered error while waiting for ${desired}: ${message}`);
  }
  invariant(phase === desired, `Expected detector phase ${desired}; observed ${String(phase)}`);
}

async function waitForModelReady(page) {
  await waitForPhase(page, 'ready', MODEL_TIMEOUT_MS);
  await page.getByText('MODEL READY', { exact: true }).waitFor({ state: 'visible' });
  await page.locator('input[type="file"]:not([disabled])').waitFor({ state: 'attached' });
}

async function definitionValue(page, term) {
  const locator = page.getByText(term, { exact: true });
  invariant(await locator.count() === 1, `Expected one result detail term ${term}`);
  return (await locator.locator('xpath=following-sibling::dd[1]').textContent())?.trim() ?? '';
}

async function readDetectionResult(page) {
  const confidence = page.locator('#confidence-progress');
  invariant(await confidence.count() === 1, 'Successful inference must expose confidence progress');
  const probability = await confidence.evaluate((element) => element.value);
  finiteProbability(probability, 'browser probability');
  const label = (await page.locator('.decision-word').textContent())?.trim() ?? '';
  const displayedProvider = await definitionValue(page, 'Provider');
  const provider = displayedProvider === 'WebGPU' ? 'webgpu' : displayedProvider === 'WASM' ? 'wasm' : '';
  invariant(provider !== '', `Unexpected provider ${JSON.stringify(displayedProvider)}`);
  const preview = await page.locator('.preview-figure img').evaluate((image) => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    source: image.currentSrc,
  }));
  invariant(preview.complete && preview.naturalWidth > 0 && preview.source.startsWith('blob:'), 'Image preview must remain in browser memory');
  return { probability, label, provider };
}

async function resetDetector(page) {
  await page.getByRole('button', { name: 'Reset detector' }).click();
  await waitForPhase(page, 'ready', 10_000);
}

async function runPredictions(page, repositoryRoot, provider, references) {
  const input = page.locator('input[type="file"]');
  invariant(await input.count() === 1, 'Detector must expose exactly one file input');
  const results = [];
  for (const [index, source] of DEMO_SOURCES.entries()) {
    await input.setInputFiles(path.join(repositoryRoot, ...source.split('/')));
    await waitForPhase(page, 'success', INFERENCE_TIMEOUT_MS);
    const actual = await readDetectionResult(page);
    const referenceProbability = references.get(source);
    const comparison = compareOnlinePrediction(referenceProbability, actual.probability);
    invariant(actual.provider === provider, `${source} used ${actual.provider}; expected ${provider}`);
    invariant(comparison.withinTolerance, `${source} probability error ${comparison.absoluteError} exceeds ${MAX_PROBABILITY_ERROR}`);
    invariant(!comparison.thresholdFlip, `${source} flips the frozen decision threshold`);
    invariant(actual.label === comparison.expectedLabel && actual.label === comparison.actualLabel, `${source} label is inconsistent`);
    results.push({
      source,
      referenceProbability,
      probability: actual.probability,
      absoluteError: comparison.absoluteError,
      label: actual.label,
      provider,
      thresholdFlip: comparison.thresholdFlip,
    });
    reportProgress(`${provider}: ${index + 1}/10 ${source}`);
    await resetDetector(page);
  }
  return results;
}

function resourceTimings(page) {
  return page.evaluate((modelPath) => performance
    .getEntriesByType('resource')
    .filter((entry) => new URL(entry.name).pathname === modelPath)
    .slice(-10)
    .map((entry) => ({
      path: modelPath,
      transferSize: Math.max(0, Math.round(entry.transferSize)),
      encodedBodySize: Math.max(0, Math.round(entry.encodedBodySize)),
    })), EXPECTED_MODEL_PATH);
}

function observedResourcePaths(page) {
  return page.evaluate(() => [...new Set(performance
    .getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname))]);
}

async function runProviderCase(browser, deploymentUrl, repositoryRoot, references, mode) {
  const provider = mode;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const audit = createNetworkAudit();
  let operationError;
  let result;
  try {
    await installRequestBoundary(context, deploymentUrl, audit);
    const page = await context.newPage();
    await installProgressProbe(page);
    page.on('pageerror', (error) => audit.pageErrors.push(error.message.slice(0, 500)));
    page.on('console', (message) => {
      const text = message.text().replace(/https?:\/\/\S+/g, '[url]').slice(0, 500);
      if (message.type() === 'error') audit.errors.push(text);
      if (message.type() === 'warning') audit.warnings.push(text);
    });
    const target = new URL(deploymentUrl);
    if (mode === 'wasm') target.searchParams.set('provider', 'wasm');
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    invariant(response !== null && response.status() === 200, `${mode} navigation failed`);
    await waitForModelReady(page);
    invariant(await page.evaluate(() => window.crossOriginIsolated), `${mode} page is not cross-origin isolated`);
    let progress = await page.evaluate(() => window.__lingshuOnlineProgress ?? []);
    progress = compactProgressSamples(progress, 128);
    const predictions = await runPredictions(page, repositoryRoot, provider, references);
    let cache;
    let offline;
    if (mode === 'webgpu') {
      await page.evaluate(() => performance.clearResourceTimings());
      const beforeReload = audit.modelRequests;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForModelReady(page);
      invariant(await page.evaluate(() => window.crossOriginIsolated), 'Reloaded page is not cross-origin isolated');
      const observations = await resourceTimings(page);
      cache = {
        reloadModelRequests: audit.modelRequests - beforeReload,
        observations,
        interpretation: 'A reload observation only; no permanent-cache claim.',
      };
      await context.setOffline(true);
      const source = 'demo_images/r5.png';
      await page.locator('input[type="file"]').setInputFiles(path.join(repositoryRoot, ...source.split('/')));
      await waitForPhase(page, 'success', INFERENCE_TIMEOUT_MS);
      const actual = await readDetectionResult(page);
      const comparison = compareOnlinePrediction(references.get(source), actual.probability);
      invariant(actual.provider === 'webgpu' && comparison.withinTolerance && !comparison.thresholdFlip, 'Offline WebGPU inference parity failed');
      offline = { completed: true, source, provider: actual.provider, probability: actual.probability, label: actual.label };
    }
    const paths = await observedResourcePaths(page);
    result = {
      run: { mode, provider, crossOriginIsolated: true, predictions },
      progress,
      paths,
      cache,
      offline,
    };
  } catch (error) {
    operationError = error;
  }
  try {
    await context.close();
  } catch (closeError) {
    if (operationError !== undefined) throw new AggregateError([operationError, closeError], `${mode} flow and context cleanup failed`);
    throw closeError;
  }
  invariant(audit.externalOrigins.size === 0, `External origins observed: ${[...audit.externalOrigins].join(', ')}`);
  invariant(audit.disallowedMethods.size === 0, `Disallowed methods observed: ${[...audit.disallowedMethods].join(', ')}`);
  invariant(audit.imageRequests === 0, 'An image-bearing network request was observed');
  invariant(audit.errors.length === 0, `Browser console errors observed: ${audit.errors.join('; ')}`);
  invariant(audit.pageErrors.length === 0, `Browser page errors observed: ${audit.pageErrors.join('; ')}`);
  if (operationError !== undefined) throw operationError;
  invariant(result !== undefined, `${mode} provider flow produced no result`);
  return { ...result, audit };
}

function mergeAudits(audits) {
  const aggregate = createNetworkAudit();
  for (const audit of audits) {
    aggregate.requestCount += audit.requestCount;
    aggregate.imageRequests += audit.imageRequests;
    for (const origin of audit.externalOrigins) aggregate.externalOrigins.add(origin);
    for (const method of audit.disallowedMethods) aggregate.disallowedMethods.add(method);
    aggregate.errors.push(...audit.errors);
    aggregate.warnings.push(...audit.warnings);
    aggregate.pageErrors.push(...audit.pageErrors);
    for (const request of audit.requests.values()) {
      const key = `${request.method}\u0000${request.kind}\u0000${request.path}`;
      const current = aggregate.requests.get(key) ?? { ...request, count: 0 };
      current.count += request.count;
      aggregate.requests.set(key, current);
    }
  }
  invariant(aggregate.requests.size <= 100, 'Request path aggregate exceeded 100 entries');
  return {
    requestCount: aggregate.requestCount,
    externalOrigins: [...aggregate.externalOrigins].sort(),
    disallowedMethods: [...aggregate.disallowedMethods].sort(),
    imageRequests: aggregate.imageRequests,
    requests: [...aggregate.requests.values()].sort((left, right) =>
      `${left.method}:${left.path}`.localeCompare(`${right.method}:${right.path}`)),
  };
}

async function loadDemoReferences(repositoryRoot) {
  const rows = JSON.parse(await readFile(path.join(repositoryRoot, 'results', 'demo_predictions_cpu.json'), 'utf8'));
  invariant(Array.isArray(rows) && rows.length === 10, 'Frozen demo prediction baseline must contain exactly 10 rows');
  const result = new Map();
  for (const [index, row] of rows.entries()) {
    exactKeys(row, ['image_path', 'pred'], `demo prediction ${index}`);
    const source = `demo_images/${row.image_path}`;
    invariant(source === DEMO_SOURCES[index], `demo prediction ${index} source order is invalid`);
    result.set(source, finiteProbability(row.pred, `${source} frozen probability`));
  }
  return result;
}

async function executeDefaultChecks({ deploymentUrl, repositoryRoot }) {
  reportProgress('verifying root, manifest, and exact model bytes');
  const delivery = await probeInitialDelivery(deploymentUrl);
  const references = await loadDemoReferences(repositoryRoot);
  const edgeExecutable = await discoverEdge();
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
  let webgpu;
  let wasm;
  let browserError;
  const browserVersion = await browser.version();
  try {
    reportProgress('running real WebGPU provider case');
    webgpu = await runProviderCase(browser, deploymentUrl, repositoryRoot, references, 'webgpu');
    reportProgress('running forced WASM provider case');
    wasm = await runProviderCase(browser, deploymentUrl, repositoryRoot, references, 'wasm');
  } catch (error) {
    browserError = error;
  }
  try {
    await browser.close();
  } catch (closeError) {
    if (browserError !== undefined) throw new AggregateError([browserError, closeError], 'Browser flow and cleanup failed');
    throw closeError;
  }
  if (browserError !== undefined) throw browserError;
  invariant(webgpu !== undefined && wasm !== undefined, 'Provider cases did not complete');
  const observedPaths = new Set([...webgpu.paths, ...wasm.paths]);
  invariant(observedPaths.has(ORT_MJS_PATH), `Actual page did not request ${ORT_MJS_PATH}`);
  invariant(observedPaths.has(ORT_WASM_PATH), `Actual page did not request ${ORT_WASM_PATH}`);
  const runtimeResources = [
    await probeRuntimeResource(deploymentUrl, ORT_MJS_PATH, 'ort-mjs'),
    await probeRuntimeResource(deploymentUrl, ORT_WASM_PATH, 'ort-wasm'),
  ];
  const privacy = mergeAudits([webgpu.audit, wasm.audit]);
  return {
    browser: { name: 'Microsoft Edge', version: browserVersion },
    headers: { resources: [...delivery.resources, ...runtimeResources] },
    model: {
      path: EXPECTED_MODEL_PATH,
      bytes: delivery.model.bytes,
      sha256: delivery.model.sha256,
      progress: webgpu.progress,
    },
    providers: ['webgpu', 'wasm'],
    providerRuns: [webgpu.run, wasm.run],
    crossOriginIsolated: true,
    thresholdFlips: [...webgpu.run.predictions, ...wasm.run.predictions]
      .filter(({ thresholdFlip }) => thresholdFlip).length,
    privacy,
    cache: webgpu.cache,
    offline: webgpu.offline,
    console: {
      warnings: [...new Set([...webgpu.audit.warnings, ...wasm.audit.warnings])].slice(0, 20),
      errors: [],
      pageErrors: [],
    },
  };
}

async function writeCandidateEvidence(repositoryRoot, evidence) {
  const destination = path.join(repositoryRoot, 'web_demo', '.generated-tests', 'online', 'latest.json');
  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);
  return destination;
}

export async function runOnlineAcceptance(deploymentUrlValue, options = {}) {
  const deploymentUrl = parseOnlineUrl(deploymentUrlValue);
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const inspectGit = options.inspectGit ?? captureGitState;
  const runChecks = options.runChecks ?? executeDefaultChecks;
  const writeCandidate = options.writeCandidate ?? writeCandidateEvidence;
  const now = options.now ?? (() => new Date());
  const initial = await inspectGit(repositoryRoot);
  const testedCommit = assertSameCleanGitState(initial, initial);
  const checks = await runChecks({ deploymentUrl, repositoryRoot });
  const evidence = validateOnlineEvidence({
    schema_version: 1,
    passed: true,
    generatedAt: now().toISOString(),
    testedCommit,
    deploymentUrl,
    ...checks,
  });
  assertSameCleanGitState(initial, await inspectGit(repositoryRoot));
  const candidatePath = await writeCandidate(repositoryRoot, evidence);
  assertSameCleanGitState(initial, await inspectGit(repositoryRoot));
  return { evidence, candidatePath };
}

async function main(arguments_ = process.argv.slice(2)) {
  const deploymentUrl = parseCliArguments(arguments_);
  const { candidatePath } = await runOnlineAcceptance(deploymentUrl);
  reportProgress('all delivery, provider, parity, privacy, cache, and offline gates passed');
  process.stdout.write(`Validated candidate evidence: ${candidatePath}\n`);
  process.stdout.write('Review the candidate before copying it to results/web_demo_online_acceptance/latest.json.\n');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
