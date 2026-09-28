# Checklist de vehículos: formulario por pasos, sin login y envío por correo — Plan de implementación

> **Para quien lo ejecute:** los pasos usan casillas (`- [ ]`) para ir marcando.
> Cada tarea termina en commit. Se ejecutan en orden: la 3 depende de la 2, la 6
> de la 5, y la 9 de la 8.

**Objetivo:** que el checklist de un vehículo se pueda llenar desde el QR con o
sin cuenta, en pasos, y que el PDF llegue por correo.

**Arquitectura:** el motor de pasos y el PDF ya existen. El trabajo es (a)
rellenar las secciones que faltan en las plantillas de producción, (b) abrir un
camino público de envío junto al autenticado sin tocar este último, (c) llenar
el bloque de datos del conductor que el PDF ya reserva, y (d) compartir los
componentes visuales del formulario de HSE.

**Stack:** NestJS 11 + Prisma 6 + Zod (backend), React 19 + Vite + Tailwind v4
(web), vitest en ambos, pdf-lib para el PDF, Brevo vía `EmailService`.

**Especificación:** `docs/superpowers/specs/2026-09-28-checklist-vehiculos-formulario-design.md`

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `nodes/web/src/components/form-wizard/index.ts` | Barril de los componentes compartidos |
| `nodes/web/src/components/form-wizard/pantalla.tsx` | `Pantalla`, `Campo`, `Aviso`, `Segmentado` |
| `nodes/web/src/components/form-wizard/barra-pasos.tsx` | Indicador de progreso |
| `nodes/web/src/components/form-wizard/selector-fecha.tsx` | `SelectorFecha` (movido) |
| `nodes/web/src/components/form-wizard/selector-hora.tsx` | `SelectorHora` + `Columna` (movido) |
| `nodes/web/src/pages/checklist/paso-identificacion.tsx` | Elegir login o sin cuenta |
| `nodes/web/src/pages/checklist/paso-conductor.tsx` | Nombre y licencias |
| `nodes/web/src/pages/checklist/paso-cierre.tsx` | Correo, firma y envío |
| `nodes/backend-central/src/modules/assets/checklist-conductor.util.ts` | Arma `datosConductor` del PDF (puro) |
| `nodes/backend-central/scripts/backfill-checklist-sections.ts` | Relleno de secciones |
| `nodes/backend-central/test/modules/assets/checklist-conductor.spec.ts` | Tests del util |
| `nodes/backend-central/test/modules/assets/checklist-publico.spec.ts` | Tests del envío público |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `nodes/backend-central/prisma/schema.prisma` | Campos de invitado; `fileUrl` opcional |
| `nodes/backend-central/src/modules/assets/checklist-formato.builder.ts` | Llenar `datosConductor` |
| `nodes/backend-central/src/modules/assets/assets.service.ts` | `submitPublicChecklist`, correo |
| `nodes/backend-central/src/modules/assets/assets.controller.ts` | Endpoint público |
| `nodes/backend-central/src/modules/assets/dto/assets.dto.ts` | DTO del envío público |
| `nodes/web/src/pages/public/incidente.tsx` | Importa los componentes extraídos |
| `nodes/web/src/pages/public/incidente-campos.tsx` | Re-exporta desde `form-wizard` |
| `nodes/web/src/pages/checklist/llenar-checklist.tsx` | Orquesta los pasos nuevos |
| `nodes/web/src/lib/api.ts` | `submitPublicChecklist` |
| `nodes/web/src/pages/recursos/historial-checklists.tsx` | Marca "sin verificar" |
| `packages/contracts/src/index.ts` | Tipos del envío público |

---

## Tarea 1: Extraer los componentes visuales del formulario de HSE

Refactor puro. El formulario de HSE debe verse y comportarse igual al terminar.

**Archivos:**
- Crear: `nodes/web/src/components/form-wizard/pantalla.tsx`
- Crear: `nodes/web/src/components/form-wizard/barra-pasos.tsx`
- Crear: `nodes/web/src/components/form-wizard/selector-fecha.tsx`
- Crear: `nodes/web/src/components/form-wizard/selector-hora.tsx`
- Crear: `nodes/web/src/components/form-wizard/index.ts`
- Modificar: `nodes/web/src/pages/public/incidente.tsx`
- Modificar: `nodes/web/src/pages/public/incidente-campos.tsx`

- [ ] **Paso 1: Mover `Pantalla`, `Campo`, `Aviso` y `Segmentado`**

Cortar las cuatro funciones de `incidente.tsx` (líneas ~471-596) y pegarlas
**textualmente** en `pantalla.tsx`, agregando `export` a cada una y el import de
`ReactNode`. No cambiar ni una clase de Tailwind: cualquier diferencia visual en
este paso es un error, no una mejora.

```tsx
/**
 * Piezas visuales compartidas por los formularios públicos por pasos
 * (reporte de incidentes de HSE y checklist de vehículos).
 *
 * Salieron tal cual de `pages/public/incidente.tsx`, que era donde vivían como
 * funciones locales. Es el mismo marcado: si algo se ve distinto, es un bug.
 */
import type { ReactNode } from 'react';

export function Pantalla({ children }: { children: ReactNode }): ReactNode {
  // ← cuerpo textual del original
}

export function Aviso({ mensaje }: { mensaje: string }): ReactNode {
  // ← cuerpo textual del original
}

export function Campo(/* ← firma textual del original */) {
  // ← cuerpo textual del original
}

export function Segmentado(/* ← firma textual del original */) {
  // ← cuerpo textual del original
}
```

- [ ] **Paso 2: Extraer la barra de pasos**

En `incidente.tsx` el indicador está inline (líneas ~375-385). Sacarlo a un
componente con las mismas clases:

```tsx
/** Indicador "Paso X de N" con las barritas de avance. */
export function BarraPasos({ paso, total }: { paso: number; total: number }): ReactNode {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Paso {paso + 1} de {total}
      </p>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuenow={paso + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label="Avance del formulario"
      >
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={/* ← misma expresión de clases del original */}
          />
        ))}
      </div>
    </>
  );
}
```

- [ ] **Paso 3: Mover los selectores de fecha y hora**

Mover `SelectorFecha` (con sus helpers `iso`, `partes`, `hoyIso`, `fechaLarga`,
`primerDiaSemana`, `diasDelMes`) a `selector-fecha.tsx`, y `SelectorHora` con
`Columna` a `selector-hora.tsx`. `MapaArea` **se queda** en
`incidente-campos.tsx`: es específico de HSE y el checklist no lo usa.

- [ ] **Paso 4: Crear el barril**

```ts
export { Pantalla, Aviso, Campo, Segmentado } from './pantalla';
export { BarraPasos } from './barra-pasos';
export { SelectorFecha } from './selector-fecha';
export { SelectorHora } from './selector-hora';
```

- [ ] **Paso 5: Apuntar el formulario de HSE a los componentes nuevos**

En `incidente.tsx`, borrar las funciones movidas y agregar:

```tsx
import { Pantalla, Aviso, Campo, Segmentado, BarraPasos } from '@/components/form-wizard';
```

Reemplazar el bloque inline del indicador por `<BarraPasos paso={paso} total={PASOS.length} />`.

En `incidente-campos.tsx`, borrar `SelectorFecha` y `SelectorHora` y re-exportar
para no romper los imports existentes:

```tsx
export { SelectorFecha } from '@/components/form-wizard/selector-fecha';
export { SelectorHora } from '@/components/form-wizard/selector-hora';
```

- [ ] **Paso 6: Verificar que compila y que HSE no cambió**

```bash
pnpm --filter @gmt-platform/web build
```

Esperado: build sin errores.

Luego abrir el formulario público de incidentes en el navegador y recorrer los
cinco pasos. Debe verse idéntico. **No seguir si algo cambió.**

- [ ] **Paso 7: Commit**

```bash
git add nodes/web/src/components/form-wizard nodes/web/src/pages/public
git commit -m "refactor(web): los pasos del formulario de HSE pasan a componentes compartidos"
```

---

## Tarea 2: Migración de base de datos

**Archivos:**
- Modificar: `nodes/backend-central/prisma/schema.prisma`
- Crear: `nodes/backend-central/prisma/migrations/20260928120000_checklist_invitado/migration.sql`

- [ ] **Paso 1: Agregar los campos de invitado a `ChecklistSubmission`**

Dentro del bloque de procedencia externa, después de `externalAuthor`:

```prisma
  // ── Quien llenó el checklist SIN cuenta en GMT Link ──
  // Van juntos y separados de `userId` a propósito: son datos DECLARADOS por
  // quien llenó el formulario y nadie los verificó. No se reutiliza
  // `externalAuthor`, que significa otra cosa ("vino importado de la planilla").
  // Un envío es "sin verificar" cuando userId y externalSource son ambos null;
  // no se guarda una columna de estado porque sería redundante y se
  // desincronizaría.
  guestName           String?
  guestLicenseClass   String?
  guestLicenseExpiry  DateTime?
  guestInternalExpiry DateTime?
  guestEmail          String?
```

- [ ] **Paso 2: Volver opcional el archivo del documento personal**

En `model PersonalDocument`:

```prisma
  /// OPCIONAL: se admite el documento "placeholder", con la fecha de
  /// vencimiento cargada y el archivo pendiente. Es el caso del conductor que
  /// declara su licencia al llenar un checklist: la fecha sirve de inmediato
  /// para las alertas de vencimiento, y queda el recordatorio de subir el PDF
  /// o la foto. Sin esto habría que inventar una URL falsa para poder guardar
  /// la fecha.
  fileUrl         String?
```

- [ ] **Paso 3: Generar la migración**

```bash
cd nodes/backend-central && pnpm prisma migrate dev --name checklist_invitado
```

Esperado: crea la carpeta de migración y regenera el cliente. Revisar que el SQL
solo tenga `ALTER TABLE ... ADD COLUMN` y `ALTER COLUMN "fileUrl" DROP NOT NULL`.

- [ ] **Paso 4: Arreglar lo que rompa el `fileUrl` opcional**

```bash
pnpm --filter @gmt-platform/api typecheck
```

Donde el compilador marque que `fileUrl` puede ser `null`, tratar ese caso
explícitamente (un documento sin archivo **no** se puede descargar: devolver el
error correspondiente, no una URL vacía).

- [ ] **Paso 5: Commit**

```bash
git add nodes/backend-central/prisma
git commit -m "feat(checklist): campos de invitado y documento personal sin archivo"
```

---

## Tarea 3: Rellenar las secciones de las plantillas de producción

**Archivos:**
- Crear: `nodes/backend-central/scripts/backfill-checklist-sections.ts`

- [ ] **Paso 1: Escribir el script**

```ts
import { PrismaClient } from '@prisma/client';
import {
  CHECKLIST_VEHICULO_GMT,
  SECCIONES_CHECKLIST_VEHICULO,
} from '@gmt-platform/contracts';

/**
 * Le devuelve las secciones a las plantillas de vehículos que ya viven en
 * producción.
 *
 * El motor de pasos (`ChecklistFillBody`) pagina por `template.sections`, pero
 * las plantillas se sembraron sin ellas y sin `section` en cada ítem: los 73
 * ítems se dibujan en una sola página. Esto copia la sección desde la
 * definición canónica, que comparte los ids.
 *
 * IDEMPOTENTE: correrlo dos veces da el mismo resultado. NO toca etiquetas,
 * opciones, orden ni envíos históricos.
 */

const prisma = new PrismaClient();

/** Sección canónica de cada id de ítem. */
const SECCION_DE = new Map(
  CHECKLIST_VEHICULO_GMT.filter((i) => i.section).map((i) => [i.id, i.section as string]),
);

async function main(): Promise<void> {
  const seco = !process.argv.includes('--apply');
  const plantillas = await prisma.checklistTemplate.findMany({
    select: { id: true, name: true, items: true, sections: true, assetId: true },
  });

  let tocadas = 0;
  for (const plantilla of plantillas) {
    const items = Array.isArray(plantilla.items) ? plantilla.items : [];
    if (items.length === 0) continue;

    // ¿Es una plantilla de vehículo? Se decide por los ids, no por el nombre
    // del activo: el nombre lo escribe una persona y no es confiable.
    const reconocidos = items.filter(
      (i) => typeof i === 'object' && i !== null && SECCION_DE.has(String((i as { id?: unknown }).id)),
    ).length;
    if (reconocidos < items.length / 2) continue;

    const nuevos = items.map((item) => {
      if (typeof item !== 'object' || item === null) return item;
      const registro = item as Record<string, unknown>;
      const seccion = SECCION_DE.get(String(registro.id));
      // Un ítem que no está en la canónica se deja intacto: cae en la página
      // "General", que el front ya contempla. Perder un ítem sería peor.
      return seccion ? { ...registro, section: seccion } : registro;
    });

    console.log(
      '%s  %s ítems, %s reconocidos%s',
      plantilla.id,
      items.length,
      reconocidos,
      seco ? '  (simulación)' : '',
    );
    tocadas += 1;

    if (!seco) {
      await prisma.checklistTemplate.update({
        where: { id: plantilla.id },
        data: { items: nuevos, sections: SECCIONES_CHECKLIST_VEHICULO },
      });
    }
  }

  console.log('\nplantillas %s: %d', seco ? 'que se actualizarían' : 'actualizadas', tocadas);
  if (seco) console.log('Para aplicar de verdad: agregar --apply');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
```

- [ ] **Paso 2: Correrlo en simulación contra producción**

```bash
cd nodes/backend-central && pnpm tsx scripts/backfill-checklist-sections.ts
```

Esperado: lista 20 plantillas con 73 ítems y 73 reconocidos. Si alguna muestra
menos reconocidos que ítems, **parar** e investigar antes de aplicar.

- [ ] **Paso 3: Respaldar antes de escribir**

Volcar `id, items, sections` de las plantillas afectadas a un CSV en el
scratchpad. Es el botón de deshacer.

- [ ] **Paso 4: Aplicar**

```bash
cd nodes/backend-central && pnpm tsx scripts/backfill-checklist-sections.ts --apply
```

- [ ] **Paso 5: Verificar**

Consultar la base: las 20 plantillas de vehículos deben tener
`jsonb_array_length(sections) = 5` y el mismo `jsonb_array_length(items)` que
antes. El conteo de envíos no debe cambiar.

- [ ] **Paso 6: Commit**

```bash
git add nodes/backend-central/scripts/backfill-checklist-sections.ts
git commit -m "feat(checklist): script que devuelve las secciones a las plantillas vivas"
```

---

## Tarea 4: Llenar el bloque de datos del conductor en el PDF

**Archivos:**
- Crear: `nodes/backend-central/src/modules/assets/checklist-conductor.util.ts`
- Crear: `nodes/backend-central/test/modules/assets/checklist-conductor.spec.ts`
- Modificar: `nodes/backend-central/src/modules/assets/checklist-formato.builder.ts`

- [ ] **Paso 1: Escribir el test que falla**

```ts
import { describe, expect, it } from 'vitest';
import { construirDatosConductor } from '../../../src/modules/assets/checklist-conductor.util';

describe('construirDatosConductor', () => {
  it('usa la licencia del perfil cuando el checklist no la sobreescribe', () => {
    const filas = construirDatosConductor({
      nombre: 'Yerko Jara',
      licenciaPerfil: { clase: 'B', vence: new Date('2028-08-14T00:00:00Z') },
      acreditacionFaena: { vence: new Date('2026-08-14T00:00:00Z') },
      declarado: null,
    });
    expect(filas).toEqual([
      { etiqueta: 'Nombre del conductor:', valor: 'Yerko Jara' },
      { etiqueta: 'Licencia municipal:', valor: 'Clase B', vencimiento: '14-08-2028' },
      { etiqueta: 'Licencia interna:', valor: 'Sí', vencimiento: '14-08-2026' },
    ]);
  });

  it('lo declarado en el checklist manda sobre el perfil', () => {
    const filas = construirDatosConductor({
      nombre: 'Yerko Jara',
      licenciaPerfil: { clase: 'B', vence: new Date('2028-08-14T00:00:00Z') },
      acreditacionFaena: null,
      declarado: { nombre: null, clase: 'A4', vence: new Date('2030-01-31T00:00:00Z'), interna: null },
    });
    expect(filas[1]).toEqual({
      etiqueta: 'Licencia municipal:',
      valor: 'Clase A4',
      vencimiento: '31-01-2030',
    });
  });

  it('sin dato dice "No registrada", no queda en blanco', () => {
    const filas = construirDatosConductor({
      nombre: null,
      licenciaPerfil: null,
      acreditacionFaena: null,
      declarado: null,
    });
    expect(filas[0]).toEqual({ etiqueta: 'Nombre del conductor:', valor: 'Sin registrar' });
    expect(filas[1]).toEqual({ etiqueta: 'Licencia municipal:', valor: 'No registrada' });
    expect(filas[2]).toEqual({ etiqueta: 'Licencia interna:', valor: 'No registrada' });
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
cd nodes/backend-central && pnpm vitest run test/modules/assets/checklist-conductor.spec.ts
```

Esperado: FAIL, no encuentra el módulo.

- [ ] **Paso 3: Escribir el util**

```ts
import type { DatoCabecera } from './checklist-formato-pdf.util';

/**
 * Arma el bloque "datos del conductor" del PDF, que hasta ahora salía vacío.
 *
 * Tres fuentes, en orden de prioridad: lo que la persona DECLARÓ al llenar el
 * checklist (manda siempre, porque es lo que firmó), luego su documento de
 * RRHH, y al final nada. Lo que no hay se dice con todas sus letras: una celda
 * en blanco en un documento firmado se lee como "estaba todo bien".
 *
 * Módulo PURO: sin Prisma ni Nest.
 */

export interface Licencia {
  clase?: string | null;
  vence: Date | null;
}

export interface Declarado {
  nombre: string | null;
  clase: string | null;
  vence: Date | null;
  interna: Date | null;
}

export interface EntradaConductor {
  nombre: string | null;
  licenciaPerfil: Licencia | null;
  acreditacionFaena: { vence: Date | null } | null;
  declarado: Declarado | null;
}

function fechaCorta(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function construirDatosConductor(entrada: EntradaConductor): DatoCabecera[] {
  const nombre = entrada.declarado?.nombre?.trim() || entrada.nombre?.trim() || 'Sin registrar';

  const claseMunicipal = entrada.declarado?.clase ?? entrada.licenciaPerfil?.clase ?? null;
  const venceMunicipal = entrada.declarado?.vence ?? entrada.licenciaPerfil?.vence ?? null;
  const venceInterna = entrada.declarado?.interna ?? entrada.acreditacionFaena?.vence ?? null;

  const municipal: DatoCabecera = {
    etiqueta: 'Licencia municipal:',
    valor: claseMunicipal ? `Clase ${claseMunicipal}` : venceMunicipal ? 'Sí' : 'No registrada',
  };
  const vm = fechaCorta(venceMunicipal);
  if (vm) municipal.vencimiento = vm;

  const interna: DatoCabecera = {
    etiqueta: 'Licencia interna:',
    valor: venceInterna ? 'Sí' : 'No registrada',
  };
  const vi = fechaCorta(venceInterna);
  if (vi) interna.vencimiento = vi;

  return [{ etiqueta: 'Nombre del conductor:', valor: nombre }, municipal, interna];
}
```

- [ ] **Paso 4: Correr los tests hasta que pasen**

```bash
cd nodes/backend-central && pnpm vitest run test/modules/assets/checklist-conductor.spec.ts
```

Esperado: 3 passed.

- [ ] **Paso 5: Enchufarlo al builder**

En `checklist-formato.builder.ts`, agregar a `EntradaFormato` el campo
`conductorDatos: EntradaConductor` y reemplazar `datosConductor: []` por
`datosConductor: construirDatosConductor(entrada.conductorDatos)`.

En `assets.service.ts`, donde se arma la entrada, leer el documento personal de
licencia y la acreditación del usuario, y pasar lo declarado desde las columnas
de invitado del envío.

- [ ] **Paso 6: Verificar que el resto sigue pasando**

```bash
cd nodes/backend-central && pnpm vitest run test/modules/assets/
```

Esperado: todo verde, incluido `checklist-formato.spec.ts`.

- [ ] **Paso 7: Commit**

```bash
git add nodes/backend-central/src/modules/assets nodes/backend-central/test/modules/assets
git commit -m "feat(checklist): el PDF muestra los datos y licencias del conductor"
```

---

## Tarea 5: Envío público del checklist

**Archivos:**
- Modificar: `nodes/backend-central/src/modules/assets/dto/assets.dto.ts`
- Modificar: `nodes/backend-central/src/modules/assets/assets.service.ts`
- Modificar: `nodes/backend-central/src/modules/assets/assets.controller.ts`
- Crear: `nodes/backend-central/test/modules/assets/checklist-publico.spec.ts`

- [ ] **Paso 1: Escribir el DTO**

```ts
/**
 * Envío del checklist SIN sesión, desde el QR de la plaquita.
 *
 * Ojo con el `ValidationPipe`: corre con `whitelist` y `forbidNonWhitelisted`,
 * así que toda propiedad necesita al menos una regla de validación además del
 * `@Transform`, o el envío entero se cae con "property should not exist" (ya
 * pasó en producción con el formulario de incidentes).
 */
export class SubmitPublicChecklistDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsArray()
  answers!: Record<string, unknown>[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  guestName!: string;

  @IsEmail()
  @MaxLength(160)
  guestEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  guestLicenseClass?: string;

  @IsOptional()
  @IsISO8601()
  guestLicenseExpiry?: string;

  @IsOptional()
  @IsISO8601()
  guestInternalExpiry?: string;
}
```

- [ ] **Paso 2: Escribir los tests que fallan**

Con el Prisma mockeado, al estilo de `test/modules/hse.service.spec.ts`:

```ts
describe('submitPublicChecklist', () => {
  it('rechaza una plantilla que no es del activo del token', async () => { /* … */ });
  it('rechaza una plantilla que no está aprobada', async () => { /* … */ });
  it('guarda con userId null y los datos del invitado', async () => { /* … */ });
  it('no acepta firma: sin identidad no hay nada que verificar', async () => { /* … */ });
  it('valida las respuestas con el mismo Zod que el camino autenticado', async () => { /* … */ });
});
```

- [ ] **Paso 3: Correrlos y ver que fallan**

```bash
cd nodes/backend-central && pnpm vitest run test/modules/assets/checklist-publico.spec.ts
```

Esperado: FAIL, `submitPublicChecklist` no existe.

- [ ] **Paso 4: Implementar el método**

Método hermano de `submitChecklist`, **sin tocar el existente**. Resuelve el
token al activo, exige plantilla del activo y `APROBADO`, valida con
`this.validateAnswers`, y persiste con `userId: null` más las columnas de
invitado. Reutiliza la lógica de fallas/odómetro que ya corre en el camino
autenticado.

- [ ] **Paso 5: Exponer el endpoint**

```ts
/**
 * Envío del checklist SIN sesión. La credencial es el token opaco de la ficha,
 * igual que el resto de endpoints públicos del activo.
 *
 * Queda registrado como "sin verificar" (userId null, sin origen externo): se
 * guarda y se ve en el historial, pero el historial no finge que alguien
 * identificado lo firmó.
 */
@Throttle({ default: { limit: 6, ttl: 60_000 } })
@Post('public/:token/checklist')
submitPublicChecklist(
  @Param('token') token: string,
  @Body() dto: SubmitPublicChecklistDto,
): Promise<ChecklistSubmissionView> {
  return this.assets.submitPublicChecklist(token, dto);
}
```

- [ ] **Paso 6: Correr los tests hasta que pasen**

```bash
cd nodes/backend-central && pnpm test
```

Esperado: toda la suite verde.

- [ ] **Paso 7: Commit**

```bash
git add nodes/backend-central/src nodes/backend-central/test
git commit -m "feat(checklist): envio publico desde el QR, sin sesion"
```

---

## Tarea 6: Enviar el PDF por correo

**Archivos:**
- Modificar: `nodes/backend-central/src/modules/assets/assets.service.ts`
- Modificar: `nodes/backend-central/src/common/email-templates.ts`
- Modificar: `nodes/backend-central/src/modules/assets/assets.module.ts`

- [ ] **Paso 1: Verificar que `EmailService` soporta adjuntos**

```bash
grep -n "attachment\|adjunto" nodes/backend-central/src/common/email.service.ts
```

Si no los soporta, agregar `attachments?: Array<{ name: string; contentBase64: string }>` a
`EmailMessage` e implementarlo en `BrevoEmailService` (la API de Brevo los toma
como `attachment: [{ name, content }]` con el contenido en base64) y en
`SmtpEmailService`. El `NoopEmailService` los ignora.

- [ ] **Paso 2: Plantilla del correo**

En `email-templates.ts`, una función `checklistEnviado({ vehiculo, fecha, codigo })`
que devuelva asunto y HTML branded, en la misma línea de las que ya existen.

- [ ] **Paso 3: Enviar tras guardar, best-effort**

```ts
// El correo va DESPUÉS de persistir y nunca tumba el envío: el checklist ya
// quedó registrado, y perderlo porque el proveedor de correo falló sería un
// error mucho peor que un correo no entregado. El front avisa si no salió.
let correoEnviado = false;
if (destinatario) {
  try {
    const pdf = await this.generateChecklistFormatoPdf(submission.id);
    await this.email.send({
      to: destinatario,
      ...checklistEnviado({ vehiculo, fecha, codigo }),
      attachments: [{ name: nombrePdf, contentBase64: pdf.toString('base64') }],
    });
    correoEnviado = true;
  } catch (e) {
    this.logger.warn(`No se pudo enviar el checklist ${submission.id} por correo: ${String(e)}`);
  }
}
```

Devolver `correoEnviado` en la respuesta para que el front sea honesto.

- [ ] **Paso 4: Probar el envío de verdad**

Mandarse un checklist al propio correo desde el entorno local apuntando a Brevo.
Esperado: llega con el PDF adjunto y el formato correcto.

- [ ] **Paso 5: Commit**

```bash
git add nodes/backend-central/src
git commit -m "feat(checklist): el PDF se envia por correo al terminar"
```

---

## Tarea 7: Contratos y cliente del front

**Archivos:**
- Modificar: `packages/contracts/src/index.ts`
- Modificar: `nodes/web/src/lib/api.ts`

- [ ] **Paso 1: Tipos compartidos**

```ts
export interface SubmitPublicChecklistInput {
  templateId: string;
  answers: Array<{ itemId: string; label: string; value: unknown; comment?: string }>;
  guestName: string;
  guestEmail: string;
  guestLicenseClass?: string;
  guestLicenseExpiry?: string;
  guestInternalExpiry?: string;
}
```

Y agregar `correoEnviado: boolean` a `ChecklistSubmissionView`.

- [ ] **Paso 2: Cliente**

```ts
/** Envío del checklist sin sesión: la credencial es el token de la ficha. */
export function submitPublicChecklist(
  token: string,
  dto: SubmitPublicChecklistInput,
): Promise<ChecklistSubmissionView> {
  return request(`/assets/public/${token}/checklist`, { method: 'POST', body: dto });
}
```

(Usar el helper de `api.ts` que **no** adjunta el token de sesión.)

- [ ] **Paso 3: Build y commit**

```bash
pnpm --filter @gmt-platform/contracts build && pnpm --filter @gmt-platform/web build
git add packages/contracts nodes/web/src/lib/api.ts
git commit -m "feat(contracts): tipos del envio publico de checklist"
```

---

## Tarea 8: Pasos de identificación y conductor

**Archivos:**
- Crear: `nodes/web/src/pages/checklist/paso-identificacion.tsx`
- Crear: `nodes/web/src/pages/checklist/paso-conductor.tsx`

- [ ] **Paso 1: Paso de identificación**

Dos tarjetas dentro de `<Pantalla>`. La de entrar a GMT Link va primero y
guarda la ruta de vuelta para que el login regrese al mismo checklist:

```tsx
navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`);
```

Verificar cómo maneja hoy el login el parámetro de retorno antes de escribirlo;
si no existe, usar el mecanismo que ya use la app.

- [ ] **Paso 2: Paso de conductor**

Usa `Campo`, `Segmentado` (para la clase de licencia) y `SelectorFecha` (para
los vencimientos), todos de `@/components/form-wizard`.

Con sesión, los campos llegan prellenados y se muestra el aviso:

```tsx
<Aviso mensaje="Estos datos vienen de tu perfil. Si los editas acá, el cambio vale solo para este checklist. Si cambiaron de verdad, actualízalos en tu perfil." />
```

Si el usuario con sesión no tiene la licencia cargada, ofrecer una casilla
explícita: *"Guardar esta licencia en mi perfil"*. Sin esa casilla marcada **no
se escribe nada** en RRHH.

- [ ] **Paso 3: Build y commit**

```bash
pnpm --filter @gmt-platform/web build
git add nodes/web/src/pages/checklist
git commit -m "feat(web): pasos de identificacion y datos del conductor"
```

---

## Tarea 9: Integrar el asistente completo

**Archivos:**
- Modificar: `nodes/web/src/pages/checklist/llenar-checklist.tsx`
- Crear: `nodes/web/src/pages/checklist/paso-cierre.tsx`

- [ ] **Paso 1: La página deja de exigir sesión**

Sacarla de las rutas protegidas y cargar el activo por el endpoint público
cuando no hay sesión. Con sesión se sigue usando `resolveAssetByToken`, que
además autoriza.

- [ ] **Paso 2: Orquestar los pasos**

Estado `paso`, con el de identificación presente solo si no hay sesión.
`BarraPasos` arriba. Los pasos de secciones siguen delegando en
`ChecklistFillBody`.

- [ ] **Paso 3: Paso de cierre**

Campo de correo requerido (prellenado con el del usuario), firma cuando
corresponda, y botón de envío que elige el camino según haya sesión o no.

- [ ] **Paso 4: Pantalla de éxito honesta**

```tsx
{correoEnviado
  ? `Te lo mandamos a ${correo}.`
  : 'El checklist quedó guardado, pero no pudimos enviarte el correo. Descárgalo acá.'}
```

- [ ] **Paso 5: Verificar en el navegador**

Recorrer el flujo completo sin sesión y con sesión. Confirmar que el PDF baja
bien y que el correo llega.

- [ ] **Paso 6: Commit**

```bash
git add nodes/web/src/pages/checklist
git commit -m "feat(web): el checklist se llena por pasos, con o sin sesion"
```

---

## Tarea 10: Marca "sin verificar" en el historial

**Archivos:**
- Modificar: `nodes/web/src/pages/recursos/historial-checklists.tsx`
- Modificar: `nodes/backend-central/src/modules/assets/assets.service.ts`

- [ ] **Paso 1: Exponer el origen en la vista del envío**

Agregar `origen: 'GMT_LINK' | 'SIN_VERIFICAR' | 'PLANILLA'`, derivado de
`userId` y `externalSource`. Derivado, no almacenado.

- [ ] **Paso 2: Dibujar la marca**

Una insignia junto al nombre. Con tooltip que explique qué significa: *"Lo llenó
alguien sin cuenta en GMT Link. El nombre es el que escribió."*

- [ ] **Paso 3: Build, verificación y commit**

```bash
pnpm --filter @gmt-platform/web build
git add nodes/web/src/pages/recursos nodes/backend-central/src
git commit -m "feat(checklist): el historial distingue los envios sin verificar"
```

---

## Tarea 11: Verificación final

- [ ] **Paso 1: Suite completa**

```bash
pnpm lint && pnpm build && pnpm --filter @gmt-platform/api test
```

Esperado: todo verde. **No desplegar si algo falla.**

- [ ] **Paso 2: Recorrido manual de los criterios de aceptación**

Los siete de la sección 6 de la especificación, uno por uno, incluido el de que
el formulario de HSE quedó igual y el de que una plantilla sin secciones sigue
en una sola página.

- [ ] **Paso 3: Desplegar API y web juntos**

El front nuevo depende del endpoint público; desplegar solo uno deja el
formulario roto.

- [ ] **Paso 4: Verificar en producción**

Llenar un checklist real sin sesión desde el teléfono, con el QR. Confirmar el
correo, el PDF y la marca en el historial. Borrar ese checklist de prueba al
terminar.
