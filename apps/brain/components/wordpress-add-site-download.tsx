import { WordpressPluginDownload } from '@/components/wordpress-plugin-download';
import {
  WORDPRESS_CONNECT_OFF_REASON,
  WORDPRESS_CONNECT_SETTINGS_HREF,
} from '@/src/lib/wordpress/connect-copy';

const OFF_LINK = 'Settings → Modules & flags';
const [OFF_BEFORE, OFF_AFTER] = WORDPRESS_CONNECT_OFF_REASON.split(OFF_LINK);

export function WordpressAddSiteDownload({ visible }: { visible: boolean }) {
  if (!visible) {
    return (
      <p className="cx-help">
        {OFF_BEFORE}
        <a className="underline" href={WORDPRESS_CONNECT_SETTINGS_HREF}>{OFF_LINK}</a>
        {OFF_AFTER}
      </p>
    );
  }

  return (
    <WordpressPluginDownload
      trailing={<a href="/api/wordpress/install-note">Install steps</a>}
    />
  );
}
