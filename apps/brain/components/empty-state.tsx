import Link from 'next/link';
import type { ReactNode } from 'react';

export function EmptyState({
  message,
  actionHref,
  actionLabel,
  action,
}: {
  message: string;
  actionHref?: string;
  actionLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cx-empty">
      <p>{message}</p>
      {action ? (
        action
      ) : actionHref && actionLabel ? (
        <Link href={actionHref} className="btn-cta">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
