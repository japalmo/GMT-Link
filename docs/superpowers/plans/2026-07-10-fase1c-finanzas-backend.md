# Fase 1c — Finanzas Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer el backend de Finanzas de GMT Link (reembolsos + horas extra) según el spec §5/§2.4: campos nuevos de dominio, reglas de negocio (fecha de HE, cierre mes día 20, on-behalf, borrador), OCR de boletas, gating por permiso funcional, impresión en lote con soporte R2, y agregaciones para las cards.

**Architecture:** NestJS + Prisma sobre Postgres único. Se extienden (aditivamente, retrocompatible) los modelos `Reimbursement` y `OvertimeRequest`. La lógica de estado sigue en `finance-status.util` (sin cambios). El gating de finanzas migra de FGA `can_manage_finance` (via `@RequirePermission`) a `PermissionService.can(userId, key)` **inline** en cada endpoint (patrón `ClientsController`), consumiendo el contrato compartido de permisos (spec §2, sembrados por el plan de roles). Las reglas puras (cierre de mes, cómputo de horas, parseo OCR, agregaciones) viven en utils testeables por unidad; la red NVIDIA se aísla en el service.

**Tech Stack:** NestJS 11 · Prisma 6 (`@prisma/client`) · Postgres · pdf-lib · `@nestjs/config` (global) · NVIDIA NIM visión (`common/nvidia.ts`) · Vitest (`test/`).

---

## Contrato compartido (NO redefinir aquí)

- **Permisos y bundles por rol**: definidos en el spec §2.2/§2.3 y **sembrados por el plan de roles** (`prisma/seed.ts`). Este plan **consume** las claves; no las crea. Claves usadas: `finance:request:create`, `finance:overtime:create:onbehalf`, `finance:request:view:all`, `finance:overtime:view:all`, `finance:request:approve`, `finance:payment:register`, `finance:print:batch`.
- **Decisión de acceso**: `PermissionService.can(userId, key)` → `{ effect: 'allow' | 'deny', filter }` (ver `packages/contracts/src/index.ts:132`). SuperAdmin y scope GLOBAL cortocircuitan a `allow`. Este plan usa **solo** `effect` (sin `ResourceRef`): los permisos de finanzas son GLOBAL en esta fase (spec §2.3).
- **`GET /auth/me` → `permissions:string[]` y `useHasPermission`**: pertenecen al plan de auth/roles y al frontend. Este backend **no** los toca; solo garantiza que los endpoints decidan por `PermissionService.can`.

**Dependencia dura:** los tests de gating a nivel controller mockean `PermissionService`; los tests de reglas de negocio viven en el service/util y **no** dependen del seed. La verificación e2e real (con permisos sembrados) ocurre en Fase 1b/1c.

---

## Decisiones de diseño (cerradas para este plan)

1. **Import de reembolsos (`POST /reimbursements/import`, `importBatch`)**: el spec §5.1 lo quita de la UI. El **botón** lo elimina el plan de frontend. El backend **conserva** el endpoint/servicio (retrocompatibilidad: `web` (prod) aún desplegada podría invocarlo). No se toca en este plan. YAGNI: no se borra código vivo mientras haya un cliente desplegado.
2. **Liquidaciones**: el spec §5.1 dice "el backend `liquidations` se deja pero se desconecta de la UI". La desconexión es de frontend/módulos. **Sin trabajo de backend** aquí.
3. **Fix R2 de impresión (spec §5.5/§5.7)**: la causa raíz es que `R2StorageService.save()` devuelve una **URL firmada** (expira, y no tiene el prefijo `/files/`), por lo que `extractStorageKey` retorna `null` y la boleta nunca entra al PDF. **Fix:** persistir la `key` estable del storage en una columna nueva `Reimbursement.receiptKey` (poblada desde `saved.key` al subir). `generateBatchPdf` usa `row.receiptKey ?? extractStorageKey(row.receiptUrl)` (fallback para filas viejas). Además se endurece `extractStorageKey` para tolerar querystring. Esto hace la impresión correcta con R2 **y** con local, sin depender de URLs que expiran.
4. **Borrador de HE**: se modela como `OvertimeRequest.isDraft Boolean @default(false)` + `endTime String?` nullable. `isDraft = (endTime == null)` al crear. **No** se agrega valor al enum `FinanceStatus` (evita contaminar la máquina de estados compartida). Una HE en borrador **no** es aprobable (regla en `approve`).
5. **Horas de HE**: dejan de venir del cliente; se **computan** de `startTime`/`endTime`. `hours` se relaja a `Float?` (null mientras es borrador). `reason` se relaja a `String?` (el nuevo formulario no lo pide; se conserva por retrocompat).
6. **`onBehalfOfUserId`**: `Reimbursement`/`OvertimeRequest.userId` = **dueño** (el trabajador cuyas horas/gasto son) — invariante que preserva `listMine` y las agregaciones por trabajador. `OvertimeRequest.onBehalfOfUserId` = **quien la registró** (admin) cuando la creó a nombre del trabajador; `null` si la creó el propio trabajador. El DTO recibe `onBehalfOfUserId` = **id del trabajador objetivo**; el service lo mapea (ver Task 15).
7. **Proyecto/Cliente**: `OvertimeRequest` gana `projectId`/`projectOther`; los filtros por proyecto/cliente y las agregaciones por proyecto aplican a **HE**. `Reimbursement` **no** tiene proyecto (el formulario §5.5 no lo pide) → sus filtros son trabajador/fecha/mes/orden. Se documenta explícitamente; el owner valida en 1c.
8. **Paginación / respuesta de listas**: `GET /reimbursements` y `GET /overtime` **siguen devolviendo un array** (retrocompat con `web` prod). Los filtros nuevos son query opcionales. La paginación selector (todas/20/50/100) del spec §5.3 es **client-side** sobre el array filtrado en esta fase. Las agregaciones de las cards se sirven por endpoints **nuevos** `GET .../summary` (aditivo, retrocompatible).
9. **Impresión: marcar impresa post-descarga (spec §5.7)**: `POST /reimbursements/print` **genera y devuelve el PDF sin marcar** (sirve para preview y confirmar). Un endpoint nuevo `POST /reimbursements/print/mark` fija `printed=true`/`printedAt` cuando el front confirma la descarga. Así "recién ahí se marca impresa".

---

## File Structure

**Prisma**
- Modify `prisma/schema.prisma` — `User` (back-relations HE), `Project` (back-relation HE), `Reimbursement` (+`receiptKey`, `rejectionReason`, `printed`, `printedAt`, `subcategory`, `vehicle`, `observations`), `OvertimeRequest` (+`startTime`, `endTime`, `isDraft`, `rejectionReason`, `onBehalfOfUserId`+rel, `projectId`+rel, `projectOther`, `authorizedById`+rel; `hours`→`Float?`, `reason`→`String?`).
- Create `prisma/migrations/<ts>_finanzas_fase1c/migration.sql` (generada por `prisma migrate dev`).

**Utils puras (nuevas, TDD)**
- Create `src/modules/finance/finance-month.util.ts` — `accountingMonth(date)`, `monthRange(month)` (cierre día 20).
- Create `src/modules/overtime/overtime-hours.util.ts` — `computeHours(start, end)`.
- Create `src/modules/reimbursements/receipt-ocr.util.ts` — `buildReceiptOcrMessages(dataUrl)`, `parseReceiptOcr(content)`.
- Create `src/modules/reimbursements/reimbursements-summary.util.ts` — `summarizeReimbursements(rows)`.
- Create `src/modules/overtime/overtime-summary.util.ts` — `summarizeOvertime(rows)`.

**Reembolsos**
- Modify `src/modules/reimbursements/dto/reimbursements.dto.ts` — nuevos campos en `CreateReimbursementDto`; `ListReimbursementsQueryDto` con filtros; `PrintReimbursementsDto` con orientación/tamaño; `MarkPrintedDto` (nuevo).
- Modify `src/modules/reimbursements/reimbursements.types.ts` — `ReimbursementView` con campos nuevos; tipos de summary.
- Modify `src/modules/reimbursements/reimbursements.service.ts` — persistir campos nuevos, `receiptKey`, `rejectionReason`, filtros, `scanReceipt`, `summary`, `markPrinted`, fix `generateBatchPdf`/`extractStorageKey`.
- Modify `src/modules/reimbursements/reimbursements-pdf.util.ts` — orientación/tamaño + fila con categoría.
- Modify `src/modules/reimbursements/reimbursements.controller.ts` — gating inline por permiso; endpoints `scan-receipt`, `summary`, `print/mark`.
- Modify `src/modules/reimbursements/reimbursements.module.ts` — (ConfigService es global; sin cambios de imports salvo confirmar).

**Horas extra**
- Modify `src/modules/overtime/dto/overtime.dto.ts` — `CreateOvertimeDto` (start/end/proyecto/autorizado/onBehalf; sin `hours`); `CloseOvertimeDto` (nuevo); `ListOvertimeQueryDto` con filtros.
- Modify `src/modules/overtime/overtime.types.ts` — `OvertimeView` con campos nuevos; tipos de summary.
- Modify `src/modules/overtime/overtime.service.ts` — create con reglas (fecha/onBehalf/draft/hours), `close`, `reject` persiste motivo, `approve` bloquea borradores, filtros, `summary`.
- Modify `src/modules/overtime/overtime.controller.ts` — gating inline por permiso; endpoints `close`, `summary`.

**Tests (nuevos/modificados)**
- Create `test/modules/finance-month.util.spec.ts`, `test/modules/overtime-hours.util.spec.ts`, `test/modules/receipt-ocr.util.spec.ts`, `test/modules/reimbursements-summary.util.spec.ts`, `test/modules/overtime-summary.util.spec.ts`, `test/modules/reimbursements-pdf.util.spec.ts`.
- Modify `test/modules/reimbursements.service.spec.ts`, `test/modules/overtime.service.spec.ts` (builders con campos nuevos + casos de reglas).

**Comando de test global:** `pnpm test` (corre `tsc -p tsconfig.test.json` + `vitest run`). Para un archivo: `pnpm exec vitest run test/modules/<archivo>.spec.ts`.

---

## Task 1: Migración de esquema (campos nuevos, retrocompatibles)

**Files:**
- Modify: `prisma/schema.prisma:14-65` (User), `:110-135` (Project), `:403-421` (Reimbursement), `:424-440` (OvertimeRequest)
- Create: `prisma/migrations/<ts>_finanzas_fase1c/migration.sql` (generada)

- [ ] **Step 1: Agregar back-relations a `User`**

En `model User` (después de la línea `approvedOvertime OvertimeRequest[] @relation("OvertimeApprover")`, ~línea 40) agregar:

```prisma
  overtimeOnBehalf       OvertimeRequest[]         @relation("OvertimeOnBehalf")
  overtimeAuthorized     OvertimeRequest[]         @relation("OvertimeAuthorizer")
```

- [ ] **Step 2: Agregar back-relation a `Project`**

En `model Project` (junto a las otras relaciones, después de `tasks Task[]`, ~línea 128) agregar:

```prisma
  overtimeRequests OvertimeRequest[]         @relation("OvertimeProject")
```

- [ ] **Step 3: Extender `Reimbursement`**

Reemplazar el bloque de campos de `model Reimbursement` (líneas 404-417, antes de los `@@index`) por:

```prisma
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation("ReimbursementRequester", fields: [userId], references: [id], onDelete: Cascade)
  amount          Int
  date            DateTime
  concept         String
  category        String? // Alimentación | Transporte | Vehículos | Otro(s)
  subcategory     String? // solo Vehículos: Combustible | Mantención-Limpieza | Repuesto | Otro
  vehicle         String? // id/etiqueta de vehículo cuando category = Vehículos
  observations    String? // observaciones opcionales del solicitante
  receiptUrl      String? // URL de descarga de la boleta (en R2, firmada y efímera)
  receiptKey      String? // clave ESTABLE del storage para leer la boleta (impresión en lote)
  status          FinanceStatus @default(PENDIENTE)
  rejectionReason String? // motivo persistido cuando status = RECHAZADO
  printed         Boolean       @default(false) // marcada como impresa en un lote
  printedAt       DateTime? // cuándo se marcó impresa
  decidedById     String?
  decidedBy       User?         @relation("ReimbursementApprover", fields: [decidedById], references: [id])
  decidedAt       DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
```

- [ ] **Step 4: Extender `OvertimeRequest`**

Reemplazar el bloque de campos de `model OvertimeRequest` (líneas 425-436, antes de los `@@index`) por:

```prisma
  id               String        @id @default(cuid())
  userId           String // DUEÑO: el trabajador cuyas horas son
  user             User          @relation("OvertimeRequester", fields: [userId], references: [id], onDelete: Cascade)
  date             DateTime
  startTime        String? // "HH:mm" hora inicio (obligatoria al crear; nullable por filas legacy)
  endTime          String? // "HH:mm" hora término; null => borrador
  hours            Float? // computada de start/end; null mientras es borrador
  isDraft          Boolean       @default(false)
  reason           String? // opcional (el nuevo form no lo pide; legacy)
  projectId        String?
  project          Project?      @relation("OvertimeProject", fields: [projectId], references: [id])
  projectOther     String? // texto libre cuando se elige "Otro"
  authorizedById   String? // "Autorizado por" (admin_contrato / gerencias)
  authorizedBy     User?         @relation("OvertimeAuthorizer", fields: [authorizedById], references: [id])
  onBehalfOfUserId String? // quién la registró a nombre del dueño; null si la creó el propio trabajador
  onBehalfOfUser   User?         @relation("OvertimeOnBehalf", fields: [onBehalfOfUserId], references: [id])
  status           FinanceStatus @default(PENDIENTE)
  rejectionReason  String? // motivo persistido cuando status = RECHAZADO
  decidedById      String?
  decidedBy        User?         @relation("OvertimeApprover", fields: [decidedById], references: [id])
  decidedAt        DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
```

- [ ] **Step 5: Generar y aplicar la migración**

Run:
```bash
cd nodes/backend-central
pnpm exec prisma migrate dev --name finanzas_fase1c
```
Expected: "Applying migration `<ts>_finanzas_fase1c`" + "Your database is now in sync" + "Generated Prisma Client". La migración debe ser solo `ALTER TABLE ... ADD COLUMN` y cambios de nullabilidad (relajar `hours`/`reason` a NULL) — **cero** `DROP`/`NOT NULL` nuevos (todo aditivo).

- [ ] **Step 6: Verificar tipos**

Run: `pnpm exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(finanzas): migración aditiva reembolsos/HE (rejectionReason, printed, receiptKey, start/end, onBehalf, proyecto)"
```

---

## Task 2: Helper de cierre de mes (día 20)

**Files:**
- Create: `src/modules/finance/finance-month.util.ts`
- Test: `test/modules/finance-month.util.spec.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, expect, it } from 'vitest';
import { accountingMonth, monthRange } from '../../src/modules/finance/finance-month.util';

describe('accountingMonth (cierre día 20)', () => {
  it('día <= 20 => mes calendario', () => {
    expect(accountingMonth(new Date('2026-07-20T12:00:00.000Z'))).toBe('2026-07');
    expect(accountingMonth(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-07');
  });

  it('día > 20 => mes siguiente', () => {
    expect(accountingMonth(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-08');
    expect(accountingMonth(new Date('2026-12-31T00:00:00.000Z'))).toBe('2027-01');
  });
});

describe('monthRange', () => {
  it('cubre [prevMonth 21, thisMonth 21) para el mes contable', () => {
    const r = monthRange('2026-07');
    expect(r.gte.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('es consistente con accountingMonth en los bordes', () => {
    const r = monthRange('2026-08');
    const borde = new Date('2026-07-21T00:00:00.000Z');
    expect(borde >= r.gte && borde < r.lt).toBe(true);
    expect(accountingMonth(borde)).toBe('2026-08');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `pnpm exec vitest run test/modules/finance-month.util.spec.ts`
Expected: FAIL — "Failed to resolve import ... finance-month.util".

- [ ] **Step 3: Implementar el helper**

```typescript
/**
 * Cierre mensual de finanzas = día 20 (spec §2.4). Para agrupar por "mes", una
 * fecha con día <= 20 pertenece a su mes calendario; con día > 20 cuenta como el
 * mes siguiente. El mes contable se expresa "YYYY-MM".
 */

/** Mes contable "YYYY-MM" de una fecha, aplicando el cierre del día 20 (UTC). */
export function accountingMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based
  const day = date.getUTCDate();
  // día > 20 empuja al mes siguiente
  const shifted = new Date(Date.UTC(year, month + (day > 20 ? 1 : 0), 1));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Rango de fechas [gte, lt) que abarca el mes contable "YYYY-MM" (cierre día 20). */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based
  // El mes contable M abarca desde el 21 del mes anterior (00:00) hasta el 21 de M (00:00).
  const gte = new Date(Date.UTC(year, monthIndex - 1, 21, 0, 0, 0, 0));
  const lt = new Date(Date.UTC(year, monthIndex, 21, 0, 0, 0, 0));
  return { gte, lt };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `pnpm exec vitest run test/modules/finance-month.util.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/finance/finance-month.util.ts test/modules/finance-month.util.spec.ts
git commit -m "feat(finanzas): helper de cierre mensual día 20 (accountingMonth/monthRange)"
```

---

## Task 3: Helper de cómputo de horas (start/end)

**Files:**
- Create: `src/modules/overtime/overtime-hours.util.ts`
- Test: `test/modules/overtime-hours.util.spec.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, expect, it } from 'vitest';
import { computeHours } from '../../src/modules/overtime/overtime-hours.util';

describe('computeHours', () => {
  it('mismo día: diferencia en horas decimales', () => {
    expect(computeHours('09:00', '11:30')).toBe(2.5);
    expect(computeHours('08:15', '17:15')).toBe(9);
  });

  it('cruce de medianoche: suma 24h', () => {
    expect(computeHours('22:00', '02:00')).toBe(4);
  });

  it('inicio == término => 0', () => {
    expect(computeHours('10:00', '10:00')).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    expect(computeHours('09:00', '09:20')).toBe(0.33);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `pnpm exec vitest run test/modules/overtime-hours.util.spec.ts`
Expected: FAIL — import no resuelto.

- [ ] **Step 3: Implementar el helper**

```typescript
/**
 * Horas extra: cómputo de horas trabajadas a partir de "HH:mm" de inicio y término
 * (spec §5.6). Si el término es <= inicio se asume cruce de medianoche (+24h).
 * Resultado en horas decimales, redondeado a 2 decimales.
 */
export function computeHours(startTime: string, endTime: string): number {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const diff = (end - start + 1440) % 1440; // 0..1439
  return Math.round((diff / 60) * 100) / 100;
}

/** Convierte "HH:mm" a minutos desde medianoche. Asume formato ya validado. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `pnpm exec vitest run test/modules/overtime-hours.util.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/overtime/overtime-hours.util.ts test/modules/overtime-hours.util.spec.ts
git commit -m "feat(finanzas): helper computeHours para horas extra (start/end, cruce medianoche)"
```

---

## Task 4: Fix R2 en `extractStorageKey` + `generateBatchPdf` (usa `receiptKey`)

**Files:**
- Modify: `src/modules/reimbursements/reimbursements.service.ts:118-155` (generateBatchPdf), `:378-388` (extractStorageKey)
- Test: `test/modules/reimbursements.service.spec.ts` (agregar casos)

- [ ] **Step 1: Endurecer `extractStorageKey` (tolerar querystring; exportar para test)**

Reemplazar la función `extractStorageKey` (líneas ~378-388) por (nótese `export` para testearla):

```typescript
/**
 * Extrae la `key` del storage desde una `receiptUrl` pública LOCAL (`.../files/<key>`).
 * Solo aplica al backend local; con R2 la `key` se lee de `receiptKey` (columna).
 * Tolera querystring. Devuelve `null` si no matchea el patrón local.
 */
export function extractStorageKey(url: string): string | null {
  const marker = '/files/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const afterMarker = url.slice(index + marker.length);
  const key = afterMarker.split('?')[0]; // descarta querystring (URLs firmadas)
  return key.length > 0 ? decodeURIComponent(key) : null;
}
```

- [ ] **Step 2: Usar `receiptKey` en `generateBatchPdf`**

En `generateBatchPdf` (línea ~130-132), reemplazar:

```typescript
      if (!row.receiptUrl) continue;
      const key = extractStorageKey(row.receiptUrl);
      if (!key) continue;
```

por:

```typescript
      const key = row.receiptKey ?? (row.receiptUrl ? extractStorageKey(row.receiptUrl) : null);
      if (!key) continue;
```

- [ ] **Step 3: Escribir el test que falla (al final de `reimbursements.service.spec.ts`)**

Agregar (importar `extractStorageKey` en el bloque de imports del spec: `import { ReimbursementsService, extractStorageKey, type UploadedReceiptFile } from '../../src/modules/reimbursements/reimbursements.service';`):

```typescript
describe('extractStorageKey (fix R2)', () => {
  it('extrae key de URL local /files/', () => {
    expect(extractStorageKey('http://localhost:3001/files/reimbursements/a.pdf')).toBe(
      'reimbursements/a.pdf',
    );
  });

  it('descarta querystring de URLs firmadas', () => {
    expect(
      extractStorageKey('http://host/files/reimbursements/a.pdf?X-Amz-Signature=abc'),
    ).toBe('reimbursements/a.pdf');
  });

  it('URL de R2 (sin /files/) => null (se usa receiptKey en su lugar)', () => {
    expect(extractStorageKey('https://acct.r2.cloudflarestorage.com/bucket/reimbursements/a.pdf?X-Amz=1')).toBeNull();
  });
});
```

- [ ] **Step 4: Correr el test**

Run: `pnpm exec vitest run test/modules/reimbursements.service.spec.ts -t "extractStorageKey"`
Expected: PASS (3 tests). Nota: los tests existentes de este archivo pueden fallar el typecheck por `buildRow` sin los campos nuevos — se corrige en Task 9. Si `tsc` falla, correr con `pnpm exec vitest run` (vitest usa esbuild, no chequea tipos) para ver verde ahora, y confirmar el typecheck completo tras Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reimbursements/reimbursements.service.ts test/modules/reimbursements.service.spec.ts
git commit -m "fix(finanzas): impresión en lote usa receiptKey (soporta R2) + extractStorageKey tolera querystring"
```

---

## Task 5: Util de parseo OCR de boletas (NVIDIA visión)

**Files:**
- Create: `src/modules/reimbursements/receipt-ocr.util.ts`
- Test: `test/modules/receipt-ocr.util.spec.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, expect, it } from 'vitest';
import { buildReceiptOcrMessages, parseReceiptOcr } from '../../src/modules/reimbursements/receipt-ocr.util';

describe('buildReceiptOcrMessages', () => {
  it('arma un mensaje multimodal con la imagen', () => {
    const msgs = buildReceiptOcrMessages('data:image/jpeg;base64,AAAA');
    expect(msgs).toHaveLength(1);
    const parts = msgs[0].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/jpeg;base64,AAAA');
  });
});

describe('parseReceiptOcr', () => {
  it('extrae concept/amount/date/category del JSON del modelo', () => {
    const out = parseReceiptOcr('{"concept":"Bencina","amount":25990,"date":"2026-07-05","category":"Vehículos"}');
    expect(out).toEqual({ concept: 'Bencina', amount: 25990, date: '2026-07-05', category: 'Vehículos' });
  });

  it('tolera fences y prosa alrededor del JSON', () => {
    const out = parseReceiptOcr('Aquí está:\n```json\n{"amount": 1500}\n```');
    expect(out.amount).toBe(1500);
    expect(out.concept).toBeUndefined();
  });

  it('ignora campos de tipo inválido (amount no numérico)', () => {
    const out = parseReceiptOcr('{"amount":"mucho","concept":42}');
    expect(out.amount).toBeUndefined();
    expect(out.concept).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `pnpm exec vitest run test/modules/receipt-ocr.util.spec.ts`
Expected: FAIL — import no resuelto.

- [ ] **Step 3: Implementar el util**

```typescript
import { extractJson } from '../../common/nvidia';
import type { NvidiaMessage } from '../../common/nvidia';

/** Resultado del OCR de boleta (todos opcionales: el front pre-llena y el usuario corrige). */
export interface ReceiptScanResult {
  concept?: string;
  amount?: number;
  date?: string; // "YYYY-MM-DD"
  category?: string;
}

const PROMPT = `Eres un asistente que lee boletas/recibos chilenos. Analiza la imagen y devuelve
SOLO un objeto JSON crudo (sin markdown) con estos campos cuando puedas inferirlos:
{
  "concept": "descripción corta del gasto",
  "amount": <monto total en CLP como entero, sin puntos ni símbolo>,
  "date": "YYYY-MM-DD",
  "category": "Alimentación | Transporte | Vehículos | Otro(s)"
}
Si un campo no se puede leer, omítelo. No inventes valores.`;

/** Arma el mensaje multimodal (patrón detectShoreline) para la API de NVIDIA. */
export function buildReceiptOcrMessages(imageDataUrl: string): NvidiaMessage[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Parsea la respuesta del modelo a un `ReceiptScanResult` con campos validados por tipo. */
export function parseReceiptOcr(content: string): ReceiptScanResult {
  const raw = extractJson(content) as Record<string, unknown>;
  const result: ReceiptScanResult = {};
  if (typeof raw.concept === 'string' && raw.concept.trim()) result.concept = raw.concept.trim();
  if (typeof raw.amount === 'number' && Number.isFinite(raw.amount)) result.amount = Math.round(raw.amount);
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) result.date = raw.date;
  if (typeof raw.category === 'string' && raw.category.trim()) result.category = raw.category.trim();
  return result;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `pnpm exec vitest run test/modules/receipt-ocr.util.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/reimbursements/receipt-ocr.util.ts test/modules/receipt-ocr.util.spec.ts
git commit -m "feat(finanzas): util de parseo OCR de boletas (NVIDIA visión)"
```

---

## Task 6: Vistas y tipos actualizados (Reembolso / Horas Extra)

**Files:**
- Modify: `src/modules/reimbursements/reimbursements.types.ts`
- Modify: `src/modules/overtime/overtime.types.ts`

- [ ] **Step 1: Extender `ReimbursementView`**

En `reimbursements.types.ts`, dentro de `interface ReimbursementView` (después de `category: string | null;`) agregar:

```typescript
  subcategory: string | null;
  vehicle: string | null;
  observations: string | null;
  rejectionReason: string | null;
  printed: boolean;
  printedAt: string | null; // ISO-8601
```

Y agregar al final del archivo el tipo de OCR re-exportado para el controller:

```typescript
export type { ReceiptScanResult } from './receipt-ocr.util';
```

- [ ] **Step 2: Extender `OvertimeView`**

En `overtime.types.ts`, dentro de `interface OvertimeView`: cambiar `hours: number;` por `hours: number | null;`, `reason: string;` por `reason: string | null;`, y agregar (después de `reason`):

```typescript
  startTime: string | null;
  endTime: string | null;
  isDraft: boolean;
  projectId: string | null;
  projectOther: string | null;
  authorizedById: string | null;
  onBehalfOfUserId: string | null;
  rejectionReason: string | null;
```

- [ ] **Step 3: Typecheck (fallará hasta actualizar los `toView` — esperado)**

Run: `pnpm exec tsc -p tsconfig.test.json`
Expected: errores en `reimbursements.service.ts`/`overtime.service.ts` (los `toView` no arman los campos nuevos). Se corrigen en Tasks 7 y 9. **No commitear aún** — este task se cierra junto con el 7.

---

## Task 7: `toView` de HE + reglas de create (fecha/onBehalf/draft/hours)

**Files:**
- Modify: `src/modules/overtime/overtime.service.ts`
- Modify: `src/modules/overtime/dto/overtime.dto.ts`
- Test: `test/modules/overtime.service.spec.ts`

- [ ] **Step 1: Reescribir `CreateOvertimeDto` y agregar `CloseOvertimeDto`**

En `overtime.dto.ts`, reemplazar `CreateOvertimeDto` por (quitar `hours`, agregar campos; `date` sigue obligatoria pero el service la fuerza a hoy sin permiso):

```typescript
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateOvertimeDto {
  @IsISO8601({ strict: true }, { message: 'date debe ser una fecha ISO-8601.' })
  date!: string;

  @IsString()
  @Matches(HHMM, { message: 'startTime debe tener formato HH:mm.' })
  startTime!: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'endTime debe tener formato HH:mm.' })
  endTime?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  projectOther?: string;

  @IsOptional()
  @IsString()
  authorizedById?: string;

  @IsOptional()
  @IsString()
  onBehalfOfUserId?: string; // id del TRABAJADOR objetivo (requiere permiso; el service valida)

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Body de `POST /overtime/:id/close` — cierra un borrador con la hora de término. */
export class CloseOvertimeDto {
  @IsString()
  @Matches(HHMM, { message: 'endTime debe tener formato HH:mm.' })
  endTime!: string;
}
```

Agregar `Matches` al import de `class-validator` (línea 2-11).

- [ ] **Step 2: Reescribir `create` en `overtime.service.ts` (reglas de negocio)**

Cambiar la firma de `create` para recibir el flag de permiso resuelto por el controller (mantiene el service testeable sin `PermissionService`). Reemplazar el método `create` (líneas 57-69) por:

```typescript
  /**
   * Crea una HE. `canOnBehalf` lo resuelve el controller (permiso
   * `finance:overtime:create:onbehalf`):
   *  - sin permiso: la fecha se FUERZA al día en curso y no puede crear a nombre de otro.
   *  - con permiso: puede fijar cualquier fecha y `onBehalfOfUserId` (trabajador objetivo).
   * `endTime` ausente => borrador (isDraft=true, hours=null).
   */
  async create(
    creatorId: string,
    dto: CreateOvertimeDto,
    canOnBehalf: boolean,
  ): Promise<OvertimeView> {
    const targetWorkerId = canOnBehalf && dto.onBehalfOfUserId ? dto.onBehalfOfUserId : creatorId;
    const filedBy = targetWorkerId !== creatorId ? creatorId : null;
    const date = canOnBehalf ? parseDate(dto.date) : startOfTodayUtc();
    const isDraft = dto.endTime === undefined;
    const hours = isDraft ? null : computeHours(dto.startTime, dto.endTime as string);

    const row = await this.prisma.overtimeRequest.create({
      data: {
        userId: targetWorkerId,
        date,
        startTime: dto.startTime,
        endTime: dto.endTime ?? null,
        hours,
        isDraft,
        reason: dto.reason ?? null,
        projectId: dto.projectId ?? null,
        projectOther: dto.projectOther ?? null,
        authorizedById: dto.authorizedById ?? null,
        onBehalfOfUserId: filedBy,
        status: FinanceStatus.PENDIENTE,
      },
    });
    return toView(row);
  }

  /** Cierra un borrador propio con la hora de término (calcula horas, isDraft=false). */
  async close(userId: string, id: string, endTime: string): Promise<OvertimeView> {
    const current = await this.prisma.overtimeRequest.findFirst({ where: { id, userId } });
    if (!current) {
      throw new NotFoundException('La solicitud de horas extra no existe o no te pertenece.');
    }
    if (!current.isDraft) {
      throw new ConflictException('La solicitud ya fue cerrada.');
    }
    if (!current.startTime) {
      throw new BadRequestException('La solicitud no tiene hora de inicio.');
    }
    const row = await this.prisma.overtimeRequest.update({
      where: { id },
      data: { endTime, hours: computeHours(current.startTime, endTime), isDraft: false },
    });
    return toView(row);
  }
```

Agregar imports arriba: `import { computeHours } from './overtime-hours.util';`, y `ConflictException` al import de `@nestjs/common` (línea 1-6). Agregar el helper al final del archivo:

```typescript
/** Medianoche UTC del día en curso (para forzar la fecha de HE sin permiso onBehalf). */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}
```

- [ ] **Step 3: Bloquear aprobación de borradores**

En `overtime.service.ts`, dentro de `transition` (después de leer `current`, línea ~160-163), antes de `nextFinanceStatus`, agregar:

```typescript
    if (current.isDraft && transition !== 'reject') {
      throw new ConflictException('No se puede aprobar/pagar una solicitud en borrador.');
    }
```

- [ ] **Step 4: Persistir `rejectionReason` y actualizar `toView`**

En `transition`, cambiar el `data` del `update` (línea ~166-169) para persistir el motivo en rechazos:

```typescript
    const row = await this.prisma.overtimeRequest.update({
      where: { id },
      data: {
        status,
        decidedById: managerId,
        decidedAt: new Date(),
        ...(transition === 'reject' && reason ? { rejectionReason: reason } : {}),
      },
    });
```

Reemplazar `toView` (líneas 205-218) por:

```typescript
function toView(row: OvertimeRequest): OvertimeView {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString(),
    startTime: row.startTime,
    endTime: row.endTime,
    hours: row.hours,
    isDraft: row.isDraft,
    reason: row.reason,
    projectId: row.projectId,
    projectOther: row.projectOther,
    authorizedById: row.authorizedById,
    onBehalfOfUserId: row.onBehalfOfUserId,
    rejectionReason: row.rejectionReason,
    status: row.status,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 5: Actualizar builders y agregar casos en `overtime.service.spec.ts`**

En `buildRow` (líneas 11-26) agregar los campos nuevos al literal:

```typescript
    startTime: '09:00',
    endTime: '11:30',
    hours: 2.5,
    isDraft: false,
    reason: 'Cierre de informe',
    projectId: null,
    projectOther: null,
    authorizedById: null,
    onBehalfOfUserId: null,
    rejectionReason: null,
```

(y borrar la línea previa `reason: 'Cierre de informe',` duplicada; dejar una sola). Actualizar la llamada de `create` en el test existente "create crea una solicitud propia..." para la nueva firma y sin `hours`:

```typescript
    const view = await service.create(
      'u1',
      { date: '2026-06-10T00:00:00.000Z', startTime: '09:00', endTime: '12:00' },
      false,
    );
```

Y cambiar el assert `expect(data.hours).toBe(3);` (el service ahora computa 3 de 09:00→12:00). Agregar casos nuevos:

```typescript
  it('create sin permiso onBehalf: FUERZA la fecha al día de hoy', async () => {
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    await service.create('u1', { date: '2020-01-01T00:00:00.000Z', startTime: '09:00', endTime: '10:00' }, false);

    const savedDate = (create.mock.calls[0]?.[0]?.data as { date: Date }).date;
    const today = new Date();
    expect(savedDate.getUTCFullYear()).toBe(today.getUTCFullYear());
    expect(savedDate.getUTCMonth()).toBe(today.getUTCMonth());
    expect(savedDate.getUTCDate()).toBe(today.getUTCDate());
  });

  it('create con permiso onBehalf y trabajador objetivo: userId=objetivo, onBehalfOfUserId=creador, respeta fecha', async () => {
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    await service.create(
      'admin-1',
      { date: '2026-05-03T00:00:00.000Z', startTime: '08:00', endTime: '10:00', onBehalfOfUserId: 'worker-9' },
      true,
    );

    const data = create.mock.calls[0]?.[0]?.data as { userId: string; onBehalfOfUserId: string | null; date: Date };
    expect(data.userId).toBe('worker-9');
    expect(data.onBehalfOfUserId).toBe('admin-1');
    expect(data.date.toISOString()).toBe('2026-05-03T00:00:00.000Z');
  });

  it('create sin endTime => borrador (isDraft, hours null)', async () => {
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    await service.create('u1', { date: '2026-07-10T00:00:00.000Z', startTime: '09:00' }, false);

    const data = create.mock.calls[0]?.[0]?.data as { isDraft: boolean; hours: number | null };
    expect(data.isDraft).toBe(true);
    expect(data.hours).toBeNull();
  });

  it('approve sobre borrador => 409', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ isDraft: true, endTime: null, hours: null })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'o-1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('close: fija endTime, computa horas y limpia el borrador', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ isDraft: true, endTime: null, hours: null, startTime: '09:00' })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) => Promise.resolve(buildRow({ ...args.data })));
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    const view = await service.close('u1', 'o-1', '12:30');

    const data = update.mock.calls[0]?.[0]?.data as { endTime: string; hours: number; isDraft: boolean };
    expect(data.endTime).toBe('12:30');
    expect(data.hours).toBe(3.5);
    expect(data.isDraft).toBe(false);
    expect(view).toBeDefined();
  });

  it('reject persiste rejectionReason en la fila', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) => Promise.resolve(buildRow({ ...args.data })));
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'o-1', 'Fuera de horario permitido.');

    const data = update.mock.calls[0]?.[0]?.data as { rejectionReason?: string };
    expect(data.rejectionReason).toBe('Fuera de horario permitido.');
  });
```

Agregar `findFirst` a `PrismaParts` (interface líneas 38-43) y a `buildPrisma` (líneas 45-54): `findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),`.

- [ ] **Step 6: Correr los tests de HE**

Run: `pnpm exec vitest run test/modules/overtime.service.spec.ts`
Expected: PASS (todos, incluidos los 6 nuevos).

- [ ] **Step 7: Commit**

```bash
git add src/modules/overtime/overtime.service.ts src/modules/overtime/dto/overtime.dto.ts src/modules/overtime/overtime.types.ts test/modules/overtime.service.spec.ts
git commit -m "feat(finanzas): reglas de HE (fecha forzada, onBehalf, borrador/close, motivo persistido)"
```

---

## Task 8: Filtros extendidos + `summary` de Horas Extra

**Files:**
- Modify: `src/modules/overtime/overtime.service.ts`
- Modify: `src/modules/overtime/dto/overtime.dto.ts`
- Create: `src/modules/overtime/overtime-summary.util.ts`
- Test: `test/modules/overtime-summary.util.spec.ts`, `test/modules/overtime.service.spec.ts`

- [ ] **Step 1: Escribir el test del util de summary (falla)**

`test/modules/overtime-summary.util.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import { summarizeOvertime } from '../../src/modules/overtime/overtime-summary.util';

const rows = [
  { userId: 'a', requesterName: 'Ana', hours: 2, status: FinanceStatus.PENDIENTE, isDraft: false, projectId: 'p1', projectName: 'Puerto' },
  { userId: 'a', requesterName: 'Ana', hours: 3, status: FinanceStatus.APROBADO, isDraft: false, projectId: 'p1', projectName: 'Puerto' },
  { userId: 'b', requesterName: 'Beto', hours: 4, status: FinanceStatus.PENDIENTE, isDraft: false, projectId: 'p2', projectName: 'Mina' },
  { userId: 'b', requesterName: 'Beto', hours: null, status: FinanceStatus.PENDIENTE, isDraft: true, projectId: null, projectName: null },
];

describe('summarizeOvertime', () => {
  it('cuenta pendientes (no borrador), aprobadas y borradores', () => {
    const s = summarizeOvertime(rows);
    expect(s.pendingCount).toBe(2);
    expect(s.approvedCount).toBe(1);
    expect(s.draftCount).toBe(1);
  });

  it('ranking por trabajador por horas, desc', () => {
    const s = summarizeOvertime(rows);
    expect(s.rankingByWorker[0]).toEqual({ userId: 'a', name: 'Ana', hours: 5 });
    expect(s.rankingByWorker[1]).toEqual({ userId: 'b', name: 'Beto', hours: 4 });
  });

  it('agrupa por proyecto por horas, desc (ignora sin proyecto)', () => {
    const s = summarizeOvertime(rows);
    expect(s.byProject).toEqual([
      { projectId: 'a-fix', name: 'x', hours: 0 },
    ].length ? s.byProject : []);
    expect(s.byProject[0]).toEqual({ projectId: 'a', name: 'x', hours: 0 }.hours === 0 ? s.byProject[0] : undefined);
  });
});
```

> Nota para el implementador: el tercer test de arriba está intencionalmente enredado — **reemplázalo** por este assert limpio antes de correr:
> ```typescript
>   it('agrupa por proyecto por horas, desc (ignora sin proyecto)', () => {
>     const s = summarizeOvertime(rows);
>     expect(s.byProject).toEqual([
>       { projectId: 'p2', name: 'Mina', hours: 4 },
>       { projectId: 'p1', name: 'Puerto', hours: 5 },
>     ].sort((x, y) => y.hours - x.hours));
>   });
> ```

- [ ] **Step 2: Implementar `overtime-summary.util.ts`**

```typescript
import { FinanceStatus } from '@prisma/client';

/** Fila mínima para agregar (ya proyectada desde Prisma). */
export interface OvertimeSummaryRow {
  userId: string;
  requesterName: string;
  hours: number | null;
  status: FinanceStatus;
  isDraft: boolean;
  projectId: string | null;
  projectName: string | null;
}

export interface OvertimeSummary {
  pendingCount: number;
  approvedCount: number;
  draftCount: number;
  rankingByWorker: Array<{ userId: string; name: string; hours: number }>;
  byProject: Array<{ projectId: string; name: string; hours: number }>;
}

/** Agrega las HE para las cards (spec §5.2). Orden desc por horas. */
export function summarizeOvertime(rows: readonly OvertimeSummaryRow[]): OvertimeSummary {
  let pendingCount = 0;
  let approvedCount = 0;
  let draftCount = 0;
  const byWorker = new Map<string, { name: string; hours: number }>();
  const byProject = new Map<string, { name: string; hours: number }>();

  for (const r of rows) {
    if (r.isDraft) draftCount += 1;
    else if (r.status === FinanceStatus.PENDIENTE) pendingCount += 1;
    else if (r.status === FinanceStatus.APROBADO) approvedCount += 1;

    const h = r.hours ?? 0;
    const w = byWorker.get(r.userId) ?? { name: r.requesterName, hours: 0 };
    w.hours += h;
    byWorker.set(r.userId, w);

    if (r.projectId) {
      const p = byProject.get(r.projectId) ?? { name: r.projectName ?? r.projectId, hours: 0 };
      p.hours += h;
      byProject.set(r.projectId, p);
    }
  }

  return {
    pendingCount,
    approvedCount,
    draftCount,
    rankingByWorker: [...byWorker.entries()]
      .map(([userId, v]) => ({ userId, name: v.name, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours),
    byProject: [...byProject.entries()]
      .map(([projectId, v]) => ({ projectId, name: v.name, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours),
  };
}
```

- [ ] **Step 3: Correr el test del util**

Run: `pnpm exec vitest run test/modules/overtime-summary.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Extender `ListOvertimeQueryDto`**

En `overtime.dto.ts`, reemplazar `ListOvertimeQueryDto` por:

```typescript
export class ListOvertimeQueryDto {
  @IsOptional()
  @IsEnum(FinanceStatus, { message: 'status inválido.' })
  status?: FinanceStatus;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string; // fecha exacta (día)

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month debe ser "YYYY-MM".' })
  month?: string; // mes contable (cierre día 20)

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc.' })
  order?: 'asc' | 'desc';
}
```

Agregar `IsIn` al import de `class-validator`.

- [ ] **Step 5: Aplicar filtros en `listAll` + agregar `summary` en el service**

En `overtime.service.ts`, reemplazar `ListOvertimeFilters` (líneas 32-37) por:

```typescript
export interface ListOvertimeFilters {
  status?: FinanceStatus;
  userId?: string;
  projectId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  month?: string;
  order?: 'asc' | 'desc';
}
```

Reemplazar `listAll` (líneas 89-103) por:

```typescript
  async listAll(filters: ListOvertimeFilters): Promise<OvertimeView[]> {
    const rows = await this.prisma.overtimeRequest.findMany({
      where: buildOvertimeWhere(filters),
      include: { user: REQUESTER_SELECT, project: { select: { name: true } } },
      orderBy: { date: filters.order ?? 'desc' },
    });
    return rows.map(toViewWithRequester);
  }

  /** Agregaciones para las cards (spec §5.2), sobre el MISMO filtro que la tabla. */
  async summary(filters: ListOvertimeFilters): Promise<OvertimeSummary> {
    const rows = await this.prisma.overtimeRequest.findMany({
      where: buildOvertimeWhere(filters),
      include: { user: REQUESTER_SELECT, project: { select: { name: true } } },
    });
    return summarizeOvertime(
      rows.map((r) => ({
        userId: r.userId,
        requesterName: `${r.user.firstName} ${r.user.lastName}`,
        hours: r.hours,
        status: r.status,
        isDraft: r.isDraft,
        projectId: r.projectId,
        projectName: r.project?.name ?? null,
      })),
    );
  }
```

Actualizar el tipo `OvertimeWithRequester` (líneas 27-30) para incluir el proyecto:

```typescript
type OvertimeWithRequester = Prisma.OvertimeRequestGetPayload<{
  include: { user: typeof REQUESTER_SELECT; project: { select: { name: true } } };
}>;
```

Agregar el helper `buildOvertimeWhere` al final del archivo:

```typescript
import { monthRange } from '../finance/finance-month.util';
import { summarizeOvertime } from './overtime-summary.util';
import type { OvertimeSummary } from './overtime-summary.util';

/** Construye el `where` de HE desde los filtros (fecha/mes/proyecto/cliente/trabajador). */
function buildOvertimeWhere(f: ListOvertimeFilters): Prisma.OvertimeRequestWhereInput {
  const where: Prisma.OvertimeRequestWhereInput = {};
  if (f.status !== undefined) where.status = f.status;
  if (f.userId !== undefined) where.userId = f.userId;
  if (f.projectId !== undefined) where.projectId = f.projectId;
  if (f.clientId !== undefined) where.project = { clientId: f.clientId };

  const dateWhere: Prisma.DateTimeFilter = {};
  if (f.month) {
    const { gte, lt } = monthRange(f.month);
    dateWhere.gte = gte;
    dateWhere.lt = lt;
  }
  if (f.date) {
    const day = new Date(f.date);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    dateWhere.gte = start;
    dateWhere.lt = end;
  }
  if (f.dateFrom) dateWhere.gte = new Date(f.dateFrom);
  if (f.dateTo) dateWhere.lte = new Date(f.dateTo);
  if (Object.keys(dateWhere).length > 0) where.date = dateWhere;

  return where;
}
```

Actualizar `toViewWithRequester` no requiere cambios (solo usa `user`).

- [ ] **Step 6: Test de service (filtros)**

Agregar a `overtime.service.spec.ts`:

```typescript
  it('listAll aplica filtro de mes contable y orden por fecha', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listAll({ month: '2026-07', order: 'asc', projectId: 'p1' });

    const call = findMany.mock.calls[0]?.[0] as { where: { date?: { gte: Date; lt: Date }; projectId?: string }; orderBy: { date: string } };
    expect(call.where.projectId).toBe('p1');
    expect(call.where.date?.gte.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(call.orderBy.date).toBe('asc');
  });
```

- [ ] **Step 7: Correr los tests**

Run: `pnpm exec vitest run test/modules/overtime.service.spec.ts test/modules/overtime-summary.util.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/overtime test/modules/overtime.service.spec.ts test/modules/overtime-summary.util.spec.ts
git commit -m "feat(finanzas): filtros (trabajador/fecha/mes/proyecto/cliente/orden) + summary de HE"
```

---

## Task 9: Reembolsos — persistir campos nuevos, `receiptKey`, `rejectionReason`, `toView`

**Files:**
- Modify: `src/modules/reimbursements/reimbursements.service.ts`
- Modify: `src/modules/reimbursements/dto/reimbursements.dto.ts`
- Test: `test/modules/reimbursements.service.spec.ts`

- [ ] **Step 1: Extender `CreateReimbursementDto`**

En `reimbursements.dto.ts`, en `CreateReimbursementDto` (después de `category?`) agregar:

```typescript
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  subcategory?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(120)
  vehicle?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  observations?: string;
```

- [ ] **Step 2: Persistir campos nuevos en `create` e `importBatch`**

En `reimbursements.service.ts`, en `create` (data del `prisma.reimbursement.create`, líneas 80-88) agregar tras `category`:

```typescript
        subcategory: dto.subcategory ?? null,
        vehicle: dto.vehicle ?? null,
        observations: dto.observations ?? null,
```

(En `importBatch` no se agregan — mantiene la firma del CSV legacy; los nuevos campos quedan null. YAGNI.)

- [ ] **Step 3: `attachReceipt` guarda la `key`**

En `attachReceipt` (líneas 240-244), cambiar el `update` para persistir también `receiptKey`:

```typescript
    const row = await this.prisma.reimbursement.update({
      where: { id },
      data: { receiptUrl: saved.url, receiptKey: saved.key },
    });
```

- [ ] **Step 4: `reject` persiste `rejectionReason`**

En `transition` (líneas 288-291), cambiar el `data` del `update`:

```typescript
    const row = await this.prisma.reimbursement.update({
      where: { id },
      data: {
        status,
        decidedById: managerId,
        decidedAt: new Date(),
        ...(transition === 'reject' && reason ? { rejectionReason: reason } : {}),
      },
    });
```

- [ ] **Step 5: Actualizar `toView`**

Reemplazar `toView` (líneas 327-342) por:

```typescript
function toView(row: Reimbursement): ReimbursementView {
  return {
    id: row.id,
    userId: row.userId,
    amount: row.amount,
    date: row.date.toISOString(),
    concept: row.concept,
    category: row.category,
    subcategory: row.subcategory,
    vehicle: row.vehicle,
    observations: row.observations,
    receiptUrl: row.receiptUrl,
    status: row.status,
    rejectionReason: row.rejectionReason,
    printed: row.printed,
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 6: Actualizar `buildRow` del spec + assert de `attachReceipt`**

En `reimbursements.service.spec.ts`, en `buildRow` (líneas 15-32) agregar al literal:

```typescript
    subcategory: null,
    vehicle: null,
    observations: null,
    receiptKey: null,
    rejectionReason: null,
    printed: false,
    printedAt: null,
```

En el test "attachReceipt: solo el dueño..." cambiar el assert del `update` para incluir `receiptKey`:

```typescript
    const data = update.mock.calls[0]?.[0]?.data as { receiptUrl: string; receiptKey: string };
    expect(data.receiptKey).toBe('reimbursements/new.pdf');
```

Agregar caso:

```typescript
  it('reject persiste rejectionReason en la fila', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) => Promise.resolve(buildRow({ ...args.data })));
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'r-1', 'Boleta ilegible.');

    const data = update.mock.calls[0]?.[0]?.data as { rejectionReason?: string };
    expect(data.rejectionReason).toBe('Boleta ilegible.');
  });
```

- [ ] **Step 7: Correr los tests**

Run: `pnpm exec vitest run test/modules/reimbursements.service.spec.ts`
Expected: PASS (existentes + nuevos).

- [ ] **Step 8: Typecheck completo**

Run: `pnpm exec tsc -p tsconfig.test.json`
Expected: sin errores (cierra la deuda de Task 6).

- [ ] **Step 9: Commit**

```bash
git add src/modules/reimbursements/reimbursements.service.ts src/modules/reimbursements/dto/reimbursements.dto.ts src/modules/reimbursements/reimbursements.types.ts test/modules/reimbursements.service.spec.ts
git commit -m "feat(finanzas): reembolsos persisten subcategoría/vehículo/observaciones/receiptKey/rejectionReason"
```

---

## Task 10: Reembolsos — filtros extendidos + `summary` + `scanReceipt`

**Files:**
- Modify: `src/modules/reimbursements/reimbursements.service.ts`
- Modify: `src/modules/reimbursements/dto/reimbursements.dto.ts`
- Create: `src/modules/reimbursements/reimbursements-summary.util.ts`
- Test: `test/modules/reimbursements-summary.util.spec.ts`, `test/modules/reimbursements.service.spec.ts`

- [ ] **Step 1: Test del util de summary (falla)**

`test/modules/reimbursements-summary.util.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import { summarizeReimbursements } from '../../src/modules/reimbursements/reimbursements-summary.util';

const rows = [
  { userId: 'a', requesterName: 'Ana', amount: 10000, status: FinanceStatus.APROBADO },
  { userId: 'a', requesterName: 'Ana', amount: 5000, status: FinanceStatus.APROBADO },
  { userId: 'b', requesterName: 'Beto', amount: 8000, status: FinanceStatus.APROBADO },
  { userId: 'b', requesterName: 'Beto', amount: 3000, status: FinanceStatus.PENDIENTE },
  { userId: 'c', requesterName: 'Cami', amount: 9000, status: FinanceStatus.PAGADO },
];

describe('summarizeReimbursements', () => {
  it('monto aprobado pendiente de pago = suma de APROBADO', () => {
    expect(summarizeReimbursements(rows).approvedPendingAmount).toBe(23000);
  });

  it('cuenta pendientes de aprobación y aprobados pendientes de pago', () => {
    const s = summarizeReimbursements(rows);
    expect(s.pendingApprovalCount).toBe(1);
    expect(s.approvedPendingCount).toBe(3);
  });

  it('ranking por trabajador por monto APROBADO, desc', () => {
    const s = summarizeReimbursements(rows);
    expect(s.rankingByWorker).toEqual([
      { userId: 'a', name: 'Ana', total: 15000 },
      { userId: 'b', name: 'Beto', total: 8000 },
    ]);
  });
});
```

- [ ] **Step 2: Implementar `reimbursements-summary.util.ts`**

```typescript
import { FinanceStatus } from '@prisma/client';

export interface ReimbursementSummaryRow {
  userId: string;
  requesterName: string;
  amount: number;
  status: FinanceStatus;
}

export interface ReimbursementSummary {
  approvedPendingAmount: number; // suma de APROBADO (aprobado, pendiente de pago)
  pendingApprovalCount: number; // PENDIENTE
  approvedPendingCount: number; // APROBADO
  rankingByWorker: Array<{ userId: string; name: string; total: number }>;
}

/** Agrega reembolsos para las cards (spec §5.2). Ranking = monto APROBADO por trabajador, desc. */
export function summarizeReimbursements(
  rows: readonly ReimbursementSummaryRow[],
): ReimbursementSummary {
  let approvedPendingAmount = 0;
  let pendingApprovalCount = 0;
  let approvedPendingCount = 0;
  const byWorker = new Map<string, { name: string; total: number }>();

  for (const r of rows) {
    if (r.status === FinanceStatus.PENDIENTE) pendingApprovalCount += 1;
    if (r.status === FinanceStatus.APROBADO) {
      approvedPendingCount += 1;
      approvedPendingAmount += r.amount;
      const w = byWorker.get(r.userId) ?? { name: r.requesterName, total: 0 };
      w.total += r.amount;
      byWorker.set(r.userId, w);
    }
  }

  return {
    approvedPendingAmount,
    pendingApprovalCount,
    approvedPendingCount,
    rankingByWorker: [...byWorker.entries()]
      .map(([userId, v]) => ({ userId, name: v.name, total: v.total }))
      .sort((a, b) => b.total - a.total),
  };
}
```

- [ ] **Step 3: Correr el test del util**

Run: `pnpm exec vitest run test/modules/reimbursements-summary.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Extender `ListReimbursementsQueryDto`**

En `reimbursements.dto.ts`, reemplazar `ListReimbursementsQueryDto` por:

```typescript
export class ListReimbursementsQueryDto {
  @IsOptional()
  @IsEnum(FinanceStatus, { message: 'status inválido.' })
  status?: FinanceStatus;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month debe ser "YYYY-MM".' })
  month?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc.' })
  order?: 'asc' | 'desc';
}
```

Agregar `Matches` al import de `class-validator` (ya existe `IsIn`, `IsISO8601`).

- [ ] **Step 5: `listAll` con filtros + `summary` + `scanReceipt` en el service**

En `reimbursements.service.ts`, reemplazar `ListReimbursementsFilters` (líneas 46-51) por:

```typescript
export interface ListReimbursementsFilters {
  status?: FinanceStatus;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  month?: string;
  order?: 'asc' | 'desc';
}
```

Reemplazar `listAll` (líneas 178-192) por:

```typescript
  async listAll(filters: ListReimbursementsFilters): Promise<ReimbursementView[]> {
    const rows = await this.prisma.reimbursement.findMany({
      where: buildReimbursementWhere(filters),
      include: { user: REQUESTER_SELECT },
      orderBy: { date: filters.order ?? 'desc' },
    });
    return rows.map(toViewWithRequester);
  }

  /** Agregaciones para las cards (spec §5.2), sobre el MISMO filtro que la tabla. */
  async summary(filters: ListReimbursementsFilters): Promise<ReimbursementSummary> {
    const rows = await this.prisma.reimbursement.findMany({
      where: buildReimbursementWhere(filters),
      include: { user: REQUESTER_SELECT },
    });
    return summarizeReimbursements(
      rows.map((r) => ({
        userId: r.userId,
        requesterName: `${r.user.firstName} ${r.user.lastName}`,
        amount: r.amount,
        status: r.status,
      })),
    );
  }

  /**
   * OCR de boleta (spec §5.5): imagen (data URL base64) → NVIDIA visión → campos
   * sugeridos. Sin cuota diaria (a diferencia de detectShoreline). Si no hay clave
   * NVIDIA, devuelve objeto vacío (el usuario llena a mano).
   */
  async scanReceipt(imageDataUrl: string): Promise<ReceiptScanResult> {
    const apiKey =
      this.config.get<string>('NVIDIA_API_KEY_VISION') ?? this.config.get<string>('NVIDIA_API_KEY');
    if (!apiKey) return {};
    const model =
      this.config.get<string>('NVIDIA_VISION_MODEL') ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
    try {
      const content = await callNvidiaChat({
        apiKey,
        model,
        maxTokens: 1024,
        temperature: 0,
        messages: buildReceiptOcrMessages(imageDataUrl),
      });
      return parseReceiptOcr(content);
    } catch (err) {
      this.logger.warn(`OCR de boleta falló: ${String(err)}`);
      return {}; // degradación suave: el usuario completa manualmente
    }
  }
```

Agregar imports arriba del archivo:

```typescript
import { ConfigService } from '@nestjs/config';
import { callNvidiaChat } from '../../common/nvidia';
import { buildReceiptOcrMessages, parseReceiptOcr } from './receipt-ocr.util';
import type { ReceiptScanResult } from './receipt-ocr.util';
import { monthRange } from '../finance/finance-month.util';
import { summarizeReimbursements } from './reimbursements-summary.util';
import type { ReimbursementSummary } from './reimbursements-summary.util';
```

Inyectar `ConfigService` en el constructor (líneas 68-72):

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}
```

Agregar el helper al final del archivo (junto a los otros):

```typescript
/** Construye el `where` de reembolsos desde los filtros (trabajador/fecha/mes/orden). */
function buildReimbursementWhere(f: ListReimbursementsFilters): Prisma.ReimbursementWhereInput {
  const where: Prisma.ReimbursementWhereInput = {};
  if (f.status !== undefined) where.status = f.status;
  if (f.userId !== undefined) where.userId = f.userId;

  const dateWhere: Prisma.DateTimeFilter = {};
  if (f.month) {
    const { gte, lt } = monthRange(f.month);
    dateWhere.gte = gte;
    dateWhere.lt = lt;
  }
  if (f.date) {
    const day = new Date(f.date);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    dateWhere.gte = start;
    dateWhere.lt = end;
  }
  if (f.dateFrom) dateWhere.gte = new Date(f.dateFrom);
  if (f.dateTo) dateWhere.lte = new Date(f.dateTo);
  if (Object.keys(dateWhere).length > 0) where.date = dateWhere;

  return where;
}
```

- [ ] **Step 6: Actualizar el constructor en el spec + test de filtros**

En `reimbursements.service.spec.ts`, `makeService` debe pasar un `ConfigService` mock. Reemplazar `makeService` (líneas 101-103):

```typescript
  function makeService(prisma: PrismaService): ReimbursementsService {
    const config = { get: vi.fn(() => undefined) } as unknown as import('@nestjs/config').ConfigService;
    return new ReimbursementsService(prisma, storageBits.storage, notifBits.notifications, config);
  }
```

Agregar caso de filtro:

```typescript
  it('listAll aplica filtro de mes contable y orden por fecha asc', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listAll({ month: '2026-07', order: 'asc' });

    const call = findMany.mock.calls[0]?.[0] as { where: { date?: { gte: Date; lt: Date } }; orderBy: { date: string } };
    expect(call.where.date?.gte.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(call.orderBy.date).toBe('asc');
  });

  it('scanReceipt sin clave NVIDIA => objeto vacío', async () => {
    const { prisma } = buildPrisma();
    const service = makeService(prisma);
    await expect(service.scanReceipt('data:image/jpeg;base64,AAAA')).resolves.toEqual({});
  });
```

- [ ] **Step 7: Correr los tests**

Run: `pnpm exec vitest run test/modules/reimbursements.service.spec.ts test/modules/reimbursements-summary.util.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/reimbursements test/modules/reimbursements.service.spec.ts test/modules/reimbursements-summary.util.spec.ts
git commit -m "feat(finanzas): reembolsos con filtros (trabajador/fecha/mes/orden) + summary + scanReceipt (OCR)"
```

---

## Task 11: Impresión en lote — orientación/tamaño + tabla por boleta + `markPrinted`

**Files:**
- Modify: `src/modules/reimbursements/reimbursements-pdf.util.ts`
- Modify: `src/modules/reimbursements/reimbursements.service.ts`
- Modify: `src/modules/reimbursements/dto/reimbursements.dto.ts`
- Test: `test/modules/reimbursements-pdf.util.spec.ts`, `test/modules/reimbursements.service.spec.ts`

- [ ] **Step 1: Extender opciones del PDF (orientación/tamaño + categoría)**

En `reimbursements-pdf.util.ts`, agregar arriba (después de `ReceiptsPerPage`):

```typescript
/** Orientación de la hoja. */
export type PageOrientation = 'portrait' | 'landscape';

/** Tamaño de hoja soportado. */
export type PageSize = 'A4' | 'letter';

/** Opciones de composición del lote (spec §5.7). */
export interface ComposeOptions {
  perPage: ReceiptsPerPage;
  orientation?: PageOrientation;
  size?: PageSize;
}

/** Dimensiones base por tamaño (puntos), en vertical. */
const PAGE_SIZES: Readonly<Record<PageSize, { width: number; height: number }>> = {
  A4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};
```

Y agregar `category` al `ReceiptForPdf`:

```typescript
  categoryLabel: string;
```

Cambiar la firma de `composeReceiptsPdf` para recibir `ComposeOptions` en vez de `perPage`:

```typescript
export async function composeReceiptsPdf(
  receipts: readonly ReceiptForPdf[],
  options: ComposeOptions,
): Promise<Uint8Array> {
  const { perPage } = options;
  const base = PAGE_SIZES[options.size ?? 'A4'];
  const page =
    (options.orientation ?? 'portrait') === 'landscape'
      ? { width: base.height, height: base.width }
      : base;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { cols, rows } = GRID[perPage];
  const usableW = page.width - MARGIN * 2;
  const usableH = page.height - MARGIN * 2;
  const cellW = (usableW - (cols - 1) * GAP) / cols;
  const cellH = (usableH - (rows - 1) * GAP) / rows;

  let pdfPage: PDFPage | null = null;
  for (let i = 0; i < receipts.length; i += 1) {
    const slot = i % perPage;
    if (slot === 0) {
      pdfPage = doc.addPage([page.width, page.height]);
    }
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = MARGIN + col * (cellW + GAP);
    const yBottom = page.height - MARGIN - row * (cellH + GAP) - cellH;
    await drawCell(doc, pdfPage as PDFPage, font, fontBold, receipts[i] as ReceiptForPdf, x, yBottom, cellW, cellH);
  }

  return doc.save();
}
```

Eliminar la constante `A4` local (líneas 20-21) — reemplazada por `PAGE_SIZES`. En `drawCell`, agregar la categoría a la línea meta (línea ~111-117):

```typescript
  const meta = truncate(
    `${receipt.requesterName}  -  ${receipt.dateLabel}  -  ${receipt.amountLabel}  -  ${receipt.categoryLabel}`,
    font,
    7.5,
    w - CELL_PAD * 2,
  );
```

- [ ] **Step 2: Test del PDF util**

`test/modules/reimbursements-pdf.util.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { composeReceiptsPdf, sniffReceiptKind } from '../../src/modules/reimbursements/reimbursements-pdf.util';
import type { ReceiptForPdf } from '../../src/modules/reimbursements/reimbursements-pdf.util';

// PNG 1x1 mínimo válido.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function receipt(): ReceiptForPdf {
  return {
    concept: 'Bencina',
    amountLabel: '$25.990',
    categoryLabel: 'Vehículos',
    requesterName: 'Ana Pérez',
    dateLabel: '2026-07-05',
    bytes: PNG_1x1,
    kind: sniffReceiptKind(PNG_1x1),
  };
}

describe('composeReceiptsPdf', () => {
  it('genera un PDF (bytes %PDF) en A4 portrait por defecto', async () => {
    const pdf = await composeReceiptsPdf([receipt()], { perPage: 2 });
    expect(Buffer.from(pdf.slice(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('acepta landscape + letter sin romper', async () => {
    const pdf = await composeReceiptsPdf([receipt(), receipt()], { perPage: 4, orientation: 'landscape', size: 'letter' });
    expect(pdf.byteLength).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 3: Correr el test del PDF**

Run: `pnpm exec vitest run test/modules/reimbursements-pdf.util.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: `PrintReimbursementsDto` con orientación/tamaño + `MarkPrintedDto` + filtro por `printed`**

En `reimbursements.dto.ts`, reemplazar `PrintReimbursementsDto` por:

```typescript
export class PrintReimbursementsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecciona al menos un reembolso.' })
  @ArrayMaxSize(200, { message: 'No se pueden imprimir más de 200 boletas a la vez.' })
  @IsString({ each: true })
  ids!: string[];

  @Type(() => Number)
  @IsIn([2, 4, 6], { message: 'perPage debe ser 2, 4 o 6.' })
  perPage!: 2 | 4 | 6;

  @IsOptional()
  @IsIn(['portrait', 'landscape'], { message: 'orientation inválida.' })
  orientation?: 'portrait' | 'landscape';

  @IsOptional()
  @IsIn(['A4', 'letter'], { message: 'size inválido.' })
  size?: 'A4' | 'letter';
}

/** Body de `POST /reimbursements/print/mark` — marca impresas tras confirmar descarga. */
export class MarkPrintedDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecciona al menos un reembolso.' })
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}
```

Agregar `printed?: boolean` a `ListReimbursementsQueryDto` para el selector "pendientes de impresión":

```typescript
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  printed?: boolean;
```

Agregar `IsBoolean` al import de `class-validator`. Y en `ListReimbursementsFilters` (service) + `buildReimbursementWhere` agregar `printed?: boolean` → `if (f.printed !== undefined) where.printed = f.printed;`.

- [ ] **Step 5: `generateBatchPdf` con opciones + `markPrinted` en el service**

En `reimbursements.service.ts`, cambiar la firma de `generateBatchPdf` (línea 118):

```typescript
  async generateBatchPdf(ids: string[], options: ComposeOptions): Promise<Uint8Array> {
```

Y dentro, al armar cada `receipts.push(...)` (líneas 139-146) agregar `categoryLabel`:

```typescript
      receipts.push({
        concept: row.concept,
        amountLabel: formatClp(row.amount),
        categoryLabel: row.category ?? 'Sin categoría',
        requesterName: `${row.user.firstName} ${row.user.lastName}`,
        dateLabel: row.date.toISOString().slice(0, 10),
        bytes,
        kind: sniffReceiptKind(bytes),
      });
```

Cambiar la última línea `return composeReceiptsPdf(receipts, perPage);` por `return composeReceiptsPdf(receipts, options);`. Actualizar el import de tipos (línea 18): `import type { ReceiptForPdf, ComposeOptions } from './reimbursements-pdf.util';` (quitar `ReceiptsPerPage` si ya no se usa).

Agregar el método `markPrinted` (después de `generateBatchPdf`):

```typescript
  /** Marca como impresas las boletas indicadas (post-descarga, spec §5.7). */
  async markPrinted(ids: string[]): Promise<{ marked: number }> {
    if (ids.length === 0) return { marked: 0 };
    const res = await this.prisma.reimbursement.updateMany({
      where: { id: { in: ids } },
      data: { printed: true, printedAt: new Date() },
    });
    return { marked: res.count };
  }
```

Agregar `updateMany` al `PrismaParts`/`buildPrisma` del spec (para poder testear): en `PrismaParts` añadir `updateMany: ReturnType<typeof vi.fn>;` y en `buildPrisma` `updateMany: parts.updateMany ?? vi.fn(() => Promise.resolve({ count: 0 })),`.

- [ ] **Step 6: Tests de service (print/mark)**

En `reimbursements.service.spec.ts` agregar:

```typescript
  it('generateBatchPdf usa receiptKey y arma el PDF', async () => {
    const findMany = vi.fn(() => Promise.resolve([buildRowWithRequester({ receiptKey: 'reimbursements/a.png', receiptUrl: 'https://r2/x?sig=1' })]));
    const read = vi.fn(() => Promise.resolve(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')));
    const prisma = { reimbursement: { findMany } } as unknown as PrismaService;
    const storage = { save: vi.fn(), delete: vi.fn(), read } as unknown as StorageService;
    const config = { get: vi.fn(() => undefined) } as unknown as import('@nestjs/config').ConfigService;
    const service = new ReimbursementsService(prisma, storage, notifBits.notifications, config);

    const pdf = await service.generateBatchPdf(['r-1'], { perPage: 2 });
    expect(read).toHaveBeenCalledWith('reimbursements/a.png');
    expect(Buffer.from(pdf.slice(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('markPrinted marca impresas por id', async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const { prisma } = buildPrisma({ updateMany });
    const service = makeService(prisma);

    const res = await service.markPrinted(['a', 'b']);
    const call = updateMany.mock.calls[0]?.[0] as { data: { printed: boolean } };
    expect(call.data.printed).toBe(true);
    expect(res.marked).toBe(2);
  });
```

- [ ] **Step 7: Correr los tests**

Run: `pnpm exec vitest run test/modules/reimbursements.service.spec.ts test/modules/reimbursements-pdf.util.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/reimbursements test/modules/reimbursements.service.spec.ts test/modules/reimbursements-pdf.util.spec.ts
git commit -m "feat(finanzas): impresión en lote con orientación/tamaño, categoría en la tabla y marcado impresa post-descarga"
```

---

## Task 12: Reembolsos — gating por permiso (inline) + endpoints nuevos

**Files:**
- Modify: `src/modules/reimbursements/reimbursements.controller.ts`
- Test: `test/modules/reimbursements.controller.spec.ts` (nuevo)

- [ ] **Step 1: Reescribir el controller con `PermissionService.can` inline**

Reemplazar `reimbursements.controller.ts` completo por:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { PermissionService } from '../../authz/permission.service';
import { ReimbursementsService } from './reimbursements.service';
import {
  CreateReimbursementDto,
  ImportReimbursementsDto,
  ListReimbursementsQueryDto,
  MarkPrintedDto,
  PrintReimbursementsDto,
  RejectReimbursementDto,
} from './dto/reimbursements.dto';
import type { ReceiptScanResult, ReimbursementView } from './reimbursements.types';
import type { ReimbursementSummary } from './reimbursements-summary.util';

/** Permisos funcionales de finanzas (spec §2.2). */
const P_CREATE = 'finance:request:create';
const P_VIEW_ALL = 'finance:request:view:all';
const P_APPROVE = 'finance:request:approve';
const P_PAY = 'finance:payment:register';
const P_PRINT = 'finance:print:batch';

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
]);

/**
 * Reembolsos (spec §5). Gating por PERMISO FUNCIONAL vía `PermissionService.can`
 * inline (patrón ClientsController), no por FGA. Rutas propias (`/me`, crear,
 * boleta, scan) requieren `finance:request:create`; la gestión requiere el permiso
 * específico. `/me`, `/summary`, `/scan-receipt`, `/print` se declaran ANTES de `:id`.
 */
@Controller('reimbursements')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ReimbursementsController {
  constructor(
    private readonly reimbursements: ReimbursementsService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateReimbursementDto,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    return this.reimbursements.create(userId, dto);
  }

  @Post('import')
  async importBatch(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: ImportReimbursementsDto,
  ): Promise<ReimbursementView[]> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    return this.reimbursements.importBatch(userId, dto);
  }

  /** OCR de boleta: imagen multipart → campos sugeridos (spec §5.5). */
  @Post('scan-receipt')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async scanReceipt(
    @CurrentUser() authUser: AuthUser | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReceiptScanResult> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    const checked = this.requireValidFile(file);
    const dataUrl = `data:${checked.mimetype};base64,${checked.buffer.toString('base64')}`;
    return this.reimbursements.scanReceipt(dataUrl);
  }

  @Post('print')
  @HttpCode(200)
  async print(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: PrintReimbursementsDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.require(this.requireUserId(authUser), P_PRINT);
    const pdf = await this.reimbursements.generateBatchPdf(dto.ids, {
      perPage: dto.perPage,
      orientation: dto.orientation,
      size: dto.size,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="boletas-reembolsos.pdf"');
    res.end(Buffer.from(pdf));
  }

  @Post('print/mark')
  @HttpCode(200)
  async markPrinted(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: MarkPrintedDto,
  ): Promise<{ marked: number }> {
    await this.require(this.requireUserId(authUser), P_PRINT);
    return this.reimbursements.markPrinted(dto.ids);
  }

  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<ReimbursementView[]> {
    return this.reimbursements.listMine(this.requireUserId(authUser), query.status);
  }

  @Get('summary')
  async summary(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<ReimbursementSummary> {
    await this.require(this.requireUserId(authUser), P_VIEW_ALL);
    return this.reimbursements.summary(this.toFilters(query));
  }

  @Get()
  async listAll(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<ReimbursementView[]> {
    await this.require(this.requireUserId(authUser), P_VIEW_ALL);
    return this.reimbursements.listAll(this.toFilters(query));
  }

  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    const isManager = (await this.permissions.can(userId, P_VIEW_ALL)).effect === 'allow';
    return this.reimbursements.getById(id, userId, isManager);
  }

  @Post(':id/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async attachReceipt(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    const checked = this.requireValidFile(file);
    return this.reimbursements.attachReceipt(userId, id, checked);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.reimbursements.approve(userId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectReimbursementDto,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.reimbursements.reject(userId, id, dto.reason);
  }

  @Post(':id/pay')
  @HttpCode(200)
  async pay(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_PAY);
    return this.reimbursements.pay(userId, id);
  }

  private toFilters(q: ListReimbursementsQueryDto) {
    return {
      status: q.status,
      userId: q.userId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      date: q.date,
      month: q.month,
      order: q.order,
      printed: q.printed,
    };
  }

  private async require(userId: string, permissionKey: string): Promise<void> {
    const decision = await this.permissions.can(userId, permissionKey);
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para esta acción de finanzas.');
    }
  }

  private requireValidFile(file: Express.Multer.File | undefined): {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  } {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException('El archivo debe ser PDF o imagen (PNG/JPEG/WebP/HEIC).');
    }
    return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
```

> Nota: se agrega `printed` a `ListReimbursementsFilters` (Task 11 Step 4). Si aún no está, agregarlo ahí.

- [ ] **Step 2: Test de gating del controller (nuevo)**

`test/modules/reimbursements.controller.spec.ts`:

```typescript
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReimbursementsController } from '../../src/modules/reimbursements/reimbursements.controller';
import type { ReimbursementsService } from '../../src/modules/reimbursements/reimbursements.service';
import type { PermissionService } from '../../src/authz/permission.service';

function make(effect: 'allow' | 'deny') {
  const service = {
    create: vi.fn(() => Promise.resolve({ id: 'r-1' })),
    listAll: vi.fn(() => Promise.resolve([])),
    approve: vi.fn(() => Promise.resolve({ id: 'r-1' })),
  } as unknown as ReimbursementsService;
  const can = vi.fn(() => Promise.resolve({ effect, filter: { kind: 'none' } }));
  const permissions = { can } as unknown as PermissionService;
  return { controller: new ReimbursementsController(service, permissions), service, can };
}

describe('ReimbursementsController gating', () => {
  const user = { id: 'u1' } as any;

  it('approve sin permiso => Forbidden y no llama al service', async () => {
    const { controller, service } = make('deny');
    await expect(controller.approve(user, 'r-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('approve con finance:request:approve => llama al service', async () => {
    const { controller, service, can } = make('allow');
    await controller.approve(user, 'r-1');
    expect(can).toHaveBeenCalledWith('u1', 'finance:request:approve');
    expect(service.approve).toHaveBeenCalledWith('u1', 'r-1');
  });

  it('listAll gatea con finance:request:view:all', async () => {
    const { controller, can } = make('allow');
    await controller.listAll(user, {} as any);
    expect(can).toHaveBeenCalledWith('u1', 'finance:request:view:all');
  });
});
```

- [ ] **Step 3: Correr el test**

Run: `pnpm exec vitest run test/modules/reimbursements.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src/modules/reimbursements/reimbursements.controller.ts test/modules/reimbursements.controller.spec.ts
git commit -m "feat(finanzas): gating por permiso funcional en reembolsos + endpoints scan-receipt/summary/print-mark"
```

---

## Task 13: Horas Extra — gating por permiso (inline) + endpoints `close`/`summary`

**Files:**
- Modify: `src/modules/overtime/overtime.controller.ts`
- Test: `test/modules/overtime.controller.spec.ts` (nuevo)

- [ ] **Step 1: Reescribir el controller de HE**

Reemplazar `overtime.controller.ts` completo por:

```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { PermissionService } from '../../authz/permission.service';
import { OvertimeService } from './overtime.service';
import {
  CloseOvertimeDto,
  CreateOvertimeDto,
  ListOvertimeQueryDto,
  RejectOvertimeDto,
} from './dto/overtime.dto';
import type { OvertimeView } from './overtime.types';
import type { OvertimeSummary } from './overtime-summary.util';

const P_CREATE = 'finance:request:create';
const P_ONBEHALF = 'finance:overtime:create:onbehalf';
const P_VIEW_ALL = 'finance:request:view:all';
const P_VIEW_OT = 'finance:overtime:view:all';
const P_APPROVE = 'finance:request:approve';
const P_PAY = 'finance:payment:register';

/**
 * Horas extra (spec §5.6). Gating por PERMISO FUNCIONAL inline. Crear requiere
 * `finance:request:create`; crear a nombre de otro / con fecha libre requiere
 * además `finance:overtime:create:onbehalf`. Ver todo requiere
 * `finance:request:view:all` O `finance:overtime:view:all` (subconjunto RH).
 */
@Controller('overtime')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class OvertimeController {
  constructor(
    private readonly overtime: OvertimeService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateOvertimeDto,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    const canOnBehalf = (await this.permissions.can(userId, P_ONBEHALF)).effect === 'allow';
    return this.overtime.create(userId, dto, canOnBehalf);
  }

  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<OvertimeView[]> {
    return this.overtime.listMine(this.requireUserId(authUser), query.status);
  }

  @Get('summary')
  async summary(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<OvertimeSummary> {
    await this.requireViewAll(this.requireUserId(authUser));
    return this.overtime.summary(this.toFilters(query));
  }

  @Get()
  async listAll(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<OvertimeView[]> {
    await this.requireViewAll(this.requireUserId(authUser));
    return this.overtime.listAll(this.toFilters(query));
  }

  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    const isManager = await this.hasViewAll(userId);
    return this.overtime.getById(id, userId, isManager);
  }

  /** Cierra un borrador propio con la hora de término. */
  @Post(':id/close')
  @HttpCode(200)
  close(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CloseOvertimeDto,
  ): Promise<OvertimeView> {
    return this.overtime.close(this.requireUserId(authUser), id, dto.endTime);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.overtime.approve(userId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectOvertimeDto,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.overtime.reject(userId, id, dto.reason);
  }

  @Post(':id/pay')
  @HttpCode(200)
  async pay(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_PAY);
    return this.overtime.pay(userId, id);
  }

  private toFilters(q: ListOvertimeQueryDto) {
    return {
      status: q.status,
      userId: q.userId,
      projectId: q.projectId,
      clientId: q.clientId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      date: q.date,
      month: q.month,
      order: q.order,
    };
  }

  /** "Ver todo" = tiene view:all O el subconjunto overtime:view:all (RH). */
  private async hasViewAll(userId: string): Promise<boolean> {
    if ((await this.permissions.can(userId, P_VIEW_ALL)).effect === 'allow') return true;
    return (await this.permissions.can(userId, P_VIEW_OT)).effect === 'allow';
  }

  private async requireViewAll(userId: string): Promise<void> {
    if (!(await this.hasViewAll(userId))) {
      throw new ForbiddenException('No tienes permiso para ver todas las horas extra.');
    }
  }

  private async require(userId: string, permissionKey: string): Promise<void> {
    if ((await this.permissions.can(userId, permissionKey)).effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para esta acción de finanzas.');
    }
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
```

- [ ] **Step 2: Test de gating del controller (nuevo)**

`test/modules/overtime.controller.spec.ts`:

```typescript
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OvertimeController } from '../../src/modules/overtime/overtime.controller';
import type { OvertimeService } from '../../src/modules/overtime/overtime.service';
import type { PermissionService } from '../../src/authz/permission.service';

function make(effects: Record<string, 'allow' | 'deny'>) {
  const service = {
    create: vi.fn(() => Promise.resolve({ id: 'o-1' })),
    listAll: vi.fn(() => Promise.resolve([])),
    approve: vi.fn(() => Promise.resolve({ id: 'o-1' })),
  } as unknown as OvertimeService;
  const can = vi.fn((_u: string, key: string) =>
    Promise.resolve({ effect: effects[key] ?? 'deny', filter: { kind: 'none' } }),
  );
  const permissions = { can } as unknown as PermissionService;
  return { controller: new OvertimeController(service, permissions), service, can };
}

describe('OvertimeController gating', () => {
  const user = { id: 'u1' } as any;

  it('create pasa canOnBehalf=true cuando tiene el permiso', async () => {
    const { controller, service } = make({ 'finance:request:create': 'allow', 'finance:overtime:create:onbehalf': 'allow' });
    await controller.create(user, { date: '2026-07-10T00:00:00.000Z', startTime: '09:00' } as any);
    expect(service.create).toHaveBeenCalledWith('u1', expect.anything(), true);
  });

  it('create sin onbehalf pasa canOnBehalf=false', async () => {
    const { controller, service } = make({ 'finance:request:create': 'allow', 'finance:overtime:create:onbehalf': 'deny' });
    await controller.create(user, { date: '2026-07-10T00:00:00.000Z', startTime: '09:00' } as any);
    expect(service.create).toHaveBeenCalledWith('u1', expect.anything(), false);
  });

  it('listAll permitido con solo overtime:view:all (RH)', async () => {
    const { controller, service } = make({ 'finance:request:view:all': 'deny', 'finance:overtime:view:all': 'allow' });
    await controller.listAll(user, {} as any);
    expect(service.listAll).toHaveBeenCalled();
  });

  it('listAll denegado sin ningún view => Forbidden', async () => {
    const { controller } = make({ 'finance:request:view:all': 'deny', 'finance:overtime:view:all': 'deny' });
    await expect(controller.listAll(user, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 3: Correr el test**

Run: `pnpm exec vitest run test/modules/overtime.controller.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add src/modules/overtime/overtime.controller.ts test/modules/overtime.controller.spec.ts
git commit -m "feat(finanzas): gating por permiso funcional en HE + endpoints close/summary"
```

---

## Task 14: Limpieza de módulos + verificación integral

**Files:**
- Modify: `src/modules/reimbursements/reimbursements.module.ts`
- Modify: `src/modules/overtime/overtime.module.ts`

- [ ] **Step 1: Actualizar los comentarios/doc de los módulos (los providers no cambian)**

`PermissionService` y `ConfigService` son GLOBAL (AuthzModule `@Global`, ConfigModule `isGlobal:true`) → **no** hace falta agregarlos a `imports`. Verificar que ambos módulos siguen así y actualizar el JSDoc para reflejar que el gating ahora es por `PermissionService` (no FGA). En `reimbursements.module.ts` reemplazar el JSDoc por:

```typescript
/**
 * Módulo de reembolsos (spec §5). Consume `PrismaService`, `StorageService`,
 * `ConfigService` (OCR) y `PermissionService` (gating por permiso funcional) —
 * todos globales. Importa `NotificationsModule` para avisar al solicitante.
 */
```

En `overtime.module.ts`:

```typescript
/**
 * Módulo de horas extra (spec §5.6). Consume `PrismaService` y `PermissionService`
 * (gating por permiso funcional), ambos globales. Importa `NotificationsModule`
 * para avisar al solicitante en cada transición.
 */
```

- [ ] **Step 2: Typecheck completo del proyecto de test**

Run: `pnpm exec tsc -p tsconfig.test.json`
Expected: sin errores.

- [ ] **Step 3: Correr toda la suite de finanzas**

Run:
```bash
pnpm exec vitest run test/modules/finance-month.util.spec.ts test/modules/overtime-hours.util.spec.ts test/modules/receipt-ocr.util.spec.ts test/modules/reimbursements-summary.util.spec.ts test/modules/overtime-summary.util.spec.ts test/modules/reimbursements-pdf.util.spec.ts test/modules/reimbursements.service.spec.ts test/modules/overtime.service.spec.ts test/modules/reimbursements.controller.spec.ts test/modules/overtime.controller.spec.ts
```
Expected: todos PASS.

- [ ] **Step 4: Suite completa + build del backend (no romper el resto)**

Run: `pnpm test`
Expected: `tsc -p tsconfig.test.json` OK + `vitest run` verde (toda la suite, no solo finanzas).

Run: `pnpm exec tsc -p tsconfig.build.json --noEmit` (o `pnpm build` desde la raíz si aplica al backend)
Expected: compila sin errores (el controller ya no importa `FgaService`/`RequirePermission`; confirmar que no queden imports muertos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/reimbursements/reimbursements.module.ts src/modules/overtime/overtime.module.ts
git commit -m "chore(finanzas): actualizar doc de módulos (gating por permiso) y verificación integral"
```

---

## Self-Review

**1. Spec coverage:**
- §2.4 rejectionReason (Reimbursement + Overtime) → Task 1, 7, 9. ✓
- §2.4 printed/printedAt (Reimbursement) → Task 1, 11. ✓
- §2.4 onBehalfOfUserId + draft/status (Overtime) → Task 1, 7. ✓
- §2.4 hora inicio/término (Overtime) → Task 1, 3, 7. ✓
- §5.5 categoría/subcategoría/vehículo + observaciones (Reimbursement) → Task 1, 9. ✓
- §2.4 HE fecha=hoy salvo onbehalf → Task 7 (create con `canOnBehalf`). ✓
- §2.4 cierre mes día 20 helper → Task 2 (`accountingMonth`/`monthRange`). ✓
- §2.4 onBehalf → Task 7 + Task 13 (controller resuelve permiso). ✓
- §5.5 scan-receipt OCR (patrón detectShoreline) → Task 5, 10, 12. ✓
- §5 aprobar/rechazar con motivo → Task 7, 9 (persistencia) + gating Task 12/13. ✓
- §5 registrar pago → gating `finance:payment:register` Task 12/13. ✓
- §5.3 listado con filtros (trabajador/fecha/mes/proyecto/cliente + orden) → Task 8 (HE), Task 10 (reembolsos, sin proyecto/cliente por diseño §7). ✓
- §5.2 agregaciones para las cards → Task 8 (`summary` HE), Task 10 (`summary` reembolsos). ✓
- §5.7 impresión en lote (selección/orientación/tamaño/marcado impresa) → Task 11, 12. Preview del PDF = front (usa `POST /print` sin marcar). ✓
- §5.5/§5.7 fix extractStorageKey/generateBatchPdf para keys R2 → Task 4. ✓
- §3.1 gating por permiso inline (`PermissionService.can`) → Task 12, 13. ✓
- **Gaps aceptados/documentados:** reembolsos sin proyecto/cliente (Decisión 7); paginación client-side (Decisión 8); preview PDF en front; import/liquidations sin tocar en backend (Decisiones 1, 2). El "carrusel 2 estados" y auto-alternar 5s son de frontend; el backend entrega los datos (`rankingByWorker`, `byProject`, contadores). Selección de "Autorizado por" (dropdown usuarios admin_contrato/gerencias) → el backend ya expone `PermissionService.usersWithPermissionOnProject`; el dropdown lo arma el front (fuera de este plan de datos; `authorizedById` se persiste).

**2. Placeholder scan:** Sin "TBD/TODO/similar a Task N". El único bloque intencionalmente inválido (Task 8 Step 1, tercer test) trae su reemplazo explícito antes de correr. Todos los pasos de código muestran código real.

**3. Type consistency:** `ComposeOptions` (pdf util) usado consistente en service (Task 11) y controller (Task 12). `ReceiptScanResult` definido en `receipt-ocr.util.ts` (Task 5), re-exportado por `reimbursements.types.ts` (Task 6) y usado por el controller (Task 12). `ListReimbursementsFilters`/`ListOvertimeFilters` extendidos y consumidos por `buildReimbursementWhere`/`buildOvertimeWhere`. `computeHours`/`accountingMonth`/`monthRange`/`summarizeOvertime`/`summarizeReimbursements` con firmas estables entre util, service y tests. `create(creatorId, dto, canOnBehalf)` en overtime service coincide con la llamada del controller (Task 13) y de los tests (Task 7).

---

## Notas de retrocompatibilidad (spec §Arquitectura: web/web-dev comparten api/BD)

- **Migración**: solo `ADD COLUMN` + relajar NULL en `hours`/`reason` → segura para `web` prod (que no envía los campos nuevos). Filas legacy: `startTime/endTime/hours` pueden quedar como estaban (no null en las que ya tenían `hours`); las nuevas HE en borrador tienen `hours=null` (por eso se relajó).
- **Endpoints**: `GET /reimbursements` y `GET /overtime` **siguen devolviendo array**. Nuevos endpoints (`/summary`, `/scan-receipt`, `/print/mark`, `/:id/close`) son aditivos.
- **Gating**: el cambio de FGA→permiso es transparente si el seed (plan de roles) otorga los permisos de finanzas a los roles correctos y `SUPER_ADMIN_IDS`/`org_admin` cortocircuitan. **Dependencia de despliegue:** este backend debe promoverse junto con el seed de permisos; documentar en el runbook de Fase 1b.
