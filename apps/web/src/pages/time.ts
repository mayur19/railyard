export function formatDuration(start: string | null, end: string | null, now = Date.now()): string {
  if (!start) return '—';
  const ms = (end ? Date.parse(end) : now) - Date.parse(start);
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
