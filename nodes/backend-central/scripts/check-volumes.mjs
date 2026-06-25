/* global console, process */
// Diagnóstico read-only: ¿están cargados los volúmenes R1..R10 en la fase anual-2026?
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function main() {
  const phase = await prisma.phase.findFirst({
    where: { code: 'anual-2026' },
    include: { service: { include: { project: true } } },
  });
  console.log(
    'Fase anual-2026:',
    phase
      ? `${phase.id} (proyecto=${phase.service?.project?.code} servicio=${phase.service?.code})`
      : 'NO EXISTE',
  );

  const elements = await prisma.element.findMany({
    where: { code: { in: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'] } },
    select: { code: true, projectId: true },
  });
  console.log('Elementos R1..R10 en BD:', elements.length, '->', elements.map((e) => e.code).join(', '));

  if (phase) {
    const total = await prisma.dataPoint.count({ where: { phaseId: phase.id } });
    console.log('DataPoints totales en la fase:', total);
    const vars = await prisma.variable.findMany({
      where: { phaseId: phase.id },
      select: { id: true, code: true },
    });
    console.log('Variables de la fase:', vars.map((v) => v.code).join(', ') || '(ninguna)');
    // muestra: cuántos DataPoints por variable
    for (const v of vars) {
      const c = await prisma.dataPoint.count({ where: { phaseId: phase.id, variableId: v.id } });
      if (c > 0) console.log(`  - ${v.code}: ${c}`);
    }
  }
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
