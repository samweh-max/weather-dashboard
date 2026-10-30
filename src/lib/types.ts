/** Shared data types. All values inside a dataset are in the canonical units of `variables.ts`. */

export type DataKind = 'forecast' | 'observation' | 'reanalysis' | 'imported';

/** Where a single series came from: straight from the provider, or calculated by this app. */
export type SeriesOrigin = 'provider' | 'calculated';

export type Condition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'sleet'
  | 'thunderstorm';

export interface Location {
  name: string;
  /** e.g. "Greater London, United Kingdom" */
  region?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  /** IANA timezone, e.g. "Europe/London". */
  timezone?: string;
}

export interface Series {
  /** One value per timestamp; null = not available. Never filled with made-up values. */
  values: (number | null)[];
  origin: SeriesOrigin;
  /** Short explanation for calculated series or provider caveats. */
  note?: string;
}

export interface TimeBlock {
  /**
   * Hourly: ISO UTC timestamps ("2026-10-30T21:00:00Z").
   * Daily: local calendar dates ("2026-10-30") in the dataset timezone.
   */
  time: string[];
  series: Record<string, Series>;
  /** Optional per-step condition (hourly or daily), mapped from provider codes. */
  conditions?: (Condition | null)[];
  /** Optional per-step text description straight from the provider. */
  descriptions?: (string | null)[];
}

export interface CurrentConditions {
  /** ISO UTC time of the observation / model step. */
  time: string;
  values: Record<string, number | null>;
  condition: Condition | null;
  description: string | null;
  isDay: boolean | null;
  kind: DataKind;
  /** e.g. station name for NWS observations. */
  sourceNote?: string;
}

export interface DailyAstro {
  date: string;
  sunrise: string | null; // ISO UTC
  sunset: string | null; // ISO UTC
}

export interface WeatherDataset {
  providerId: string;
  providerName: string;
  kind: DataKind;
  location: Location;
  timezone: string;
  /** When this app fetched the data (ISO). */
  fetchedAt: string;
  /** When the provider says the data was produced/updated, if it tells us (ISO). */
  updatedAt: string | null;
  current?: CurrentConditions;
  hourly?: TimeBlock;
  daily?: TimeBlock;
  astro?: DailyAstro[];
  /** Human-readable notes about coverage and caveats. */
  notes: string[];
  attribution: { text: string; url: string };
}

export interface ProviderError {
  providerId: string;
  providerName: string;
  error: string;
}

export type ProviderResult = { ok: true; data: WeatherDataset } | { ok: false; error: ProviderError };

export interface ImportedDatasetMeta {
  id: string;
  name: string;
  sourceFile: string;
  sheet: string;
  createdAt: string;
  resolution: 'hourly' | 'daily';
  location: Location | null;
  timezone: string;
  variables: string[];
  rowCount: number;
  start: string;
  end: string;
  /** Column → variable mapping and source units used during import, for traceability. */
  mapping: { column: string; variable: string; sourceUnit: string }[];
  warnings: string[];
}
