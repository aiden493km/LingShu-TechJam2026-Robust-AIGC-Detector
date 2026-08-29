import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MANIFEST_NAME = 'integrity.json';
const TEMP_PREFIX = '.integrity.json.';
const TEMP_SUFFIX = '.tmp';
const NO_FOLLOW =
  typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function containedRelativePath(root, candidate) {
  const relativePath = relative(root, resolve(candidate));
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Dist entry escapes the resolved dist directory: ${candidate}`);
  }
  return relativePath;
}

function manifestPath(relativePath) {
  const normalized = relativePath.split(sep).join('/');
  const parts = normalized.split('/');
  if (
    normalized.includes('\\') ||
    parts.some((part) => part === '' || part === '.' || part === '..') ||
    parts[0]?.includes(':')
  ) {
    throw new Error(`Dist entry path is not safely normalizable: ${relativePath}`);
  }
  return normalized;
}

function isTemporaryManifest(path) {
  return (
    !path.includes('/') &&
    path.startsWith(TEMP_PREFIX) &&
    path.endsWith(TEMP_SUFFIX)
  );
}

function isSameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function resolveDistRoot(distDirectory) {
  if (typeof distDirectory !== 'string' || distDirectory.trim() === '') {
    throw new TypeError('An explicit dist directory path is required');
  }

  const requestedRoot = resolve(distDirectory);
  let stats;
  try {
    stats = await lstat(requestedRoot, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new Error(`Dist directory does not exist: ${requestedRoot}`);
    }
    throw new Error(`Could not inspect dist directory: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Dist directory must not be a symlink: ${requestedRoot}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Dist path must be a directory: ${requestedRoot}`);
  }
  return realpath(requestedRoot);
}

async function enumerateFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => lexicalCompare(left.name, right.name));

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = manifestPath(containedRelativePath(root, absolutePath));
      if (entry.isSymbolicLink()) {
        throw new Error(`Dist entry ${path} is a symlink; symlinks are not allowed`);
      }

      const stats = await lstat(absolutePath, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(`Dist entry ${path} is a symlink; symlinks are not allowed`);
      }
      if (path === MANIFEST_NAME) {
        if (!stats.isFile()) {
          throw new Error(`Dist output ${MANIFEST_NAME} must be a regular file`);
        }
        continue;
      }
      if (stats.isFile() && isTemporaryManifest(path)) {
        continue;
      }
      if (stats.isDirectory()) {
        await visit(absolutePath);
      } else if (stats.isFile()) {
        files.push({ absolutePath, path, stats });
      }
    }
  }

  await visit(root);
  files.sort((left, right) => lexicalCompare(left.path, right.path));
  return files;
}

async function hashFile(file) {
  let handle;
  try {
    const before = await lstat(file.absolutePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || !isSameFile(file.stats, before)) {
      throw new Error(`Dist entry ${file.path} changed before hashing`);
    }

    handle = await open(file.absolutePath, constants.O_RDONLY | NO_FOLLOW);
    const hash = createHash('sha256');
    let bytes = 0n;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += BigInt(chunk.byteLength);
    }

    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(file.absolutePath, { bigint: true });
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !isSameFile(before, openedAfter) ||
      !isSameFile(openedAfter, pathAfter) ||
      bytes !== openedAfter.size
    ) {
      throw new Error(`Dist entry ${file.path} changed while hashing`);
    }
    if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Dist entry ${file.path} is too large for an exact byte count`);
    }

    return { path: file.path, bytes: Number(bytes), sha256: hash.digest('hex') };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Dist entry ')) {
      throw error;
    }
    throw new Error(`Could not hash dist entry ${file.path}: ${errorMessage(error)}`);
  } finally {
    await handle?.close();
  }
}

async function writeManifestAtomically(root, contents) {
  const output = join(root, MANIFEST_NAME);
  containedRelativePath(root, output);
  const temporary = join(
    root,
    `${TEMP_PREFIX}${process.pid}.${randomBytes(12).toString('hex')}${TEMP_SUFFIX}`,
  );
  containedRelativePath(root, temporary);

  let temporaryExists = false;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    temporaryExists = true;
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, output);
    temporaryExists = false;
  } finally {
    await handle?.close();
    if (temporaryExists) {
      try {
        await unlink(temporary);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
}

/**
 * @param {string} distDirectory explicit path to the dist directory
 * @returns {Promise<{schema_version: 1, files: Array<{path: string, bytes: number, sha256: string}>}>}
 */
export async function buildIntegrityManifest(distDirectory) {
  const root = await resolveDistRoot(distDirectory);
  const files = await enumerateFiles(root);
  const entries = [];
  for (const file of files) {
    entries.push(await hashFile(file));
  }

  const manifest = { schema_version: 1, files: entries };
  await writeManifestAtomically(root, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    throw new Error('Usage: node tools/write_dist_integrity.mjs [dist-directory]');
  }
  const defaultDist = fileURLToPath(new URL('../dist/', import.meta.url));
  const distDirectory = arguments_[0] ?? defaultDist;
  const manifest = await buildIntegrityManifest(distDirectory);
  console.log(
    `[dist-integrity] wrote ${manifest.files.length} entries to ${resolve(distDirectory, MANIFEST_NAME)}`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    await runCli();
  } catch (error) {
    console.error(`[dist-integrity] ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
