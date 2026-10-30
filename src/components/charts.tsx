'use client';

import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatTime, safeTimeZone } from '@/lib/time';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  dash?: string;
  type?: 'line' | 'bar' | 'area';
  /** Decimals in the tooltip. */
  decimals?: number;
}

export interface ChartRow {
  /** epoch ms; for daily data use local noon of the date in UTC */
  t: number;
  [key: string]: number | null;
}

interface Props {
  rows: ChartRow[];
  series: ChartSeries[];
  unit: string;
  timeZone: string;
  daily?: boolean;
  height?: number;
  /** Draw a "now" marker */
  now?: number;
  yDomain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax'];
  showLegend?: boolean;
}

function fmtTick(t: number, tz: string, daily: boolean, spanDays: number) {
  if (daily) {
    return new Intl.DateTimeFormat(undefined, spanDays > 120 ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(t));
  }
  if (spanDays > 4) return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', timeZone: safeTimeZone(tz) }).format(new Date(t));
  return formatTime(new Date(t).toISOString(), tz, { hour: '2-digit', minute: '2-digit' });
}

function TooltipBox({ active, payload, label, series, unit, timeZone, daily }: { active?: boolean; payload?: { dataKey: string; value: number | null }[]; label?: number; series: ChartSeries[]; unit: string; timeZone: string; daily?: boolean }) {
  if (!active || !payload?.length || label === undefined) return null;
  const when = daily
    ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(label))
    : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: safeTimeZone(timeZone) }).format(new Date(label));
  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div className="min-w-[180px] rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 font-medium text-ink">{when}</div>
      {series.map((s) => {
        const v = byKey.get(s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-2 text-muted">
              <svg width="14" height="6" aria-hidden>
                <line x1="0" y1="3" x2="14" y2="3" stroke={s.color} strokeWidth={s.type === 'bar' ? 6 : 2.5} strokeDasharray={s.dash} />
              </svg>
              {s.label}
            </span>
            <span className="font-medium tabular-nums text-ink">{v === null || v === undefined ? 'n/a' : `${v.toLocaleString(undefined, { maximumFractionDigits: s.decimals ?? 1 })} ${unit}`}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TimeChart({ rows, series, unit, timeZone, daily = false, height = 240, now, yDomain, showLegend }: Props) {
  if (!rows.length || !series.length) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>No data to chart.</div>;
  const span = (rows[rows.length - 1].t - rows[0].t) / 86400000;
  const hasData = series.some((s) => rows.some((r) => r[s.key] !== null && r[s.key] !== undefined));
  if (!hasData) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>Not available from this source.</div>;
  const barSize = Math.max(2, Math.min(18, 600 / rows.length / Math.max(1, series.filter((s) => s.type === 'bar').length)));
  return (
    <div>
      {showLegend && series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth={s.type === 'bar' ? 6 : 2.5} strokeDasharray={s.dash} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs>
              {series
                .filter((s) => s.type === 'area')
                .map((s) => (
                  <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtTick(t, timeZone, daily, span)} minTickGap={36} tickLine={false} />
            <YAxis tickLine={false} axisLine={false} width={52} domain={yDomain ?? ['auto', 'auto']} tickFormatter={(v: number) => `${Number(v.toFixed(2))}`} />
            <Tooltip content={<TooltipBox series={series} unit={unit} timeZone={timeZone} daily={daily} />} cursor={{ stroke: 'rgb(var(--muted))', strokeWidth: 1, strokeDasharray: '3 3' }} />
            {now && <ReferenceLine x={now} stroke="rgb(var(--muted))" strokeDasharray="2 4" label={{ value: 'now', position: 'insideTopLeft', fontSize: 10 }} />}
            {series.map((s) =>
              s.type === 'bar' ? (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} barSize={barSize} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              ) : s.type === 'area' ? (
                <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} fill={`url(#grad-${s.key})`} connectNulls={false} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} isAnimationActive={false} type="monotone" />
              ) : (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} isAnimationActive={false} type="monotone" />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Daily date ("2024-03-01") → chart x value (noon UTC so it never shifts across zones). */
export const dayToT = (date: string) => Date.parse(`${date}T12:00:00Z`);
