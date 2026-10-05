export const defaultPluginDir: string;
export const defaultZipPath: string;

export function buildWordpressPluginZip(pluginDir?: string): Promise<Buffer>;

export function writeWordpressPluginZip(options?: {
  pluginDir?: string;
  zipPath?: string;
}): Promise<{ wrote: boolean; zipPath: string; bytes?: number; reason?: string }>;
