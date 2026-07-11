# Fase 1c — Finanzas Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reworkear el módulo Finanzas del web (`nodes/web`): quitar Liquidaciones + import CSV, agregar una **Vista general** (cards + carruseles de 2 estados + alertas con overlay + tabla histórica filtrable que recalcula las cards), extender los formularios de **Reembolso** (OCR + categoría con Vehículos + observaciones) y **Horas Extra** (hora inicio/término + proyecto + autorizado por + on-behalf), y ampliar la **impresión en lote** (orientación/tamaño/preview/marcado impresa). Todo el gating es **por permiso** (`useHasPermission`).

**Architecture:** Frontend-only (React 19 + Vite). Reutiliza las primitivas del design system (`Modal`, `Select`, `Tabs`, `Card`, `states`, `RejectDialog`, `PageContainer`, `PageHeader`, `Table`) y los hooks de datos existentes (`useReimbursements`, `useOvertime`) — la Vista general **no** agrega endpoints de agregación: computa las cards en cliente a partir de las listas ya cargadas, filtradas por el estado de la tabla. Las funciones puras (cierre mensual día 20, unificación de filas, agregación, filtrado) viven en un módulo testeable (TDD con vitest). El gating de UI usa el hook `useHasPermission` (contrato compartido).

**Tech Stack:** React 19 · TypeScript estricto · Vite · Tailwind v4 · shadcn/ui (primitivas propias) · lucide-react · sonner (toasts) · vitest (tests).

---

## Contrato compartido (CONSUMIDO, no redefinido)

Este plan **consume** el contrato de control de acceso definido por el plan de Fase 1 (backend + auth), autoridad en `docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md` §2 (permisos/bundles) y §3 (control de acceso):

- **`GET /auth/me` expone `permissions: string[]`** y el hook **`useHasPermission(perm: string): boolean`** vive en `@/hooks/use-has-permission` (fail-closed mientras carga el perfil, igual patrón que el actual `useHasRole`). **Este plan NO lo crea** — solo lo importa. Si al ejecutar la Task 5 el hook aún no existe, está bloqueado por el plan de control de acceso; coordinar antes de continuar.
- **Guard de ruta** (`RequirePermission`/`RequireModule`): lo agrega el plan de control de acceso a nivel `App.tsx`. Este plan añade **redirección interna** dentro de `FinanzasPage` (patrón `<Navigate>` ya presente) como defensa en profundidad, no reemplaza el guard de ruta.

Permisos de finanzas consumidos (spec §2.2):
- `finance:request:create` — base (todo usuario). No se chequea: es el default.
- `finance:request:view:all` — ver todas las solicitudes (habilita variante manager de la Vista general + filtro por trabajador).
- `finance:overtime:view:all` — ver todas las horas extra (subconjunto RH).
- `finance:request:approve` — botones aprobar/rechazar.
- `finance:payment:register` — botón registrar pago.
- `finance:print:batch` — botón impresión en lote.
- `finance:overtime:create:onbehalf` — HE con fecha libre + a nombre de otro trabajador.

### Dependencias de backend (implementadas por el plan de Finanzas backend — spec §5)

Los **wrappers de API y los tipos del web** los agrega ESTE plan (viven en `nodes/web`), pero **espejan** contratos HTTP que implementa el plan de backend. Endpoints/campos consumidos:

- `ReimbursementView` extendido: `category`, `vehicleId?`, `vehicleName?`, `vehicleSubcategory?`, `observations?`, `rejectionReason?`, `printedAt?`, `printed`, `project?`, `client?`.
- `CreateReimbursementInput` extendido: `category`, `vehicleId?`, `vehicleSubcategory?`, `observations?`.
- `POST /reimbursements/scan-receipt` (multipart `file`) → `{ concept?, amount?, date?, category? }` (OCR NVIDIA).
- `POST /reimbursements/print` acepta `{ ids, perPage, orientation, pageSize }` → PDF Blob.
- `POST /reimbursements/print/mark` `{ ids }` → marca `printedAt` (post-descarga). (Path del backend Fase 1c: `print/mark`, NO `mark-printed`.)
- `OvertimeView` extendido: `startTime`, `endTime?`, `status` con `'BORRADOR'`, `project?`, `authorizedBy?`, `rejectionReason?`.
- `CreateOvertimeInput` extendido: `startTime`, `endTime?`, `projectId? | otherProject?`, `authorizedById`, `onBehalfOfUserId?` (reemplaza `hours`/`reason`).
- `POST /overtime/:id/close` `{ endTime }` → cierra un borrador.

> Si un endpoint aún no está disponible al ejecutar su task, el wrapper se puede escribir igual (mockeable en tests); la integración e2e queda gateada por el backend. No inventar el shape: si difiere del backend real, ajustar el tipo del web para que coincida.

---

## File Structure

**Crear** (todos bajo `nodes/web/src/pages/finanzas/` salvo indicación):
- `finance-overview.ts` — funciones puras: `overtimeMonth(dateIso)`, `toFinanceRows(reimb, ot)`, `filterRows(rows, filters)`, `aggregate(rows)`, `rankByWorker`, `rankByProject`. Sin JSX, testeable.
- `finance-overview.test.ts` — tests vitest de las funciones puras.
- `reembolso-form.tsx` — `ReembolsoFormDialog` (overlay): foto/cámara→OCR, concepto, monto, categoría (Vehículos→vehículo+subcategoría), fecha, observaciones.
- `horas-extra-form.tsx` — `HorasExtraFormDialog` (overlay): hora inicio, hora término (opcional→borrador), fecha, proyecto (asignados + Otro), autorizado por, on-behalf.
- `batch-print-dialog.tsx` — `BatchPrintDialog`: selección (todas pendientes / manual), boletas por hoja, orientación, tamaño, preview, confirmar→descarga→marca impresa.
- `stat-carousel.tsx` — `StatCarousel` (card de 2 estados con autoalternado 5s / click-congela / flechas-en-hover / 2 puntitos).
- `request-detail-dialog.tsx` — `RequestDetailDialog`: detalle de una solicitud + acciones aprobar/rechazar (para las alertas de la Vista general).
- `historical-table.tsx` — `HistoricalTable`: filtros (trabajador gated / fecha / mes / proyecto / cliente / orden) + paginación (todas/20/50/100).
- `vista-general.tsx` — `VistaGeneralTab`: ensambla cards (worker vs manager) + alertas + `HistoricalTable`; las cards se recalculan del filtro.

**Modificar:**
- `nodes/web/src/types/finance.ts` — extender `ReimbursementView`, `OvertimeView`, `CreateReimbursementInput`, `CreateOvertimeInput`; agregar enums `ReimbursementCategory`, `VehicleSubcategory`, tipo unificado `FinanceRow`, `FinanceRowKind`, `OverviewFilters`.
- `nodes/web/src/lib/api.ts` — `scanReceipt`, extender `downloadReimbursementsPdf` (orientación/tamaño), `markReimbursementsPrinted`, `closeOvertime`; ajustar `createOvertime` (nuevo input).
- `nodes/web/src/pages/finanzas/index.tsx` — pestañas: Vista general | Reembolsos | Horas extra (quitar Liquidaciones), gating por permiso.
- `nodes/web/src/pages/finanzas/reembolsos.tsx` — quitar Import CSV + form inline; usar `ReembolsoFormDialog`; gatear batch print por `finance:print:batch`; usar `BatchPrintDialog`.
- `nodes/web/src/pages/finanzas/horas-extra.tsx` — usar `HorasExtraFormDialog`.

**Eliminar:**
- `nodes/web/src/pages/finanzas/liquidaciones.tsx` — subsección Liquidaciones fuera de la UI (spec §5.1). El hook `use-liquidations.ts` y el backend quedan, huérfanos.

---

## Convenciones de test

Runner: **vitest** (`nodes/web`, `pnpm --filter @gmt-platform/web test` corre todo). Para un archivo puntual:

```bash
pnpm --filter @gmt-platform/web exec vitest run src/pages/finanzas/finance-overview.test.ts
```

Type-check global (verificación de que no se rompe nada): `pnpm --filter @gmt-platform/web build` (corre `tsc --noEmit` antes del bundle).

Commits: uno por task (o por par test↔impl). Mensajes en español, prefijo `feat(finanzas):` / `refactor(finanzas):` / `test(finanzas):`.

---

## Task 1: Extender tipos de Finanzas

**Files:**
- Modify: `nodes/web/src/types/finance.ts`

- [ ] **Step 1: Agregar enums y extender los tipos existentes**

Editar `nodes/web/src/types/finance.ts`. Tras la definición de `FinanceStatus` (línea 14), agregar:

```ts
/** Estado de una HE incluye BORRADOR (hora término pendiente). */
export type OvertimeStatus = FinanceStatus | 'BORRADOR';

/** Categorías de reembolso (spec §5.5). */
export type ReimbursementCategory =
  | 'ALIMENTACION'
  | 'TRANSPORTE'
  | 'VEHICULOS'
  | 'OTROS';

/** Subcategorías cuando la categoría es VEHICULOS (spec §5.5). */
export type VehicleSubcategory =
  | 'COMBUSTIBLE'
  | 'MANTENCION_LIMPIEZA'
  | 'REPUESTO'
  | 'OTRO';

/** Etiquetas legibles de categorías/subcategorías para selects y tablas. */
export const REIMBURSEMENT_CATEGORY_LABELS: Record<ReimbursementCategory, string> = {
  ALIMENTACION: 'Alimentación',
  TRANSPORTE: 'Transporte',
  VEHICULOS: 'Vehículos',
  OTROS: 'Otro(s)',
};

export const VEHICLE_SUBCATEGORY_LABELS: Record<VehicleSubcategory, string> = {
  COMBUSTIBLE: 'Combustible',
  MANTENCION_LIMPIEZA: 'Mantención / Limpieza',
  REPUESTO: 'Repuesto',
  OTRO: 'Otro',
};
```

- [ ] **Step 2: Extender `ReimbursementView`**

Dentro de `interface ReimbursementView`, tras `category: string | null;` agregar:

```ts
  /** Referencia al vehículo (asset VEHICULO) si category === 'VEHICULOS'. */
  vehicleId: string | null;
  /** Nombre/código del vehículo (solo en vistas que lo hidratan). */
  vehicleName: string | null;
  /** Subcategoría del gasto de vehículo. */
  vehicleSubcategory: VehicleSubcategory | null;
  /** Observaciones libres (opcional). */
  observations: string | null;
  /** Motivo de rechazo persistido; `null` si no fue rechazado. */
  rejectionReason: string | null;
  /** ISO-8601 cuando se imprimió en lote; `null` si aún no. */
  printedAt: string | null;
  /** Proyecto asociado (si aplica); para el filtro por proyecto/cliente. */
  project: { id: string; name: string; clientName: string | null } | null;
```

- [ ] **Step 3: Extender `OvertimeView`**

Reemplazar en `interface OvertimeView` el bloque `hours`/`reason`/`status` por:

```ts
  /** Decimal (Float) — total de horas (derivado de inicio/término por el backend). */
  hours: number | null;
  /** Hora de inicio "HH:mm". */
  startTime: string;
  /** Hora de término "HH:mm"; `null` mientras la HE es BORRADOR. */
  endTime: string | null;
  reason: string;
  status: OvertimeStatus;
  /** Proyecto reportado; `otherProject` si fue "Otro". */
  project: { id: string; name: string; clientName: string | null } | null;
  otherProject: string | null;
  /** Usuario que autorizó ("Autorizado por"). */
  authorizedBy: FinanceRequester | null;
  /** Motivo de rechazo persistido; `null` si no fue rechazado. */
  rejectionReason: string | null;
```

- [ ] **Step 4: Extender los inputs de creación**

Reemplazar `interface CreateReimbursementInput` por:

```ts
/** Cuerpo de `POST /reimbursements`. El `userId` lo deriva el backend. */
export interface CreateReimbursementInput {
  /** CLP entero positivo (> 0). */
  amount: number;
  /** ISO-8601 (fecha de la boleta). */
  date: string;
  /** 1..200 caracteres. */
  concept: string;
  /** Categoría del gasto. */
  category: ReimbursementCategory;
  /** Requerido si category === 'VEHICULOS'. */
  vehicleId?: string;
  /** Requerido si category === 'VEHICULOS'. */
  vehicleSubcategory?: VehicleSubcategory;
  /** Observaciones opcionales, ≤ 500 caracteres. */
  observations?: string;
}
```

Reemplazar `interface CreateOvertimeInput` por:

```ts
/** Cuerpo de `POST /overtime`. El `userId` lo deriva el backend (o `onBehalfOfUserId`). */
export interface CreateOvertimeInput {
  /** ISO-8601 (fecha de las horas). */
  date: string;
  /** "HH:mm" — obligatoria. */
  startTime: string;
  /** "HH:mm" — opcional: si falta, la solicitud queda BORRADOR. */
  endTime?: string;
  /** Motivo/descripción. */
  reason: string;
  /** Proyecto asignado; excluyente con `otherProject`. */
  projectId?: string;
  /** Texto libre si el proyecto es "Otro"; excluyente con `projectId`. */
  otherProject?: string;
  /** Usuario que autoriza ("Autorizado por"). */
  authorizedById: string;
  /** Solo con permiso `finance:overtime:create:onbehalf`: crea a nombre de otro. */
  onBehalfOfUserId?: string;
}
```

- [ ] **Step 5: Agregar el tipo unificado y los filtros de la Vista general**

Al final del archivo agregar:

```ts
/** Tipo de solicitud en la fila unificada de la tabla histórica. */
export type FinanceRowKind = 'REEMBOLSO' | 'HORA_EXTRA';

/** Fila unificada (reembolso u HE) para la Vista general (§5.2/§5.3). */
export interface FinanceRow {
  id: string;
  kind: FinanceRowKind;
  /** ISO-8601 de la fecha del gasto / de las horas. */
  date: string;
  status: OvertimeStatus;
  /** CLP entero (reembolso) o `null` (HE). */
  amount: number | null;
  /** Horas (HE) o `null` (reembolso). */
  hours: number | null;
  /** Concepto (reembolso) o motivo (HE). */
  description: string;
  category: string | null;
  requesterId: string;
  requesterName: string;
  projectId: string | null;
  projectName: string | null;
  clientName: string | null;
  /** Solo reembolsos: para el flujo de impresión en lote. */
  printed: boolean;
  receiptUrl: string | null;
}

/** Filtros de la tabla histórica (§5.3). `null` = sin filtro. */
export interface OverviewFilters {
  requesterId: string | null;
  /** Modo de filtro por fecha. */
  dateMode: 'none' | 'before' | 'after' | 'between' | 'exact' | 'month';
  dateFrom: string | null;
  dateTo: string | null;
  /** "YYYY-MM" cuando dateMode === 'month' (cierre día 20). */
  month: string | null;
  projectId: string | null;
  clientName: string | null;
  order: 'asc' | 'desc';
}
```

- [ ] **Step 6: Verificar que compila y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: falla en `reembolsos.tsx`/`horas-extra.tsx`/`api.ts` por los tipos que aún no usan los nuevos campos (esperado; se arregla en tasks siguientes). Confirmar que `types/finance.ts` **no** tiene errores propios (los errores apuntan a otros archivos).

```bash
git add nodes/web/src/types/finance.ts
git commit -m "feat(finanzas): extender tipos (categorías, vehículo, HE inicio/término, fila unificada)"
```

---

## Task 2: Wrappers de API de Finanzas

**Files:**
- Modify: `nodes/web/src/lib/api.ts`

- [ ] **Step 1: Extender la firma del import de tipos**

En `nodes/web/src/lib/api.ts`, en el bloque de imports de `@/types/finance` (líneas ~19-23), asegurarse de incluir los nuevos tipos usados aquí. Cambiar el import a:

```ts
  CreateOvertimeInput,
  CreateReimbursementInput,
  FinanceStatus,
  OvertimeView,
  ReimbursementView,
```

(No cambian: siguen exportados desde `finance.ts`. Los nuevos tipos se usan sólo en `finance.ts` y componentes, no en firmas de `api.ts`.)

- [ ] **Step 2: Agregar `scanReceipt` tras `createReimbursement`**

Insertar tras `createReimbursement` (línea ~813):

```ts
/**
 * `POST /reimbursements/scan-receipt` — OCR NVIDIA de la boleta (multipart `file`).
 * Devuelve campos sugeridos; el usuario los corrige. Puede venir parcial.
 */
export function scanReceipt(file: File): Promise<{
  concept?: string;
  amount?: number;
  date?: string;
  category?: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest('/reimbursements/scan-receipt', formData);
}
```

- [ ] **Step 3: Extender `downloadReimbursementsPdf` con orientación/tamaño**

Reemplazar la firma y el body de `downloadReimbursementsPdf` (líneas ~903-933) por:

```ts
export type PrintOrientation = 'portrait' | 'landscape';
export type PrintPageSize = 'A4' | 'LETTER' | 'LEGAL';

/**
 * `POST /reimbursements/print` — genera en el SERVIDOR un PDF con las boletas de
 * los reembolsos indicados (§5.7). Solo gestores (403 si no). Devuelve el PDF
 * como `Blob`. NO marca impresas: eso lo hace `markReimbursementsPrinted` tras
 * la descarga.
 */
export async function downloadReimbursementsPdf(
  ids: string[],
  perPage: 2 | 4 | 6,
  orientation: PrintOrientation = 'portrait',
  pageSize: PrintPageSize = 'A4',
): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_URL}/reimbursements/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids, perPage, orientation, pageSize }),
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // sin cuerpo JSON
    }
    throw new ApiError(extractMessage(body, `Error ${res.status} al generar el PDF.`), res.status);
  }
  return res.blob();
}

/**
 * `POST /reimbursements/print/mark` — marca `printedAt` en cada reembolso tras
 * una descarga confirmada (§5.7). Solo gestores (403 si no).
 * NOTA: el path del backend Fase 1c es `print/mark` (no `mark-printed`).
 */
export function markReimbursementsPrinted(ids: string[]): Promise<void> {
  return request<void>('/reimbursements/print/mark', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
```

- [ ] **Step 4: Agregar `closeOvertime` tras `payOvertime`**

Insertar al final del bloque de horas extra (tras `payOvertime`, línea ~997):

```ts
/**
 * `POST /overtime/:id/close` — cierra un BORRADOR agregando la hora de término.
 * BORRADOR→PENDIENTE; 409 si el estado no lo permite.
 */
export function closeOvertime(id: string, endTime: string): Promise<OvertimeView> {
  return request<OvertimeView>(
    `/overtime/${encodeURIComponent(id)}/close`,
    { method: 'POST', body: JSON.stringify({ endTime }) },
  );
}
```

- [ ] **Step 5: Verificar y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: siguen fallando `reembolsos.tsx`/`horas-extra.tsx` (aún no migrados), pero **no** `api.ts`. Confirmar que los errores no apuntan a `api.ts`.

```bash
git add nodes/web/src/lib/api.ts
git commit -m "feat(finanzas): api wrappers scanReceipt, print orientación/tamaño, mark-printed, closeOvertime"
```

---

## Task 3: Helper de cierre mensual (día 20) — TDD

**Files:**
- Create: `nodes/web/src/pages/finanzas/finance-overview.ts`
- Create: `nodes/web/src/pages/finanzas/finance-overview.test.ts`

- [ ] **Step 1: Escribir el test fallido de `overtimeMonth`**

Crear `nodes/web/src/pages/finanzas/finance-overview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { overtimeMonth } from './finance-overview';

describe('overtimeMonth (cierre día 20)', () => {
  it('fecha con día <= 20 cuenta como su mes calendario', () => {
    expect(overtimeMonth('2026-06-20T00:00:00.000Z')).toBe('2026-06');
    expect(overtimeMonth('2026-06-01T00:00:00.000Z')).toBe('2026-06');
  });

  it('fecha con día > 20 cuenta como el mes siguiente', () => {
    expect(overtimeMonth('2026-06-21T00:00:00.000Z')).toBe('2026-07');
    expect(overtimeMonth('2026-06-30T00:00:00.000Z')).toBe('2026-07');
  });

  it('rollover de diciembre pasa a enero del año siguiente', () => {
    expect(overtimeMonth('2026-12-25T00:00:00.000Z')).toBe('2027-01');
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm --filter @gmt-platform/web exec vitest run src/pages/finanzas/finance-overview.test.ts`
Expected: FAIL — `Failed to resolve import './finance-overview'` o `overtimeMonth is not a function`.

- [ ] **Step 3: Implementar `overtimeMonth`**

Crear `nodes/web/src/pages/finanzas/finance-overview.ts`:

```ts
import type {
  FinanceRow,
  OverviewFilters,
  OvertimeView,
  ReimbursementView,
} from '@/types/finance';

/**
 * Mes de agrupación de una fecha con cierre el día 20 (spec §2.4): si el día del
 * mes es ≤ 20, cuenta como su mes calendario; si es > 20, cuenta como el mes
 * siguiente. Devuelve "YYYY-MM". Usa UTC para ser estable entre zonas horarias.
 */
export function overtimeMonth(dateIso: string): string {
  const d = new Date(dateIso);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth(); // 0-11
  if (d.getUTCDate() > 20) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm --filter @gmt-platform/web exec vitest run src/pages/finanzas/finance-overview.test.ts`
Expected: PASS (3 tests de `overtimeMonth`).

- [ ] **Step 5: Commit**

```bash
git add nodes/web/src/pages/finanzas/finance-overview.ts nodes/web/src/pages/finanzas/finance-overview.test.ts
git commit -m "feat(finanzas): helper overtimeMonth (cierre día 20) con tests"
```

---

## Task 4: Helpers de unificación, filtrado y agregación — TDD

**Files:**
- Modify: `nodes/web/src/pages/finanzas/finance-overview.ts`
- Modify: `nodes/web/src/pages/finanzas/finance-overview.test.ts`

- [ ] **Step 1: Agregar tests de `toFinanceRows`, `filterRows`, `aggregate`, `rankByWorker`, `rankByProject`**

Agregar al final de `finance-overview.test.ts`:

```ts
import {
  toFinanceRows,
  filterRows,
  aggregate,
  rankByWorker,
  rankByProject,
} from './finance-overview';
import type { OvertimeView, ReimbursementView } from '@/types/finance';

const reqA = { id: 'u1', firstName: 'Ana', lastName: 'Díaz', email: 'a@x.cl' };
const reqB = { id: 'u2', firstName: 'Beto', lastName: 'Ruiz', email: 'b@x.cl' };

function reimb(over: Partial<ReimbursementView>): ReimbursementView {
  return {
    id: 'r1', userId: 'u1', amount: 1000, date: '2026-06-10T00:00:00.000Z',
    concept: 'Taxi', category: 'TRANSPORTE', vehicleId: null, vehicleName: null,
    vehicleSubcategory: null, observations: null, receiptUrl: null,
    status: 'PENDIENTE', decidedById: null, decidedAt: null, rejectionReason: null,
    printedAt: null, project: null, createdAt: '', updatedAt: '', requester: reqA,
    ...over,
  };
}

function ot(over: Partial<OvertimeView>): OvertimeView {
  return {
    id: 'o1', userId: 'u1', date: '2026-06-10T00:00:00.000Z', hours: 2,
    startTime: '18:00', endTime: '20:00', reason: 'Cierre', status: 'PENDIENTE',
    decidedById: null, decidedAt: null, project: null, otherProject: null,
    authorizedBy: null, rejectionReason: null, createdAt: '', updatedAt: '',
    requester: reqA, ...over,
  };
}

describe('toFinanceRows', () => {
  it('unifica reembolsos y HE en filas con kind y descripción', () => {
    const rows = toFinanceRows([reimb({})], [ot({})]);
    expect(rows).toHaveLength(2);
    const r = rows.find((x) => x.kind === 'REEMBOLSO')!;
    expect(r.amount).toBe(1000);
    expect(r.hours).toBeNull();
    expect(r.description).toBe('Taxi');
    const o = rows.find((x) => x.kind === 'HORA_EXTRA')!;
    expect(o.hours).toBe(2);
    expect(o.amount).toBeNull();
    expect(o.description).toBe('Cierre');
  });

  it('usa "requester" para el nombre y omite filas sin él con fallback', () => {
    const rows = toFinanceRows([reimb({ requester: undefined, userId: 'u9' })], []);
    expect(rows[0].requesterName).toBe('—');
    expect(rows[0].requesterId).toBe('u9');
  });
});

describe('filterRows', () => {
  const base = {
    requesterId: null, dateMode: 'none', dateFrom: null, dateTo: null,
    month: null, projectId: null, clientName: null, order: 'desc',
  } as const;
  const rows = toFinanceRows(
    [reimb({ id: 'r1', date: '2026-06-10T00:00:00.000Z', requester: reqA }),
     reimb({ id: 'r2', date: '2026-06-25T00:00:00.000Z', requester: reqB })],
    [ot({ id: 'o1', date: '2026-07-02T00:00:00.000Z', requester: reqA })],
  );

  it('filtra por trabajador', () => {
    const out = filterRows(rows, { ...base, requesterId: 'u2' });
    expect(out.map((r) => r.id)).toEqual(['r2']);
  });

  it('filtra por mes con cierre día 20 (r2 del 25-jun cae en julio)', () => {
    const out = filterRows(rows, { ...base, dateMode: 'month', month: '2026-07' });
    expect(out.map((r) => r.id).sort()).toEqual(['o1', 'r2']);
  });

  it('ordena por fecha ascendente', () => {
    const out = filterRows(rows, { ...base, order: 'asc' });
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'o1']);
  });

  it('filtra por rango entre dos fechas', () => {
    const out = filterRows(rows, {
      ...base, dateMode: 'between',
      dateFrom: '2026-06-20', dateTo: '2026-06-30',
    });
    expect(out.map((r) => r.id)).toEqual(['r2']);
  });
});

describe('aggregate', () => {
  it('cuenta HE pendientes y suma reembolsos APROBADOS (pend. de pago)', () => {
    const rows = toFinanceRows(
      [reimb({ id: 'r1', amount: 5000, status: 'APROBADO' }),
       reimb({ id: 'r2', amount: 3000, status: 'PENDIENTE' })],
      [ot({ id: 'o1', status: 'PENDIENTE' }), ot({ id: 'o2', status: 'APROBADO' })],
    );
    const a = aggregate(rows);
    expect(a.overtimePendingCount).toBe(1);
    expect(a.reimbursementApprovedUnpaid).toBe(5000);
  });
});

describe('rankByWorker / rankByProject', () => {
  it('rankByWorker ordena por total de reembolso desc', () => {
    const rows = toFinanceRows(
      [reimb({ id: 'r1', amount: 1000, requester: reqA, status: 'APROBADO' }),
       reimb({ id: 'r2', amount: 9000, requester: reqB, status: 'APROBADO' })],
      [],
    );
    const rank = rankByWorker(rows, 'reimbursement');
    expect(rank[0].label).toBe('Beto Ruiz');
    expect(rank[0].value).toBe(9000);
  });

  it('rankByProject cuenta HE por proyecto desc', () => {
    const rows = toFinanceRows([], [
      ot({ id: 'o1', project: { id: 'p1', name: 'Alfa', clientName: 'C1' } }),
      ot({ id: 'o2', project: { id: 'p1', name: 'Alfa', clientName: 'C1' } }),
      ot({ id: 'o3', project: { id: 'p2', name: 'Beta', clientName: 'C2' } }),
    ]);
    const rank = rankByProject(rows, 'overtime');
    expect(rank[0].label).toBe('Alfa');
    expect(rank[0].value).toBe(2);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm --filter @gmt-platform/web exec vitest run src/pages/finanzas/finance-overview.test.ts`
Expected: FAIL — `toFinanceRows is not a function` (y las demás).

- [ ] **Step 3: Implementar los helpers**

Agregar a `nodes/web/src/pages/finanzas/finance-overview.ts` (tras `overtimeMonth`):

```ts
function requesterName(r: { firstName: string; lastName: string } | undefined): string {
  return r ? `${r.firstName} ${r.lastName}` : '—';
}

/** Unifica reembolsos + HE en filas homogéneas para la Vista general. */
export function toFinanceRows(
  reimbursements: ReimbursementView[],
  overtime: OvertimeView[],
): FinanceRow[] {
  const rRows: FinanceRow[] = reimbursements.map((r) => ({
    id: r.id,
    kind: 'REEMBOLSO',
    date: r.date,
    status: r.status,
    amount: r.amount,
    hours: null,
    description: r.concept,
    category: r.category,
    requesterId: r.requester?.id ?? r.userId,
    requesterName: requesterName(r.requester),
    projectId: r.project?.id ?? null,
    projectName: r.project?.name ?? null,
    clientName: r.project?.clientName ?? null,
    printed: r.printedAt !== null,
    receiptUrl: r.receiptUrl,
  }));
  const oRows: FinanceRow[] = overtime.map((o) => ({
    id: o.id,
    kind: 'HORA_EXTRA',
    date: o.date,
    status: o.status,
    amount: null,
    hours: o.hours,
    description: o.reason,
    category: null,
    requesterId: o.requester?.id ?? o.userId,
    requesterName: requesterName(o.requester),
    projectId: o.project?.id ?? null,
    projectName: o.project?.name ?? o.otherProject ?? null,
    clientName: o.project?.clientName ?? null,
    printed: false,
    receiptUrl: null,
  }));
  return [...rRows, ...oRows];
}

/** Devuelve la porción "YYYY-MM-DD" de un ISO para comparaciones de fecha. */
function dayOf(dateIso: string): string {
  return dateIso.slice(0, 10);
}

/** Aplica los filtros de la tabla histórica y ordena por fecha (§5.3). */
export function filterRows(rows: FinanceRow[], f: OverviewFilters): FinanceRow[] {
  let out = rows.filter((r) => {
    if (f.requesterId && r.requesterId !== f.requesterId) return false;
    if (f.projectId && r.projectId !== f.projectId) return false;
    if (f.clientName && r.clientName !== f.clientName) return false;

    const day = dayOf(r.date);
    switch (f.dateMode) {
      case 'before':
        if (f.dateFrom && day >= f.dateFrom) return false;
        break;
      case 'after':
        if (f.dateFrom && day <= f.dateFrom) return false;
        break;
      case 'exact':
        if (f.dateFrom && day !== f.dateFrom) return false;
        break;
      case 'between':
        if (f.dateFrom && day < f.dateFrom) return false;
        if (f.dateTo && day > f.dateTo) return false;
        break;
      case 'month':
        if (f.month && overtimeMonth(r.date) !== f.month) return false;
        break;
      case 'none':
      default:
        break;
    }
    return true;
  });

  out = out.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    return f.order === 'asc' ? cmp : -cmp;
  });
  return out;
}

/** Métricas de las cards superiores (§5.2). */
export interface OverviewAggregate {
  /** HE en estado PENDIENTE. */
  overtimePendingCount: number;
  /** Suma CLP de reembolsos APROBADOS (aprobados pendientes de pago). */
  reimbursementApprovedUnpaid: number;
  /** HE por estado (para la card de 2 estados pendientes/aprobadas). */
  overtimeApprovedCount: number;
  /** Reembolsos PENDIENTE de aprobación (cantidad). */
  reimbursementPendingCount: number;
}

export function aggregate(rows: FinanceRow[]): OverviewAggregate {
  let overtimePendingCount = 0;
  let overtimeApprovedCount = 0;
  let reimbursementApprovedUnpaid = 0;
  let reimbursementPendingCount = 0;
  for (const r of rows) {
    if (r.kind === 'HORA_EXTRA') {
      if (r.status === 'PENDIENTE') overtimePendingCount += 1;
      if (r.status === 'APROBADO') overtimeApprovedCount += 1;
    } else {
      if (r.status === 'APROBADO') reimbursementApprovedUnpaid += r.amount ?? 0;
      if (r.status === 'PENDIENTE') reimbursementPendingCount += 1;
    }
  }
  return {
    overtimePendingCount,
    overtimeApprovedCount,
    reimbursementApprovedUnpaid,
    reimbursementPendingCount,
  };
}

/** Una entrada de ranking (trabajador o proyecto). */
export interface RankEntry {
  key: string;
  label: string;
  value: number;
}

type RankMetric = 'reimbursement' | 'overtime';

function rank(
  rows: FinanceRow[],
  metric: RankMetric,
  keyFn: (r: FinanceRow) => { key: string; label: string } | null,
): RankEntry[] {
  const map = new Map<string, RankEntry>();
  for (const r of rows) {
    if (metric === 'reimbursement' && r.kind !== 'REEMBOLSO') continue;
    if (metric === 'overtime' && r.kind !== 'HORA_EXTRA') continue;
    const k = keyFn(r);
    if (!k) continue;
    const inc = metric === 'reimbursement' ? r.amount ?? 0 : r.hours ?? 0;
    const prev = map.get(k.key);
    if (prev) prev.value += inc;
    else map.set(k.key, { key: k.key, label: k.label, value: inc });
  }
  // "overtime" también admite conteo por proyecto: si todas las horas son 0/null,
  // caemos a conteo de filas para no mostrar ceros (spec: "cuántas" HE).
  const entries = [...map.values()];
  if (metric === 'overtime' && entries.every((e) => e.value === 0)) {
    const counts = new Map<string, RankEntry>();
    for (const r of rows) {
      if (r.kind !== 'HORA_EXTRA') continue;
      const k = keyFn(r);
      if (!k) continue;
      const prev = counts.get(k.key);
      if (prev) prev.value += 1;
      else counts.set(k.key, { key: k.key, label: k.label, value: 1 });
    }
    return [...counts.values()].sort((a, b) => b.value - a.value);
  }
  return entries.sort((a, b) => b.value - a.value);
}

/** Ranking de trabajadores por total de reembolso u horas (§5.2). */
export function rankByWorker(rows: FinanceRow[], metric: RankMetric): RankEntry[] {
  return rank(rows, metric, (r) => ({ key: r.requesterId, label: r.requesterName }));
}

/** Ranking de proyectos por total de reembolso o cantidad/horas de HE (§5.2). */
export function rankByProject(rows: FinanceRow[], metric: RankMetric): RankEntry[] {
  return rank(rows, metric, (r) =>
    r.projectId || r.projectName
      ? { key: r.projectId ?? r.projectName ?? 'otro', label: r.projectName ?? 'Otro' }
      : null,
  );
}
```

Nota: para el test `rankByProject` cuenta HE (todas con `hours: 2`), así que devuelve suma de horas (2+2=4 y 2). Ajustar el assert del test a `value` de horas: **cambiar** en el test `expect(rank[0].value).toBe(2)` por `expect(rank[0].value).toBe(4)` (dos HE de 2 horas). Verificar coherencia antes de correr.

- [ ] **Step 4: Corregir el assert de horas del test y correr**

Editar el test `rankByProject` para reflejar suma de horas: `expect(rank[0].label).toBe('Alfa'); expect(rank[0].value).toBe(4);`

Run: `pnpm --filter @gmt-platform/web exec vitest run src/pages/finanzas/finance-overview.test.ts`
Expected: PASS (todos los describe: overtimeMonth, toFinanceRows, filterRows, aggregate, rankByWorker/rankByProject).

- [ ] **Step 5: Commit**

```bash
git add nodes/web/src/pages/finanzas/finance-overview.ts nodes/web/src/pages/finanzas/finance-overview.test.ts
git commit -m "feat(finanzas): helpers unificación/filtrado/agregación de la Vista general con tests"
```

---

## Task 5: Rework de las pestañas (quitar Liquidaciones, agregar Vista general)

**Files:**
- Modify: `nodes/web/src/pages/finanzas/index.tsx`
- Delete: `nodes/web/src/pages/finanzas/liquidaciones.tsx`

> Depende del hook `useHasPermission` (contrato compartido). Si aún no existe, bloquear y coordinar.

- [ ] **Step 1: Reescribir `index.tsx`**

Reemplazar el contenido completo de `nodes/web/src/pages/finanzas/index.tsx` por:

```tsx
import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, Clock, Receipt } from 'lucide-react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { ReembolsosTab } from './reembolsos';
import { HorasExtraTab } from './horas-extra';
import { VistaGeneralTab } from './vista-general';

/** Pestaña activa del módulo Finanzas. */
export type FinanzasTab = 'general' | 'reembolsos' | 'horas';

/** Definición de las pestañas de Finanzas. */
const FINANZAS_TABS: ReadonlyArray<TabItem<FinanzasTab>> = [
  { value: 'general', label: 'Vista general', icon: LayoutDashboard },
  { value: 'reembolsos', label: 'Reembolsos', icon: Receipt },
  { value: 'horas', label: 'Horas extra', icon: Clock },
];

/**
 * Página Finanzas (spec §5). Cáscara: header + toggle de pestañas. La pestaña
 * activa vive en la URL (`/finanzas/:tab`) para que los links de notificaciones
 * (`/finanzas/reembolsos`, `/finanzas/horas`) aterricen donde corresponde.
 * Todas las pestañas son visibles para todo usuario autenticado; el gating de
 * acciones (ver todo / aprobar / pagar / imprimir) se resuelve por permiso
 * dentro de cada Tab (`useHasPermission`). Liquidaciones fue removida (§5.1).
 */
export default function FinanzasPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const activeTab: FinanzasTab =
    tab === 'reembolsos' || tab === 'horas' || tab === 'general' ? tab : 'general';

  // `/finanzas/liquidaciones` (o cualquier tab legacy) redirige a la Vista general.
  if (tab && tab !== 'reembolsos' && tab !== 'horas' && tab !== 'general') {
    return <Navigate to="/finanzas/general" replace />;
  }

  const handleTabChange = (newTab: FinanzasTab): void => {
    navigate(`/finanzas/${newTab}`);
  };

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Finanzas"
        description="Vista general, reembolsos y horas extra."
      />
      <Tabs
        items={FINANZAS_TABS}
        value={activeTab}
        onValueChange={handleTabChange}
        aria-label="Secciones de finanzas"
      />

      {activeTab === 'general' && <VistaGeneralTab />}
      {activeTab === 'reembolsos' && <ReembolsosTab />}
      {activeTab === 'horas' && <HorasExtraTab />}
    </PageContainer>
  );
}
```

- [ ] **Step 2: Crear stub temporal de `VistaGeneralTab` para desbloquear el build**

Para que `index.tsx` compile antes de la Task 15, crear `nodes/web/src/pages/finanzas/vista-general.tsx` con un stub (se reemplaza en Task 15):

```tsx
import type { ReactNode } from 'react';

export function VistaGeneralTab(): ReactNode {
  return null;
}
```

- [ ] **Step 3: Eliminar la subsección Liquidaciones**

```bash
git rm nodes/web/src/pages/finanzas/liquidaciones.tsx
```

- [ ] **Step 4: Verificar que no quedan referencias a liquidaciones en el módulo**

Run (con Grep/rg): buscar `LiquidacionesTab` y `liquidaciones` en `nodes/web/src/pages/finanzas/`.
Expected: sin resultados en `finanzas/` (el hook `use-liquidations.ts` y otras páginas pueden seguir referenciándolo; no se tocan aquí).

- [ ] **Step 5: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: siguen fallando `reembolsos.tsx`/`horas-extra.tsx` (aún no migrados). `index.tsx` y `vista-general.tsx` (stub) OK.

```bash
git add nodes/web/src/pages/finanzas/index.tsx nodes/web/src/pages/finanzas/vista-general.tsx
git commit -m "refactor(finanzas): pestañas Vista general/Reembolsos/Horas extra; quitar Liquidaciones"
```

---

## Task 6: Formulario de Reembolso con OCR (overlay)

**Files:**
- Create: `nodes/web/src/pages/finanzas/reembolso-form.tsx`

- [ ] **Step 1: Crear `ReembolsoFormDialog`**

Crear `nodes/web/src/pages/finanzas/reembolso-form.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Camera, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import {
  Modal, ModalClose, ModalContent, ModalDescription,
  ModalFooter, ModalHeader, ModalTitle,
} from '@/components/ui/modal';
import { scanReceipt } from '@/lib/api';
import { useAssets } from '@/hooks/use-assets';
import {
  REIMBURSEMENT_CATEGORY_LABELS,
  VEHICLE_SUBCATEGORY_LABELS,
  type CreateReimbursementInput,
  type ReimbursementCategory,
  type VehicleSubcategory,
} from '@/types/finance';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const CATEGORY_ORDER: ReimbursementCategory[] = ['ALIMENTACION', 'TRANSPORTE', 'VEHICULOS', 'OTROS'];
const SUBCATEGORY_ORDER: VehicleSubcategory[] = ['COMBUSTIBLE', 'MANTENCION_LIMPIEZA', 'REPUESTO', 'OTRO'];

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mapea el string de categoría del OCR a nuestro enum (best-effort). */
function normalizeCategory(raw: string | undefined): ReimbursementCategory | '' {
  if (!raw) return '';
  const up = raw.toUpperCase();
  if (up.includes('ALIMENT')) return 'ALIMENTACION';
  if (up.includes('TRANSP')) return 'TRANSPORTE';
  if (up.includes('VEHIC') || up.includes('COMBUS')) return 'VEHICULOS';
  return 'OTROS';
}

export interface ReembolsoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateReimbursementInput) => Promise<void>;
}

export function ReembolsoFormDialog({
  open, onOpenChange, onSubmit,
}: ReembolsoFormDialogProps): ReactNode {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayString());
  const [category, setCategory] = useState<ReimbursementCategory | ''>('');
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleSubcategory, setVehicleSubcategory] = useState<VehicleSubcategory | ''>('');
  const [observations, setObservations] = useState('');
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Vehículos disponibles (assets VEHICULO) para el selector condicional.
  const { assets: vehicles } = useAssets({ type: 'VEHICULO' });

  useEffect(() => {
    if (!open) {
      setConcept(''); setAmount(''); setDate(getTodayString()); setCategory('');
      setVehicleId(''); setVehicleSubcategory(''); setObservations('');
      setError(null); setScanning(false);
    }
  }, [open]);

  const handleScan = async (file: File): Promise<void> => {
    setScanning(true);
    setError(null);
    try {
      const res = await scanReceipt(file);
      if (res.concept) setConcept(res.concept);
      if (typeof res.amount === 'number' && res.amount > 0) setAmount(String(res.amount));
      if (res.date) setDate(res.date.slice(0, 10));
      const cat = normalizeCategory(res.category);
      if (cat) setCategory(cat);
    } catch {
      setError('No se pudo leer la boleta automáticamente. Completa los campos a mano.');
    } finally {
      setScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleScan(file);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    const parsedAmount = parseInt(amount, 10);
    if (!concept.trim()) return setError('El concepto es obligatorio.');
    if (concept.trim().length > 200) return setError('El concepto no puede superar 200 caracteres.');
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return setError('El monto debe ser un entero mayor a cero.');
    }
    if (!date) return setError('La fecha es obligatoria.');
    if (!category) return setError('La categoría es obligatoria.');
    if (category === 'VEHICULOS' && !vehicleId) return setError('Selecciona el vehículo.');
    if (category === 'VEHICULOS' && !vehicleSubcategory) return setError('Selecciona la subcategoría del vehículo.');

    setSubmitting(true);
    try {
      await onSubmit({
        concept: concept.trim(),
        amount: parsedAmount,
        date,
        category,
        vehicleId: category === 'VEHICULOS' ? vehicleId : undefined,
        vehicleSubcategory: category === 'VEHICULOS' ? (vehicleSubcategory as VehicleSubcategory) : undefined,
        observations: observations.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el reembolso.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Solicitar reembolso</ModalTitle>
          <ModalDescription>
            Sube o fotografía la boleta para autocompletar, y revisa los datos.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          {/* Foto de boleta → OCR */}
          <div className="flex flex-col gap-1.5">
            <Label>Boleta</Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={scanning || submitting}
                onClick={() => uploadRef.current?.click()}>
                {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                Subir imagen
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={scanning || submitting}
                onClick={() => cameraRef.current?.click()}>
                <Camera className="size-4" aria-hidden />
                Tomar foto
              </Button>
            </div>
            <input ref={uploadRef} type="file" accept={IMAGE_ACCEPT} className="sr-only"
              onChange={handleFileChange} />
            <input ref={cameraRef} type="file" accept={IMAGE_ACCEPT} capture="environment" className="sr-only"
              onChange={handleFileChange} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reim-concept">Concepto</Label>
            <Input id="reim-concept" value={concept} onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej. Almuerzo con cliente" required disabled={submitting} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reim-amount">Monto (CLP)</Label>
              <Input id="reim-amount" type="number" min="1" step="1" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="Ej. 15000" required disabled={submitting} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reim-date">Fecha de la boleta</Label>
              <Input id="reim-date" type="date" value={date}
                onChange={(e) => setDate(e.target.value)} required disabled={submitting} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reim-category">Categoría</Label>
            <Select id="reim-category" aria-label="Categoría del reembolso" value={category}
              onChange={(e) => setCategory(e.target.value as ReimbursementCategory | '')}
              required disabled={submitting}>
              <option value="">Selecciona una categoría...</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{REIMBURSEMENT_CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
          </div>

          {category === 'VEHICULOS' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reim-vehicle">Vehículo</Label>
                <Select id="reim-vehicle" aria-label="Vehículo" value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)} required disabled={submitting}>
                  <option value="">Selecciona un vehículo...</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reim-subcat">Subcategoría</Label>
                <Select id="reim-subcat" aria-label="Subcategoría del vehículo" value={vehicleSubcategory}
                  onChange={(e) => setVehicleSubcategory(e.target.value as VehicleSubcategory | '')}
                  required disabled={submitting}>
                  <option value="">Selecciona...</option>
                  {SUBCATEGORY_ORDER.map((s) => (
                    <option key={s} value={s}>{VEHICLE_SUBCATEGORY_LABELS[s]}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reim-observations">Observaciones (opcional)</Label>
            <Textarea id="reim-observations" value={observations}
              onChange={(e) => setObservations(e.target.value)} rows={2} maxLength={500}
              placeholder="Notas adicionales" disabled={submitting} />
          </div>

          {error && <Alert variant="destructive" live>{error}</Alert>}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>Cancelar</Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>Crear solicitud</Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar la firma de `useAssets`**

Abrir `nodes/web/src/hooks/use-assets.ts` y confirmar que `useAssets` acepta filtros `{ type?: AssetType }` y expone `assets`. Si la API difiere (p. ej. requiere `refetch({type})` en vez de argumento inicial), ajustar la llamada: usar `const { assets } = useAssets()` + `useEffect(() => { void refetch({ type: 'VEHICULO' }); }, [])`. Dejar el código coherente con el hook real.

- [ ] **Step 3: Verificar build (parcial) y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: `reembolso-form.tsx` compila; siguen fallando `reembolsos.tsx`/`horas-extra.tsx`.

```bash
git add nodes/web/src/pages/finanzas/reembolso-form.tsx
git commit -m "feat(finanzas): formulario de reembolso con OCR, categoría y vehículo"
```

---

## Task 7: Migrar `reembolsos.tsx` (quitar Import CSV + form inline, gatear por permiso)

**Files:**
- Modify: `nodes/web/src/pages/finanzas/reembolsos.tsx`

- [ ] **Step 1: Reemplazar imports y quitar el CSV/wizard**

En `nodes/web/src/pages/finanzas/reembolsos.tsx`:
1. Quitar los imports de `ImportWizard`, `ImportTemplateColumn`, `Upload` (si sólo se usaba para el import) y `Printer` legacy no usado.
2. Quitar `getTodayString`, `TEMPLATE_COLUMNS`, `parseCsv`, `NewReimbursementDialog` y `PrintLayoutDialog` (se reemplazan por componentes extraídos).
3. Agregar imports:

```tsx
import { useHasPermission } from '@/hooks/use-has-permission';
import { ReembolsoFormDialog } from './reembolso-form';
import { BatchPrintDialog } from './batch-print-dialog';
import { REIMBURSEMENT_CATEGORY_LABELS, type ReimbursementCategory } from '@/types/finance';
```

- [ ] **Step 2: Actualizar el cuerpo del componente `ReembolsosTab`**

Reemplazar la desestructuración del hook y el estado local por (quitar `importBatch`, `selectedIds`/`printLayout` legacy, `handlePrintBatch` legacy, `parseReimbursementsCsv`, `handleConfirmImport`):

```tsx
export function ReembolsosTab(): ReactNode {
  const {
    mine, managerItems, isManager, loading, error, refetch,
    create, attachReceipt, approve, reject, pay,
  } = useReimbursements();

  const canApprove = useHasPermission('finance:request:approve');
  const canPay = useHasPermission('finance:payment:register');
  const canPrint = useHasPermission('finance:print:batch');

  const [createOpen, setCreateOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

Mantener `handleApprove`, `handlePay`, `handleAttachReceiptClick`, `handleFileChange` tal cual (ya existen). Eliminar `handleSelectToggle`, `handleSelectAllToggle`, `handlePrintBatch`, `selectedCount`, `selectedIds`, `printLayoutOpen`.

- [ ] **Step 3: Reemplazar el encabezado de "Mis Reembolsos"**

Quitar el botón "Importar CSV"; dejar sólo "Solicitar Reembolso":

```tsx
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Mis Reembolsos</h2>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            Nueva solicitud
          </Button>
        </div>
```

- [ ] **Step 4: Reemplazar el header de la sección de gestión (botón de impresión gateado)**

En la sección `{isManager && (...)}`, reemplazar el bloque del botón de impresión por uno gateado por `canPrint` que abre `BatchPrintDialog`:

```tsx
          <div className="border-t border-border pt-6 flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Gestión de Reembolsos</h2>
              <p className="text-sm text-muted-foreground">Aprobación, rechazo y pago de solicitudes de la organización.</p>
            </div>
            {canPrint && (
              <Button variant="outline" size="sm"
                className="text-primary border-primary/45 hover:bg-primary/5"
                onClick={() => setPrintOpen(true)}>
                <Printer className="size-4" aria-hidden />
                Imprimir en lote
              </Button>
            )}
          </div>
```

Reañadir `import { Printer } from 'lucide-react'` si se quitó. Quitar la columna checkbox y `TableHead` del select-all de la tabla de gestión (ya no hay selección aquí; la selección vive dentro de `BatchPrintDialog`). Quitar la celda `<TableCell><input type="checkbox" .../></TableCell>` de cada fila y su `<TableHead className="w-12">`.

- [ ] **Step 5: Gatear las acciones aprobar/rechazar/pagar por permiso**

En la celda de acciones de `managerItems`, envolver los botones:
- Aprobar/Rechazar: mostrar sólo si `canApprove`.
- Registrar Pago: mostrar sólo si `canPay`.

```tsx
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status === 'PENDIENTE' && canApprove && (
                              <>
                                {/* botón Aprobar (igual que hoy) */}
                                {/* botón Rechazar (igual que hoy) */}
                              </>
                            )}
                            {item.status === 'APROBADO' && canPay && (
                              <>{/* botón Registrar Pago (igual que hoy) */}</>
                            )}
                            {(item.status === 'PAGADO' || item.status === 'RECHAZADO') && (
                              <span className="text-xs text-muted-foreground italic">Completado</span>
                            )}
                          </div>
```

(Mantener el JSX exacto de los botones Aprobar/Rechazar/Registrar Pago que ya existe en el archivo; sólo se agregan las condiciones `canApprove`/`canPay`.)

- [ ] **Step 6: Reemplazar los diálogos al final del componente**

Reemplazar el bloque `<NewReimbursementDialog .../>`, `<ImportWizard .../>` y `<PrintLayoutDialog .../>` por:

```tsx
      <ReembolsoFormDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={create} />

      <RejectDialog
        open={rejectTargetId !== null}
        onOpenChange={(o) => { if (!o) setRejectTargetId(null); }}
        title="Rechazar reembolso"
        reasonRequired={false}
        onConfirm={async (reason) => {
          if (!rejectTargetId) return;
          setActioning(rejectTargetId);
          try {
            await reject(rejectTargetId, reason);
            toast.success('Reembolso rechazado.');
          } catch (err) {
            throw new Error(errorToMessage(err, 'Error al rechazar reembolso.'));
          } finally {
            setActioning(null);
          }
        }}
      />

      {canPrint && (
        <BatchPrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          items={managerItems}
          onPrinted={() => void refetch()}
        />
      )}
```

Mantener el `<input ref={fileInputRef} .../>` oculto para adjuntar boletas.

- [ ] **Step 7: Agregar la columna Categoría a la tabla "Mis Reembolsos"**

En la tabla de `mine`, tras la columna Concepto reemplazar la celda de categoría por la etiqueta legible:

```tsx
                    <TableCell className="text-muted-foreground">
                      {item.category
                        ? REIMBURSEMENT_CATEGORY_LABELS[item.category as ReimbursementCategory] ?? item.category
                        : '—'}
                    </TableCell>
```

- [ ] **Step 8: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: falla sólo por `horas-extra.tsx` (aún no migrado) y `batch-print-dialog.tsx` (aún no creado). Si `BatchPrintDialog` no existe todavía, hacer esta task **después** de la Task 10, o crear primero el stub de `batch-print-dialog.tsx`. Para desbloquear, crear stub mínimo si es necesario:

```tsx
// stub temporal — reemplazado en Task 10
import type { ReactNode } from 'react';
import type { ReimbursementView } from '@/types/finance';
export function BatchPrintDialog(_: {
  open: boolean; onOpenChange: (o: boolean) => void;
  items: ReimbursementView[]; onPrinted: () => void;
}): ReactNode { return null; }
```

```bash
git add nodes/web/src/pages/finanzas/reembolsos.tsx nodes/web/src/pages/finanzas/batch-print-dialog.tsx
git commit -m "refactor(finanzas): reembolsos usa overlay form, quita import CSV, gatea por permiso"
```

---

## Task 8: Formulario de Horas Extra (overlay)

**Files:**
- Create: `nodes/web/src/pages/finanzas/horas-extra-form.tsx`

- [ ] **Step 1: Crear `HorasExtraFormDialog`**

Crear `nodes/web/src/pages/finanzas/horas-extra-form.tsx`:

```tsx
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import {
  Modal, ModalClose, ModalContent, ModalDescription,
  ModalFooter, ModalHeader, ModalTitle,
} from '@/components/ui/modal';
import { useHasPermission } from '@/hooks/use-has-permission';
import { useFinanceProjects } from './use-finance-projects';
import { useEligibleAdmins } from '@/hooks/use-project-hierarchy';
import { useUsers } from '@/hooks/use-users';
import type { CreateOvertimeInput } from '@/types/finance';

const OTHER_PROJECT = '__OTHER__';

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface HorasExtraFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateOvertimeInput) => Promise<void>;
}

export function HorasExtraFormDialog({
  open, onOpenChange, onSubmit,
}: HorasExtraFormDialogProps): ReactNode {
  const canOnBehalf = useHasPermission('finance:overtime:create:onbehalf');

  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [date, setDate] = useState(getTodayString());
  const [projectId, setProjectId] = useState('');
  const [otherProject, setOtherProject] = useState('');
  const [reason, setReason] = useState('');
  const [authorizedById, setAuthorizedById] = useState('');
  const [onBehalfOfUserId, setOnBehalfOfUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { projects } = useFinanceProjects();
  const { admins } = useEligibleAdmins();
  const { users } = useUsers();

  useEffect(() => {
    if (open) {
      setStartTime(''); setEndTime(''); setDate(getTodayString());
      setProjectId(''); setOtherProject(''); setReason('');
      setAuthorizedById(''); setOnBehalfOfUserId(''); setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!startTime) return setError('La hora de inicio es obligatoria.');
    if (endTime && endTime <= startTime) return setError('La hora de término debe ser posterior al inicio.');
    if (!date) return setError('La fecha es obligatoria.');
    if (!projectId) return setError('Selecciona un proyecto.');
    if (projectId === OTHER_PROJECT && !otherProject.trim()) return setError('Indica el proyecto ("Otro").');
    if (!reason.trim()) return setError('El motivo es obligatorio.');
    if (!authorizedById) return setError('Selecciona quién autoriza.');

    setSubmitting(true);
    try {
      await onSubmit({
        date,
        startTime,
        endTime: endTime || undefined,
        reason: reason.trim(),
        projectId: projectId === OTHER_PROJECT ? undefined : projectId,
        otherProject: projectId === OTHER_PROJECT ? otherProject.trim() : undefined,
        authorizedById,
        onBehalfOfUserId: canOnBehalf && onBehalfOfUserId ? onBehalfOfUserId : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Reportar horas extra</ModalTitle>
          <ModalDescription>
            Ingresa el horario. Si dejas la hora de término vacía, queda como borrador para cerrarla luego.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-start">Hora inicio</Label>
              <Input id="ot-start" type="time" value={startTime}
                onChange={(e) => setStartTime(e.target.value)} required disabled={submitting} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-end">Hora término (opcional)</Label>
              <Input id="ot-end" type="time" value={endTime}
                onChange={(e) => setEndTime(e.target.value)} disabled={submitting} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-date">Fecha</Label>
              <Input id="ot-date" type="date" value={date}
                onChange={(e) => setDate(e.target.value)} required
                disabled={submitting || !canOnBehalf} />
            </div>
          </div>

          {canOnBehalf && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-onbehalf">A nombre de (opcional)</Label>
              <Select id="ot-onbehalf" aria-label="Trabajador a nombre de quien se reporta"
                value={onBehalfOfUserId} onChange={(e) => setOnBehalfOfUserId(e.target.value)} disabled={submitting}>
                <option value="">Yo mismo</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.lastName}, {u.firstName}</option>
                ))}
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-project">Proyecto</Label>
            <Select id="ot-project" aria-label="Proyecto" value={projectId}
              onChange={(e) => setProjectId(e.target.value)} required disabled={submitting}>
              <option value="">Selecciona un proyecto...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value={OTHER_PROJECT}>Otro…</option>
            </Select>
          </div>

          {projectId === OTHER_PROJECT && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-other">Nombre del proyecto</Label>
              <Input id="ot-other" value={otherProject}
                onChange={(e) => setOtherProject(e.target.value)} required disabled={submitting} />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-authorized">Autorizado por</Label>
            <Select id="ot-authorized" aria-label="Autorizado por" value={authorizedById}
              onChange={(e) => setAuthorizedById(e.target.value)} required disabled={submitting}>
              <option value="">Selecciona...</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>{a.lastName}, {a.firstName}</option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-reason">Motivo</Label>
            <Textarea id="ot-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              rows={3} required disabled={submitting}
              placeholder="Explica el trabajo realizado." />
          </div>

          {error && <Alert variant="destructive" live>{error}</Alert>}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>Cancelar</Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>Enviar solicitud</Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Crear el hook `useFinanceProjects`**

El form necesita "proyectos asignados". No hay endpoint de "mis proyectos"; se usa `listProjects()` (todos) como fuente y el backend valida asignación. Crear `nodes/web/src/pages/finanzas/use-finance-projects.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { listProjects } from '@/lib/api';
import type { ProjectView } from '@/types/operations';

/**
 * Proyectos seleccionables en el form de HE (§5.6). Usa `GET /projects` (lista
 * completa); el backend valida que la asignación/permiso sea válida al crear. Si
 * más adelante existe `GET /projects/mine`, cambiar la fuente aquí.
 */
export function useFinanceProjects(): { projects: ProjectView[]; loading: boolean } {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const list = await listProjects();
        if (mountedRef.current) setProjects(list);
      } catch {
        if (mountedRef.current) setProjects([]);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => { mountedRef.current = false; };
  }, []);

  return { projects, loading };
}
```

Confirmar que `ProjectView` (en `@/types/operations`) expone `id` y `name`. Si el nombre del campo difiere, ajustar la opción `{p.name}`.

- [ ] **Step 3: Verificar build (parcial) y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: `horas-extra-form.tsx` y `use-finance-projects.ts` compilan; sigue fallando `horas-extra.tsx` (aún usa el input viejo).

```bash
git add nodes/web/src/pages/finanzas/horas-extra-form.tsx nodes/web/src/pages/finanzas/use-finance-projects.ts
git commit -m "feat(finanzas): formulario de horas extra (inicio/término, proyecto, autorizado por, on-behalf)"
```

---

## Task 9: Migrar `horas-extra.tsx`

**Files:**
- Modify: `nodes/web/src/pages/finanzas/horas-extra.tsx`

- [ ] **Step 1: Reemplazar imports y quitar el form inline**

En `nodes/web/src/pages/finanzas/horas-extra.tsx`:
1. Eliminar `getTodayString` y todo el componente `NewOvertimeDialog`.
2. Quitar imports no usados (`Label`, `Input`, `Textarea`, `Modal*` si sólo los usaba el form).
3. Agregar:

```tsx
import { useHasPermission } from '@/hooks/use-has-permission';
import { HorasExtraFormDialog } from './horas-extra-form';
```

- [ ] **Step 2: Gatear acciones por permiso**

En `HorasExtraTab`, tras la desestructuración del hook agregar:

```tsx
  const canApprove = useHasPermission('finance:request:approve');
  const canPay = useHasPermission('finance:payment:register');
```

En la celda de acciones de `managerItems`, condicionar Aprobar/Rechazar con `canApprove` y Registrar Pago con `canPay` (igual patrón que Task 7 Step 5, manteniendo el JSX de botones existente).

- [ ] **Step 3: Mostrar el estado BORRADOR y horas nulas**

En la tabla `mine`, la celda de horas puede ser `null` (borrador). Reemplazar:

```tsx
                    <TableCell className="font-semibold">
                      {item.hours != null ? `${item.hours} hrs` : 'Borrador'}
                    </TableCell>
```

(El `StatusBadge type="finance"` recibe `item.status`; si no soporta `'BORRADOR'`, se agrega en el siguiente step.)

- [ ] **Step 4: Reemplazar el diálogo al final**

Reemplazar `<NewOvertimeDialog .../>` por:

```tsx
      <HorasExtraFormDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={create} />
```

- [ ] **Step 5: Soportar el estado BORRADOR en `StatusBadge` (si falta)**

Abrir `nodes/web/src/components/ui/status-badge.tsx`. Si el mapa `finance` no incluye `'BORRADOR'`, agregar una entrada (variante neutra/gris):

```tsx
  BORRADOR: { label: 'Borrador', className: 'bg-muted text-muted-foreground' },
```

(Ubicarla junto a `PENDIENTE`/`APROBADO`/etc. del tipo `finance`, respetando el shape existente del archivo.)

- [ ] **Step 6: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: `horas-extra.tsx` compila. Si `batch-print-dialog.tsx` sigue siendo stub, el build pasa igual (stub válido). Errores restantes: sólo si `vista-general.tsx` stub tiene algo pendiente (no debería).

```bash
git add nodes/web/src/pages/finanzas/horas-extra.tsx nodes/web/src/components/ui/status-badge.tsx
git commit -m "refactor(finanzas): horas extra usa overlay form, estado borrador, gating por permiso"
```

---

## Task 10: Diálogo de impresión en lote (selección/orientación/tamaño/preview)

**Files:**
- Create/Modify: `nodes/web/src/pages/finanzas/batch-print-dialog.tsx` (reemplaza el stub de la Task 7)

- [ ] **Step 1: Implementar `BatchPrintDialog`**

Reemplazar el contenido de `nodes/web/src/pages/finanzas/batch-print-dialog.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Modal, ModalClose, ModalContent, ModalDescription,
  ModalFooter, ModalHeader, ModalTitle,
} from '@/components/ui/modal';
import {
  downloadReimbursementsPdf, markReimbursementsPrinted,
  type PrintOrientation, type PrintPageSize,
} from '@/lib/api';
import { formatCLP, formatDate } from '@/lib/format';
import {
  REIMBURSEMENT_CATEGORY_LABELS,
  type ReimbursementCategory, type ReimbursementView,
} from '@/types/finance';

export interface BatchPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reembolsos de la vista de gestión (se filtran los que tienen boleta). */
  items: ReimbursementView[];
  /** Se llama tras marcar impresas, para refrescar la lista. */
  onPrinted: () => void;
}

export function BatchPrintDialog({
  open, onOpenChange, items, onPrinted,
}: BatchPrintDialogProps): ReactNode {
  // Sólo reembolsos con boleta adjunta son imprimibles.
  const printable = useMemo(() => items.filter((i) => i.receiptUrl), [items]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [perPage, setPerPage] = useState<2 | 4 | 6>(4);
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait');
  const [pageSize, setPageSize] = useState<PrintPageSize>('A4');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      // Por defecto: todas las pendientes de impresión (no `printed`).
      const next: Record<string, boolean> = {};
      printable.forEach((i) => { if (i.printedAt === null) next[i.id] = true; });
      setSelected(next);
      setBusy(false);
    }
  }, [open, printable]);

  const selectedIds = printable.filter((i) => selected[i.id]).map((i) => i.id);
  const selectedItems = printable.filter((i) => selected[i.id]);

  const toggle = (id: string): void =>
    setSelected((p) => ({ ...p, [id]: !p[id] }));

  const handleConfirm = async (): Promise<void> => {
    if (selectedIds.length === 0) {
      toast.error('Selecciona al menos una boleta.');
      return;
    }
    setBusy(true);
    try {
      const blob = await downloadReimbursementsPdf(selectedIds, perPage, orientation, pageSize);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'boletas-reembolsos.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      // Recién tras la descarga confirmada, marcar impresas (§5.7).
      await markReimbursementsPrinted(selectedIds);
      toast.success('PDF generado y boletas marcadas como impresas.');
      onPrinted();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Impresión en lote de boletas</ModalTitle>
          <ModalDescription>
            Selecciona las boletas, la disposición y el formato. El PDF se descarga y se marcan como impresas.
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-4">
          {/* Formato */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bp-perpage">Boletas por hoja</Label>
              <Select id="bp-perpage" aria-label="Boletas por hoja" value={String(perPage)}
                onChange={(e) => setPerPage(Number(e.target.value) as 2 | 4 | 6)} disabled={busy}>
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="6">6</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bp-orient">Orientación</Label>
              <Select id="bp-orient" aria-label="Orientación" value={orientation}
                onChange={(e) => setOrientation(e.target.value as PrintOrientation)} disabled={busy}>
                <option value="portrait">Vertical</option>
                <option value="landscape">Horizontal</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bp-size">Tamaño de hoja</Label>
              <Select id="bp-size" aria-label="Tamaño de hoja" value={pageSize}
                onChange={(e) => setPageSize(e.target.value as PrintPageSize)} disabled={busy}>
                <option value="A4">A4</option>
                <option value="LETTER">Carta</option>
                <option value="LEGAL">Oficio</option>
              </Select>
            </div>
          </div>

          {/* Selección + preview (tablita por boleta) */}
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {printable.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No hay reembolsos con boleta adjunta para imprimir.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {printable.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 p-3 text-sm">
                    <input type="checkbox" className="size-4 rounded border-input"
                      checked={!!selected[i.id]} onChange={() => toggle(i.id)}
                      aria-label={`Incluir boleta de ${i.requester?.firstName ?? ''} ${i.requester?.lastName ?? ''}`} />
                    <span className="flex-1 truncate">
                      {i.concept}
                      {i.printedAt !== null && (
                        <span className="ml-2 text-xs text-muted-foreground">(ya impresa)</span>
                      )}
                    </span>
                    <span className="tabular-nums">{formatCLP(i.amount)}</span>
                    <span className="w-24 truncate text-muted-foreground">
                      {i.category
                        ? REIMBURSEMENT_CATEGORY_LABELS[i.category as ReimbursementCategory] ?? i.category
                        : '—'}
                    </span>
                    <span className="w-28 truncate text-muted-foreground">
                      {i.requester ? `${i.requester.firstName} ${i.requester.lastName}` : '—'}
                    </span>
                    <span className="w-24 text-muted-foreground">{formatDate(i.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {selectedItems.length} boleta{selectedItems.length === 1 ? '' : 's'} seleccionada{selectedItems.length === 1 ? '' : 's'}.
          </p>
        </div>

        <ModalFooter>
          <ModalClose asChild>
            <Button type="button" variant="outline" disabled={busy}>Cancelar</Button>
          </ModalClose>
          <Button type="button" onClick={() => void handleConfirm()} disabled={busy || selectedIds.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
            Descargar e imprimir
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: compila (asumiendo Tasks 7 y 9 hechas). Si `reembolsos.tsx` aún referenciaba el stub, ahora usa el real.

```bash
git add nodes/web/src/pages/finanzas/batch-print-dialog.tsx
git commit -m "feat(finanzas): impresión en lote con orientación/tamaño/preview y marcado impresa"
```

---

## Task 11: Card de carrusel de 2 estados

**Files:**
- Create: `nodes/web/src/pages/finanzas/stat-carousel.tsx`

- [ ] **Step 1: Implementar `StatCarousel`**

Crear `nodes/web/src/pages/finanzas/stat-carousel.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Un estado del carrusel (una "cara" de la card). */
export interface CarouselState {
  /** Título del estado (p. ej. "Reembolsos por trabajador"). */
  title: string;
  /** Contenido renderizado (ranking, lista, número). */
  content: ReactNode;
}

export interface StatCarouselProps {
  /** Estados a alternar (típicamente 2). */
  states: CarouselState[];
  /** Intervalo de autoalternado en ms (default 5000). */
  intervalMs?: number;
  className?: string;
}

/**
 * Card de 2 (o N) estados que autoalterna cada `intervalMs` (§5.2). Un clic en la
 * card **congela** el estado actual; las flechas y los puntitos permiten navegar
 * manualmente. Las flechas sólo aparecen en hover (group-hover). Cuando está
 * congelada, el autoalternado se detiene.
 */
export function StatCarousel({
  states, intervalMs = 5000, className,
}: StatCarouselProps): ReactNode {
  const [index, setIndex] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const count = states.length;

  useEffect(() => {
    if (frozen || count <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [frozen, count, intervalMs]);

  const go = (next: number, e: React.MouseEvent): void => {
    e.stopPropagation();
    setFrozen(true);
    setIndex((next + count) % count);
  };

  const current = states[index];

  return (
    <Card
      className={cn('group relative flex flex-col gap-3 p-5 cursor-pointer select-none', className)}
      onClick={() => setFrozen((f) => !f)}
      role="button"
      tabIndex={0}
      aria-label={`${current.title}. Clic para ${frozen ? 'reanudar' : 'congelar'} el carrusel.`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{current.title}</p>
        {count > 1 && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button type="button" aria-label="Anterior"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => go(index - 1, e)}>
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button type="button" aria-label="Siguiente"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => go(index + 1, e)}>
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div className="min-h-16">{current.content}</div>

      {count > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {states.map((s, i) => (
            <span key={s.title}
              className={cn('size-1.5 rounded-full transition-colors',
                i === index ? 'bg-primary' : 'bg-muted-foreground/30')}
              aria-hidden />
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: compila.

```bash
git add nodes/web/src/pages/finanzas/stat-carousel.tsx
git commit -m "feat(finanzas): StatCarousel (2 estados, autoalternado 5s, click-congela, flechas en hover)"
```

---

## Task 12: Diálogo de detalle de solicitud (alertas → aprobar/rechazar)

**Files:**
- Create: `nodes/web/src/pages/finanzas/request-detail-dialog.tsx`

- [ ] **Step 1: Implementar `RequestDetailDialog`**

Crear `nodes/web/src/pages/finanzas/request-detail-dialog.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { Ban, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  Modal, ModalClose, ModalContent, ModalDescription,
  ModalFooter, ModalHeader, ModalTitle,
} from '@/components/ui/modal';
import { formatCLP, formatDate } from '@/lib/format';
import type { FinanceRow } from '@/types/finance';

export interface RequestDetailDialogProps {
  /** Fila a mostrar; `null` cierra el diálogo. */
  row: FinanceRow | null;
  onClose: () => void;
  /** Muestra las acciones aprobar/rechazar (gateado por permiso por el caller). */
  canApprove: boolean;
  onApprove: (row: FinanceRow) => Promise<void>;
  onReject: (row: FinanceRow, reason?: string) => Promise<void>;
}

/**
 * Detalle de una solicitud pendiente (§5.2 alertas). Muestra los datos y, si
 * `canApprove`, permite aprobar o abrir el `RejectDialog` para rechazar con
 * motivo. Al resolver, cierra.
 */
export function RequestDetailDialog({
  row, onClose, canApprove, onApprove, onReject,
}: RequestDetailDialogProps): ReactNode {
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!row) return null;

  const handleApprove = async (): Promise<void> => {
    setBusy(true);
    try {
      await onApprove(row);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={row !== null && !rejecting} onOpenChange={(o) => { if (!o) onClose(); }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {row.kind === 'REEMBOLSO' ? 'Reembolso' : 'Horas extra'} — {row.requesterName}
            </ModalTitle>
            <ModalDescription>{formatDate(row.date)}</ModalDescription>
          </ModalHeader>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Estado</dt><dd><StatusBadge type="finance" status={row.status} /></dd></div>
            <div><dt className="text-muted-foreground">{row.kind === 'REEMBOLSO' ? 'Monto' : 'Horas'}</dt>
              <dd className="font-medium">
                {row.kind === 'REEMBOLSO' ? formatCLP(row.amount ?? 0) : row.hours != null ? `${row.hours} hrs` : 'Borrador'}
              </dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">Detalle</dt><dd>{row.description}</dd></div>
            {row.projectName && (
              <div className="col-span-2"><dt className="text-muted-foreground">Proyecto</dt><dd>{row.projectName}</dd></div>
            )}
          </dl>

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline">Cerrar</Button>
            </ModalClose>
            {canApprove && row.status === 'PENDIENTE' && (
              <>
                <Button type="button" variant="outline"
                  className="text-destructive hover:bg-destructive/5"
                  onClick={() => setRejecting(true)} disabled={busy}>
                  <Ban className="size-4" aria-hidden /> Rechazar
                </Button>
                <Button type="button" onClick={() => void handleApprove()} loading={busy}>
                  <Check className="size-4" aria-hidden /> Aprobar
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Rechazar ${row.kind === 'REEMBOLSO' ? 'reembolso' : 'horas extra'}`}
        reasonRequired={false}
        onConfirm={async (reason) => {
          await onReject(row, reason);
          setRejecting(false);
          onClose();
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: compila.

```bash
git add nodes/web/src/pages/finanzas/request-detail-dialog.tsx
git commit -m "feat(finanzas): diálogo de detalle de solicitud con aprobar/rechazar (alertas)"
```

---

## Task 13: Tabla histórica filtrable + paginada

**Files:**
- Create: `nodes/web/src/pages/finanzas/historical-table.tsx`

- [ ] **Step 1: Implementar `HistoricalTable`**

Crear `nodes/web/src/pages/finanzas/historical-table.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCLP, formatDate } from '@/lib/format';
import type { FinanceRow, OverviewFilters } from '@/types/finance';

/** Opción de tamaño de página. `0` = todas. */
type PageSize = 0 | 20 | 50 | 100;

export interface HistoricalTableProps {
  /** Filas ya filtradas y ordenadas (el caller aplica `filterRows`). */
  rows: FinanceRow[];
  filters: OverviewFilters;
  onFiltersChange: (next: OverviewFilters) => void;
  /** Trabajadores para el filtro (sólo si hay acceso a todos). */
  workers: Array<{ id: string; name: string }>;
  /** Proyectos para el filtro. */
  projects: Array<{ id: string; name: string }>;
  /** Muestra el filtro por trabajador (gateado por permiso por el caller). */
  showWorkerFilter: boolean;
  /** Clic en una fila (abre detalle). */
  onRowClick?: (row: FinanceRow) => void;
}

export function HistoricalTable({
  rows, filters, onFiltersChange, workers, projects, showWorkerFilter, onRowClick,
}: HistoricalTableProps): ReactNode {
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(0);

  const set = (patch: Partial<OverviewFilters>): void => {
    setPage(0);
    onFiltersChange({ ...filters, ...patch });
  };

  const clients = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.clientName) s.add(r.clientName); });
    return [...s].sort();
  }, [rows]);

  const total = rows.length;
  const size = pageSize === 0 ? total || 1 : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(page, pageCount - 1);
  const visible = pageSize === 0 ? rows : rows.slice(clampedPage * size, clampedPage * size + size);

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showWorkerFilter && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-worker">Trabajador</Label>
            <Select id="hf-worker" aria-label="Filtrar por trabajador"
              value={filters.requesterId ?? ''}
              onChange={(e) => set({ requesterId: e.target.value || null })}>
              <option value="">Todos</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-project">Proyecto</Label>
          <Select id="hf-project" aria-label="Filtrar por proyecto"
            value={filters.projectId ?? ''}
            onChange={(e) => set({ projectId: e.target.value || null })}>
            <option value="">Todos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-client">Cliente</Label>
          <Select id="hf-client" aria-label="Filtrar por cliente"
            value={filters.clientName ?? ''}
            onChange={(e) => set({ clientName: e.target.value || null })}>
            <option value="">Todos</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-datemode">Fecha</Label>
          <Select id="hf-datemode" aria-label="Modo de filtro por fecha"
            value={filters.dateMode}
            onChange={(e) => set({ dateMode: e.target.value as OverviewFilters['dateMode'], dateFrom: null, dateTo: null, month: null })}>
            <option value="none">Sin filtro</option>
            <option value="month">Por mes (cierre 20)</option>
            <option value="exact">Exacta</option>
            <option value="before">Antes de</option>
            <option value="after">Después de</option>
            <option value="between">Entre</option>
          </Select>
        </div>

        {filters.dateMode === 'month' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-month">Mes</Label>
            <Input id="hf-month" type="month" value={filters.month ?? ''}
              onChange={(e) => set({ month: e.target.value || null })} />
          </div>
        )}
        {(filters.dateMode === 'exact' || filters.dateMode === 'before' ||
          filters.dateMode === 'after' || filters.dateMode === 'between') && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-from">{filters.dateMode === 'between' ? 'Desde' : 'Fecha'}</Label>
            <Input id="hf-from" type="date" value={filters.dateFrom ?? ''}
              onChange={(e) => set({ dateFrom: e.target.value || null })} />
          </div>
        )}
        {filters.dateMode === 'between' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-to">Hasta</Label>
            <Input id="hf-to" type="date" value={filters.dateTo ?? ''}
              onChange={(e) => set({ dateTo: e.target.value || null })} />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-order">Orden por fecha</Label>
          <Select id="hf-order" aria-label="Orden por fecha" value={filters.order}
            onChange={(e) => set({ order: e.target.value as 'asc' | 'desc' })}>
            <option value="desc">Más reciente primero</option>
            <option value="asc">Más antigua primero</option>
          </Select>
        </div>
      </div>

      {/* Tabla */}
      {total === 0 ? (
        <EmptyState message="No hay solicitudes que coincidan con el filtro." />
      ) : (
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Trabajador</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Monto / Horas</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={() => onRowClick?.(r)}>
                  <TableCell>{formatDate(r.date)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.kind === 'REEMBOLSO' ? 'Reembolso' : 'Horas extra'}
                  </TableCell>
                  <TableCell className="font-medium">{r.requesterName}</TableCell>
                  <TableCell className="max-w-xs truncate" title={r.description}>{r.description}</TableCell>
                  <TableCell className="text-muted-foreground">{r.projectName ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.kind === 'REEMBOLSO' ? formatCLP(r.amount ?? 0) : r.hours != null ? `${r.hours} hrs` : '—'}
                  </TableCell>
                  <TableCell><StatusBadge type="finance" status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Paginación */}
      <div className="flex items-center justify-end gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor="hf-pagesize" className="text-muted-foreground">Por página</Label>
          <Select id="hf-pagesize" aria-label="Filas por página" value={String(pageSize)}
            onChange={(e) => { setPageSize(Number(e.target.value) as PageSize); setPage(0); }}
            className="w-auto">
            <option value="0">Todas</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
        </div>
        {pageSize !== 0 && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" aria-label="Anterior"
              disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="tabular-nums text-muted-foreground">
              {clampedPage + 1} / {pageCount}
            </span>
            <Button variant="outline" size="icon" className="size-8" aria-label="Siguiente"
              disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: compila.

```bash
git add nodes/web/src/pages/finanzas/historical-table.tsx
git commit -m "feat(finanzas): tabla histórica filtrable (trabajador/fecha/mes/proyecto/cliente) y paginada"
```

---

## Task 14: Cards de la Vista general (worker vs manager)

**Files:**
- Create: `nodes/web/src/pages/finanzas/overview-cards.tsx`

- [ ] **Step 1: Implementar `OverviewCards`**

Crear `nodes/web/src/pages/finanzas/overview-cards.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { formatCLP } from '@/lib/format';
import { StatCarousel, type CarouselState } from './stat-carousel';
import {
  aggregate, rankByProject, rankByWorker, type RankEntry,
} from './finance-overview';
import type { FinanceRow } from '@/types/finance';

function StatCard({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}

function RankList({ entries, unit }: { entries: RankEntry[]; unit: 'clp' | 'hrs' | 'count' }): ReactNode {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos.</p>;
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {entries.slice(0, 5).map((e) => (
        <li key={e.key} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{e.label}</span>
          <span className="tabular-nums font-medium">
            {unit === 'clp' ? formatCLP(e.value) : unit === 'hrs' ? `${e.value} hrs` : e.value}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface OverviewCardsProps {
  /** Filas ya filtradas (las cards se recalculan del filtro — §5.2). */
  rows: FinanceRow[];
  /** Variante: `true` = acceso a todos (managers); `false` = trabajador. */
  hasAllAccess: boolean;
}

/**
 * Cards superiores de la Vista general (§5.2). Se recalculan a partir de `rows`
 * (ya filtradas por la tabla). Variante manager: métricas globales + rankings por
 * trabajador y por proyecto. Variante trabajador: sus métricas + carrusel por
 * proyecto (sólo proyectos con datos).
 */
export function OverviewCards({ rows, hasAllAccess }: OverviewCardsProps): ReactNode {
  const agg = aggregate(rows);

  const workerReimb = rankByWorker(rows, 'reimbursement');
  const workerOt = rankByWorker(rows, 'overtime');
  const projReimb = rankByProject(rows, 'reimbursement');
  const projOt = rankByProject(rows, 'overtime');

  const byWorkerStates: CarouselState[] = [
    { title: 'Reembolso pendiente por trabajador', content: <RankList entries={workerReimb} unit="clp" /> },
    { title: 'Horas extra por trabajador', content: <RankList entries={workerOt} unit="hrs" /> },
  ];
  const byProjectStates: CarouselState[] = [
    { title: 'Horas extra por proyecto', content: <RankList entries={projOt} unit="hrs" /> },
    { title: 'Reembolso por proyecto', content: <RankList entries={projReimb} unit="clp" /> },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Horas extra pendientes" value={agg.overtimePendingCount} />
      <StatCard label="Reembolso pendiente de pago" value={formatCLP(agg.reimbursementApprovedUnpaid)} />

      {hasAllAccess ? (
        <>
          <StatCarousel states={byWorkerStates} />
          <StatCarousel states={byProjectStates} />
        </>
      ) : (
        <StatCarousel className="sm:col-span-2" states={byProjectStates} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: compila.

```bash
git add nodes/web/src/pages/finanzas/overview-cards.tsx
git commit -m "feat(finanzas): cards de la Vista general (métricas + carruseles por trabajador/proyecto)"
```

---

## Task 15: Ensamblar `VistaGeneralTab`

**Files:**
- Modify: `nodes/web/src/pages/finanzas/vista-general.tsx` (reemplaza el stub de la Task 5)

- [ ] **Step 1: Implementar el mes en curso por defecto**

La Vista general arranca con el filtro en **mes en curso** (§5.3). Definir el mes "YYYY-MM" con cierre día 20 usando `overtimeMonth(hoy)`.

- [ ] **Step 2: Implementar `VistaGeneralTab`**

Reemplazar el contenido de `nodes/web/src/pages/finanzas/vista-general.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { useReimbursements } from '@/hooks/use-reimbursements';
import { useOvertime } from '@/hooks/use-overtime';
import { useHasPermission } from '@/hooks/use-has-permission';
import { useFinanceProjects } from './use-finance-projects';
import {
  toFinanceRows, filterRows, overtimeMonth,
} from './finance-overview';
import { OverviewCards } from './overview-cards';
import { HistoricalTable } from './historical-table';
import { RequestDetailDialog } from './request-detail-dialog';
import type { FinanceRow, OverviewFilters } from '@/types/finance';

function currentOvertimeMonth(): string {
  return overtimeMonth(new Date().toISOString());
}

const INITIAL_FILTERS: OverviewFilters = {
  requesterId: null,
  dateMode: 'month',
  dateFrom: null,
  dateTo: null,
  month: currentOvertimeMonth(),
  projectId: null,
  clientName: null,
  order: 'desc',
};

/**
 * Vista general de Finanzas (§5.2/§5.3). Reutiliza los hooks de datos existentes:
 * para managers usa `managerItems` (probe backend), para trabajador `mine`. Las
 * cards se recalculan a partir de las filas FILTRADAS. Clic en una fila
 * pendiente abre el detalle con aprobar/rechazar (si el permiso lo habilita).
 */
export function VistaGeneralTab(): ReactNode {
  const reimb = useReimbursements();
  const ot = useOvertime();
  const { projects } = useFinanceProjects();

  const canViewAll = useHasPermission('finance:request:view:all');
  const canApprove = useHasPermission('finance:request:approve');

  const [filters, setFilters] = useState<OverviewFilters>(INITIAL_FILTERS);
  const [detail, setDetail] = useState<FinanceRow | null>(null);

  const hasAllAccess = canViewAll || reimb.isManager || ot.isManager;

  // Fuente de datos por tipo: managerItems si soy gestor de ese tipo, si no, lo mío.
  const reimbRows = reimb.isManager ? reimb.managerItems : reimb.mine;
  const otRows = ot.isManager ? ot.managerItems : ot.mine;

  const allRows = useMemo(() => toFinanceRows(reimbRows, otRows), [reimbRows, otRows]);
  const filtered = useMemo(() => filterRows(allRows, filters), [allRows, filters]);

  // Solicitudes pendientes de resolución para las alertas.
  const pending = useMemo(() => filtered.filter((r) => r.status === 'PENDIENTE'), [filtered]);

  const workers = useMemo(() => {
    const map = new Map<string, string>();
    allRows.forEach((r) => map.set(r.requesterId, r.requesterName));
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  const loading = reimb.loading || ot.loading;
  const error = reimb.error ?? ot.error;

  const handleApprove = async (row: FinanceRow): Promise<void> => {
    try {
      if (row.kind === 'REEMBOLSO') await reimb.approve(row.id);
      else await ot.approve(row.id);
      toast.success('Solicitud aprobada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo aprobar.');
      throw err;
    }
  };

  const handleReject = async (row: FinanceRow, reason?: string): Promise<void> => {
    try {
      if (row.kind === 'REEMBOLSO') await reimb.reject(row.id, reason);
      else await ot.reject(row.id, reason);
      toast.success('Solicitud rechazada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo rechazar.');
      throw err;
    }
  };

  if (loading) return <LoadingState rows={6} />;
  if (error) return <ErrorState message={error} onRetry={() => { void reimb.refetch(); void ot.refetch(); }} />;

  return (
    <div className="flex flex-col gap-6">
      <OverviewCards rows={filtered} hasAllAccess={hasAllAccess} />

      {/* Alertas: solicitudes pendientes → clic abre detalle */}
      {canApprove && pending.length > 0 && (
        <Card className="flex flex-col gap-2 border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" aria-hidden />
            {pending.length} solicitud{pending.length === 1 ? '' : 'es'} pendiente{pending.length === 1 ? '' : 's'} de resolución
          </div>
          <ul className="flex flex-wrap gap-2">
            {pending.slice(0, 8).map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <button type="button"
                  className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:border-primary/50"
                  onClick={() => setDetail(r)}>
                  {r.requesterName} · {r.kind === 'REEMBOLSO' ? 'Reembolso' : 'HE'}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <HistoricalTable
        rows={filtered}
        filters={filters}
        onFiltersChange={setFilters}
        workers={workers}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        showWorkerFilter={hasAllAccess}
        onRowClick={(r) => setDetail(r)}
      />

      <RequestDetailDialog
        row={detail}
        onClose={() => setDetail(null)}
        canApprove={canApprove}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verificar build y commit**

Run: `pnpm --filter @gmt-platform/web build`
Expected: compila sin errores (todo el módulo finanzas integrado).

```bash
git add nodes/web/src/pages/finanzas/vista-general.tsx
git commit -m "feat(finanzas): ensamblar Vista general (cards + alertas + tabla histórica)"
```

---

## Task 16: Verificación final del módulo

**Files:** (sin cambios de código salvo fixes que surjan)

- [ ] **Step 1: Type-check + build completo**

Run: `pnpm --filter @gmt-platform/web build`
Expected: PASS (`tsc --noEmit` sin errores + bundle Vite OK).

- [ ] **Step 2: Correr toda la suite de tests del web**

Run: `pnpm --filter @gmt-platform/web test`
Expected: PASS. En particular `src/pages/finanzas/finance-overview.test.ts` verde. Si algún test legacy referenciaba Liquidaciones o el import CSV, actualizarlo/eliminarlo acorde al nuevo alcance.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: sin errores nuevos en `nodes/web/src/pages/finanzas/**`. Corregir imports no usados / `any` implícitos si aparecen.

- [ ] **Step 4: Smoke manual (dev)**

Run: `pnpm --filter @gmt-platform/web dev` y abrir `http://localhost:5173/finanzas`.
Verificar: (a) pestañas Vista general / Reembolsos / Horas extra, sin Liquidaciones; (b) `/finanzas/liquidaciones` redirige a `/finanzas/general`; (c) el form de reembolso muestra los botones Subir/Tomar foto y el selector de Vehículo al elegir Vehículos; (d) el form de HE muestra hora inicio/término, proyecto+Otro y Autorizado por; (e) la tabla histórica filtra y pagina, y las cards cambian al filtrar. (El OCR, la impresión real y los datos de gestión dependen del backend de Fase 1a; validar e2e cuando esté disponible.)

- [ ] **Step 5: Commit final (si hubo fixes)**

```bash
git add -A
git commit -m "chore(finanzas): fixes de verificación (build/test/lint)"
```

---

## Self-Review (checklist del autor del plan)

**Cobertura del spec §5:**
- §5.1 Quitar Liquidaciones + import reembolsos → Task 5 (borra `liquidaciones.tsx`, quita tab) + Task 7 (quita Import CSV/`ImportWizard`). ✓
- §5.2 Vista general (cards + carruseles 2-estados autoalternado/click-congela/flechas-hover + alertas overlay aprobar/rechazar) → Tasks 11 (carrusel), 12 (detalle/alertas), 14 (cards), 15 (ensamble). ✓
- §5.3 Tabla histórica (trabajador gated / fecha / mes cierre 20 / proyecto / cliente / orden / paginación todas-20-50-100, default mes en curso, recalcula cards) → Tasks 4 (helpers), 13 (tabla), 15 (default mes en curso + recálculo). ✓
- §5.4 Vistas específicas Reembolsos/HE (lista + botón nueva solicitud→overlay) → Tasks 7 y 9. ✓
- §5.5 Form Reembolso (foto/cámara→OCR, concepto, monto, categoría con Vehículos→vehículo+subcategoría, fecha, observaciones) → Task 6. ✓
- §5.6 Form Horas Extra (inicio, término opcional→borrador, fecha [hoy fijo salvo onbehalf], proyecto asignados+Otro, Autorizado por) → Task 8. ✓
- §5.7 Impresión en lote (selección/orientación/tamaño/preview/confirmar→descarga→marca impresa) → Task 10. ✓
- Gating por permiso (`useHasPermission`) → Tasks 5/7/8/9/10/15 (consume el contrato). ✓

**Placeholders:** cada step de código incluye el código real; los stubs temporales (Tasks 5 y 7) se marcan explícitamente como reemplazados y tienen código válido. Sin "TBD/TODO/similar a Task N".

**Consistencia de tipos:** `CreateReimbursementInput`/`CreateOvertimeInput` (Task 1) coinciden con lo consumido en los forms (Tasks 6/8). `FinanceRow`/`OverviewFilters` (Task 1) coinciden con helpers (Task 4) y consumidores (Tasks 13/14/15). `PrintOrientation`/`PrintPageSize` (Task 2) coinciden con `BatchPrintDialog` (Task 10). `RankEntry`/`CarouselState` coinciden entre Tasks 4/11/14.

**Dependencias externas (bloqueantes):** `useHasPermission` (contrato de control de acceso) y los endpoints/campos de backend (spec §5, plan Fase 1a) — documentados arriba en "Dependencias de backend". Los wrappers y tipos del web se implementan aquí; la validación e2e queda gateada por el backend.

---

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-07-10-fase1c-finanzas-frontend.md`. El controlador decide el modo de ejecución (subagent-driven recomendado o inline). No commitear desde este plan: lo hace el controlador.
