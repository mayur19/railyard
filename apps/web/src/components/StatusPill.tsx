const LABELS: Record<string, string> = {
  timed_out: 'timed out',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill pill-${status}`} data-status={status}>
      {LABELS[status] ?? status}
    </span>
  );
}
