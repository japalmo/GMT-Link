/**
 * import-vmetric-data.ts
 * ----------------------------------------------------------------------------
 * Importa la data histórica de V-Metric (export de Firestore) a las 4 tablas
 * standalone del schema de CONTROL:
 *   - vmetric_reservorios      (VmetricReservorio)
 *   - vmetric_cubicaciones     (VmetricCubicacion)
 *   - vmetric_dems             (VmetricDem)
 *   - vmetric_cotas_referencia (VmetricCotaReferencia)
 *
 * Idempotente: hace `upsert` por `sourceId` (== _id de Firestore). Correrlo N
 * veces deja el mismo estado. Los valores numéricos/booleanos/fechas de
 * Firestore vienen como string en el export → se parsean de forma null-safe.
 *
 * Uso:
 *   railway run pnpm exec tsx scripts/import-vmetric-data.ts            # importa
 *   pnpm exec tsx scripts/import-vmetric-data.ts --dry-run             # solo cuenta
 *
 * Env:
 *   VMETRIC_EXPORT_DIR  dir del export (default: v-metric/data/firestore_export)
 *   DATABASE_URL        conexión a la BD de control (la inyecta `railway run`)
 *
 * En --dry-run NO se instancia PrismaClient ni se conecta a la BD: solo parsea
 * los JSON y reporta conteos por colección.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_EXPORT_DIR =
  'C:/Users/juana/GMT/proyectos/v-metric/data/firestore_export';

const EXPORT_DIR = process.env.VMETRIC_EXPORT_DIR ?? DEFAULT_EXPORT_DIR;
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Parsers null-safe (Firestore exporta números/booleanos/fechas como string)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return String(value);
}

/** Requerido: devuelve string (default '' si viene vacío/ausente). */
function toStrReq(value: unknown): string {
  return toStr(value) ?? '';
}

/** Acepta number o string ("2301.356"); NaN/vacío → null. */
function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Acepta boolean o string ("True"/"true"/"1"); default false. */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 't' || v === 'yes';
  }
  return false;
}

/** ISO string → Date; inválido/ausente → null. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = toStr(value);
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// Lectura de JSON
// ---------------------------------------------------------------------------

function readCollection(filename: string): Raw[] {
  const path = join(EXPORT_DIR, filename);
  const text = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`El archivo ${filename} no contiene un array JSON.`);
  }
  return parsed as Raw[];
}

function sourceIdOf(row: Raw): string {
  const id = toStr(row._id);
  if (id === null) {
    throw new Error(`Registro sin _id: ${JSON.stringify(row).slice(0, 120)}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Mappers Firestore → columnas Prisma (sin campos de gestión id/createdAt)
// ---------------------------------------------------------------------------

interface ReservorioData {
  codigo: string;
  demBlobPath: string | null;
  demUpdatedAt: Date | null;
  demFilename: string | null;
  demUrl: string | null;
}

function mapReservorio(row: Raw): ReservorioData {
  return {
    codigo: toStrReq(row.codigo),
    demBlobPath: toStr(row.dem_blob_path),
    demUpdatedAt: toDate(row.dem_updated_at),
    demFilename: toStr(row.dem_filename),
    demUrl: toStr(row.dem_url),
  };
}

interface CubicacionData {
  reservorioCodigo: string | null;
  cotaSal: number | null;
  cotaAgua: number | null;
  fraccionOcluida: number | null;
  volSalM3: number | null;
  volSalmueraLibreM3: number | null;
  volSalmueraOcluidaM3: number | null;
  volSalmueraTotalM3: number | null;
  areaEspejoM2: number | null;
  precisionCeldaM: number | null;
  origen: string | null;
  versionModelo: string | null;
  demFilename: string | null;
  demIdLocal: number | null;
  usuario: string | null;
  uid: string | null;
  deleted: boolean;
  deletedBy: string | null;
  deletedAt: Date | null;
  sourceCreatedAt: Date | null;
}

function mapCubicacion(row: Raw): CubicacionData {
  return {
    reservorioCodigo: toStr(row.reservorio_codigo),
    cotaSal: toFloat(row.cota_sal),
    cotaAgua: toFloat(row.cota_agua),
    fraccionOcluida: toFloat(row.fraccion_ocluida),
    volSalM3: toFloat(row.vol_sal_m3),
    volSalmueraLibreM3: toFloat(row.vol_salmuera_libre_m3),
    volSalmueraOcluidaM3: toFloat(row.vol_salmuera_ocluida_m3),
    volSalmueraTotalM3: toFloat(row.vol_salmuera_total_m3),
    areaEspejoM2: toFloat(row.area_espejo_m2),
    precisionCeldaM: toFloat(row.precision_celda_m),
    origen: toStr(row.origen),
    versionModelo: toStr(row.version_modelo),
    demFilename: toStr(row.dem_filename),
    demIdLocal: toFloat(row.dem_id_local),
    usuario: toStr(row.usuario),
    uid: toStr(row.uid),
    deleted: toBool(row.deleted),
    deletedBy: toStr(row.deleted_by),
    deletedAt: toDate(row.deleted_at),
    sourceCreatedAt: toDate(row.created_at),
  };
}

interface DemData {
  reservorioCodigo: string | null;
  archivo: string | null;
  r2Key: string | null;
  r2Url: string | null;
  demId: number | null;
  drone: string | null;
  usuario: string | null;
  uid: string | null;
  sourceCreatedAt: Date | null;
}

function mapDem(row: Raw): DemData {
  return {
    reservorioCodigo: toStr(row.reservorio_codigo),
    archivo: toStr(row.archivo),
    r2Key: toStr(row.blob_path), // blob_path == key en R2 (bucket vmetric-dems)
    r2Url: toStr(row.storage_url),
    demId: toFloat(row.dem_id),
    drone: toStr(row.drone),
    usuario: toStr(row.usuario),
    uid: toStr(row.uid),
    sourceCreatedAt: toDate(row.created_at),
  };
}

interface CotaReferenciaData {
  reservorio: string | null;
  nombreCota: string | null;
  valorCota: number | null;
  operador: string | null;
  observacion: string | null;
  datetimeCota: Date | null;
}

function mapCotaReferencia(row: Raw): CotaReferenciaData {
  return {
    reservorio: toStr(row.reservorio),
    nombreCota: toStr(row.nombreCota),
    valorCota: toFloat(row.valorCota),
    operador: toStr(row.operador),
    observacion: toStr(row.observacion),
    datetimeCota: toDate(row.datetimeCota),
  };
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

interface UpsertResult {
  created: number;
  updated: number;
}

function emptyResult(): UpsertResult {
  return { created: 0, updated: 0 };
}

function logHeader(): void {
  console.log('='.repeat(64));
  console.log('  V-Metric → import de data histórica (Firestore export)');
  console.log('='.repeat(64));
  console.log(`  Export dir : ${EXPORT_DIR}`);
  console.log(`  Modo       : ${DRY_RUN ? 'DRY-RUN (no escribe)' : 'IMPORT (upsert)'}`);
  console.log('-'.repeat(64));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logHeader();

  // Parseo (común a dry-run e import).
  const reservorios = readCollection('reservorios.json');
  const cubicaciones = readCollection('cubicaciones.json');
  const dems = readCollection('dems.json');
  const cotas = readCollection('cotas_referencia.json');

  if (DRY_RUN) {
    // Fuerza el parseo de cada registro para validar la forma sin escribir.
    reservorios.forEach((r) => mapReservorio(r));
    cubicaciones.forEach((r) => mapCubicacion(r));
    dems.forEach((r) => mapDem(r));
    cotas.forEach((r) => mapCotaReferencia(r));

    console.log('  Conteos parseados (sin BD):');
    console.log(`    vmetric_reservorios      : ${reservorios.length}`);
    console.log(`    vmetric_cubicaciones     : ${cubicaciones.length}`);
    console.log(`    vmetric_dems             : ${dems.length}`);
    console.log(`    vmetric_cotas_referencia : ${cotas.length}`);
    console.log('-'.repeat(64));
    console.log('  DRY-RUN OK — no se escribió nada en la BD.');
    return;
  }

  // Import real: recién acá se instancia PrismaClient (usa DATABASE_URL).
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const resReservorios = emptyResult();
    for (const row of reservorios) {
      const sourceId = sourceIdOf(row);
      const data = mapReservorio(row);
      const exists = await prisma.vmetricReservorio.findUnique({
        where: { sourceId },
        select: { id: true },
      });
      await prisma.vmetricReservorio.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
      if (exists) resReservorios.updated += 1;
      else resReservorios.created += 1;
    }

    const resCubicaciones = emptyResult();
    for (const row of cubicaciones) {
      const sourceId = sourceIdOf(row);
      const data = mapCubicacion(row);
      const exists = await prisma.vmetricCubicacion.findUnique({
        where: { sourceId },
        select: { id: true },
      });
      await prisma.vmetricCubicacion.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
      if (exists) resCubicaciones.updated += 1;
      else resCubicaciones.created += 1;
    }

    const resDems = emptyResult();
    for (const row of dems) {
      const sourceId = sourceIdOf(row);
      const data = mapDem(row);
      const exists = await prisma.vmetricDem.findUnique({
        where: { sourceId },
        select: { id: true },
      });
      await prisma.vmetricDem.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
      if (exists) resDems.updated += 1;
      else resDems.created += 1;
    }

    const resCotas = emptyResult();
    for (const row of cotas) {
      const sourceId = sourceIdOf(row);
      const data = mapCotaReferencia(row);
      const exists = await prisma.vmetricCotaReferencia.findUnique({
        where: { sourceId },
        select: { id: true },
      });
      await prisma.vmetricCotaReferencia.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
      if (exists) resCotas.updated += 1;
      else resCotas.created += 1;
    }

    const line = (name: string, r: UpsertResult): string =>
      `    ${name.padEnd(26)}: +${r.created} nuevos, ~${r.updated} actualizados`;

    console.log('  Resultado del import (upsert por sourceId):');
    console.log(line('vmetric_reservorios', resReservorios));
    console.log(line('vmetric_cubicaciones', resCubicaciones));
    console.log(line('vmetric_dems', resDems));
    console.log(line('vmetric_cotas_referencia', resCotas));
    console.log('-'.repeat(64));
    console.log('  Import OK.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Import falló:', error);
  process.exitCode = 1;
});
