/**
 * Backfill único: recalcula el desglose (hours/totalHours/shiftLabel) de TODAS las
 * horas extra PENDIENTES (no borrador) contra el turno VIGENTE de cada trabajador,
 * usando exactamente la misma lógica que OvertimeService.recomputePendingForWorker
 * (computeOvertimeBreakdown + resolveShiftForDate).
 *
 * Motivo: el cálculo dinámico recalcula al GUARDAR el turno, pero las HE creadas
 * antes de configurar el turno (o cuando el código aún no estaba desplegado) quedaron
 * congeladas. Este backfill las pone al día de una vez. Solo toca PENDIENTES; las
 * aprobadas/pagadas/rechazadas NO se tocan (integridad contable).
 *
 * Uso (env DATABASE_URL apuntando al destino):
 *   DRY_RUN=1 tsx scripts/backfill-overtime-recompute.ts   # solo reporta (default)
 *   DRY_RUN=0 tsx scripts/backfill-overtime-recompute.ts   # aplica los cambios
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  computeOvertimeBreakdown,
  resolveShiftForDate,
} from '../src/modules/overtime/overtime-hours.util';

config();

const prisma = new PrismaClient();
const APPLY = process.env.DRY_RUN === '0';

async function main(): Promise<void> {
  const pending = await prisma.overtimeRequest.findMany({
    where: {
      status: 'PENDIENTE',
      isDraft: false,
      startTime: { not: null },
      endTime: { not: null },
    },
    orderBy: [{ userId: 'asc' }, { date: 'asc' }],
  });

  console.log(`HE pendientes (no borrador) a evaluar: ${pending.length}`);
  console.log(APPLY ? '>>> MODO APLICAR (DRY_RUN=0)' : '>>> MODO DRY-RUN (no escribe; usa DRY_RUN=0 para aplicar)');

  // Cache de turno por trabajador (una lectura por trabajador).
  const scheduleCache = new Map<string, Awaited<ReturnType<typeof prisma.workSchedule.findUnique>>>();
  let changed = 0;
  let unchanged = 0;

  for (const row of pending) {
    if (!scheduleCache.has(row.userId)) {
      scheduleCache.set(
        row.userId,
        await prisma.workSchedule.findUnique({ where: { userId: row.userId } }),
      );
    }
    const schedule = scheduleCache.get(row.userId) ?? null;
    const shift = row.weekendOrHoliday ? null : resolveShiftForDate(schedule, row.date);
    const bd = computeOvertimeBreakdown(row.startTime as string, row.endTime as string, shift);

    const same =
      row.hours === bd.overtimeHours &&
      row.totalHours === bd.totalHours &&
      row.shiftLabel === bd.shiftLabel;
    if (same) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    const fecha = row.date.toISOString().slice(0, 10);
    console.log(
      `  ${row.id} ${fecha} ${row.startTime}-${row.endTime}: ` +
        `hours ${row.hours}->${bd.overtimeHours}, total ${row.totalHours}->${bd.totalHours}, ` +
        `turno ${row.shiftLabel ?? 'null'}->${bd.shiftLabel ?? 'null'}`,
    );
    if (APPLY) {
      await prisma.overtimeRequest.update({
        where: { id: row.id },
        data: { hours: bd.overtimeHours, totalHours: bd.totalHours, shiftLabel: bd.shiftLabel },
      });
    }
  }

  console.log(`\nResumen: ${changed} cambiadas, ${unchanged} sin cambio.`);
  console.log(APPLY ? 'Cambios APLICADOS.' : 'Dry-run: nada escrito.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
