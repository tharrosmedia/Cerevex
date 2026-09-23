import { jobStatusLabel, jobStatusTone, type StatusTone } from '@/lib/job-labels';

export function StatusBadge({
  status,
  label,
  tone,
}: {
  status?: string | null;
  label?: string;
  tone?: StatusTone;
}) {
  const resolvedTone = tone ?? jobStatusTone(status);
  return <span className={`cx-badge cx-badge-${resolvedTone}`}>{label ?? jobStatusLabel(status)}</span>;
}
