import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAssets } from '@/hooks/use-assets';
import { useProjects } from '@/hooks/use-operations';
import { listUsers } from '@/lib/api';
import { useProfile } from '@/hooks/use-profile';
import { useHasPermission } from '@/hooks/use-has-permission';
import InsumosPage from '@/pages/insumos';
import ProveedoresPage from '@/pages/proveedores';
import BodegasPage from '@/pages/bodegas';
import {
  Wrench,
  Car,
  Plus,
  Filter,
  History,
  FileText,
  Clock,
  ArrowLeft,
  QrCode,
  AlertCircle,
  Package,
  FileSpreadsheet,
  Building,
  ListTodo,
  ClipboardCheck,
  Settings,
  X,
  MapPin,
  Gauge,
  Wifi,
  Play,
  Square,
  Navigation,
  Construction,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
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
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AssetView,
  AssetType,
  AssetStatus,
  AssetDocumentView,
  AssetHistoryEntryView,
  AssetAccessoryView,
  ChecklistTemplateView,
  ChecklistSubmissionView,
  ChecklistTemplateItem,
  ChecklistAnswer,
  VehicleSubtype,
  AssetIdentifierType,
} from '@/types/assets';
import {
  ASSET_TYPE_LABELS,
  VEHICLE_SUBTYPE_LABELS,
  IDENTIFIER_TYPE_LABELS,
} from '@/types/assets';
import { formatDate } from '@/lib/format';

// Types for select users
interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

type RecursosTab = 'equipos' | 'vehiculos' | 'maquinaria' | 'insumos' | 'proveedores' | 'bodegas';

export default function RecursosPage(): ReactNode {
  // Proveedores y Bodegas solo son visibles para roles de gestión (§ gating de
  // demo). Equipos, Vehículos e Insumos son visibles para cualquier usuario.
  const canManageSupplyChain = useHasPermission('warehouse:access');

  const [activeTab, setActiveTab] = useState<RecursosTab>('equipos');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  // Si el usuario pierde el rol estando en una pestaña restringida, lo devolvemos
  // a una pestaña pública (fail-closed) para no dejar contenido gateado a la vista.
  useEffect(() => {
    if (!canManageSupplyChain && (activeTab === 'proveedores' || activeTab === 'bodegas')) {
      setActiveTab('equipos');
    }
  }, [canManageSupplyChain, activeTab]);

  const isAssetTab = activeTab === 'equipos' || activeTab === 'vehiculos' || activeTab === 'maquinaria';

  const tabItems: TabItem<RecursosTab>[] = [
    { value: 'equipos', label: 'Equipos', icon: Wrench },
    { value: 'vehiculos', label: 'Vehículos', icon: Car },
    { value: 'maquinaria', label: 'Maquinaria', icon: Construction },
    { value: 'insumos', label: 'Insumos', icon: Package },
    ...(canManageSupplyChain
      ? ([
          { value: 'proveedores', label: 'Proveedores', icon: Building },
          { value: 'bodegas', label: 'Bodegas', icon: FileSpreadsheet },
        ] as const)
      : []),
  ];

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Recursos Físicos"
        description="Administra los activos, vehículos, herramientas y la cadena de suministro de GMT."
      />

      <Tabs<RecursosTab>
        aria-label="Secciones de recursos"
        items={tabItems}
        value={activeTab}
        onValueChange={(tab) => {
          setActiveTab(tab);
          setSelectedAssetId(null);
        }}
      />

      {/* Tab Content */}
      <div className="mt-4">
        {isAssetTab && (
          selectedAssetId ? (
            <AssetDetailView id={selectedAssetId} onBack={() => setSelectedAssetId(null)} />
          ) : (
            <ActivosCatalogView
              subsection={
                activeTab === 'vehiculos'
                  ? 'vehiculos'
                  : activeTab === 'maquinaria'
                    ? 'maquinaria'
                    : 'equipos'
              }
              onSelectAsset={setSelectedAssetId}
            />
          )
        )}

        {activeTab === 'insumos' && (
          <InsumosPage />
        )}

        {canManageSupplyChain && activeTab === 'proveedores' && (
          <ProveedoresPage />
        )}

        {canManageSupplyChain && activeTab === 'bodegas' && (
          <BodegasPage />
        )}
      </div>
    </PageContainer>
  );
}

/* ==========================================================================
   ACTIVOS CATALOG VIEW COMPONENT
   ========================================================================== */

interface ActivosCatalogViewProps {
  /**
   * Subsección dedicada: 'equipos' filtra type=EQUIPO, 'vehiculos' type=VEHICULO,
   * 'maquinaria' type=MAQUINARIA.
   */
  subsection: 'equipos' | 'vehiculos' | 'maquinaria';
  onSelectAsset: (id: string) => void;
}

function ActivosCatalogView({ subsection, onSelectAsset }: ActivosCatalogViewProps): ReactNode {
  const { profile } = useProfile();
  const { assets, loading, error, create, takeUse, releaseUse } = useAssets();
  const { projects } = useProjects();
  const [users, setUsers] = useState<UserOption[]>([]);
  // Tipo de activo real de la subsección: fija el filtro, el alta y el encabezado.
  const subsectionType: AssetType =
    subsection === 'vehiculos' ? 'VEHICULO' : subsection === 'maquinaria' ? 'MAQUINARIA' : 'EQUIPO';

  // Botón "Nuevo" gateado por permiso de gestión de activos (useHasPermission);
  // el tipo del alta se fija según la subsección activa.
  const canCreate = useHasPermission('asset:manage');

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterProj, setFilterProj] = useState<string>('ALL');

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

  // Load directory users
  useEffect(() => {
    listUsers()
      .then((res) => {
        setUsers(res.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName })));
      })
      .catch(() => toast.error('No se pudieron cargar los usuarios del directorio.'));
  }, []);

  const isAdmin =
    profile?.roleKeys.includes('org_admin') ||
    profile?.roleKeys.includes('department_admin') ||
    profile?.roleKeys.includes('project_creator');

  // Filter logic on frontend
  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(search.toLowerCase()) ||
      asset.code.toLowerCase().includes(search.toLowerCase()) ||
      (asset.description && asset.description.toLowerCase().includes(search.toLowerCase()));

    const matchesTab = asset.type === subsectionType;
    const matchesStatus = filterStatus === 'ALL' || asset.status === filterStatus;
    const matchesProj = filterProj === 'ALL' || asset.projectId === filterProj;

    return matchesSearch && matchesTab && matchesStatus && matchesProj;
  });

  const handleTakeUse = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await takeUse(id);
      toast.success('Activo puesto en uso con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al poner el activo en uso.');
    } finally {
      setActioning(null);
    }
  };

  const handleReleaseUse = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await releaseUse(id);
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
        ? (vhPlaca ? vhPlaca.toUpperCase() : undefined)
        : (newIdentifier || undefined);

    try {
      await create({
        type: newType,
        name: newName,
        description: newDesc || undefined,
        manufacturer: newManufacturer || undefined,
        identifier,
        identifierType,
        vehicleSubtype: newType === 'VEHICULO' ? (newVehicleSubtype || undefined) : undefined,
        projectId: newProjId || undefined,
        assignedToId: newAssignedId || undefined,
        metadata,
      });
      handleCloseCreateModal();
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

  return (
    <div className="flex flex-col gap-6">
      {/* Search and Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-card/40 border border-border p-4 rounded-xl">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0 basis-full sm:basis-auto">
          <SearchInput
            className="max-w-sm"
            label="Buscar activos"
            placeholder="Buscar por código, nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Select
              aria-label="Filtrar por estado"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="ALL">Todos los Estados</option>
              <option value="DISPONIBLE">Disponibles</option>
              <option value="EN_USO">En Uso</option>
              <option value="MANTENIMIENTO">En Mantenimiento</option>
              <option value="BAJA">De Baja</option>
              <option value="DEFECTUOSO">Defectuoso</option>
              <option value="NO_DISPONIBLE">No Disponible</option>
            </Select>

            <Select
              aria-label="Filtrar por proyecto"
              value={filterProj}
              onChange={(e) => setFilterProj(e.target.value)}
              className="max-w-[150px]"
            >
              <option value="ALL">Todos los Proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
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
      </div>

      {/* Encabezado de la subsección dedicada (Equipos o Vehículos) */}
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

      {/* Catalog Render (Table View) */}
      {loading ? (
        <LoadingState label="Cargando activos…" />
      ) : error ? (
        <ErrorState message={error} />
      ) : filteredAssets.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No se encontraron activos"
          message="Intenta ajustando los filtros de búsqueda o cambia de pestaña."
        />
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card/40">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Fabricante</TableHead>
                <TableHead>Identificador</TableHead>
                {subsection === 'equipos' && (
                  <>
                    <TableHead>Ciclos de Carga</TableHead>
                    <TableHead>Próxima Calibración</TableHead>
                  </>
                )}
                {subsection === 'vehiculos' && (
                  <>
                    <TableHead>Tipo de vehículo</TableHead>
                    <TableHead>Kilometraje</TableHead>
                    <TableHead>Año</TableHead>
                  </>
                )}
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.map((asset) => {
                const meta = (asset.metadata || {}) as { chargeCycles?: number; calibrationDate?: string; plateCode?: string; odometerKm?: number; year?: number };
                return (
                  <TableRow
                    key={asset.id}
                    onClick={() => onSelectAsset(asset.id)}
                    className="cursor-pointer hover:bg-muted/30"
                  >
                    <TableCell className="font-mono text-xs">{asset.code}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{asset.name}</span>
                        {asset.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">{asset.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(asset.status)}</TableCell>
                    <TableCell className="truncate max-w-[120px]">
                      {asset.project?.name || 'Global'}
                    </TableCell>
                    <TableCell>
                      {asset.assignedTo
                        ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName.charAt(0)}.`
                        : 'Sin asignar'}
                    </TableCell>
                    <TableCell>{asset.manufacturer || 'N/A'}</TableCell>
                    <TableCell className="text-xs">
                      {asset.identifier ? (
                        <div className="flex flex-col">
                          <span className="font-mono">{asset.identifier}</span>
                          {asset.identifierType && (
                            <span className="text-[10px] text-muted-foreground">
                              {IDENTIFIER_TYPE_LABELS[asset.identifierType]}
                            </span>
                          )}
                        </div>
                      ) : (
                        'N/A'
                      )}
                    </TableCell>
                    {subsection === 'equipos' && (
                      <>
                        <TableCell>{meta.chargeCycles !== undefined ? meta.chargeCycles : 'N/A'}</TableCell>
                        <TableCell>
                          {meta.calibrationDate ? formatDate(meta.calibrationDate) : 'N/A'}
                        </TableCell>
                      </>
                    )}
                    {subsection === 'vehiculos' && (
                      <>
                        <TableCell>
                          {asset.vehicleSubtype ? VEHICLE_SUBTYPE_LABELS[asset.vehicleSubtype] : 'N/A'}
                        </TableCell>
                        <TableCell>{meta.odometerKm !== undefined ? `${meta.odometerKm} KM` : 'N/A'}</TableCell>
                        <TableCell>{meta.year !== undefined ? meta.year : 'N/A'}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        {asset.status === 'DISPONIBLE' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={actioning !== null}
                            onClick={() => void handleTakeUse(asset.id)}
                          >
                            {actioning === asset.id ? 'Poniendo en uso...' : 'Poner en uso'}
                          </Button>
                        )}
                        {asset.status === 'EN_USO' && (asset.inUseById === profile?.id || isAdmin) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-muted-foreground hover:text-foreground"
                            disabled={actioning !== null}
                            onClick={() => void handleReleaseUse(asset.id)}
                          >
                            {actioning === asset.id ? 'Liberando...' : 'Liberar'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => onSelectAsset(asset.id)}
                        >
                          Detalle
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* DIALOG CREAR ACTIVO */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleCreateAsset}>
              <CardHeader>
                <CardTitle>Registrar Activo</CardTitle>
                <CardDescription>Crea una nueva ficha base para equipos o vehículos.</CardDescription>
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
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>

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
                        <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                      ))}
                    </Select>
                  </div>
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
                        <option key={key} value={key}>{VEHICLE_SUBTYPE_LABELS[key]}</option>
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
                        <Label htmlFor="eq-cycles" className="text-xs">Ciclos de Carga</Label>
                        <Input
                          id="eq-cycles"
                          type="number"
                          value={eqCycles}
                          onChange={(e) => setEqCycles(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="eq-calib" className="text-xs">Próxima Calibración</Label>
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
                        <Label htmlFor="vh-km" className="text-xs">Kilometraje Inicial</Label>
                        <Input
                          id="vh-km"
                          type="number"
                          value={vhKm}
                          onChange={(e) => setVhKm(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="vh-placa" className="text-xs">Patente / Placa</Label>
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
                        <Label htmlFor="vh-year" className="text-xs">Año</Label>
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
    </div>
  );
}

/* ==========================================================================
   ASSET DETAIL VIEW COMPONENT
   ========================================================================== */

interface AssetDetailViewProps {
  id: string;
  onBack: () => void;
}

function AssetDetailView({ id, onBack }: AssetDetailViewProps): ReactNode {
  const { profile } = useProfile();
  const {
    getById,
    updateStatus,
    assign,
    takeUse,
    releaseUse,
    uploadDoc,
    listDocs,
    reviewDoc,
    getHistory,
    listAccessories,
    addAccessory,
    updateAccessory,
    deleteAccessory,
    getTemplate,
    updateTemplate,
    reviewTemplate,
    submitChecklistAnswers,
    listSubmissions,
    getSubmissionPdf,
    submitTelemetryAnswers,
  } = useAssets();

  const [asset, setAsset] = useState<AssetView | null>(null);
  const [docs, setDocs] = useState<AssetDocumentView[]>([]);
  const [history, setHistory] = useState<AssetHistoryEntryView[]>([]);
  const [accessories, setAccessories] = useState<AssetAccessoryView[]>([]);
  const [template, setTemplate] = useState<ChecklistTemplateView | null>(null);
  const [submissions, setSubmissions] = useState<ChecklistSubmissionView[]>([]);

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('CERT');
  const [docError, setDocError] = useState<string | null>(null);
  const [docExpDate, setDocExpDate] = useState('');

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<AssetStatus>('DISPONIBLE');
  const [statusDesc, setStatusDesc] = useState('');

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [newAssignId, setNewAssignId] = useState('');

  // Tabs for detailed view
  const [detailTab, setDetailTab] = useState<'documentos' | 'accesorios' | 'checklist' | 'historial' | 'telemetria'>('documentos');

  // Descarga de PDF de una inspección (submissionId en curso).
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [rejectingTpl, setRejectingTpl] = useState(false);

  // Accesorios state
  const [accName, setAccName] = useState('');
  const [accDesc, setAccDesc] = useState('');
  const [accSN, setAccSN] = useState('');
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [deleteAccId, setDeleteAccId] = useState<string | null>(null);

  // Checklist template state & builder
  const [tplName, setTplName] = useState('');
  const [tplItems, setTplItems] = useState<ChecklistTemplateItem[]>([]);
  const [showTplConfig, setShowTplConfig] = useState(false);

  // Checklist execution answers state
  const [executionAnswers, setExecutionAnswers] = useState<Record<string, unknown>>({});

  // Telemetria simulation state
  const [simulating, setSimulating] = useState(false);
  const [, setRouteIndex] = useState(0);
  const routeIndexRef = useRef(0);
  const [simSpeed, setSimSpeed] = useState(60);
  const [manualLat, setManualLat] = useState('-33.460');
  const [manualLng, setManualLng] = useState('-70.668');
  const [manualSpeed, setManualSpeed] = useState('60');
  const [submittingManualTelemetry, setSubmittingManualTelemetry] = useState(false);
  const [telemetryMessage, setTelemetryMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [actioning, setActioning] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const a = await getById(id);
      setAsset(a);
      setNewStatus(a.status);
      setNewAssignId(a.assignedToId || '');

      const [dList, hList, accList, tpl, subList] = await Promise.all([
        listDocs(id),
        getHistory(id),
        listAccessories(id),
        getTemplate(id),
        listSubmissions(id),
      ]);
      setDocs(dList);
      setHistory(hList);
      setAccessories(accList);
      setTemplate(tpl);
      setSubmissions(subList);
      setTplName(tpl?.name || '');
      setTplItems(tpl?.items || []);
    } catch {
      toast.error('No se pudieron cargar los datos del activo.');
    } finally {
      setLoading(false);
    }
  }, [id, getById, listDocs, getHistory, listAccessories, getTemplate, listSubmissions]);

  useEffect(() => {
    void loadData();
    listUsers()
      .then((res) => {
        setUsers(res.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName })));
      })
      .catch(() => toast.error('No se pudieron cargar los usuarios del directorio.'));
  }, [loadData]);

  // Telemetria simulation effect
  useEffect(() => {
    const MOCK_ROUTE = [
      { latitude: -33.456, longitude: -70.662 },
      { latitude: -33.458, longitude: -70.665 },
      { latitude: -33.460, longitude: -70.668 },
      { latitude: -33.462, longitude: -70.671 },
      { latitude: -33.465, longitude: -70.674 },
      { latitude: -33.468, longitude: -70.677 },
    ];

    let timer: ReturnType<typeof setInterval> | null = null;
    if (simulating) {
      timer = setInterval(async () => {
        const nextIdx = (routeIndexRef.current + 1) % MOCK_ROUTE.length;
        routeIndexRef.current = nextIdx;
        setRouteIndex(nextIdx);
        const pt = MOCK_ROUTE[nextIdx];
        if (!pt) return;
        try {
          await submitTelemetryAnswers(id, {
            latitude: pt.latitude,
            longitude: pt.longitude,
            speed: simSpeed,
          });
          void loadData();
        } catch {
          toast.error('No se pudo registrar la telemetría simulada. Detén y reinicia la simulación.');
          setSimulating(false);
        }
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [simulating, id, submitTelemetryAnswers, loadData, simSpeed]);

  const isAdmin =
    profile?.roleKeys.includes('org_admin') ||
    profile?.roleKeys.includes('department_admin') ||
    profile?.roleKeys.includes('project_creator');

  const handleTakeUse = async () => {
    if (actioning) return;
    setActioning('takeUse');
    try {
      await takeUse(id);
      toast.success('Activo puesto en uso con éxito.');
      void loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al poner el activo en uso.');
    } finally {
      setActioning(null);
    }
  };

  const handleReleaseUse = async () => {
    if (actioning) return;
    setActioning('releaseUse');
    try {
      await releaseUse(id);
      toast.success('Activo liberado con éxito.');
      void loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al liberar el activo.');
    } finally {
      setActioning(null);
    }
  };

  const handleCloseStatusModal = () => {
    setStatusModalOpen(false);
    setStatusDesc('');
    if (asset) {
      setNewStatus(asset.status);
    }
  };

  const handleCloseAssignModal = () => {
    setAssignModalOpen(false);
    if (asset) {
      setNewAssignId(asset.assignedToId || '');
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actioning) return;
    setActioning('updateStatus');
    try {
      await updateStatus(id, newStatus, statusDesc);
      handleCloseStatusModal();
      toast.success('Estado actualizado con éxito.');
      void loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cambiar el estado.';
      toast.error(msg);
    } finally {
      setActioning(null);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actioning) return;
    setActioning('assign');
    try {
      await assign(id, newAssignId || null);
      handleCloseAssignModal();
      toast.success('Responsable asignado con éxito.');
      void loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cambiar responsable.';
      toast.error(msg);
    } finally {
      setActioning(null);
    }
  };

  const handleSendManualTelemetry = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingManualTelemetry(true);
    setTelemetryMessage(null);
    try {
      const lat = parseFloat(manualLat);
      const lng = parseFloat(manualLng);
      const speed = parseFloat(manualSpeed);
      if (isNaN(lat) || isNaN(lng) || isNaN(speed)) {
        throw new Error('Todos los campos deben ser valores numéricos válidos.');
      }
      await submitTelemetryAnswers(id, {
        latitude: lat,
        longitude: lng,
        speed: speed,
      });
      setTelemetryMessage({ type: 'success', text: 'Telemetría enviada con éxito.' });
      void loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al enviar telemetría.';
      setTelemetryMessage({ type: 'error', text: msg });
    } finally {
      setSubmittingManualTelemetry(false);
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocError(null);
    if (!docFile || !docName) {
      setDocError('Nombre y archivo son requeridos.');
      return;
    }
    try {
      await uploadDoc(id, docName, docType, docFile, docExpDate || undefined);
      setDocName('');
      setDocFile(null);
      setDocExpDate('');
      // Reset input element
      const fileInput = document.getElementById('doc-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      toast.success('Documento subido con éxito.');
      void loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al subir documento.';
      setDocError(msg);
    }
  };

  const handleReviewDoc = async (docId: string, status: 'APROBADO' | 'RECHAZADO', reason?: string) => {
    if (status === 'RECHAZADO' && reason === undefined) {
      setRejectingDocId(docId);
      return;
    }
    try {
      await reviewDoc(id, docId, { status, reason: reason || undefined });
      toast.success(`Documento ${status === 'APROBADO' ? 'aprobado' : 'rechazado'} con éxito.`);
      void loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al revisar documento.';
      toast.error(msg);
    }
  };

  const handleAddAccessory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName) return;
    try {
      if (editingAccId) {
        await updateAccessory(id, editingAccId, {
          name: accName,
          description: accDesc || undefined,
          serialNumber: accSN || undefined,
        });
        setEditingAccId(null);
        toast.success('Accesorio actualizado con éxito.');
      } else {
        await addAccessory(id, {
          name: accName,
          description: accDesc || undefined,
          serialNumber: accSN || undefined,
        });
        toast.success('Accesorio agregado con éxito.');
      }
      setAccName('');
      setAccDesc('');
      setAccSN('');
      void loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar accesorio.');
    }
  };

  const handleDeleteAccessory = async (accId: string) => {
    if (actioning) return;
    setActioning('deleteAccessory');
    try {
      await deleteAccessory(id, accId);
      toast.success('Accesorio eliminado con éxito.');
      void loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar accesorio.');
    } finally {
      setActioning(null);
      setDeleteAccId(null);
    }
  };

  const handleAddItemToTpl = () => {
    const newItem: ChecklistTemplateItem = {
      id: Math.random().toString(36).substring(2, 9),
      label: 'Nuevo Ítem',
      type: 'YES_NO',
      required: true,
    };
    setTplItems([...tplItems, newItem]);
  };

  const handleUpdateItemInTpl = (itemId: string, field: string, value: unknown) => {
    setTplItems(
      tplItems.map((item) => {
        if (item.id === itemId) {
          return { ...item, [field]: value } as ChecklistTemplateItem;
        }
        return item;
      }),
    );
  };

  const handleRemoveItemFromTpl = (itemId: string) => {
    setTplItems(tplItems.filter((item) => item.id !== itemId));
  };

  const handleSaveTpl = async () => {
    if (!tplName) {
      toast.error('El nombre de la plantilla es requerido.');
      return;
    }
    try {
      await updateTemplate(id, { name: tplName, items: tplItems });
      setShowTplConfig(false);
      void loadData();
      toast.success('Nueva revisión de plantilla enviada para revisión.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar plantilla.');
    }
  };

  const handleReviewTpl = async (status: 'APROBADO' | 'RECHAZADO', reason?: string) => {
    if (status === 'RECHAZADO' && reason === undefined) {
      setRejectingTpl(true);
      return;
    }
    try {
      await reviewTemplate(id, { status, reason: reason || undefined });
      toast.success(`Plantilla ${status === 'APROBADO' ? 'aprobada' : 'rechazada'} con éxito.`);
      void loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al revisar plantilla.');
    }
  };

  const handleSubmitChecklistAnswers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template) return;

    try {
      const answers: ChecklistAnswer[] = template.items.map((item) => {
        const val = executionAnswers[item.id];
        if (item.required && (val === undefined || val === '')) {
          throw new Error(`El ítem "${item.label}" es requerido.`);
        }
        return {
          itemId: item.id,
          label: item.label,
          value: val as string | number | boolean,
        };
      });

      const submission = await submitChecklistAnswers(id, { templateId: template.id, answers });
      setExecutionAnswers({});
      void loadData();
      // Confirmamos que quedó en el historial y ofrecemos la descarga del PDF.
      toast.success('Checklist enviado y registrado en el historial.', {
        action: {
          label: 'Descargar PDF',
          onClick: () => void handleDownloadPdf(submission.id),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar checklist.');
    }
  };

  // Descarga el PDF de una inspección (endpoint GET .../submissions/:sid/pdf),
  // obtiene el blob y dispara la descarga en el navegador vía objectURL.
  const handleDownloadPdf = async (submissionId: string) => {
    if (downloadingPdfId) return;
    setDownloadingPdfId(submissionId);
    try {
      const blob = await getSubmissionPdf(id, submissionId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `checklist-${asset?.code ?? id}-${submissionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al descargar el PDF.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  // "Reportar uso": lleva al operador al checklist de operación. Si es vehículo y
  // aún no hay plantilla configurada, precarga la plantilla estándar de camioneta.
  const goToChecklist = (loadVehicleTemplate = false) => {
    setDetailTab('checklist');
    setShowTplConfig(false);
    if (loadVehicleTemplate && (!template || template.items.length === 0)) {
      setShowTplConfig(true);
      setTplItems([
        { id: '1', label: 'Motor: Nivel de aceite e inspección visual', type: 'YES_NO', required: true },
        { id: '2', label: 'Frenos: Nivel de líquido e inspección visual', type: 'YES_NO', required: true },
        { id: '3', label: 'Neumáticos: Presión y estado general', type: 'YES_NO', required: true },
        { id: '4', label: 'Luces: Altas, bajas, intermitentes y freno', type: 'YES_NO', required: true },
        { id: 'kilometraje', label: 'Kilometraje actual del vehículo (odómetro)', type: 'NUMBER', required: true },
        { id: '6', label: 'Observaciones generales o novedades', type: 'TEXT', required: false },
      ]);
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center animate-pulse">
        <Clock className="size-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="p-6 border border-destructive/20 bg-destructive/5 text-destructive rounded-xl text-center flex flex-col items-center gap-3">
        <AlertCircle className="size-12" />
        <h3 className="font-semibold text-lg">Activo no encontrado</h3>
        <Button onClick={onBack}>Volver atrás</Button>
      </div>
    );
  }

  const publicUrl = `${window.location.origin}/public/activos/${asset.publicToken}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(publicUrl)}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Header back button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{asset.name}</h2>
            <Badge variant="outline">{asset.code}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Ficha de activo y trazabilidad</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Info card & QR */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3 flex flex-row justify-between items-start gap-4">
              <div>
                <CardTitle className="text-lg">Información General</CardTitle>
                <CardDescription>Detalles técnicos y estado actual</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setStatusModalOpen(true)}>
                  Cambiar Estado
                </Button>
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => setAssignModalOpen(true)}>
                    Responsable
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-3">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Tipo de Recurso:</span>
                  <span className="font-medium text-foreground">{ASSET_TYPE_LABELS[asset.type]}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Estado actual:</span>
                  <span className="font-semibold">{asset.status}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Proyecto asignado:</span>
                  <span className="font-medium">{asset.project?.name || 'Global / Libre'}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Responsable a cargo:</span>
                  <span className="font-medium">
                    {asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : 'Sin asignar'}
                  </span>
                </div>
                {asset.status === 'EN_USO' && (
                  <>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Uso actual por:</span>
                      <span className="font-medium">{asset.inUseBy ? `${asset.inUseBy.firstName} ${asset.inUseBy.lastName}` : 'Desconocido'}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Desde:</span>
                      <span className="font-medium">{asset.inUseSince ? new Date(asset.inUseSince).toLocaleString('es-CL') : 'N/A'}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Subtype metadata details rendering */}
              {(() => {
                interface AssetMetadata {
                  chargeCycles?: number | string;
                  calibrationDate?: string;
                  odometerKm?: number | string;
                  plateCode?: string;
                  year?: number | string;
                }
                const meta = (asset.metadata ?? {}) as AssetMetadata;
                return (
                  <div className="col-span-full mt-2 bg-muted/20 border p-3 rounded-lg">
                    <p className="text-xs font-semibold text-primary mb-2">Especificaciones de Ficha</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Fabricante:</span>
                        <span className="font-medium text-foreground">{asset.manufacturer || 'No declarado'}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          {asset.identifierType ? IDENTIFIER_TYPE_LABELS[asset.identifierType] : 'Identificador'}:
                        </span>
                        <span className="font-mono text-foreground">{asset.identifier || 'No declarado'}</span>
                      </div>
                      {asset.type === 'VEHICULO' && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Tipo de vehículo:</span>
                          <span className="font-medium text-foreground">
                            {asset.vehicleSubtype ? VEHICLE_SUBTYPE_LABELS[asset.vehicleSubtype] : 'No declarado'}
                          </span>
                        </div>
                      )}
                      {asset.type === 'EQUIPO' && (
                        <>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Ciclos de uso:</span>
                            <span className="font-medium text-foreground">{String(meta.chargeCycles ?? 0)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Próxima Calibración:</span>
                            <span className="font-medium text-foreground">
                              {meta.calibrationDate ? formatDate(meta.calibrationDate) : 'No declarada'}
                            </span>
                          </div>
                        </>
                      )}
                      {asset.type === 'VEHICULO' && (
                        <>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Kilometraje acumulado:</span>
                            <span className="font-medium text-foreground">{String(meta.odometerKm ?? 0)} km</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Patente/Matrícula:</span>
                            <span className="font-mono text-foreground">{meta.plateCode || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Año:</span>
                            <span className="font-medium text-foreground">{meta.year ? String(meta.year) : 'No declarado'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t flex justify-between gap-4 items-center">
              <div>
                <p className="text-xs text-muted-foreground">Control de disputa en vivo</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => goToChecklist(false)}
                >
                  <ClipboardCheck className="size-3.5 mr-1.5" />
                  Reportar uso
                </Button>
                {asset.type === 'VEHICULO' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => goToChecklist(true)}
                  >
                    <ListTodo className="size-3.5 mr-1.5" />
                    Checklist de camioneta
                  </Button>
                )}
                {asset.status === 'DISPONIBLE' && (
                  <Button size="sm" onClick={() => void handleTakeUse()} disabled={actioning !== null}>
                    {actioning === 'takeUse' ? 'Poniendo en uso...' : 'Poner en uso'}
                  </Button>
                )}
                {asset.status === 'EN_USO' && (asset.inUseById === profile?.id || isAdmin) && (
                  <Button size="sm" variant="outline" onClick={() => void handleReleaseUse()} disabled={actioning !== null}>
                    {actioning === 'releaseUse' ? 'Liberando...' : 'Liberar'}
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>

          {/* Detail View Tab Header */}
          <div className="flex border-b border-border gap-2 mb-4">
            <button
              onClick={() => setDetailTab('documentos')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                detailTab === 'documentos'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="size-3.5" /> Documentos
            </button>
            <button
              onClick={() => setDetailTab('accesorios')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                detailTab === 'accesorios'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Package className="size-3.5" /> Accesorios ({accessories.length})
            </button>
            <button
              onClick={() => setDetailTab('checklist')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                detailTab === 'checklist'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <ListTodo className="size-3.5" /> Checklist y Control
            </button>
            <button
              onClick={() => setDetailTab('historial')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                detailTab === 'historial'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <History className="size-3.5" /> Historial ({history.length})
            </button>
            {asset.type === 'VEHICULO' && (
              <button
                onClick={() => setDetailTab('telemetria')}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailTab === 'telemetria'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Car className="size-3.5" /> Ubicación y Telemetría
              </button>
            )}
          </div>

          {/* Documents Tab */}
          {detailTab === 'documentos' && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="size-4 text-primary" /> Documentos del Activo
                  </CardTitle>
                  <CardDescription>Certificaciones, manuales y hojas de vida</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {/* Form Upload */}
                <form onSubmit={handleUploadDoc} className="border border-dashed p-4 rounded-lg bg-card/25 flex flex-col gap-3">
                  <p className="text-xs font-semibold text-foreground">Cargar Documentación</p>
                  {docError && <p className="text-xs text-destructive">{docError}</p>}
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="doc-name" className="text-xs">Nombre Documento</Label>
                      <Input
                        id="doc-name"
                        required
                        value={docName}
                        onChange={(e) => setDocName(e.target.value)}
                        placeholder="Ej. Certificación TÜV 2026"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="doc-type" className="text-xs">Categoría</Label>
                      <Select
                        id="doc-type"
                        aria-label="Categoría del documento"
                        value={docType}
                        onChange={(e) => setDocType(e.target.value)}
                        className="h-8 text-xs"
                      >
                        <option value="CERT">Certificado</option>
                        <option value="MANUAL">Manual Técnico</option>
                        <option value="SEGURO">Seguro / Póliza</option>
                        <option value="HOJA_VIDA">Hoja de Vida / Checklists</option>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="doc-exp" className="text-xs">Expiración (Opcional)</Label>
                      <Input
                        id="doc-exp"
                        type="date"
                        value={docExpDate}
                        onChange={(e) => setDocExpDate(e.target.value)}
                        className="h-8 text-xs bg-transparent"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="doc-file" className="text-xs">Archivo (PDF o Imagen)</Label>
                      <input
                        id="doc-file"
                        type="file"
                        required
                        onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end mt-1">
                    <Button type="submit" size="sm">Subir Documento</Button>
                  </div>
                </form>

                {/* Docs list */}
                {docs.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6">No hay documentos registrados para este activo.</p>
                ) : (
                  <div className="space-y-3">
                    {docs.map((doc) => {
                      const isExpired = doc.expirationDate ? new Date(doc.expirationDate).getTime() < Date.now() : false;
                      const isExpiringSoon = doc.expirationDate && !isExpired ? (new Date(doc.expirationDate).getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000 : false;
                      
                      return (
                        <div
                          key={doc.id}
                          className="flex flex-col md:flex-row md:items-center justify-between p-3 rounded-lg border bg-card/30 text-xs gap-3"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground text-sm">{doc.name}</span>
                              <Badge variant="outline" className="text-[10px] py-0">{doc.type}</Badge>
                              {doc.expirationDate && (
                                <Badge className={`text-[10px] py-0 ${
                                  isExpired ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                  isExpiringSoon ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse' :
                                  'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                }`}>
                                  {isExpired ? 'Vencido' : isExpiringSoon ? 'Por Vencer' : 'Vigente'}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Estado: <span className="font-medium text-foreground">{doc.status}</span>
                              {doc.expirationDate && (
                                <span className="ml-2 font-mono text-[10px]">
                                  (Vence: {formatDate(doc.expirationDate)})
                                </span>
                              )}
                            </p>
                          </div>

                        <div className="flex items-center gap-3 justify-end">
                          <a
                            href={doc.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary font-medium hover:underline"
                          >
                            Ver Archivo
                          </a>

                          {doc.status === 'EN_REVISION' && isAdmin && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                onClick={() => handleReviewDoc(doc.id, 'APROBADO')}
                              >
                                Aprobar
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleReviewDoc(doc.id, 'RECHAZADO')}
                              >
                                Rechazar
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Accessories Tab */}
          {detailTab === 'accesorios' && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Package className="size-4 text-primary" /> Accesorios del Activo
                  </CardTitle>
                  <CardDescription>Piezas, herramientas secundarias y complementos asignados</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {/* Form to Add/Edit (Admins) */}
                {isAdmin && (
                  <form onSubmit={handleAddAccessory} className="border border-dashed p-4 rounded-lg bg-card/25 flex flex-col gap-3">
                    <p className="text-xs font-semibold text-foreground">
                      {editingAccId ? 'Editar Accesorio' : 'Registrar Nuevo Accesorio'}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="acc-name" className="text-xs">Nombre</Label>
                        <Input
                          id="acc-name"
                          required
                          value={accName}
                          onChange={(e) => setAccName(e.target.value)}
                          placeholder="Ej. Sonda de georradar"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="acc-desc" className="text-xs">Descripción (Opcional)</Label>
                        <Input
                          id="acc-desc"
                          value={accDesc}
                          onChange={(e) => setAccDesc(e.target.value)}
                          placeholder="Ej. Sonda de repuesto"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="acc-sn" className="text-xs">N° de Serie (Opcional)</Label>
                        <Input
                          id="acc-sn"
                          value={accSN}
                          onChange={(e) => setAccSN(e.target.value)}
                          placeholder="Ej. SN-SNDA-998"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-1">
                      {editingAccId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingAccId(null);
                            setAccName('');
                            setAccDesc('');
                            setAccSN('');
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                      <Button type="submit" size="sm">
                        {editingAccId ? 'Actualizar Accesorio' : 'Agregar Accesorio'}
                      </Button>
                    </div>
                  </form>
                )}

                {/* List */}
                {accessories.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6">No hay accesorios asignados a este equipo.</p>
                ) : (
                  <div className="space-y-2">
                    {accessories.map((acc) => (
                      <div key={acc.id} className="flex justify-between items-center p-3 rounded-lg border bg-card/30 text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-foreground text-sm">{acc.name}</span>
                          {acc.description && <p className="text-muted-foreground mt-0.5">{acc.description}</p>}
                          {acc.serialNumber && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                              S/N: {acc.serialNumber}
                            </p>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingAccId(acc.id);
                                setAccName(acc.name);
                                setAccDesc(acc.description || '');
                                setAccSN(acc.serialNumber || '');
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteAccId(acc.id)}
                            >
                              Eliminar
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Checklist Tab */}
          {detailTab === 'checklist' && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ListTodo className="size-4 text-primary" /> Checklist de Operación
                  </CardTitle>
                  <CardDescription>Control de bitácora y verificación del activo</CardDescription>
                </div>
                {isAdmin && template && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowTplConfig(!showTplConfig)}
                  >
                    <Settings className="size-3.5 mr-1.5" />
                    {showTplConfig ? 'Ver Checklist' : 'Configurar Preguntas'}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                
                {/* Template status card if in review */}
                {template && template.status === 'EN_REVISION' && (
                  <div className="border border-amber-500/30 bg-amber-500/5 p-4 rounded-lg flex flex-col gap-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-amber-500 animate-pulse" />
                        <span className="font-semibold text-amber-500">Nueva versión de checklist en revisión</span>
                      </div>
                      <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">En Revisión</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      La plantilla de checklist ha sido editada y se encuentra pendiente de aprobación para poder ser ejecutada.
                    </p>
                    {isAdmin && (
                      <div className="flex justify-end gap-2 mt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border-emerald-500/20"
                          onClick={() => handleReviewTpl('APROBADO')}
                        >
                          Aprobar Plantilla
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleReviewTpl('RECHAZADO')}
                        >
                          Rechazar
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Template status card if rejected */}
                {template && template.status === 'RECHAZADO' && (
                  <div className="border border-rose-500/30 bg-rose-500/5 p-4 rounded-lg flex flex-col gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <X className="size-4 text-rose-500" />
                      <span className="font-semibold text-rose-500">Plantilla Rechazada</span>
                    </div>
                    <p className="text-muted-foreground">
                      Esta plantilla fue rechazada por el revisor. Debe configurarse una nueva versión.
                    </p>
                    {template.rejectionReason && (
                      <p className="font-medium text-foreground bg-rose-500/10 p-2 rounded mt-1 font-mono">
                        Motivo del rechazo: {template.rejectionReason}
                      </p>
                    )}
                  </div>
                )}

                {/* Checklist template config builder (Admins) */}
                {showTplConfig && template && (
                  <div className="border border-border p-4 rounded-lg bg-card/25 flex flex-col gap-4">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <Settings className="size-3.5 text-primary" /> Diseñador de Plantilla de Checklist
                    </p>
                    
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="tpl-title" className="text-xs">Nombre de la Plantilla</Label>
                      <Input
                        id="tpl-title"
                        required
                        value={tplName}
                        onChange={(e) => setTplName(e.target.value)}
                        placeholder="Ej. Checklist Diario de Seguridad"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="flex flex-col gap-3">
                      <p className="text-[11px] font-semibold text-muted-foreground">Preguntas y Puntos de Control ({tplItems.length})</p>
                      
                      {tplItems.length === 0 ? (
                        <p className="text-center text-xs text-muted-foreground border border-dashed py-4 rounded">
                          No hay preguntas definidas. Haz clic en "Agregar Pregunta" para iniciar.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {tplItems.map((item, index) => (
                            <div key={item.id} className="flex flex-col md:flex-row md:items-center gap-3 p-3 border rounded bg-card/40 text-xs">
                              <span className="font-bold text-muted-foreground">#{index + 1}</span>
                              
                              <div className="flex-1">
                                <Input
                                  value={item.label}
                                  onChange={(e) => handleUpdateItemInTpl(item.id, 'label', e.target.value)}
                                  placeholder="Ej. ¿Nivel de aceite correcto?"
                                  className="h-8 text-xs w-full"
                                />
                              </div>

                              <div className="w-full md:w-32">
                                <Select
                                  aria-label={`Tipo de respuesta del ítem ${index + 1}`}
                                  value={item.type}
                                  onChange={(e) => handleUpdateItemInTpl(item.id, 'type', e.target.value)}
                                  className="h-8 px-2 text-xs"
                                >
                                  <option value="YES_NO">Sí / No</option>
                                  <option value="NUMBER">Número</option>
                                  <option value="TEXT">Texto</option>
                                </Select>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  id={`req-${item.id}`}
                                  checked={item.required}
                                  onChange={(e) => handleUpdateItemInTpl(item.id, 'required', e.target.checked)}
                                  className="size-3.5 rounded border-gray-300"
                                />
                                <Label htmlFor={`req-${item.id}`} className="text-xs select-none">Obligatorio</Label>
                              </div>

                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 h-8 px-2"
                                onClick={() => handleRemoveItemFromTpl(item.id)}
                              >
                                Eliminar
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 justify-between mt-2">
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={handleAddItemToTpl}>
                            Agregar Pregunta
                          </Button>
                          {asset.type === 'VEHICULO' && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setTplItems([
                                  { id: '1', label: 'Motor: Nivel de aceite e inspección visual', type: 'YES_NO', required: true },
                                  { id: '2', label: 'Frenos: Nivel de líquido e inspección visual', type: 'YES_NO', required: true },
                                  { id: '3', label: 'Neumáticos: Presión y estado general', type: 'YES_NO', required: true },
                                  { id: '4', label: 'Luces: Altas, bajas, intermitentes y freno', type: 'YES_NO', required: true },
                                  { id: 'kilometraje', label: 'Kilometraje actual del vehículo (odómetro)', type: 'NUMBER', required: true },
                                  { id: '6', label: 'Observaciones generales o novedades', type: 'TEXT', required: false },
                                ]);
                              }}
                            >
                              Cargar Plantilla Estándar Camioneta
                            </Button>
                          )}
                        </div>
                        <Button type="button" size="sm" onClick={handleSaveTpl}>
                          Guardar Cambios y Enviar a Revisión
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form to Run Checklist (Operator/Admins) */}
                {!showTplConfig && template && template.status === 'APROBADO' && (
                  <form onSubmit={handleSubmitChecklistAnswers} className="border border-dashed p-4 rounded-lg bg-card/25 flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="size-4 text-emerald-500" />
                      <p className="text-xs font-semibold text-foreground">Ejecutar Inspección Diaria (Checklist Activo)</p>
                    </div>

                    {template.items.length === 0 ? (
                      <p className="text-center text-xs text-muted-foreground py-4">No hay preguntas de inspección configuradas en este checklist.</p>
                    ) : (
                      <>
                        <div className="space-y-4">
                          {template.items.map((item) => (
                            <div key={item.id} className="flex flex-col gap-1.5 text-xs">
                              <Label className="font-semibold text-foreground flex gap-1">
                                {item.label}
                                {item.required && <span className="text-rose-500">*</span>}
                              </Label>
                              
                              {item.type === 'YES_NO' && (
                                <div className="flex gap-4 mt-1">
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`ans-${item.id}`}
                                      required={item.required}
                                      checked={executionAnswers[item.id] === true}
                                      onChange={() => setExecutionAnswers({ ...executionAnswers, [item.id]: true })}
                                      className="size-4 text-primary"
                                    />
                                    <span>Correcto / Sí</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`ans-${item.id}`}
                                      required={item.required}
                                      checked={executionAnswers[item.id] === false}
                                      onChange={() => setExecutionAnswers({ ...executionAnswers, [item.id]: false })}
                                      className="size-4 text-rose-500"
                                    />
                                    <span className="text-rose-400 font-medium">Falla / No</span>
                                  </label>
                                </div>
                              )}

                              {item.type === 'NUMBER' && (
                                <Input
                                  type="number"
                                  required={item.required}
                                  value={(executionAnswers[item.id] as string | number | undefined) ?? ''}
                                  onChange={(e) => setExecutionAnswers({ ...executionAnswers, [item.id]: e.target.value === '' ? '' : Number(e.target.value) })}
                                  placeholder="Ingresa un valor numérico"
                                  className="h-8 text-xs w-full max-w-xs"
                                />
                              )}

                              {item.type === 'TEXT' && (
                                <Input
                                  type="text"
                                  required={item.required}
                                  value={(executionAnswers[item.id] as string | undefined) ?? ''}
                                  onChange={(e) => setExecutionAnswers({ ...executionAnswers, [item.id]: e.target.value })}
                                  placeholder="Ingresa tus observaciones"
                                  className="h-8 text-xs w-full"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                        
                        <div className="flex justify-end mt-2">
                          <Button type="submit" size="sm">
                            Firmar y Enviar Inspección
                          </Button>
                        </div>
                      </>
                    )}
                  </form>
                )}

                {/* Submissions list */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <History className="size-3.5" /> Historial de Inspecciones ({submissions.length})
                  </p>
                  
                  {submissions.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground border py-6 rounded">
                      No hay reportes de checklist enviados anteriormente para este activo.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {submissions.map((sub) => {
                        const hasSubFailure = sub.answers.some(
                          (ans) => ans.value === false || ans.value === 'no' || ans.value === 'failed'
                        );
                        
                        return (
                          <div
                            key={sub.id}
                            className={`p-3 rounded-lg border text-xs gap-3 flex flex-col bg-card/30 ${
                              hasSubFailure ? 'border-rose-500/20 bg-rose-500/5' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-foreground">
                                  Inspección por {sub.user ? `${sub.user.firstName} ${sub.user.lastName}` : 'Desconocido'}
                                </span>
                                {hasSubFailure && (
                                  <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-[10px] py-0">
                                    Falla Reportada
                                  </Badge>
                                )}
                              </div>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {new Date(sub.createdAt).toLocaleDateString('es-CL')} {new Date(sub.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1 border-t pt-2 border-border/40">
                              {sub.answers.map((ans, idx) => (
                                <div key={idx} className="flex justify-between text-[11px] gap-2 border-b border-border/20 pb-1">
                                  <span className="text-muted-foreground truncate">{ans.label || ans.itemId}:</span>
                                  <span className={`font-semibold ${
                                    ans.value === true ? 'text-emerald-500' :
                                    ans.value === false ? 'text-rose-500' : 'text-foreground'
                                  }`}>
                                    {ans.value === true ? 'Correcto' :
                                     ans.value === false ? 'Falla / Incorrecto' : String(ans.value)}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div className="flex justify-end mt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px]"
                                disabled={downloadingPdfId !== null}
                                onClick={() => void handleDownloadPdf(sub.id)}
                              >
                                <FileText className="size-3 mr-1.5" />
                                {downloadingPdfId === sub.id ? 'Generando...' : 'Descargar PDF'}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Historial de Uso Tab */}
          {detailTab === 'historial' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="size-4 text-primary" /> Historial de Uso
                </CardTitle>
                <CardDescription>
                  Bitácora de eventos del activo: tomas, liberaciones, checklists y cambios de estado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground border border-dashed py-8 rounded">
                    No hay registros de uso para este activo todavía.
                  </p>
                ) : (
                  <div className="relative border-l border-border ml-2 pl-4 space-y-4 py-2">
                    {history.map((h) => (
                      <div key={h.id} className="relative text-xs">
                        <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-primary border border-background" />
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px] py-0">{h.type}</Badge>
                            <span className="font-medium text-foreground">{h.description}</span>
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                            <span>Por {h.actor ? `${h.actor.firstName} ${h.actor.lastName}` : 'Sistema'}</span>
                            <span className="font-mono">
                              {new Date(h.createdAt).toLocaleDateString('es-CL')} {new Date(h.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {detailTab === 'telemetria' && asset && asset.type === 'VEHICULO' && (() => {
            const getCoords = (lat: number, lng: number) => {
              const minLat = -33.472;
              const maxLat = -33.450;
              const minLng = -70.680;
              const maxLng = -70.658;
              const y = ((maxLat - lat) / (maxLat - minLat)) * 350;
              const x = ((lng - minLng) / (maxLng - minLng)) * 500;
              return { x, y };
            };

            const metadata = (asset.metadata as Record<string, unknown> | null) || {};
            const speed = metadata.speed !== undefined ? Number(metadata.speed) : 0;
            const location = metadata.location as { latitude: number; longitude: number; updatedAt?: string } | null;
            const speedLimit = metadata.speedLimit !== undefined ? Number(metadata.speedLimit) : 100;
            const currentLoc = location || { latitude: -33.456, longitude: -70.662 };
            const { x: curX, y: curY } = getCoords(currentLoc.latitude, currentLoc.longitude);

            return (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <MapPin className="size-4 text-primary" /> Monitoreo de Ubicación y Trayecto
                      </CardTitle>
                      <CardDescription>
                        Última ubicación registrada, velocidad y simulación de trayecto.
                      </CardDescription>
                    </div>
                    <Badge variant={simulating ? "default" : "outline"} className={simulating ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20 animate-pulse" : "text-muted-foreground"}>
                      <Wifi className="size-3 mr-1.5" />
                      {simulating ? 'Simulación Activa' : 'Sin señal activa'}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-6">
                  {/* 1. MOCK MAP INTERACTIVO */}
                  <div className="relative w-full h-[360px] bg-slate-950 border border-slate-800 rounded-lg overflow-hidden shadow-inner flex flex-col justify-between p-4 font-mono select-none">
                    {/* Grid background & design patterns */}
                    <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />
                    
                    {/* Map SVG element */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 500 350" preserveAspectRatio="none">
                      {/* Simulated streets/roads */}
                      <line x1="0" y1="100" x2="500" y2="100" stroke="#1e293b" strokeWidth="2" strokeDasharray="4,4" />
                      <line x1="0" y1="220" x2="500" y2="220" stroke="#1e293b" strokeWidth="2" />
                      <line x1="150" y1="0" x2="150" y2="350" stroke="#1e293b" strokeWidth="2" />
                      <line x1="380" y1="0" x2="380" y2="350" stroke="#1e293b" strokeWidth="2" strokeDasharray="6,4" />
                      
                      {/* Diagonals to simulate avenues */}
                      <path d="M 0,0 L 500,350" stroke="#334155" strokeWidth="1.5" strokeOpacity="0.4" />
                      <path d="M 0,350 L 500,0" stroke="#334155" strokeWidth="1.5" strokeOpacity="0.4" />

                      {/* Pre-drawn Santiago Route Line */}
                      <polyline
                        points="409,95 340,127 272,159 204,190 136,238 68,286"
                        fill="none"
                        stroke="#4f46e5"
                        strokeWidth="3"
                        strokeDasharray="4,4"
                        strokeOpacity="0.75"
                      />

                      {/* Landmark Hub Circles */}
                      <circle cx="409" cy="95" r="4" fill="#312e81" stroke="#4f46e5" strokeWidth="1" />
                      <circle cx="272" cy="159" r="4" fill="#312e81" stroke="#4f46e5" strokeWidth="1" />
                      <circle cx="68" cy="286" r="4" fill="#312e81" stroke="#4f46e5" strokeWidth="1" />
                      
                      {/* Blinking Vehicle Indicator */}
                      <circle cx={curX} cy={curY} r="10" fill="#06b6d4" className="animate-ping opacity-60" />
                      <circle cx={curX} cy={curY} r="6" fill="#06b6d4" stroke="#ffffff" strokeWidth="2" />
                    </svg>

                    {/* Labels overlay */}
                    <div className="absolute top-6 right-8 text-[10px] text-slate-500 font-semibold tracking-wider pointer-events-none">PROVIDENCIA</div>
                    <div className="absolute top-1/3 left-1/3 text-[10px] text-slate-500 font-semibold tracking-wider pointer-events-none">SANTIAGO CENTRO</div>
                    <div className="absolute bottom-12 left-8 text-[10px] text-slate-500 font-semibold tracking-wider pointer-events-none">ESTACIÓN CENTRAL</div>
                    
                    {/* Map HUD UI Details */}
                    <div className="relative flex justify-between items-start pointer-events-none">
                      <div className="bg-slate-900/90 border border-slate-800 text-[10px] text-emerald-400 p-2 rounded backdrop-blur-sm flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          GNSS FEED: ACTIVE
                        </div>
                        <div>SATELLITES: 12 (3D-FIX)</div>
                        <div>HDOP: 0.82</div>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 text-[10px] text-slate-300 p-2 rounded backdrop-blur-sm text-right flex flex-col gap-0.5">
                        <div>MAP VIEWPORT: SANTIAGO, CL</div>
                        <div>EPSG:4326</div>
                      </div>
                    </div>

                    {/* Map Bottom Coordinates Display */}
                    <div className="relative bg-slate-900/95 border border-slate-800 text-xs text-white p-3 rounded-lg backdrop-blur-sm flex justify-between items-center mt-auto">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Latitud</span>
                          <span className="font-semibold text-cyan-400">{currentLoc.latitude.toFixed(6)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Longitud</span>
                          <span className="font-semibold text-cyan-400">{currentLoc.longitude.toFixed(6)}</span>
                        </div>
                      </div>
                      {location?.updatedAt && (
                        <div className="text-[10px] text-muted-foreground text-right">
                          Actualizado: {new Date(location.updatedAt).toLocaleTimeString('es-CL')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 2. GAUGES & METRICS GRID */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* SPEED GAUGE CARD */}
                    <div className="p-4 rounded-lg border bg-card/45 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Gauge className="size-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Velocidad Actual</span>
                      </div>

                      <div className="flex flex-col items-center justify-center py-2 relative">
                        <span className={`text-4xl font-extrabold font-mono transition-colors duration-300 ${
                          speed > speedLimit ? 'text-rose-500 animate-pulse' :
                          speed > speedLimit * 0.8 ? 'text-amber-500' : 'text-emerald-500'
                        }`}>
                          {speed}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono mt-0.5">KM/H</span>

                        {speed > speedLimit && (
                          <span className="absolute -top-1 right-0 bg-rose-500/10 text-rose-500 text-[9px] px-1.5 py-0.5 rounded font-bold border border-rose-500/20 animate-bounce">
                            EXCESO
                          </span>
                        )}
                      </div>

                      {/* Speed Bar Progression */}
                      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            speed > speedLimit ? 'bg-rose-500' :
                            speed > speedLimit * 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, (speed / 140) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                        <span>0 km/h</span>
                        <span>Límite: {speedLimit} km/h</span>
                        <span>140 km/h</span>
                      </div>
                    </div>

                    {/* ODOMETER & STATUS CARD */}
                    <div className="p-4 rounded-lg border bg-card/45 flex flex-col justify-between">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <Car className="size-4 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase">Bitácora & Odómetro</span>
                        </div>

                        <div className="flex flex-col gap-1.5 text-xs">
                          <div className="flex justify-between border-b pb-1.5 border-border/40">
                            <span className="text-muted-foreground">Odómetro Activo:</span>
                            <span className="font-semibold font-mono text-foreground">
                              {metadata.odometer !== undefined ? `${Number(metadata.odometer).toLocaleString('es-CL')} km` : 'Sin registro'}
                            </span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5 border-border/40">
                            <span className="text-muted-foreground">Código QR:</span>
                            <span className="font-semibold font-mono">{asset.code}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Responsable:</span>
                            <span className="font-semibold text-foreground truncate max-w-[120px]">
                              {asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : 'No asignado'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SIMULATION CONTROLS CARD */}
                    <div className="p-4 rounded-lg border bg-slate-900/25 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Settings className="size-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Simulador de Trayecto</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className={`w-full text-xs font-semibold ${
                            simulating
                              ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20'
                          }`}
                          variant="outline"
                          onClick={() => setSimulating(!simulating)}
                        >
                          {simulating ? (
                            <>
                              <Square className="size-3 mr-1.5" /> Detener Simulación
                            </>
                          ) : (
                            <>
                              <Play className="size-3 mr-1.5" /> Iniciar Simulación
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Speed Selector */}
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-[10px] text-muted-foreground uppercase font-semibold">Velocidad Simulación</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                          {[60, 90, 120].map((v) => (
                            <Button
                              key={v}
                              size="sm"
                              type="button"
                              variant={simSpeed === v ? "default" : "outline"}
                              className="text-[10px] h-7 px-1"
                              onClick={() => setSimSpeed(v)}
                            >
                              {v} km/h {v > 100 ? '⚠️' : ''}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. MANUAL INJECTION FORM */}
                  <div className="border border-dashed p-4 rounded-lg bg-card/25 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Navigation className="size-4 text-primary" />
                        <span className="text-xs font-semibold text-foreground">Enviar Telemetría Manual (Prueba de API)</span>
                      </div>
                    </div>

                    <form onSubmit={handleSendManualTelemetry} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="manual-lat" className="text-[10px] text-muted-foreground">Latitud</Label>
                        <Input
                          id="manual-lat"
                          value={manualLat}
                          onChange={(e) => setManualLat(e.target.value)}
                          placeholder="Ej. -33.460"
                          className="h-8 text-xs font-mono"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="manual-lng" className="text-[10px] text-muted-foreground">Longitud</Label>
                        <Input
                          id="manual-lng"
                          value={manualLng}
                          onChange={(e) => setManualLng(e.target.value)}
                          placeholder="Ej. -70.668"
                          className="h-8 text-xs font-mono"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="manual-speed" className="text-[10px] text-muted-foreground">Velocidad (km/h)</Label>
                        <div className="flex gap-2">
                          <Input
                            id="manual-speed"
                            value={manualSpeed}
                            onChange={(e) => setManualSpeed(e.target.value)}
                            placeholder="Ej. 85"
                            className="h-8 text-xs font-mono flex-1"
                            required
                          />
                          <Button type="submit" size="sm" className="h-8 text-xs" disabled={submittingManualTelemetry}>
                            {submittingManualTelemetry ? 'Enviando...' : 'Enviar'}
                          </Button>
                        </div>
                      </div>
                    </form>

                    {telemetryMessage && (
                      <div className={`p-2.5 rounded text-xs border ${
                        telemetryMessage.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                      }`}>
                        {telemetryMessage.text}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>

        {/* Timeline & QR Panel */}
        <div className="flex flex-col gap-6">
          {/* QR Code Card */}
          <Card className="flex flex-col items-center justify-center text-center p-6 bg-card/30">
            <QrCode className="size-8 text-primary mb-2" />
            <h3 className="font-semibold text-sm">Código QR Público</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
              Ficha pública accesible sin credenciales. Imprimir y pegar en el equipo.
            </p>
            <div className="mt-4 p-3 bg-white rounded-lg border flex items-center justify-center">
              <img src={qrUrl} alt="Código QR del Activo" className="size-32" />
            </div>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline font-medium mt-3"
            >
              Ficha pública: {asset.code}
            </a>
          </Card>

          {/* Timeline History */}
          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="size-4 text-primary" /> Historial de Eventos
              </CardTitle>
              <CardDescription>Trazabilidad completa en terreno</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 max-h-[350px] overflow-y-auto pr-1">
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">No hay registros.</p>
              ) : (
                <div className="relative border-l border-border ml-2 pl-4 space-y-4 py-2">
                  {history.map((h) => (
                    <div key={h.id} className="relative text-xs">
                      {/* marker dot */}
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-primary border border-background" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{h.description}</span>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>Por {h.actor ? `${h.actor.firstName} ${h.actor.lastName}` : 'Sistema'}</span>
                          <span>{new Date(h.createdAt).toLocaleDateString('es-CL')}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* DIALOG EDIT STATUS */}
      {statusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-sm bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleUpdateStatus}>
              <CardHeader>
                <CardTitle>Cambiar Estado de Activo</CardTitle>
                <CardDescription>Actualiza el estado físico o de operación.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="status-select">Nuevo Estado</Label>
                  <Select
                    id="status-select"
                    aria-label="Nuevo estado del activo"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as AssetStatus)}
                  >
                    <option value="DISPONIBLE">Disponible</option>
                    <option value="MANTENIMIENTO">En Mantenimiento</option>
                    <option value="DEFECTUOSO">Defectuoso</option>
                    <option value="NO_DISPONIBLE">No Disponible</option>
                    <option value="BAJA">De Baja / Retirado</option>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="status-desc">Observación / Bitácora (Opcional)</Label>
                  <Input
                    id="status-desc"
                    value={statusDesc}
                    onChange={(e) => setStatusDesc(e.target.value)}
                    placeholder="Ej. Revisión anual de componentes"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={handleCloseStatusModal}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={actioning !== null}>
                  {actioning === 'updateStatus' ? 'Actualizando...' : 'Actualizar'}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* DIALOG ASSIGN RESPONSIBLE */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-sm bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleAssign}>
              <CardHeader>
                <CardTitle>Asignar Responsable</CardTitle>
                <CardDescription>Asigna el cargo y checklist del activo a un colaborador.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="assign-select">Colaborador Responsable</Label>
                  <Select
                    id="assign-select"
                    aria-label="Colaborador responsable"
                    value={newAssignId}
                    onChange={(e) => setNewAssignId(e.target.value)}
                  >
                    <option value="">Desasignar responsable</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                    ))}
                  </Select>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={handleCloseAssignModal}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={actioning !== null}>
                  {actioning === 'assign' ? 'Asignando...' : 'Asignar'}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteAccId !== null}
        onOpenChange={(open) => !open && setDeleteAccId(null)}
        title="¿Eliminar accesorio?"
        description="Esta acción eliminará de forma permanente el accesorio seleccionado. ¿Deseas continuar?"
        onConfirm={async () => {
          if (deleteAccId) {
            await handleDeleteAccessory(deleteAccId);
          }
        }}
      />

      <RejectDialog
        open={rejectingDocId !== null}
        onOpenChange={(open) => !open && setRejectingDocId(null)}
        title="Rechazar Documento"
        description="Ingrese el motivo por el cual rechaza este documento. Este motivo quedará registrado en la trazabilidad."
        onConfirm={async (reason) => {
          if (rejectingDocId) {
            await handleReviewDoc(rejectingDocId, 'RECHAZADO', reason);
          }
        }}
      />

      <RejectDialog
        open={rejectingTpl}
        onOpenChange={(open) => !open && setRejectingTpl(false)}
        title="Rechazar Plantilla de Checklist"
        description="Ingrese el motivo por el cual rechaza esta plantilla. Este motivo se mostrará al operador."
        onConfirm={async (reason) => {
          await handleReviewTpl('RECHAZADO', reason);
        }}
      />
    </div>
  );
}


