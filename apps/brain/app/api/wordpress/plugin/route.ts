import { NextResponse } from 'next/server';
import { isWordpressConnectVisible, type CapabilityFlags } from '@cerevex/contracts';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { WORDPRESS_CONNECT_OFF_REASON, WORDPRESS_CONNECT_SETTINGS_HREF } from '@/src/lib/wordpress/connect-copy';
import { WORDPRESS_PLUGIN_ZIP_UNAVAILABLE } from '@/src/lib/wordpress/plugin-download';
import { readWordpressPluginZip } from '@/src/lib/wordpress/plugin-zip';
import { wordpressConnectFlagsForAddSite } from '@/src/lib/wordpress';

export const dynamic = 'force-dynamic';

export async function wordpressPluginDownloadResponse(flags: CapabilityFlags): Promise<NextResponse> {
  if (!isWordpressConnectVisible(flags)) {
    return NextResponse.json(
      {
        ok: false,
        reason: WORDPRESS_CONNECT_OFF_REASON,
        settingsHref: WORDPRESS_CONNECT_SETTINGS_HREF,
      },
      { status: 404 },
    );
  }
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
}

export async function GET() {
  let flags: CapabilityFlags;
  try {
    const storeId = await getActiveStoreId();
    const store = storeId ? await getStore(storeId) : null;
    flags = await wordpressConnectFlagsForAddSite(store);
  } catch (error) {
    console.warn('[wordpress.plugin.zip] gate', error);
    return NextResponse.json({ ok: false, reason: 'Could not check WordPress for this workspace. Try again.' }, { status: 503 });
  }

  try {
    return await wordpressPluginDownloadResponse(flags);
  } catch (error) {
    console.warn('[wordpress.plugin.zip] missing', error);
    return NextResponse.json({ ok: false, reason: WORDPRESS_PLUGIN_ZIP_UNAVAILABLE }, { status: 503 });
  }
}
