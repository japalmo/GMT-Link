import { useEffect, useId, useState } from 'react';
import type { HealthResponse } from '@gmt-platform/contracts';
import { Activity, FileWarning, Inbox, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/states';
import { Tabs, NavTabs, TabPanel } from '@/components/ui/tabs';
import { RejectDialog } from '@/components/ui/reject-dialog';
import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type ApiStatus = 'loading' | 'ok' | 'down';

const TOKENS: ReadonlyArray<{ name: string; className: string; border?: boolean }> = [
  { name: 'background', className: 'bg-background', border: true },
  { name: 'foreground', className: 'bg-foreground' },
  { name: 'card', className: 'bg-card', border: true },
  { name: 'muted', className: 'bg-muted', border: true },
  { name: 'muted-foreground', className: 'bg-muted-foreground' },
  { name: 'primary', className: 'bg-primary' },
  { name: 'secondary', className: 'bg-secondary', border: true },
  { name: 'accent', className: 'bg-accent', border: true },
  { name: 'destructive', className: 'bg-destructive' },
  { name: 'border', className: 'bg-border' },
  { name: 'ring', className: 'bg-ring' },
];

const MEMBERS: ReadonlyArray<{
  name: string;
  email: string;
  role: string;
  status: 'Activo' | 'Pendiente';
}> = [
  { name: 'Ana Reyes', email: 'ana@gmt.cl', role: 'Administradora', status: 'Activo' },
  { name: 'Bruno Lira', email: 'bruno@gmt.cl', role: 'Geofísico', status: 'Activo' },
  { name: 'Carla Soto', email: 'carla@ito.cl', role: 'Cliente ITO', status: 'Pendiente' },
];

function HealthChip({ status }: { status: ApiStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        status === 'ok' && 'border-primary/30 bg-primary/10 text-primary',
        status === 'down' &&
          'border-destructive/30 bg-destructive/10 text-destructive',
        status === 'loading' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      <Activity className="size-3.5" aria-hidden />
      {status === 'loading' && 'Verificando API…'}
      {status === 'ok' && 'API conectada'}
      {status === 'down' && 'API no disponible'}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignDemo() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('loading');
  const [loadingBtn, setLoadingBtn] = useState(false);
  const [demoTab, setDemoTab] = useState<'reembolsos' | 'horas' | 'liquidaciones'>(
    'reembolsos',
  );
  const demoTabsId = useId();
  const [rejectOpen, setRejectOpen] = useState(false);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
    let cancelled = false;

    async function checkHealth(): Promise<void> {
      try {
        const res = await fetch(`${apiUrl}/health`);
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setApiStatus(data.status === 'ok' ? 'ok' : 'down');
      } catch {
        if (!cancelled) setApiStatus('down');
      }
    }

    void checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  function simulateLoading(): void {
    setLoadingBtn(true);
    window.setTimeout(() => setLoadingBtn(false), 1600);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">GMT Link</p>
          <h1 className="text-3xl font-bold tracking-tight">Design system</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Etapa 0.6: tokens neutros re-tematizables y primitivos visuales.
          </p>
        </div>
        <HealthChip status={apiStatus} />
      </header>

      <div className="flex flex-col gap-12">
        {/* TIPOGRAFÍA */}
        <Section title="Tipografía">
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              <p className="text-3xl font-bold tracking-tight">Inter Variable · Bold 3xl</p>
              <p className="text-xl font-semibold">Subtítulo · Semibold xl</p>
              <p className="text-base">Cuerpo de texto base con peso normal.</p>
              <p className="text-sm text-muted-foreground">
                Texto secundario apagado · sm muted-foreground.
              </p>
              <p className="text-xs text-muted-foreground">Pie / metadato · xs.</p>
            </CardContent>
          </Card>
        </Section>

        {/* TOKENS */}
        <Section title="Tokens de color">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {TOKENS.map((t) => (
              <div key={t.name} className="flex items-center gap-3">
                <span
                  className={cn(
                    'size-10 shrink-0 rounded-md',
                    t.className,
                    t.border && 'border border-border',
                  )}
                  aria-hidden
                />
                <code className="text-xs text-muted-foreground">{t.name}</code>
              </div>
            ))}
          </div>
        </Section>

        {/* BOTONES */}
        <Section title="Botones">
          <Card>
            <CardContent className="flex flex-col gap-6 pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Buscar">
                  <Search aria-hidden />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled>Disabled</Button>
                <Button variant="outline" disabled>
                  Outline disabled
                </Button>
                <Button loading={loadingBtn} onClick={simulateLoading}>
                  {loadingBtn ? 'Guardando…' : 'Probar loading'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* INPUTS */}
        <Section title="Inputs y labels">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-name">Nombre</Label>
              <Input id="demo-name" placeholder="Ej. Ana Reyes" />
              <p className="text-xs text-muted-foreground">Estado normal con focus ring.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-email">Correo (inválido)</Label>
              <Input
                id="demo-email"
                type="email"
                defaultValue="correo-malo"
                aria-invalid
                aria-describedby="demo-email-error"
              />
              <p id="demo-email-error" className="text-xs text-destructive">
                Ingresa un correo válido.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-disabled">Deshabilitado</Label>
              <Input id="demo-disabled" placeholder="No editable" disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-search">Con icono</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input id="demo-search" className="pl-9" placeholder="Buscar…" />
              </div>
            </div>
          </div>
        </Section>

        {/* CARDS */}
        <Section title="Cards">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Proyecto activo</CardTitle>
                <CardDescription>Detalle con header, content y footer.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Las cards componen header / title / description / content / footer.
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button variant="ghost" size="sm">
                  Cerrar
                </Button>
                <Button size="sm">Ver</Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Estado de carga</CardTitle>
                <CardDescription>Skeleton con tokens muted.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Estado vacío</CardTitle>
                <CardDescription>Sin resultados.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
                <Inbox className="size-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Aún no hay elementos para mostrar.
                </p>
                <Button variant="outline" size="sm">
                  Crear el primero
                </Button>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* MODAL */}
        <Section title="Modal">
          <Card>
            <CardContent className="pt-6">
              <Modal>
                <ModalTrigger asChild>
                  <Button>Abrir modal</Button>
                </ModalTrigger>
                <ModalContent>
                  <ModalHeader>
                    <ModalTitle>Confirmar acción</ModalTitle>
                    <ModalDescription>
                      En móvil aparece como hoja inferior; en escritorio, centrado.
                    </ModalDescription>
                  </ModalHeader>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="modal-note">Nota</Label>
                    <Input id="modal-note" placeholder="Opcional…" />
                  </div>
                  <ModalFooter>
                    <ModalClose asChild>
                      <Button variant="outline">Cancelar</Button>
                    </ModalClose>
                    <ModalClose asChild>
                      <Button>Confirmar</Button>
                    </ModalClose>
                  </ModalFooter>
                </ModalContent>
              </Modal>
            </CardContent>
          </Card>
        </Section>

        {/* TABLE */}
        <Section title="Table">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableCaption>Directorio de ejemplo (datos ficticios).</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Correo</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MEMBERS.map((m) => (
                    <TableRow key={m.email}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-muted-foreground">{m.email}</TableCell>
                      <TableCell>{m.role}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                            m.status === 'Activo'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {m.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Section>

        {/* ============ PRIMITIVAS NUEVAS (galería DS) ============ */}

        {/* PAGE HEADER */}
        <Section title="PageHeader">
          <Card>
            <CardContent className="flex flex-col gap-8 pt-6">
              <PageHeader
                label="GMT Link"
                title="Recursos físicos"
                description="Header canónico: text-2xl font-bold tracking-tight."
                actions={<Button size="sm">Nueva acción</Button>}
              />
              <PageHeader
                variant="gradient"
                title="Header con degradado"
                description="variant='gradient' aplica el bg-clip-text del acento."
              />
            </CardContent>
          </Card>
        </Section>

        {/* SELECT + SEARCH INPUT */}
        <Section title="Select y SearchInput">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-select">Estado</Label>
              <Select id="demo-select" aria-label="Filtrar por estado" defaultValue="">
                <option value="">Todos</option>
                <option value="APROBADO">Aprobado</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="RECHAZADO">Rechazado</option>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="__ignored">Búsqueda</Label>
              <SearchInput label="Buscar usuarios" placeholder="Buscar…" />
            </div>
          </div>
        </Section>

        {/* BADGES DE ESTADO */}
        <Section title="Badge: variantes de estado">
          <Card>
            <CardContent className="flex flex-wrap gap-2 pt-6">
              <Badge variant="success">success</Badge>
              <Badge variant="info">info</Badge>
              <Badge variant="warning">warning</Badge>
              <Badge variant="danger">danger</Badge>
              <Badge variant="neutral">neutral</Badge>
              <Badge>default</Badge>
              <Badge variant="secondary">secondary</Badge>
              <Badge variant="outline">outline</Badge>
              <Badge variant="destructive">destructive</Badge>
            </CardContent>
          </Card>
        </Section>

        {/* STATUS BADGE por dominio */}
        <Section title="StatusBadge por dominio">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs text-muted-foreground">document</span>
                <StatusBadge type="document" status="BORRADOR" />
                <StatusBadge type="document" status="EN_REVISION" />
                <StatusBadge type="document" status="APROBADO" />
                <StatusBadge type="document" status="RECHAZADO" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs text-muted-foreground">finance</span>
                <StatusBadge type="finance" status="PENDIENTE" />
                <StatusBadge type="finance" status="APROBADO" />
                <StatusBadge type="finance" status="PAGADO" />
                <StatusBadge type="finance" status="RECHAZADO" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs text-muted-foreground">user</span>
                <StatusBadge type="user" status="PENDING_FIRST_LOGIN" />
                <StatusBadge type="user" status="ACTIVE" />
                <StatusBadge type="user" status="SUSPENDED" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs text-muted-foreground">request</span>
                <StatusBadge type="request" status="PENDIENTE" />
                <StatusBadge type="request" status="APROBADA" />
                <StatusBadge type="request" status="RECHAZADA" />
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* ALERTS */}
        <Section title="Alert">
          <div className="flex flex-col gap-3">
            <Alert>Alerta informativa por defecto.</Alert>
            <Alert variant="info">Variante info (acento primario).</Alert>
            <Alert variant="warning">Variante warning (ámbar).</Alert>
            <Alert variant="destructive" live>
              Variante destructive con role=&quot;alert&quot;: errores de formulario.
            </Alert>
            <Alert variant="default" icon={FileWarning}>
              Con icono lucide personalizado.
            </Alert>
          </div>
        </Section>

        {/* TABS */}
        <Section title="Tabs (button) y NavTabs (NavLink)">
          <Card>
            <CardContent className="flex flex-col gap-6 pt-6">
              <Tabs
                aria-label="Secciones de finanzas (demo)"
                value={demoTab}
                onValueChange={setDemoTab}
                idBase={demoTabsId}
                items={[
                  { value: 'reembolsos', label: 'Reembolsos' },
                  { value: 'horas', label: 'Horas extra' },
                  { value: 'liquidaciones', label: 'Liquidaciones' },
                ]}
              />
              <TabPanel idBase={demoTabsId} value={demoTab}>
                <p className="text-sm text-muted-foreground">
                  Pestaña activa: <code>{demoTab}</code>
                </p>
              </TabPanel>
              <NavTabs
                aria-label="Navegación de demo"
                items={[
                  { to: '/design', label: 'Diseño', end: true },
                  { to: '/design/tokens', label: 'Tokens' },
                  { to: '/design/componentes', label: 'Componentes' },
                ]}
              />
            </CardContent>
          </Card>
        </Section>

        {/* STATES */}
        <Section title="Estados (Empty / Loading / Error)">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-border">
              <EmptyState
                title="Sin resultados"
                message="Aún no hay elementos para mostrar."
                action={
                  <Button variant="outline" size="sm">
                    Crear el primero
                  </Button>
                }
              />
            </div>
            <div className="rounded-lg border border-border">
              <LoadingState rows={5} />
            </div>
            <ErrorState
              message="No se pudieron cargar los datos."
              onRetry={() => undefined}
            />
          </div>
        </Section>

        {/* REJECT DIALOG */}
        <Section title="RejectDialog">
          <Card>
            <CardContent className="pt-6">
              <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                Rechazar…
              </Button>
              <RejectDialog
                open={rejectOpen}
                onOpenChange={setRejectOpen}
                title="Rechazar solicitud"
                description="Indica el motivo del rechazo (lo verá quien solicitó)."
                onConfirm={async () => {
                  await new Promise((r) => window.setTimeout(r, 600));
                }}
              />
            </CardContent>
          </Card>
        </Section>
      </div>
    </div>
  );
}
