import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import type { AvailableWidget, DashboardView, LayoutItem } from './dashboard.types';
import { WIDGET_CATALOG } from './widgets.catalog';
import type { WidgetDefinition } from './widgets.catalog';

/**
 * Dashboard modular configurable por usuario (§6-2.1).
 *
 * Disponibilidad de widgets = catálogo (`widgets.catalog.ts`) filtrado por
 * permiso vía OpenFGA: los widgets con `permission` se incluyen solo si
 * `FgaService.check(user:<id>, relation, type:id)` es true; los sin permiso van
 * siempre.
 *
 * Layout = lista persistida `{ widgetKey, order, visible }` (JSONB). Sin config
 * guardada → layout por defecto (todos los disponibles, visibles, en el orden
 * del catálogo). Con config guardada → se RECONCILIA contra los disponibles:
 * se descartan widgets que ya no existen o que el usuario ya no puede ver, y se
 * agregan al final los nuevos disponibles que falten (para que aparezcan).
 *
 * El `userId` SIEMPRE llega del controller (sesión), nunca del body.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
  ) {}

  /** Dashboard del usuario: widgets disponibles + layout reconciliado. */
  async getForUser(userId: string): Promise<DashboardView> {
    const widgets = await this.availableWidgets(userId);
    const config = await this.prisma.dashboardConfig.findUnique({ where: { userId } });
    const stored = config ? parseStoredLayout(config.layout) : null;
    const layout = this.reconcile(widgets, stored);
    return { widgets, layout };
  }

  /**
   * Guarda el layout del propio usuario (upsert). Valida que cada `widgetKey`
   * esté entre los DISPONIBLES (rechaza desconocidos/no permitidos con 400).
   * Devuelve el mismo shape que `getForUser` (layout reconciliado, así un
   * widget disponible omitido por el cliente reaparece al final).
   */
  async updateForUser(userId: string, layout: LayoutItem[]): Promise<DashboardView> {
    const widgets = await this.availableWidgets(userId);
    const availableKeys = new Set(widgets.map((w) => w.key));

    for (const item of layout) {
      if (!availableKeys.has(item.widgetKey)) {
        throw new BadRequestException(
          `El widget "${item.widgetKey}" no existe o no está disponible para ti.`,
        );
      }
    }

    const normalized = this.normalize(layout);
    await this.prisma.dashboardConfig.upsert({
      where: { userId },
      create: { userId, layout: normalized as unknown as Prisma.InputJsonValue },
      update: { layout: normalized as unknown as Prisma.InputJsonValue },
    });

    const reconciled = this.reconcile(widgets, normalized);
    return { widgets, layout: reconciled };
  }

  // ============ Helpers ============

  /** Catálogo filtrado por permiso FGA. Widgets sin permiso van siempre. */
  private async availableWidgets(userId: string): Promise<AvailableWidget[]> {
    const decisions = await Promise.all(
      WIDGET_CATALOG.map((widget) => this.isVisible(userId, widget)),
    );
    return WIDGET_CATALOG.filter((_widget, i) => decisions[i]).map(toAvailable);
  }

  /** ¿El usuario puede ver este widget? Sin permiso → sí; con permiso → FGA. */
  private async isVisible(userId: string, widget: WidgetDefinition): Promise<boolean> {
    if (!widget.permission) {
      return true;
    }
    const { relation, type, id } = widget.permission;
    return this.fga.check({ user: `user:${userId}`, relation, object: `${type}:${id}` });
  }

  /**
   * Reconcilia un layout (o null) contra los widgets disponibles:
   *  - conserva solo ítems cuyo `widgetKey` siga disponible (respeta su visible),
   *  - agrega al final los disponibles que falten (visible:true),
   *  - reordena `order` de forma compacta y estable (0..n-1).
   * Sin layout previo → todos los disponibles, visibles, en orden de catálogo.
   */
  private reconcile(widgets: AvailableWidget[], stored: LayoutItem[] | null): LayoutItem[] {
    const availableKeys = new Set(widgets.map((w) => w.key));

    const kept: LayoutItem[] = (stored ?? [])
      .filter((item) => availableKeys.has(item.widgetKey))
      .slice()
      .sort((a, b) => a.order - b.order);

    const seen = new Set(kept.map((item) => item.widgetKey));
    const appended: LayoutItem[] = widgets
      .filter((w) => !seen.has(w.key))
      .map((w) => ({ widgetKey: w.key, order: 0, visible: true }));

    return this.normalize([...kept, ...appended]);
  }

  /** Reasigna `order` compacto (0..n-1) según la posición actual del array. */
  private normalize(layout: LayoutItem[]): LayoutItem[] {
    return layout.map((item, index) => ({
      widgetKey: item.widgetKey,
      order: index,
      visible: item.visible,
    }));
  }
}

/** Proyecta una definición de catálogo a la vista pública (oculta `permission`). */
function toAvailable(widget: WidgetDefinition): AvailableWidget {
  return { key: widget.key, title: widget.title, description: widget.description };
}

/**
 * Parsea el JSONB persistido a `LayoutItem[]`, descartando entradas con forma
 * inválida (defensivo: el JSONB pudo escribirse por una versión previa). Nunca
 * lanza: una entrada mal formada simplemente se ignora.
 */
function parseStoredLayout(value: Prisma.JsonValue): LayoutItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: LayoutItem[] = [];
  for (const entry of value) {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).widgetKey === 'string' &&
      typeof (entry as Record<string, unknown>).order === 'number' &&
      typeof (entry as Record<string, unknown>).visible === 'boolean'
    ) {
      const e = entry as Record<string, unknown>;
      items.push({
        widgetKey: e.widgetKey as string,
        order: e.order as number,
        visible: e.visible as boolean,
      });
    }
  }
  return items;
}
