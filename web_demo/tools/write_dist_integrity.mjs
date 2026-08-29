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

function containedRelativePath(root, candidate, { allowRoot = false } = {}) {
  const relativePath = relative(root, resolve(candidate));
  if (relativePath === '' && allowRoot) {
    return relativePath;
  }
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Path escapes the resolved dist directory: ${candidate}`);
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

function isWriterTempName(name) {
  return name.startsWith(TEMP_PREFIX) && name.endsWith(TEMP_SUFFIX);
}

function isSameEntry(left, right) {
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

  const root = await realpath(requestedRoot);
  const resolvedStats = await lstat(root, { bigint: true });
  if (resolvedStats.isSymbolicLink() || !resolvedStats.isDirectory()) {
    throw new Error(`Resolved dist path must be a real directory: ${root}`);
  }
  return root;
}

async function realPathWithin(root, candidate, label, { allowRoot = false } = {}) {
  const resolvedPath = await realpath(candidate);
  try {
    containedRelativePath(root, resolvedPath, { allowRoot });
  } catch {
    throw new Error(`${label} resolves outside the dist directory: ${resolvedPath}`);
  }
  return resolvedPath;
}

async function inspectDirectory(root, absolutePath, path) {
  const label = path === '' ? 'Dist root' : `Dist directory ${path}`;
  const stats = await lstat(absolutePath, { bigint: true });
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} is a symlink; symlinks are not allowed`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} changed type and is no longer a directory`);
  }
  const resolvedPath = await realPathWithin(root, absolutePath, label, {
    allowRoot: path === '',
  });
  return { resolvedPath, stats };
}

async function inspectFile(root, absolutePath, path) {
  const label = `Dist entry ${path}`;
  const stats = await lstat(absolutePath, { bigint: true });
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} is a symlink; symlinks are not allowed`);
  }
  if (!stats.isFile()) {
    throw new Error(`${label} changed type and is no longer a regular file`);
  }
  const resolvedPath = await realPathWithin(root, absolutePath, label);
  return { resolvedPath, stats };
}

async function removeStaleWriterTemps(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!isWriterTempName(entry.name)) {
      continue;
    }

    const absolutePath = join(root, entry.name);
    containedRelativePath(root, absolutePath);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Writer-owned temporary output ${entry.name} must be a regular file, not a symlink`,
      );
    }
    const stats = await lstat(absolutePath, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Writer-owned temporary output ${entry.name} must be a regular file`);
    }
    await realPathWithin(root, absolutePath, `Writer-owned temporary output ${entry.name}`);
    await unlink(absolutePath);
  }
}

async function enumerateFiles(root, hooks) {
  const files = [];

  async function visit(directory, path) {
    const before = await inspectDirectory(root, directory, path);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    await hooks.afterDirectoryRead?.({ absolutePath: directory, path });

    const afterRead = await inspectDirectory(root, directory, path);
    if (
      !isSameEntry(before.stats, afterRead.stats) ||
      before.resolvedPath !== afterRead.resolvedPath
    ) {
      throw new Error(`Dist directory ${path || '.'} changed while it was being read`);
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const entryPath = manifestPath(containedRelativePath(root, absolutePath));
      if (entry.isSymbolicLink()) {
        throw new Error(`Dist entry ${entryPath} is a symlink; symlinks are not allowed`);
      }

      const stats = await lstat(absolutePath, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(`Dist entry ${entryPath} is a symlink; symlinks are not allowed`);
      }
      if (entryPath === MANIFEST_NAME) {
        if (!stats.isFile()) {
          throw new Error(`Dist output ${MANIFEST_NAME} must be a regular file`);
        }
        await realPathWithin(root, absolutePath, `Dist output ${MANIFEST_NAME}`);
        continue;
      }
      if (directory === root && isWriterTempName(entry.name)) {
        throw new Error(
          `Writer-owned temporary output ${entry.name} appeared during enumeration; concurrent writers are unsupported`,
        );
      }
      if (stats.isDirectory()) {
        await visit(absolutePath, entryPath);
      } else if (stats.isFile()) {
        const resolvedPath = await realPathWithin(
          root,
          absolutePath,
          `Dist entry ${entryPath}`,
        );
        files.push({ absolutePath, path: entryPath, resolvedPath, stats });
      }
    }

    const afterRecursion = await inspectDirectory(root, directory, path);
    if (
      !isSameEntry(before.stats, afterRecursion.stats) ||
      before.resolvedPath !== afterRecursion.resolvedPath
    ) {
      throw new Error(`Dist directory ${path || '.'} changed during enumeration`);
    }
  }

  await visit(root, '');
  files.sort((left, right) => lexicalCompare(left.path, right.path));
  return files;
}

async function hashFile(root, file, hooks) {
  let handle;
  let primaryError;
  try {
    const before = await inspectFile(root, file.absolutePath, file.path);
    if (
      !isSameEntry(file.stats, before.stats) ||
      file.resolvedPath !== before.resolvedPath
    ) {
      throw new Error(`Dist entry ${file.path} changed before hashing`);
    }

    handle = await open(file.absolutePath, constants.O_RDONLY | NO_FOLLOW);
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !isSameEntry(before.stats, openedBefore)) {
      throw new Error(`Dist entry ${file.path} changed while opening for hashing`);
    }
    await hooks.afterFileOpen?.({ absolutePath: file.absolutePath, path: file.path });

    const hash = createHash('sha256');
    let bytes = 0n;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += BigInt(chunk.byteLength);
    }

    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await inspectFile(root, file.absolutePath, file.path);
    if (
      !isSameEntry(openedBefore, openedAfter) ||
      !isSameEntry(openedAfter, pathAfter.stats) ||
      before.resolvedPath !== pathAfter.resolvedPath ||
      bytes !== openedAfter.size
    ) {
      throw new Error(`Dist entry ${file.path} changed while hashing`);
    }
    if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Dist entry ${file.path} is too large for an exact byte count`);
    }

    return { path: file.path, bytes: Number(bytes), sha256: hash.digest('hex') };
  } catch (error) {
    const actionable =
      error instanceof Error && error.message.startsWith('Dist entry ')
        ? error
        : new Error(`Could not hash dist entry ${file.path}: ${errorMessage(error)}`);
    primaryError = actionable;
    throw actionable;
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      if (primaryError === undefined) {
        throw new Error(`Could not close dist entry ${file.path}: ${errorMessage(error)}`);
      }
    }
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
  let primaryError;
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

    try {
      const outputStats = await lstat(output, { bigint: true });
      if (outputStats.isSymbolicLink() || !outputStats.isFile()) {
        throw new Error(`Dist output ${MANIFEST_NAME} must be a regular file`);
      }
      await realPathWithin(root, output, `Dist output ${MANIFEST_NAME}`);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw error;
      }
    }

    await rename(temporary, output);
    temporaryExists = false;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError;
    try {
      await handle?.close();
    } catch (error) {
      cleanupError = error;
    }
    if (temporaryExists) {
      try {
        await unlink(temporary);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT' && cleanupError === undefined) {
          cleanupError = error;
        }
      }
    }
    if (primaryError === undefined && cleanupError !== undefined) {
      throw new Error(`Could not clean up integrity output: ${errorMessage(cleanupError)}`);
    }
  }
}

/**
 * Build and atomically write a deterministic integrity manifest.
 * Concurrent writers targeting the same dist directory are unsupported.
 *
 * @param {string} distDirectory explicit path to the dist directory
 * @param {{afterDirectoryRead?: Function, afterFileOpen?: Function}} [testHooks]
 * internal hooks used only for deterministic filesystem-race tests
 * @returns {Promise<{schema_version: 1, files: Array<{path: string, bytes: number, sha256: string}>}>}
 */
export async function buildIntegrityManifest(distDirectory, testHooks = {}) {
  const root = await resolveDistRoot(distDirectory);
  await removeStaleWriterTemps(root);
  const files = await enumerateFiles(root, testHooks);
  const entries = [];
  for (const file of files) {
    entries.push(await hashFile(root, file, testHooks));
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
