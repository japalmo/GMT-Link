/**
 * bridge-vmetric-datapoints.ts
 * ----------------------------------------------------------------------------
 * Puente de la data histórica de V-Metric (export de Firestore) al modelo que la
 * WEB de GMT Link efectivamente lee: Element (pozas) + DataPoint (mediciones),
 * bajo el proyecto ATA / fase anual-2026 sembrados por `seed-metrics.ts`.
 *
 * Por qué existe: el importador previo (`import-vmetric-data.ts`) dejó los datos
 * en tablas standalone `Vmetric*` que la web NO consulta. Este puente proyecta las
 * cubicaciones y DEMs (colecciones principales + subcolecciones de historial) a
 * DataPoints, mapeando cada cubicación a las variables escalares que la web grafica.
 *
 * Idempotente: cada DataPoint usa un `id` determinístico derivado del `_id` de
 * Firestore + el código de variable, así que correrlo N veces deja el mismo estado.
 * Las cubicaciones marcadas `deleted:true` se omiten. La fecha real (`created_at`)
 * se preserva en `createdAt`. Los autores históricos (emails @gmtingenieria, que no
 * son usuarios de GMT Link) se atribuyen a un usuario de sistema "V-Metric Histórico".
 *
 * Uso (requiere que seed-metrics.ts ya haya sembrado ATA/pozas/variables):
 *   $env:DATABASE_URL=<url>; pnpm exec tsx scripts/bridge-vmetric-datapoints.ts
 *   pnpm exec tsx scripts/bridge-vmetric-datapoints.ts --dry-run   # solo cuenta
 *
 * Env: VMETRIC_EXPORT_DIR (default: v-metric/data/firestore_export), DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPORT_DIR =
  process.env.VMETRIC_EXPORT_DIR ?? 'C:/Users/juana/GMT/proyectos/v-metric/data/firestore_export';
const DRY_RUN = process.argv.includes('--dry-run');
const PHASE_CODE = 'anual-2026';

type Raw = Record<string, unknown>;

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  return String(v);
}

function toFloat(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length === 0) return null;
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 't' || t === 'yes';
  }
  return false;
}

function toDate(v: unknown): Date | null {
  const raw = toStr(v);
  if (raw === null) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readCollection(filename: string): Raw[] {
  const parsed: unknown = JSON.parse(readFileSync(join(EXPORT_DIR, filename), 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${filename} no es un array JSON.`);
  return parsed as Raw[];
}

/** Mapeo cubicación → variables escalares que la web grafica. */
const CUB_VARS: { varCode: string; field: string }[] = [
  { varCode: 'cota_espejo', field: 'cota_agua' },
  { varCode: 'cota_sal', field: 'cota_sal' },
  { varCode: 'vol_salmuera_total', field: 'vol_salmuera_total_m3' },
  { varCode: 'vol_salmuera_libre', field: 'vol_salmuera_libre_m3' },
  { varCode: 'vol_sal', field: 'vol_sal_m3' },
];

async function main(): Promise<void> {
  const cubicaciones = readCollection('cubicaciones.json');
  const cubHistory = readCollection('sub_cubicaciones_history.json');
  const dems = readCollection('dems.json');
  const demHistory = readCollection('sub_dem_history.json');
  const allCub = [...cubicaciones, ...cubHistory];
  const allDems = [...dems, ...demHistory];

  if (DRY_RUN) {
    let planned = 0;
    let deleted = 0;
    for (const c of allCub) {
      if (toBool(c.deleted)) {
        deleted += 1;
        continue;
      }
      for (const m of CUB_VARS) if (toFloat(c[m.field]) !== null) planned += 1;
    }
    console.log(
      `DRY-RUN: cubicaciones=${allCub.length} (deleted=${deleted}) dems=${allDems.length} → DataPoints planeados≈${planned + allDems.length}`,
    );
    return;
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const sysUser = await prisma.user.upsert({
      where: { username: 'vmetric-historico' },
      update: {},
      create: {
        firstName: 'V-Metric',
        lastName: 'Histórico',
        email: 'vmetric-historico@gmt.local',
        username: 'vmetric-historico',
        emailInstitucional: 'vmetric-historico@gmt.local',
        status: 'ACTIVE',
      },
    });

    const phase = await prisma.phase.findFirst({
      where: { code: PHASE_CODE },
      include: { variables: true },
    });
    if (!phase) {
      throw new Error(`Fase "${PHASE_CODE}" no existe. Corre primero: tsx prisma/seed-metrics.ts`);
    }
    const varByCode = new Map(phase.variables.map((v) => [v.code, v.id]));

    const elements = await prisma.element.findMany({
      where: { type: 'POZA' },
      select: { id: true, code: true },
    });
    const elByCode = new Map(elements.map((e) => [e.code, e.id]));

    let dpCub = 0;
    let skippedDeleted = 0;
    let skippedNoElement = 0;
    for (const c of allCub) {
      if (toBool(c.deleted)) {
        skippedDeleted += 1;
        continue;
      }
      const code = toStr(c.reservorio_codigo);
      const elementId = code ? elByCode.get(code) : undefined;
      if (!elementId) {
        skippedNoElement += 1;
        continue;
      }
      const sourceId = toStr(c._id);
      if (!sourceId) continue;
      const createdAt = toDate(c.created_at) ?? undefined;
      for (const m of CUB_VARS) {
        const val = toFloat(c[m.field]);
        if (val === null) continue;
        const variableId = varByCode.get(m.varCode);
        if (!variableId) continue;
        const id = `vm-${sourceId}-${m.varCode}`;
        const data = {
          value: String(val),
          createdAt,
          elementId,
          phaseId: phase.id,
          variableId,
          createdById: sysUser.id,
        };
        await prisma.dataPoint.upsert({ where: { id }, update: data, create: { id, ...data } });
        dpCub += 1;
      }
    }

    const demVarId = varByCode.get('dem_file');
    let dpDem = 0;
    let demSkipped = 0;
    if (demVarId) {
      for (const d of allDems) {
        const code = toStr(d.reservorio_codigo);
        const elementId = code ? elByCode.get(code) : undefined;
        if (!elementId) {
          demSkipped += 1;
          continue;
        }
        const sourceId = toStr(d._id);
        if (!sourceId) continue;
        const id = `vm-dem-${sourceId}`;
        const data = {
          value: toStr(d.archivo) ?? 'DEM.tif',
          fileUrl: toStr(d.blob_path) ?? toStr(d.storage_url),
          createdAt: toDate(d.created_at) ?? undefined,
          elementId,
          phaseId: phase.id,
          variableId: demVarId,
          createdById: sysUser.id,
        };
        await prisma.dataPoint.upsert({ where: { id }, update: data, create: { id, ...data } });
        dpDem += 1;
      }
    }

    console.log(
      `Puente OK → cubDataPoints=${dpCub} demDataPoints=${dpDem} | omitidos: deleted=${skippedDeleted} sinPoza=${skippedNoElement} demSinPoza=${demSkipped}`,
    );
    console.log(`Total DataPoints en la BD ahora: ${await prisma.dataPoint.count()}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error('Puente falló:', e);
  process.exit(1);
});
