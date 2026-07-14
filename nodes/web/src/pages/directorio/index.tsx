import { useCallback, useId, useState, type ReactNode } from 'react';
import { Eye, Users, Building2 } from 'lucide-react';
import type { DirectoryEntry, TableRequest } from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTable, type DataTableColumn } from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { fetchDirectoryTable } from '@/lib/api';
import { useDirectory } from '@/hooks/use-directory';
import { PersonAvatar } from './person-avatar';
import { DirectoryDetailDialog } from './directory-detail-dialog';

/**
 * Página de Directorio (§6-1.6).
 *
 * Muestra colaboradores y clientes en pestañas separadas.
 * Colaboradores se listan en una tabla paginada/filtrada normal.
 * Clientes se agrupan visualmente por empresa (companyName).
 */
export default function DirectorioPage(): ReactNode {
  // `useDirectory` (carga completa) alimenta la pestaña Clientes (agrupada por
  // empresa, client-side) y los contadores de las pestañas. La tabla de
  // Colaboradores usa el MOTOR server-side (paginación/búsqueda/orden).
  const { entries, loading, error, refetch } = useDirectory();
  const idBase = useId();
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [activeTab, setActiveTab] = useState<'colaboradores' | 'clientes'>('colaboradores');
  const [clientSearch, setClientSearch] = useState('');

  // MOTOR de tablas de Colaboradores: el tipo se fija en `colaborador` en el fetcher.
  const fetcher = useCallback(
    (req: TableRequest) =>
      fetchDirectoryTable({ ...req, filters: { ...(req.filters ?? {}), tipo: 'colaborador' } }),
    [],
  );
  const table = useDataTable<DirectoryEntry>(fetcher, {
    initialPageSize: 10,
    initialSortBy: 'persona',
    initialSortDir: 'asc',
  });

  // Columnas para colaboradores (motor server-side).
  const columns: ReadonlyArray<DataTableColumn<DirectoryEntry>> = [
    {
      id: 'persona',
      header: 'Persona',
      sortable: true,
      render: (e) => (
        <div className="flex items-center gap-3">
          <PersonAvatar firstName={e.firstName} lastName={e.lastName} avatarUrl={e.avatarUrl} />
          <span className="font-medium">
            {e.firstName} {e.lastName}
          </span>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Correo',
      sortable: true,
      render: (e) => <span className="text-muted-foreground">{e.email}</span>,
    },
    {
      id: 'cargo',
      header: 'Cargo',
      sortable: true,
      render: (e) => <span className="text-muted-foreground">{e.cargo ?? 'Sin cargo'}</span>,
    },
  ];

  // Los clientes salen de la carga completa (pestaña agrupada + contador). El
  // contador de Colaboradores sale del `total` del motor (misma consulta que la
  // tabla), para no depender de un segundo fetch ni discrepar con ella.
  const clientes = entries.filter((e) => e.isClientUser);

  // Filtrar clientes por búsqueda
  const filteredClientes = clientes.filter((e) => {
    if (!clientSearch) return true;
    const q = clientSearch.toLowerCase();
    return (
      e.firstName.toLowerCase().includes(q) ||
      e.lastName.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.companyName && e.companyName.toLowerCase().includes(q))
    );
  });

  // Agrupar clientes por empresa
  const clientsByCompany: Record<string, DirectoryEntry[]> = {};
  filteredClientes.forEach((c) => {
    const comp = c.companyName || 'Sin Empresa';
    if (!clientsByCompany[comp]) {
      clientsByCompany[comp] = [];
    }
    clientsByCompany[comp].push(c);
  });

  const tabItems: TabItem<'colaboradores' | 'clientes'>[] = [
    { value: 'colaboradores', label: `Colaboradores (${table.total})`, icon: Users },
    { value: 'clientes', label: `Clientes (${clientes.length})`, icon: Building2 },
  ];

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Directorio"
        description="Encuentra a colaboradores y clientes y abre su detalle."
      />

      {/* Tabs selector */}
      <Tabs<'colaboradores' | 'clientes'>
        aria-label="Secciones del directorio"
        items={tabItems}
        value={activeTab}
        onValueChange={setActiveTab}
        idBase={idBase}
      />

      <TabPanel idBase={idBase} value={activeTab}>
      {activeTab === 'colaboradores' ? (
        <DataTable<DirectoryEntry>
          table={table}
          columns={columns}
          getRowId={(e) => e.id}
          searchable
          searchPlaceholder="Buscar colaboradores por nombre o correo…"
          onRowClick={(e) => setSelected(e)}
          emptyMessage="No hay colaboradores para mostrar."
          caption="Directorio de colaboradores"
          rowActions={(e) => (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(e)}
              aria-label={`Ver detalle de ${e.firstName} ${e.lastName}`}
            >
              <Eye aria-hidden className="size-4 mr-1.5" />
              Ver
            </Button>
          )}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Client Search bar */}
          <SearchInput
            className="max-w-md"
            label="Buscar clientes"
            placeholder="Buscar clientes por nombre, correo o empresa…"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            disabled={loading}
          />

          {loading ? (
            <LoadingState label="Cargando clientes…" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void refetch()} />
          ) : Object.keys(clientsByCompany).length === 0 ? (
            <EmptyState message="No se encontraron clientes." />
          ) : (
            <div className="flex flex-col gap-6">
              {Object.entries(clientsByCompany).map(([company, list]) => (
                <Card key={company} className="border border-border/60 shadow-xs overflow-hidden">
                  <CardHeader className="bg-accent/20 py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                      <Building2 className="size-4 text-muted-foreground" />
                      {company}
                    </CardTitle>
                    <Badge variant="secondary" className="text-[10px] font-bold">
                      {list.length} {list.length === 1 ? 'cliente' : 'clientes'}
                    </Badge>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Persona</TableHead>
                          <TableHead>Correo</TableHead>
                          <TableHead>Cargo</TableHead>
                          <TableHead className="text-right pr-4">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="pl-4 py-3">
                              <div className="flex items-center gap-3">
                                <PersonAvatar
                                  firstName={e.firstName}
                                  lastName={e.lastName}
                                  avatarUrl={e.avatarUrl}
                                />
                                <span className="font-medium">
                                  {e.firstName} {e.lastName}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <span className="text-muted-foreground">{e.email}</span>
                            </TableCell>
                            <TableCell className="py-3">
                              <span className="text-muted-foreground">{e.cargo ?? 'Sin cargo'}</span>
                            </TableCell>
                            <TableCell className="text-right pr-4 py-3">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelected(e)}
                                aria-label={`Ver detalle de ${e.firstName} ${e.lastName}`}
                              >
                                <Eye aria-hidden className="size-4 mr-1.5" />
                                Ver
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
      </TabPanel>

      <DirectoryDetailDialog
        entryId={selected?.id ?? null}
        fallbackEntry={selected}
        onClose={() => setSelected(null)}
      />
    </PageContainer>
  );
}
