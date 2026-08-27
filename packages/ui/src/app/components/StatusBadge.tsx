import { Ban, Check, Circle, LoaderCircle, Minus, X } from 'lucide-react';
import type { ExecutionStatus } from '../domain/model.js';

export function StatusBadge({
  status,
  compact = false,
}: {
  readonly status: ExecutionStatus;
  readonly compact?: boolean;
}) {
  const Icon =
    status === 'passed'
      ? Check
      : status === 'failed'
        ? X
        : status === 'running'
          ? LoaderCircle
          : status === 'cancelled'
            ? Ban
            : status === 'skipped'
              ? Minus
              : Circle;
  return (
    <span className="tw-status" data-status={status}>
      <Icon aria-hidden="true" size={13} className={status === 'running' ? 'tw-spin' : undefined} />
      {compact ? null : <span>{status === 'queued' ? 'waiting' : status}</span>}
      <span className="sr-only">{status === 'queued' ? 'waiting' : status}</span>
    </span>
  );
}
