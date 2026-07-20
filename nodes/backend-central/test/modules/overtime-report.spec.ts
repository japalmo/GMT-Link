import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildOvertimeReportWorkbook,
  type OvertimeReportRow,
} from '../../src/modules/overtime/overtime-report.util';

function row(overrides: Partial<OvertimeReportRow>): OvertimeReportRow {
  return {
    dateIso: '2026-07-10T00:00:00.000Z',
    workerName: 'Ana Perez',
    projectName: 'Traslado personal',
    startTime: '08:00',
    endTime: '18:00',
    totalHours: 10,
    regularHours: 8,
    overtimeHours: 2,
    reason: 'Cierre',
    authorizedByName: 'Juan Apalmo',
    approvedByName: 'Juan Apalmo',
    ...overrides,
  };
}

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('buildOvertimeReportWorkbook', () => {
  it('crea dos hojas: Totalizado por trabajador y Detalle', async () => {
    const buffer = await buildOvertimeReportWorkbook([row({})], 'julio 2026 (cierre 20)');
    const wb = await load(buffer);
    expect(wb.getWorksheet('Totalizado por trabajador')).toBeDefined();
    expect(wb.getWorksheet('Detalle')).toBeDefined();
  });

  it('totaliza las horas extra por trabajador (suma + conteo) con una fila TOTAL', async () => {
    const rows: OvertimeReportRow[] = [
      row({ workerName: 'Ana Perez', overtimeHours: 1.5 }),
      row({ workerName: 'Ana Perez', overtimeHours: 2.5 }),
      row({ workerName: 'Beto Soto', overtimeHours: 3 }),
    ];
    const wb = await load(await buildOvertimeReportWorkbook(rows, 'julio 2026 (cierre 20)'));
    const ws = wb.getWorksheet('Totalizado por trabajador')!;

    // Mapa trabajador -> [conteo, horas] leyendo las filas de datos (fila 3 = encabezado).
    const byWorker = new Map<string, { count: number; hours: number }>();
    ws.eachRow((r, n) => {
      if (n <= 3) return; // título (1), vacío (2), encabezado (3)
      const name = String(r.getCell(1).value ?? '');
      const count = Number(r.getCell(2).value ?? 0);
      const hours = Number(r.getCell(3).value ?? 0);
      byWorker.set(name, { count, hours });
    });

    expect(byWorker.get('Ana Perez')).toEqual({ count: 2, hours: 4 });
    expect(byWorker.get('Beto Soto')).toEqual({ count: 1, hours: 3 });
    expect(byWorker.get('TOTAL')).toEqual({ count: 3, hours: 7 });
  });

  it('la hoja Detalle trae una fila por solicitud (mas el encabezado)', async () => {
    const rows: OvertimeReportRow[] = [row({}), row({ workerName: 'Beto Soto' }), row({})];
    const wb = await load(await buildOvertimeReportWorkbook(rows, 'julio 2026 (cierre 20)'));
    const ws = wb.getWorksheet('Detalle')!;
    // rowCount incluye el encabezado.
    expect(ws.rowCount).toBe(1 + rows.length);
  });

  it('con cero solicitudes genera el libro igual (solo encabezados y TOTAL en 0)', async () => {
    const wb = await load(await buildOvertimeReportWorkbook([], 'julio 2026 (cierre 20)'));
    const ws = wb.getWorksheet('Totalizado por trabajador')!;
    const last = ws.getRow(ws.rowCount);
    expect(String(last.getCell(1).value)).toBe('TOTAL');
    expect(Number(last.getCell(3).value)).toBe(0);
  });
});
