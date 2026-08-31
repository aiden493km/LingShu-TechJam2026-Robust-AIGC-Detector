import { copyFile, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODEL_MANIFEST_NAME = 'manifest.json';
const FORBIDDEN_MODEL_FILE = /\.onnx(?:\.data)?$/i;

const FROZEN_MODEL = {
  file: 'baseline2_njr_fp32.onnx',
  bytes: 88_123_029,
  sha256: 'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69',
  precision: 'FP32',
  opset: 18,
  thresholdAigc: 0.55657113,
};

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertPath(path, label) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new TypeError(`${label} must be a non-empty path`);
  }
  return resolve(path);
}

async function inspectRegularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    throw new Error(`Could not inspect ${label}: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return stats;
}

async function resolveRegularDirectory(path, label, { create = false } = {}) {
  if (create) {
    await mkdir(path, { recursive: true });
  }
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    throw new Error(`Could not inspect ${label}: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a regular non-symlink directory`);
  }
  return realpath(path);
}

async function rejectForbiddenOutputEntries(directory, relativePath = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const displayPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Online output entry must not be a symlink: ${displayPath}`);
    }
    if (FORBIDDEN_MODEL_FILE.test(entry.name)) {
      throw new Error(`Online output must not include ONNX model data: ${displayPath}`);
    }
    if (stats.isDirectory()) {
      await rejectForbiddenOutputEntries(path, displayPath);
    }
  }
}

function requireFrozenField(value, expected, label) {
  if (value !== expected) {
    throw new Error(`Copied model manifest ${label} must equal ${expected}`);
  }
}

export function validateFrozenModelManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Copied model manifest must contain valid JSON: ${errorMessage(error)}`);
  }
  if (manifest === null || typeof manifest !== 'object') {
    throw new Error('Copied model manifest must contain a JSON object');
  }
  const model = manifest.model;
  const threshold = manifest.threshold;
  if (model === null || typeof model !== 'object') {
    throw new Error('Copied model manifest must contain a model object');
  }
  if (threshold === null || typeof threshold !== 'object') {
    throw new Error('Copied model manifest must contain a threshold object');
  }
  requireFrozenField(model.file, FROZEN_MODEL.file, 'model.file');
  requireFrozenField(model.bytes, FROZEN_MODEL.bytes, 'model.bytes');
  requireFrozenField(model.sha256, FROZEN_MODEL.sha256, 'model.sha256');
  requireFrozenField(model.precision, FROZEN_MODEL.precision, 'model.precision');
  requireFrozenField(model.opset, FROZEN_MODEL.opset, 'model.opset');
  requireFrozenField(threshold.aigc, FROZEN_MODEL.thresholdAigc, 'threshold.aigc');
}

export function defaultOnlineDistDirectory() {
  return fileURLToPath(new URL('../dist-online/', import.meta.url));
}

export function defaultModelManifestPath() {
  return fileURLToPath(new URL('../models/manifest.json', import.meta.url));
}

/**
 * Copy the frozen model manifest into an ONNX-free online distribution.
 *
 * @param {{distDirectory?: string, manifestPath?: string}} [options]
 */
export async function prepareOnlineDist({
  distDirectory = defaultOnlineDistDirectory(),
  manifestPath = defaultModelManifestPath(),
} = {}) {
  const sourceManifest = assertPath(manifestPath, 'Model manifest path');
  await inspectRegularFile(sourceManifest, 'Model manifest source');

  const requestedDistDirectory = assertPath(distDirectory, 'Online dist directory');
  const onlineDistDirectory = await resolveRegularDirectory(
    requestedDistDirectory,
    'Online dist directory',
    { create: true },
  );
  await rejectForbiddenOutputEntries(onlineDistDirectory);

  const modelsDirectory = join(onlineDistDirectory, 'models');
  const resolvedModelsDirectory = await resolveRegularDirectory(modelsDirectory, 'Online models directory', {
    create: true,
  });
  const destinationManifest = join(resolvedModelsDirectory, MODEL_MANIFEST_NAME);
  try {
    await inspectRegularFile(destinationManifest, 'Online model manifest destination');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ENOENT')) {
      throw error;
    }
  }

  await copyFile(sourceManifest, destinationManifest);
  await inspectRegularFile(destinationManifest, 'Copied model manifest');
  validateFrozenModelManifest(await readFile(destinationManifest));
  await rejectForbiddenOutputEntries(onlineDistDirectory);
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    throw new Error('Usage: node tools/prepare_online_dist.mjs [dist-directory]');
  }
  await prepareOnlineDist({ distDirectory: arguments_[0] });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    await runCli();
  } catch (error) {
    console.error(`[online-dist] ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
