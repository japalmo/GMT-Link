import { useCallback, useState, type ReactNode } from 'react';
import { ExternalLink, FileText, History, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
} from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import {
  fetchDocumentsTable,
  uploadDocument as apiUploadDocument,
  uploadDocumentVersion as apiUploadDocumentVersion,
  deleteDocument as apiDeleteDocument,
} from '@/lib/api';
import type { TableRequest } from '@gmt-platform/contracts';
import type { DocumentStatus, PersonalDocumentView } from '@/types/documents';
import { ProfileTabs } from '../perfil/profile-tabs';
import { ConfirmDialog } from '../perfil/confirm-dialog';
import { ExpiryCell } from './expiry-cell';
import { UploadDocumentDialog } from './upload-document-dialog';
import { VersionDialog } from './version-dialog';

/** Etiqueta legible (es-CL) por estado, para las opciones del filtro. */
const STATUS_LABEL: Record<DocumentStatus, string> = {
  BORRADOR: 'Borrador',
  EN_REVISION: 'En revisión',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

/** Opciones del filtro por estado. */
const STATUS_OPTIONS: ReadonlyArray<DocumentStatus> = ['BORRADOR', 'EN_REVISION', 'APROBADO', 'RECHAZADO'];

/**
 * Página "Mis documentos" (§6-1.5).
 *
 * Ensambla el MOTOR de tablas (`useDataTable` + `DataTable`, server-side offset):
 * documento, tipo, estado (badge), vencimiento (badge "Vence pronto"/"Vencido"),
 * enlace al archivo y a la versión anterior. Filtros por estado y "por vencer" y
 * orden se resuelven en el servidor sobre TODOS los documentos. Acciones por fila:
 * subir nueva versión y eliminar. El usuario solo ve el estado de revisión.
 */
export default function DocumentsPage(): ReactNode {
  const fetcher = useCallback((req: TableRequest) => fetchDocumentsTable(req), []);
  const table = useDataTable<PersonalDocumentView>(fetcher, {
    initialSortBy: 'vencimiento',
    initialSortDir: 'asc',
  });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<PersonalDocumentView | null>(null);
  const [toDelete, setToDelete] = useState<PersonalDocumentView | null>(null);

  const statusFilter: DataTableFilter = {
    id: 'status',
    label: 'Estado',
    allLabel: 'Todos',
    options: STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  };
  const expiringFilter: DataTableFilter = {
    id: 'expiring',
    label: 'Vencimiento',
    allLabel: 'Todos',
    options: [{ value: 'true', label: 'Por vencer (30 días)' }],
  };

  const columns: ReadonlyArray<DataTableColumn<PersonalDocumentView>> = [
    { id: 'documento', header: 'Documento', sortable: true, render: (doc) => <span className="font-medium">{doc.name}</span> },
    { id: 'tipo', header: 'Tipo', sortable: true, render: (doc) => <span className="text-muted-foreground">{doc.type}</span> },
    { id: 'estado', header: 'Estado', sortable: true, render: (doc) => <StatusBadge type="document" status={doc.status} /> },
    { id: 'vencimiento', header: 'Vencimiento', sortable: true, render: (doc) => <ExpiryCell document={doc} /> },
    {
      id: 'archivo',
      header: 'Archivo',
      render: (doc) => (
        <div className="flex flex-col gap-1">
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            <FileText className="size-4" aria-hidden />
            Ver archivo
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          {doc.previousFileUrl && (
            <a
              href={doc.previousFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <History className="size-3.5" aria-hidden />
              Versión anterior
            </a>
          )}
        </div>
      ),
    },
  ];

  const rowActions = (doc: PersonalDocumentView): ReactNode => (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setVersionTarget(doc)}
        aria-label={`Subir nueva versión de ${doc.name}`}
      >
        <Upload aria-hidden />
        Nueva versión
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setToDelete(doc)}
        aria-label={`Eliminar ${doc.name}`}
        title="Eliminar"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 aria-hidden />
      </Button>
    </>
  );

  return (
    <PageContainer maxWidth="7xl">
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Mis documentos"
          description="Sube tus documentos y revisa su estado y vencimiento."
          actions={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload aria-hidden />
              Subir documento
            </Button>
          }
        />
        <ProfileTabs />
      </div>

      <DataTable<PersonalDocumentView>
        table={table}
        columns={columns}
        getRowId={(doc) => doc.id}
        filters={[statusFilter, expiringFilter]}
        rowActions={rowActions}
        emptyMessage="No hay documentos que coincidan. Sube el primero o ajusta los filtros."
        caption="Mis documentos personales"
      />

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSubmit={async (fields, file) => {
          await apiUploadDocument(fields, file);
          table.refetch();
        }}
      />

      <VersionDialog
        document={versionTarget}
        onOpenChange={(next) => (next ? undefined : setVersionTarget(null))}
        onSubmit={async (id, file) => {
          await apiUploadDocumentVersion(id, file);
          table.refetch();
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(next) => (next ? undefined : setToDelete(null))}
        title="Eliminar documento"
        description={
          <>
            ¿Seguro que quieres eliminar{' '}
            <span className="font-medium text-foreground">{toDelete?.name}</span>? Esta acción no se puede
            deshacer.
          </>
        }
        onConfirm={async () => {
          if (toDelete) {
            await apiDeleteDocument(toDelete.id);
            table.refetch();
          }
        }}
      />
    </PageContainer>
  );
}
