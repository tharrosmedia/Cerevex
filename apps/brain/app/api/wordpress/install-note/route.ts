import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isWordpressConnectVisible } from '@cerevex/contracts';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { wordpressPluginRoot } from '@/src/lib/wordpress/plugin-zip';
import { wordpressFlagsFromStore } from '@/src/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storeId = await getActiveStoreId();
    const store = storeId ? await getStore(storeId) : null;
    if (!isWordpressConnectVisible(wordpressFlagsFromStore(store))) {
      return new NextResponse('WordPress is off for this workspace.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const note = await readFile(path.join(wordpressPluginRoot(), 'INSTALL.txt'), 'utf8');
    return new NextResponse(note, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new NextResponse('Install the Cerevex plugin zip, then paste the site URL and plugin key in Settings.', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
