'use client';

import { useApp } from '@/components/AppState';
import { LocationSearch } from '@/components/LocationSearch';
import { PageHeader, Segmented } from '@/components/ui';
import { useProviders } from '@/components/useProviders';
import { UNIT_LABELS, type UnitPrefs } from '@/lib/units';

const ZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { prefs, setPrefs, setUnits, favourites, toggleFavourite, setLocation, location } = useApp();
  const providers = useProviders(location).filter((p) => p.supportsForecast);
  const unit = <K extends keyof UnitPrefs>(k: K) => (
    <Segmented<string> value={prefs.units[k]} onChange={(v) => setUnits({ [k]: v } as Partial<UnitPrefs>)} options={Object.entries(UNIT_LABELS[k]).map(([value, label]) => ({ value, label }))} />
  );
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Settings" subtitle="Preferences are saved in this browser and remembered between visits." />

      <section className="card mb-6">
        <h2 className="section-title">Units</h2>
        <Field label="Temperature">{unit('temperature')}</Field>
        <Field label="Wind speed">{unit('speed')}</Field>
        <Field label="Precipitation" hint="Snow is shown in cm or inches to match.">{unit('precipitation')}</Field>
        <Field label="Pressure">{unit('pressure')}</Field>
        <Field label="Visibility">{unit('distance')}</Field>
      </section>

      <section className="card mb-6">
        <h2 className="section-title">Display</h2>
        <Field label="Theme">
          <Segmented
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Field>
        <Field label="Animations" hint="Reduced keeps the sky but stops moving particles. Off shows a still background.">
          <Segmented
            value={prefs.animation}
            onChange={(animation) => setPrefs({ animation })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Field>
        <Field label="Timezone for times" hint="Location time follows whichever place you are viewing.">
          <select className="input w-64" value={prefs.timezone} onChange={(e) => setPrefs({ timezone: e.target.value })}>
            <option value="location">Location’s local time</option>
            <option value="browser">This device’s time</option>
            <option value="UTC">UTC</option>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default source on the homepage">
          <select className="input w-64" value={prefs.homeProvider} onChange={(e) => setPrefs({ homeProvider: e.target.value })}>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="card">
        <h2 className="section-title mb-3">Saved locations</h2>
        <div className="mb-3">
          <LocationSearch detached onSelect={(l) => toggleFavourite(l)} placeholder="Search to add a favourite…" />
        </div>
        {favourites.length === 0 && <p className="text-sm text-muted">No favourites yet. Tap the star next to a location name on the homepage, or search above.</p>}
        <ul className="divide-y divide-line">
          {favourites.map((f) => (
            <li key={`${f.latitude},${f.longitude}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{f.name}</span> <span className="text-muted">{f.region}</span>
              </span>
              <span className="flex gap-2">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setLocation(f)}>
                  View
                </button>
                <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => toggleFavourite(f)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
