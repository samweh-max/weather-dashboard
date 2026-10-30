'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppState';
import { LocationSearch } from '@/components/LocationSearch';
import { KindBadge, Notice, PageHeader, Segmented, Spinner } from '@/components/ui';
import { useJson } from '@/components/useJson';
import { useProviders } from '@/components/useProviders';
import { addDays, todayIn } from '@/lib/time';
import type { ImportedDatasetMeta, Location } from '@/lib/types';
import { UNIT_LABELS, type UnitPrefs } from '@/lib/units';
import { CATEGORY_LABELS, VARIABLES, type Category } from '@/lib/variables';

type DataType = 'forecast' | 'history';

const DEFAULT_VARS = ['temperature', 'temperature_max', 'temperature_min', 'temperature_mean', 'apparent_temperature', 'dew_point', 'precipitation', 'precipitation_probability', 'snowfall', 'wind_speed', 'wind_gusts', 'wind_direction', 'wind_speed_max', 'wind_gusts_max', 'relative_humidity', 'pressure_msl', 'cloud_cover', 'uv_index', 'uv_index_max'];

export default function ExportPage() {
  const { location: appLocation, prefs } = useApp();
  const [loc, setLoc] = useState<Location>(appLocation);
  useEffect(() => setLoc(appLocation), [appLocation]);
  const providers = useProviders(loc);
  const { data: dsList } = useJson<{ datasets: ImportedDatasetMeta[] }>('/api/datasets');
  const datasets = useMemo(() => dsList?.datasets ?? [], [dsList]);

  const [dataType, setDataType] = useState<DataType>('forecast');
  const today = todayIn(loc.timezone || 'UTC');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 6));
  const [sources, setSources] = useState<string[]>(['om-best']);
  const [resolution, setResolution] = useState<'hourly' | 'daily' | 'both'>('both');
  const [vars, setVars] = useState<string[]>(DEFAULT_VARS);
  const [units, setUnits] = useState<UnitPrefs>(prefs.units);
  const [includeStats, setIncludeStats] = useState(true);
  const [includeComparison, setIncludeComparison] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; failures: { source: string; error: string }[] } | null>(null);

  useEffect(() => setUnits(prefs.units), [prefs.units]);

  // /export?dataset=<id> preselects an imported dataset
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('dataset');
    const meta = datasets.find((d) => d.id === id);
    if (meta) {
      setDataType('history');
      setSources([`import:${meta.id}`]);
      setStart(meta.start.slice(0, 10));
      setEnd(meta.end.slice(0, 10));
      setVars(meta.variables);
      if (meta.location) setLoc(meta.location);
    }
  }, [datasets]);

  const switchType = (t: DataType) => {
    setDataType(t);
    if (t === 'forecast') {
      setStart(today);
      setEnd(addDays(today, 6));
      setSources(['om-best']);
    } else {
      setStart(addDays(today, -36));
      setEnd(addDays(today, -6));
      setSources(['om-era5']);
    }
  };

  const options = useMemo(() => {
    const list = providers.filter((p) => (dataType === 'forecast' ? p.supportsForecast : !!p.historyRange));
    return [
      ...list.map((p) => ({ id: p.id, name: p.name, kind: p.kind, available: p.available, note: p.available ? p.coverage : p.unavailableReason })),
      ...(dataType === 'forecast'
        ? [
            { id: 'om-air', name: 'CAMS air quality', kind: 'forecast' as const, available: true, note: 'PM2.5, PM10, NO₂, O₃, AQI · 5 days' },
            { id: 'om-marine', name: 'Marine forecast', kind: 'forecast' as const, available: true, note: 'Waves, swell, sea temperature · coastal and sea locations only' },
          ]
        : []),
      ...(dataType === 'history' ? datasets.map((d) => ({ id: `import:${d.id}`, name: d.name, kind: 'imported' as const, available: true, note: `${d.resolution}, ${d.start.slice(0, 10)} → ${d.end.slice(0, 10)}` })) : []),
    ];
  }, [providers, datasets, dataType]);

  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const tooLongHourly = dataType === 'history' && resolution !== 'daily' && days > 366 * 3 && sources.some((s) => !s.startsWith('import:'));
  const valid = start <= end && sources.length > 0 && vars.length > 0 && !tooLongHourly;

  const download = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: loc, start, end, sources, dataType, resolution, variables: vars, units, includeStats, includeComparison }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Export failed (${r.status})`);
      }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') ?? '';
      const name = cd.match(/filename="([^"]+)"/)?.[1] ?? 'weather.xlsx';
      const failures = JSON.parse(decodeURIComponent(r.headers.get('X-Export-Failures') || '%5B%5D'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setDone({ name, failures });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const byCat = (Object.keys(CATEGORY_LABELS) as Category[]).map((c) => ({ c, vars: VARIABLES.filter((v) => v.category === c) }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title="Export to Excel" subtitle="Build a clean .xlsx workbook: hourly and daily sheets, a side-by-side provider comparison, statistics with monthly and annual summaries, and a variable dictionary. Numbers stay numbers, at full precision." />

      <div className="space-y-6">
        <section className="card grid gap-5 md:grid-cols-2">
          <div>
            <span className="label">Location</span>
            <LocationSearch detached onSelect={setLoc} />
            <p className="mt-1 text-xs text-muted">
              {loc.name} · {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)} {loc.timezone && `· ${loc.timezone}`}
            </p>
          </div>
          <div>
            <span className="label">Data type</span>
            <Segmented
              value={dataType}
              onChange={switchType}
              options={[
                { value: 'forecast', label: 'Forecasts' },
                { value: 'history', label: 'Observations / history' },
              ]}
            />
            <p className="mt-1 text-xs text-muted">{dataType === 'forecast' ? 'Up to 16 days ahead, depending on the source.' : 'ERA5 reanalysis back to 1940, recent NWS station observations (US), and your imported datasets.'}</p>
          </div>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="label">Start date</span>
              <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} min="1940-01-01" />
            </label>
            <label className="flex-1">
              <span className="label">End date</span>
              <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} min={start} />
            </label>
          </div>
          <div>
            <span className="label">Resolution</span>
            <Segmented
              value={resolution}
              onChange={setResolution}
              options={[
                { value: 'hourly', label: 'Hourly' },
                { value: 'daily', label: 'Daily' },
                { value: 'both', label: 'Both' },
              ]}
            />
          </div>
        </section>

        <section className="card">
          <span className="label">Sources ({sources.length} selected)</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm ${sources.includes(o.id) ? 'border-accent bg-accent/5' : 'border-line'} ${!o.available ? 'cursor-not-allowed opacity-50' : ''}`}>
                <input type="checkbox" className="mt-0.5" disabled={!o.available} checked={sources.includes(o.id)} onChange={(e) => setSources(e.target.checked ? [...sources, o.id] : sources.filter((x) => x !== o.id))} />
                <span className="flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {o.name} <KindBadge kind={o.kind} />
                  </span>
                  <span className="text-xs text-muted">{o.note}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="label">Variables ({vars.length})</span>
            <div className="flex gap-2 text-xs">
              <button className="underline" onClick={() => setVars(VARIABLES.map((v) => v.id))}>
                Select all
              </button>
              <button className="underline" onClick={() => setVars(DEFAULT_VARS)}>
                Essentials
              </button>
              <button className="underline" onClick={() => setVars([])}>
                Clear
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {byCat.map(({ c, vars: vs }) => (
              <div key={c}>
                <button className="mb-1 text-sm font-semibold hover:underline" onClick={() => setVars(vs.every((v) => vars.includes(v.id)) ? vars.filter((x) => !vs.some((v) => v.id === x)) : [...new Set([...vars, ...vs.map((v) => v.id)])])}>
                  {CATEGORY_LABELS[c]}
                </button>
                <div className="space-y-0.5">
                  {vs.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 text-sm" title={v.description}>
                      <input type="checkbox" checked={vars.includes(v.id)} onChange={(e) => setVars(e.target.checked ? [...vars, v.id] : vars.filter((x) => x !== v.id))} />
                      <span className="truncate">{v.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Variables a source does not provide are left out of its rows (empty cells), never filled in.</p>
        </section>

        <section className="card grid gap-5 md:grid-cols-2">
          <div>
            <span className="label">Units</span>
            <div className="grid grid-cols-2 gap-2">
              <UnitSelect label="Temperature" value={units.temperature} options={UNIT_LABELS.temperature} onChange={(v) => setUnits({ ...units, temperature: v as UnitPrefs['temperature'] })} />
              <UnitSelect label="Wind" value={units.speed} options={UNIT_LABELS.speed} onChange={(v) => setUnits({ ...units, speed: v as UnitPrefs['speed'] })} />
              <UnitSelect label="Precipitation" value={units.precipitation} options={UNIT_LABELS.precipitation} onChange={(v) => setUnits({ ...units, precipitation: v as UnitPrefs['precipitation'] })} />
              <UnitSelect label="Pressure" value={units.pressure} options={UNIT_LABELS.pressure} onChange={(v) => setUnits({ ...units, pressure: v as UnitPrefs['pressure'] })} />
              <UnitSelect label="Visibility" value={units.distance} options={UNIT_LABELS.distance} onChange={(v) => setUnits({ ...units, distance: v as UnitPrefs['distance'] })} />
            </div>
          </div>
          <div className="space-y-2">
            <span className="label">Extra sheets</span>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={includeStats} onChange={(e) => setIncludeStats(e.target.checked)} />
              <span>
                Statistics (min, max, mean, standard deviation, totals, completeness) plus monthly and annual summaries
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={includeComparison} onChange={(e) => setIncludeComparison(e.target.checked)} />
              <span>Provider comparison sheet (one column per source, with spread) when 2+ sources are selected</span>
            </label>
            <p className="text-xs text-muted">Always included: About (location, sources, update times, attribution) and Variables (definitions, units, whether each value is from the provider or calculated).</p>
          </div>
        </section>

        {tooLongHourly && <Notice kind="warning">Hourly history is limited to 3 years per export. Choose daily resolution or a shorter period.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {done && (
          <Notice kind={done.failures.length ? 'warning' : 'info'}>
            Downloaded <strong>{done.name}</strong>.
            {done.failures.length > 0 && (
              <>
                {' '}
                Some sources could not be included (listed in the workbook’s About sheet):
                <ul className="mt-1 list-disc pl-5">
                  {done.failures.map((f) => (
                    <li key={f.source}>
                      {f.source}: {f.error}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Notice>
        )}
        <div className="flex justify-end">
          <button className="btn-primary px-6 py-3 text-base shadow-lg" disabled={!valid || busy} onClick={download}>
            {busy ? <Spinner className="border-white border-t-transparent" /> : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {busy ? 'Building workbook…' : 'Download .xlsx'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnitSelect({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <span className="text-xs text-muted">{label}</span>
      <select className="input mt-0.5" value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
