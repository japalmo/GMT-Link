import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDataTable } from '@/hooks/use-data-table';
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
} from '@/components/primitives/data-table/data-table';
import { useProjects } from '@/hooks/use-operations';
import {
  listUsers,
  fetchAssetsTable,
  createAsset,
  deleteAsset,
  releaseAssetUse,
  type TableRequest,
} from '@/lib/api';
import { useProfile } from '@/hooks/use-profile';
import { useHasPermission } from '@/hooks/use-has-permission';
import { Wrench, Car, Plus, Trash2, Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { ReportarUsoOverlay } from './reportar-uso-overlay';
import type {
  AssetView,
  AssetType,
  AssetStatus,
  VehicleSubtype,
  AssetIdentifierType,
} from '@/types/assets';
import { ASSET_TYPE_LABELS, VEHICLE_SUBTYPE_LABELS, IDENTIFIER_TYPE_LABELS } from '@/types/assets';
import { formatDate } from '@/lib/format';
import { type UserOption } from './recursos-shared';

interface ActivosCatalogViewProps {
  /**
   * Subsección dedicada: 'equipos' filtra type=EQUIPO, 'vehiculos' type=VEHICULO,
   * 'maquinaria' type=MAQUINARIA.
   */
  subsection: 'equipos' | 'vehiculos' | 'maquinaria';
  /**
   * Abre el detalle del activo. `target: 'checklist'` aterriza directo en la
   * pestaña Ficha con scroll al checklist (tras poner en uso un vehículo).
   */
  onSelectAsset: (id: string, target?: 'checklist') => void;
}

export function ActivosCatalogView({
  subsection,
  onSelectAsset,
}: ActivosCatalogViewProps): ReactNode {
  const { profile } = useProfile();
  // Las acciones (crear/tomar/liberar) llaman directo a la API; la LISTA la maneja
  // el MOTOR de tablas. No se usa useAssets aquí para no disparar su lista keyset.
  const { projects } = useProjects();
  const [users, setUsers] = useState<UserOption[]>([]);
  // Tipo de activo real de la subsección: fija el filtro server-side, el alta y el encabezado.
  const subsectionType: AssetType =
    subsection === 'vehiculos' ? 'VEHICULO' : subsection === 'maquinaria' ? 'MAQUINARIA' : 'EQUIPO';

  // Botón "Nuevo" gateado por permiso de gestión de activos (useHasPermission);
  // el tipo del alta se fija según la subsección activa.
  const canCreate = useHasPermission('asset:manage');

  // MOTOR de tablas server-side (offset). El tipo de la subsección se inyecta como
  // filtro fijo en cada consulta; estado y proyecto son filtros del usuario. El
  // componente se remonta por subsección (key en el padre), así que el motor
  // arranca limpio en cada tipo.
  const fetcher = useCallback(
    (req: TableRequest) =>
      fetchAssetsTable({ ...req, filters: { ...(req.filters ?? {}), type: subsectionType } }),
    [subsectionType],
  );
  const table = useDataTable<AssetView>(fetcher, {
    initialPageSize: 10,
    initialSortBy: 'codigo',
    initialSortDir: 'asc',
  });

  // Modal Create state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newType, setNewType] = useState<AssetType>('EQUIPO');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newProjId, setNewProjId] = useState('');
  const [newAssignedId, setNewAssignedId] = useState('');
  // Campos comunes de identificación (aplican a todo tipo de activo)
  const [newManufacturer, setNewManufacturer] = useState('');
  const [newIdentifier, setNewIdentifier] = useState('');
  const [newVehicleSubtype, setNewVehicleSubtype] = useState<VehicleSubtype | ''>('');
  // Subtype metadata
  const [eqCycles, setEqCycles] = useState('0');
  const [eqCalibration, setEqCalibration] = useState('');
  const [vhKm, setVhKm] = useState('0');
  const [vhPlaca, setVhPlaca] = useState('');
  const [vhYear, setVhYear] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Activo del overlay de "Reportar uso" (`null` = cerrado): el flujo completo
  // (reclamar + checklist + firma) se resuelve sobre la tabla, sin navegar.
  const [reportUseAsset, setReportUseAsset] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);
  // Activo pendiente de eliminación (admin/gerencia); abre el ConfirmDialog.
  const [assetToDelete, setAssetToDelete] = useState<AssetView | null>(null);

  // Load directory users. `listUsers` está paginado (keyset): para poblar el
  // picker se pide la página más grande permitida (tope 100).
  useEffect(() => {
    listUsers({ limit: 100 })
      .then((page) => {
        setUsers(
          page.items.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName })),
        );
      })
      .catch(() => toast.error('No se pudieron cargar los usuarios del directorio.'));
  }, []);

  const isAdmin =
    profile?.roleKeys.includes('org_admin') ||
    profile?.roleKeys.includes('department_admin') ||
    profile?.roleKeys.includes('project_creator');

  // Tras una acción que cambia el estado del activo: si hay un filtro de estado
  // activo, la fila pudo dejar de matchear, así que se recarga la página (sale/entra
  // según el filtro y se corrige el total). Si no, se actualiza la fila en el sitio
  // con el valor confirmado por el servidor (sin recargar).
  const reconcileRow = (id: string, asset: AssetView) => {
    if (table.filters.status) {
      table.refetch();
    } else {
      table.patchRow((a) => a.id === id, asset);
    }
  };

  const handleReleaseUse = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      const asset = await releaseAssetUse(id);
      reconcileRow(id, asset);
      toast.success('Activo liberado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al liberar el activo.');
    } finally {
      setActioning(null);
    }
  };

  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    setNewName('');
    setNewDesc('');
    setNewProjId('');
    setNewAssignedId('');
    setNewManufacturer('');
    setNewIdentifier('');
    setNewVehicleSubtype('');
    setEqCycles('0');
    setEqCalibration('');
    setVhKm('0');
    setVhPlaca('');
    setVhYear('');
    setFormError(null);
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!newName) {
      setFormError('El nombre es requerido.');
      return;
    }
    if (isCreating) return;
    setIsCreating(true);

    const metadata: Record<string, unknown> = {};
    if (newType === 'EQUIPO') {
      metadata.chargeCycles = parseInt(eqCycles || '0', 10);
      if (eqCalibration) {
        metadata.calibrationDate = new Date(eqCalibration).toISOString();
      }
    } else if (newType === 'VEHICULO') {
      metadata.odometerKm = parseInt(vhKm || '0', 10);
      metadata.plateCode = vhPlaca.toUpperCase();
      if (vhYear) {
        metadata.year = parseInt(vhYear, 10);
      }
    }

    // Los vehículos se identifican por patente (mismo valor que la placa de la
    // metadata); equipos y maquinaria por número de serie.
    const identifierType: AssetIdentifierType = newType === 'VEHICULO' ? 'PATENTE' : 'NUMERO_SERIE';
    const identifier =
      newType === 'VEHICULO'
        ? vhPlaca
          ? vhPlaca.toUpperCase()
          : undefined
        : newIdentifier || undefined;

    try {
      await createAsset({
        type: newType,
        name: newName,
        description: newDesc || undefined,
        manufacturer: newManufacturer || undefined,
        identifier,
        identifierType,
        vehicleSubtype: newType === 'VEHICULO' ? newVehicleSubtype || undefined : undefined,
        projectId: newProjId || undefined,
        // Nunca en un vehículo, aunque el campo traiga un valor de cuando el
        // formulario estaba en "Equipo": el select está oculto para vehículos y
        // enviarlo igual dejaría un responsable invisible en la ficha.
        assignedToId: newType === 'VEHICULO' ? undefined : newAssignedId || undefined,
        metadata,
      });
      handleCloseCreateModal();
      table.refetch();
      toast.success('Activo creado con éxito.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al crear el activo.';
      setFormError(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const statusBadge = (status: AssetStatus) => {
    switch (status) {
      case 'DISPONIBLE':
        return <Badge variant="success">Disponible</Badge>;
      case 'EN_PREPARACION':
        return <Badge variant="warning">En preparación</Badge>;
      case 'EN_USO':
        return <Badge variant="info">En Uso</Badge>;
      case 'MANTENIMIENTO':
        return <Badge variant="warning">Mantenimiento</Badge>;
      case 'BAJA':
        return <Badge variant="danger">De Baja</Badge>;
      case 'DEFECTUOSO':
        return <Badge variant="warning">Defectuoso</Badge>;
      case 'NO_DISPONIBLE':
        return <Badge variant="neutral">No Disponible</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  /** Metadata tipada del activo (campos por subtipo). */
  const assetMeta = (a: AssetView) =>
    (a.metadata || {}) as {
      chargeCycles?: number;
      calibrationDate?: string;
      plateCode?: string;
      odometerKm?: number;
      year?: number;
    };

  const statusFilter: DataTableFilter = {
    id: 'status',
    label: 'Estado',
    allLabel: 'Todos los estados',
    options: [
      { value: 'DISPONIBLE', label: 'Disponibles' },
      { value: 'EN_PREPARACION', label: 'En preparación' },
      { value: 'EN_USO', label: 'En uso' },
      { value: 'MANTENIMIENTO', label: 'En mantenimiento' },
      { value: 'BAJA', label: 'De baja' },
      { value: 'DEFECTUOSO', label: 'Defectuoso' },
      { value: 'NO_DISPONIBLE', label: 'No disponible' },
    ],
  };
  const projectFilter: DataTableFilter = {
    id: 'projectId',
    label: 'Proyecto',
    allLabel: 'Todos los proyectos',
    options: projects.map((p) => ({ value: p.id, label: p.name })),
  };

  const columns: ReadonlyArray<DataTableColumn<AssetView>> = [
    {
      id: 'codigo',
      header: 'Código',
      sortable: true,
      render: (a) => <span className="font-mono text-xs">{a.code}</span>,
    },
    {
      id: 'nombre',
      header: 'Nombre',
      sortable: true,
      render: (a) => (
        <div className="flex flex-col">
          <span className="font-medium">{a.name}</span>
          {a.description && (
            <span className="text-xs text-muted-foreground line-clamp-1">{a.description}</span>
          )}
        </div>
      ),
    },
    { id: 'estado', header: 'Estado', sortable: true, render: (a) => statusBadge(a.status) },
    {
      id: 'proyecto',
      header: 'Proyecto',
      className: 'max-w-[120px] truncate',
      render: (a) => a.project?.name || 'Global',
    },
    // Sin columna "Responsable": el responsable a cargo se retiró del activo
    // (decisión del dueño). Quién lo tiene EN USO sigue estando, que es lo que
    // de verdad se consulta al buscar una camioneta.
    {
      id: 'enUsoPor',
      header: 'En uso por',
      render: (a) =>
        a.inUseBy ? (
          `${a.inUseBy.firstName} ${a.inUseBy.lastName.charAt(0)}.`
        ) : (
          <span className="text-muted-foreground">Sin uso</span>
        ),
    },
    {
      id: 'fabricante',
      header: 'Fabricante',
      sortable: true,
      render: (a) => a.manufacturer || 'N/A',
    },
    {
      id: 'identificador',
      // Para vehículos el identificador ES la patente, así que la columna se
      // titula "Patente" y omite la subetiqueta del tipo (sería redundante).
      // Equipos y maquinaria usan número de serie y conservan "Identificador".
      header: subsection === 'vehiculos' ? 'Patente' : 'Identificador',
      render: (a) =>
        a.identifier ? (
          <div className="flex flex-col text-xs">
            <span className="font-mono">{a.identifier}</span>
            {subsection !== 'vehiculos' && a.identifierType && (
              <span className="text-[10px] text-muted-foreground">
                {IDENTIFIER_TYPE_LABELS[a.identifierType]}
              </span>
            )}
          </div>
        ) : (
          'N/A'
        ),
    },
    ...(subsection === 'equipos'
      ? ([
          {
            id: 'ciclos',
            header: 'Ciclos de Carga',
            render: (a: AssetView) => assetMeta(a).chargeCycles ?? 'N/A',
          },
          {
            id: 'calibracion',
            header: 'Próxima Calibración',
            render: (a: AssetView) => {
              const cal = assetMeta(a).calibrationDate;
              return cal ? formatDate(cal) : 'N/A';
            },
          },
        ] as DataTableColumn<AssetView>[])
      : []),
    ...(subsection === 'vehiculos'
      ? ([
          {
            id: 'subtipo',
            header: 'Tipo de vehículo',
            render: (a: AssetView) =>
              a.vehicleSubtype ? VEHICLE_SUBTYPE_LABELS[a.vehicleSubtype] : 'N/A',
          },
          {
            id: 'km',
            header: 'Kilometraje',
            render: (a: AssetView) => {
              const km = assetMeta(a).odometerKm;
              return km !== undefined ? `${km} KM` : 'N/A';
            },
          },
          {
            id: 'anio',
            header: 'Año',
            render: (a: AssetView) => {
              const year = assetMeta(a).year;
              return year !== undefined ? year : 'N/A';
            },
          },
        ] as DataTableColumn<AssetView>[])
      : []),
  ];

  const rowActions = (a: AssetView): ReactNode => (
    <>
      {a.status === 'DISPONIBLE' && (
        // Reportar uso desde la tabla abre el OVERLAY: reclama el activo y resuelve
        // el checklist ahí mismo, sin navegar al detalle. Flujo único con ciclo de
        // uso (el detalle sigue ofreciendo la misma entrada para quien ya está ahí).
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setReportUseAsset({ id: a.id, name: a.name, code: a.code });
          }}
        >
          Reportar uso
        </Button>
      )}
      {a.status === 'EN_USO' && (a.inUseById === profile?.id || isAdmin) && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground hover:text-foreground"
          disabled={actioning !== null}
          onClick={() => void handleReleaseUse(a.id)}
        >
          {actioning === a.id ? 'Liberando...' : 'Liberar'}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onSelectAsset(a.id)}>
        Detalle
      </Button>
      {isAdmin && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Eliminar"
          onClick={(e) => {
            e.stopPropagation();
            setAssetToDelete(a);
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado de la subsección + botón Nuevo */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {subsection === 'vehiculos' ? (
              <Car className="size-5" />
            ) : subsection === 'maquinaria' ? (
              <Construction className="size-5" />
            ) : (
              <Wrench className="size-5" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              {subsection === 'vehiculos'
                ? 'Vehículos de Flota'
                : subsection === 'maquinaria'
                  ? 'Maquinaria'
                  : 'Equipos e Instrumentos'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {subsection === 'vehiculos'
                ? 'Camionetas y vehículos con checklist de camioneta, telemetría y kilometraje.'
                : subsection === 'maquinaria'
                  ? 'Maquinaria y equipos pesados con fabricante e identificador de serie.'
                  : 'Instrumentos, herramientas y equipos con ciclos de carga y calibración.'}
            </p>
          </div>
        </div>
        {canCreate && (
          <Button
            onClick={() => {
              setNewType(subsectionType);
              setCreateModalOpen(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            {subsection === 'vehiculos'
              ? 'Nuevo Vehículo'
              : subsection === 'maquinaria'
                ? 'Nueva Maquinaria'
                : 'Nuevo Equipo'}
          </Button>
        )}
      </div>

      <DataTable<AssetView>
        table={table}
        columns={columns}
        getRowId={(a) => a.id}
        searchable
        searchPlaceholder="Buscar por código, nombre…"
        filters={[statusFilter, projectFilter]}
        onRowClick={(a) => onSelectAsset(a.id)}
        emptyMessage="No se encontraron activos. Ajusta los filtros o crea el primero."
        caption="Catálogo de activos"
        rowActions={rowActions}
      />

      {/* DIALOG CREAR ACTIVO */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleCreateAsset}>
              <CardHeader>
                <CardTitle>Registrar Activo</CardTitle>
                <CardDescription>
                  Crea una nueva ficha base para equipos o vehículos.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {formError && (
                  <div className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="asset-type">Tipo de Activo</Label>
                    <Select
                      id="asset-type"
                      aria-label="Tipo de activo"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as AssetType)}
                    >
                      <option value="EQUIPO">{ASSET_TYPE_LABELS.EQUIPO}</option>
                      <option value="VEHICULO">{ASSET_TYPE_LABELS.VEHICULO}</option>
                      <option value="MAQUINARIA">{ASSET_TYPE_LABELS.MAQUINARIA}</option>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="asset-name">Nombre / Modelo</Label>
                    <Input
                      id="asset-name"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Ej. Sismógrafo Geometrics"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="asset-desc">Descripción</Label>
                  <Input
                    id="asset-desc"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Ej. Sismógrafo de 24 canales con batería"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="asset-manufacturer">Fabricante o marca</Label>
                  <Input
                    id="asset-manufacturer"
                    value={newManufacturer}
                    onChange={(e) => setNewManufacturer(e.target.value)}
                    placeholder="Ej. Caterpillar, Toyota, Geometrics"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="asset-proj">Proyecto Asignado</Label>
                    <Select
                      id="asset-proj"
                      aria-label="Proyecto asignado"
                      value={newProjId}
                      onChange={(e) => setNewProjId(e.target.value)}
                    >
                      <option value="">Global / Sin asignar</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {/*
                    Los vehículos no llevan responsable a cargo (decisión del
                    dueño): la camioneta la usa quien la toma ese día, y el dato
                    útil es "en uso por", no un dueño nominal. Los equipos y la
                    maquinaria sí lo conservan, que es donde tiene sentido.
                  */}
                  {newType !== 'VEHICULO' && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="asset-assigned">Responsable</Label>
                      <Select
                        id="asset-assigned"
                        aria-label="Responsable del activo"
                        value={newAssignedId}
                        onChange={(e) => setNewAssignedId(e.target.value)}
                      >
                        <option value="">Sin asignar</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>

                {/* Identificador: número de serie para equipo y maquinaria. Para
                    vehículo se usa la patente de la metadata como identificador. */}
                {(newType === 'EQUIPO' || newType === 'MAQUINARIA') && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="asset-identifier">Número de serie</Label>
                    <Input
                      id="asset-identifier"
                      value={newIdentifier}
                      onChange={(e) => setNewIdentifier(e.target.value)}
                      placeholder="Ej. SN-000123"
                    />
                  </div>
                )}

                {/* Tipo de vehículo: solo aparece para vehículos y es opcional. */}
                {newType === 'VEHICULO' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="asset-veh-subtype">Tipo de vehículo</Label>
                    <Select
                      id="asset-veh-subtype"
                      aria-label="Tipo de vehículo"
                      value={newVehicleSubtype}
                      onChange={(e) => setNewVehicleSubtype(e.target.value as VehicleSubtype | '')}
                    >
                      <option value="">Sin especificar</option>
                      {(Object.keys(VEHICLE_SUBTYPE_LABELS) as VehicleSubtype[]).map((key) => (
                        <option key={key} value={key}>
                          {VEHICLE_SUBTYPE_LABELS[key]}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                {/* Subtype metadata fields */}
                {newType === 'EQUIPO' && (
                  <div className="border border-border p-3 rounded-lg bg-muted/20 flex flex-col gap-3">
                    <p className="text-xs font-semibold text-primary">Metadata de Equipo</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="eq-cycles" className="text-xs">
                          Ciclos de Carga
                        </Label>
                        <Input
                          id="eq-cycles"
                          type="number"
                          value={eqCycles}
                          onChange={(e) => setEqCycles(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="eq-calib" className="text-xs">
                          Próxima Calibración
                        </Label>
                        <Input
                          id="eq-calib"
                          type="date"
                          value={eqCalibration}
                          onChange={(e) => setEqCalibration(e.target.value)}
                          className="h-8 text-xs bg-transparent"
                        />
                      </div>
                    </div>
                  </div>
                )}
                {newType === 'VEHICULO' && (
                  <div className="border border-border p-3 rounded-lg bg-muted/20 flex flex-col gap-3">
                    <p className="text-xs font-semibold text-primary">Metadata de Vehículo</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="vh-km" className="text-xs">
                          Kilometraje Inicial
                        </Label>
                        <Input
                          id="vh-km"
                          type="number"
                          value={vhKm}
                          onChange={(e) => setVhKm(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="vh-placa" className="text-xs">
                          Patente
                        </Label>
                        <Input
                          id="vh-placa"
                          maxLength={6}
                          value={vhPlaca}
                          onChange={(e) => setVhPlaca(e.target.value)}
                          placeholder="ABCD12"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="vh-year" className="text-xs">
                          Año
                        </Label>
                        <Input
                          id="vh-year"
                          type="number"
                          min={1990}
                          max={2030}
                          value={vhYear}
                          onChange={(e) => setVhYear(e.target.value)}
                          placeholder="2024"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={handleCloseCreateModal}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? 'Registrando...' : 'Registrar'}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* OVERLAY REPORTAR USO: reclama el activo y resuelve el checklist inicial
          sobre la tabla. Al completar/cancelar se recarga la página del motor (el
          activo cambió de estado y pudo dejar de matchear el filtro). */}
      {/* `key` por activo: remonta el overlay en cada apertura, así nunca se pinta un
          frame con el checklist/respuestas del activo anterior. */}
      <ReportarUsoOverlay
        key={reportUseAsset?.id ?? 'closed'}
        asset={reportUseAsset}
        onClose={() => setReportUseAsset(null)}
        onCompleted={() => {
          setReportUseAsset(null);
          table.refetch();
        }}
      />

      {/* Eliminar activo (admin/gerencia): borra en cascada sus hijos. Al confirmar
          se recarga la página del motor para que la fila desaparezca. */}
      <ConfirmDialog
        open={assetToDelete !== null}
        onOpenChange={(open) => !open && setAssetToDelete(null)}
        title="¿Eliminar activo?"
        description={
          assetToDelete
            ? `Se eliminará de forma permanente ${assetToDelete.name} (${assetToDelete.code}) junto con sus documentos, accesorios, checklists e historial de uso. Esta acción no se puede deshacer.`
            : ''
        }
        onConfirm={async () => {
          if (!assetToDelete) return;
          await deleteAsset(assetToDelete.id);
          toast.success('Activo eliminado.');
          setAssetToDelete(null);
          table.refetch();
        }}
      />
    </div>
  );
}

/* ==========================================================================
   ASSET DETAIL VIEW COMPONENT
   ========================================================================== */
