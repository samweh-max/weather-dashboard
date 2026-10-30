'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Location } from '@/lib/types';
import { DEFAULT_UNITS, type UnitPrefs } from '@/lib/units';

export type ThemePref = 'system' | 'light' | 'dark';
export type AnimationPref = 'full' | 'reduced' | 'off';

export interface Prefs {
  units: UnitPrefs;
  /** 'location' | 'browser' | 'UTC' | an IANA zone */
  timezone: string;
  theme: ThemePref;
  animation: AnimationPref;
  homeProvider: string;
  compareProviders: string[];
}

const DEFAULT_PREFS: Prefs = {
  units: DEFAULT_UNITS,
  timezone: 'location',
  theme: 'system',
  animation: 'full',
  homeProvider: 'om-best',
  compareProviders: ['om-best', 'om-ecmwf', 'om-gfs', 'om-icon', 'om-ukmo', 'metno'],
};

/** A real place to start from until the user picks one (data shown is still live). */
const DEFAULT_LOCATION: Location = {
  name: 'London',
  region: 'England, United Kingdom',
  country: 'United Kingdom',
  countryCode: 'GB',
  latitude: 51.50853,
  longitude: -0.12574,
  elevation: 25,
  timezone: 'Europe/London',
};

interface AppState {
  ready: boolean;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  setUnits: (u: Partial<UnitPrefs>) => void;
  location: Location;
  setLocation: (l: Location) => void;
  favourites: Location[];
  isFavourite: (l: Location) => boolean;
  toggleFavourite: (l: Location) => void;
  recent: Location[];
  resolvedTheme: 'light' | 'dark';
  reducedMotion: boolean;
}

const Ctx = createContext<AppState | null>(null);

const KEY = 'weather-dashboard:v1';

const sameLoc = (a: Location, b: Location) => Math.abs(a.latitude - b.latitude) < 0.001 && Math.abs(a.longitude - b.longitude) < 0.001;

function load(): { prefs: Prefs; location: Location; favourites: Location[]; recent: Location[] } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return {
      prefs: { ...DEFAULT_PREFS, ...j.prefs, units: { ...DEFAULT_UNITS, ...(j.prefs?.units ?? {}) } },
      location: j.location ?? DEFAULT_LOCATION,
      favourites: Array.isArray(j.favourites) ? j.favourites : [],
      recent: Array.isArray(j.recent) ? j.recent : [],
    };
  } catch {
    return null;
  }
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [location, setLocationState] = useState<Location>(DEFAULT_LOCATION);
  const [favourites, setFavourites] = useState<Location[]>([]);
  const [recent, setRecent] = useState<Location[]>([]);
  const [systemDark, setSystemDark] = useState(false);
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const s = load();
    if (s) {
      setPrefsState(s.prefs);
      setLocationState(s.location);
      setFavourites(s.favourites);
      setRecent(s.recent);
    } else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPrefsState((p) => ({ ...p, animation: 'reduced' }));
    }
    // a ?lat=&lon=&name= link opens that location
    const sp = new URLSearchParams(window.location.search);
    const lat = Number(sp.get('lat'));
    const lon = Number(sp.get('lon'));
    if (sp.has('lat') && Number.isFinite(lat) && Number.isFinite(lon)) {
      setLocationState({ name: sp.get('name') || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, latitude: lat, longitude: lon, timezone: sp.get('tz') || undefined });
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemDark(mq.matches);
    setSystemReduced(rm.matches);
    const on = () => setSystemDark(mq.matches);
    const onR = () => setSystemReduced(rm.matches);
    mq.addEventListener('change', on);
    rm.addEventListener('change', onR);
    setReady(true);
    return () => {
      mq.removeEventListener('change', on);
      rm.removeEventListener('change', onR);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ prefs, location, favourites, recent }));
    } catch {
      /* storage unavailable: preferences just won't persist */
    }
  }, [ready, prefs, location, favourites, recent]);

  const resolvedTheme: 'light' | 'dark' = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const setPrefs = useCallback((p: Partial<Prefs>) => setPrefsState((old) => ({ ...old, ...p })), []);
  const setUnits = useCallback((u: Partial<UnitPrefs>) => setPrefsState((old) => ({ ...old, units: { ...old.units, ...u } })), []);
  const setLocation = useCallback((l: Location) => {
    setLocationState(l);
    setRecent((r) => [l, ...r.filter((x) => !sameLoc(x, l))].slice(0, 8));
  }, []);
  const isFavourite = useCallback((l: Location) => favourites.some((f) => sameLoc(f, l)), [favourites]);
  const toggleFavourite = useCallback((l: Location) => setFavourites((f) => (f.some((x) => sameLoc(x, l)) ? f.filter((x) => !sameLoc(x, l)) : [...f, l])), []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      prefs,
      setPrefs,
      setUnits,
      location,
      setLocation,
      favourites,
      isFavourite,
      toggleFavourite,
      recent,
      resolvedTheme,
      reducedMotion: prefs.animation === 'off' || prefs.animation === 'reduced' || (systemReduced && prefs.animation !== 'full'),
    }),
    [ready, prefs, setPrefs, setUnits, location, setLocation, favourites, isFavourite, toggleFavourite, recent, resolvedTheme, systemReduced],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used inside AppStateProvider');
  return c;
}

export function locationQuery(l: Location): string {
  const p = new URLSearchParams({ lat: String(l.latitude), lon: String(l.longitude), name: l.name });
  if (l.timezone) p.set('tz', l.timezone);
  if (l.countryCode) p.set('cc', l.countryCode);
  if (l.elevation !== undefined && Number.isFinite(l.elevation)) p.set('elev', String(l.elevation));
  return p.toString();
}
