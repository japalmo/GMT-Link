import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Pencil, Plus, Stethoscope, Trash2 } from 'lucide-react';
import type {
  HrAccreditation,
  HrExam,
  HrInduction,
  HrVigencia,
} from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import {
  deleteHrAccreditation,
  deleteHrExam,
  deleteHrInduction,
  errorToMessage,
  listHrAccreditations,
  listHrExams,
  listHrInductions,
  saveHrAccreditation,
  saveHrExam,
  saveHrInduction,
} from '@/lib/api';
import { useClients } from '@/hooks/use-clients';
import { useFaenas } from '@/hooks/use-faenas';
import { EtiquetaVigencia, fechaCorta, plazoLargo } from './rrhh-shared';

/**
 * Exámenes, inducciones y acreditaciones del trabajador.
 *
 * Las tres listas comparten forma: una tabla con la vigencia siempre visible y
 * un diálogo para cargar o corregir. La vigencia se muestra con texto y color a
 * la vez, nunca con color solo.
 *
 * Renovar NO pisa el registro anterior: se crea uno nuevo y el historial queda.
 * Por eso la lista muestra todas las realizaciones y marca cuál es la vigente.
 */

const RESULTADOS = [
  { value: '', label: 'Sin registrar' },
  { value: 'APTO', label: 'Apto' },
  { value: 'APTO_CON_RESTRICCIONES', label: 'Apto con restricciones' },
  { value: 'NO_APTO', label: 'No apto' },
  { value: 'PENDIENTE', label: 'Pendiente' },
] as const;

const ESTADOS_ACRED = [
  { value: 'EN_TRAMITE', label: 'En trámite' },
  { value: 'VIGENTE', label: 'Vigente' },
  { value: 'SUSPENDIDA', label: 'Suspendida' },
  { value: 'RECHAZADA', label: 'Rechazada' },
] as const;

/** Fila de acciones, igual en las tres tablas. */
function Acciones({
  onEditar,
  onBorrar,
  puedeEditar,
  etiqueta,
}: {
  onEditar: () => void;
  onBorrar: () => void;
  puedeEditar: boolean;
  etiqueta: string;
}): ReactNode {
  if (!puedeEditar) return null;
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" className="size-7" onClick={onEditar} aria-label={`Editar ${etiqueta}`}>
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-destructive hover:text-destructive"
        onClick={onBorrar}
        aria-label={`Eliminar ${etiqueta}`}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function Archivo({ url }: { url: string | null }): ReactNode {
  if (!url) return <span className="text-xs text-muted-foreground">Sin respaldo</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <ExternalLink className="size-3" aria-hidden />
      Ver
    </a>
  );
}

/**
 * "No vence" es un dato y "no sé cuándo vence" es su ausencia. Por eso es una
 * marca explícita: dejar la fecha vacía NO equivale a que no venza.
 */
export function NoVence({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): ReactNode {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      No vence
    </label>
  );
}

/** Marca de vigencia + el plazo legible, para no depender del color. */
function Vigencia({ v, dias }: { v: HrVigencia; dias: number | null }): ReactNode {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <EtiquetaVigencia vigencia={v} diasRestantes={dias} />
      <span className="text-[11px] text-muted-foreground">{plazoLargo(v, dias)}</span>
    </div>
  );
}

// ── Exámenes ────────────────────────────────────────────────────────────────

export function ExamenesTab({
  userId,
  puedeEditar,
}: {
  userId: string;
  puedeEditar: boolean;
}): ReactNode {
  const [items, setItems] = useState<HrExam[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<HrExam> | null>(null);
  const [borrando, setBorrando] = useState<HrExam | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargando(true);
    listHrExams(userId)
      .then(setItems)
      .catch((err) => setError(errorToMessage(err, 'No se pudieron cargar los exámenes.')))
      .finally(() => setCargando(false));
  }, [userId]);

  useEffect(cargar, [cargar]);

  async function guardar(): Promise<void> {
    if (!editando?.type?.trim()) {
      setErrorForm('Indica el tipo de examen.');
      return;
    }
    setGuardando(true);
    setErrorForm(null);
    try {
      await saveHrExam(
        {
          userId,
          type: editando.type,
          issuedAt: editando.issuedAt || null,
          expiresAt: editando.noExpiry ? null : editando.expiresAt || null,
          noExpiry: editando.noExpiry ?? false,
          center: editando.center || null,
          result: editando.result || null,
          fileUrl: editando.fileUrl || null,
          notes: editando.notes || null,
        },
        editando.id,
      );
      toast.success(editando.id ? 'Examen actualizado.' : 'Examen agregado.');
      setEditando(null);
      cargar();
    } catch (err) {
      setErrorForm(errorToMessage(err, 'No se pudo guardar el examen.'));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <LoadingState rows={3} label="Cargando exámenes…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Un trabajador puede tener varias realizaciones del mismo examen: al renovar se agrega una
          nueva y el historial queda.
        </p>
        {puedeEditar && (
          <Button size="sm" onClick={() => setEditando({})}>
            <Plus className="mr-1 size-4" aria-hidden />
            Agregar examen
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Sin exámenes cargados"
          message="Agrega el primer examen ocupacional de este trabajador."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Examen</th>
                <th className="px-3 py-2 font-medium">Emisión</th>
                <th className="px-3 py-2 font-medium">Vencimiento</th>
                <th className="px-3 py-2 font-medium">Centro</th>
                <th className="px-3 py-2 font-medium">Vigencia</th>
                <th className="px-3 py-2 font-medium">Respaldo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{e.type}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {fechaCorta(e.issuedAt)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {fechaCorta(e.expiresAt)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{e.center ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Vigencia v={e.vigencia} dias={e.diasRestantes} />
                  </td>
                  <td className="px-3 py-2">
                    <Archivo url={e.fileUrl} />
                  </td>
                  <td className="px-3 py-2">
                    <Acciones
                      puedeEditar={puedeEditar}
                      etiqueta={e.type}
                      onEditar={() => setEditando(e)}
                      onBorrar={() => setBorrando(e)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <ModalContent>
          <div className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>{editando?.id ? 'Editar examen' : 'Agregar examen'}</ModalTitle>
              <ModalDescription>
                El resultado y el certificado son información sensible: no se muestran en los
                listados generales.
              </ModalDescription>
            </ModalHeader>
            {errorForm && (
              <Alert variant="destructive" live>
                {errorForm}
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="ex-tipo">Tipo de examen *</Label>
                <Input
                  id="ex-tipo"
                  value={editando?.type ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, type: e.target.value }))}
                  placeholder="Altura física, preocupacional, psicosensotécnico…"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-emision">Fecha de emisión</Label>
                <Input
                  id="ex-emision"
                  type="date"
                  value={editando?.issuedAt ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, issuedAt: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-vence">Fecha de vencimiento</Label>
                <Input
                  id="ex-vence"
                  type="date"
                  disabled={editando?.noExpiry ?? false}
                  value={editando?.expiresAt ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, expiresAt: e.target.value }))}
                />
                <NoVence
                  id="ex-vence-no"
                  checked={editando?.noExpiry ?? false}
                  onChange={(v) =>
                    setEditando((p) => ({ ...p, noExpiry: v, expiresAt: v ? null : p?.expiresAt ?? null }))
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Déjala vacía si todavía no la conoces: se marcará como sin fecha, no como vigente.
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-centro">Centro médico</Label>
                <Input
                  id="ex-centro"
                  value={editando?.center ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, center: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-resultado">Resultado</Label>
                <Select
                  id="ex-resultado"
                  aria-label="Resultado del examen"
                  value={editando?.result ?? ''}
                  onChange={(e) =>
                    setEditando((p) => ({ ...p, result: (e.target.value || null) as HrExam['result'] }))
                  }
                >
                  {RESULTADOS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="ex-archivo">Enlace al certificado</Label>
                <Input
                  id="ex-archivo"
                  value={editando?.fileUrl ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, fileUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="ex-obs">Observaciones</Label>
                <Textarea
                  id="ex-obs"
                  rows={2}
                  value={editando?.notes ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
            <ModalFooter>
              <Button variant="ghost" onClick={() => setEditando(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={borrando !== null}
        onOpenChange={(v) => !v && setBorrando(null)}
        title="Eliminar examen"
        description={`Se elimina el registro de ${borrando?.type}. Si era una renovación, el examen anterior se conserva.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!borrando) return;
          try {
            await deleteHrExam(borrando.id);
            toast.success('Examen eliminado.');
            cargar();
          } catch (err) {
            toast.error(errorToMessage(err, 'No se pudo eliminar.'));
          } finally {
            setBorrando(null);
          }
        }}
      />
    </div>
  );
}

// ── Inducciones ─────────────────────────────────────────────────────────────

export function InduccionesTab({
  userId,
  puedeEditar,
}: {
  userId: string;
  puedeEditar: boolean;
}): ReactNode {
  const [items, setItems] = useState<HrInduction[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<HrInduction> | null>(null);
  const [faenaIds, setFaenaIds] = useState<string[]>([]);
  const [borrando, setBorrando] = useState<HrInduction | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const { clients } = useClients();
  // Las faenas se piden por cliente: así el selector NUNCA puede ofrecer una
  // faena de otro cliente, que es el error que el formulario debe evitar.
  const { faenas } = useFaenas(editando?.clientId ?? undefined);

  const cargar = useCallback(() => {
    setCargando(true);
    listHrInductions(userId)
      .then(setItems)
      .catch((err) => setError(errorToMessage(err, 'No se pudieron cargar las inducciones.')))
      .finally(() => setCargando(false));
  }, [userId]);

  useEffect(cargar, [cargar]);

  function abrir(i?: HrInduction): void {
    setEditando(i ?? {});
    setFaenaIds(i?.faenas.map((f) => f.id) ?? []);
    setErrorForm(null);
  }

  async function guardar(): Promise<void> {
    if (!editando?.clientId) {
      setErrorForm('Elige el cliente de la inducción.');
      return;
    }
    if (!editando.name?.trim()) {
      setErrorForm('Indica el nombre de la inducción.');
      return;
    }
    setGuardando(true);
    setErrorForm(null);
    try {
      await saveHrInduction(
        {
          userId,
          clientId: editando.clientId,
          name: editando.name,
          faenaIds,
          issuedAt: editando.issuedAt || null,
          expiresAt: editando.noExpiry ? null : editando.expiresAt || null,
          noExpiry: editando.noExpiry ?? false,
          fileUrl: editando.fileUrl || null,
          notes: editando.notes || null,
        },
        editando.id,
      );
      toast.success(editando.id ? 'Inducción actualizada.' : 'Inducción agregada.');
      setEditando(null);
      cargar();
    } catch (err) {
      setErrorForm(errorToMessage(err, 'No se pudo guardar la inducción.'));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <LoadingState rows={3} label="Cargando inducciones…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Una inducción vale para las faenas que se marquen, todas del mismo cliente. Elegir el
          cliente no la hace válida en todas sus faenas.
        </p>
        {puedeEditar && (
          <Button size="sm" onClick={() => abrir()}>
            <Plus className="mr-1 size-4" aria-hidden />
            Agregar inducción
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Sin inducciones cargadas"
          message="Agrega la primera inducción de este trabajador."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Inducción</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Válida en</th>
                <th className="px-3 py-2 font-medium">Vencimiento</th>
                <th className="px-3 py-2 font-medium">Vigencia</th>
                <th className="px-3 py-2 font-medium">Respaldo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{i.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.clientName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {i.faenas.length === 0 ? (
                      <span className="italic">Sin faenas asignadas</span>
                    ) : (
                      i.faenas.map((f) => f.name).join(', ')
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {fechaCorta(i.expiresAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Vigencia v={i.vigencia} dias={i.diasRestantes} />
                  </td>
                  <td className="px-3 py-2">
                    <Archivo url={i.fileUrl} />
                  </td>
                  <td className="px-3 py-2">
                    <Acciones
                      puedeEditar={puedeEditar}
                      etiqueta={i.name}
                      onEditar={() => abrir(i)}
                      onBorrar={() => setBorrando(i)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <ModalContent>
          <div className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>{editando?.id ? 'Editar inducción' : 'Agregar inducción'}</ModalTitle>
              <ModalDescription>
                Marca todas las faenas donde vale. Una sola inducción puede cubrir varias.
              </ModalDescription>
            </ModalHeader>
            {errorForm && (
              <Alert variant="destructive" live>
                {errorForm}
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="in-cliente">Cliente *</Label>
                <Select
                  id="in-cliente"
                  aria-label="Cliente de la inducción"
                  value={editando?.clientId ?? ''}
                  onChange={(e) => {
                    // Cambiar de cliente limpia las faenas: las anteriores eran
                    // de otro cliente y dejarlas produciría un registro falso.
                    setEditando((p) => ({ ...p, clientId: e.target.value }));
                    setFaenaIds([]);
                  }}
                >
                  <option value="">Elige un cliente…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="in-nombre">Nombre de la inducción *</Label>
                <Input
                  id="in-nombre"
                  value={editando?.name ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Inducción hombre nuevo, riesgos críticos…"
                />
              </div>

              <fieldset className="flex flex-col gap-2 sm:col-span-2">
                <legend className="text-sm font-medium">Faenas donde vale</legend>
                {!editando?.clientId ? (
                  <p className="text-xs text-muted-foreground">Elige primero el cliente.</p>
                ) : faenas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ese cliente no tiene faenas cargadas.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {faenas.map((f) => {
                      const marcada = faenaIds.includes(f.id);
                      return (
                        <label
                          key={f.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                            marcada ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={() =>
                              setFaenaIds((prev) =>
                                prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                              )
                            }
                            className="size-4"
                          />
                          {f.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="in-emision">Fecha de realización</Label>
                <Input
                  id="in-emision"
                  type="date"
                  value={editando?.issuedAt ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, issuedAt: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="in-vence">Vencimiento</Label>
                <Input
                  id="in-vence"
                  type="date"
                  disabled={editando?.noExpiry ?? false}
                  value={editando?.expiresAt ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, expiresAt: e.target.value }))}
                />
                <NoVence
                  id="in-vence-no"
                  checked={editando?.noExpiry ?? false}
                  onChange={(v) =>
                    setEditando((p) => ({ ...p, noExpiry: v, expiresAt: v ? null : p?.expiresAt ?? null }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="in-archivo">Enlace al respaldo</Label>
                <Input
                  id="in-archivo"
                  value={editando?.fileUrl ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, fileUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="in-obs">Observaciones</Label>
                <Textarea
                  id="in-obs"
                  rows={2}
                  value={editando?.notes ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
            <ModalFooter>
              <Button variant="ghost" onClick={() => setEditando(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={borrando !== null}
        onOpenChange={(v) => !v && setBorrando(null)}
        title="Eliminar inducción"
        description={`Se elimina ${borrando?.name} y las faenas asociadas a ese registro.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!borrando) return;
          try {
            await deleteHrInduction(borrando.id);
            toast.success('Inducción eliminada.');
            cargar();
          } catch (err) {
            toast.error(errorToMessage(err, 'No se pudo eliminar.'));
          } finally {
            setBorrando(null);
          }
        }}
      />
    </div>
  );
}

// ── Acreditaciones ──────────────────────────────────────────────────────────

/**
 * Acreditaciones ante clientes. Vive dentro de Datos personales porque el
 * Resumen es de solo lectura y esta es la otra pestaña de antecedentes
 * laborales editables.
 */
export function AcreditacionesSeccion({
  userId,
  puedeEditar,
  onCambio,
}: {
  userId: string;
  puedeEditar: boolean;
  onCambio?: () => void;
}): ReactNode {
  const [items, setItems] = useState<HrAccreditation[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Partial<HrAccreditation> | null>(null);
  const [borrando, setBorrando] = useState<HrAccreditation | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const { clients } = useClients();
  const { faenas } = useFaenas(editando?.clientId ?? undefined);

  const cargar = useCallback(() => {
    setCargando(true);
    listHrAccreditations(userId)
      .then(setItems)
      .catch(() => undefined)
      .finally(() => setCargando(false));
  }, [userId]);

  useEffect(cargar, [cargar]);

  async function guardar(): Promise<void> {
    if (!editando?.clientId) {
      setErrorForm('Elige el cliente que acredita.');
      return;
    }
    setGuardando(true);
    setErrorForm(null);
    try {
      await saveHrAccreditation(
        {
          userId,
          clientId: editando.clientId,
          faenaId: editando.faenaId || null,
          status: editando.status ?? 'EN_TRAMITE',
          issuedAt: editando.issuedAt || null,
          expiresAt: editando.noExpiry ? null : editando.expiresAt || null,
          noExpiry: editando.noExpiry ?? false,
          fileUrl: editando.fileUrl || null,
          notes: editando.notes || null,
        },
        editando.id,
      );
      toast.success('Acreditación guardada.');
      setEditando(null);
      cargar();
      onCambio?.();
    } catch (err) {
      setErrorForm(errorToMessage(err, 'No se pudo guardar la acreditación.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Acreditaciones ante clientes</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            El permiso que da el mandante para entrar a su faena. No se deduce de tener los papeles
            al día: es un trámite propio del cliente.
          </p>
        </div>
        {puedeEditar && (
          <Button size="sm" variant="outline" onClick={() => setEditando({ status: 'EN_TRAMITE' })}>
            <Plus className="mr-1 size-4" aria-hidden />
            Agregar
          </Button>
        )}
      </div>

      {cargando ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          Sin acreditaciones registradas.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {a.clientName}
                  {a.faenaName ? ` · ${a.faenaName}` : ' · todas sus faenas'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ESTADOS_ACRED.find((e) => e.value === a.status)?.label ?? a.status} · vence{' '}
                  {fechaCorta(a.expiresAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <EtiquetaVigencia vigencia={a.vigencia} diasRestantes={a.diasRestantes} />
                <Acciones
                  puedeEditar={puedeEditar}
                  etiqueta={`acreditación ${a.clientName}`}
                  onEditar={() => setEditando(a)}
                  onBorrar={() => setBorrando(a)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <ModalContent>
          <div className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>{editando?.id ? 'Editar acreditación' : 'Agregar acreditación'}</ModalTitle>
              <ModalDescription>
                Deja la faena vacía si el cliente acredita para toda su operación.
              </ModalDescription>
            </ModalHeader>
            {errorForm && (
              <Alert variant="destructive" live>
                {errorForm}
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-cliente">Cliente *</Label>
                <Select
                  id="ac-cliente"
                  aria-label="Cliente que acredita"
                  value={editando?.clientId ?? ''}
                  onChange={(e) =>
                    setEditando((p) => ({ ...p, clientId: e.target.value, faenaId: null }))
                  }
                >
                  <option value="">Elige un cliente…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-faena">Faena</Label>
                <Select
                  id="ac-faena"
                  aria-label="Faena de la acreditación"
                  value={editando?.faenaId ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, faenaId: e.target.value || null }))}
                  disabled={!editando?.clientId}
                >
                  <option value="">Todas las faenas del cliente</option>
                  {faenas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-estado">Estado</Label>
                <Select
                  id="ac-estado"
                  aria-label="Estado de la acreditación"
                  value={editando?.status ?? 'EN_TRAMITE'}
                  onChange={(e) =>
                    setEditando((p) => ({ ...p, status: e.target.value as HrAccreditation['status'] }))
                  }
                >
                  {ESTADOS_ACRED.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-vence">Vencimiento</Label>
                <Input
                  id="ac-vence"
                  type="date"
                  disabled={editando?.noExpiry ?? false}
                  value={editando?.expiresAt ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, expiresAt: e.target.value }))}
                />
                <NoVence
                  id="ac-vence-no"
                  checked={editando?.noExpiry ?? false}
                  onChange={(v) =>
                    setEditando((p) => ({ ...p, noExpiry: v, expiresAt: v ? null : p?.expiresAt ?? null }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="ac-obs">Observaciones</Label>
                <Textarea
                  id="ac-obs"
                  rows={2}
                  value={editando?.notes ?? ''}
                  onChange={(e) => setEditando((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
            <ModalFooter>
              <Button variant="ghost" onClick={() => setEditando(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={borrando !== null}
        onOpenChange={(v) => !v && setBorrando(null)}
        title="Eliminar acreditación"
        description={`Se elimina la acreditación ante ${borrando?.clientName}.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!borrando) return;
          try {
            await deleteHrAccreditation(borrando.id);
            toast.success('Acreditación eliminada.');
            cargar();
            onCambio?.();
          } catch (err) {
            toast.error(errorToMessage(err, 'No se pudo eliminar.'));
          } finally {
            setBorrando(null);
          }
        }}
      />
    </section>
  );
}
