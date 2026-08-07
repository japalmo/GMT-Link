import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleUsageService } from '../../../src/modules/assets/vehicle-usage.service';
import type { AssetsService } from '../../../src/modules/assets/assets.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Lo que importa acá es lo que el servicio agrega POR ENCIMA de la aritmética:
 * el gate de autorización, la extracción del odómetro desde el JSON del
 * checklist, y que el filtro de fechas viaje a la consulta y no se aplique en
 * memoria. La aritmética en sí ya está cubierta en `vehicle-usage.util.spec.ts`.
 */

const ASSET = 'act-1';
const USER = 'usr-1';

interface SubmissionFalsa {
  createdAt: Date;
  answers: unknown;
  user: { firstName: string; lastName: string } | null;
}

function checklist(dia: number, km: unknown, conductor = 'Ana Pérez'): SubmissionFalsa {
  const [firstName, lastName] = conductor.split(' ');
  return {
    createdAt: new Date(2026, 0, 1 + dia),
    answers: [
      { itemId: 'estado_luces', value: 'BUENO' },
      { itemId: 'kilometraje', value: km },
      { itemId: 'observaciones', value: '' },
    ],
    user: { firstName: firstName ?? '', lastName: lastName ?? '' },
  };
}

function armar(submissions: SubmissionFalsa[]) {
  const findMany = vi.fn().mockResolvedValue(submissions);
  const prisma = { checklistSubmission: { findMany } } as unknown as PrismaService;
  const assertCanManageAssetById = vi.fn().mockResolvedValue(undefined);
  const assets = { assertCanManageAssetById } as unknown as AssetsService;
  return {
    servicio: new VehicleUsageService(prisma, assets),
    findMany,
    assertCanManageAssetById,
  };
}

// ─────────────────────────── autorización ───────────────────────────

describe('VehicleUsageService: autorización', () => {
  it('exige el mismo gate que el resto del detalle del activo', async () => {
    const { servicio, assertCanManageAssetById } = armar([]);
    await servicio.uso(ASSET, USER);
    expect(assertCanManageAssetById).toHaveBeenCalledWith(ASSET, USER);
  });

  it('no consulta los checklists si el gate rechaza', async () => {
    // Si consultara primero y gateara después, un 403 igual habría leído la
    // serie de odómetro completa del vehículo.
    const { servicio, findMany, assertCanManageAssetById } = armar([checklist(0, 1000)]);
    assertCanManageAssetById.mockRejectedValue(new ForbiddenException());

    await expect(servicio.uso(ASSET, USER)).rejects.toThrow(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('propaga el 404 del activo inexistente', async () => {
    const { servicio, assertCanManageAssetById } = armar([]);
    assertCanManageAssetById.mockRejectedValue(new NotFoundException());
    await expect(servicio.uso(ASSET, USER)).rejects.toThrow(NotFoundException);
  });
});

// ─────────────────────────── lectura del odómetro ───────────────────────────

describe('VehicleUsageService: extracción del odómetro', () => {
  it('saca el kilometraje del ítem correcto entre las demás respuestas', async () => {
    const { servicio } = armar([checklist(0, 50_000), checklist(10, 51_000)]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.checklistsConsiderados).toBe(2);
    expect(uso.promedios!.kmTotales).toBe(1_000);
    expect(uso.promedios!.kmPorDia).toBeCloseTo(100, 5);
  });

  it('acepta el kilometraje como string, que es como llega del formulario', async () => {
    const { servicio } = armar([checklist(0, '50000'), checklist(10, '51000')]);
    expect((await servicio.uso(ASSET, USER)).promedios!.kmTotales).toBe(1_000);
  });

  it('un valor vacío NO se lee como cero', async () => {
    // `Number('')` da 0: sin la guarda, un checklist sin kilometraje aparecería
    // como un odómetro en cero y ensuciaría toda la serie.
    const { servicio } = armar([checklist(0, ''), checklist(5, 50_000), checklist(10, 51_000)]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.checklistsConsiderados).toBe(2);
    expect(uso.descartadas).toHaveLength(0);
    expect(uso.promedios!.kmTotales).toBe(1_000);
  });

  it('ignora checklists sin el ítem de kilometraje y con respuestas mal formadas', async () => {
    const { servicio } = armar([
      { createdAt: new Date(2026, 0, 1), answers: [{ itemId: 'otro', value: 'x' }], user: null },
      { createdAt: new Date(2026, 0, 2), answers: null, user: null },
      { createdAt: new Date(2026, 0, 3), answers: 'no es un arreglo', user: null },
      checklist(5, 50_000),
      checklist(15, 51_000),
    ]);
    const uso = await servicio.uso(ASSET, USER);
    expect(uso.checklistsConsiderados).toBe(2);
    expect(uso.promedios!.kmTotales).toBe(1_000);
  });

  it('un texto no numérico se descarta en vez de romper el cálculo', async () => {
    const { servicio } = armar([
      checklist(0, 50_000),
      checklist(5, 'no sé'),
      checklist(10, 51_000),
    ]);
    const uso = await servicio.uso(ASSET, USER);
    expect(uso.checklistsConsiderados).toBe(2);
    expect(uso.promedios!.kmTotales).toBe(1_000);
  });

  it('devuelve las lecturas descartadas con conductor para poder corregirlas', async () => {
    // Un 3% a 6% de los checklists reales trae el odómetro mal tipeado.
    const { servicio } = armar([
      checklist(0, 50_000, 'Ana Pérez'),
      checklist(5, 5_030, 'Luis Soto'),
      checklist(10, 51_000, 'Ana Pérez'),
    ]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.descartadas).toHaveLength(1);
    expect(uso.descartadas[0]!.km).toBe(5_030);
    expect(uso.descartadas[0]!.conductor).toBe('Luis Soto');
    expect(uso.descartadas[0]!.motivo).toContain('No calza con el odómetro');
    // La descartada no entra al cálculo, pero sí al conteo de lo leído.
    expect(uso.checklistsConsiderados).toBe(3);
    expect(uso.promedios!.kmTotales).toBe(1_000);
  });

  it('un checklist sin usuario deja el conductor en null, no en "undefined undefined"', async () => {
    const { servicio } = armar([
      { createdAt: new Date(2026, 0, 1), answers: [{ itemId: 'kilometraje', value: 50_000 }], user: null },
      { createdAt: new Date(2026, 0, 2), answers: [{ itemId: 'kilometraje', value: 500 }], user: null },
    ]);
    const uso = await servicio.uso(ASSET, USER);
    expect(uso.descartadas[0]!.conductor).toBeNull();
  });
});

// ─────────────────────────── filtros y respuesta ───────────────────────────

describe('VehicleUsageService: filtros', () => {
  it('agrupa por semana cuando no se pide granularidad', async () => {
    const { servicio } = armar([]);
    expect((await servicio.uso(ASSET, USER)).granularidad).toBe('semana');
  });

  it('respeta la granularidad pedida', async () => {
    const { servicio } = armar([checklist(0, 1_000), checklist(1, 1_100), checklist(2, 1_300)]);
    const uso = await servicio.uso(ASSET, USER, { granularidad: 'dia' });

    expect(uso.granularidad).toBe('dia');
    expect(uso.serie).toHaveLength(3);
    expect(uso.serie[2]!.km).toBe(200);
  });

  it('el rango de fechas viaja a la CONSULTA, no se filtra en memoria', async () => {
    // Con cientos de checklists por vehículo, traerlos todos para descartar la
    // mayoría después sería trabajo tirado en cada carga de la pantalla.
    const { servicio, findMany } = armar([]);
    const desde = new Date(2026, 0, 1);
    const hasta = new Date(2026, 5, 30);

    await servicio.uso(ASSET, USER, { desde, hasta });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: ASSET, createdAt: { gte: desde, lte: hasta } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('sin rango no manda filtro de fecha a la consulta', async () => {
    const { servicio, findMany } = armar([]);
    await servicio.uso(ASSET, USER);
    expect(findMany.mock.calls[0]![0].where).toEqual({ assetId: ASSET });
  });

  it('acepta solo uno de los dos extremos del rango', async () => {
    const { servicio, findMany } = armar([]);
    const desde = new Date(2026, 0, 1);
    await servicio.uso(ASSET, USER, { desde });
    expect(findMany.mock.calls[0]![0].where.createdAt).toEqual({ gte: desde });
  });
});

describe('VehicleUsageService: proyección de mantención', () => {
  it('declara la proyección como estimada cuando no se conoce la última mantención', async () => {
    // Es el caso normal hoy: no hay registro de mantenciones en la plataforma.
    const { servicio } = armar([checklist(0, 8_500), checklist(10, 9_500)]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.proyeccion!.baseEstimada).toBe(true);
    expect(uso.proyeccion!.intervaloKm).toBe(10_000);
    expect(uso.proyeccion!.kmObjetivo).toBe(10_000);
    expect(uso.proyeccion!.diasEstimados).toBe(5);
  });

  it('con el dato real de la última mantención deja de ser estimada', async () => {
    const { servicio } = armar([checklist(0, 51_000), checklist(10, 52_000)]);
    const uso = await servicio.uso(ASSET, USER, { ultimaMantencionKm: 50_000 });

    expect(uso.proyeccion!.baseEstimada).toBe(false);
    expect(uso.proyeccion!.kmObjetivo).toBe(60_000);
  });

  it('un vehículo sin uso medible no proyecta nada en vez de inventar una fecha', async () => {
    const { servicio } = armar([checklist(0, 5_000), checklist(10, 5_000)]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.proyeccion).toBeNull();
    expect(uso.promedios!.kmPorDia).toBe(0);
  });

  it('un vehículo sin checklists devuelve la vista vacía, no un error', async () => {
    const { servicio } = armar([]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.serie).toEqual([]);
    expect(uso.promedios).toBeNull();
    expect(uso.proyeccion).toBeNull();
    expect(uso.descartadas).toEqual([]);
    expect(uso.checklistsConsiderados).toBe(0);
  });

  it('las fechas salen en ISO-8601 para que el front no dependa del huso del servidor', async () => {
    const { servicio } = armar([checklist(0, 8_500), checklist(10, 9_500)]);
    const uso = await servicio.uso(ASSET, USER);
    expect(uso.proyeccion!.fechaEstimada).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('VehicleUsageService: consulta', () => {
  let servicio: VehicleUsageService;
  let findMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ servicio, findMany } = armar([]));
  });

  it('pide solo las columnas que usa', async () => {
    await servicio.uso(ASSET, USER);
    expect(findMany.mock.calls[0]![0].select).toEqual({
      createdAt: true,
      answers: true,
      user: { select: { firstName: true, lastName: true } },
    });
  });
});

describe('VehicleUsageService: honestidad de la proyección', () => {
  it('informa la fecha de la última lectura junto a la proyección', async () => {
    // Sin este dato una fecha de mantención en el pasado parece un error de
    // cálculo, cuando en realidad significa que el vehículo lleva meses sin
    // checklist. Son dos problemas distintos y se arreglan distinto.
    const { servicio } = armar([checklist(0, 8_500), checklist(10, 9_500)]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.proyeccion!.fechaUltimaLectura).toBe(new Date(2026, 0, 11).toISOString());
  });

  it('la fecha de la última lectura es la de la última VÁLIDA, no la del último checklist', async () => {
    const { servicio } = armar([
      checklist(0, 8_500),
      checklist(10, 9_500),
      checklist(20, 950), // mal tipeada: se descarta
    ]);
    const uso = await servicio.uso(ASSET, USER);

    expect(uso.descartadas).toHaveLength(1);
    expect(uso.proyeccion!.kmActual).toBe(9_500);
    expect(uso.proyeccion!.fechaUltimaLectura).toBe(new Date(2026, 0, 11).toISOString());
  });
});
