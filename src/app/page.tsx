'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { locationQuery, useApp } from '@/components/AppState';
import { TimeChart, type ChartRow } from '@/components/charts';
import { LocationSearch } from '@/components/LocationSearch';
import { ProviderSelect, Segmented, Skeleton, SourceLine, WindArrow, compass, KindBadge, OriginMark } from '@/components/ui';
import { useJson } from '@/components/useJson';
import { useProviders } from '@/components/useProviders';
import { WeatherIcon } from '@/components/WeatherIcon';
import { phaseFor, WeatherScene } from '@/components/WeatherScene';
import { CONDITION_LABELS } from '@/lib/conditions';
import { displayZone, formatDate, formatTime, localDate, todayIn } from '@/lib/time';
import type { ProviderResult, WeatherDataset } from '@/lib/types';
import { formatValue, toDisplay, unitFor } from '@/lib/units';
import { getVariable, CATEGORY_LABELS, type Category } from '@/lib/variables';

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function HomePage() {
  const { location, prefs, setPrefs, isFavourite, toggleFavourite, favourites, setLocation, ready } = useApp();
  const providers = useProviders(location);
  const providerId = prefs.homeProvider;
  const url = ready ? `/api/weather?provider=${providerId}&${locationQuery(location)}` : null;
  const { data: result, loading, reload } = useJson<ProviderResult>(url);
  const extrasUrl = ready ? `/api/extras?${locationQuery(location)}` : null;
  const { data: extras } = useJson<{ air: ProviderResult; marine: ProviderResult }>(extrasUrl);
  const now = useNow();

  // If the chosen provider doesn't cover this location (e.g. NWS outside the US), fall back to Open-Meteo.
  useEffect(() => {
    const p = providers.find((x) => x.id === providerId);
    if (p && !p.available) setPrefs({ homeProvider: 'om-best' });
  }, [providers, providerId, setPrefs]);

  const ds = result?.ok ? result.data : null;
  const tz = displayZone(prefs.timezone, ds?.timezone ?? location.timezone);
  const units = prefs.units;

  const today = ds ? todayIn(ds.timezone) : null;
  const dIdx = ds?.daily && today ? ds.daily.time.indexOf(today) : -1;
  const astro = ds?.astro?.find((a) => a.date === today);
  const nowHourIdx = useMemo(() => {
    if (!ds?.hourly) return -1;
    const h = Math.floor(now / 3600_000) * 3600_000;
    let best = -1;
    ds.hourly.time.forEach((t, i) => {
      if (Date.parse(t) <= h) best = i;
    });
    return best;
  }, [ds, now]);

  /** Current value: provider's "current" block first, then the matching hourly step. */
  const cur = (id: string): { v: number | null; from: 'current' | 'hourly' | null } => {
    const c = ds?.current?.values[id];
    if (c !== null && c !== undefined) return { v: c, from: 'current' };
    const s = ds?.hourly?.series[id];
    if (s && nowHourIdx >= 0 && s.values[nowHourIdx] !== null) return { v: s.values[nowHourIdx], from: 'hourly' };
    return { v: null, from: null };
  };
  const day = (id: string) => (ds?.daily && dIdx >= 0 ? (ds.daily.series[id]?.values[dIdx] ?? null) : null);

  const condition = ds?.current?.condition ?? (nowHourIdx >= 0 ? (ds?.hourly?.conditions?.[nowHourIdx] ?? null) : null);
  const description = ds?.current?.description ?? (nowHourIdx >= 0 ? ds?.hourly?.descriptions?.[nowHourIdx] : null) ?? (condition ? CONDITION_LABELS[condition] : null);
  const phase = phaseFor(now, astro?.sunrise, astro?.sunset, ds?.current?.isDay);
  const fav = isFavourite(location);

  return (
    <div>
      {/* ---------------- Hero ---------------- */}
      <section className="relative isolate min-h-[640px] overflow-hidden pb-10 pt-20 text-white sm:min-h-[600px]">
        <WeatherScene condition={ds ? condition : null} phase={ds ? phase : 'day'} cloudCover={cur('cloud_cover').v} windKmh={cur('wind_speed').v} animation={prefs.animation} />
        <div className="relative mx-auto max-w-7xl px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full lg:max-w-md">
              <LocationSearch variant="glass" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {favourites.length > 0 && (
                <div className="scroll-thin flex max-w-[60vw] gap-1.5 overflow-x-auto">
                  {favourites.map((f) => (
                    <button
                      key={`${f.latitude},${f.longitude}`}
                      onClick={() => setLocation(f)}
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur ${Math.abs(f.latitude - location.latitude) < 0.001 && Math.abs(f.longitude - location.longitude) < 0.001 ? 'border-white/60 bg-white/30' : 'border-white/25 bg-white/10 hover:bg-white/20'}`}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <ProviderSelect glass providers={providers} value={providerId} onChange={(id) => setPrefs({ homeProvider: id })} filter={(p) => p.supportsForecast} />
            </div>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end">
            <motion.div key={`${location.latitude},${location.longitude},${providerId}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-3xl font-semibold tracking-tight drop-shadow sm:text-4xl">{location.name}</h1>
                <button onClick={() => toggleFavourite(location)} aria-pressed={fav} title={fav ? 'Remove from favourites' : 'Save as favourite'} className="rounded-full p-1.5 hover:bg-white/15">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill={fav ? '#fde047' : 'none'} stroke={fav ? '#fde047' : 'currentColor'} strokeWidth={1.8}>
                    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-white/80">
                {location.region ? `${location.region} · ` : ''}
                {formatTime(new Date(now).toISOString(), tz, { weekday: 'long', hour: '2-digit', minute: '2-digit' })} local time
              </p>

              {loading && !ds && (
                <div className="mt-8 space-y-3">
                  <Skeleton className="h-24 w-56 bg-white/20" />
                  <Skeleton className="h-6 w-72 bg-white/20" />
                </div>
              )}
              {result && !result.ok && (
                <div className="glass mt-8 max-w-lg p-4 text-sm">
                  <p className="font-semibold">{result.error.providerName} could not be loaded.</p>
                  <p className="mt-1 text-white/85">{result.error.error}</p>
                  <div className="mt-3 flex gap-2">
                    <button className="btn bg-white/20 text-white hover:bg-white/30" onClick={reload}>
                      Retry
                    </button>
                    {providerId !== 'om-best' && (
                      <button className="btn bg-white/20 text-white hover:bg-white/30" onClick={() => setPrefs({ homeProvider: 'om-best' })}>
                        Switch to Open-Meteo
                      </button>
                    )}
                  </div>
                </div>
              )}
              {ds && (
                <>
                  <div className="mt-6 flex items-center gap-4">
                    <WeatherIcon condition={condition} night={phase === 'night'} size={96} animate={prefs.animation === 'full'} className="drop-shadow-lg" />
                    <div className="font-display text-7xl font-light leading-none tracking-tighter drop-shadow-md sm:text-8xl">
                      {cur('temperature').v === null ? '—' : `${Math.round(toDisplay('temperature', cur('temperature').v, units)!)}°`}
                    </div>
                  </div>
                  <p className="mt-3 text-xl font-medium drop-shadow">{description ?? 'Conditions not reported'}</p>
                  <p className="mt-1 text-white/85">
                    H {formatValue('temperature_max', day('temperature_max'), units)} · L {formatValue('temperature_min', day('temperature_min'), units)}
                    {cur('apparent_temperature').v !== null && <> · Feels like {formatValue('apparent_temperature', cur('apparent_temperature').v, units)}</>}
                  </p>
                  <div className="mt-4">
                    <SourceLine ds={ds} timeZone={tz} glass />
                    {ds.current?.sourceNote && <p className="mt-1 text-xs text-white/70">{ds.current.sourceNote}</p>}
                  </div>
                </>
              )}
            </motion.div>

            {ds && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <HeroTile label="Chance of rain" value={formatValue('precipitation_probability', day('precipitation_probability') ?? cur('precipitation_probability').v, units)} sub={day('precipitation') !== null ? `${formatValue('precipitation', day('precipitation'), units)} today` : undefined} />
                <HeroTile
                  label="Wind"
                  value={formatValue('wind_speed', cur('wind_speed').v, units)}
                  sub={cur('wind_gusts').v !== null ? `Gusts ${formatValue('wind_gusts', cur('wind_gusts').v, units)}` : undefined}
                  icon={<WindArrow deg={cur('wind_direction').v} className="h-5 w-5" />}
                  extra={compass(cur('wind_direction').v)}
                />
                <HeroTile label="Humidity" value={formatValue('relative_humidity', cur('relative_humidity').v, units)} sub={cur('dew_point').v !== null ? `Dew point ${formatValue('dew_point', cur('dew_point').v, units)}` : undefined} />
                <HeroTile label="Pressure" value={formatValue('pressure_msl', cur('pressure_msl').v, units)} sub={pressureTrend(ds, nowHourIdx)} />
                <HeroTile label="UV index" value={formatValue('uv_index', cur('uv_index').v, units)} sub={uvLabel(cur('uv_index').v) ?? (day('uv_index_max') !== null ? `Max ${formatValue('uv_index_max', day('uv_index_max'), units)}` : undefined)} />
                <HeroTile
                  label="Sunrise / sunset"
                  value={astro ? `${formatTime(astro.sunrise, tz)}` : '—'}
                  sub={astro ? `Sets ${formatTime(astro.sunset, tz)}` : 'Not provided by this source'}
                />
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- Body ---------------- */}
      <div className="relative z-10 mx-auto -mt-6 max-w-7xl space-y-6 px-4 pb-12">
        {ds?.hourly && <HourlyStrip ds={ds} tz={tz} startIdx={Math.max(0, nowHourIdx)} />}
        {ds && (
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <ForecastCharts ds={ds} tz={tz} now={now} />
            <DailyList ds={ds} tz={tz} />
          </div>
        )}
        {ds && <DetailGrid ds={ds} cur={cur} day={day} tz={tz} astro={astro} extras={extras} />}
        {ds && <ProviderSnapshot />}
        {ds && (
          <div className="card text-xs text-muted">
            <p className="mb-1 font-medium text-ink">About this data</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {ds.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>Values marked “calc” were calculated by this app from the provider’s data. A dash (—) means the source does not provide that value.</li>
            </ul>
            <p className="mt-2">
              <a className="underline" href={ds.attribution.url} target="_blank" rel="noreferrer">
                {ds.attribution.text}
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function HeroTile({ label, value, sub, icon, extra }: { label: string; value: string; sub?: string; icon?: React.ReactNode; extra?: string }) {
  return (
    <div className="glass p-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 font-display text-xl font-medium sm:text-2xl">
        {icon}
        {value}
        {extra && <span className="text-sm font-normal text-white/75">{extra}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-white/75">{sub}</div>}
    </div>
  );
}

function uvLabel(uv: number | null) {
  if (uv === null) return undefined;
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

function pressureTrend(ds: WeatherDataset, idx: number): string | undefined {
  const s = ds.hourly?.series.pressure_msl?.values;
  if (!s || idx < 0) return undefined;
  const a = s[idx];
  const b = s[Math.min(s.length - 1, idx + 3)];
  if (a === null || b === null) return undefined;
  const d = b - a;
  if (Math.abs(d) < 0.6) return 'Steady (next 3 h)';
  return d > 0 ? 'Rising (next 3 h)' : 'Falling (next 3 h)';
}

/* ---------------- hourly strip ---------------- */

function HourlyStrip({ ds, tz, startIdx }: { ds: WeatherDataset; tz: string; startIdx: number }) {
  const { prefs } = useApp();
  const h = ds.hourly!;
  const idx = Array.from({ length: 36 }, (_, i) => startIdx + i).filter((i) => i < h.time.length);
  const astroByDate = new Map((ds.astro ?? []).map((a) => [a.date, a]));
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">Next hours</h2>
        <KindBadge kind="forecast" />
      </div>
      <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto pb-2">
        {idx.map((i, k) => {
          const t = h.time[i];
          const a = astroByDate.get(localDate(t, ds.timezone));
          const night = a?.sunrise && a?.sunset ? Date.parse(t) < Date.parse(a.sunrise) || Date.parse(t) > Date.parse(a.sunset) : false;
          const pop = h.series.precipitation_probability?.values[i] ?? null;
          return (
            <div key={t} className={`flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center ${k === 0 ? 'bg-accent/10' : ''}`}>
              <div className="text-xs font-medium text-muted">{k === 0 ? 'Now' : formatTime(t, tz, { hour: '2-digit' })}</div>
              <WeatherIcon condition={h.conditions?.[i] ?? null} night={night} size={34} />
              <div className="font-display text-base font-semibold">{h.series.temperature?.values[i] === null || h.series.temperature?.values[i] === undefined ? '—' : `${Math.round(toDisplay('temperature', h.series.temperature.values[i], prefs.units)!)}°`}</div>
              <div className={`text-[11px] tabular-nums ${pop && pop >= 30 ? 'font-medium text-sky-600 dark:text-sky-400' : 'text-muted'}`}>{pop === null ? '' : `${Math.round(pop)}%`}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- charts ---------------- */

function ForecastCharts({ ds, tz, now }: { ds: WeatherDataset; tz: string; now: number }) {
  const { prefs } = useApp();
  const [tab, setTab] = useState<'temp' | 'precip' | 'wind'>('temp');
  const [range, setRange] = useState<'48h' | '7d'>('48h');
  const u = prefs.units;
  const rows: ChartRow[] = useMemo(() => {
    const h = ds.hourly;
    if (!h) return [];
    const start = Date.parse(h.time[0]);
    const startNow = Math.max(start, Math.floor(now / 3600_000) * 3600_000 - 3 * 3600_000);
    const end = startNow + (range === '48h' ? 48 : 7 * 24) * 3600_000;
    const out: ChartRow[] = [];
    h.time.forEach((t, i) => {
      const ms = Date.parse(t);
      if (ms < startNow || ms > end) return;
      const g = (id: string) => toDisplay(id, h.series[id]?.values[i] ?? null, u);
      out.push({ t: ms, temperature: g('temperature'), apparent_temperature: g('apparent_temperature'), dew_point: g('dew_point'), precipitation: g('precipitation'), precipitation_probability: g('precipitation_probability'), wind_speed: g('wind_speed'), wind_gusts: g('wind_gusts') });
    });
    return out;
  }, [ds, range, now, u]);

  const has = (id: string) => !!ds.hourly?.series[id];
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'temp', label: 'Temperature' },
            { value: 'precip', label: 'Precipitation' },
            { value: 'wind', label: 'Wind' },
          ]}
        />
        <Segmented
          size="xs"
          value={range}
          onChange={setRange}
          options={[
            { value: '48h', label: '48 h' },
            { value: '7d', label: '7 days' },
          ]}
        />
      </div>
      {tab === 'temp' && (
        <TimeChart
          rows={rows}
          unit={unitFor('temperature', u)}
          timeZone={tz}
          now={now}
          showLegend
          series={[
            { key: 'temperature', label: 'Temperature', color: 'var(--series-2)', type: 'area' },
            ...(has('apparent_temperature') ? [{ key: 'apparent_temperature', label: 'Feels like', color: 'var(--series-2)', dash: '4 4' }] : []),
            ...(has('dew_point') ? [{ key: 'dew_point', label: 'Dew point', color: 'var(--series-1)' }] : []),
          ]}
        />
      )}
      {tab === 'precip' && (
        <div className="space-y-4">
          <TimeChart rows={rows} unit={unitFor('precipitation', u)} timeZone={tz} now={now} series={[{ key: 'precipitation', label: 'Precipitation', color: 'var(--series-1)', type: 'bar', decimals: 2 }]} height={180} />
          {has('precipitation_probability') && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Chance of precipitation</p>
              <TimeChart rows={rows} unit="%" timeZone={tz} now={now} yDomain={[0, 100]} series={[{ key: 'precipitation_probability', label: 'Chance', color: 'var(--series-1)', type: 'area', decimals: 0 }]} height={120} />
            </div>
          )}
        </div>
      )}
      {tab === 'wind' && (
        <TimeChart
          rows={rows}
          unit={unitFor('wind_speed', u)}
          timeZone={tz}
          now={now}
          showLegend
          yDomain={[0, 'auto']}
          series={[
            { key: 'wind_speed', label: 'Wind speed', color: 'var(--series-3)', type: 'area' },
            ...(has('wind_gusts') ? [{ key: 'wind_gusts', label: 'Gusts', color: 'var(--series-3)', dash: '4 4' }] : []),
          ]}
        />
      )}
    </section>
  );
}

/* ---------------- 7-day list ---------------- */

function DailyList({ ds, tz }: { ds: WeatherDataset; tz: string }) {
  const { prefs } = useApp();
  const d = ds.daily;
  if (!d) return null;
  const today = todayIn(ds.timezone);
  const start = Math.max(0, d.time.indexOf(today));
  const idx = Array.from({ length: 7 }, (_, i) => start + i).filter((i) => i < d.time.length);
  const max = d.series.temperature_max?.values ?? [];
  const min = d.series.temperature_min?.values ?? [];
  const vals = idx.flatMap((i) => [max[i], min[i]]).filter((x): x is number => x !== null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pct = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;
  void tz;
  return (
    <section className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title">7-day forecast</h2>
        <KindBadge kind="forecast" />
      </div>
      <ul className="divide-y divide-line">
        {idx.map((i) => {
          const mx = max[i] ?? null;
          const mn = min[i] ?? null;
          const pop = d.series.precipitation_probability?.values[i] ?? null;
          const pr = d.series.precipitation?.values[i] ?? null;
          return (
            <li key={d.time[i]} className="grid grid-cols-[4.5rem_2.5rem_3rem_1fr] items-center gap-2 py-2 text-sm">
              <span className="font-medium">{d.time[i] === today ? 'Today' : formatDate(d.time[i], { weekday: 'short', day: 'numeric' })}</span>
              <WeatherIcon condition={d.conditions?.[i] ?? null} size={30} />
              <span className="text-xs tabular-nums text-sky-600 dark:text-sky-400" title={pr !== null ? formatValue('precipitation', pr, prefs.units) : undefined}>
                {pop !== null ? `${Math.round(pop)}%` : pr !== null && pr > 0 ? formatValue('precipitation', pr, prefs.units) : ''}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="w-9 text-right text-muted">{mn === null ? '—' : `${Math.round(toDisplay('temperature', mn, prefs.units)!)}°`}</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-line">
                  {mx !== null && mn !== null && (
                    <span className="absolute h-full rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-orange-500" style={{ left: `${pct(mn)}%`, width: `${Math.max(4, pct(mx) - pct(mn))}%` }} />
                  )}
                </span>
                <span className="w-9 font-medium">{mx === null ? '—' : `${Math.round(toDisplay('temperature', mx, prefs.units)!)}°`}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {idx.length < 7 && <p className="mt-2 text-xs text-muted">This source only forecasts {idx.length} days ahead.</p>}
    </section>
  );
}

/* ---------------- details ---------------- */

const DETAIL_GROUPS: { category: Category; hourly: string[]; daily: string[] }[] = [
  { category: 'temperature', hourly: ['apparent_temperature', 'dew_point', 'heat_index', 'wind_chill'], daily: ['temperature_mean', 'apparent_temperature_max', 'apparent_temperature_min'] },
  { category: 'precipitation', hourly: ['snow_depth'], daily: ['precipitation', 'rain', 'snowfall', 'precipitation_hours', 'precipitation_probability'] },
  { category: 'wind', hourly: ['wind_speed', 'wind_gusts', 'wind_direction'], daily: ['wind_speed_max', 'wind_gusts_max'] },
  { category: 'atmosphere', hourly: ['cloud_cover', 'visibility', 'surface_pressure', 'cape', 'lifted_index', 'freezing_level', 'vapour_pressure_deficit'], daily: [] },
  { category: 'sun', hourly: ['shortwave_radiation'], daily: ['uv_index_max', 'daylight_duration', 'sunshine_duration', 'shortwave_radiation_sum'] },
  { category: 'soil', hourly: ['soil_temperature_0cm', 'soil_temperature_6cm', 'soil_moisture_0_1cm', 'leaf_wetness'], daily: ['et0', 'growing_degree_days'] },
];

function DetailGrid({
  ds,
  cur,
  day,
  tz,
  astro,
  extras,
}: {
  ds: WeatherDataset;
  cur: (id: string) => { v: number | null; from: 'current' | 'hourly' | null };
  day: (id: string) => number | null;
  tz: string;
  astro?: { sunrise: string | null; sunset: string | null };
  extras: { air: ProviderResult; marine: ProviderResult } | null;
}) {
  const { prefs } = useApp();
  const u = prefs.units;
  const air = extras?.air?.ok ? extras.air.data : null;
  const marine = extras?.marine?.ok && extras.marine.data.current ? extras.marine.data : null;
  return (
    <section>
      <h2 className="section-title mb-3">All conditions</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DETAIL_GROUPS.map((g) => (
          <div key={g.category} className="card">
            <h3 className="mb-2 text-sm font-semibold">{CATEGORY_LABELS[g.category]}</h3>
            <dl className="space-y-1.5 text-sm">
              {g.hourly.map((id) => {
                const { v } = cur(id);
                const s = ds.hourly?.series[id];
                return <Row key={id} label={`${getVariable(id)?.label} (now)`} value={id === 'wind_direction' && v !== null ? `${Math.round(v)}° ${compass(v)}` : formatValue(id, v, u)} origin={s?.origin} note={s?.note} />;
              })}
              {g.daily.map((id) => {
                const s = ds.daily?.series[id];
                return <Row key={id} label={`${getVariable(id)?.label} (today)`} value={formatValue(id, day(id), u)} origin={s?.origin} note={s?.note} />;
              })}
              {g.category === 'sun' && (
                <>
                  <Row label="Sunrise" value={astro ? formatTime(astro.sunrise, tz) : '—'} />
                  <Row label="Sunset" value={astro ? formatTime(astro.sunset, tz) : '—'} />
                </>
              )}
            </dl>
          </div>
        ))}
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Air quality</h3>
            {air && <span className="text-[11px] text-muted">CAMS model</span>}
          </div>
          {!extras && <Skeleton className="h-24" />}
          {extras && !air && <p className="text-sm text-muted">Air quality data is unavailable right now{extras.air && !extras.air.ok ? `: ${extras.air.error.error}` : ''}.</p>}
          {air && (
            <dl className="space-y-1.5 text-sm">
              {['european_aqi', 'us_aqi', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone'].map((id) => (
                <Row key={id} label={getVariable(id)!.label} value={formatValue(id, air.current?.values[id] ?? null, u)} />
              ))}
            </dl>
          )}
        </div>
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Marine</h3>
          {!extras && <Skeleton className="h-24" />}
          {extras && !marine && <p className="text-sm text-muted">No marine forecast for this location (inland, or the wave model has no data here).</p>}
          {marine && (
            <dl className="space-y-1.5 text-sm">
              {['wave_height', 'swell_wave_height', 'wave_period', 'wave_direction', 'sea_surface_temperature'].map((id) => (
                <Row key={id} label={getVariable(id)!.label} value={formatValue(id, marine.current?.values[id] ?? null, u)} />
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, origin, note }: { label: string; value: string; origin?: 'provider' | 'calculated'; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-medium tabular-nums ${value === '—' ? 'text-muted/70' : ''}`} title={value === '—' ? 'Not provided by this source' : note}>
        {value}
        <OriginMark origin={origin} note={note} />
      </dd>
    </div>
  );
}

/* ---------------- provider snapshot ---------------- */

function ProviderSnapshot() {
  const { location, prefs } = useApp();
  const ids = prefs.compareProviders.join(',');
  const { data, loading } = useJson<{ results: ProviderResult[] }>(`/api/compare?providers=${ids}&${locationQuery(location)}`);
  const u = prefs.units;
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Today across sources</h2>
          <p className="text-xs text-muted">Each row is one independent source. Nothing is averaged together.</p>
        </div>
        <Link href="/compare" className="btn-ghost">
          Full comparison →
        </Link>
      </div>
      {loading && !data && <Skeleton className="h-32" />}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 text-right font-medium">High</th>
                <th className="py-2 text-right font-medium">Low</th>
                <th className="py-2 text-right font-medium">Precip</th>
                <th className="py-2 text-right font-medium">Max gust</th>
                <th className="py-2 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.results.map((r) => {
                if (!r.ok)
                  return (
                    <tr key={r.error.providerId}>
                      <td className="py-2 font-medium">{r.error.providerName}</td>
                      <td colSpan={5} className="py-2 text-right text-xs text-muted">
                        Unavailable: {r.error.error}
                      </td>
                    </tr>
                  );
                const d = r.data;
                const i = d.daily?.time.indexOf(todayIn(d.timezone)) ?? -1;
                const g = (id: string) => (i >= 0 ? (d.daily?.series[id]?.values[i] ?? null) : null);
                return (
                  <tr key={d.providerId}>
                    <td className="py-2 font-medium">{d.providerName}</td>
                    <td className="py-2 text-right tabular-nums">{formatValue('temperature_max', g('temperature_max'), u)}</td>
                    <td className="py-2 text-right tabular-nums">{formatValue('temperature_min', g('temperature_min'), u)}</td>
                    <td className="py-2 text-right tabular-nums">{formatValue('precipitation', g('precipitation'), u)}</td>
                    <td className="py-2 text-right tabular-nums">{formatValue('wind_gusts_max', g('wind_gusts_max'), u)}</td>
                    <td className="py-2 text-right text-xs text-muted">{d.updatedAt ? formatTime(d.updatedAt, d.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'n/a'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

