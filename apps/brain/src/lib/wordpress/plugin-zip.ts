import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ZIP_NAME = 'cerevex-wordpress.zip';

export function wordpressPluginRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'plugins/cerevex-wordpress'),
    path.resolve(process.cwd(), '../../plugins/cerevex-wordpress'),
    path.resolve(process.cwd(), '../plugins/cerevex-wordpress'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

/** Paths that exist when Brain's cwd is apps/brain, or the monorepo root. */
export function wordpressPluginZipCandidates(): string[] {
  return [
    path.resolve(process.cwd(), 'artifacts', ZIP_NAME),
    path.resolve(process.cwd(), 'apps', 'brain', 'artifacts', ZIP_NAME),
  ];
}

export function wordpressPluginZipPath(): string {
  return wordpressPluginZipCandidates().find((candidate) => existsSync(candidate))
    || wordpressPluginZipCandidates()[0];
}

export async function readWordpressPluginZipFile(zipPath: string): Promise<Buffer> {
  if (!existsSync(zipPath)) {
    throw new Error(`WordPress plugin zip is missing (${zipPath}).`);
  }
  const zip = await readFile(zipPath);
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`WordPress plugin zip is not a valid archive (${zipPath}).`);
  }
  return zip;
}

/** Serve the archive built into apps/brain. No `zip` shell. */
export async function readWordpressPluginZip(): Promise<Buffer> {
  const zipPath = wordpressPluginZipPath();
  return readWordpressPluginZipFile(zipPath);
}
