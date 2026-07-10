import { useState, type ReactNode } from 'react';
import {
  ExternalLink,
  FileText,
  History,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDocuments } from '@/hooks/use-documents';
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
const STATUS_OPTIONS: ReadonlyArray<DocumentStatus> = [
  'BORRADOR',
  'EN_REVISION',
  'APROBADO',
  'RECHAZADO',
];

/**
 * Página "Mis documentos" (§6-1.5).
 *
 * Compone el hook `useDocuments` con una tabla de documentos personales: nombre,
 * tipo, estado (badge por DocumentStatus), vencimiento (badge "Vence pronto" /
 * "Vencido" + días), enlace al archivo y a la versión anterior si existe.
 * Filtros por estado y "por vencer" (delegados al backend). Acciones por fila:
 * subir nueva versión y eliminar (con confirmación). El usuario solo ve el
 * estado de revisión; aprobar/rechazar es de un admin revisor. Estados
 * vacío / carga / error siempre presentes. Mobile-first.
 */
export default function DocumentsPage(): ReactNode {
  const docs = useDocuments();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<PersonalDocumentView | null>(null);
  const [toDelete, setToDelete] = useState<PersonalDocumentView | null>(null);

  const hasFilters = Boolean(docs.filters.status) || Boolean(docs.filters.expiring);

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

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">Estado</Label>
          <Select
            id="filter-status"
            aria-label="Filtrar por estado"
            value={docs.filters.status ?? ''}
            onChange={(e) =>
              docs.setFilters({
                ...docs.filters,
                status: e.target.value ? (e.target.value as DocumentStatus) : undefined,
              })
            }
            className="w-auto"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex h-9 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
            checked={docs.filters.expiring ?? false}
            onChange={(e) =>
              docs.setFilters({
                ...docs.filters,
                expiring: e.target.checked ? true : undefined,
              })
            }
          />
          Por vencer (próximos 30 días)
        </label>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => docs.setFilters({})}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {docs.loading && <LoadingState label="Cargando documentos…" />}

      {!docs.loading && docs.error && (
        <ErrorState message={docs.error} onRetry={() => void docs.refetch()} />
      )}

      {!docs.loading && !docs.error && docs.documents.length === 0 && (
        <EmptyState
          icon={FileText}
          message={
            hasFilters
              ? 'No hay documentos que coincidan con los filtros.'
              : 'Aún no has subido documentos.'
          }
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={() => docs.setFilters({})}>
                Quitar filtros
              </Button>
            ) : (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Upload aria-hidden />
                Subir documento
              </Button>
            )
          }
        />
      )}

      {!docs.loading && !docs.error && docs.documents.length > 0 && (
        <Table>
          <caption className="sr-only">Mis documentos personales</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead>Archivo</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium">{doc.name}</TableCell>
                <TableCell className="text-muted-foreground">{doc.type}</TableCell>
                <TableCell>
                  <StatusBadge type="document" status={doc.status} />
                </TableCell>
                <TableCell>
                  <ExpiryCell document={doc} />
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
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
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSubmit={docs.uploadDocument}
      />

      <VersionDialog
        document={versionTarget}
        onOpenChange={(next) => (next ? undefined : setVersionTarget(null))}
        onSubmit={docs.uploadVersion}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(next) => (next ? undefined : setToDelete(null))}
        title="Eliminar documento"
        description={
          <>
            ¿Seguro que quieres eliminar{' '}
            <span className="font-medium text-foreground">{toDelete?.name}</span>? Esta
            acción no se puede deshacer.
          </>
        }
        onConfirm={async () => {
          if (toDelete) await docs.deleteDocument(toDelete.id);
        }}
      />
    </PageContainer>
  );
}
