import type { DataKind, Location, WeatherDataset } from '../types';

export interface ProviderInfo {
  id: string;
  name: string;
  shortName: string;
  organisation: string;
  /** What this provider gives us. */
  kind: DataKind;
  description: string;
  coverage: string;
  /** Plain-language usage limits / registration requirements. */
  access: string;
  requiresKey: boolean;
  /** For key-based providers, whether a key is configured on the server. */
  enabled: boolean;
  url: string;
  /** Chart colour, distinct per provider. */
  color: string;
  supportsForecast: boolean;
  /** Historical range offered, if any. */
  historyRange?: { from: string; toDaysAgo: number; resolutions: ('hourly' | 'daily')[]; kind: DataKind };
}

export interface ForecastOptions {
  days?: number;
}

export interface HistoryOptions {
  resolution: 'hourly' | 'daily';
}

export interface Provider extends ProviderInfo {
  covers(loc: Location): boolean;
  forecast?(loc: Location, opts?: ForecastOptions): Promise<WeatherDataset>;
  history?(loc: Location, start: string, end: string, opts: HistoryOptions): Promise<WeatherDataset>;
}
