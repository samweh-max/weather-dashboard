'use client';

import type { DataKind, SeriesOrigin, WeatherDataset } from '@/lib/types';
import { formatTime, relativeAge } from '@/lib/time';
import type { ProviderInfo } from '@/lib/providers/types';

const KIND_STYLE: Record<DataKind | 'calculated', { label: string; cls: string; title: string }> = {
  forecast: { label: 'Forecast', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300', title: 'Model prediction' },
  observation: { label: 'Observed', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', title: 'Measured at a weather station' },
  reanalysis: { label: 'Reanalysis', cls: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300', title: 'Model reconstruction of past weather constrained by observations' },
  imported: { label: 'Imported', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300', title: 'Data you imported from a spreadsheet' },
  calculated: { label: 'Calculated', cls: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300', title: 'Derived by this app from provider values' },
};

export function KindBadge({ kind, glass }: { kind: DataKind | 'calculated'; glass?: boolean }) {
  const s = KIND_STYLE[kind];
  return (
    <span title={s.title} className={`chip ${glass ? 'border-white/30 bg-white/15 text-white' : s.cls}`}>
      {s.label}
    </span>
  );
}

export function OriginMark({ origin, note }: { origin?: SeriesOrigin; note?: string }) {
  if (origin !== 'calculated') return null;
  return (
    <span title={note ?? 'Calculated by this app'} className="ml-1 cursor-help align-super text-[10px] font-semibold text-muted">
      calc
    </span>
  );
}

export function SourceLine({ ds, timeZone, glass }: { ds: WeatherDataset; timeZone: string; glass?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${glass ? 'text-white/80' : 'text-muted'}`}>
      <KindBadge kind={ds.current?.kind ?? ds.kind} glass={glass} />
      <span>
        Source: <span className="font-medium">{ds.providerName}</span>
      </span>
      <span title={ds.updatedAt ?? undefined}>{ds.updatedAt ? `Model/data updated ${relativeAge(ds.updatedAt)}` : 'Provider update time not published'}</span>
      <span title={ds.fetchedAt}>Fetched {formatTime(ds.fetchedAt, timeZone)}</span>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent ${className}`} aria-label="Loading" />;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'error'; children: React.ReactNode }) {
  const cls = {
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    error: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200',
  }[kind];
  return <div className={`rounded-xl border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-line/60 ${className}`} />;
}

export type ProviderOption = ProviderInfo & { available: boolean; unavailableReason?: string };

export function ProviderSelect({
  providers,
  value,
  onChange,
  filter,
  glass,
  label = 'Source',
}: {
  providers: ProviderOption[];
  value: string;
  onChange: (id: string) => void;
  filter?: (p: ProviderOption) => boolean;
  glass?: boolean;
  label?: string;
}) {
  const list = filter ? providers.filter(filter) : providers;
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className={`sr-only`}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-xl border px-3 py-1.5 text-sm font-medium outline-none ${glass ? 'border-white/30 bg-white/15 text-white backdrop-blur-md [&>option]:text-slate-900' : 'border-line bg-surface text-ink'}`}
      >
        {list.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.available}>
            {p.name}
            {!p.available ? ` (${p.requiresKey && !p.enabled ? 'needs key' : 'not available here'})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'sm' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'xs' }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-canvas p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg ${size === 'xs' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} font-medium transition ${value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function WindArrow({ deg, className = 'h-4 w-4' }: { deg: number | null | undefined; className?: string }) {
  if (deg === null || deg === undefined) return null;
  // arrow points where the wind is blowing TO
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ transform: `rotate(${deg + 180}deg)` }} aria-label={`Wind from ${Math.round(deg)}°`}>
      <path d="M12 3 L17 13 L12 10.5 L7 13 Z" fill="currentColor" />
      <path d="M12 10 V21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function compass(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
