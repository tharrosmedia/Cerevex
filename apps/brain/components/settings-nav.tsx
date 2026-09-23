import type { ReactNode } from 'react';
import { SETTINGS_SECTIONS } from '@/lib/settings-nav';

export function SettingsNav() {
  return (
    <nav className="cx-settings-nav" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map((section) => (
        <a key={section.id} href={`#${section.id}`}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}

export function Flash({
  children,
  tone = 'ok',
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className={tone === 'warn' ? 'cx-banner cx-banner-warn' : 'cx-banner'} role="status">
      {children}
    </div>
  );
}
