import { useState, type ReactNode } from 'react';
import { Eye, Search, Inbox, Users, Building2, AlertCircle } from 'lucide-react';
import type { DirectoryEntry } from '@gtm-link/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8 w-full max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Directorio
          </h1>
          <p className="text-muted-foreground mt-1">
            Encuentra a colaboradores y clientes y abre su detalle.
          </p>
        </div>
      </header>

      {/* Tabs selector */}
      <div className="flex border-b border-border gap-2">
        <button
          onClick={() => setActiveTab('colaboradores')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'colaboradores'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="size-4" />
          Colaboradores
          <Badge variant="secondary" className="ml-1 text-[10px] py-0 px-1.5 font-bold">
            {colaboradores.length}
          </Badge>
        </button>
        <button
          onClick={() => setActiveTab('clientes')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'clientes'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Building2 className="size-4" />
          Clientes
          <Badge variant="secondary" className="ml-1 text-[10px] py-0 px-1.5 font-bold">
            {clientes.length}
          </Badge>
        </button>
      </div>

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
          <div className="relative max-w-md w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="pl-9"
              placeholder="Buscar clientes por nombre, correo o empresa…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              disabled={loading}
            />
          </div>

          {loading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 2 }).map((_, idx) => (
                <Card key={idx} className="border border-border animate-pulse">
                  <div className="h-10 bg-muted/60 border-b border-border" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-muted/40 rounded w-1/3" />
                    <div className="h-4 bg-muted/40 rounded w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-12 border border-destructive/20 bg-destructive/5 rounded-xl text-center">
              <AlertCircle className="size-8 text-destructive mb-2" />
              <p className="text-sm text-destructive font-medium">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          ) : Object.keys(clientsByCompany).length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-xl bg-card">
              <Inbox className="size-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No se encontraron clientes.</p>
            </div>
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
    </div>
  );
}
