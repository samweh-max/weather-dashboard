'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { locationQuery, useApp } from '@/components/AppState';
import { dayToT, TimeChart, type ChartRow, type ChartSeries } from '@/components/charts';
import { LocationSearch } from '@/components/LocationSearch';
import { KindBadge, Notice, OriginMark, PageHeader, Segmented, Skeleton } from '@/components/ui';
import { useJson } from '@/components/useJson';
import { useProviders } from '@/components/useProviders';
import { seriesStyle } from '@/lib/palette';
import { describe, expectedSteps, periodSummaries } from '@/lib/stats';
import { addDays, displayZone, formatDate, formatTime, todayIn } from '@/lib/time';
import type { ImportedDatasetMeta, ProviderResult, WeatherDataset } from '@/lib/types';
import { toDisplay, unitFor, type UnitPrefs } from '@/lib/units';
import { getVariable, VARIABLES } from '@/lib/variables';

const DEFAULT_VARS = { hourly: ['temperature', 'precipitation', 'wind_speed', 'relative_humidity'], daily: ['temperature_max', 'temperature_min', 'temperature_mean', 'precipitation', 'wind_gusts_max'] };

type Preset = '30d' | '90d' | '1y' | '5y' | '30y' | 'custom';

function presetRange(p: Preset, end: string): [string, string] {
  const days = { '30d': 30, '90d': 90, '1y': 365, '5y': 365 * 5, '30y': 365 * 30, custom: 30 }[p];
  return [addDays(end, -days + 1), end];
}

export default function HistoryPage() {
  const { location, prefs } = useApp();
  const providers = useProviders(location).filter((p) => p.historyRange);
  const { data: dsList } = useJson<{ datasets: ImportedDatasetMeta[] }>('/api/datasets');
  const datasets = dsList?.datasets ?? [];

  const [source, setSource] = useState('om-era5');
  const [compareWith, setCompareWith] = useState('');
  const [res, setRes] = useState<'hourly' | 'daily'>('daily');
  const latestEra5 = addDays(todayIn('UTC'), -6);
  const [preset, setPreset] = useState<Preset>('1y');
  const [[start, end], setRange] = useState<[string, string]>(() => presetRange('1y', latestEra5));
  const [vars, setVars] = useState<string[]>(DEFAULT_VARS.daily);

  // A link like /history?dataset=<id> opens an imported dataset
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('dataset');
    if (id) setSource(`import:${id}`);
  }, []);

  const importedMeta = source.startsWith('import:') ? datasets.find((d) => d.id === source.slice(7)) : undefined;

  // keep range sensible for the chosen source
  useEffect(() => {
    if (importedMeta) {
      const s = importedMeta.resolution === 'daily' ? importedMeta.start : importedMeta.start.slice(0, 10);
      const e = importedMeta.resolution === 'daily' ? importedMeta.end : importedMeta.end.slice(0, 10);
      setRange([s, e]);
      setPreset('custom');
      setRes(importedMeta.resolution);
    } else if (source === 'nws-obs') {
      setRange([addDays(todayIn('UTC'), -6), todayIn('UTC')]);
      setPreset('custom');
      setRes('hourly');
    }
  }, [source, importedMeta]);

  useEffect(() => {
    setVars((v) => {
      const keep = v.filter((id) => getVariable(id)?.resolutions.includes(res));
      return keep.length ? keep : DEFAULT_VARS[res];
    });
  }, [res]);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') {
      setRange(presetRange(p, latestEra5));
      if ((p === '5y' || p === '30y') && res === 'hourly') setRes('daily');
    }
  };

  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const tooLong = res === 'hourly' && days > 366 * 3;
  const urlFor = (src: string) => {
    if (!src || tooLong) return null;
    if (src.startsWith('import:')) return `/api/datasets/${src.slice(7)}?start=${start}&end=${end}`;
    return `/api/history?provider=${src}&${locationQuery(location)}&start=${start}&end=${end}&res=${res}`;
  };
  const primary = useJson<ProviderResult>(urlFor(source));
  const secondary = useJson<ProviderResult>(compareWith && compareWith !== source ? urlFor(compareWith) : null);
  const sets = [primary.data, secondary.data].filter((r): r is { ok: true; data: WeatherDataset } => !!r && r.ok).map((r) => r.data);
  const errors = [primary.data, secondary.data].filter((r) => r && !r.ok) as { ok: false; error: { providerName: string; error: string } }[];
  const tz = displayZone(prefs.timezone, sets[0]?.timezone ?? location.timezone);

  const available = useMemo(() => {
    const ids = new Set(sets.flatMap((d) => Object.keys(d[res]?.series ?? {})));
    return VARIABLES.filter((v) => ids.has(v.id) && v.resolutions.includes(res));
  }, [sets, res]);

  const sourceOptions = [
    ...providers.map((p) => ({ id: p.id, label: `${p.name}${p.available ? '' : ' (not available here)'}`, disabled: !p.available })),
    ...datasets.map((d) => ({ id: `import:${d.id}`, label: `Imported: ${d.name} (${d.resolution})`, disabled: false })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="History"
        subtitle={
          <>
            Explore past weather back to 1940 from the ERA5 reanalysis, recent US station observations, or your own imported datasets. Use the{' '}
            <Link href="/export" className="underline">
              Export
            </Link>{' '}
            page to download any of it to Excel.
          </>
        }
      />

      <div className="card mb-6 space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <span className="label">Location</span>
            {importedMeta ? (
              <p className="py-2 text-sm">{importedMeta.location?.name ?? 'Location stored with the dataset'} <span className="text-muted">(from the imported dataset)</span></p>
            ) : (
              <>
                <LocationSearch />
                <p className="mt-1 text-xs text-muted">
                  {location.name} · {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)}
                </p>
              </>
            )}
          </div>
          <div>
            <span className="label">Source</span>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              {sourceOptions.map((o) => (
                <option key={o.id} value={o.id} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Compare with (optional)</span>
            <select className="input" value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
              <option value="">None</option>
              {sourceOptions
                .filter((o) => o.id !== source)
                .map((o) => (
                  <option key={o.id} value={o.id} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Period</span>
            <Segmented
              size="xs"
              value={preset}
              onChange={choosePreset}
              options={[
                { value: '30d', label: '30 days' },
                { value: '90d', label: '90 days' },
                { value: '1y', label: '1 year' },
                { value: '5y', label: '5 years' },
                { value: '30y', label: '30 years' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>
          <div className="flex items-end gap-2">
            <label>
              <span className="label">From</span>
              <input type="date" className="input" value={start} min="1940-01-01" max={end} onChange={(e) => (setPreset('custom'), setRange([e.target.value, end]))} />
            </label>
            <label>
              <span className="label">To</span>
              <input type="date" className="input" value={end} min={start} onChange={(e) => (setPreset('custom'), setRange([start, e.target.value]))} />
            </label>
          </div>
          <div>
            <span className="label">Resolution</span>
            <Segmented
              value={res}
              onChange={setRes}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'hourly', label: 'Hourly' },
              ]}
            />
          </div>
        </div>
        <div>
          <span className="label">Variables</span>
          <div className="flex flex-wrap gap-1.5">
            {(available.length ? available : VARIABLES.filter((v) => DEFAULT_VARS[res].includes(v.id))).map((v) => {
              const on = vars.includes(v.id);
              return (
                <button key={v.id} onClick={() => setVars(on ? vars.filter((x) => x !== v.id) : [...vars, v.id])} className={`chip ${on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'}`}>
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
        {source === 'om-era5' && end > latestEra5 && <Notice kind="info">ERA5 is published with a delay of about 5 days, so the most recent days may be empty.</Notice>}
        {tooLong && <Notice kind="warning">Hourly data is limited to 3 years per view. Switch to daily resolution or shorten the period.</Notice>}
      </div>

      {errors.map((e, i) => (
        <div key={i} className="mb-4">
          <Notice kind="error">
            {e.error.providerName}: {e.error.error}
          </Notice>
        </div>
      ))}
      {(primary.loading || secondary.loading) && <Skeleton className="mb-6 h-72" />}
      {sets.length > 0 && <HistoryResults sets={sets} vars={vars.filter((v) => available.some((a) => a.id === v))} res={res} start={start} end={end} tz={tz} units={prefs.units} />}
      {!primary.loading && sets.length === 0 && errors.length === 0 && !tooLong && <Notice>Choose a source and period to load data.</Notice>}
    </div>
  );
}

function HistoryResults({ sets, vars, res, start, end, tz, units }: { sets: WeatherDataset[]; vars: string[]; res: 'hourly' | 'daily'; start: string; end: string; tz: string; units: UnitPrefs }) {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const expected = expectedSteps(start, end, res);
  const blocks = sets.map((s) => s[res]);

  const rowsFor = (v: string): ChartRow[] => {
    const map = new Map<string, ChartRow>();
    sets.forEach((s, si) => {
      const b = s[res];
      const series = b?.series[v];
      if (!b || !series) return;
      b.time.forEach((t, i) => {
        const row = map.get(t) ?? ({ t: res === 'daily' ? dayToT(t) : Date.parse(t) } as ChartRow);
        row[`s${si}`] = toDisplay(v, series.values[i], units);
        map.set(t, row);
      });
    });
    return [...map.values()].sort((a, b) => a.t - b.t);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {sets.map((s, i) => (
          <span key={s.providerId} className="chip border-line bg-surface">
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" stroke={seriesStyle(s.providerId, i).color} strokeWidth={3} strokeDasharray={seriesStyle(s.providerId, i).dash} />
            </svg>
            {s.providerName}
            <KindBadge kind={s.kind} />
          </span>
        ))}
      </div>

      {/* Statistics */}
      <section className="card overflow-x-auto">
        <h2 className="section-title mb-3">Statistics</h2>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-medium">Variable</th>
              <th className="py-2 font-medium">Source</th>
              <th className="py-2 text-right font-medium">Min</th>
              <th className="py-2 text-right font-medium">Max</th>
              <th className="py-2 text-right font-medium">Mean</th>
              <th className="py-2 text-right font-medium">Std dev</th>
              <th className="py-2 text-right font-medium">Total</th>
              <th className="py-2 text-right font-medium">Completeness</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {vars.flatMap((v) =>
              sets.map((s, si) => {
                const b = blocks[si];
                const series = b?.series[v];
                const unit = unitFor(v, units);
                if (!b || !series)
                  return (
                    <tr key={`${v}-${si}`}>
                      <td className="py-1.5">{getVariable(v)?.label}</td>
                      <td className="py-1.5 text-muted">{s.providerName}</td>
                      <td colSpan={6} className="py-1.5 text-right text-xs text-muted">
                        Not available from this source
                      </td>
                    </tr>
                  );
                const st = describe(
                  v,
                  b.time,
                  series.values.map((x) => toDisplay(v, x, units)),
                  expected,
                );
                const fmt = (x: number | null) => (x === null ? '—' : `${x.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit && !unit.startsWith('°') ? ` ${unit}` : unit}`);
                const when = (t: string | null) => (t ? (res === 'daily' ? formatDate(t, { day: 'numeric', month: 'short', year: 'numeric' }) : formatTime(t, tz, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '');
                return (
                  <tr key={`${v}-${si}`}>
                    <td className="py-1.5">
                      {getVariable(v)?.label}
                      <OriginMark origin={series.origin} note={series.note} />
                    </td>
                    <td className="py-1.5 text-muted">{s.providerName}</td>
                    <td className="py-1.5 text-right tabular-nums" title={when(st.minTime)}>
                      {fmt(st.min)}
                      {st.minTime && <div className="text-[10px] text-muted">{when(st.minTime)}</div>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" title={when(st.maxTime)}>
                      {fmt(st.max)}
                      {st.maxTime && <div className="text-[10px] text-muted">{when(st.maxTime)}</div>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(st.mean)}</td>
                    <td className="py-1.5 text-right tabular-nums">{st.std === null ? '—' : st.std.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(st.total)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      <span className={st.completeness < 0.9 ? 'text-amber-600 dark:text-amber-400' : ''}>{(st.completeness * 100).toFixed(1)}%</span>
                      <div className="text-[10px] text-muted">
                        {st.count.toLocaleString()} / {st.expected.toLocaleString()}
                      </div>
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </section>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {vars.map((v) => {
          const def = getVariable(v);
          const series: ChartSeries[] = sets.map((s, i) => ({ key: `s${i}`, label: s.providerName, ...seriesStyle(s.providerId, i), type: def?.aggregation === 'sum' && sets.length === 1 ? 'bar' : 'line' }));
          return (
            <section key={v} className="card">
              <h3 className="mb-2 text-sm font-semibold">
                {def?.label} <span className="font-normal text-muted">({unitFor(v, units) || 'index'})</span>
              </h3>
              <TimeChart rows={rowsFor(v)} series={series} unit={unitFor(v, units)} timeZone={tz} daily={res === 'daily'} height={220} showLegend={sets.length > 1} />
            </section>
          );
        })}
      </div>

      {/* Period summaries */}
      <section className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">{period === 'month' ? 'Monthly' : 'Annual'} summaries</h2>
          <Segmented
            size="xs"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'year', label: 'Annual' },
            ]}
          />
        </div>
        <PeriodTable sets={sets} vars={vars} res={res} period={period} units={units} />
        <p className="mt-2 text-xs text-muted">Accumulations (precipitation, snowfall, ET₀, sunshine, GDD) are totals; other variables are averages. Completeness is relative to the full calendar period.</p>
      </section>

      <DataTable sets={sets} vars={vars} res={res} tz={tz} units={units} />
    </div>
  );
}

function PeriodTable({ sets, vars, res, period, units }: { sets: WeatherDataset[]; vars: string[]; res: 'hourly' | 'daily'; period: 'month' | 'year'; units: UnitPrefs }) {
  const s = sets[0];
  const b = s[res];
  if (!b) return null;
  const summaries = vars.map((v) => (b.series[v] ? periodSummaries(v, b.time, b.series[v].values.map((x) => toDisplay(v, x, units)), res, period, s.timezone) : []));
  const periods = [...new Set(summaries.flat().map((p) => p.period))].sort().reverse();
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="py-2 font-medium">{period === 'month' ? 'Month' : 'Year'}</th>
          {vars.map((v) => (
            <th key={v} className="px-2 py-2 text-right font-medium">
              {getVariable(v)?.short ?? getVariable(v)?.label} {unitFor(v, units) && `(${unitFor(v, units)})`}
            </th>
          ))}
          <th className="px-2 py-2 text-right font-medium">Completeness</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {periods.slice(0, 120).map((p) => {
          const comp = summaries.map((sm) => sm.find((x) => x.period === p)?.completeness ?? 0);
          const minComp = Math.min(...comp);
          return (
            <tr key={p}>
              <td className="py-1.5 text-muted">{period === 'month' ? new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${p}-15T00:00:00Z`)) : p}</td>
              {summaries.map((sm, i) => {
                const x = sm.find((y) => y.period === p);
                return (
                  <td key={vars[i]} className="px-2 py-1.5 text-right tabular-nums">
                    {x?.value === null || x?.value === undefined ? '—' : x.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                );
              })}
              <td className={`px-2 py-1.5 text-right tabular-nums ${minComp < 0.9 ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}`}>{(minComp * 100).toFixed(0)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DataTable({ sets, vars, res, tz, units }: { sets: WeatherDataset[]; vars: string[]; res: 'hourly' | 'daily'; tz: string; units: UnitPrefs }) {
  const [page, setPage] = useState(0);
  const s = sets[0];
  const b = s[res];
  if (!b) return null;
  const per = 50;
  const pages = Math.ceil(b.time.length / per);
  const idx = Array.from({ length: per }, (_, i) => b.time.length - 1 - (page * per + i)).filter((i) => i >= 0);
  return (
    <section className="card overflow-x-auto">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">Data · {s.providerName}</h2>
        <div className="flex items-center gap-2 text-xs text-muted">
          <button className="btn-ghost px-2 py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Newer
          </button>
          {page + 1} / {pages}
          <button className="btn-ghost px-2 py-1" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Older
          </button>
        </div>
      </div>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-2 font-medium">{res === 'daily' ? 'Date' : 'Time'}</th>
            {vars.map((v) => (
              <th key={v} className="px-2 py-2 text-right font-medium">
                {getVariable(v)?.short ?? getVariable(v)?.label} {unitFor(v, units) && `(${unitFor(v, units)})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {idx.map((i) => (
            <tr key={b.time[i]}>
              <td className="whitespace-nowrap py-1 text-muted">{res === 'daily' ? formatDate(b.time[i], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : formatTime(b.time[i], tz, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              {vars.map((v) => {
                const x = toDisplay(v, b.series[v]?.values[i] ?? null, units);
                return (
                  <td key={v} className={`px-2 py-1 text-right tabular-nums ${x === null ? 'text-muted/60' : ''}`}>
                    {x === null ? '—' : x.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
