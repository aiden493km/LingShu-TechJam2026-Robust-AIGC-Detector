import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ORT_RUNTIME_EXPORT =
  'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm';
const ORT_RUNTIME_MJS_EXPORT =
  'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs';
export const ORT_RUNTIME_NAME = 'ort-wasm-simd-threaded.asyncify.wasm';
export const ORT_RUNTIME_BYTES = 25_749_873;
export const ORT_RUNTIME_SHA256 =
  '503d17cb7411b79781b9fad1cf0978f03cf06b050c7d399c730e914f473bf549';
export const ORT_RUNTIME_MJS_NAME = 'ort-wasm-simd-threaded.asyncify.mjs';
export const ORT_RUNTIME_MJS_BYTES = 51_407;
export const ORT_RUNTIME_MJS_SHA256 =
  '5d25483158d53d8f34d0e9c06a654d56c8dca4ebdf370ea0982ef11315a00e0e';

const ORT_RUNTIME_PATTERN = /^ort.*\.(?:mjs|wasm)$/i;
const EXPECTED_ORT_RUNTIME_NAMES = new Set([
  ORT_RUNTIME_MJS_NAME,
  ORT_RUNTIME_NAME,
]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

export function resolveOrtRuntimeSource() {
  return fileURLToPath(import.meta.resolve(ORT_RUNTIME_EXPORT));
}

export function resolveOrtRuntimeMjsSource() {
  return fileURLToPath(import.meta.resolve(ORT_RUNTIME_MJS_EXPORT));
}

export function defaultDistDirectory() {
  return fileURLToPath(new URL('../dist/', import.meta.url));
}

async function inspectRegularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error(`Could not inspect ${label}: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file, not a symlink or directory`);
  }
  return stats;
}

async function prepareAssetsDirectory(distDirectory) {
  const assetsDirectory = join(distDirectory, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  const stats = await lstat(assetsDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Dist assets path must be a regular directory, not a symlink');
  }
  return assetsDirectory;
}

async function rejectAdditionalOrtRuntimeSiblings(assetsDirectory) {
  async function visit(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      if (ORT_RUNTIME_PATTERN.test(entry.name)) {
        if (!EXPECTED_ORT_RUNTIME_NAMES.has(relativePath)) {
          throw new Error(
            `Found additional ORT runtime sibling in dist/assets: ${relativePath}`,
          );
        }
        const stats = await lstat(absolutePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Error(
            `Existing ORT runtime destination must be a regular file: ${absolutePath}`,
          );
        }
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      }
    }
  }

  await visit(assetsDirectory);
}

function runtimeDescriptors(options) {
  return [
    {
      key: 'mjs',
      label: 'ORT runtime MJS',
      sourcePath: resolve(options.mjsSourcePath ?? resolveOrtRuntimeMjsSource()),
      name: ORT_RUNTIME_MJS_NAME,
      bytes: ORT_RUNTIME_MJS_BYTES,
      sha256: ORT_RUNTIME_MJS_SHA256,
    },
    {
      key: 'wasm',
      label: 'ORT runtime WASM',
      sourcePath: resolve(options.sourcePath ?? resolveOrtRuntimeSource()),
      name: ORT_RUNTIME_NAME,
      bytes: ORT_RUNTIME_BYTES,
      sha256: ORT_RUNTIME_SHA256,
    },
  ];
}

async function hashFile(path) {
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
    bytes += chunk.byteLength;
  }
  return { bytes, sha256: digest.digest('hex') };
}

/**
 * Copy the frozen ORT asyncify module and WASM into the built distribution.
 *
 * @param {{sourcePath?: string, mjsSourcePath?: string, distDirectory?: string, testHooks?: {afterCopy?: Function}}} [options]
 * @returns {Promise<{
 *   mjs: {bytes: number, destinationPath: string, sha256: string, sourcePath: string},
 *   wasm: {bytes: number, destinationPath: string, sha256: string, sourcePath: string}
 * }>}
 */
export async function copyOrtRuntime(options = {}) {
  const distDirectory = resolve(options.distDirectory ?? defaultDistDirectory());
  const descriptors = runtimeDescriptors(options);
  for (const descriptor of descriptors) {
    descriptor.sourceBefore = await inspectRegularFile(
      descriptor.sourcePath,
      `${descriptor.label} source`,
    );
    if (descriptor.sourceBefore.size !== BigInt(descriptor.bytes)) {
      throw new Error(
        `${descriptor.label} source byte count must equal ${descriptor.bytes}; found ${descriptor.sourceBefore.size}`,
      );
    }
  }

  const assetsDirectory = await prepareAssetsDirectory(distDirectory);
  await rejectAdditionalOrtRuntimeSiblings(assetsDirectory);
  for (const descriptor of descriptors) {
    descriptor.destinationPath = join(assetsDirectory, descriptor.name);
    if (descriptor.sourcePath === resolve(descriptor.destinationPath)) {
      throw new Error(
        `${descriptor.label} source and destination must not be the same file`,
      );
    }
  }

  for (const descriptor of descriptors) {
    const sourceDigest = createHash('sha256');
    let copiedBytes = 0;
    const hashingPassThrough = new Transform({
      transform(chunk, _encoding, callback) {
        sourceDigest.update(chunk);
        copiedBytes += chunk.byteLength;
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        createReadStream(descriptor.sourcePath),
        hashingPassThrough,
        createWriteStream(descriptor.destinationPath, { flags: 'w', mode: 0o644 }),
      );
    } catch (error) {
      throw new Error(
        `Could not stream-copy the ${descriptor.label}: ${errorMessage(error)}`,
      );
    }

    const sourceAfter = await inspectRegularFile(
      descriptor.sourcePath,
      `${descriptor.label} source`,
    );
    if (
      !sameFileIdentity(descriptor.sourceBefore, sourceAfter) ||
      copiedBytes !== descriptor.bytes
    ) {
      throw new Error(`${descriptor.label} source changed while it was being copied`);
    }
    descriptor.sourceSha256 = sourceDigest.digest('hex');
    if (descriptor.sourceSha256 !== descriptor.sha256) {
      throw new Error(
        `${descriptor.label} source SHA-256 must equal ${descriptor.sha256}; found ${descriptor.sourceSha256}`,
      );
    }
  }

  const destinationPaths = Object.fromEntries(
    descriptors.map((descriptor) => [descriptor.key, descriptor.destinationPath]),
  );
  await options.testHooks?.afterCopy?.({
    assetsDirectory,
    destinationPath: destinationPaths.wasm,
    destinationPaths,
  });
  await rejectAdditionalOrtRuntimeSiblings(assetsDirectory);

  const result = {};
  for (const descriptor of descriptors) {
    const destinationStats = await inspectRegularFile(
      descriptor.destinationPath,
      `${descriptor.label} destination`,
    );
    if (destinationStats.size !== BigInt(descriptor.bytes)) {
      throw new Error(
        `${descriptor.label} destination byte count must equal ${descriptor.bytes}; found ${destinationStats.size}`,
      );
    }

    const destination = await hashFile(descriptor.destinationPath);
    if (destination.bytes !== descriptor.bytes) {
      throw new Error(
        `${descriptor.label} destination byte count must equal ${descriptor.bytes}; found ${destination.bytes}`,
      );
    }
    if (
      destination.sha256 !== descriptor.sourceSha256 ||
      destination.sha256 !== descriptor.sha256
    ) {
      throw new Error(
        `${descriptor.label} destination SHA-256 does not match the source: ${destination.sha256}`,
      );
    }
    result[descriptor.key] = {
      bytes: destination.bytes,
      destinationPath: descriptor.destinationPath,
      sha256: destination.sha256,
      sourcePath: descriptor.sourcePath,
    };
  }

  return result;
}

async function runCli() {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node tools/copy_ort_runtime.mjs');
  }
  const result = await copyOrtRuntime();
  for (const copied of [result.mjs, result.wasm]) {
    console.log(
      `[ort-runtime] copied ${copied.bytes} bytes (${copied.sha256}) to ${copied.destinationPath}`,
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    await runCli();
  } catch (error) {
    console.error(`[ort-runtime] ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
