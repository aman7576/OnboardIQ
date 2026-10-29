const TZ = 'Asia/Kolkata'; // the bank works in IST

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:30`)
    : new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: TZ,
      }).format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: TZ,
      }).format(d);
}

export const formatPercent = (rate: number | null | undefined, digits = 1): string =>
  rate === null || rate === undefined ? 'n/a' : `${(rate * 100).toFixed(digits)}%`;
export const formatRatio = (r: { correct: number; total: number; rate: number | null }): string =>
  r.rate === null ? 'n/a' : `${(r.rate * 100).toFixed(1)}% (${r.correct}/${r.total})`;
export const formatScore = (score: number | null | undefined): string =>
  score === null || score === undefined ? 'n/a' : score.toFixed(4);
export const formatInr = (n: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'n/a';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} days`;
}

export const formatBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1_048_576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1_048_576).toFixed(2)} MB`;

/** "PAN_CARD" -> "PAN card" */
export const humanize = (code: string): string => {
  const t = code.toLowerCase().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
