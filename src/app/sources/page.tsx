import { PROVIDERS, providerInfo } from '@/lib/providers';
import { KindBadgeStatic } from './KindBadgeStatic';

export const dynamic = 'force-dynamic';

export default function SourcesPage() {
  const list = PROVIDERS.map((p) => providerInfo(p));
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Data sources</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Everything here is free. Only the Met Office DataHub needs a (free) key; its model data is also available without a key through the “Met Office UKMO” source. Responses are cached on the server to stay well inside each provider’s limits.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {list.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-xs text-muted">{p.organisation}</p>
              </div>
              <KindBadgeStatic kind={p.kind} />
            </div>
            <p className="mt-2 text-sm">{p.description}</p>
            <dl className="mt-3 space-y-1 text-xs">
              <div>
                <dt className="inline font-medium">Coverage: </dt>
                <dd className="inline text-muted">{p.coverage}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Access & limits: </dt>
                <dd className="inline text-muted">{p.access}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Status: </dt>
                <dd className={`inline ${p.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{p.enabled ? 'Enabled' : 'Disabled until an API key is configured'}</dd>
              </div>
            </dl>
            <a href={p.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs underline">
              Documentation
            </a>
          </div>
        ))}
        <div className="card">
          <h2 className="font-semibold">CAMS air quality & marine forecasts</h2>
          <p className="text-xs text-muted">Copernicus / ECMWF and national wave models, via Open-Meteo</p>
          <p className="mt-2 text-sm">Air quality (PM2.5, PM10, NO₂, O₃, European and US AQI) and marine data (waves, swell, sea temperature) are shown as supplementary layers for any location. Free, no key.</p>
        </div>
        <div className="card">
          <h2 className="font-semibold">Not included, and why</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted">
            <li>NOAA Climate Data Online (GHCN station history): free, but needs a token and is limited to 1 000 requests/day. ERA5 covers the same need without a key. A good candidate to add next.</li>
            <li>Meteostat station history: free data, but its API is now served through RapidAPI and needs a key.</li>
            <li>OpenWeatherMap, Tomorrow.io, Visual Crossing, WeatherAPI: free tiers exist but all need keys and have tighter limits. Can be added as optional providers later.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
