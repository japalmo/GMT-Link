import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsService } from '../../../src/modules/projects/projects.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { FgaService } from '../../../src/fga/fga.service';
import type { ClimaService } from '../../../src/modules/projects/clima.service';
import type { StorageService } from '../../../src/common/storage/storage.service';

/**
 * Edición del control de avance.
 *
 * Lo que importa comprobar es la regla que sostiene todo el diseño: el valor
 * efectivo es el CALCULADO desde las actividades, salvo que la semana traiga
 * una sobreescritura explícita. Si eso se rompe, vuelve la desincronización
 * silenciosa que dejó el desglose por fases congelado dos semanas.
 */

type Mock = ReturnType<typeof vi.fn>;

interface PrismaFalso {
  projectActivity: { findMany: Mock; findFirst: Mock; update: Mock };
  projectWeek: { findMany: Mock; findFirst: Mock; update: Mock };
  projectDocument: { findMany: Mock; create: Mock; delete: Mock };
  task: { findFirst: Mock };
  project: { findUnique: Mock };
  $transaction: Mock;
}

/** Dos actividades de 100 HH: una avanza, la otra no. Fácil de verificar a mano. */
const ACTIVIDADES = [
  { hh: 100, realByWeek: [0.4, 0.6] },
  { hh: 100, realByWeek: [0.0, 0.2] },
];

/** S-0 más tres semanas. `index` 0 es S-0, que no tiene actividades detrás. */
function semanas(overrides: Record<string, { par?: number | null; acm?: number | null }> = {}) {
  return ['S-0', 'S-1', 'S-2', 'S-3'].map((code, index) => ({
    id: `w-${index}`,
    index,
    code,
    parRealOverride: overrides[code]?.par ?? null,
    acmRealOverride: overrides[code]?.acm ?? null,
  }));
}

describe('ProjectsService · edición del avance', () => {
  let prisma: PrismaFalso;
  let service: ProjectsService;
  let fga: { check: Mock };

  beforeEach(() => {
    prisma = {
      projectActivity: {
        findMany: vi.fn(() => Promise.resolve(ACTIVIDADES)),
        findFirst: vi.fn(),
        update: vi.fn(() => Promise.resolve({})),
      },
      projectWeek: {
        findMany: vi.fn(() => Promise.resolve(semanas())),
        findFirst: vi.fn(),
        update: vi.fn((args: unknown) => Promise.resolve(args)),
      },
      projectDocument: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
      task: { findFirst: vi.fn() },
      project: { findUnique: vi.fn() },
      // Devuelve las promesas tal cual: lo que se inspecciona son las llamadas
      // a `update`, no el resultado.
      $transaction: vi.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
    };
    fga = { check: vi.fn(() => Promise.resolve(true)) };
    service = new ProjectsService(
      prisma as unknown as PrismaService,
      fga as unknown as FgaService,
      {} as unknown as ClimaService,
      {} as unknown as StorageService,
    );
  });

  /**
   * Lo que el RECÁLCULO escribió para cada semana.
   *
   * Se filtran las llamadas que traen `parReal`: `editarSemana` primero guarda
   * la sobreescritura (que trae `acmRealOverride`) y recién después recalcula,
   * así que contar todas las llamadas por índice desalinea las semanas.
   */
  function escrito(): Record<string, { parReal: number | null; acmReal: number | null }> {
    const salida: Record<string, { parReal: number | null; acmReal: number | null }> = {};
    const recalculos = prisma.projectWeek.update.mock.calls.filter((llamada) => {
      const arg = llamada[0] as { data: Record<string, unknown> };
      return 'parReal' in arg.data;
    });
    for (const [i, llamada] of recalculos.entries()) {
      const arg = llamada[0] as { data: { parReal: number | null; acmReal: number | null } };
      salida[`S-${i}`] = arg.data;
    }
    return salida;
  }

  it('calcula el real de cada semana desde las actividades', async () => {
    prisma.projectActivity.findFirst.mockResolvedValueOnce({ id: 'a-1', realByWeek: [0.4, 0.6] });

    await service.editarAvanceActividad('p-1', { wbsId: 7, semana: 1, valor: 0.6 });

    const r = escrito();
    // S-1: (100×0,4 + 100×0) / 200 = 0,20
    expect(r['S-1']?.acmReal).toBeCloseTo(0.2, 5);
    // S-2: (100×0,6 + 100×0,2) / 200 = 0,40
    expect(r['S-2']?.acmReal).toBeCloseTo(0.4, 5);
    expect(r['S-2']?.parReal).toBeCloseTo(0.2, 5);
    // S-0 es el arranque: cero, no null.
    expect(r['S-0']?.acmReal).toBe(0);
  });

  it('la sobreescritura GANA sobre el calculado', async () => {
    prisma.projectWeek.findMany.mockResolvedValue(semanas({ 'S-2': { acm: 0.55, par: 0.3 } }));
    prisma.projectActivity.findFirst.mockResolvedValueOnce({ id: 'a-1', realByWeek: [0.4, 0.6] });

    await service.editarAvanceActividad('p-1', { wbsId: 7, semana: 1, valor: 0.6 });

    const r = escrito();
    expect(r['S-2']?.acmReal).toBeCloseTo(0.55, 5);
    expect(r['S-2']?.parReal).toBeCloseTo(0.3, 5);
    // Las demás siguen calculadas: la sobreescritura es por semana.
    expect(r['S-1']?.acmReal).toBeCloseTo(0.2, 5);
  });

  it('quitar la sobreescritura devuelve el calculado', async () => {
    // S-2 tiene detalle por actividad (las dos llegan a S-2): hay calculado.
    prisma.projectWeek.findFirst.mockResolvedValueOnce({ id: 'w-2', index: 2 });
    prisma.projectWeek.findMany.mockResolvedValue(semanas());

    await service.editarSemana('p-1', { code: 'S-2', acmRealOverride: null });

    // Se guardó el null…
    const guardado = prisma.projectWeek.update.mock.calls[0]?.[0] as {
      data: { acmRealOverride: number | null };
    };
    expect(guardado.data.acmRealOverride).toBeNull();
    // …y el recálculo dejó el calculado.
    expect(escrito()['S-2']?.acmReal).toBeCloseTo(0.4, 5);
  });

  it('una semana sin informe queda en null, no en cero', async () => {
    prisma.projectActivity.findMany.mockResolvedValue([{ hh: 100, realByWeek: [0.4] }]);
    prisma.projectActivity.findFirst.mockResolvedValueOnce({ id: 'a-1', realByWeek: [0.4] });

    await service.editarAvanceActividad('p-1', { wbsId: 7, semana: 0, valor: 0.4 });

    expect(escrito()['S-3']?.acmReal).toBeNull();
  });

  it('rellena las semanas intermedias con el último acumulado, no con cero', async () => {
    // Informar S-3 sin haber informado S-2 no puede borrar lo ya ejecutado.
    prisma.projectActivity.findFirst.mockResolvedValueOnce({ id: 'a-1', realByWeek: [0.4] });

    await service.editarAvanceActividad('p-1', { wbsId: 7, semana: 2, valor: 0.9 });

    const arg = prisma.projectActivity.update.mock.calls[0]?.[0] as {
      data: { realByWeek: number[] };
    };
    expect(arg.data.realByWeek).toEqual([0.4, 0.4, 0.9]);
  });

  it('no toca nada cuando la edición de semana viene vacía', async () => {
    prisma.projectWeek.findFirst.mockResolvedValueOnce({ id: 'w-2' });

    await service.editarSemana('p-1', { code: 'S-2' });

    expect(prisma.projectWeek.update).not.toHaveBeenCalled();
  });

  it('rechaza una actividad que no es del proyecto', async () => {
    prisma.projectActivity.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.editarAvanceActividad('p-1', { wbsId: 999, semana: 0, valor: 0.5 }),
    ).rejects.toThrow(/no existe/i);
  });

  it('rechaza colgar la foto de una ETAPA en vez del cerco', async () => {
    // El tablero agrupa las fotos por la tarea padre: colgada de una hija no
    // aparecería donde se espera.
    prisma.task.findFirst.mockResolvedValueOnce({ id: 't-1', name: 'Etapa', parentId: 'cerco-1' });
    await expect(
      service.subirFotoCerco(
        'p-1',
        't-1',
        { buffer: Buffer.from('x'), originalname: 'f.jpg', mimetype: 'image/jpeg' },
        'u-1',
      ),
    ).rejects.toThrow(/no en una de sus etapas/i);
  });

  it('rechaza un archivo que no es imagen', async () => {
    prisma.task.findFirst.mockResolvedValueOnce({ id: 'c-1', name: 'Cerco A-I', parentId: null });
    await expect(
      service.subirFotoCerco(
        'p-1',
        'c-1',
        { buffer: Buffer.from('x'), originalname: 'f.pdf', mimetype: 'application/pdf' },
        'u-1',
      ),
    ).rejects.toThrow(/imagen/i);
  });

  it('la lectura trae el calculado AL LADO de la sobreescritura', async () => {
    // Con una sobreescritura puesta, la pantalla tiene que poder mostrar cuánto
    // se aparta de lo que dicen las actividades.
    prisma.project.findUnique.mockResolvedValueOnce({
      totalHh: 200,
      cutoffDate: null,
      planAtCutoff: null,
    });
    prisma.projectWeek.findMany.mockResolvedValueOnce(
      semanas({ 'S-2': { acm: 0.55 } }).map((w) => ({
        ...w,
        closeDate: new Date('2026-09-20T00:00:00Z'),
        hhPlan: 0,
        parPlan: 0,
        acmPlan: 0,
        parReal: null,
        acmReal: w.code === 'S-2' ? 0.55 : null,
      })),
    );

    const r = await service.getAvanceEditable('p-1', 'u-1');
    const s2 = r.semanas.find((w) => w.code === 'S-2');

    expect(s2?.acmReal).toBeCloseTo(0.55, 5);
    expect(s2?.acmRealOverride).toBeCloseTo(0.55, 5);
    // (100×0,6 + 100×0,2) / 200 = 0,40
    expect(s2?.acmRealCalculado).toBeCloseTo(0.4, 5);
  });

  it('puedeEditar sale de la misma relación FGA que el guard de los PATCH', async () => {
    prisma.project.findUnique.mockResolvedValueOnce({
      totalHh: 0,
      cutoffDate: null,
      planAtCutoff: null,
    });
    prisma.projectWeek.findMany.mockResolvedValueOnce([]);
    fga.check.mockResolvedValueOnce(false);

    const r = await service.getAvanceEditable('p-1', 'u-1');

    expect(r.puedeEditar).toBe(false);
    expect(fga.check).toHaveBeenCalledWith({
      user: 'user:u-1',
      relation: 'can_manage_progress',
      object: 'project:p-1',
    });
  });

  it('quitar la foto solo busca entre IMÁGENES del cerco', async () => {
    // Si buscara cualquier documento, podría borrar el PDF de un plano colgado
    // del mismo cerco.
    prisma.projectDocument.findMany.mockResolvedValueOnce([]);

    await expect(service.quitarFotoCerco('p-1', 'c-1')).rejects.toThrow(/no tiene fotos/i);

    const arg = prisma.projectDocument.findMany.mock.calls[0]?.[0] as {
      where: { OR?: Array<{ fileUrl: { endsWith: string } }> };
    };
    expect(arg.where.OR?.map((c) => c.fileUrl.endsWith)).toEqual([
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
    ]);
  });

  it('no deja quitar la sobreescritura de una semana SIN detalle por actividad', async () => {
    // Sin calculado no hay a qué volver: la semana quedaría vacía y el tablero
    // perdería un informe firmado. Las actividades de la prueba llegan a S-2.
    prisma.projectWeek.findFirst.mockResolvedValueOnce({ id: 'w-3', index: 3 });

    await expect(
      service.editarSemana('p-1', { code: 'S-3', acmRealOverride: null }),
    ).rejects.toThrow(/detalle por actividad/i);
    expect(prisma.projectWeek.update).not.toHaveBeenCalled();
  });
});
