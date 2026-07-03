import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import type { LayoutItem } from '../../src/modules/dashboard/dashboard.types';
import { WIDGET_CATALOG } from '../../src/modules/dashboard/widgets.catalog';

/** Claves del catálogo que NO requieren permiso (siempre disponibles). */
const PUBLIC_KEYS = WIDGET_CATALOG.filter((w) => !w.permission).map((w) => w.key);
/** Clave del widget que requiere permiso (gating FGA). */
const GATED_KEY = WIDGET_CATALOG.find((w) => w.permission)?.key ?? 'usuarios-total';

interface DashboardPrismaParts {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
}

function buildPrisma(
  parts: Partial<DashboardPrismaParts> = {},
): { prisma: PrismaService; parts: DashboardPrismaParts } {
  const resolved: DashboardPrismaParts = {
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    upsert: parts.upsert ?? vi.fn(() => Promise.resolve(undefined)),
  };
  const prisma = { dashboardConfig: resolved } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

/** FGA mock: `allowGated` controla si el usuario puede ver el widget con permiso. */
function buildFga(allowGated: boolean): { fga: FgaService; check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(
    (params: { user: string; relation: string; object: string }): Promise<boolean> => {
      expect(params.user).toMatch(/^user:/);
      return Promise.resolve(allowGated);
    },
  );
  return { fga: { check } as unknown as FgaService, check };
}

describe('DashboardService.getForUser', () => {
  let prismaBits: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    prismaBits = buildPrisma();
  });

  it('sin config guardada devuelve layout por defecto: todos los disponibles, visibles, en orden de catálogo', async () => {
    const { fga } = buildFga(true);
    const service = new DashboardService(prismaBits.prisma, fga);

    const view = await service.getForUser('u1');

    // Con permiso concedido, todos los widgets del catálogo están disponibles.
    expect(view.widgets.map((w) => w.key)).toEqual(WIDGET_CATALOG.map((w) => w.key));
    expect(view.layout.map((l) => l.widgetKey)).toEqual(WIDGET_CATALOG.map((w) => w.key));
    expect(view.layout.every((l) => l.visible)).toBe(true);
    expect(view.layout.map((l) => l.order)).toEqual(WIDGET_CATALOG.map((_w, i) => i));
  });

  it('los widgets no exponen el campo permission interno', async () => {
    const { fga } = buildFga(true);
    const service = new DashboardService(prismaBits.prisma, fga);

    const view = await service.getForUser('u1');

    for (const widget of view.widgets) {
      expect(Object.keys(widget).sort()).toEqual(['description', 'key', 'title']);
    }
  });

  it('filtra por permiso FGA: el widget gated se OMITE si el usuario no puede verlo', async () => {
    const { fga, check } = buildFga(false);
    const service = new DashboardService(prismaBits.prisma, fga);

    const view = await service.getForUser('u1');

    expect(view.widgets.map((w) => w.key)).toEqual(PUBLIC_KEYS);
    expect(view.widgets.some((w) => w.key === GATED_KEY)).toBe(false);
    // Se consultó FGA al menos una vez (por el widget con permiso).
    expect(check).toHaveBeenCalled();
  });

  it('reconciliación: descarta widgetKeys que ya no existen y los no permitidos', async () => {
    const stored: LayoutItem[] = [
      { widgetKey: 'obsoleto', order: 0, visible: true },
      { widgetKey: GATED_KEY, order: 1, visible: false },
      { widgetKey: PUBLIC_KEYS[0] ?? 'directorio', order: 2, visible: true },
    ];
    const findUnique = vi.fn(() => Promise.resolve({ layout: stored }));
    ({ prisma: prismaBits.prisma } = buildPrisma({ findUnique }));
    // Usuario SIN permiso → GATED_KEY no disponible.
    const { fga } = buildFga(false);
    const service = new DashboardService(prismaBits.prisma, fga);

    const view = await service.getForUser('u1');

    const keys = view.layout.map((l) => l.widgetKey);
    expect(keys).not.toContain('obsoleto');
    expect(keys).not.toContain(GATED_KEY);
    expect(keys).toContain(PUBLIC_KEYS[0]);
  });

  it('reconciliación: agrega al final los widgets disponibles nuevos que faltan en el layout', async () => {
    // El layout guardado solo conoce el primer widget público; el resto debe aparecer.
    const firstPublic = PUBLIC_KEYS[0] ?? 'directorio';
    const stored: LayoutItem[] = [{ widgetKey: firstPublic, order: 0, visible: false }];
    const findUnique = vi.fn(() => Promise.resolve({ layout: stored }));
    ({ prisma: prismaBits.prisma } = buildPrisma({ findUnique }));
    const { fga } = buildFga(true);
    const service = new DashboardService(prismaBits.prisma, fga);

    const view = await service.getForUser('u1');

    const keys = view.layout.map((l) => l.widgetKey);
    // Todos los disponibles presentes; el preexistente conserva visible=false.
    expect(keys.sort()).toEqual(WIDGET_CATALOG.map((w) => w.key).sort());
    expect(view.layout.find((l) => l.widgetKey === firstPublic)?.visible).toBe(false);
    // Los nuevos van al final, después del preexistente.
    expect(keys[0]).toBe(firstPublic);
    // order recompactado 0..n-1.
    expect(view.layout.map((l) => l.order)).toEqual(view.layout.map((_l, i) => i));
  });
});

describe('DashboardService.updateForUser', () => {
  it('rechaza con 400 un widgetKey desconocido / no disponible', async () => {
    const upsert = vi.fn();
    const { prisma } = buildPrisma({ upsert });
    const { fga } = buildFga(true);
    const service = new DashboardService(prisma, fga);

    const bad: LayoutItem[] = [{ widgetKey: 'no-existe', order: 0, visible: true }];

    await expect(service.updateForUser('u1', bad)).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rechaza con 400 un widget gated cuando el usuario NO tiene permiso', async () => {
    const upsert = vi.fn();
    const { prisma } = buildPrisma({ upsert });
    const { fga } = buildFga(false); // sin permiso
    const service = new DashboardService(prisma, fga);

    const layout: LayoutItem[] = [{ widgetKey: GATED_KEY, order: 0, visible: true }];

    await expect(service.updateForUser('u1', layout)).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('guarda (upsert) un layout válido y retorna el shape reconciliado', async () => {
    const upsert = vi.fn<(args: { where: { userId: string } }) => Promise<undefined>>(() =>
      Promise.resolve(undefined),
    );
    const { prisma } = buildPrisma({ upsert });
    const { fga } = buildFga(true);
    const service = new DashboardService(prisma, fga);

    const firstPublic = PUBLIC_KEYS[0] ?? 'directorio';
    const layout: LayoutItem[] = [{ widgetKey: firstPublic, order: 0, visible: false }];

    const view = await service.updateForUser('u1', layout);

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ userId: 'u1' });
    // El widget enviado conserva su visibilidad; el resto reaparece reconciliado.
    expect(view.layout.find((l) => l.widgetKey === firstPublic)?.visible).toBe(false);
    expect(view.layout.map((l) => l.widgetKey).sort()).toEqual(
      WIDGET_CATALOG.map((w) => w.key).sort(),
    );
  });
});
