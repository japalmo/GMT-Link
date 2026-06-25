/* global console, process */
/**
 * reload-volumes.mjs
 * ──────────────────
 * Purga y recarga los DataPoint de volumen de R1..R10 en la fase ATA/CUB/anual-2026,
 * desde apps/api/prisma/data-reservorios.json (serie limpia completa).
 *
 *   1. Respalda los DataPoint de volumen actuales a backups/ (JSON con timestamp).
 *   2. Borra esos DataPoint (solo variables de volumen de esa fase; NO toca dem_file).
 *   3. Inserta la serie limpia (createMany por lotes) dentro de una transacción.
 *
 * Uso:  node scripts/reload-volumes.mjs           (ejecuta de verdad)
 *       node scripts/reload-volumes.mjs --dry-run (solo reporta, no borra ni inserta)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(process.cwd(), '../../.env') });
const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

// Variable de la BD ← campo del JSON
const FIELD_BY_VAR = {
  borde_libre: 'borde_libre',
  altura_salmuera: 'altura_salmuera',
  altura_sal: 'altura_sal',
  vol_salmuera_libre: 'vol_salmuera_libre',
  vol_sal: 'vol_sal',
  vol_salmuera_ocluida: 'vol_salmuera_ocluida',
  vol_salmuera_total: 'vol_total_salmuera',
  cota_espejo: 'cota_espejo',
  cota_sal: 'cota_sal',
  area_espejo: 'area_espejo',
  perimetro: 'perimetro',
};

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  // ── Resolver fase ATA/CUB/anual-2026 ──
  const phase = await prisma.phase.findFirst({
    where: { code: 'anual-2026', service: { code: 'CUB', project: { code: 'ATA' } } },
    include: { variables: true, service: { include: { project: true } } },
  });
  if (!phase) throw new Error('Fase ATA/CUB/anual-2026 no encontrada.');
  console.log(`Fase: ${phase.service.project.code}/${phase.service.code}/${phase.code} (id=${phase.id})`);

  const varByCode = new Map(phase.variables.map((v) => [v.code, v]));
  const volVarIds = Object.keys(FIELD_BY_VAR)
    .map((code) => varByCode.get(code)?.id)
    .filter(Boolean);

  // ── Elementos R1..R10 ──
  const codes = Array.from({ length: 10 }, (_, i) => `R${i + 1}`);
  const elements = await prisma.element.findMany({ where: { code: { in: codes } } });
  const elById = new Map(elements.map((e) => [e.code, e.id]));
  console.log(`Elementos resueltos: ${elements.map((e) => e.code).sort().join(', ')}`);

  // ── createdById: reusar el autor de los datos actuales ──
  const sample = await prisma.dataPoint.findFirst({
    where: { phaseId: phase.id, variableId: { in: volVarIds } },
    select: { createdById: true },
  });
  const createdById = sample?.createdById ?? (await prisma.user.findFirst())?.id;
  if (!createdById) throw new Error('No hay usuario para asignar createdById.');

  // ── 1. Respaldo ──
  const existing = await prisma.dataPoint.findMany({
    where: { phaseId: phase.id, variableId: { in: volVarIds } },
  });
  const backupDir = path.join(__dirname, '..', 'prisma', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `datapoints-volumen-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`\n[1] Respaldo: ${existing.length} DataPoint -> ${path.relative(process.cwd(), backupFile)}`);

  // ── Construir filas limpias desde el JSON ──
  const dataPath = path.join(__dirname, '..', 'prisma', 'data-reservorios.json');
  const reservoirs = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const newRows = [];
  for (const code of codes) {
    const elementId = elById.get(code);
    if (!elementId) {
      console.warn(`  ! Elemento ${code} no existe en BD; se omite.`);
      continue;
    }
    for (const rec of reservoirs[code]?.measurements ?? []) {
      const createdAt = new Date(rec.date);
      for (const [varCode, field] of Object.entries(FIELD_BY_VAR)) {
        const v = rec[field];
        if (v === null || v === undefined) continue;
        const variable = varByCode.get(varCode);
        if (!variable) continue;
        newRows.push({
          value: String(v),
          variableId: variable.id,
          elementId,
          phaseId: phase.id,
          createdById,
          createdAt,
        });
      }
    }
  }
  console.log(`[2] Filas limpias a insertar: ${newRows.length}`);

  if (DRY) {
    console.log('\n--dry-run: NO se borra ni inserta. Fin.');
    await prisma.$disconnect();
    return;
  }

  // ── 3. Purga + recarga en transacción ──
  const batches = chunk(newRows, 5000);
  await prisma.$transaction(
    async (tx) => {
      const del = await tx.dataPoint.deleteMany({
        where: { phaseId: phase.id, variableId: { in: volVarIds } },
      });
      console.log(`[3] Borrados: ${del.count}`);
      let inserted = 0;
      for (const b of batches) {
        const r = await tx.dataPoint.createMany({ data: b });
        inserted += r.count;
      }
      console.log(`[4] Insertados: ${inserted}`);
    },
    { timeout: 180000, maxWait: 20000 },
  );

  // ── Verificación ──
  const after = await prisma.dataPoint.count({
    where: { phaseId: phase.id, variableId: { in: volVarIds } },
  });
  console.log(`\n[OK] DataPoint de volumen tras recarga: ${after}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
