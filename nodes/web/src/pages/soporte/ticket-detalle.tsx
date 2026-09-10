import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquare, ArrowRight } from 'lucide-react';
import * as api from '@/lib/api';
import { errorToMessage } from '@/lib/api';
import type { TicketView, TicketStatus } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingState, ErrorState } from '@/components/ui/states';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  TICKET_FREQUENCY_LABELS,
  TICKET_LANE_LABELS,
  TICKET_PEOPLE_LABELS,
  TICKET_PRIORITY_META,
  TICKET_SIZE_LABELS,
  TICKET_STATUS_META,
  TICKET_TYPE_LABELS,
  moduleLabel,
  slaVencido,
} from './soporte-shared';

interface Props {
  ticketId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras cualquier cambio, para que la lista de atrás se refresque. */
  onChanged?: () => void;
}

/** Fila de dato del detalle. */
function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Detalle del ticket con su bitácora, reutilizado desde la bandeja y desde el
 * panel de Informática. Los botones de transición NO se calculan acá: vienen en
 * `allowedTransitions`, que el servidor arma cruzando la máquina de estados con
 * los permisos del usuario. Así nunca se muestra una acción que el backend vaya
 * a rechazar, ni se duplican las reglas del procedimiento en el front.
 */
export function TicketDetalle({ ticketId, onOpenChange, onChanged }: Props) {
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [pendiente, setPendiente] = useState<{ to: TicketStatus; requiresComment: boolean } | null>(
    null,
  );
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!ticketId) {
      setTicket(null);
      setPendiente(null);
      setComment('');
      setError(null);
      return;
    }
    let vivo = true;
    setLoading(true);
    setError(null);
    api
      .getTicket(ticketId)
      .then((t) => {
        if (vivo) setTicket(t);
      })
      .catch((err: unknown) => {
        if (vivo) setError(errorToMessage(err, 'No se pudo cargar el ticket.'));
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [ticketId]);

  const recargar = async (): Promise<void> => {
    if (!ticketId) return;
    const t = await api.getTicket(ticketId);
    setTicket(t);
    onChanged?.();
  };

  const ejecutar = async (): Promise<void> => {
    if (!ticketId || !pendiente) return;
    if (pendiente.requiresComment && comment.trim().length === 0) {
      toast.error('Esta acción necesita un comentario que explique el motivo.');
      return;
    }
    setEnviando(true);
    try {
      await api.transitionTicket(ticketId, {
        to: pendiente.to,
        comment: comment.trim() || undefined,
      });
      toast.success(`Ticket movido a ${TICKET_STATUS_META[pendiente.to].label}.`);
      setPendiente(null);
      setComment('');
      await recargar();
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo mover el ticket.'));
    } finally {
      setEnviando(false);
    }
  };

  const comentar = async (): Promise<void> => {
    if (!ticketId || comment.trim().length === 0) return;
    setEnviando(true);
    try {
      await api.commentTicket(ticketId, comment.trim());
      setComment('');
      await recargar();
      toast.success('Comentario agregado.');
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo agregar el comentario.'));
    } finally {
      setEnviando(false);
    }
  };

  const vencido = ticket ? slaVencido(ticket.status, ticket.slaTriageDueAt) : false;

  return (
    <Modal open={ticketId !== null} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        {loading && <LoadingState label="Cargando ticket…" />}
        {error && !loading && <ErrorState message={error} />}

        {ticket && !loading && (
          <div className="flex flex-col gap-5">
            <ModalHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {ticket.ticketNumber}
                </span>
                <Badge variant={TICKET_STATUS_META[ticket.status].variant}>
                  {TICKET_STATUS_META[ticket.status].label}
                </Badge>
                {vencido && <Badge variant="danger">SLA vencido</Badge>}
                {ticket.priority && (
                  <Badge variant={TICKET_PRIORITY_META[ticket.priority].variant}>
                    {TICKET_PRIORITY_META[ticket.priority].label}
                  </Badge>
                )}
              </div>
              <ModalTitle>{ticket.title}</ModalTitle>
              <ModalDescription>
                {TICKET_TYPE_LABELS[ticket.type]} · {moduleLabel(ticket.module)} ·{' '}
                {ticket.department?.name ?? 'Sin área'}
              </ModalDescription>
            </ModalHeader>

            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato label="Solicitante">{ticket.requesterName}</Dato>
              <Dato label="Jefatura que respalda">{ticket.managerName}</Dato>
              <Dato label="Personas afectadas">
                {TICKET_PEOPLE_LABELS[ticket.peopleAffected]}
              </Dato>
              <Dato label="Frecuencia">{TICKET_FREQUENCY_LABELS[ticket.frequency]}</Dato>
              <Dato label="Enviado">
                {ticket.submittedAt ? formatDate(ticket.submittedAt) : '—'}
              </Dato>
              <Dato label="Plazo de triage">
                {ticket.slaTriageDueAt ? formatDate(ticket.slaTriageDueAt) : '—'}
              </Dato>
              {ticket.project && <Dato label="Proyecto">{ticket.project.name}</Dato>}
              {ticket.dueDate && (
                <Dato label="Fecha comprometida">{formatDate(ticket.dueDate)}</Dato>
              )}
              {ticket.lane && <Dato label="Vía">{TICKET_LANE_LABELS[ticket.lane]}</Dato>}
              {ticket.size && <Dato label="Tamaño">{TICKET_SIZE_LABELS[ticket.size]}</Dato>}
              {ticket.assignedTo && <Dato label="Responsable">{ticket.assignedTo.name}</Dato>}
              {ticket.milestone && <Dato label="Hito">{ticket.milestone}</Dato>}
            </dl>

            <div className="flex flex-col gap-3">
              <Dato label="Qué necesita que el sistema haga">
                <p className="whitespace-pre-wrap">{ticket.expected}</p>
              </Dato>
              <Dato label="Qué pasa hoy si esto no existe">
                <p className="whitespace-pre-wrap">{ticket.impact}</p>
              </Dato>
              {ticket.rejectionReason && (
                <Dato label="Motivo del rechazo">
                  <p className="whitespace-pre-wrap">{ticket.rejectionReason}</p>
                </Dato>
              )}
            </div>

            {/* Bitácora: la trazabilidad que exige el procedimiento. */}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">Bitácora</h3>
              <ol className="flex flex-col gap-2 border-l border-border pl-4">
                {(ticket.events ?? []).map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{formatDate(e.at)}</span>
                      <span>·</span>
                      <span className="font-medium text-foreground">{e.byName}</span>
                    </div>
                    {e.kind === 'STATUS' && e.to && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {e.from && (
                          <>
                            <span className="text-muted-foreground">
                              {TICKET_STATUS_META[e.from].label}
                            </span>
                            <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                          </>
                        )}
                        <Badge variant={TICKET_STATUS_META[e.to].variant}>
                          {TICKET_STATUS_META[e.to].label}
                        </Badge>
                      </div>
                    )}
                    {e.comment && (
                      <p className="whitespace-pre-wrap text-foreground">{e.comment}</p>
                    )}
                  </li>
                ))}
                {(ticket.events ?? []).length === 0 && (
                  <li className="text-sm text-muted-foreground">Sin movimientos todavía.</li>
                )}
              </ol>
            </section>

            {/* Comentario: obligatorio en las transiciones que lo exigen. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-comment">
                {pendiente?.requiresComment ? 'Motivo (obligatorio)' : 'Comentario'}
              </Label>
              <Textarea
                id="ticket-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  pendiente?.requiresComment
                    ? 'Explica el motivo: queda en la bitácora.'
                    : 'Agrega contexto para el área o para Informática.'
                }
                disabled={enviando}
              />
            </div>

            <ModalFooter className="flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void comentar()}
                disabled={enviando || comment.trim().length === 0}
              >
                <MessageSquare className="size-4" aria-hidden />
                Comentar
              </Button>

              {/* Solo las transiciones que ESTE usuario puede ejecutar. */}
              {(ticket.allowedTransitions ?? []).map((t) => (
                <Button
                  key={t.to}
                  type="button"
                  size="sm"
                  variant={pendiente?.to === t.to ? 'default' : 'outline'}
                  onClick={() => setPendiente({ to: t.to, requiresComment: t.requiresComment })}
                  disabled={enviando}
                >
                  {TICKET_STATUS_META[t.to].label}
                </Button>
              ))}

              {pendiente && (
                <Button type="button" size="sm" onClick={() => void ejecutar()} disabled={enviando}>
                  {enviando ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden />
                  )}
                  Confirmar: {TICKET_STATUS_META[pendiente.to].label}
                </Button>
              )}
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
