import { useCallback, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Ban,
  Check,
  DollarSign,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
} from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useReimbursements } from '@/hooks/use-reimbursements';
import { useHasPermission } from '@/hooks/use-has-permission';
import { errorToMessage, fetchReimbursementsTable } from '@/lib/api';
import type { TableRequest } from '@gmt-platform/contracts';
import { formatCLP, formatDate } from '@/lib/format';
import type { CreateReimbursementInput, ReimbursementView } from '@/types/finance';
import { DOC_ACCEPT, validateFile } from '../perfil/file-field';
import { ConfirmDialog } from '../perfil/confirm-dialog';
import { ReembolsoFormDialog } from './reembolso-form';
import { BatchPrintDialog } from './batch-print-dialog';

export function ReembolsosTab(): ReactNode {
  const {
    mine,
    mineHasMore,
    loadingMoreMine,
    loadMoreMine,
    isManager,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
    attachReceipt,
    approve,
    reject,
    pay,
  } = useReimbursements();

  const canPrintBatch = useHasPermission('finance:print:batch');

  // MOTOR de tablas de Gestión (offset). Solo consulta si el usuario es gestor
  // (enabled=isManager); un no-gestor nunca dispara el 403 del endpoint. La barra
  // de "Mis Reembolsos" y las mutaciones siguen usando useReimbursements.
  const managerFetcher = useCallback((req: TableRequest) => fetchReimbursementsTable(req), []);
  const managerTable = useDataTable<ReimbursementView>(managerFetcher, {
    enabled: isManager,
    initialSortBy: 'fecha',
    initialSortDir: 'desc',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ReimbursementView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReimbursementView | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Crea el reembolso con su boleta obligatoria en un solo paso (multipart). */
  const handleCreate = async (
    input: CreateReimbursementInput,
    receiptFile?: File,
  ): Promise<void> => {
    // En creación el formulario garantiza la boleta (guard interno); si faltara,
    // el propio diálogo bloquea el envío antes de llegar acá.
    if (!receiptFile) return;
    await create(input, receiptFile);
  };

  /** Edita un reembolso propio PENDIENTE (sin tocar la boleta). */
  const handleEdit = async (input: CreateReimbursementInput): Promise<void> => {
    if (!editTarget) return;
    await update(editTarget.id, input);
  };

  const handleApprove = async (id: string): Promise<void> => {
    if (actioning) return;
    setActioning(id);
    try {
      await approve(id);
      managerTable.refetch();
      toast.success('Reembolso aprobado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aprobar reembolso.');
    } finally {
      setActioning(null);
    }
  };

  const handlePay = async (id: string): Promise<void> => {
    if (actioning) return;
    setActioning(id);
    try {
      await pay(id);
      managerTable.refetch();
      toast.success('Pago registrado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar pago.');
    } finally {
      setActioning(null);
    }
  };

  const handleAttachReceiptClick = (id: string): void => {
    setUploadingId(id);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !uploadingId) {
      setUploadingId(null);
      return;
    }

    const validationError = validateFile(file, DOC_ACCEPT);
    if (validationError) {
      toast.error(validationError);
      setUploadingId(null);
      e.target.value = '';
      return;
    }

    try {
      await attachReceipt(uploadingId, file);
      toast.success('Boleta subida con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir el archivo de la boleta.');
    } finally {
      setUploadingId(null);
      e.target.value = '';
    }
  };

  // Columnas / filtro / acciones de la tabla de Gestión (motor server-side).
  const managerColumns: ReadonlyArray<DataTableColumn<ReimbursementView>> = [
    {
      id: 'solicitante',
      header: 'Solicitante',
      sortable: true,
      render: (item) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">
            {item.requester ? `${item.requester.firstName} ${item.requester.lastName}` : 'Sin solicitante'}
          </span>
          <span className="text-xs text-muted-foreground">{item.requester?.email}</span>
        </div>
      ),
    },
    { id: 'fecha', header: 'Fecha', sortable: true, render: (item) => formatDate(item.date) },
    { id: 'concepto', header: 'Concepto', render: (item) => item.concept },
    { id: 'monto', header: 'Monto', sortable: true, render: (item) => formatCLP(item.amount) },
    {
      id: 'estado',
      header: 'Estado',
      sortable: true,
      render: (item) => <StatusBadge type="finance" status={item.status} />,
    },
    {
      id: 'boleta',
      header: 'Boleta',
      render: (item) =>
        item.receiptUrl ? (
          <a
            href={item.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <FileText className="size-3.5" aria-hidden />
            Ver boleta
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">Sin boleta</span>
        ),
    },
  ];

  const managerStatusFilter: DataTableFilter = {
    id: 'status',
    label: 'Estado',
    allLabel: 'Todos los estados',
    options: [
      { value: 'PENDIENTE', label: 'Pendiente' },
      { value: 'APROBADO', label: 'Aprobado' },
      { value: 'PAGADO', label: 'Pagado' },
      { value: 'RECHAZADO', label: 'Rechazado' },
    ],
  };

  const managerRowActions = (item: ReimbursementView): ReactNode => (
    <>
      {item.status === 'PENDIENTE' && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10"
            onClick={() => void handleApprove(item.id)}
            disabled={actioning !== null}
          >
            {actioning === item.id ? (
              'Procesando...'
            ) : (
              <>
                <Check className="size-3.5" aria-hidden />
                Aprobar
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs text-destructive hover:bg-destructive/5"
            onClick={() => setRejectTargetId(item.id)}
            disabled={actioning !== null}
          >
            <Ban className="size-3.5" aria-hidden />
            Rechazar
          </Button>
        </>
      )}
      {item.status === 'APROBADO' && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-500/10"
          onClick={() => void handlePay(item.id)}
          disabled={actioning !== null}
        >
          {actioning === item.id ? (
            'Procesando...'
          ) : (
            <>
              <DollarSign className="size-3.5" aria-hidden />
              Registrar Pago
            </>
          )}
        </Button>
      )}
      {(item.status === 'PAGADO' || item.status === 'RECHAZADO') && (
        <span className="text-xs italic text-muted-foreground">Completado</span>
      )}
    </>
  );

  if (loading) {
    return <LoadingState rows={4} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Sección Mis Reembolsos */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Mis Reembolsos</h2>
          {/* Visible para todos (resolución #2). */}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            Nueva solicitud
          </Button>
        </div>

        {mine.length === 0 ? (
          <EmptyState
            icon={FileText}
            message="Aún no tienes solicitudes de reembolso registradas."
            action={
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden />
                Nueva solicitud
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Boleta</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDate(item.date)}</TableCell>
                    <TableCell className="font-medium">{item.concept}</TableCell>
                    <TableCell className="text-muted-foreground">{item.category || '—'}</TableCell>
                    <TableCell>{formatCLP(item.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge type="finance" status={item.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {item.receiptUrl ? (
                          <a
                            href={item.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <FileText className="size-3.5" aria-hidden />
                            Ver boleta
                          </a>
                        ) : item.status === 'PENDIENTE' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={uploadingId !== null}
                            onClick={() => handleAttachReceiptClick(item.id)}
                          >
                            {uploadingId === item.id ? (
                              <>
                                <Loader2 className="size-3 animate-spin" aria-hidden />
                                Subiendo...
                              </>
                            ) : (
                              <>
                                <Upload className="size-3" aria-hidden />
                                Subir boleta
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin boleta</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {item.status === 'PENDIENTE' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setEditTarget(item)}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-destructive hover:bg-destructive/5"
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              Borrar
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Paginación server-side: carga la siguiente página al final de "Mis Reembolsos". */}
        {mineHasMore && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void loadMoreMine()} disabled={loadingMoreMine}>
              {loadingMoreMine ? 'Cargando…' : 'Cargar más'}
            </Button>
          </div>
        )}
      </section>

      {/* Sección de Gestión */}
      {isManager && (
        <section className="flex flex-col gap-4">
          <div className="border-t border-border pt-6 flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Gestión de Reembolsos</h2>
              <p className="text-sm text-muted-foreground">
                Aprobación, rechazo y pago de solicitudes de la organización.
              </p>
            </div>
            {canPrintBatch && (
              <Button
                variant="outline"
                size="sm"
                className="text-primary border-primary/45 hover:bg-primary/5"
                onClick={() => setPrintOpen(true)}
              >
                <Printer className="size-4" aria-hidden />
                Impresión en lote
              </Button>
            )}
          </div>

          <DataTable<ReimbursementView>
            table={managerTable}
            columns={managerColumns}
            getRowId={(item) => item.id}
            filters={[managerStatusFilter]}
            rowActions={managerRowActions}
            emptyMessage="No hay reembolsos pendientes ni registrados en el sistema."
            caption="Gestión de reembolsos"
          />
        </section>
      )}

      {/* Hidden file input para adjuntar boleta a un reembolso ya creado */}
      <input
        ref={fileInputRef}
        type="file"
        accept={DOC_ACCEPT}
        className="sr-only"
        onChange={(e) => void handleFileChange(e)}
      />

      <ReembolsoFormDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreate} />

      {/* Edición de un reembolso propio PENDIENTE (reusa el formulario en modo edición). */}
      <ReembolsoFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        initial={editTarget ?? undefined}
        onSubmit={handleEdit}
      />

      {/* Confirmación de borrado de un reembolso propio PENDIENTE. */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Eliminar reembolso"
        description="Se eliminará esta solicitud de reembolso de forma permanente. Esta acción no se puede deshacer."
        onConfirm={async () => {
          if (!deleteTarget) return;
          await remove(deleteTarget.id);
        }}
      />

      {canPrintBatch && (
        <BatchPrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          onPrinted={() => {
            void refetch();
            managerTable.refetch();
          }}
        />
      )}

      <RejectDialog
        open={rejectTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTargetId(null);
        }}
        title="Rechazar reembolso"
        reasonRequired={false}
        onConfirm={async (reason) => {
          if (!rejectTargetId) return;
          setActioning(rejectTargetId);
          try {
            await reject(rejectTargetId, reason);
            managerTable.refetch();
            toast.success('Reembolso rechazado.');
          } catch (err) {
            throw new Error(errorToMessage(err, 'Error al rechazar reembolso.'));
          } finally {
            setActioning(null);
          }
        }}
      />
    </div>
  );
}
