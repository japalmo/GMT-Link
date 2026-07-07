import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Download,
  FileText,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { useLiquidations } from '@/hooks/use-liquidations';
import { useUsers } from '@/hooks/use-users';
import { StepperDownload } from '@/components/primitives/stepper-download';
import { PDF_ACCEPT } from '../perfil/file-field';
import { formatDate, formatRelativeTime } from '@/lib/format';

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
}

function ConfirmDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
}: ConfirmDeleteDialogProps): ReactNode {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <ModalClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              Cancelar
            </Button>
          </ModalClose>
          <Button
            type="button"
            variant="destructive"
            loading={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch {
                // error alert handled by handler
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Eliminar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

interface UploadLiquidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (userId: string, period: string, file: File) => Promise<void>;
  users: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  usersLoading: boolean;
}

function UploadLiquidationDialog({
  open,
  onOpenChange,
  onSubmit,
  users,
  usersLoading,
}: UploadLiquidationDialogProps): ReactNode {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [period, setPeriod] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedUserId('');
      setPeriod('');
      setFile(null);
      setFileError(null);
      setError(null);
    }
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] ?? null;
    setFileError(null);
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setFileError('El archivo debe ser un documento PDF.');
        setFile(null);
      } else if (selectedFile.size > 10 * 1024 * 1024) {
        setFileError('El archivo supera el máximo de 10 MB.');
        setFile(null);
      } else {
        setFile(selectedFile);
      }
    } else {
      setFile(null);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!selectedUserId) {
      setError('Debes seleccionar un colaborador.');
      return;
    }
    if (!period) {
      setError('Debes seleccionar el periodo.');
      return;
    }
    if (!file) {
      setError('Debes seleccionar el archivo PDF.');
      return;
    }
    if (fileError) {
      setError(fileError);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(selectedUserId, period, file);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la liquidación.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Subir Liquidación de Sueldo</ModalTitle>
          <ModalDescription>
            Sube el archivo PDF de la liquidación de un colaborador para un periodo específico.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="liq-user">Colaborador</Label>
            <Select
              id="liq-user"
              aria-label="Colaborador de la liquidación"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={submitting || usersLoading}
              required
            >
              <option value="">Selecciona un colaborador...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.lastName}, {u.firstName} ({u.email})
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="liq-period">Periodo (Mes)</Label>
              <Input
                id="liq-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="liq-file">Archivo PDF</Label>
              <Input
                id="liq-file"
                type="file"
                accept={PDF_ACCEPT}
                onChange={handleFileChange}
                required
                disabled={submitting}
                className="file:border-0 file:bg-transparent file:text-xs file:font-semibold"
              />
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
            </div>
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>
              Subir liquidación
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

export function LiquidacionesTab(): ReactNode {
  const {
    mine,
    managerItems,
    isManager,
    loading,
    error,
    refetch,
    upload,
    remove,
    downloadBatch,
  } = useLiquidations();

  // Load user directory for payslips uploading form (only if manager)
  const { users, loading: usersLoading } = useUsers();

  const [downloadStep, setDownloadStep] = useState<number | 'all'>(1);
  const [downloading, setDownloading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTargetId || actioning) return;
    setActioning(deleteTargetId);
    try {
      await remove(deleteTargetId);
      toast.success('Liquidación eliminada con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar liquidación.');
    } finally {
      setActioning(null);
      setDeleteTargetId(null);
    }
  };

  const handleDownloadBatch = async (): Promise<void> => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadBatch(downloadStep);
      toast.success('Lote de liquidaciones descargado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo descargar el lote de liquidaciones.');
    } finally {
      setDownloading(false);
    }
  };

  /** Formats period string "2026-06" to a human readable Spanish string "Junio 2026". */
  const formatPeriod = (period: string): string => {
    const [year, month] = period.split('-');
    if (!year || !month) return period;
    const date = new Date(Number(year), Number(month) - 1, 15);
    return date.toLocaleString('es-CL', { month: 'long', year: 'numeric' });
  };

  if (loading) {
    return <LoadingState rows={4} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Sección Mis Liquidaciones */}
      <section className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Mis Liquidaciones de Sueldo</h2>
        </div>

        {mine.length === 0 ? (
          <EmptyState
            icon={FileText}
            message="Aún no se han cargado liquidaciones de sueldo para ti en la plataforma."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {/* StepperDownload primitive widget */}
            <StepperDownload
              value={downloadStep}
              onChange={setDownloadStep}
              onDownload={() => void handleDownloadBatch()}
              downloading={downloading}
            />

            {/* Individual Table list */}
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Fecha de subida</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-semibold capitalize">
                        {formatPeriod(item.period)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelativeTime(item.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-primary"
                          onClick={() => window.open(item.fileUrl, '_blank')}
                        >
                          <Download className="size-3.5 mr-1" aria-hidden />
                          Descargar PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {/* Sección de Gestión (Sólo Gestor) */}
      {isManager && (
        <section className="flex flex-col gap-4">
          <div className="border-t border-border pt-6 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Gestión de Liquidaciones</h2>
              <p className="text-sm text-muted-foreground">Sube y administra las liquidaciones de sueldo mensuales del personal.</p>
            </div>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus aria-hidden />
              Subir Liquidación
            </Button>
          </div>

          {managerItems.length === 0 ? (
            <EmptyState message="No hay liquidaciones registradas en el sistema para ningún colaborador." />
          ) : (
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Fecha de carga</TableHead>
                    <TableHead>Archivo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managerItems.map((item) => {
                    const name = item.user
                      ? `${item.user.lastName}, ${item.user.firstName}`
                      : '—';
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{name}</span>
                            <span className="text-xs text-muted-foreground">{item.user?.email}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold capitalize">
                          {formatPeriod(item.period)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(item.createdAt)}
                        </TableCell>
                        <TableCell>
                          <a
                            href={item.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium"
                          >
                            <FileText className="size-3.5" aria-hidden />
                            Ver PDF
                          </a>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteTargetId(item.id)}
                              aria-label={`Eliminar liquidación de ${name} para periodo ${item.period}`}
                              className="text-muted-foreground hover:text-destructive size-8"
                              disabled={actioning !== null}
                            >
                              <Trash2 aria-hidden className="size-4" />
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
        </section>
      )}

      <UploadLiquidationDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSubmit={upload}
        users={users}
        usersLoading={usersLoading}
      />

      <ConfirmDeleteDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        title="¿Eliminar liquidación?"
        description="Esta acción eliminará de forma permanente la liquidación de sueldo seleccionada. ¿Deseas continuar?"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
