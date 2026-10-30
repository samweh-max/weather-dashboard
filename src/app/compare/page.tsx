'use client';

import { useMemo, useState } from 'react';
import { locationQuery, useApp } from '@/components/AppState';
import { dayToT, TimeChart, type ChartRow, type ChartSeries } from '@/components/charts';
import { LocationSearch } from '@/components/LocationSearch';
import { KindBadge, Notice, PageHeader, Segmented, Skeleton } from '@/components/ui';
import { useJson } from '@/components/useJson';
import { useProviders } from '@/components/useProviders';
import { seriesStyle } from '@/lib/palette';
import { displayZone, formatDate, formatTime, relativeAge } from '@/lib/time';
import type { Location, ProviderResult, WeatherDataset } from '@/lib/types';
import { toDisplay, unitFor } from '@/lib/units';
import { getVariable } from '@/lib/variables';

const HOURLY_VARS = ['temperature', 'apparent_temperature', 'precipitation', 'precipitation_probability', 'wind_speed', 'wind_gusts', 'wind_direction', 'relative_humidity', 'pressure_msl', 'cloud_cover', 'dew_point', 'visibility', 'uv_index'];
const DAILY_VARS = ['temperature_max', 'temperature_min', 'temperature_mean', 'precipitation', 'precipitation_probability', 'snowfall', 'wind_speed_max', 'wind_gusts_max', 'wind_direction', 'relative_humidity', 'pressure_msl', 'uv_index_max', 'sunshine_duration'];

type Mode = 'providers' | 'locations';

export default function ComparePage() {
  const { location, prefs, setPrefs } = useApp();
  const [mode, setMode] = useState<Mode>('providers');
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader title="Compare" subtitle="Put independent forecasts side by side. Every source keeps its own line and column, so disagreements are easy to spot. Nothing is blended.">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'providers', label: 'Sources' },
            { value: 'locations', label: 'Locations' },
          ]}
        />
      </PageHeader>
      {mode === 'providers' ? <ProviderCompare location={location} selected={prefs.compareProviders} setSelected={(ids) => setPrefs({ compareProviders: ids })} /> : <LocationCompare />}
    </div>
  );
}

/* ============================== sources ============================== */

function ProviderCompare({ location, selected, setSelected }: { location: Location; selected: string[]; setSelected: (ids: string[]) => void }) {
  const { prefs } = useApp();
  const providers = useProviders(location).filter((p) => p.supportsForecast);
  const [res, setRes] = useState<'hourly' | 'daily'>('hourly');
  const [variable, setVariable] = useState('temperature');
  const [horizon, setHorizon] = useState<'2' | '4' | '7' | '10'>('4');
  const avail = selected.filter((id) => providers.find((p) => p.id === id)?.available !== false);
  const { data, loading } = useJson<{ results: ProviderResult[] }>(avail.length ? `/api/compare?providers=${avail.join(',')}&${locationQuery(location)}` : null);
  const ok = (data?.results ?? []).filter((r): r is { ok: true; data: WeatherDataset } => r.ok).map((r) => r.data);
  const failed = (data?.results ?? []).filter((r) => !r.ok);
  const tz = displayZone(prefs.timezone, ok[0]?.timezone ?? location.timezone);
  const vars = res === 'hourly' ? HOURLY_VARS : DAILY_VARS;
  const v = vars.includes(variable) ? variable : vars[0];

  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <span className="label">Location</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full max-w-sm">
                <LocationSearch />
              </div>
              <span className="text-sm font-medium">{location.name}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <span className="label">Resolution</span>
              <Segmented
                value={res}
                onChange={setRes}
                options={[
                  { value: 'hourly', label: 'Hourly' },
                  { value: 'daily', label: 'Daily' },
                ]}
              />
            </div>
            <div>
              <span className="label">Period</span>
              <Segmented
                value={horizon}
                onChange={setHorizon}
                options={[
                  { value: '2', label: '2 d' },
                  { value: '4', label: '4 d' },
                  { value: '7', label: '7 d' },
                  { value: '10', label: '10 d' },
                ]}
              />
            </div>
          </div>
        </div>
        <div>
          <span className="label">Sources</span>
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => {
              const on = selected.includes(p.id);
              const st = seriesStyle(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => p.available && toggle(p.id)}
                  disabled={!p.available}
                  title={p.available ? p.description : p.unavailableReason}
                  className={`chip transition ${on && p.available ? 'border-ink/20 bg-surface text-ink shadow-sm' : 'border-line text-muted'} ${!p.available ? 'opacity-50' : 'hover:border-ink/30'}`}
                >
                  <svg width="18" height="6" aria-hidden>
                    <line x1="0" y1="3" x2="18" y2="3" stroke={on ? st.color : 'rgb(var(--muted))'} strokeWidth={3} strokeDasharray={st.dash} />
                  </svg>
                  {p.shortName}
                  {!p.available && <span className="text-[10px]">({p.requiresKey && !p.enabled ? 'needs key' : 'n/a here'})</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span className="label">Variable</span>
          <div className="flex flex-wrap gap-1.5">
            {vars.map((id) => (
              <button key={id} onClick={() => setVariable(id)} className={`chip ${v === id ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'}`}>
                {getVariable(id)?.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {failed.length > 0 && (
        <Notice kind="warning">
          {failed.map((f) => (!f.ok ? <div key={f.error.providerId}>{f.error.providerName}: {f.error.error}</div> : null))}
        </Notice>
      )}
      {loading && !data && <Skeleton className="h-80" />}
      {ok.length > 0 && <CompareChart datasets={ok} variable={v} res={res} days={Number(horizon)} tz={tz} />}
      {ok.length > 0 && <CompareTable datasets={ok} variable={v} res={res} days={Number(horizon)} tz={tz} />}
      {ok.length > 0 && <AvailabilityMatrix datasets={ok} res={res} />}
    </div>
  );
}

/** Align all sources on the union of their timestamps. */
function alignedRows(datasets: WeatherDataset[], variable: string, res: 'hourly' | 'daily', days: number, units: ReturnType<typeof useApp>['prefs']['units']) {
  const now = Date.now();
  const start = res === 'hourly' ? Math.floor(now / 3600_000) * 3600_000 : Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z') - 86400_000;
  const end = start + days * 86400_000;
  const map = new Map<string, ChartRow>();
  for (const ds of datasets) {
    const block = ds[res];
    if (!block) continue;
    const s = block.series[variable];
    block.time.forEach((t, i) => {
      const ms = res === 'hourly' ? Date.parse(t) : dayToT(t);
      if (ms < start || ms > end) return;
      const row = map.get(t) ?? ({ t: ms } as ChartRow);
      row[ds.providerId] = s ? toDisplay(variable, s.values[i], units) : null;
      map.set(t, row);
    });
  }
  return [...map.entries()].sort((a, b) => a[1].t - b[1].t);
}

function CompareChart({ datasets, variable, res, days, tz }: { datasets: WeatherDataset[]; variable: string; res: 'hourly' | 'daily'; days: number; tz: string }) {
  const { prefs } = useApp();
  const rows = useMemo(() => alignedRows(datasets, variable, res, days, prefs.units).map(([, r]) => r), [datasets, variable, res, days, prefs.units]);
  const def = getVariable(variable);
  const isBar = def?.aggregation === 'sum' && res === 'daily';
  const series: ChartSeries[] = datasets.map((d, i) => ({ key: d.providerId, label: d.providerName + (d[res]?.series[variable] ? '' : ' (not available)'), ...seriesStyle(d.providerId, i), type: isBar ? 'bar' : 'line' }));
  return (
    <section className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title">
          {def?.label} <span className="text-sm font-normal text-muted">({unitFor(variable, prefs.units) || 'index'})</span>
        </h2>
        <KindBadge kind="forecast" />
      </div>
      <TimeChart rows={rows} series={series} unit={unitFor(variable, prefs.units)} timeZone={tz} daily={res === 'daily'} height={340} showLegend now={res === 'hourly' ? Date.now() : undefined} />
    </section>
  );
}

function CompareTable({ datasets, variable, res, days, tz }: { datasets: WeatherDataset[]; variable: string; res: 'hourly' | 'daily'; days: number; tz: string }) {
  const { prefs } = useApp();
  const u = prefs.units;
  const rows = useMemo(() => alignedRows(datasets, variable, res, days, u), [datasets, variable, res, days, u]);
  const step = res === 'hourly' ? (days > 4 ? 6 : 3) : 1;
  const shown = rows.filter((_, i) => i % step === 0);
  const unit = unitFor(variable, u);
  const dec = getVariable(variable)?.quantity === 'precipitation' ? 1 : 0;
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Table</h2>
        <p className="text-xs text-muted">
          {res === 'hourly' ? `Every ${step} hours. ` : ''}Spread = highest minus lowest source. Cells far from the median are highlighted.
        </p>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="sticky left-0 bg-surface py-2 pr-3 font-medium">{res === 'hourly' ? 'Time' : 'Date'}</th>
              {datasets.map((d, i) => {
                const st = seriesStyle(d.providerId, i);
                return (
                  <th key={d.providerId} className="px-2 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="14" height="6" aria-hidden>
                        <line x1="0" y1="3" x2="14" y2="3" stroke={st.color} strokeWidth={3} strokeDasharray={st.dash} />
                      </svg>
                      {d.providerName.replace('Open-Meteo ', '')}
                    </span>
                  </th>
                );
              })}
              <th className="px-2 py-2 text-right font-medium">Spread</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map(([key, r]) => {
              const vals = datasets.map((d) => r[d.providerId]).filter((x): x is number => x !== null && x !== undefined);
              const sorted = [...vals].sort((a, b) => a - b);
              const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
              const spread = vals.length >= 2 ? sorted[sorted.length - 1] - sorted[0] : null;
              const threshold = Math.max(0.5, (spread ?? 0) * 0.35);
              return (
                <tr key={key}>
                  <td className="sticky left-0 whitespace-nowrap bg-surface py-1.5 pr-3 text-muted">{res === 'hourly' ? formatTime(key, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : formatDate(key)}</td>
                  {datasets.map((d) => {
                    const x = r[d.providerId];
                    const has = !!d[res]?.series[variable];
                    if (x === null || x === undefined)
                      return (
                        <td key={d.providerId} className="px-2 py-1.5 text-right text-xs text-muted/70" title={has ? 'No value for this time' : 'This source does not provide this variable'}>
                          {has ? '—' : 'n/a'}
                        </td>
                      );
                    const off = median !== null && Math.abs(x - median) > threshold && vals.length > 2;
                    return (
                      <td key={d.providerId} className={`px-2 py-1.5 text-right tabular-nums ${off ? (x > median! ? 'font-semibold text-orange-600 dark:text-orange-400' : 'font-semibold text-sky-600 dark:text-sky-400') : ''}`}>
                        {x.toLocaleString(undefined, { maximumFractionDigits: dec })}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted">{spread === null ? '—' : `${spread.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AvailabilityMatrix({ datasets, res }: { datasets: WeatherDataset[]; res: 'hourly' | 'daily' }) {
  const ids = [...new Set(datasets.flatMap((d) => Object.keys(d[res]?.series ?? {})))].filter((id) => getVariable(id)).sort((a, b) => (getVariable(a)!.category + a).localeCompare(getVariable(b)!.category + b));
  return (
    <section className="card">
      <h2 className="section-title mb-1">What each source provides</h2>
      <p className="mb-3 text-xs text-muted">
        ● from the provider · ◐ calculated by this app from the provider’s values · – not available. Last updated times are as published by each provider.
      </p>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1.5 text-left font-medium">Variable</th>
              {datasets.map((d) => (
                <th key={d.providerId} className="px-2 py-1.5 text-center font-medium">
                  {d.providerName.replace('Open-Meteo ', '')}
                  <div className="font-normal">{d.updatedAt ? relativeAge(d.updatedAt) : 'update time n/a'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ids.map((id) => (
              <tr key={id}>
                <td className="py-1 pr-2">{getVariable(id)!.label}</td>
                {datasets.map((d) => {
                  const s = d[res]?.series[id];
                  return (
                    <td key={d.providerId} className="px-2 py-1 text-center" title={s?.note}>
                      {!s ? <span className="text-muted/60">–</span> : s.origin === 'calculated' ? <span className="text-muted">◐</span> : <span className="text-emerald-600 dark:text-emerald-400">●</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ============================== locations ============================== */

function LocationCompare() {
  const { prefs, favourites, location } = useApp();
  const [locs, setLocs] = useState<Location[]>(() => {
    const base = [location, ...favourites.filter((f) => f.latitude !== location.latitude || f.longitude !== location.longitude)];
    return base.slice(0, 4);
  });
  const [provider, setProvider] = useState('om-best');
  const providers = useProviders().filter((p) => p.supportsForecast && p.id.startsWith('om-'));
  const [variable, setVariable] = useState('temperature_max');

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <span className="label">Add a location</span>
            <LocationSearch detached onSelect={(l) => setLocs((xs) => (xs.some((x) => x.latitude === l.latitude && x.longitude === l.longitude) ? xs : [...xs, l].slice(0, 6)))} />
          </div>
          <div>
            <span className="label">Source (same for all locations)</span>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {locs.map((l, i) => (
            <span key={`${l.latitude},${l.longitude}`} className="chip border-line bg-canvas">
              <svg width="14" height="6" aria-hidden>
                <line x1="0" y1="3" x2="14" y2="3" stroke={`var(--series-${(i % 8) + 1})`} strokeWidth={3} />
              </svg>
              {l.name}
              <button onClick={() => setLocs((xs) => xs.filter((_, j) => j !== i))} className="ml-1 text-muted hover:text-ink" aria-label={`Remove ${l.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['temperature_max', 'temperature_min', 'precipitation', 'precipitation_probability', 'wind_gusts_max', 'relative_humidity', 'sunshine_duration'].map((id) => (
            <button key={id} onClick={() => setVariable(id)} className={`chip ${variable === id ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'}`}>
              {getVariable(id)?.label}
            </button>
          ))}
        </div>
      </div>
      <LocationResults locs={locs} provider={provider} variable={variable} units={prefs.units} />
    </div>
  );
}

function LocationResults({ locs, provider, variable, units }: { locs: Location[]; provider: string; variable: string; units: ReturnType<typeof useApp>['prefs']['units'] }) {
  const r0 = useJson<ProviderResult>(locs[0] ? `/api/weather?provider=${provider}&${locationQuery(locs[0])}` : null);
  const r1 = useJson<ProviderResult>(locs[1] ? `/api/weather?provider=${provider}&${locationQuery(locs[1])}` : null);
  const r2 = useJson<ProviderResult>(locs[2] ? `/api/weather?provider=${provider}&${locationQuery(locs[2])}` : null);
  const r3 = useJson<ProviderResult>(locs[3] ? `/api/weather?provider=${provider}&${locationQuery(locs[3])}` : null);
  const r4 = useJson<ProviderResult>(locs[4] ? `/api/weather?provider=${provider}&${locationQuery(locs[4])}` : null);
  const r5 = useJson<ProviderResult>(locs[5] ? `/api/weather?provider=${provider}&${locationQuery(locs[5])}` : null);
  const results = [r0, r1, r2, r3, r4, r5].slice(0, locs.length);
  if (locs.length < 2) return <Notice>Add at least two locations to compare them.</Notice>;
  const rowsMap = new Map<string, ChartRow>();
  results.forEach((r, i) => {
    if (!r.data?.ok) return;
    const d = r.data.data.daily;
    d?.time.forEach((t, j) => {
      const row = rowsMap.get(t) ?? ({ t: dayToT(t) } as ChartRow);
      row[`l${i}`] = toDisplay(variable, d.series[variable]?.values[j] ?? null, units);
      rowsMap.set(t, row);
    });
  });
  const rows = [...rowsMap.values()].sort((a, b) => a.t - b.t);
  const def = getVariable(variable);
  return (
    <>
      {results.map((r, i) => (r.data && !r.data.ok ? <Notice key={i} kind="warning">{`${locs[i].name}: ${r.data.error.error}`}</Notice> : null))}
      <section className="card">
        <h2 className="section-title mb-2">{def?.label}</h2>
        <TimeChart
          rows={rows}
          daily
          unit={unitFor(variable, units)}
          timeZone="UTC"
          height={320}
          showLegend
          series={locs.map((l, i) => ({ key: `l${i}`, label: l.name, color: `var(--series-${(i % 8) + 1})`, type: def?.aggregation === 'sum' ? 'bar' : 'line' }))}
        />
      </section>
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-medium">Date</th>
              {locs.map((l) => (
                <th key={`${l.latitude},${l.longitude}`} className="px-2 py-2 text-right font-medium">
                  {l.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...rowsMap.entries()]
              .sort()
              .slice(0, 10)
              .map(([date, row]) => (
                <tr key={date}>
                  <td className="py-1.5 text-muted">{formatDate(date)}</td>
                  {locs.map((_, i) => (
                    <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                      {row[`l${i}`] === null || row[`l${i}`] === undefined ? '—' : (row[`l${i}`] as number).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">Values in {unitFor(variable, units) || 'index units'}.</p>
      </section>
    </>
  );
}
