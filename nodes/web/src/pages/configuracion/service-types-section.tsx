import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ListChecks, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import type { ServiceTypeView } from '@gmt-platform/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { deleteServiceType, errorToMessage, fetchServiceTypes } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog } from '../perfil/confirm-dialog';
import { ServiceTypeDialog } from './service-type-dialog';

/**
 * Sección "Tipos de servicio" (catálogo org, Tanda 4). Solo se monta para usuarios
 * con `service_type:manage` (el padre la gatea). Lista los tipos con su código,
 * procedimientos y uso, y permite crear/editar (diálogo con editor de
 * procedimientos) y borrar (409 si está en uso -> se sugiere desactivar).
 */
export function ServiceTypesSection(): ReactNode {
  const [types, setTypes] = useState<ServiceTypeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceTypeView | null>(null);
  const [toDelete, setToDelete] = useState<ServiceTypeView | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchServiceTypes(true)
      .then((data) => {
        if (alive) setTypes(data);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorToMessage(err, 'No se pudieron cargar los tipos de servicio.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  function openCreate(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(type: ServiceTypeView): void {
    setEditing(type);
    setDialogOpen(true);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-5 text-muted-foreground" aria-hidden />
            Tipos de servicio
          </CardTitle>
          <CardDescription>
            Catálogo reutilizable en todos los proyectos. Cada tipo aporta su código, la firma de
            cliente por defecto y sus procedimientos.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus aria-hidden />
          Nuevo tipo
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <LoadingState rows={3} label="Cargando tipos de servicio…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : types.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Sin tipos de servicio"
            message="Crea el primer tipo para poder crear servicios eligiéndolo."
            action={
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus aria-hidden />
                Nuevo tipo
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {types.map((type) => (
              <li
                key={type.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{type.name}</span>
                    <Badge variant="outline" className="font-mono">
                      {type.code}
                    </Badge>
                    {!type.isActive && <Badge variant="secondary">Inactivo</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ListChecks className="size-3.5" aria-hidden />
                      {type.procedures.length}{' '}
                      {type.procedures.length === 1 ? 'procedimiento' : 'procedimientos'}
                    </span>
                    {type.requiresClientSignature && <span>Requiere firma de cliente</span>}
                    <span>
                      {type.serviceCount} {type.serviceCount === 1 ? 'servicio' : 'servicios'} en uso
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(type)}>
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setToDelete(type)}
                    aria-label={`Borrar ${type.name}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ServiceTypeDialog
        open={dialogOpen}
        initial={editing}
        onOpenChange={setDialogOpen}
        onSaved={() => load()}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Borrar tipo de servicio"
        description={
          toDelete
            ? `¿Borrar el tipo "${toDelete.name}"? Si está en uso por algún servicio, no se podrá borrar; desactívalo en su lugar.`
            : ''
        }
        confirmLabel="Borrar"
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteServiceType(toDelete.id);
          toast.success('Tipo de servicio borrado.');
          setToDelete(null);
          load();
        }}
      />
    </Card>
  );
}
