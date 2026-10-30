'use client';

import { useEffect, useRef, useState } from 'react';
import type { Location } from '@/lib/types';
import { useApp } from './AppState';

interface Props {
  onSelect?: (l: Location) => void;
  /** When true, selecting a result does not change the app's current location. */
  detached?: boolean;
  placeholder?: string;
  variant?: 'glass' | 'plain';
  autoFocus?: boolean;
}

export function LocationSearch({ onSelect, detached, placeholder = 'Search town, city or coordinates…', variant = 'plain', autoFocus }: Props) {
  const { setLocation, favourites, recent } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = await r.json();
        setResults(j.results ?? []);
        setError(j.error ?? null);
        setActive(0);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Search is unavailable right now.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (l: Location) => {
    if (!detached) setLocation(l);
    onSelect?.(l);
    setQ('');
    setOpen(false);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Your browser does not support location access.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const r = await fetch(`/api/geocode?q=${lat.toFixed(4)},${lon.toFixed(4)}`);
          const j = await r.json();
          const base = j.results?.[0] ?? { latitude: lat, longitude: lon };
          choose({ ...base, name: 'My location', region: `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
        } catch {
          choose({ name: 'My location', latitude: lat, longitude: lon });
        } finally {
          setLoading(false);
        }
      },
      () => {
        setLoading(false);
        setError('Location permission was denied.');
      },
      { timeout: 10000 },
    );
  };

  const suggestions = q.trim().length >= 2 ? results : [...favourites, ...recent.filter((r) => !favourites.some((f) => f.latitude === r.latitude && f.longitude === r.longitude))].slice(0, 8);
  const glass = variant === 'glass';

  return (
    <div ref={boxRef} className="relative w-full">
      <div className={`flex items-center gap-2 rounded-xl border px-3 ${glass ? 'border-white/25 bg-white/15 text-white backdrop-blur-md' : 'border-line bg-surface'}`}>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${glass ? 'text-white/80' : 'text-muted'}`} fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          className={`w-full bg-transparent py-2.5 text-sm outline-none ${glass ? 'placeholder:text-white/70' : 'placeholder:text-muted'}`}
          value={q}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label="Search locations"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, suggestions.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            if (e.key === 'Enter' && suggestions[active]) choose(suggestions[active]);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {loading && <span className={`h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent ${glass ? 'border-white/70' : 'border-accent'}`} />}
        <button type="button" onClick={useMyLocation} title="Use my location" className={`shrink-0 rounded-lg p-1 ${glass ? 'hover:bg-white/20' : 'hover:bg-canvas'}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          <span className="sr-only">Use my location</span>
        </button>
      </div>
      {open && (suggestions.length > 0 || error || (q.trim().length >= 2 && !loading)) && (
        <ul className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-surface p-1 text-ink shadow-xl" role="listbox">
          {q.trim().length < 2 && suggestions.length > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">Saved & recent</li>}
          {suggestions.map((l, i) => (
            <li key={`${l.latitude},${l.longitude},${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(l)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-canvas' : ''}`}
              >
                <span>
                  <span className="font-medium">{l.name}</span>
                  {l.region && <span className="ml-2 text-muted">{l.region}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {l.latitude.toFixed(2)}, {l.longitude.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
          {error && <li className="px-3 py-2 text-sm text-red-500">{error}</li>}
          {!error && q.trim().length >= 2 && !loading && results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No places found. You can also type coordinates, e.g. 51.5, -0.12</li>}
        </ul>
      )}
    </div>
  );
}
