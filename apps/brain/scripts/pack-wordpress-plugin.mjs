/**
 * Build apps/brain/artifacts/cerevex-wordpress.zip from plugins/cerevex-wordpress.
 *
 * Brain's production image is Railpack from the repo root (`npm run build` →
 * this workspace's prebuild). That image does not include the `zip` binary, so
 * the download route must not shell out. This script writes a stored zip with
 * Node during `npm run build`.
 *
 * Railway's current Brain service builds the monorepo, so the plugin source is
 * available and this regenerates the archive. If a deploy root is only
 * apps/brain, plugins/ is absent: keep the committed archive and exit 0.
 * Fail the build only when both the source and the archive are missing.
 *
 * WordPress expects one top-level folder. Entries are `cerevex-wordpress/...`.
 * The archive is deterministic (fixed timestamp, sorted names) so a rebuild
 * does not churn git when the plugin bytes are unchanged.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const brainRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(brainRoot, '../..');

export const defaultPluginDir = path.join(repoRoot, 'plugins', 'cerevex-wordpress');
export const defaultZipPath = path.join(brainRoot, 'artifacts', 'cerevex-wordpress.zip');

const ZIP_FOLDER = 'cerevex-wordpress';
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (~c) >>> 0;
}

function dosHeader(signature, name, data, localOffset) {
  const nameBytes = Buffer.from(name);
  const size = data.length;
  const crc = crc32(data);
  const header = Buffer.alloc(localOffset == null ? 30 : 46);
  header.writeUInt32LE(signature, 0);
  if (localOffset == null) {
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    return { header, nameBytes, crc, size };
  }
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return { header, nameBytes };
}

export function createStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    if (file.name.includes('\\') || file.name.startsWith('/') || file.name.split('/').includes('..')) {
      throw new Error(`Unsafe zip entry: ${file.name}`);
    }
    const local = dosHeader(0x04034b50, file.name, file.data, null);
    locals.push(local.header, local.nameBytes, file.data);
    const central = dosHeader(0x02014b50, file.name, file.data, offset);
    centrals.push(central.header, central.nameBytes);
    offset += local.header.length + local.nameBytes.length + file.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

async function pluginFiles(pluginDir) {
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(full, rel));
      } else if (entry.isFile()) {
        files.push({ name: `${ZIP_FOLDER}/${rel}`, data: await readFile(full) });
      }
    }
    return files;
  }
  const files = await walk(pluginDir, '');
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some((file) => file.name === `${ZIP_FOLDER}/cerevex.php`)) {
    throw new Error(`plugins/cerevex-wordpress is missing cerevex.php (${pluginDir}).`);
  }
  return files;
}

export async function buildWordpressPluginZip(pluginDir = defaultPluginDir) {
  return createStoredZip(await pluginFiles(pluginDir));
}

export async function writeWordpressPluginZip(options = {}) {
  const pluginDir = options.pluginDir || defaultPluginDir;
  const zipPath = options.zipPath || defaultZipPath;
  if (!existsSync(pluginDir)) {
    if (existsSync(zipPath)) return { wrote: false, zipPath, reason: 'source-missing' };
    throw new Error('plugins/cerevex-wordpress is missing and apps/brain/artifacts/cerevex-wordpress.zip was not committed.');
  }
  const zip = await buildWordpressPluginZip(pluginDir);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await writeFile(zipPath, zip);
  return { wrote: true, zipPath, bytes: zip.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pluginDir = process.env.CEREVEX_WP_PLUGIN_DIR || defaultPluginDir;
  const zipPath = process.env.CEREVEX_WP_PLUGIN_ZIP || defaultZipPath;
  writeWordpressPluginZip({ pluginDir, zipPath })
    .then((result) => {
      if (result.wrote) {
        console.log(`Wrote ${result.zipPath} (${result.bytes} bytes)`);
      } else {
        console.log(`Plugin source missing; keeping ${result.zipPath}`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
