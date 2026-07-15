/**
 * Recalcula el desglose de horas extra (hora extra real vs turno normal) de las
 * solicitudes EXISTENTES, ahora que el cálculo descuenta el turno del trabajador.
 *
 * Recalcula SOLO las PENDIENTE no-borrador (aún sin decidir): cambiar una HE ya
 * APROBADA/PAGADA alteraría un monto ya resuelto, así que esas NO se tocan; solo se
 * listan las que cambiarían para revisión manual. Idempotente: recalcular dos veces
 * da el mismo resultado.
 *
 * Uso (env DATABASE_URL apuntando al destino):
 *   tsx scripts/recompute-overtime.ts
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, FinanceStatus } from '@prisma/client';
import {
  computeOvertimeBreakdown,
  resolveShiftForDate,
  type ShiftScheduleInput,
} from '../src/modules/overtime/overtime-hours.util';

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

async function breakdownFor(
  userId: string,
  date: Date,
  startTime: string,
  endTime: string,
): Promise<{ overtimeHours: number; totalHours: number; shiftLabel: string | null }> {
  const schedule = (await prisma.workSchedule.findUnique({
    where: { userId },
  })) as ShiftScheduleInput | null;
  const shift = resolveShiftForDate(schedule, date);
  return computeOvertimeBreakdown(startTime, endTime, shift);
}

async function main(): Promise<void> {
  const rows = await prisma.overtimeRequest.findMany({
    where: { isDraft: false, startTime: { not: null }, endTime: { not: null } },
    orderBy: { date: 'asc' },
  });

  let recomputed = 0;
  let unchanged = 0;
  const resolvedWouldChange: string[] = [];

  for (const row of rows) {
    if (!row.startTime || !row.endTime) continue;
    const b = await breakdownFor(row.userId, row.date, row.startTime, row.endTime);
    const changed =
      row.hours !== b.overtimeHours ||
      row.totalHours !== b.totalHours ||
      row.shiftLabel !== b.shiftLabel;

    if (row.status !== FinanceStatus.PENDIENTE) {
      if (changed) {
        resolvedWouldChange.push(
          `  ! ${row.id} (${row.status}) ${row.startTime}-${row.endTime} ${row.date.toISOString().slice(0, 10)}: ` +
            `hours ${row.hours} -> ${b.overtimeHours}, total -> ${b.totalHours}, turno ${b.shiftLabel ?? 'sin turno'} (NO tocada)`,
        );
      }
      continue;
    }

    if (!changed) {
      unchanged += 1;
      continue;
    }

    await prisma.overtimeRequest.update({
      where: { id: row.id },
      data: { hours: b.overtimeHours, totalHours: b.totalHours, shiftLabel: b.shiftLabel },
    });
    recomputed += 1;
    console.log(
      `  + ${row.id} ${row.startTime}-${row.endTime} ${row.date.toISOString().slice(0, 10)}: ` +
        `hora extra ${row.hours} -> ${b.overtimeHours} (total ${b.totalHours}, turno ${b.shiftLabel ?? 'sin turno'})`,
    );
  }

  console.log(
    `\nHoras extra recalculadas (PENDIENTE): ${recomputed} | sin cambios: ${unchanged} | ` +
      `total no-borrador: ${rows.length}.`,
  );
  if (resolvedWouldChange.length > 0) {
    console.log(
      `\n${resolvedWouldChange.length} solicitud(es) ya resuelta(s) (APROBADO/PAGADO) cambiarían pero NO se tocaron:`,
    );
    resolvedWouldChange.forEach((line) => console.log(line));
  }
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
