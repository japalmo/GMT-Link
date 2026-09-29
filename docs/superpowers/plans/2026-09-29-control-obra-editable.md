# Control de avance de obra editable — Plan de implementación

> **Para quien lo ejecute:** los pasos usan casillas (`- [ ]`). Cada tarea
> termina en commit. El orden importa: la 2 depende de la 1, y la UI (5-7) de
> los endpoints (3-4).

**Objetivo:** que Felipe Díaz actualice el control de avance por HH y las fotos
de los cercos desde GMT Link, en tablas tipo planilla.

**Arquitectura:** el cálculo del informe ya existe y es puro
(`control-semanal.util.ts`). Se le antepone el cálculo del avance semanal
ponderado por HH desde las actividades, se agregan columnas de sobreescritura
explícita, y tres tablas editables en una pestaña nueva.

**Especificación:** `docs/superpowers/specs/2026-09-29-control-obra-editable-design.md`

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `nodes/backend-central/src/modules/projects/avance-ponderado.util.ts` | Calcula PAR/ACM real desde las actividades (puro) |
| `nodes/backend-central/test/modules/projects/avance-ponderado.spec.ts` | Sus pruebas |
| `nodes/backend-central/src/modules/projects/dto/avance.dto.ts` | DTO de las ediciones |
| `nodes/web/src/pages/proyectos/avance-tab.tsx` | La pestaña, con las tres tablas |
| `nodes/web/src/pages/proyectos/avance-actividades.tsx` | Tabla de actividades |
| `nodes/web/src/pages/proyectos/avance-semanas.tsx` | Tabla de semanas |
| `nodes/web/src/pages/proyectos/avance-cercos.tsx` | Tabla de cercos con foto |
| `nodes/web/src/components/ui/celda-editable.tsx` | Celda con navegación de teclado |

**Se modifican:** `schema.prisma`, `control-semanal.util.ts`,
`projects.service.ts`, `projects.controller.ts`, `rbac-catalog.ts`,
`obra-dashboard.util.ts`, `obra-mapa.tsx`, `vista-proyecto.tsx`, `api.ts`,
`packages/contracts/src/index.ts`.

---

## Tarea 1: Cálculo del avance ponderado por HH

**Archivos:**
- Crear: `src/modules/projects/avance-ponderado.util.ts`
- Crear: `test/modules/projects/avance-ponderado.spec.ts`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Con los números REALES del informe S-3, que es lo que hace la prueba honesta:

```ts
import { describe, expect, it } from 'vitest';
import { avanceSemanal } from '../../../src/modules/projects/avance-ponderado.util';

describe('avanceSemanal', () => {
  it('pondera por HH, no por cantidad de actividades', () => {
    // Una actividad de 900 HH al 100% y una de 100 HH en 0% dan 90%, no 50%.
    const r = avanceSemanal(
      [
        { hh: 900, realByWeek: [1] },
        { hh: 100, realByWeek: [0] },
      ],
      1,
    );
    expect(r[0]?.acm).toBeCloseTo(0.9, 5);
  });

  it('los hitos (hh = 0) no pesan', () => {
    const r = avanceSemanal(
      [
        { hh: 0, realByWeek: [1] },
        { hh: 100, realByWeek: [0.5] },
      ],
      1,
    );
    expect(r[0]?.acm).toBeCloseTo(0.5, 5);
  });

  it('el parcial es la diferencia contra la semana anterior', () => {
    const r = avanceSemanal([{ hh: 100, realByWeek: [0.2, 0.5] }], 2);
    expect(r[0]?.par).toBeCloseTo(0.2, 5);
    expect(r[1]?.par).toBeCloseTo(0.3, 5);
  });

  it('una semana sin informe queda en null, no en cero', () => {
    // Cero significaría "no se avanzó"; null significa "todavía no hay corte".
    const r = avanceSemanal([{ hh: 100, realByWeek: [0.2] }], 3);
    expect(r[1]?.acm).toBeNull();
    expect(r[2]?.acm).toBeNull();
  });

  it('sin actividades con HH no inventa un avance', () => {
    expect(avanceSemanal([{ hh: 0, realByWeek: [1] }], 1)[0]?.acm).toBeNull();
  });

  it('admite que el acumulado retroceda', () => {
    // Corregir un informe anterior a la baja es legítimo.
    const r = avanceSemanal([{ hh: 100, realByWeek: [0.5, 0.4] }], 2);
    expect(r[1]?.par).toBeCloseTo(-0.1, 5);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
cd nodes/backend-central && npx vitest run test/modules/projects/avance-ponderado.spec.ts
```

Esperado: FAIL, no encuentra el módulo.

- [ ] **Paso 3: Escribir el util**

```ts
/**
 * Avance real por semana, ponderado por horas hombre.
 *
 * Es como lo calcula el informe al cliente: una actividad pesa lo que pesan sus
 * HH en el programa, no lo mismo que cualquier otra. Los hitos (`hh = 0`) no
 * pesan: marcan fechas, no trabajo.
 *
 * `realByWeek` es el acumulado 0-1 por semana desde S-1, sin huecos: su largo
 * dice hasta qué semana hay informe. Una semana sin informe devuelve `null` y
 * no cero, porque cero significa "no se avanzó" y eso es otra cosa.
 *
 * Módulo PURO: sin Prisma ni Nest.
 */
export interface ActividadConHh {
  hh: number;
  realByWeek: number[];
}

export interface AvanceDeSemana {
  /** Acumulado 0-1, o `null` si esa semana no tiene informe. */
  acm: number | null;
  /** Parcial de la semana (acm − acm anterior), o `null`. */
  par: number | null;
}

export function avanceSemanal(
  actividades: readonly ActividadConHh[],
  semanas: number,
): AvanceDeSemana[] {
  const hhTotal = actividades.reduce((s, a) => s + (a.hh > 0 ? a.hh : 0), 0);

  const acumulados: Array<number | null> = [];
  for (let i = 0; i < semanas; i += 1) {
    // Hay informe de la semana i solo si ALGUNA actividad con peso lo trae.
    const conDato = actividades.some((a) => a.hh > 0 && a.realByWeek.length > i);
    if (hhTotal === 0 || !conDato) {
      acumulados.push(null);
      continue;
    }
    const suma = actividades.reduce(
      (s, a) => (a.hh > 0 ? s + a.hh * (a.realByWeek[i] ?? 0) : s),
      0,
    );
    acumulados.push(suma / hhTotal);
  }

  return acumulados.map((acm, i) => {
    const previo = i === 0 ? 0 : acumulados[i - 1];
    return {
      acm,
      par: acm === null ? null : acm - (previo ?? 0),
    };
  });
}
```

- [ ] **Paso 4: Correr hasta que pasen**

```bash
cd nodes/backend-central && npx vitest run test/modules/projects/avance-ponderado.spec.ts
```

Esperado: 6 passed.

- [ ] **Paso 5: Commit**

```bash
git add nodes/backend-central/src/modules/projects/avance-ponderado.util.ts nodes/backend-central/test/modules/projects/avance-ponderado.spec.ts
git commit -m "feat(obra): avance semanal ponderado por HH desde las actividades"
```

---

## Tarea 2: Modelo de datos

**Archivos:** `prisma/schema.prisma` + migración

- [ ] **Paso 1: Sobreescritura explícita en `ProjectWeek`**

```prisma
  /// Avance informado A MANO, 0-1. `null` = vale el calculado desde las
  /// actividades. Se guarda APARTE del calculado a propósito: así la pantalla
  /// puede mostrar los dos y su diferencia, y se puede volver atrás. Tener dos
  /// fuentes en silencio fue lo que dejó el desglose por fases congelado dos
  /// semanas sin que nadie lo notara.
  parRealOverride Float?
  acmRealOverride Float?
```

- [ ] **Paso 2: NO agregar columna de foto**

Las fotos de los cercos ya existen como `ProjectDocument` con `taskId`, y el
tablero ya las prefiere por sobre la satelital. Agregar `Task.photoKey` sería
una segunda fuente para el mismo dato. Se llegó a agregar y se revirtió.

- [ ] **Paso 3: Generar la migración**

```bash
cd nodes/backend-central && pnpm prisma migrate dev --name avance_obra_editable
```

Esperado: solo `ADD COLUMN`. Revisar el SQL antes de seguir.

- [ ] **Paso 4: Commit**

```bash
git add nodes/backend-central/prisma
git commit -m "feat(obra): columnas de sobreescritura de avance y foto del cerco"
```

---

## Tarea 3: El permiso

**Archivos:** `prisma/rbac-catalog.ts`, `src/auth/auth.controller.ts`, `nodes/web/src/lib/nav-items.ts`

- [ ] **Paso 1: Agregar al catálogo**

```ts
{
  key: 'project:progress:manage',
  label: 'Gestionar avance de obra',
  module: 'proyectos',
  kind: 'STRUCTURAL',
  fgaRelation: 'can_manage_progress',
  scopeable: true,
},
```

- [ ] **Paso 2: Relación en el modelo OpenFGA (§4.3)**

Agregar `can_manage_progress` al tipo `project`, con la misma herencia
depto→proyecto que `can_manage_team`.

- [ ] **Paso 3: Verificar que el arranque lo siembra**

```bash
cd nodes/backend-central && pnpm dev
```

Esperado: el catálogo se upsertea sin error al iniciar.

- [ ] **Paso 4: Commit**

```bash
git add nodes/backend-central/prisma/rbac-catalog.ts
git commit -m "feat(obra): permiso project:progress:manage"
```

---

## Tarea 4: Endpoints de edición

**Archivos:** `dto/avance.dto.ts`, `projects.service.ts`, `projects.controller.ts`

- [ ] **Paso 1: DTO por celda**

```ts
/**
 * Edición de UNA celda. No se recibe la tabla entera a propósito: dos personas
 * editando semanas distintas no deben pisarse.
 */
export class EditarAvanceActividadDto {
  @IsInt() wbsId!: number;
  /** Índice de semana desde S-1. */
  @IsInt() @Min(0) semana!: number;
  /** Acumulado 0-1. */
  @IsNumber() @Min(0) @Max(1) valor!: number;
}
```

Más `EditarSemanaDto` (con `parRealOverride` / `acmRealOverride` / campos del
plan, todos opcionales y nullables para poder quitar la sobreescritura).

- [ ] **Paso 2: Servicio**

`editarAvanceActividad` escribe en `realByWeek` (rellenando con el último
acumulado si la semana está más adelante que el largo actual, para no dejar
huecos) y **recalcula** `parReal`/`acmReal` de todas las semanas aplicando los
overrides que existan.

`editarSemana` escribe plan u override y recalcula igual.

Los dos exigen `project:progress:manage` sobre el proyecto.

- [ ] **Paso 3: Endpoints**

```
PATCH /projects/:id/avance/actividad
PATCH /projects/:id/avance/semana
POST   /projects/:id/cercos/:taskId/foto    (multipart → crea ProjectDocument)
DELETE /projects/:id/cercos/:taskId/foto    (borra el documento de foto)
```

- [ ] **Paso 4: Pruebas del servicio**

Que un override gana sobre el calculado; que quitarlo devuelve el calculado;
que sin el permiso responde 403; que el recálculo no deja huecos en `realByWeek`.

- [ ] **Paso 5: Commit**

---

## Tarea 5: Celda editable

**Archivos:** `nodes/web/src/components/ui/celda-editable.tsx`

- [ ] **Paso 1: El componente**

Entrada numérica con:
- Tab / Enter / flechas para moverse entre celdas, como una planilla.
- Autoguardado al salir del campo, con indicador (guardando / guardado / error).
- Validación de rango antes de mandar: una celda fuera de 0-100 se marca y NO
  se guarda.
- Pegado desde Excel: una columna de valores llena las celdas hacia abajo.

- [ ] **Paso 2: Verificar en el navegador**

Navegación con teclado, autoguardado y pegado. Sin esto la tabla no sirve para
cargar una semana entera.

- [ ] **Paso 3: Commit**

---

## Tarea 6: Las tres tablas

**Archivos:** `avance-tab.tsx`, `avance-actividades.tsx`, `avance-semanas.tsx`, `avance-cercos.tsx`

- [ ] **Paso 1: Tabla de actividades**

38 filas agrupadas por fase, una columna por semana hasta el corte. Totales por
fase y total general al pie.

- [ ] **Paso 2: Tabla de semanas**

Las columnas del informe. El real llega calculado; al sobreescribirlo la celda
se marca y **muestra el calculado al lado con la diferencia**. Un botón quita la
sobreescritura.

- [ ] **Paso 3: Tabla de cercos**

Una fila por cerco: nombre, ubicación, avance, foto. Subir reemplaza la vista
satelital en el tablero; quitar la devuelve. La foto se achica en el navegador
antes de subir.

- [ ] **Paso 4: Solo lectura sin permiso**

Con `project:read` pero sin `project:progress:manage` las tablas se ven y no se
editan.

- [ ] **Paso 5: Aviso al editar el plan**

Confirmación explicando que mueve la referencia contra la que se mide todo el
informe.

- [ ] **Paso 6: Commit**

---

## Tarea 7: La foto en el tablero

**Archivos:** `obra-mapa.tsx`, `obra-dashboard.util.ts`

- [ ] **Paso 1: Exponer la foto en el dashboard**

Cada cerco lleva la URL fresca de su foto, o `null`.

- [ ] **Paso 2: Usarla en lugar de la satelital**

Con foto se muestra la foto; sin foto, la vista satelital exactamente como hoy.

- [ ] **Paso 3: Verificar los dos casos en el navegador**

- [ ] **Paso 4: Commit**

---

## Tarea 8: Cargar el detalle por actividad del corte S-3

El desglose por fases está congelado en S-1 porque `realByWeek` solo tiene esa
semana. Con las tablas construidas, el detalle de S-2 y S-3 lo carga Felipe.

- [ ] **Paso 1: Pedirle a Felipe el detalle por actividad de S-2 y S-3**

El PDF del informe NO lo trae: hay que sacarlo de su planilla.

- [ ] **Paso 2: Verificar que al cargarlo el encabezado sigue dando 23,7%**

Es la prueba de que el cálculo ponderado reproduce su Excel. Si no coincide, hay
que entender por qué ANTES de confiar en la tabla.

---

## Tarea 9: Verificación y despliegue

- [ ] **Paso 1:** `pnpm lint && pnpm build && pnpm --filter @gmt-platform/api test`
- [ ] **Paso 2:** Los diez criterios de aceptación de la especificación, uno por uno.
- [ ] **Paso 3:** Desplegar API y web juntas (el front nuevo usa endpoints nuevos).
- [ ] **Paso 4:** Confirmar en producción que el tablero público sigue dando
      23,7% / 20,7% / +3,0 al corte S-3.
