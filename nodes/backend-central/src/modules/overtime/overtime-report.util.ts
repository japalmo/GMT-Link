/**
 * Reporte mensual de Horas Extra (Excel). Arma un libro con dos hojas a partir de
 * las HE APROBADAS del período: "Totalizado por trabajador" (horas por persona) y
 * "Detalle" (una fila por solicitud). Función pura sobre filas ya resueltas
 * (`OvertimeReportRow`), sin Prisma ni HTTP → testeable.
 */
import ExcelJS from 'exceljs';

/** Una solicitud aprobada, ya hidratada con nombres, para el reporte. */
export interface OvertimeReportRow {
  /** Fecha de las horas (ISO-8601; la porción de fecha es el día calendario de Chile). */
  dateIso: string;
  workerName: string;
  projectName: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Horas totales trabajadas. */
  totalHours: number | null;
  /** Horas dentro del turno normal (no pagables). */
  regularHours: number | null;
  /** Horas extra reales (pagables). */
  overtimeHours: number | null;
  reason: string | null;
  authorizedByName: string | null;
  approvedByName: string | null;
}

/** "YYYY-MM-DD" (ISO) → "DD-MM-YYYY" para mostrar en es-CL. */
function formatDayCl(dateIso: string): string {
  const [y, m, d] = dateIso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Estiliza una fila de encabezado (negrita + fondo gris + borde inferior). */
function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
  });
}

/**
 * Construye el libro Excel del reporte mensual de HE aprobadas y devuelve el buffer.
 * `periodLabel` es el rótulo del período (p. ej. "julio 2026 (cierre 20)").
 */
export async function buildOvertimeReportWorkbook(
  rows: ReadonlyArray<OvertimeReportRow>,
  periodLabel: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GMT Link';
  wb.created = new Date(0); // determinista: no filtra la hora de generación al binario

  // ── Hoja 1: Totalizado por trabajador ──
  const totals = new Map<string, { count: number; hours: number }>();
  for (const r of rows) {
    const acc = totals.get(r.workerName) ?? { count: 0, hours: 0 };
    acc.count += 1;
    acc.hours += r.overtimeHours ?? 0;
    totals.set(r.workerName, acc);
  }
  const totalSheet = wb.addWorksheet('Totalizado por trabajador');
  totalSheet.mergeCells('A1:C1');
  const title1 = totalSheet.getCell('A1');
  title1.value = `Horas extra aprobadas — ${periodLabel}`;
  title1.font = { bold: true, size: 13 };
  totalSheet.addRow([]);
  const th1 = totalSheet.addRow(['Trabajador', 'N° solicitudes', 'Total horas extra (hrs)']);
  styleHeader(th1);
  totalSheet.columns = [
    { key: 'worker', width: 34 },
    { key: 'count', width: 16 },
    { key: 'hours', width: 22 },
  ];
  const workers = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  let grandCount = 0;
  let grandHours = 0;
  for (const [name, acc] of workers) {
    grandCount += acc.count;
    grandHours += acc.hours;
    const row = totalSheet.addRow([name, acc.count, round2(acc.hours)]);
    row.getCell(3).numFmt = '0.00';
  }
  const totalRow = totalSheet.addRow(['TOTAL', grandCount, round2(grandHours)]);
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = '0.00';

  // ── Hoja 2: Detalle ──
  const detailSheet = wb.addWorksheet('Detalle');
  const headers = [
    'Fecha',
    'Trabajador',
    'Proyecto',
    'Inicio',
    'Término',
    'Total trabajado (hrs)',
    'Turno normal (hrs)',
    'Hora extra (hrs)',
    'Motivo',
    'Autorizado por',
    'Aprobado por',
  ];
  const th2 = detailSheet.addRow(headers);
  styleHeader(th2);
  detailSheet.columns = [
    { key: 'fecha', width: 12 },
    { key: 'trabajador', width: 28 },
    { key: 'proyecto', width: 26 },
    { key: 'inicio', width: 9 },
    { key: 'termino', width: 9 },
    { key: 'total', width: 20 },
    { key: 'normal', width: 18 },
    { key: 'extra', width: 16 },
    { key: 'motivo', width: 40 },
    { key: 'autoriza', width: 24 },
    { key: 'aprueba', width: 24 },
  ];
  // Orden estable: por trabajador y luego por fecha.
  const sorted = [...rows].sort(
    (a, b) =>
      a.workerName.localeCompare(b.workerName, 'es') || a.dateIso.localeCompare(b.dateIso),
  );
  for (const r of sorted) {
    const row = detailSheet.addRow([
      formatDayCl(r.dateIso),
      r.workerName,
      r.projectName ?? '',
      r.startTime ?? '',
      r.endTime ?? '',
      r.totalHours ?? '',
      r.regularHours ?? '',
      r.overtimeHours ?? '',
      r.reason ?? '',
      r.authorizedByName ?? '',
      r.approvedByName ?? '',
    ]);
    for (const col of [6, 7, 8]) {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') cell.numFmt = '0.00';
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
