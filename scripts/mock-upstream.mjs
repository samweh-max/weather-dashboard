// TEST TOOL ONLY. A local stand-in for the upstream weather APIs, used for automated
// UI tests and screenshots in environments without internet access. It returns
// synthetic values in the real response shapes. The app never uses it unless the
// *_BASE environment variables are pointed at it explicitly (see README → Testing).
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4010);

const TZ = { name: 'Europe/London', offset: 0 };
const hourStart = () => Math.floor(Date.now() / 86400000) * 86400; // UTC midnight today

function wave(i, base, amp, phase = 0) {
  return +(base + amp * Math.sin(((i % 24) - 9 + phase) / 24 * 2 * Math.PI)).toFixed(1);
}

function omForecast(url) {
  const model = url.searchParams.get('models') || 'best_match';
  const seed = [...model].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
  const days = Number(url.searchParams.get('forecast_days') || 7);
  const start = hourStart();
  const hours = Array.from({ length: days * 24 }, (_, i) => start + i * 3600);
  const hourlyFields = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
  const dailyFields = (url.searchParams.get('daily') || '').split(',').filter(Boolean);
  const gen = (f, i) => {
    switch (f) {
      case 'temperature_2m': return wave(i, 11 + seed * 0.3 + Math.floor(i / 24) * 0.4, 4);
      case 'apparent_temperature': return wave(i, 9 + seed * 0.3, 4.5);
      case 'dew_point_2m': return wave(i, 7, 1);
      case 'relative_humidity_2m': return Math.round(wave(i, 75, -12));
      case 'precipitation_probability': return Math.max(0, Math.round(40 * Math.sin(i / 9 + seed) + 15));
      case 'precipitation': case 'rain': return i % 17 < 3 ? +(0.3 + (seed % 3) * 0.4).toFixed(1) : 0;
      case 'showers': case 'snowfall': case 'snow_depth': return 0;
      case 'pressure_msl': return +(1012 + 6 * Math.sin(i / 30) + seed * 0.4).toFixed(1);
      case 'surface_pressure': return +(1009 + 6 * Math.sin(i / 30)).toFixed(1);
      case 'cloud_cover': return Math.round(50 + 45 * Math.sin(i / 7 + seed));
      case 'visibility': return model === 'ecmwf_ifs025' ? null : 24000;
      case 'wind_speed_10m': return +(14 + 6 * Math.sin(i / 11 + seed)).toFixed(1);
      case 'wind_gusts_10m': return +(28 + 10 * Math.sin(i / 11 + seed)).toFixed(1);
      case 'wind_direction_10m': return Math.round((230 + 30 * Math.sin(i / 20)) % 360);
      case 'uv_index': return Math.max(0, +wave(i, 0.5, 2.5).toFixed(1));
      case 'shortwave_radiation': return Math.max(0, Math.round(wave(i, 80, 250)));
      case 'sunshine_duration': return Math.max(0, Math.round(wave(i, 600, 3000)));
      case 'cape': return model === 'best_match' || model === 'gfs_seamless' ? Math.round(Math.max(0, 200 * Math.sin(i / 13))) : null;
      case 'lifted_index': return model === 'gfs_seamless' ? +(2 * Math.sin(i / 13)).toFixed(1) : null;
      case 'freezing_level_height': return 1800;
      case 'vapour_pressure_deficit': return +(0.3 + 0.2 * Math.sin(i / 5)).toFixed(2);
      case 'et0_fao_evapotranspiration': return +Math.max(0, wave(i, 0.03, 0.08)).toFixed(2);
      case 'soil_temperature_0cm': return wave(i, 10, 3);
      case 'soil_temperature_6cm': return wave(i, 10, 1);
      case 'soil_moisture_0_to_1cm': return 0.31;
      case 'soil_moisture_1_to_3cm': return 0.32;
      case 'weather_code': { const c = Math.round(50 + 45 * Math.sin(i / 7 + seed)); return i % 17 < 3 ? 61 : c > 80 ? 3 : c > 40 ? 2 : 0; }
      case 'is_day': return (i % 24) >= 7 && (i % 24) < 17 ? 1 : 0;
      default: return null;
    }
  };
  const hourly = { time: hours };
  for (const f of hourlyFields) hourly[f] = hours.map((_, i) => gen(f, i));
  const dtimes = Array.from({ length: days }, (_, d) => start + d * 86400);
  const daily = { time: dtimes };
  for (const f of dailyFields) {
    daily[f] = dtimes.map((t, d) => {
      const hs = hourly.temperature_2m?.slice(d * 24, d * 24 + 24) ?? [];
      switch (f) {
        case 'temperature_2m_max': return Math.max(...hs);
        case 'temperature_2m_min': return Math.min(...hs);
        case 'apparent_temperature_max': return Math.max(...hs) - 1.5;
        case 'apparent_temperature_min': return Math.min(...hs) - 2;
        case 'precipitation_sum': case 'rain_sum': return +(hourly.precipitation?.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0) ?? 0).toFixed(1);
        case 'snowfall_sum': return 0;
        case 'precipitation_hours': return 3;
        case 'precipitation_probability_max': return Math.max(...(hourly.precipitation_probability?.slice(d * 24, d * 24 + 24) ?? [0]));
        case 'wind_speed_10m_max': return 20 + seed;
        case 'wind_gusts_10m_max': return 38 + seed;
        case 'wind_direction_10m_dominant': return 240;
        case 'uv_index_max': return 3;
        case 'shortwave_radiation_sum': return 6.5;
        case 'sunshine_duration': return 14000;
        case 'daylight_duration': return 33000;
        case 'et0_fao_evapotranspiration': return 0.9;
        case 'weather_code': return [61, 3, 2, 0, 80, 95, 71][(d + seed) % 7];
        case 'sunrise': return t + 7 * 3600 + 1200;
        case 'sunset': return t + 16 * 3600 + 2400;
        default: return null;
      }
    });
  }
  const nowI = Math.floor((Date.now() / 1000 - start) / 3600);
  const current = { time: Math.floor(Date.now() / 900000) * 900, interval: 900 };
  for (const f of (url.searchParams.get('current') || '').split(',').filter(Boolean)) current[f] = hourly[f]?.[nowI] ?? gen(f, nowI);
  return { latitude: 51.5, longitude: -0.12, elevation: 25, timezone: TZ.name, utc_offset_seconds: TZ.offset, current, hourly, daily };
}

function omArchive(url) {
  const s = Date.parse(url.searchParams.get('start_date') + 'T00:00:00Z') / 1000;
  const e = Date.parse(url.searchParams.get('end_date') + 'T00:00:00Z') / 1000;
  const nd = Math.round((e - s) / 86400) + 1;
  const out = { latitude: 51.5, longitude: -0.12, elevation: 25, timezone: TZ.name, utc_offset_seconds: 0 };
  const season = (d) => 11 + 7 * Math.sin(((d / 365.25) * 2 - 0.5) * Math.PI);
  const dayIndex = (t) => Math.floor(t / 86400);
  if (url.searchParams.get('hourly')) {
    const hours = Array.from({ length: nd * 24 }, (_, i) => s + i * 3600);
    out.hourly = { time: hours };
    for (const f of url.searchParams.get('hourly').split(',')) {
      out.hourly[f] = hours.map((t, i) => {
        const d = dayIndex(t);
        if (f === 'temperature_2m') return +(season(d) + 4 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI) + 2 * Math.sin(d * 1.7)).toFixed(1);
        if (f === 'precipitation' || f === 'rain') return (d * 7 + (i % 24)) % 23 < 2 ? 0.8 : 0;
        if (f === 'relative_humidity_2m') return 78;
        if (f === 'wind_speed_10m') return +(15 + 5 * Math.sin(i / 9)).toFixed(1);
        if (f === 'wind_gusts_10m') return +(30 + 8 * Math.sin(i / 9)).toFixed(1);
        if (f === 'wind_direction_10m') return 220;
        if (f === 'pressure_msl') return +(1013 + 8 * Math.sin(i / 50)).toFixed(1);
        if (f === 'weather_code') return 2;
        return null;
      });
    }
  }
  const days = Array.from({ length: nd }, (_, d) => s + d * 86400);
  out.daily = { time: days };
  for (const f of (url.searchParams.get('daily') || '').split(',')) {
    out.daily[f] = days.map((t) => {
      const d = dayIndex(t);
      const m = season(d) + 2 * Math.sin(d * 1.7);
      switch (f) {
        case 'temperature_2m_max': return +(m + 4).toFixed(1);
        case 'temperature_2m_min': return +(m - 4).toFixed(1);
        case 'temperature_2m_mean': return +m.toFixed(1);
        case 'precipitation_sum': case 'rain_sum': return (d * 7) % 5 === 0 ? +(2 + (d % 9)).toFixed(1) : 0;
        case 'wind_speed_10m_max': return 22;
        case 'wind_gusts_10m_max': return +(40 + (d % 11)).toFixed(1);
        case 'wind_direction_10m_dominant': return 230;
        case 'sunrise': return t + 7 * 3600;
        case 'sunset': return t + 17 * 3600;
        case 'weather_code': return 3;
        default: return null;
      }
    });
  }
  return out;
}

function metno() {
  const start = Math.floor(Date.now() / 3600000) * 3600;
  const ts = [];
  for (let i = 0; i < 60; i++) ts.push(start + i * 3600);
  for (let t = ts[ts.length - 1] + 6 * 3600 - ((ts[ts.length - 1] / 3600) % 6) * 3600; ts.length < 80; t += 6 * 3600) ts.push(t);
  return {
    properties: {
      meta: { updated_at: new Date(Date.now() - 50 * 60000).toISOString() },
      timeseries: ts.map((t, i) => {
        const h = new Date(t * 1000).getUTCHours();
        const hourly = i < 60;
        return {
          time: new Date(t * 1000).toISOString().replace('.000', ''),
          data: {
            instant: { details: { air_temperature: +(10.5 + 4 * Math.sin((h - 9) / 24 * 2 * Math.PI)).toFixed(1), wind_speed: 4.2, wind_speed_of_gust: 8.1, wind_from_direction: 235, relative_humidity: 77, air_pressure_at_sea_level: 1011.8, cloud_area_fraction: 60, dew_point_temperature: 6.4, ultraviolet_index_clear_sky: h > 8 && h < 15 ? 2 : 0 } },
            ...(hourly ? { next_1_hours: { summary: { symbol_code: i % 13 < 2 ? 'lightrain_day' : 'partlycloudy_day' }, details: { precipitation_amount: i % 13 < 2 ? 0.4 : 0, probability_of_precipitation: i % 13 < 2 ? 60 : 10 } } } : {}),
            next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 1.1, probability_of_precipitation: 35 } },
          },
        };
      }),
    },
  };
}

function geocode(url) {
  const q = (url.searchParams.get('name') || '').toLowerCase();
  const all = [
    { name: 'London', latitude: 51.50853, longitude: -0.12574, elevation: 25, timezone: 'Europe/London', country: 'United Kingdom', country_code: 'GB', admin1: 'England' },
    { name: 'London', latitude: 42.98339, longitude: -81.23304, elevation: 252, timezone: 'America/Toronto', country: 'Canada', country_code: 'CA', admin1: 'Ontario' },
    { name: 'Manchester', latitude: 53.48095, longitude: -2.23743, elevation: 57, timezone: 'Europe/London', country: 'United Kingdom', country_code: 'GB', admin1: 'England' },
    { name: 'New York', latitude: 40.71427, longitude: -74.00597, elevation: 10, timezone: 'America/New_York', country: 'United States', country_code: 'US', admin1: 'New York' },
  ];
  return { results: all.filter((r) => r.name.toLowerCase().startsWith(q)) };
}

function air() {
  const start = hourStart();
  const hours = Array.from({ length: 120 }, (_, i) => start + i * 3600);
  const vals = { pm2_5: 8.4, pm10: 14.2, nitrogen_dioxide: 21.5, ozone: 48, european_aqi: 27, us_aqi: 35 };
  const hourly = { time: hours };
  for (const [k, v] of Object.entries(vals)) hourly[k] = hours.map(() => v);
  return { timezone: TZ.name, utc_offset_seconds: 0, current: { time: Math.floor(Date.now() / 3600000) * 3600, ...vals }, hourly };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body;
  let status = 200;
  if (url.pathname === '/v1/forecast') body = omForecast(url);
  else if (url.pathname === '/v1/archive') body = omArchive(url);
  else if (url.pathname === '/v1/air-quality') body = air();
  else if (url.pathname === '/v1/marine') { status = 400; body = { error: true, reason: 'No data is available for this location' }; }
  else if (url.pathname === '/v1/search') body = geocode(url);
  else if (url.pathname.startsWith('/weatherapi/locationforecast')) body = metno();
  else if (url.pathname.startsWith('/data/')) body = { last_run_initialisation_time: Math.floor(Date.now() / 1000) - 5 * 3600, last_run_availability_time: Math.floor(Date.now() / 1000) - 3 * 3600 };
  else if (url.pathname.startsWith('/points/')) { status = 404; body = { title: 'Data Unavailable For Requested Point' }; }
  else { status = 404; body = { reason: 'not mocked' }; }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});
server.listen(PORT, () => console.log(`mock upstream on :${PORT}`));
