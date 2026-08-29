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
export const ORT_RUNTIME_NAME = 'ort-wasm-simd-threaded.asyncify.wasm';
export const ORT_RUNTIME_BYTES = 25_749_873;
export const ORT_RUNTIME_SHA256 =
  '503d17cb7411b79781b9fad1cf0978f03cf06b050c7d399c730e914f473bf549';

const ORT_RUNTIME_PATTERN = /^ort.*\.wasm$/i;

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
        if (relativePath !== ORT_RUNTIME_NAME) {
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
 * Copy the one frozen ORT asyncify runtime into the built distribution.
 *
 * @param {{sourcePath?: string, distDirectory?: string, testHooks?: {afterCopy?: Function}}} [options]
 * @returns {Promise<{bytes: number, destinationPath: string, sha256: string, sourcePath: string}>}
 */
export async function copyOrtRuntime(options = {}) {
  const sourcePath = resolve(options.sourcePath ?? resolveOrtRuntimeSource());
  const distDirectory = resolve(options.distDirectory ?? defaultDistDirectory());
  const sourceBefore = await inspectRegularFile(sourcePath, 'ORT runtime source');
  if (sourceBefore.size !== BigInt(ORT_RUNTIME_BYTES)) {
    throw new Error(
      `ORT runtime source byte count must equal ${ORT_RUNTIME_BYTES}; found ${sourceBefore.size}`,
    );
  }

  const assetsDirectory = await prepareAssetsDirectory(distDirectory);
  await rejectAdditionalOrtRuntimeSiblings(assetsDirectory);
  const destinationPath = join(assetsDirectory, ORT_RUNTIME_NAME);
  if (sourcePath === resolve(destinationPath)) {
    throw new Error('ORT runtime source and destination must not be the same file');
  }

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
      createReadStream(sourcePath),
      hashingPassThrough,
      createWriteStream(destinationPath, { flags: 'w', mode: 0o644 }),
    );
  } catch (error) {
    throw new Error(`Could not stream-copy the ORT runtime: ${errorMessage(error)}`);
  }

  const sourceAfter = await inspectRegularFile(sourcePath, 'ORT runtime source');
  if (!sameFileIdentity(sourceBefore, sourceAfter) || copiedBytes !== ORT_RUNTIME_BYTES) {
    throw new Error('ORT runtime source changed while it was being copied');
  }

  await options.testHooks?.afterCopy?.({ assetsDirectory, destinationPath });
  await rejectAdditionalOrtRuntimeSiblings(assetsDirectory);

  const destinationStats = await inspectRegularFile(
    destinationPath,
    'ORT runtime destination',
  );
  if (destinationStats.size !== BigInt(ORT_RUNTIME_BYTES)) {
    throw new Error(
      `ORT runtime destination byte count must equal ${ORT_RUNTIME_BYTES}; found ${destinationStats.size}`,
    );
  }

  const sourceSha256 = sourceDigest.digest('hex');
  if (sourceSha256 !== ORT_RUNTIME_SHA256) {
    throw new Error(
      `ORT runtime source SHA-256 must equal ${ORT_RUNTIME_SHA256}; found ${sourceSha256}`,
    );
  }
  const destination = await hashFile(destinationPath);
  if (destination.bytes !== ORT_RUNTIME_BYTES) {
    throw new Error(
      `ORT runtime destination byte count must equal ${ORT_RUNTIME_BYTES}; found ${destination.bytes}`,
    );
  }
  if (
    destination.sha256 !== sourceSha256 ||
    destination.sha256 !== ORT_RUNTIME_SHA256
  ) {
    throw new Error(
      `ORT runtime destination SHA-256 does not match the source: ${destination.sha256}`,
    );
  }

  return {
    bytes: destination.bytes,
    destinationPath,
    sha256: destination.sha256,
    sourcePath,
  };
}

async function runCli() {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node tools/copy_ort_runtime.mjs');
  }
  const result = await copyOrtRuntime();
  console.log(
    `[ort-runtime] copied ${result.bytes} bytes (${result.sha256}) to ${result.destinationPath}`,
  );
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
