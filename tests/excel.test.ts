import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { autoConfig, guessVariable, parseWallClock, runImport } from '@/lib/import';
import { readWorkbook } from '@/lib/server/xlsx-read';
import { DEFAULT_UNITS } from '@/lib/units';

beforeAll(() => {
  process.env.WEATHER_DB_PATH = ':memory:';
});

async function toBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const b = new Uint8Array((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

async function stationWorkbook() {
  const wb = new ExcelJS.Workbook();
  // Sheet 1: title rows, string dates (D/M/Y), °F, mph, missing markers, duplicate, bad value
  const ws = wb.addWorksheet('Station log');
  ws.addRow(['My weather station export']);
  ws.addRow([]);
  ws.addRow(['Date', 'Time', 'Temp (°F)', 'Humidity %', 'Wind Speed (mph)', 'Rain (in)', 'Barometer (inHg)', 'Notes']);
  ws.addRow(['31/01/2024', '23:00', 50, 80, 10, 0.1, 29.92, 'ok']);
  ws.addRow(['01/02/2024', '00:00', 41, 85, 'calm', 0, 30.01, '']);
  ws.addRow(['01/02/2024', '00:00', 41, 85, 0, 0, 30.01, 'dup']);
  ws.addRow(['01/02/2024', '01:00', -9999, 'NA', 5, 0.02, 30.0, '']);
  ws.addRow(['not a date', '02:00', 40, 80, 5, 0, 30, '']);
  ws.addRow(['01/02/2024', '03:00', 400, 80, 5, 0, 30, 'sensor fault']);
  // Sheet 2: real Excel dates, daily wide-format
  const d = wb.addWorksheet('Daily');
  d.addRow(['date', 'tmax', 'tmin', 'precipitation_sum', 'wind_gusts_10m_max']);
  for (let i = 0; i < 40; i++) d.addRow([new Date(Date.UTC(2024, 0, 1 + i)), 10 + (i % 5), 2 + (i % 3), i % 4 === 0 ? 3.5 : 0, 40]);
  return wb;
}

describe('import detection', () => {
  it('guesses variables from common headers', () => {
    expect(guessVariable('Temp (°F)')).toBe('temperature');
    expect(guessVariable('Max Temp')).toBe('temperature_max');
    expect(guessVariable('tmin')).toBe('temperature_min');
    expect(guessVariable('Wind Speed (mph)')).toBe('wind_speed');
    expect(guessVariable('Barometer (inHg)')).toBe('pressure_msl');
    expect(guessVariable('Notes')).toBe('');
  });
  it('parses timestamp formats', () => {
    expect(parseWallClock('2024-03-05 14:30', 'DMY', false)).toBe('2024-03-05T14:30:00');
    expect(parseWallClock('05/03/2024 2:30 pm', 'DMY', false)).toBe('2024-03-05T14:30:00');
    expect(parseWallClock('03/05/2024', 'MDY', false)).toBe('2024-03-05T00:00:00');
    expect(parseWallClock('2024-02-31', 'DMY', false)).toBeNull();
    expect(parseWallClock(45292, 'DMY', true)).toBe('2024-01-01T00:00:00');
    expect(parseWallClock('2024-07-01T12:00:00+02:00', 'DMY', false)).toBe('2024-07-01T10:00:00Z');
  });
});

describe('xlsx import end-to-end', () => {
  it('reads, maps, converts and validates a messy station log', async () => {
    const sheets = await readWorkbook(await toBuffer(await stationWorkbook()));
    expect(sheets.map((s) => s.name)).toEqual(['Station log', 'Daily']);
    const sheet = sheets[0];
    const cfg = autoConfig(sheet, 'Europe/London');
    expect(cfg.headerRow).toBe(2);
    expect(cfg.timeColumn).toBe(0);
    expect(cfg.timeOfDayColumn).toBe(1);
    const byHeader = Object.fromEntries(cfg.mappings.map((m) => [m.header, m]));
    expect(byHeader['Temp (°F)']).toMatchObject({ variable: 'temperature', unit: 'F' });
    expect(byHeader['Wind Speed (mph)']).toMatchObject({ variable: 'wind_speed', unit: 'mph' });
    expect(byHeader['Rain (in)']).toMatchObject({ variable: 'precipitation', unit: 'in' });
    expect(byHeader['Barometer (inHg)']).toMatchObject({ variable: 'pressure_msl', unit: 'inHg' });
    expect(byHeader['Notes'].variable).toBe('');

    const r = runImport(sheet, cfg);
    expect(r.resolution).toBe('hourly');
    expect(r.time).toEqual(['2024-01-31T23:00:00Z', '2024-02-01T00:00:00Z', '2024-02-01T01:00:00Z', '2024-02-01T03:00:00Z']);
    expect(r.series.temperature[0]).toBeCloseTo(10); // 50 °F
    expect(r.series.temperature[2]).toBeNull(); // -9999 marker
    expect(r.series.temperature[3]).toBeNull(); // 400 °F implausible, excluded
    expect(r.series.wind_speed[0]).toBeCloseTo(16.09, 2);
    expect(r.series.wind_speed[1]).toBeNull(); // "calm" is not a number
    expect(r.series.precipitation[0]).toBeCloseTo(2.54);
    expect(r.series.pressure_msl[0]).toBeCloseTo(1013.2, 1);
    expect(r.stats.duplicates).toBe(1);
    expect(r.stats.invalidTimestamps).toBe(1);
    expect(r.stats.implausibleValues.temperature).toBe(1);
    expect(r.issues.some((i) => i.message.includes('duplicate'))).toBe(true);
  });

  it('detects a daily wide-format sheet with real Excel dates', async () => {
    const sheets = await readWorkbook(await toBuffer(await stationWorkbook()));
    const cfg = autoConfig(sheets[1], 'UTC');
    const r = runImport(sheets[1], cfg);
    expect(r.resolution).toBe('daily');
    expect(r.time[0]).toBe('2024-01-01');
    expect(r.time).toHaveLength(40);
    expect(Object.keys(r.series).sort()).toEqual(['precipitation', 'temperature_max', 'temperature_min', 'wind_gusts_max']);
  });
});

describe('xlsx export', () => {
  it('exports an imported dataset to a real workbook with numeric cells', async () => {
    const { saveDataset } = await import('@/lib/server/datasets');
    const { buildWorkbook } = await import('@/lib/server/export');
    const time = Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2024, 0, 1, i)).toISOString().replace('.000', ''));
    const meta = saveDataset(
      {
        name: 'Test station',
        sourceFile: 'test.xlsx',
        sheet: 'Sheet1',
        resolution: 'hourly',
        location: { name: 'Testville', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London' },
        timezone: 'Europe/London',
        variables: ['temperature', 'precipitation'],
        rowCount: 48,
        start: time[0],
        end: time[47],
        mapping: [],
        warnings: [],
      },
      { time, series: { temperature: time.map((_, i) => (i === 5 ? null : 10 + i / 7)), precipitation: time.map(() => 0.25) } },
    );
    const { buffer, failures } = await buildWorkbook({
      location: { name: 'Testville', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London' },
      start: '2024-01-01',
      end: '2024-01-02',
      sources: [`import:${meta.id}`, 'does-not-exist'],
      dataType: 'auto',
      resolution: 'both',
      variables: ['temperature', 'precipitation', 'temperature_max', 'temperature_mean', 'wind_speed'],
      units: { ...DEFAULT_UNITS, temperature: 'F' },
      includeStats: true,
      includeComparison: true,
    });
    expect(failures).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['About', 'Hourly data', 'Daily data', 'Statistics', 'Monthly summary', 'Annual summary', 'Variables'].filter((n) => n !== 'Monthly summary' && n !== 'Annual summary'));
    const hourly = wb.getWorksheet('Hourly data')!;
    const header = (hourly.getRow(1).values as string[]).slice(1);
    expect(header).toContain('Temperature (°F)');
    expect(header).not.toContain('Wind speed (km/h)'); // not in the data → no empty column
    const tCol = header.indexOf('Temperature (°F)') + 1;
    const r2 = hourly.getRow(2);
    expect(typeof r2.getCell(tCol).value).toBe('number');
    expect(r2.getCell(tCol).value).toBeCloseTo(50, 10); // 10 °C → 50 °F, unrounded
    expect(r2.getCell(1).value).toBeInstanceOf(Date);
    expect(hourly.getRow(7).getCell(tCol).value).toBeNull(); // missing stays empty
    expect(hourly.rowCount).toBe(49);
    const daily = wb.getWorksheet('Daily data')!;
    const dh = (daily.getRow(1).values as string[]).slice(1);
    expect(dh).toContain('Maximum temperature (°F)');
    const pCol = dh.indexOf('Precipitation (mm)') + 1;
    expect(daily.getRow(2).getCell(pCol).value).toBeCloseTo(6);
    const stats = wb.getWorksheet('Statistics')!;
    expect(stats.rowCount).toBeGreaterThan(2);
    const about = wb.getWorksheet('About')!;
    let sawFailure = false;
    about.eachRow((row) => {
      if (String(row.getCell(2).value) === 'NOT INCLUDED') sawFailure = true;
    });
    expect(sawFailure).toBe(true);
  });
});
