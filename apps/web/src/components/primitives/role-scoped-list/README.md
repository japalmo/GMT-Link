# RoleScopedList

Primitiva reutilizable §5 del Plan Maestro. Lista/tabla **genérica y agnóstica de
dominio** filtrada por los permisos del usuario, con búsqueda, filtros,
ordenamiento y paginación client-side.

> "RoleScopedList — Lista/tabla filtrada por permisos del usuario; búsqueda +
> filtros + paginación." — §5

## Responsabilidad y límites (§3.1 mínimo privilegio)

La primitiva **no decide reglas de negocio ni de autorización**. Recibe los
`items` **ya cargados** (la carga async la hace el consumidor) y un predicado
`canAccess` que el consumidor calcula consultando OpenFGA. Las filas que no pasan
`canAccess` se **ocultan** — de ahí "role-scoped". La primitiva solo aplica ese
predicado y resuelve la presentación (búsqueda/filtros/orden/paginación) y los
estados de carga / error / vacío.

- Construida sobre la `<Table />` del design system (`@/components/ui/table`).
- TypeScript estricto, sin `any`. Genérico real `RoleScopedList<T>`.
- Mobile-first, accesible (labels, `aria-*`, `focus-visible`, `role="alert"`).
- Iconos `lucide-react`.

## Props

| Prop | Tipo | Default | Descripción |
|---|---|---|---|
| `items` | `readonly T[]` | — | Datos ya cargados. |
| `columns` | `RoleScopedColumn<T>[]` | — | Columnas (ver abajo). |
| `getRowId` | `(item: T) => string` | — | Id estable por fila (clave React). |
| `searchable` | `boolean` | `false` | Activa búsqueda sobre los `accessor` de texto. |
| `searchPlaceholder` | `string` | `'Buscar…'` | Placeholder del buscador. |
| `filters` | `RoleScopedFilter<T>[]` | — | Filtros select componibles. |
| `canAccess` | `(item: T) => boolean` | — | Scoping por permisos; `false` oculta la fila. |
| `pageSize` | `number` | `10` | Tamaño de página (paginación client-side). |
| `loading` | `boolean` | `false` | Muestra filas skeleton. |
| `error` | `string \| null` | `null` | Muestra estado de error con reintento. |
| `emptyMessage` | `string` | `'No hay elementos…'` | Estado vacío (sin items o todo filtrado). |
| `onRetry` | `() => void` | — | Callback del botón "Reintentar". |
| `rowActions` | `(item: T) => ReactNode` | — | Botones por fila (columna final). |
| `rowActionsLabel` | `string` | `'Acciones'` | Etiqueta accesible de la columna de acciones. |
| `caption` | `string` | — | `<caption>` accesible (oculto visualmente). |
| `className` | `string` | — | Clase del contenedor raíz. |

### `RoleScopedColumn<T>`

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `string` | Identificador único (clave + ordenamiento). |
| `header` | `ReactNode` | Encabezado visible. |
| `render` | `(item: T) => ReactNode` | Render de la celda. |
| `sortable?` | `boolean` | Habilita orden asc/desc (requiere `accessor`). |
| `accessor?` | `(item: T) => string \| number` | Valor escalar para búsqueda y orden. |
| `className?` | `string` | Clase de `<th>` y `<td>`. |

> Solo las columnas con `accessor` participan en búsqueda y ordenamiento.

### `RoleScopedFilter<T>`

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `string` | Identificador único. |
| `label` | `string` | Etiqueta del control. |
| `options` | `{ value; label }[]` | Opciones (la opción `''` = "todos"). |
| `predicate` | `(item: T, value: string) => boolean` | Decide si la fila pasa. |
| `allLabel?` | `string` | Texto de la opción "todos" (default `'Todos'`). |

## Ejemplo

```tsx
import {
  RoleScopedList,
  type RoleScopedColumn,
  type RoleScopedFilter,
} from '@/components/primitives/role-scoped-list';

interface Collaborator {
  id: string;
  name: string;
  email: string;
  area: string;
  status: 'active' | 'pending';
}

const columns: RoleScopedColumn<Collaborator>[] = [
  { id: 'name', header: 'Nombre', render: (c) => c.name, accessor: (c) => c.name, sortable: true },
  { id: 'email', header: 'Correo', render: (c) => c.email, accessor: (c) => c.email },
  { id: 'area', header: 'Área', render: (c) => c.area, accessor: (c) => c.area, sortable: true },
];

const filters: RoleScopedFilter<Collaborator>[] = [
  {
    id: 'status',
    label: 'Estado',
    options: [
      { value: 'active', label: 'Activo' },
      { value: 'pending', label: 'Pendiente' },
    ],
    predicate: (c, value) => c.status === value,
  },
];

function Directory({ rows }: { rows: Collaborator[] }) {
  return (
    <RoleScopedList
      items={rows}
      columns={columns}
      filters={filters}
      getRowId={(c) => c.id}
      searchable
      searchPlaceholder="Buscar colaborador…"
      // El consumidor consulta OpenFGA y devuelve el booleano:
      canAccess={(c) => can('directory:view:extended', c.id)}
      pageSize={10}
      rowActions={(c) => <Button size="sm" variant="ghost">Ver</Button>}
    />
  );
}
```

## Estados

- **Carga** (`loading`): filas skeleton (animate-pulse) usando tokens `muted`.
- **Error** (`error`): mensaje en bloque `role="alert"` + botón "Reintentar"
  (`onRetry`).
- **Vacío** (sin `items` o todo filtrado): icono `Inbox` + `emptyMessage`.

## Dónde se usará (§5)

Reembolsos, Horas extra, Proyectos, Directorio, Insumos y Activos. Por eso es
genérica y agnóstica de dominio: cada módulo aporta sus `columns`, `filters`,
`canAccess` (OpenFGA) y la carga de datos.
