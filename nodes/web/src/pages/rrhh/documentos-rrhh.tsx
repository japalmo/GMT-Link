import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ExternalLink, FolderOpen, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { HrDocument } from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { FreshFileLink } from '@/components/documents/fresh-file-link';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import {
  createHrDocument,
  deleteHrDocument,
  errorToMessage,
  getHrDocumentFileUrl,
  listHrDocuments,
  replaceHrDocumentFile,
  updateHrDocument,
} from '@/lib/api';
import { NoVence } from './registros';
import { ESTADO_DOCUMENTO, EtiquetaVigencia, fechaCorta, plazoLargo } from './rrhh-shared';

/**
 * Documentos del trabajador, gestionados por RRHH.
 *
 * Existe porque buena parte de la gente no sube sus papeles: los trabajadores
 * de faena ni siquiera tienen cuenta. RRHH los carga en su nombre con el mismo
 * almacenamiento y el mismo versionado que "Mis documentos", así que el
 * trabajador que sí tiene cuenta ve lo mismo desde su perfil.
 *
 * Reemplazar el archivo conserva el anterior como versión previa: un documento
 * renovado no borra la evidencia de lo que había.
 */

const ACEPTADOS = 'application/pdf,image/png,image/jpeg,image/webp,image/heic';
const MAX_BYTES = 10 * 1024 * 1024;

interface FormDoc {
  id?: string;
  type: string;
  name: string;
  issuedAt: string;
  expiresAt: string;
  noExpiry: boolean;
  file: File | null;
}

const FORM_VACIO: FormDoc = {
  type: '',
  name: '',
  issuedAt: '',
  expiresAt: '',
  noExpiry: false,
  file: null,
};

export function DocumentosRrhh({
  userId,
  puedeEditar,
  onCambio,
}: {
  userId: string;
  puedeEditar: boolean;
  onCambio?: () => void;
}): ReactNode {
  const [items, setItems] = useState<HrDocument[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormDoc | null>(null);
  const [reemplazando, setReemplazando] = useState<HrDocument | null>(null);
  const [archivoNuevo, setArchivoNuevo] = useState<File | null>(null);
  const [borrando, setBorrando] = useState<HrDocument | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    listHrDocuments(userId)
      .then(setItems)
      .catch((err) => setError(errorToMessage(err, 'No se pudieron cargar los documentos.')))
      .finally(() => setCargando(false));
  }, [userId]);

  useEffect(cargar, [cargar]);

  function abrir(d?: HrDocument): void {
    setErrorForm(null);
    setForm(
      d
        ? {
            id: d.id,
            type: d.type,
            name: d.name,
            issuedAt: d.issuedAt ?? '',
            expiresAt: d.expiresAt ?? '',
            noExpiry: d.noExpiry,
            file: null,
          }
        : FORM_VACIO,
    );
  }

  function tras(mensaje: string): void {
    toast.success(mensaje);
    cargar();
    onCambio?.();
  }

  async function guardar(): Promise<void> {
    if (!form) return;
    if (!form.type.trim()) return setErrorForm('Indica el tipo de documento.');
    if (!form.name.trim()) return setErrorForm('Indica el nombre del documento.');
    if (!form.id && !form.file) return setErrorForm('Adjunta el archivo del documento.');
    if (form.file && form.file.size > MAX_BYTES) {
      return setErrorForm('El archivo supera los 10 MB.');
    }
    setGuardando(true);
    setErrorForm(null);
    try {
      if (form.id) {
        await updateHrDocument(form.id, {
          type: form.type.trim(),
          name: form.name.trim(),
          issuedAt: form.issuedAt || null,
          expiresAt: form.noExpiry ? null : form.expiresAt || null,
          noExpiry: form.noExpiry,
        });
      } else if (form.file) {
        const data = new FormData();
        data.append('file', form.file);
        data.append('type', form.type.trim());
        data.append('name', form.name.trim());
        if (form.issuedAt) data.append('issuedAt', form.issuedAt);
        if (form.expiresAt && !form.noExpiry) data.append('expiresAt', form.expiresAt);
        data.append('noExpiry', form.noExpiry ? 'true' : 'false');
        await createHrDocument(userId, data);
      }
      setForm(null);
      tras(form.id ? 'Documento actualizado.' : 'Documento cargado.');
    } catch (err) {
      setErrorForm(errorToMessage(err, 'No se pudo guardar el documento.'));
    } finally {
      setGuardando(false);
    }
  }

  async function reemplazar(): Promise<void> {
    if (!reemplazando || !archivoNuevo) return setErrorForm('Elige el archivo nuevo.');
    if (archivoNuevo.size > MAX_BYTES) return setErrorForm('El archivo supera los 10 MB.');
    setGuardando(true);
    setErrorForm(null);
    try {
      await replaceHrDocumentFile(reemplazando.id, archivoNuevo);
      setReemplazando(null);
      setArchivoNuevo(null);
      tras('Archivo reemplazado. El anterior quedó como versión previa.');
    } catch (err) {
      setErrorForm(errorToMessage(err, 'No se pudo reemplazar el archivo.'));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <LoadingState rows={3} label="Cargando documentos…" />;
  if (error) return <ErrorState message={error} onRetry={cargar} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Lo que se carga acá queda en revisión, igual que un documento que sube el propio
          trabajador. Si el documento no vence, márcalo: una fecha vacía se informa como "sin
          fecha", no como vigente.
        </p>
        {puedeEditar && (
          <Button size="sm" onClick={() => abrir()}>
            <Plus className="mr-1 size-4" aria-hidden />
            Cargar documento
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Sin documentos cargados"
          message={
            puedeEditar
              ? 'Carga el primer documento de este trabajador.'
              : 'Este trabajador todavía no tiene documentos cargados.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Documento</th>
                <th className="px-3 py-2 font-medium">Emisión</th>
                <th className="px-3 py-2 font-medium">Vencimiento</th>
                <th className="px-3 py-2 font-medium">Vigencia</th>
                <th className="px-3 py-2 font-medium">Revisión</th>
                <th className="px-3 py-2 font-medium">Archivo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.type}</p>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{fechaCorta(d.issuedAt)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {d.noExpiry ? 'No vence' : fechaCorta(d.expiresAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-0.5">
                      <EtiquetaVigencia vigencia={d.vigencia} diasRestantes={d.diasRestantes} />
                      <span className="text-[11px] text-muted-foreground">
                        {plazoLargo(d.vigencia, d.diasRestantes)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`whitespace-nowrap text-xs ${
                        d.status === 'RECHAZADO'
                          ? 'font-medium text-red-700 dark:text-red-300'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {ESTADO_DOCUMENTO[d.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <FreshFileLink
                        getUrl={() => getHrDocumentFileUrl(d.id)}
                        aria-label={`Ver archivo de ${d.name}`}
                        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                        Ver
                      </FreshFileLink>
                      {d.hasPrevious && (
                        <FreshFileLink
                          getUrl={() => getHrDocumentFileUrl(d.id, true)}
                          aria-label={`Ver versión anterior de ${d.name}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          <History className="size-3" aria-hidden />
                          Anterior
                        </FreshFileLink>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {puedeEditar && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => abrir(d)}
                          aria-label={`Editar datos de ${d.name}`}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setErrorForm(null);
                            setArchivoNuevo(null);
                            setReemplazando(d);
                          }}
                          aria-label={`Reemplazar archivo de ${d.name}`}
                        >
                          <Upload className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setBorrando(d)}
                          aria-label={`Eliminar ${d.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={form !== null} onOpenChange={(v) => !v && setForm(null)}>
        <ModalContent>
          <div className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>{form?.id ? 'Editar documento' : 'Cargar documento'}</ModalTitle>
              <ModalDescription>
                {form?.id
                  ? 'Corrige los datos. Para cambiar el archivo usa "Reemplazar archivo".'
                  : 'PDF o imagen, hasta 10 MB.'}
              </ModalDescription>
            </ModalHeader>
            {errorForm && (
              <Alert variant="destructive" live>
                {errorForm}
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-tipo">Tipo de documento *</Label>
                <Input
                  id="doc-tipo"
                  value={form?.type ?? ''}
                  onChange={(e) => setForm((p) => (p ? { ...p, type: e.target.value } : p))}
                  placeholder="Cédula, licencia, contrato…"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-nombre">Nombre *</Label>
                <Input
                  id="doc-nombre"
                  value={form?.name ?? ''}
                  onChange={(e) => setForm((p) => (p ? { ...p, name: e.target.value } : p))}
                />
              </div>
              {!form?.id && (
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="doc-archivo">Archivo *</Label>
                  <Input
                    id="doc-archivo"
                    type="file"
                    accept={ACEPTADOS}
                    onChange={(e) =>
                      setForm((p) => (p ? { ...p, file: e.target.files?.[0] ?? null } : p))
                    }
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-emision">Fecha de emisión</Label>
                <Input
                  id="doc-emision"
                  type="date"
                  value={form?.issuedAt ?? ''}
                  onChange={(e) => setForm((p) => (p ? { ...p, issuedAt: e.target.value } : p))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-vence">Fecha de vencimiento</Label>
                <Input
                  id="doc-vence"
                  type="date"
                  value={form?.noExpiry ? '' : (form?.expiresAt ?? '')}
                  disabled={form?.noExpiry ?? false}
                  onChange={(e) => setForm((p) => (p ? { ...p, expiresAt: e.target.value } : p))}
                />
                <NoVence
                  id="doc-no-vence"
                  checked={form?.noExpiry ?? false}
                  onChange={(v) => setForm((p) => (p ? { ...p, noExpiry: v, expiresAt: v ? '' : p.expiresAt } : p))}
                />
              </div>
            </div>
            <ModalFooter>
              <Button variant="ghost" onClick={() => setForm(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={() => void guardar()} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      </Modal>

      <Modal open={reemplazando !== null} onOpenChange={(v) => !v && setReemplazando(null)}>
        <ModalContent>
          <div className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>Reemplazar archivo</ModalTitle>
              <ModalDescription>
                El archivo actual de {reemplazando?.name} se conserva como versión anterior y el
                documento vuelve a quedar en revisión.
              </ModalDescription>
            </ModalHeader>
            {errorForm && (
              <Alert variant="destructive" live>
                {errorForm}
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-reemplazo">Archivo nuevo *</Label>
              <Input
                id="doc-reemplazo"
                type="file"
                accept={ACEPTADOS}
                onChange={(e) => setArchivoNuevo(e.target.files?.[0] ?? null)}
              />
            </div>
            <ModalFooter>
              <Button variant="ghost" onClick={() => setReemplazando(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={() => void reemplazar()} disabled={guardando}>
                {guardando ? 'Subiendo…' : 'Reemplazar'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={borrando !== null}
        onOpenChange={(v) => !v && setBorrando(null)}
        title="Eliminar documento"
        description={`Se elimina ${borrando?.name ?? 'el documento'} junto con sus archivos, incluida la versión anterior. No se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!borrando) return;
          try {
            await deleteHrDocument(borrando.id);
            tras('Documento eliminado.');
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
