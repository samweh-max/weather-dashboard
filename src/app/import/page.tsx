'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppState';
import { LocationSearch } from '@/components/LocationSearch';
import { KindBadge, Notice, PageHeader, Spinner } from '@/components/ui';
import { useJson } from '@/components/useJson';
import { autoConfig, runImport, type Cell, type ColumnMapping, type ImportConfig, type SheetData } from '@/lib/import';
import { safeTimeZone } from '@/lib/time';
import type { ImportedDatasetMeta, Location } from '@/lib/types';
import { sourceUnitsFor, guessSourceUnit } from '@/lib/units';
import { CATEGORY_LABELS, getVariable, VARIABLES, type Category } from '@/lib/variables';

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
})();

const cellText = (c: Cell) => (c === null || c === undefined ? '' : typeof c === 'object' ? c.date.replace('T', ' ').replace(/:00$/, '') : String(c));

export default function ImportPage() {
  const { location } = useApp();
  const [file, setFile] = useState<{ name: string; sheets: SheetData[] } | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [cfg, setCfg] = useState<ImportConfig | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState('');
  const [loc, setLoc] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ImportedDatasetMeta | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const list = useJson<{ datasets: ImportedDatasetMeta[] }>('/api/datasets');

  const sheet = file?.sheets[sheetIdx];
  const deferredCfg = useDeferredValue(cfg);
  const result = useMemo(() => (sheet && deferredCfg ? runImport(sheet, deferredCfg) : null), [sheet, deferredCfg]);
  const hasErrors = !!result?.issues.some((i) => i.level === 'error');

  const upload = async (f: File) => {
    setError(null);
    setSaved(null);
    if (!/\.xlsx$/i.test(f.name)) {
      setError('Please choose an .xlsx file. (Older .xls files can be re-saved as .xlsx from Excel.)');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/import/parse', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not read the file.');
      const sheets: SheetData[] = j.sheets;
      const firstUseful = Math.max(0, sheets.findIndex((s) => s.rows.length > 1));
      setFile({ name: j.fileName, sheets });
      setSheetIdx(firstUseful);
      setCfg(autoConfig(sheets[firstUseful], location.timezone || 'UTC'));
      setName(f.name.replace(/\.xlsx$/i, ''));
      setLoc(location);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const chooseSheet = (i: number) => {
    if (!file) return;
    setSheetIdx(i);
    setCfg(autoConfig(file.sheets[i], cfg?.timezone ?? location.timezone ?? 'UTC'));
  };

  const updateMapping = (col: number, patch: Partial<ColumnMapping>) =>
    setCfg((c) => (c ? { ...c, mappings: c.mappings.map((m) => (m.column === col ? { ...m, ...patch } : m)) } : c));

  const setHeaderRow = (r: number) => {
    if (!sheet || !cfg) return;
    setCfg({ ...autoConfig(sheet, cfg.timezone, r), timezone: cfg.timezone });
  };

  const save = async () => {
    if (!result || !cfg || !file || !sheet) return;
    setSaving(true);
    setError(null);
    try {
      const series = Object.fromEntries(Object.entries(result.series));
      const meta = {
        name: name.trim() || file.name,
        sourceFile: file.name,
        sheet: sheet.name,
        resolution: result.resolution,
        location: loc,
        timezone: cfg.timezone,
        variables: Object.keys(series),
        rowCount: result.time.length,
        start: result.time[0],
        end: result.time[result.time.length - 1],
        mapping: cfg.mappings.filter((m) => m.variable).map((m) => ({ column: m.header, variable: m.variable, sourceUnit: m.unit })),
        warnings: result.issues.filter((i) => i.level === 'warning').map((i) => i.message),
      };
      const r = await fetch('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta, data: { time: result.time, series } }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setSaved(j.dataset);
      setFile(null);
      setCfg(null);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this imported dataset? This cannot be undone.')) return;
    await fetch(`/api/datasets/${id}`, { method: 'DELETE' });
    list.reload();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader title="Import" subtitle="Bring your own weather records from Excel (.xlsx). Map the columns, check the preview and warnings, then confirm. Imported data stays labelled as yours and can be analysed in History, compared with provider data, and exported again." />

      {saved && (
        <div className="mb-6">
          <Notice kind="info">
            Imported <strong>{saved.name}</strong>: {saved.rowCount.toLocaleString()} {saved.resolution} rows.{' '}
            <Link className="underline" href={`/history?dataset=${saved.id}`}>
              Open in History →
            </Link>
          </Notice>
        </div>
      )}
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      {!file && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) upload(f);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          className={`card flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed py-16 text-center transition ${drag ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/50'}`}
        >
          {uploading ? <Spinner className="h-8 w-8" /> : (
            <svg viewBox="0 0 24 24" className="h-10 w-10 text-accent" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <div>
            <p className="font-medium">{uploading ? 'Reading workbook…' : 'Drop an .xlsx file here, or click to choose'}</p>
            <p className="mt-1 text-sm text-muted">Hourly, sub-hourly or daily data. Wide tables with one column per variable work best. Up to 40 MB.</p>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
      )}

      {file && sheet && cfg && (
        <div className="space-y-6">
          {/* Step 1: structure */}
          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">1 · Structure</h2>
              <button className="btn-ghost" onClick={() => (setFile(null), setCfg(null))}>
                Choose another file
              </button>
            </div>
            <p className="text-sm text-muted">
              {file.name} · {file.sheets.length} worksheet{file.sheets.length > 1 ? 's' : ''} · {sheet.totalRows.toLocaleString()} rows in “{sheet.name}”
              {sheet.truncated && ' (only the first 200 000 rows are read)'}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label>
                <span className="label">Worksheet</span>
                <select className="input" value={sheetIdx} onChange={(e) => chooseSheet(Number(e.target.value))}>
                  {file.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.totalRows} rows)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Header row</span>
                <select className="input" value={cfg.headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                  {sheet.rows.slice(0, 30).map((r, i) => (
                    <option key={i} value={i}>
                      Row {i + 1}: {r.slice(0, 4).map(cellText).join(' | ').slice(0, 40)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Date / timestamp column</span>
                <select className="input" value={cfg.timeColumn} onChange={(e) => setCfg({ ...cfg, timeColumn: Number(e.target.value), mappings: cfg.mappings.map((m) => (m.column === Number(e.target.value) ? { ...m, variable: '' } : m)) })}>
                  {(sheet.rows[cfg.headerRow] ?? []).map((h, i) => (
                    <option key={i} value={i}>
                      {cellText(h) || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Separate time column</span>
                <select className="input" value={cfg.timeOfDayColumn ?? ''} onChange={(e) => setCfg({ ...cfg, timeOfDayColumn: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">None (timestamp includes time, or daily data)</option>
                  {(sheet.rows[cfg.headerRow] ?? []).map((h, i) =>
                    i === cfg.timeColumn ? null : (
                      <option key={i} value={i}>
                        {cellText(h) || `Column ${i + 1}`}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span className="label">Text date format</span>
                <select className="input" value={cfg.dateOrder} onChange={(e) => setCfg({ ...cfg, dateOrder: e.target.value as ImportConfig['dateOrder'] })}>
                  <option value="DMY">Day/Month/Year (31/01/2024)</option>
                  <option value="MDY">Month/Day/Year (01/31/2024)</option>
                  <option value="YMD">Year-Month-Day (2024-01-31)</option>
                </select>
              </label>
              <label>
                <span className="label">Timestamps are in timezone</span>
                <select className="input" value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: safeTimeZone(e.target.value) })}>
                  {['UTC', ...TIMEZONES.filter((z) => z !== 'UTC')].map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Resolution</span>
                <select className="input" value={cfg.resolution} onChange={(e) => setCfg({ ...cfg, resolution: e.target.value as ImportConfig['resolution'] })}>
                  <option value="auto">Detect automatically{result ? ` (${result.resolution})` : ''}</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                </select>
              </label>
              <label>
                <span className="label">Missing-value markers</span>
                <input className="input" value={cfg.missingMarkers.join(', ')} onChange={(e) => setCfg({ ...cfg, missingMarkers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.excludeImplausible} onChange={(e) => setCfg({ ...cfg, excludeImplausible: e.target.checked })} />
              Exclude physically implausible values (e.g. 400 °C, 140 % humidity). They are always reported below.
            </label>
          </section>

          {/* Step 2: mapping */}
          <section className="card">
            <h2 className="section-title mb-1">2 · Map columns</h2>
            <p className="mb-3 text-sm text-muted">Choose the weather variable and the unit each column is recorded in. Columns set to “Ignore” are not imported.</p>
            <div className="scroll-thin overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr>
                    {(sheet.rows[cfg.headerRow] ?? []).map((h, col) => {
                      const isTime = col === cfg.timeColumn || col === cfg.timeOfDayColumn;
                      const m = cfg.mappings.find((x) => x.column === col);
                      const def = m?.variable ? getVariable(m.variable) : undefined;
                      return (
                        <th key={col} className="min-w-[170px] border-b border-line px-2 pb-2 align-top text-left font-normal">
                          <div className="mb-1 truncate text-xs font-semibold" title={cellText(h)}>
                            {cellText(h) || `Column ${col + 1}`}
                          </div>
                          {isTime ? (
                            <span className="chip border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">{col === cfg.timeColumn ? 'Timestamp' : 'Time of day'}</span>
                          ) : m ? (
                            <div className="space-y-1">
                              <select
                                className="input py-1 text-xs"
                                value={m.variable}
                                onChange={(e) => {
                                  const d = getVariable(e.target.value);
                                  updateMapping(col, { variable: e.target.value, unit: d ? (guessSourceUnit(m.header, d.quantity) ?? '') : '' });
                                }}
                              >
                                <option value="">Ignore</option>
                                {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                                  <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                                    {VARIABLES.filter((v) => v.category === cat).map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                              {def && sourceUnitsFor(def.quantity).length > 0 && (
                                <select className="input py-1 text-xs" value={m.unit} onChange={(e) => updateMapping(col, { unit: e.target.value })}>
                                  {sourceUnitsFor(def.quantity).map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {def && sourceUnitsFor(def.quantity).length === 0 && <div className="text-[11px] text-muted">Unit: {def.unit || 'index'}</div>}
                            </div>
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.slice(cfg.headerRow + 1, cfg.headerRow + 13).map((r, i) => (
                    <tr key={i} className="border-b border-line/60">
                      {(sheet.rows[cfg.headerRow] ?? []).map((_, col) => (
                        <td key={col} className={`whitespace-nowrap px-2 py-1 tabular-nums ${col === cfg.timeColumn || col === cfg.timeOfDayColumn ? 'text-sky-700 dark:text-sky-300' : cfg.mappings.find((m) => m.column === col)?.variable ? '' : 'text-muted/60'}`}>
                          {cellText(r[col] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Step 3: validation */}
          {result && (
            <section className="card space-y-4">
              <h2 className="section-title">3 · Check</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <Stat label="Rows read" value={result.stats.rowsRead.toLocaleString()} />
                <Stat label={`${result.resolution === 'daily' ? 'Days' : 'Hours'} imported`} value={result.stats.rowsImported.toLocaleString()} />
                <Stat label="Bad timestamps" value={result.stats.invalidTimestamps.toLocaleString()} warn={result.stats.invalidTimestamps > 0} />
                <Stat label="Duplicates" value={result.stats.duplicates.toLocaleString()} warn={result.stats.duplicates > 0} />
                <Stat label="First" value={result.time[0] ? fmtKey(result.time[0], cfg.timezone, result.resolution) : '—'} />
                <Stat label="Last" value={result.time.length ? fmtKey(result.time[result.time.length - 1], cfg.timezone, result.resolution) : '—'} />
              </div>
              <ul className="space-y-1.5">
                {result.issues.length === 0 && <li className="text-sm text-emerald-600">No problems found.</li>}
                {result.issues.map((iss, i) => (
                  <li key={i} className={`rounded-lg px-3 py-1.5 text-sm ${iss.level === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : iss.level === 'warning' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'bg-canvas text-muted'}`}>
                    {iss.message}
                    {iss.rows?.length ? <span className="ml-1 text-xs opacity-75">(rows {iss.rows.join(', ')}{iss.rows.length >= 8 ? ', …' : ''})</span> : null}
                  </li>
                ))}
              </ul>
              <ConvertedPreview result={result} tz={cfg.timezone} />
            </section>
          )}

          {/* Step 4: confirm */}
          {result && (
            <section className="card space-y-4">
              <h2 className="section-title">4 · Save</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className="label">Dataset name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <div>
                  <span className="label">Location of these measurements</span>
                  <LocationSearch detached onSelect={setLoc} placeholder="Search to change…" />
                  <p className="mt-1 text-xs text-muted">{loc ? `${loc.name} (${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)})` : 'Not set'}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-primary" disabled={hasErrors || saving || !result.time.length} onClick={save}>
                  {saving ? <Spinner className="border-white border-t-transparent" /> : null}
                  Import {result.time.length.toLocaleString()} {result.resolution} rows
                </button>
                {hasErrors && <span className="text-sm text-red-600">Fix the errors above first.</span>}
                <span className="text-xs text-muted">Values are converted to standard units and stored unrounded.</span>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Existing datasets */}
      <section className="mt-10">
        <h2 className="section-title mb-3">Your imported datasets</h2>
        {list.data?.datasets.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {list.data.datasets.map((d) => (
              <div key={d.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted">
                      {d.sourceFile} · sheet “{d.sheet}” · imported {d.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <KindBadge kind="imported" />
                </div>
                <p className="mt-2 text-sm">
                  {d.rowCount.toLocaleString()} {d.resolution} rows · {d.start.slice(0, 10)} → {d.end.slice(0, 10)}
                  {d.location && ` · ${d.location.name}`}
                </p>
                <p className="mt-1 text-xs text-muted">{d.variables.map((v) => getVariable(v)?.label ?? v).join(', ')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="btn-ghost" href={`/history?dataset=${d.id}`}>
                    Analyse
                  </Link>
                  <Link className="btn-ghost" href={`/export?dataset=${d.id}`}>
                    Export
                  </Link>
                  <button className="btn-ghost text-red-600" onClick={() => remove(d.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{list.loading ? 'Loading…' : 'Nothing imported yet.'}</p>
        )}
      </section>
    </div>
  );
}

function fmtKey(k: string, tz: string, res: 'hourly' | 'daily') {
  if (res === 'daily') return k;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: safeTimeZone(tz) }).format(new Date(k));
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-canvas px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 font-medium tabular-nums ${warn ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
    </div>
  );
}

function ConvertedPreview({ result, tz }: { result: ReturnType<typeof runImport>; tz: string }) {
  const vars = Object.keys(result.series);
  if (!vars.length || !result.time.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">Preview after conversion (standard units, first 8 rows)</p>
      <div className="scroll-thin overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-2 py-1 font-medium">{result.resolution === 'daily' ? 'Date' : `Time (${tz})`}</th>
              {vars.map((v) => (
                <th key={v} className="px-2 py-1 text-right font-medium">
                  {getVariable(v)?.label} {getVariable(v)?.unit && `(${getVariable(v)?.unit})`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.time.slice(0, 8).map((t, i) => (
              <tr key={t} className="border-t border-line/60">
                <td className="whitespace-nowrap px-2 py-1 text-muted">{fmtKey(t, tz, result.resolution)}</td>
                {vars.map((v) => (
                  <td key={v} className="px-2 py-1 text-right tabular-nums">
                    {result.series[v][i] === null ? '—' : result.series[v][i]!.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
