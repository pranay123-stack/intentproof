/** Presentation helpers. Nothing here is used for enforcement. */

export function shortHash(hash: string, lead = 10, tail = 6): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function usd(value: number | undefined | null): string {
  if (value === undefined || value === null) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

export function bps(value: number | undefined | null): string {
  if (value === undefined || value === null) return '—';
  return `${value / 100}%`;
}

export function timestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC');
}

export function relativeDuration(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (Number.isNaN(ms)) return '—';
  const hours = ms / 3_600_000;
  if (Math.abs(hours) < 1) return `${Math.round(ms / 60_000)} min`;
  if (Math.abs(hours) < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/gu, ' ')
    .replace(/\b\w/gu, (c) => c.toUpperCase());
}
