import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  buildWordpressPluginZip,
  defaultPluginDir,
  defaultZipPath,
  writeWordpressPluginZip,
} from '../scripts/pack-wordpress-plugin.mjs';
import { pluginDownloadError, WORDPRESS_PLUGIN_ZIP_UNAVAILABLE } from '../src/lib/wordpress/plugin-download';
import { readWordpressPluginZip, readWordpressPluginZipFile } from '../src/lib/wordpress/plugin-zip';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../scripts/pack-wordpress-plugin.mjs', import.meta.url));

function unzipEntry(zip: Buffer, name: string): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'zip is missing an end record');
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const method = zip.readUInt16LE(cursor + 10);
    const compSize = zip.readUInt32LE(cursor + 20);
    const nameLen = zip.readUInt16LE(cursor + 28);
    const extraLen = zip.readUInt16LE(cursor + 30);
    const commentLen = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const entryName = zip.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    assert.equal(method, 0, `${name} should be stored, not deflated`);
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    return zip.subarray(start, start + compSize);
  }
  throw new Error(`Missing zip entry ${name}`);
}

const built = await buildWordpressPluginZip(defaultPluginDir);
const committed = await readFile(defaultZipPath);
assert.deepEqual(built, committed, 'Run node apps/brain/scripts/pack-wordpress-plugin.mjs and commit apps/brain/artifacts/cerevex-wordpress.zip');
assert.deepEqual(await buildWordpressPluginZip(defaultPluginDir), built);

const php = unzipEntry(built, 'cerevex-wordpress/cerevex.php').toString('utf8');
assert.match(php, /Version:\s*0\.1\.0/);
assert.match(php, /Plugin Name:\s*Cerevex/);
assert.match(unzipEntry(built, 'cerevex-wordpress/includes/class-cerevex-rest.php').toString('utf8'), /class Cerevex_Rest/);
assert.match(unzipEntry(built, 'cerevex-wordpress/INSTALL.txt').toString('utf8'), /Upload Plugin/);

const names: string[] = [];
{
  const eocd = built.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = built.readUInt16LE(eocd + 10);
  let cursor = built.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const nameLen = built.readUInt16LE(cursor + 28);
    const extraLen = built.readUInt16LE(cursor + 30);
    const commentLen = built.readUInt16LE(cursor + 32);
    names.push(built.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8'));
    cursor += 46 + nameLen + extraLen + commentLen;
  }
}
assert.ok(names.every((name) => name.startsWith('cerevex-wordpress/') && !name.split('/').includes('..')));
assert.deepEqual([...new Set(names.map((name) => name.split('/')[0]))], ['cerevex-wordpress']);

const served = await readWordpressPluginZip();
assert.deepEqual(served, committed);
await assert.rejects(readWordpressPluginZipFile(path.join(tmpdir(), 'missing-cerevex-wordpress.zip')));

const scratch = await mkdtemp(path.join(tmpdir(), 'cerevex-wp-zip-'));
try {
  const kept = path.join(scratch, 'kept.zip');
  await writeFile(kept, built);
  const keep = await execFileAsync(process.execPath, [scriptPath], {
    env: { ...process.env, CEREVEX_WP_PLUGIN_DIR: path.join(scratch, 'no-plugin'), CEREVEX_WP_PLUGIN_ZIP: kept },
  });
  assert.match(keep.stdout, /keeping/);
  assert.deepEqual(await readFile(kept), built);

  const missingOut = path.join(scratch, 'nested', 'missing.zip');
  await assert.rejects(writeWordpressPluginZip({
    pluginDir: path.join(scratch, 'no-plugin'),
    zipPath: missingOut,
  }));
  const failed = await execFileAsync(process.execPath, [scriptPath], {
    env: { ...process.env, CEREVEX_WP_PLUGIN_DIR: path.join(scratch, 'no-plugin'), CEREVEX_WP_PLUGIN_ZIP: missingOut },
  }).then(() => {
    throw new Error('packer should fail when source and archive are both missing');
  }, (error: { code?: number; stderr?: string }) => error);
  assert.equal(failed.code, 1);
  assert.match(String(failed.stderr), /was not committed/);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const unavailable = new Response(JSON.stringify({
  ok: false,
  reason: WORDPRESS_PLUGIN_ZIP_UNAVAILABLE,
}), { status: 503, headers: { 'content-type': 'application/json' } });
assert.equal(await pluginDownloadError(unavailable), WORDPRESS_PLUGIN_ZIP_UNAVAILABLE);
assert.equal(await pluginDownloadError(new Response('nope', { status: 503, headers: { 'content-type': 'text/plain' } })), WORDPRESS_PLUGIN_ZIP_UNAVAILABLE);
assert.equal(await pluginDownloadError(new Response(JSON.stringify({ error: 'Sign in required.' }), {
  status: 401,
  headers: { 'content-type': 'application/json' },
})), 'Sign in again to download the plugin.');
assert.equal(await pluginDownloadError(new Response(JSON.stringify({ reason: 'WordPress is off for this workspace.' }), {
  status: 404,
  headers: { 'content-type': 'application/json' },
})), 'WordPress is off for this workspace.');

console.log('wordpress-plugin-zip.test.ts ok');
