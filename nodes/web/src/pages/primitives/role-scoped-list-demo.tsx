import { useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  RoleScopedList,
  type RoleScopedColumn,
  type RoleScopedFilter,
} from '@/components/primitives/role-scoped-list';

/** Colaborador ficticio — datos en memoria, solo para la demo. */
interface Collaborator {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly area: 'Geofísica' | 'Topografía' | 'Finanzas' | 'TI';
  readonly status: 'active' | 'pending' | 'suspended';
  readonly points: number;
  /** Confidencial: el demo simula scoping ocultando estas filas. */
  readonly confidential: boolean;
}

const COLLABORATORS: readonly Collaborator[] = [
  { id: 'u1', name: 'Ana Reyes', email: 'ana@gmt.cl', area: 'Geofísica', status: 'active', points: 320, confidential: false },
  { id: 'u2', name: 'Bruno Lira', email: 'bruno@gmt.cl', area: 'Topografía', status: 'active', points: 210, confidential: false },
  { id: 'u3', name: 'Carla Soto', email: 'carla@ito.cl', area: 'Finanzas', status: 'pending', points: 0, confidential: true },
  { id: 'u4', name: 'Diego Mena', email: 'diego@gmt.cl', area: 'TI', status: 'active', points: 540, confidential: false },
  { id: 'u5', name: 'Elena Paz', email: 'elena@gmt.cl', area: 'Geofísica', status: 'suspended', points: 80, confidential: false },
  { id: 'u6', name: 'Fabián Ruiz', email: 'fabian@gmt.cl', area: 'Topografía', status: 'active', points: 150, confidential: false },
  { id: 'u7', name: 'Gabriela Núñez', email: 'gabriela@gmt.cl', area: 'Finanzas', status: 'pending', points: 30, confidential: true },
  { id: 'u8', name: 'Hugo Vera', email: 'hugo@gmt.cl', area: 'TI', status: 'active', points: 410, confidential: false },
  { id: 'u9', name: 'Inés Bravo', email: 'ines@gmt.cl', area: 'Geofísica', status: 'active', points: 275, confidential: false },
  { id: 'u10', name: 'Joaquín Díaz', email: 'joaquin@gmt.cl', area: 'Topografía', status: 'suspended', points: 95, confidential: false },
  { id: 'u11', name: 'Karla Vega', email: 'karla@gmt.cl', area: 'Finanzas', status: 'active', points: 360, confidential: false },
  { id: 'u12', name: 'Luis Toro', email: 'luis@ito.cl', area: 'TI', status: 'pending', points: 0, confidential: true },
  { id: 'u13', name: 'María Olea', email: 'maria@gmt.cl', area: 'Geofísica', status: 'active', points: 600, confidential: false },
  { id: 'u14', name: 'Néstor Gil', email: 'nestor@gmt.cl', area: 'Topografía', status: 'active', points: 120, confidential: false },
];

const STATUS_LABELS: Record<Collaborator['status'], string> = {
  active: 'Activo',
  pending: 'Pendiente',
  suspended: 'Suspendido',
};

const STATUS_VARIANT: Record<
  Collaborator['status'],
  'success' | 'neutral' | 'danger'
> = {
  active: 'success',
  pending: 'neutral',
  suspended: 'danger',
};

function StatusBadge({ status }: { status: Collaborator['status'] }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

const columns: ReadonlyArray<RoleScopedColumn<Collaborator>> = [
  {
    id: 'name',
    header: 'Nombre',
    render: (c) => <span className="font-medium">{c.name}</span>,
    accessor: (c) => c.name,
    sortable: true,
  },
  {
    id: 'email',
    header: 'Correo',
    render: (c) => <span className="text-muted-foreground">{c.email}</span>,
    accessor: (c) => c.email,
  },
  {
    id: 'area',
    header: 'Área',
    render: (c) => c.area,
    accessor: (c) => c.area,
    sortable: true,
  },
  {
    id: 'points',
    header: 'Puntos',
    render: (c) => <span className="tabular-nums">{c.points}</span>,
    accessor: (c) => c.points,
    sortable: true,
    className: 'text-right',
  },
  {
    id: 'status',
    header: 'Estado',
    render: (c) => <StatusBadge status={c.status} />,
    accessor: (c) => STATUS_LABELS[c.status],
  },
];

const filters: ReadonlyArray<RoleScopedFilter<Collaborator>> = [
  {
    id: 'area',
    label: 'Área',
    options: [
      { value: 'Geofísica', label: 'Geofísica' },
      { value: 'Topografía', label: 'Topografía' },
      { value: 'Finanzas', label: 'Finanzas' },
      { value: 'TI', label: 'TI' },
    ],
    predicate: (c, value) => c.area === value,
  },
  {
    id: 'status',
    label: 'Estado',
    options: [
      { value: 'active', label: 'Activo' },
      { value: 'pending', label: 'Pendiente' },
      { value: 'suspended', label: 'Suspendido' },
    ],
    predicate: (c, value) => c.status === value,
  },
];

type DemoState = 'normal' | 'loading' | 'error' | 'empty';

const STATE_OPTIONS: ReadonlyArray<{ value: DemoState; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'loading', label: 'Cargando' },
  { value: 'error', label: 'Error' },
  { value: 'empty', label: 'Vacío' },
];

/**
 * Demo aislada de la primitiva {@link RoleScopedList}.
 *
 * Datos ficticios en memoria, búsqueda activa, dos filtros, `canAccess` de
 * ejemplo (oculta filas confidenciales para simular scoping por permisos),
 * paginación y toggles para simular los estados carga / error / vacío.
 */
export default function RoleScopedListDemo() {
  const [demoState, setDemoState] = useState<DemoState>('normal');
  const [scoped, setScoped] = useState(true);
  const [retries, setRetries] = useState(0);

  const items = demoState === 'empty' ? [] : COLLABORATORS;

  return (
    <PageContainer maxWidth="6xl">
      <PageHeader
        label="Primitivas · §5"
        title="RoleScopedList"
        description="Lista genérica filtrada por permisos. Búsqueda, filtros, ordenamiento y paginación client-side. Datos ficticios en memoria."
      />

      <Card>
        <CardHeader>
          <CardTitle>Controles de la demo</CardTitle>
          <CardDescription>
            Simula los estados de la primitiva y el scoping por permisos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5 sm:min-w-44">
            <Label htmlFor="demo-state">Estado simulado</Label>
            <Select
              id="demo-state"
              aria-label="Estado simulado de la demo"
              value={demoState}
              onChange={(e) => setDemoState(e.target.value as DemoState)}
            >
              {STATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Scoping (canAccess)</span>
            <Label className="inline-flex h-9 items-center gap-2 font-normal">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                checked={scoped}
                onChange={(e) => setScoped(e.target.checked)}
              />
              Ocultar filas confidenciales
            </Label>
          </div>

          {demoState === 'error' && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Reintentos: {retries}
            </p>
          )}
        </CardContent>
      </Card>

      <RoleScopedList<Collaborator>
        items={items}
        columns={columns}
        filters={filters}
        getRowId={(c) => c.id}
        searchable
        searchPlaceholder="Buscar por nombre, correo o área…"
        canAccess={scoped ? (c) => !c.confidential : undefined}
        pageSize={5}
        loading={demoState === 'loading'}
        error={demoState === 'error' ? 'No se pudo cargar el directorio.' : null}
        onRetry={() => setRetries((n) => n + 1)}
        emptyMessage="No hay colaboradores que coincidan con tu búsqueda."
        caption="Directorio de colaboradores de ejemplo (datos ficticios)."
        rowActions={(c) => (
          <>
            <Button variant="ghost" size="icon" aria-label={`Ver ${c.name}`}>
              <Eye aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label={`Editar ${c.name}`}>
              <Pencil aria-hidden />
            </Button>
          </>
        )}
      />
    </PageContainer>
  );
}
