import { NextResponse } from 'next/server';
import { isWordpressConnectVisible } from '@cerevex/contracts';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { packWordpressPluginZip } from '@/src/lib/wordpress/plugin-zip';
import { wordpressFlagsFromStore } from '@/src/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storeId = await getActiveStoreId();
    const store = storeId ? await getStore(storeId) : null;
    if (!isWordpressConnectVisible(wordpressFlagsFromStore(store))) {
      return NextResponse.json({ ok: false, reason: 'WordPress is off for this workspace.' }, { status: 404 });
    }
    const zip = await packWordpressPluginZip();
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="cerevex-wordpress.zip"',
      },
    });
  } catch (error) {
    console.warn('[wordpress.plugin.zip] degraded', error);
    return NextResponse.json({ ok: false, reason: 'Could not build the plugin zip. Use the install note and the plugins/cerevex-wordpress folder.' }, { status: 503 });
  }
}
