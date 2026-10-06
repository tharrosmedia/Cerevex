import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isWordpressConnectVisible } from '@cerevex/contracts';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { WORDPRESS_CONNECT_OFF_REASON } from '@/src/lib/wordpress/connect-copy';
import { wordpressPluginRoot } from '@/src/lib/wordpress/plugin-zip';
import { wordpressConnectFlagsForAddSite } from '@/src/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storeId = await getActiveStoreId();
    const store = storeId ? await getStore(storeId) : null;
    const flags = await wordpressConnectFlagsForAddSite(store);
    if (!isWordpressConnectVisible(flags)) {
      return new NextResponse(WORDPRESS_CONNECT_OFF_REASON, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
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
