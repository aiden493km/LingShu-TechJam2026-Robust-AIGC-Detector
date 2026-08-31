import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ORT_RUNTIME_BYTES,
  ORT_RUNTIME_MJS_BYTES,
  ORT_RUNTIME_MJS_NAME,
  ORT_RUNTIME_MJS_SHA256,
  ORT_RUNTIME_NAME,
  ORT_RUNTIME_SHA256,
} from './copy_ort_runtime.mjs';
import { validateFrozenModelManifest } from './prepare_online_dist.mjs';

const FORBIDDEN_MODEL_FILE = /\.onnx(?:\.data)?$/i;
const MODEL_MANIFEST_PATH = 'models/manifest.json';
const INTEGRITY_PATH = 'integrity.json';
const INDEX_PATH = 'index.html';
const NO_FOLLOW =
  typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function resolveOnlineDistDirectory(distDirectory) {
  if (typeof distDirectory !== 'string' || distDirectory.trim() === '') {
    throw new TypeError('Online dist directory must be a non-empty path');
  }
  const requested = resolve(distDirectory);
  let stats;
  try {
    stats = await lstat(requested);
  } catch (error) {
    throw new Error(`Could not inspect online dist directory: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Online dist directory must be a regular non-symlink directory');
  }
  return realpath(requested);
}

async function inspectRegularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error(`Could not inspect ${label}: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return stats;
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function rejectForbiddenEntries(directory, relativePath = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const displayPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Online distribution must not contain symlinks: ${displayPath}`);
    }
    if (FORBIDDEN_MODEL_FILE.test(entry.name)) {
      throw new Error(`Online distribution must not contain ONNX model data: ${displayPath}`);
    }
    if (stats.isDirectory()) {
      await rejectForbiddenEntries(path, displayPath);
    }
  }
}

async function assertOnlyModelManifest(modelsDirectory) {
  let stats;
  try {
    stats = await lstat(modelsDirectory);
  } catch (error) {
    throw new Error(`Could not inspect models directory: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Online models directory must be a regular non-symlink directory');
  }
  const entries = await readdir(modelsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name !== 'manifest.json') {
      throw new Error(`Unexpected sibling under models/: ${entry.name}`);
    }
  }
}

async function readVerifiedRegularFile(path, label, relativePath, testHooks) {
  let handle;
  let primaryError;
  try {
    const before = await inspectRegularFile(path, label);
    handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !sameFileIdentity(before, openedBefore)) {
      throw new Error(`${label} changed while it was being opened`);
    }
    await testHooks.afterFileOpen?.({ absolutePath: path, path: relativePath });
    const contents = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const after = await inspectRegularFile(path, label);
    if (
      !sameFileIdentity(openedBefore, openedAfter) ||
      !sameFileIdentity(openedAfter, after)
    ) {
      throw new Error(`${label} changed while it was being read`);
    }
    return contents;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      if (primaryError === undefined) {
        throw new Error(`Could not close ${label}: ${errorMessage(error)}`);
      }
    }
  }
}

async function digestFile(path, label, relativePath, testHooks) {
  const contents = await readVerifiedRegularFile(path, label, relativePath, testHooks);
  return {
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

function assertDigest(digest, expected, label) {
  if (digest.bytes !== expected.bytes || digest.sha256 !== expected.sha256) {
    throw new Error(
      `${label} must equal ${expected.bytes} bytes and SHA-256 ${expected.sha256}`,
    );
  }
}

function assertIntegrityEntry(files, expected) {
  const matches = files.filter((entry) => entry?.path === expected.path);
  if (matches.length !== 1) {
    throw new Error(`Integrity manifest must list exactly one ${expected.path} entry`);
  }
  const entry = matches[0];
  if (entry.bytes !== expected.bytes || entry.sha256 !== expected.sha256) {
    throw new Error(`Integrity manifest entry for ${expected.path} does not match exact bytes and hash`);
  }
}

function parseIntegrityManifest(contents) {
  let manifest;
  try {
    manifest = JSON.parse(contents.toString('utf8'));
  } catch (error) {
    throw new Error(`Online integrity manifest must contain valid JSON: ${errorMessage(error)}`);
  }
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    throw new Error('Online integrity manifest must contain a files array');
  }
  return manifest.files;
}

export function defaultOnlineDistDirectory() {
  return fileURLToPath(new URL('../dist-online/', import.meta.url));
}

/** Verify the deployable, model-free Vercel distribution. */
export async function verifyOnlineDist(distDirectory = defaultOnlineDistDirectory(), testHooks = {}) {
  const root = await resolveOnlineDistDirectory(distDirectory);
  await rejectForbiddenEntries(root);
  await assertOnlyModelManifest(join(root, 'models'));

  await inspectRegularFile(join(root, INDEX_PATH), INDEX_PATH);
  const integrityPath = join(root, INTEGRITY_PATH);
  const manifestPath = join(root, MODEL_MANIFEST_PATH);
  const mjsPath = join(root, 'assets', ORT_RUNTIME_MJS_NAME);
  const wasmPath = join(root, 'assets', ORT_RUNTIME_NAME);

  await inspectRegularFile(integrityPath, INTEGRITY_PATH);
  const integrityContents = await readVerifiedRegularFile(
    integrityPath,
    INTEGRITY_PATH,
    INTEGRITY_PATH,
    testHooks,
  );
  const modelContents = await readVerifiedRegularFile(
    manifestPath,
    MODEL_MANIFEST_PATH,
    MODEL_MANIFEST_PATH,
    testHooks,
  );
  validateFrozenModelManifest(modelContents);
  const modelDigest = {
    bytes: modelContents.byteLength,
    sha256: createHash('sha256').update(modelContents).digest('hex'),
  };
  const mjsDigest = await digestFile(
    mjsPath,
    `assets/${ORT_RUNTIME_MJS_NAME}`,
    `assets/${ORT_RUNTIME_MJS_NAME}`,
    testHooks,
  );
  const wasmDigest = await digestFile(
    wasmPath,
    `assets/${ORT_RUNTIME_NAME}`,
    `assets/${ORT_RUNTIME_NAME}`,
    testHooks,
  );
  assertDigest(mjsDigest, { bytes: ORT_RUNTIME_MJS_BYTES, sha256: ORT_RUNTIME_MJS_SHA256 }, 'ORT runtime MJS');
  assertDigest(wasmDigest, { bytes: ORT_RUNTIME_BYTES, sha256: ORT_RUNTIME_SHA256 }, 'ORT runtime WASM');

  const integrityFiles = parseIntegrityManifest(integrityContents);
  assertIntegrityEntry(integrityFiles, { path: MODEL_MANIFEST_PATH, ...modelDigest });
  assertIntegrityEntry(integrityFiles, {
    path: `assets/${ORT_RUNTIME_MJS_NAME}`,
    bytes: ORT_RUNTIME_MJS_BYTES,
    sha256: ORT_RUNTIME_MJS_SHA256,
  });
  assertIntegrityEntry(integrityFiles, {
    path: `assets/${ORT_RUNTIME_NAME}`,
    bytes: ORT_RUNTIME_BYTES,
    sha256: ORT_RUNTIME_SHA256,
  });
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    throw new Error('Usage: node tools/verify_online_dist.mjs [dist-directory]');
  }
  await verifyOnlineDist(arguments_[0]);
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
