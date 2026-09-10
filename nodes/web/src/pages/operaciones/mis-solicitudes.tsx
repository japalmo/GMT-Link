import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy, Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { errorToMessage } from '@/lib/api';
import type { TicketView } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TicketDetalle } from '@/pages/soporte/ticket-detalle';
import {
  TICKET_PRIORITY_META,
  TICKET_STATUS_META,
  TICKET_TYPE_LABELS,
  moduleLabel,
  slaVencido,
} from '@/pages/soporte/soporte-shared';

/**
 * Pestaña "Mis solicitudes" de Operaciones (PR-TI-01): las solicitudes que este
 * usuario levantó a Informática. Vive acá y no en Soporte TI porque Operaciones
 * es donde las áreas trabajan; Soporte TI es el tablero de control de
 * Informática. Sin motor de tablas a propósito: una persona tiene pocas
 * solicitudes y lo que necesita es ver el estado de un vistazo.
 */
export function MisSolicitudesTab() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setTickets(await api.listMyTickets());
    } catch (err) {
      setError(errorToMessage(err, 'No se pudieron cargar tus tickets.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Solicitudes que levantaste a Informática y en qué va cada una.
        </p>
        <Button onClick={() => navigate('/tickets/nuevo')}>
          <Plus className="size-4" aria-hidden />
          Levantar solicitud
        </Button>
      </div>

      {loading && <LoadingState label="Cargando tus tickets…" />}
      {error && !loading && <ErrorState message={error} />}

      {!loading && !error && tickets.length === 0 && (
        <EmptyState
          icon={LifeBuoy}
          title="Todavía no has levantado ninguna solicitud"
          message="Cuando necesites algo de Informática, este es el canal formal."
          action={
            <Button onClick={() => navigate('/tickets/nuevo')}>
              <Plus className="size-4" aria-hidden />
              Levantar el primero
            </Button>
          }
        />
      )}

      {!loading && !error && tickets.length > 0 && (
        <div className="flex flex-col gap-2">
          {tickets.map((t) => {
            const vencido = slaVencido(t.status, t.slaTriageDueAt);
            return (
              <Card
                key={t.id}
                className="cursor-pointer transition-colors hover:bg-muted/40"
                onClick={() => setAbierto(t.id)}
              >
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                  <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
                  <span className="flex-1 min-w-[12rem] text-sm font-medium text-foreground">
                    {t.title}
                  </span>
                  <Badge variant={TICKET_STATUS_META[t.status].variant}>
                    {TICKET_STATUS_META[t.status].label}
                  </Badge>
                  {vencido && <Badge variant="danger">SLA vencido</Badge>}
                  {t.priority && (
                    <Badge variant={TICKET_PRIORITY_META[t.priority].variant}>
                      {TICKET_PRIORITY_META[t.priority].label}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {TICKET_TYPE_LABELS[t.type]} · {moduleLabel(t.module)}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {t.submittedAt ? formatDate(t.submittedAt) : formatDate(t.createdAt)}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <TicketDetalle
        ticketId={abierto}
        onOpenChange={(open) => !open && setAbierto(null)}
        onChanged={() => void cargar()}
      />
    </div>
  );
}
