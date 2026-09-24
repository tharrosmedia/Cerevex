import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export function wordpressPluginRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'plugins/cerevex-wordpress'),
    path.resolve(process.cwd(), '../../plugins/cerevex-wordpress'),
    path.resolve(process.cwd(), '../plugins/cerevex-wordpress'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

export async function packWordpressPluginZip(): Promise<Buffer> {
  const pluginDir = wordpressPluginRoot();
  const scratch = await mkdtemp(path.join(tmpdir(), 'cerevex-wp-'));
  const zipPath = path.join(scratch, 'cerevex-wordpress.zip');
  try {
    await execFileAsync('zip', ['-r', '-q', zipPath, '.'], { cwd: pluginDir });
    return await readFile(zipPath);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
