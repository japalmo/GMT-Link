# ApprovalWorkflow

Primitiva reutilizable (§5 del plan maestro) que modela un flujo de aprobación
genérico: una versión se envía a revisión (**PENDIENTE**) y un aprobador la
**APRUEBA** o la **RECHAZA** (con motivo). Cada transición conserva la versión
anterior y dispara el gancho de notificación al aprobador.

Es **genérica** sobre el payload `T` que se aprueba: un documento, una ficha de
perfil, una plantilla de checklist, un update de insumos, etc.

## Principios respetados

- **No decide permisos** (§3.1 — mínimo privilegio). Recibe `canApprove` ya
  resuelto por el consumidor vía OpenFGA. Nunca hay un `if (rol === …)`.
- **No notifica por sí misma.** La notificación real es backend; la primitiva
  expone `onNotify` como gancho que se dispara al pasar a PENDIENTE.
- **Conserva la versión anterior** en cada transición (`previous = current`).
- Estados vacío / carga / error siempre cubiertos; accesible (roles, `aria-*`,
  `focus-visible`, foco gestionado por el modal de Radix).

## Máquina de estados

```
              submit(next)                     submit(next)
   ┌──────────────────────────┐   ┌──────────────────────────────┐
   ▼                          │   ▼                              │
(cualquiera) ──submit──▶ PENDIENTE ──approve(reviewer)──▶ APROBADO
                          │   ▲
                          │   └──────── submit(next) ────────┐
            reject(reviewer, reason)                          │
                          │                                   │
                          ▼                                   │
                      RECHAZADO ──────── submit(next) ────────┘
```

- `submit(next)`: desde **cualquier** estado → `PENDIENTE`. `previous = current`,
  `current = next`. Limpia revisor y motivo. Dispara `onNotify` y `onChange`.
- `approve(reviewer)`: `PENDIENTE` → `APROBADO`. Requiere `canApprove`. Guarda
  `previous = current`, registra `reviewedBy` + `reviewedAt`. Dispara `onApprove`
  y `onChange`.
- `reject(reviewer, reason)`: `PENDIENTE` → `RECHAZADO`. Requiere `canApprove` y
  un `reason` no vacío. Guarda `previous`, registra revisor + timestamp + motivo.
  Dispara `onReject` y `onChange`.

`approve` / `reject` solo son válidas desde `PENDIENTE`; en otro estado lanzan.

## Tipos públicos

```ts
type ApprovalStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

interface ApprovalItem<T> {
  id: string;
  status: ApprovalStatus;
  current: T;
  previous?: T;
  submittedBy?: string;
  reviewedBy?: string;
  reviewedAt?: string; // ISO 8601
  reason?: string;     // presente solo en RECHAZADO
}
```

## Hook: `useApprovalWorkflow<T>(options)`

Gestiona la máquina en memoria con callbacks inyectables (síncronos o async).

| Opción         | Tipo                                       | Descripción |
|----------------|--------------------------------------------|-------------|
| `initialItem`  | `ApprovalItem<T>`                          | Item de arranque. |
| `canApprove`   | `boolean`                                  | Resuelto vía OpenFGA por el consumidor. Por defecto `false`. |
| `onChange`     | `(item) => void \| Promise<void>`          | Tras cualquier transición. |
| `onApprove`    | `(item) => void \| Promise<void>`          | Tras aprobar. |
| `onReject`     | `(item) => void \| Promise<void>`          | Tras rechazar. |
| `onNotify`     | `(item) => void \| Promise<void>`          | Gancho de notificación al pasar a PENDIENTE. |

Devuelve:

```ts
{
  item: ApprovalItem<T>;
  canApprove: boolean;
  submit(next: T, submittedBy?: string): Promise<void>;
  approve(reviewer: string): Promise<void>;
  reject(reviewer: string, reason: string): Promise<void>;
}
```

Las transiciones son `async`: esperan a sus callbacks y **propagan errores** (el
consumidor los captura para mostrarlos). Si un callback lanza, el estado UI ya
quedó actualizado en memoria; persiste/revierte según tu capa de datos.

## Componente: `<ApprovalWorkflow<T> />`

Presentacional puro. Muestra:

- Badge de estado coloreado por status (tokens `primary` / `destructive` / `muted`).
- Diff **lado a lado** `current` vs `previous` (si hay versión anterior).
- Indicación de notificación al aprobador cuando está `PENDIENTE`.
- Motivo cuando está `RECHAZADO`; metadatos de revisor/fecha.
- Acciones **Aprobar / Rechazar** visibles **solo si `canApprove`** y `PENDIENTE`.
  El rechazo abre un `Modal` con campo de motivo obligatorio.
- Estados vacío (`item` nulo), carga (`loading`) y error (`error`).

| Prop            | Tipo                                  | Descripción |
|-----------------|---------------------------------------|-------------|
| `item`          | `ApprovalItem<T> \| null \| undefined`| Item a mostrar; nulo → estado vacío. |
| `renderValue`   | `(value: T) => ReactNode`             | Cómo pintar el contenido versionado. |
| `canApprove`    | `boolean`                             | Muestra acciones si `true`. |
| `onApprove`     | `() => void \| Promise<void>`         | Acción aprobar. |
| `onReject`      | `(reason: string) => void \| Promise<void>` | Acción rechazar. |
| `loading`       | `boolean`                             | Estado de carga. |
| `error`         | `string \| null`                      | Mensaje de error. |
| `currentLabel`  | `string`                              | Etiqueta versión actual. |
| `previousLabel` | `string`                              | Etiqueta versión anterior. |
| `emptyState`    | `ReactNode`                           | Contenido del estado vacío. |

### Uso típico (hook + componente)

```tsx
const wf = useApprovalWorkflow<MiDoc>({
  initialItem,
  canApprove, // de OpenFGA
  onNotify: (it) => notifyApprover(it),
  onChange: (it) => persist(it),
});

<ApprovalWorkflow
  item={wf.item}
  canApprove={wf.canApprove}
  renderValue={(d) => <p>{d.titulo}</p>}
  onApprove={() => wf.approve(currentUserId)}
  onReject={(reason) => wf.reject(currentUserId, reason)}
/>;
```

## Dónde se usa (§5)

Docs de proyecto · docs de perfil · docs de activos · plantillas de checklist ·
update de insumos. En esos módulos la primitiva se **ensambla**, no se
reimplementa (regla dura del proyecto). Ver también la etapa 4.7 del roadmap
(flujo genera → pendiente → QA → firma → cliente → firma).
