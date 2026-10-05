import { NextResponse } from 'next/server';
import { isWordpressConnectVisible } from '@cerevex/contracts';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { WORDPRESS_PLUGIN_ZIP_UNAVAILABLE } from '@/src/lib/wordpress/plugin-download';
import { readWordpressPluginZip } from '@/src/lib/wordpress/plugin-zip';
import { wordpressFlagsFromStore } from '@/src/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storeId = await getActiveStoreId();
    const store = storeId ? await getStore(storeId) : null;
    if (!isWordpressConnectVisible(wordpressFlagsFromStore(store))) {
      return NextResponse.json({ ok: false, reason: 'WordPress is off for this workspace.' }, { status: 404 });
    }
  } catch (error) {
    console.warn('[wordpress.plugin.zip] gate', error);
    return NextResponse.json({ ok: false, reason: 'Could not check WordPress for this workspace. Try again.' }, { status: 503 });
  }

  try {
    const zip = await readWordpressPluginZip();
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(zip.length),
        'content-disposition': 'attachment; filename="cerevex-wordpress.zip"',
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    console.warn('[wordpress.plugin.zip] missing', error);
    return NextResponse.json({ ok: false, reason: WORDPRESS_PLUGIN_ZIP_UNAVAILABLE }, { status: 503 });
  }
}
