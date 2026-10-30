/**
 * The single registry of weather variables the app knows about.
 *
 * Every provider maps its own fields onto these ids and converts values into the
 * canonical unit listed here. Adding a new variable means adding an entry here
 * and mapping it in whichever providers offer it.
 */

export type Quantity =
  | 'temperature'
  | 'speed'
  | 'precipitation'
  | 'snow'
  | 'pressure'
  | 'distance'
  | 'percent'
  | 'direction'
  | 'radiation'
  | 'energy'
  | 'index'
  | 'duration'
  | 'soilMoisture'
  | 'concentration'
  | 'waveHeight'
  | 'period'
  | 'kpa'
  | 'degreeDays'
  | 'none';

/** How values combine when hourly data is summarised into days, months or years. */
export type Aggregation = 'mean' | 'sum' | 'max' | 'min' | 'direction';

export type Category =
  | 'temperature'
  | 'precipitation'
  | 'wind'
  | 'atmosphere'
  | 'sun'
  | 'soil'
  | 'air'
  | 'marine';

export interface VariableDef {
  id: string;
  label: string;
  short?: string;
  category: Category;
  quantity: Quantity;
  /** Canonical unit every provider must convert into. */
  unit: string;
  aggregation: Aggregation;
  description: string;
  /** Which resolutions this variable naturally exists at. */
  resolutions: ('hourly' | 'daily')[];
}

const v = (d: VariableDef) => d;

export const VARIABLES: VariableDef[] = [
  // Temperature
  v({ id: 'temperature', label: 'Temperature', short: 'Temp', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['hourly'], description: 'Air temperature at 2 m above ground.' }),
  v({ id: 'temperature_max', label: 'Maximum temperature', short: 'Max', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'max', resolutions: ['daily'], description: 'Highest 2 m air temperature of the day.' }),
  v({ id: 'temperature_min', label: 'Minimum temperature', short: 'Min', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'min', resolutions: ['daily'], description: 'Lowest 2 m air temperature of the day.' }),
  v({ id: 'temperature_mean', label: 'Average temperature', short: 'Avg', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['daily'], description: 'Mean 2 m air temperature of the day. Calculated from hourly values when the provider does not supply it.' }),
  v({ id: 'apparent_temperature', label: 'Feels like', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['hourly'], description: 'Perceived temperature combining wind chill, humidity and solar radiation (as defined by the provider).' }),
  v({ id: 'apparent_temperature_max', label: 'Feels like max', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'max', resolutions: ['daily'], description: 'Highest perceived temperature of the day.' }),
  v({ id: 'apparent_temperature_min', label: 'Feels like min', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'min', resolutions: ['daily'], description: 'Lowest perceived temperature of the day.' }),
  v({ id: 'dew_point', label: 'Dew point', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['hourly'], description: 'Temperature to which air must cool to become saturated.' }),
  v({ id: 'heat_index', label: 'Heat index', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'max', resolutions: ['hourly'], description: 'NOAA heat index (Rothfusz regression). Only meaningful above about 27 °C; equal to air temperature otherwise.' }),
  v({ id: 'wind_chill', label: 'Wind chill', category: 'temperature', quantity: 'temperature', unit: '°C', aggregation: 'min', resolutions: ['hourly'], description: 'NWS/Environment Canada wind chill. Only defined at or below 10 °C with wind above 4.8 km/h; equal to air temperature otherwise.' }),
  v({ id: 'growing_degree_days', label: 'Growing degree days', short: 'GDD', category: 'soil', quantity: 'degreeDays', unit: '°C·d', aggregation: 'sum', resolutions: ['daily'], description: 'Daily growing degree days, base 10 °C: max(0, (Tmax + Tmin) / 2 − 10). Calculated.' }),

  // Precipitation
  v({ id: 'precipitation', label: 'Precipitation', short: 'Precip', category: 'precipitation', quantity: 'precipitation', unit: 'mm', aggregation: 'sum', resolutions: ['hourly', 'daily'], description: 'Total liquid-equivalent precipitation (rain, showers and snow) in the period.' }),
  v({ id: 'rain', label: 'Rain', category: 'precipitation', quantity: 'precipitation', unit: 'mm', aggregation: 'sum', resolutions: ['hourly', 'daily'], description: 'Rainfall from large-scale systems and showers in the period.' }),
  v({ id: 'precipitation_probability', label: 'Chance of precipitation', short: 'PoP', category: 'precipitation', quantity: 'percent', unit: '%', aggregation: 'max', resolutions: ['hourly', 'daily'], description: 'Probability of more than 0.1 mm of precipitation. Daily value is the highest hourly probability.' }),
  v({ id: 'snowfall', label: 'Snowfall', category: 'precipitation', quantity: 'snow', unit: 'cm', aggregation: 'sum', resolutions: ['hourly', 'daily'], description: 'Fresh snowfall depth in the period.' }),
  v({ id: 'snow_depth', label: 'Snow depth', category: 'precipitation', quantity: 'snow', unit: 'cm', aggregation: 'mean', resolutions: ['hourly'], description: 'Depth of snow on the ground.' }),
  v({ id: 'precipitation_hours', label: 'Hours with precipitation', category: 'precipitation', quantity: 'duration', unit: 'h', aggregation: 'sum', resolutions: ['daily'], description: 'Number of hours in the day with measurable precipitation.' }),

  // Wind
  v({ id: 'wind_speed', label: 'Wind speed', short: 'Wind', category: 'wind', quantity: 'speed', unit: 'km/h', aggregation: 'mean', resolutions: ['hourly'], description: 'Sustained wind speed at 10 m (usually a 10-minute mean, depending on provider).' }),
  v({ id: 'wind_speed_max', label: 'Maximum wind speed', category: 'wind', quantity: 'speed', unit: 'km/h', aggregation: 'max', resolutions: ['daily'], description: 'Highest sustained 10 m wind speed of the day.' }),
  v({ id: 'wind_gusts', label: 'Wind gusts', short: 'Gusts', category: 'wind', quantity: 'speed', unit: 'km/h', aggregation: 'max', resolutions: ['hourly'], description: 'Peak gust speed at 10 m.' }),
  v({ id: 'wind_gusts_max', label: 'Maximum wind gust', category: 'wind', quantity: 'speed', unit: 'km/h', aggregation: 'max', resolutions: ['daily'], description: 'Strongest gust of the day.' }),
  v({ id: 'wind_direction', label: 'Wind direction', short: 'Dir', category: 'wind', quantity: 'direction', unit: '°', aggregation: 'direction', resolutions: ['hourly', 'daily'], description: 'Direction the wind blows from, in degrees clockwise from north. Daily values are the dominant (vector-mean) direction.' }),

  // Atmosphere
  v({ id: 'relative_humidity', label: 'Humidity', category: 'atmosphere', quantity: 'percent', unit: '%', aggregation: 'mean', resolutions: ['hourly', 'daily'], description: 'Relative humidity at 2 m.' }),
  v({ id: 'pressure_msl', label: 'Pressure (sea level)', short: 'Pressure', category: 'atmosphere', quantity: 'pressure', unit: 'hPa', aggregation: 'mean', resolutions: ['hourly', 'daily'], description: 'Atmospheric pressure reduced to mean sea level.' }),
  v({ id: 'surface_pressure', label: 'Surface pressure', category: 'atmosphere', quantity: 'pressure', unit: 'hPa', aggregation: 'mean', resolutions: ['hourly'], description: 'Atmospheric pressure at the surface (station level).' }),
  v({ id: 'cloud_cover', label: 'Cloud cover', short: 'Cloud', category: 'atmosphere', quantity: 'percent', unit: '%', aggregation: 'mean', resolutions: ['hourly', 'daily'], description: 'Total cloud cover as a percentage of sky.' }),
  v({ id: 'visibility', label: 'Visibility', category: 'atmosphere', quantity: 'distance', unit: 'km', aggregation: 'mean', resolutions: ['hourly'], description: 'Horizontal visibility.' }),
  v({ id: 'cape', label: 'CAPE', category: 'atmosphere', quantity: 'energy', unit: 'J/kg', aggregation: 'max', resolutions: ['hourly'], description: 'Convective available potential energy, an indicator of atmospheric instability (thunderstorm potential). Above ~1000 J/kg is moderately unstable.' }),
  v({ id: 'lifted_index', label: 'Lifted index', category: 'atmosphere', quantity: 'index', unit: 'K', aggregation: 'min', resolutions: ['hourly'], description: 'Atmospheric stability index. Negative values indicate instability; below −4 suggests strong storm potential.' }),
  v({ id: 'freezing_level', label: 'Freezing level', category: 'atmosphere', quantity: 'none', unit: 'm', aggregation: 'mean', resolutions: ['hourly'], description: 'Altitude of the 0 °C isotherm.' }),
  v({ id: 'vapour_pressure_deficit', label: 'Vapour pressure deficit', short: 'VPD', category: 'atmosphere', quantity: 'kpa', unit: 'kPa', aggregation: 'mean', resolutions: ['hourly'], description: 'Difference between saturation and actual vapour pressure. High values mean high plant transpiration.' }),

  // Sun
  v({ id: 'uv_index', label: 'UV index', short: 'UV', category: 'sun', quantity: 'index', unit: '', aggregation: 'max', resolutions: ['hourly'], description: 'UV index (WHO scale).' }),
  v({ id: 'uv_index_max', label: 'UV index max', category: 'sun', quantity: 'index', unit: '', aggregation: 'max', resolutions: ['daily'], description: 'Daily maximum UV index.' }),
  v({ id: 'shortwave_radiation', label: 'Solar radiation', category: 'sun', quantity: 'radiation', unit: 'W/m²', aggregation: 'mean', resolutions: ['hourly'], description: 'Global horizontal shortwave radiation (average over the preceding hour).' }),
  v({ id: 'shortwave_radiation_sum', label: 'Solar radiation total', category: 'sun', quantity: 'none', unit: 'MJ/m²', aggregation: 'sum', resolutions: ['daily'], description: 'Daily total of global shortwave radiation.' }),
  v({ id: 'sunshine_duration', label: 'Sunshine duration', category: 'sun', quantity: 'duration', unit: 'h', aggregation: 'sum', resolutions: ['hourly', 'daily'], description: 'Hours of direct sunshine (direct normal irradiance above 120 W/m²).' }),
  v({ id: 'daylight_duration', label: 'Daylight duration', category: 'sun', quantity: 'duration', unit: 'h', aggregation: 'sum', resolutions: ['daily'], description: 'Time between sunrise and sunset.' }),

  // Soil & agriculture
  v({ id: 'soil_temperature_0cm', label: 'Soil temperature (surface)', category: 'soil', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['hourly'], description: 'Soil/surface temperature at 0 cm.' }),
  v({ id: 'soil_temperature_6cm', label: 'Soil temperature (6 cm)', category: 'soil', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['hourly'], description: 'Soil temperature at 6 cm depth.' }),
  v({ id: 'soil_moisture_0_1cm', label: 'Soil moisture (0–1 cm)', category: 'soil', quantity: 'soilMoisture', unit: 'm³/m³', aggregation: 'mean', resolutions: ['hourly'], description: 'Volumetric soil water content, 0–1 cm.' }),
  v({ id: 'soil_moisture_1_3cm', label: 'Soil moisture (1–3 cm)', category: 'soil', quantity: 'soilMoisture', unit: 'm³/m³', aggregation: 'mean', resolutions: ['hourly'], description: 'Volumetric soil water content, 1–3 cm.' }),
  v({ id: 'et0', label: 'Reference evapotranspiration', short: 'ET₀', category: 'soil', quantity: 'precipitation', unit: 'mm', aggregation: 'sum', resolutions: ['hourly', 'daily'], description: 'FAO-56 Penman–Monteith reference evapotranspiration of a well-watered grass field.' }),
  v({ id: 'leaf_wetness', label: 'Leaf wetness probability', category: 'soil', quantity: 'percent', unit: '%', aggregation: 'mean', resolutions: ['hourly'], description: 'Probability that leaves are wet. Not offered by the current free sources; available for imported datasets.' }),

  // Air quality
  v({ id: 'pm2_5', label: 'PM2.5', category: 'air', quantity: 'concentration', unit: 'μg/m³', aggregation: 'mean', resolutions: ['hourly'], description: 'Fine particulate matter (< 2.5 μm).' }),
  v({ id: 'pm10', label: 'PM10', category: 'air', quantity: 'concentration', unit: 'μg/m³', aggregation: 'mean', resolutions: ['hourly'], description: 'Particulate matter (< 10 μm).' }),
  v({ id: 'nitrogen_dioxide', label: 'Nitrogen dioxide', short: 'NO₂', category: 'air', quantity: 'concentration', unit: 'μg/m³', aggregation: 'mean', resolutions: ['hourly'], description: 'NO₂ concentration near the surface.' }),
  v({ id: 'ozone', label: 'Ozone', short: 'O₃', category: 'air', quantity: 'concentration', unit: 'μg/m³', aggregation: 'mean', resolutions: ['hourly'], description: 'O₃ concentration near the surface.' }),
  v({ id: 'european_aqi', label: 'European AQI', category: 'air', quantity: 'index', unit: '', aggregation: 'max', resolutions: ['hourly'], description: 'European Air Quality Index (0–20 good … >100 extremely poor).' }),
  v({ id: 'us_aqi', label: 'US AQI', category: 'air', quantity: 'index', unit: '', aggregation: 'max', resolutions: ['hourly'], description: 'US EPA Air Quality Index (0–50 good … >300 hazardous).' }),

  // Marine
  v({ id: 'wave_height', label: 'Wave height', category: 'marine', quantity: 'waveHeight', unit: 'm', aggregation: 'max', resolutions: ['hourly'], description: 'Significant height of combined wind waves and swell.' }),
  v({ id: 'wave_direction', label: 'Wave direction', category: 'marine', quantity: 'direction', unit: '°', aggregation: 'direction', resolutions: ['hourly'], description: 'Mean direction waves come from.' }),
  v({ id: 'wave_period', label: 'Wave period', category: 'marine', quantity: 'period', unit: 's', aggregation: 'mean', resolutions: ['hourly'], description: 'Mean wave period.' }),
  v({ id: 'swell_wave_height', label: 'Swell height', category: 'marine', quantity: 'waveHeight', unit: 'm', aggregation: 'max', resolutions: ['hourly'], description: 'Significant height of swell waves.' }),
  v({ id: 'sea_surface_temperature', label: 'Sea surface temperature', short: 'SST', category: 'marine', quantity: 'temperature', unit: '°C', aggregation: 'mean', resolutions: ['hourly'], description: 'Sea surface temperature.' }),
];

export const VARIABLE_MAP: Record<string, VariableDef> = Object.fromEntries(VARIABLES.map((d) => [d.id, d]));

export function getVariable(id: string): VariableDef | undefined {
  return VARIABLE_MAP[id];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  temperature: 'Temperature',
  precipitation: 'Precipitation',
  wind: 'Wind',
  atmosphere: 'Atmosphere',
  sun: 'Sun & radiation',
  soil: 'Soil & agriculture',
  air: 'Air quality',
  marine: 'Marine',
};

/**
 * Which hourly variable a daily variable is derived from, and how. Used to build
 * daily summaries from hourly data when a provider does not publish them.
 */
export const DAILY_FROM_HOURLY: Record<string, { from: string; agg: Aggregation }> = {
  temperature_max: { from: 'temperature', agg: 'max' },
  temperature_min: { from: 'temperature', agg: 'min' },
  temperature_mean: { from: 'temperature', agg: 'mean' },
  apparent_temperature_max: { from: 'apparent_temperature', agg: 'max' },
  apparent_temperature_min: { from: 'apparent_temperature', agg: 'min' },
  precipitation: { from: 'precipitation', agg: 'sum' },
  rain: { from: 'rain', agg: 'sum' },
  snowfall: { from: 'snowfall', agg: 'sum' },
  precipitation_probability: { from: 'precipitation_probability', agg: 'max' },
  wind_speed_max: { from: 'wind_speed', agg: 'max' },
  wind_gusts_max: { from: 'wind_gusts', agg: 'max' },
  wind_direction: { from: 'wind_direction', agg: 'direction' },
  relative_humidity: { from: 'relative_humidity', agg: 'mean' },
  pressure_msl: { from: 'pressure_msl', agg: 'mean' },
  cloud_cover: { from: 'cloud_cover', agg: 'mean' },
  uv_index_max: { from: 'uv_index', agg: 'max' },
  sunshine_duration: { from: 'sunshine_duration', agg: 'sum' },
  et0: { from: 'et0', agg: 'sum' },
};
