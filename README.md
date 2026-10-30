# Skyline Weather

A multi-source weather dashboard built on **free** weather data. Check today's weather on an animated homepage, compare independent forecasts side by side, explore weather history back to 1940, import your own Excel records, and export everything to clean `.xlsx` workbooks.

## Quick start

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`, so there is nothing native to compile).

```bash
npm install
npm run dev        # http://localhost:3000
# or for production
npm run build && npm start
```

No API keys are needed. Optionally copy `.env.example` to `.env.local` to set a contact string or the Met Office key.

## Data sources

| Source | What it gives | Key? | Limits |
|---|---|---|---|
| **Open-Meteo Best Match** | Forecast blending the best local models | No | 10 000 calls/day non-commercial |
| **ECMWF IFS**, **NOAA GFS**, **DWD ICON**, **Met Office UKMO**, **Météo-France**, **Environment Canada GEM**, **JMA** (via Open-Meteo) | Each national model's own forecast, kept separate for comparison | No | Same Open-Meteo quota |
| **MET Norway Locationforecast** | Independent global forecast (yr.no backend) | No | Needs a User-Agent; heavy use throttled |
| **NOAA National Weather Service** | Official US forecast grids + latest station observation | No | US only; needs a User-Agent |
| **NWS station observations** | Measured hourly observations, last ~7 days | No | US only |
| **ERA5 reanalysis** (Copernicus via Open-Meteo) | Hourly/daily history from 1940 to ~5 days ago | No | Same Open-Meteo quota |
| **CAMS air quality**, **marine forecast** (via Open-Meteo) | PM2.5/PM10/NO₂/O₃/AQI; waves, swell, sea temperature | No | Same Open-Meteo quota |
| **Met Office DataHub – Site Specific** (optional) | Post-processed Met Office spot forecast | **Free key** | 360 calls/day; set `MET_OFFICE_API_KEY` |

Met Office model data is available without a key through the *Met Office UKMO* source. The DataHub source adds the Met Office's own post-processed spot forecasts if you register at <https://datahub.metoffice.gov.uk/>.

All server requests are cached (memory + SQLite): forecasts 20 min, recent history 3 h, older history 7 days, geocoding 7 days. One provider failing never breaks the others; its error is shown in place of its data.

### Honesty rules the code follows

- Providers are never blended into a single "consensus". Every value carries its source.
- Every dataset is labelled **Forecast**, **Observed**, **Reanalysis** or **Imported**. Values this app derives (heat index, wind chill, dew point when missing, daily mean/max/min from hourly, growing degree days) are marked **calculated**.
- Missing values stay missing (shown as "—" / empty cells). Days with incomplete hourly data are not summarised.

## Features

- **Today**: animated sky (day/night/dawn/dusk, clouds, rain, snow, sleet, fog, lightning) driven by real conditions; current conditions, 36-hour strip, 7-day forecast, temperature/precipitation/wind charts, every available variable, air quality, marine, and a "today across sources" table.
- **Compare**: up to 11 forecast sources on one chart and table, with spread and outlier highlighting, plus a matrix of which source provides which variable. Also compares several locations with one source.
- **History**: ERA5 back to 1940, NWS observations, or imported datasets; hourly or daily; charts, min/max/mean/std/total/completeness, monthly and annual summaries, and paged data tables. Overlay a second source (e.g. your station vs ERA5).
- **Import**: drag-and-drop `.xlsx`, choose worksheet and header row, automatic detection of timestamp/date+time columns, date order, resolution (sub-hourly data is aggregated to hourly), column → variable and unit mapping, missing-value markers, duplicate/invalid/implausible value checks with row numbers, converted preview, then confirm.
- **Export**: choose location, dates, sources, forecast vs history, hourly/daily/both, variables, units, statistics and comparison. The workbook has About (metadata, sources, update times, failures), Hourly data, Daily data, Comparison, Statistics, Monthly/Annual summaries and Variables sheets. Numbers are real numbers at full precision; dates are real Excel dates (local and UTC columns).
- **Settings**: °C/°F, km/h · m/s · mph · knots, mm/in, hPa · inHg · mmHg · kPa, km/mi, timezone, theme, animation level, default source, saved locations. Stored in the browser.

## Project layout

```
src/lib/variables.ts        variable registry (ids, canonical units, aggregation, descriptions)
src/lib/providers/*.ts      one file per source, all implementing the Provider interface
src/lib/calc.ts, stats.ts   meteorological formulas, aggregation and statistics
src/lib/import.ts           spreadsheet detection, mapping and validation (runs in the browser)
src/lib/server/export.ts    workbook builder (ExcelJS)
src/lib/server/db.ts        SQLite (cache + imported datasets)
src/app/api/*               server routes (all upstream calls happen here)
src/app/*/page.tsx          pages
```

**Adding a source**: create `src/lib/providers/<name>.ts` implementing `Provider` (map its fields to ids in `variables.ts`, convert to canonical units), and add it to `PROVIDERS` in `src/lib/providers/index.ts`. Comparison, history, export and the Sources page pick it up automatically.

**Adding a variable**: add it to `VARIABLES` in `src/lib/variables.ts` and map it in the providers that offer it.

## Testing

```bash
npm test          # unit tests: formulas, time zones, provider parsing, xlsx import & export round-trips
npm run typecheck
```

`scripts/mock-upstream.mjs` is a local stand-in for the upstream APIs, used only for UI testing without internet access. It returns synthetic values. Point the app at it explicitly:

```bash
node scripts/mock-upstream.mjs &
OPEN_METEO_BASE=http://localhost:4010 OPEN_METEO_ARCHIVE_BASE=http://localhost:4010 \
OPEN_METEO_AIR_BASE=http://localhost:4010 OPEN_METEO_MARINE_BASE=http://localhost:4010 \
OPEN_METEO_GEO_BASE=http://localhost:4010 METNO_BASE=http://localhost:4010 NWS_BASE=http://localhost:4010 \
npm run dev
```

Never set these variables in a real deployment.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0), including ECMWF, NOAA, DWD, Met Office, Météo-France, ECCC, JMA and Copernicus (ERA5, CAMS) data. [MET Norway](https://api.met.no/) (CC BY 4.0). [NOAA National Weather Service](https://www.weather.gov/) (public domain). Met Office DataHub data © Crown copyright.
