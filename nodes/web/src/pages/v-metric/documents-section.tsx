import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FileText, FolderOpen, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  DOC_STATUS_META,
  formatRevision,
  ProjectDocumentDetailCard,
} from '@/components/documents/project-document-detail-card';
import { useProjectDocuments } from '@/hooks/use-operations';
import { useProfile } from '@/hooks/use-profile';
import { errorToMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ProjectView, ServiceView } from '@/types/operations';

/** Etiqueta en español por token de tipo documental (§7 del plan maestro). */
const DOC_TYPE_LABEL: Record<string, string> = {
  INF: 'Informe',
  PLN: 'Plano',
  PRC: 'Procedimiento',
  EST: 'Estudio',
  REP: 'Reporte',
  PRT: 'Protocolo',
  // Tipos de protocolo de V-Metric (poza/pdf/placeholders.py, DOC_TYPE_LABELS).
  CR: 'Cubicación Reservorio',
  CP: 'Cubicación Poza',
  CA: 'Cubicación Acopio',
  CL: 'Cota Lámina',
  AE: 'Área Efectiva',
};

/**
 * Deriva el tipo documental desde el código (el modelo no persiste el tipo por
 * separado; viaja embebido en el código). Convive con DOS formatos:
 *  - Web (§7): `GMT-…-{TIPO}-{ÁREA}-{N}` → el tipo es el ANTEPENÚLTIMO segmento.
 *  - Escritorio (V-Metric): `{TIPO}-{ELEMENTO}-{YYYYMMDD}-{HHMMSS}-{microseg}`
 *    → el tipo es el PRIMER segmento (el antepenúltimo sería la FECHA).
 * Regla: si el código NO empieza con `GMT-` y su primer segmento existe en el
 * catálogo, es un código del escritorio; en cualquier otro caso se conserva el
 * antepenúltimo con su fallback.
 */
export function documentTypeFromCode(code: string): string {
  const segments = code.split('-');
  if (segments.length < 3) return '—';
  const first = segments[0] ?? '';
  if (!code.startsWith('GMT-') && DOC_TYPE_LABEL[first] !== undefined) {
    return DOC_TYPE_LABEL[first];
  }
  const token = segments[segments.length - 3] ?? '';
  if (token.length === 0) return '—';
  return DOC_TYPE_LABEL[token] ?? token;
}

export interface VMetricDocumentsSectionProps {
  /** Proyecto seleccionado en el dashboard (null mientras carga). */
  project: ProjectView | null;
  /** Servicio seleccionado (acota el listado; null lista todo el proyecto). */
  service: ServiceView | null;
}

/**
 * Sección "Documentos del Proyecto" del dashboard V-Metric (Fase 1B, C2):
 * lista los documentos del proyecto/servicio seleccionados (protocolos
 * emitidos desde el escritorio incluidos) y permite revisarlos con el visor
 * de PDF embebido y aprobarlos o rechazarlos con el flujo FES existente.
 */
export function VMetricDocumentsSection({ project, service }: VMetricDocumentsSectionProps): ReactNode {
  return (
    <section aria-label="Documentos del proyecto">
      {project ? (
        <DocumentsSectionInner
          key={`${project.id}:${service?.id ?? 'all'}`}
          projectId={project.id}
          serviceId={service?.id}
        />
      ) : (
        <Card className="border border-border/60 bg-card/45 shadow-sm backdrop-blur-md">
          <SectionHeader />
          <CardContent>
            <EmptyState
              icon={FolderOpen}
              message="Selecciona un proyecto para revisar sus documentos."
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function SectionHeader({ actions }: { actions?: ReactNode }): ReactNode {
  return (
    <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b border-border/60 pb-3">
      <div>
        <CardTitle className="flex items-center gap-2 text-md font-bold">
          <FileText className="size-4 text-orange-500" />
          Documentos del Proyecto
        </CardTitle>
        <CardDescription className="text-xs">
          Protocolos e informes del circuito documental, con su estado de revisión y firma.
        </CardDescription>
      </div>
      {actions}
    </CardHeader>
  );
}

function DocumentsSectionInner({
  projectId,
  serviceId,
}: {
  projectId: string;
  serviceId?: string;
}): ReactNode {
  const { profile } = useProfile();
  const { documents, loading, error, refetch, signQA, signClient, reject } = useProjectDocuments(
    projectId,
    serviceId,
  );

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const selectedDoc = useMemo(() => {
    if (!selectedDocId) return null;
    return documents.find((d) => d.id === selectedDocId) ?? null;
  }, [selectedDocId, documents]);

  const isQARole = profile?.roleKeys.includes('qa') || profile?.roleKeys.includes('org_admin');
  const isClientRole = profile?.roleKeys.includes('client_ito') || profile?.roleKeys.includes('org_admin');

  const handleSignQA = async () => {
    if (!selectedDoc) return;
    try {
      await signQA(selectedDoc.id);
      toast.success('Documento firmado con éxito como QA.');
    } catch (err) {
      toast.error(errorToMessage(err, 'Error al firmar documento como QA.'));
    }
  };

  const handleSignClient = async () => {
    if (!selectedDoc) return;
    try {
      await signClient(selectedDoc.id);
      toast.success('Documento firmado con éxito como Cliente/ITO.');
    } catch (err) {
      toast.error(errorToMessage(err, 'Error al firmar documento como Cliente/ITO.'));
    }
  };

  const handleReject = async (reason: string): Promise<void> => {
    if (!selectedDoc) return;
    try {
      await reject(selectedDoc.id, reason);
      toast.success('Documento rechazado.');
    } catch (err) {
      throw new Error(errorToMessage(err, 'Error al rechazar el documento.'));
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      {/* Listado */}
      <Card className="border border-border/60 bg-card/45 shadow-sm backdrop-blur-md lg:col-span-2">
        <SectionHeader
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
              disabled={loading}
              className="h-8 shrink-0 rounded-xl text-xs font-bold"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Actualizar
            </Button>
          }
        />
        <CardContent className="max-h-[520px] overflow-y-auto p-0">
          {loading ? (
            <LoadingState rows={4} label="Cargando documentos…" />
          ) : error !== null ? (
            <ErrorState message={error} onRetry={() => void refetch()} className="m-4" />
          ) : documents.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Sin documentos"
              message="Cuando el escritorio V-Metric emita un protocolo o se suba un documento del servicio, aparecerá aquí para su revisión."
            />
          ) : (
            <div className="divide-y divide-border">
              {documents.map((doc) => {
                const isSelected = selectedDocId === doc.id;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`flex w-full flex-col justify-between gap-3 p-4 text-left transition-colors sm:flex-row sm:items-center ${
                      isSelected
                        ? 'border-l-2 border-orange-500 bg-orange-500/5 hover:bg-orange-500/5'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <FileText
                        className={`mt-0.5 size-5 shrink-0 ${isSelected ? 'text-orange-500' : 'text-muted-foreground'}`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-semibold tracking-tight text-foreground">
                          {doc.code}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-xs font-medium text-muted-foreground">
                          {doc.name}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground/80">
                          Tipo: {documentTypeFromCode(doc.code)} · Actualizado: {formatDate(doc.updatedAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                      <Badge variant="outline" className="text-[10px]">
                        {formatRevision(doc.version)}
                      </Badge>
                      <Badge variant={DOC_STATUS_META[doc.status].variant}>
                        {DOC_STATUS_META[doc.status].label}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detalle: visor embebido + acciones FES */}
      <div className="flex flex-col gap-6">
        {selectedDoc ? (
          <ProjectDocumentDetailCard
            document={selectedDoc}
            canSignQA={Boolean(isQARole)}
            canSignClient={Boolean(isClientRole)}
            onSignQA={() => void handleSignQA()}
            onSignClient={() => void handleSignClient()}
            onRejectRequest={() => setRejectOpen(true)}
          />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-card/25 p-6 text-center text-sm text-muted-foreground">
            Selecciona un documento del listado para revisarlo, firmarlo o rechazarlo.
          </div>
        )}
      </div>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rechazar Documento"
        description="Por favor indica el motivo del rechazo para informar al autor."
        confirmLabel="Rechazar Documento"
        onConfirm={handleReject}
      />
    </div>
  );
}
