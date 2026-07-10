import { useState, type ReactNode } from 'react';
import { Eye, Users, Building2 } from 'lucide-react';
import type { DirectoryEntry } from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, type TabItem } from '@/components/ui/tabs';
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
import {
  RoleScopedList,
  type RoleScopedColumn,
} from '@/components/primitives/role-scoped-list';
import { useDirectory } from '@/hooks/use-directory';
import { RoleChips } from '@/pages/usuarios/role-chips';
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
  const { entries, loading, error, refetch } = useDirectory();
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [activeTab, setActiveTab] = useState<'colaboradores' | 'clientes'>('colaboradores');
  const [clientSearch, setClientSearch] = useState('');

  // Columnas para colaboradores
  const columns: ReadonlyArray<RoleScopedColumn<DirectoryEntry>> = [
    {
      id: 'persona',
      header: 'Persona',
      sortable: true,
      accessor: (e) => `${e.firstName} ${e.lastName}`,
      render: (e) => (
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
      ),
    },
    {
      id: 'email',
      header: 'Correo',
      sortable: true,
      accessor: (e) => e.email,
      render: (e) => <span className="text-muted-foreground">{e.email}</span>,
    },
    {
      id: 'roles',
      header: 'Roles',
      render: (e) => <RoleChips roleKeys={e.roleKeys} />,
    },
  ];

  // Separar datos
  const colaboradores = entries.filter((e) => !e.isClientUser);
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
    { value: 'colaboradores', label: `Colaboradores (${colaboradores.length})`, icon: Users },
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
      />

      {activeTab === 'colaboradores' ? (
        <RoleScopedList<DirectoryEntry>
          items={colaboradores}
          columns={columns}
          getRowId={(e) => e.id}
          searchable
          searchPlaceholder="Buscar colaboradores por nombre o correo…"
          loading={loading}
          error={error}
          onRetry={() => void refetch()}
          emptyMessage="No hay colaboradores para mostrar."
          rowActionsLabel="Acciones"
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
          caption="Directorio de colaboradores"
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
                          <TableHead>Roles</TableHead>
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
                              <RoleChips roleKeys={e.roleKeys} />
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

      <DirectoryDetailDialog
        entryId={selected?.id ?? null}
        fallbackEntry={selected}
        onClose={() => setSelected(null)}
      />
    </PageContainer>
  );
}
