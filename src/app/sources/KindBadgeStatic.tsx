import type { DataKind } from '@/lib/types';

const S: Record<DataKind, [string, string]> = {
  forecast: ['Forecast', 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'],
  observation: ['Observed', 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'],
  reanalysis: ['Reanalysis', 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'],
  imported: ['Imported', 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'],
};

export function KindBadgeStatic({ kind }: { kind: DataKind }) {
  const [label, cls] = S[kind];
  return <span className={`chip ${cls}`}>{label}</span>;
}
