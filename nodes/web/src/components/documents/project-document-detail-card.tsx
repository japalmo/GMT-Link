import { useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, FileCheck, PenTool, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ProjectDocumentPdfViewer } from '@/components/documents/project-document-file';
import type { ProjectDocumentStatus, ProjectDocumentView } from '@/types/operations';

/** Etiqueta legible + variante de `Badge` por estado de documento de proyecto. */
export const DOC_STATUS_META: Record<
  ProjectDocumentStatus,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  BORRADOR: { label: 'Borrador', variant: 'neutral' },
  PENDIENTE_QA: { label: 'Pendiente QA', variant: 'warning' },
  PENDIENTE_CLIENTE: { label: 'Pendiente Cliente', variant: 'info' },
  APROBADO: { label: 'Aprobado', variant: 'success' },
  RECHAZADO: { label: 'Rechazado', variant: 'danger' },
};

/** Formatea la revisión del documento (0 → rev0, 1 → revA, 2 → revB, …). */
export function formatRevision(version: number): string {
  if (version === 0) return 'rev0';
  const charCode = 'A'.charCodeAt(0) + (version - 1);
  return `rev${String.fromCharCode(charCode)}`;
}

export interface ProjectDocumentDetailCardProps {
  /** Documento de proyecto a mostrar. */
  document: ProjectDocumentView;
  /** ¿El usuario puede firmar como QA? */
  canSignQA: boolean;
  /** ¿El usuario puede firmar como Cliente/ITO? */
  canSignClient: boolean;
  /** Firma QA del documento. */
  onSignQA: () => void;
  /** Firma Cliente/ITO del documento. */
  onSignClient: () => void;
  /** Solicita rechazar (el llamador abre su diálogo de motivo). */
  onRejectRequest: () => void;
  /**
   * Sube una nueva revisión (PDF). Si se omite, la acción no se ofrece
   * (p. ej. superficies de solo revisión como V-Metric).
   */
  onUploadRevision?: (file: File) => Promise<void>;
  /** Clase opcional del contenedor. */
  className?: string;
}

/**
 * Panel de detalle de un documento de proyecto (Fase 1B): visor de PDF embebido
 * con URL fresca, hash FES, línea de tiempo de aprobaciones y acciones de
 * firma/rechazo/revisión. Compartido entre Operaciones → Documentos y V-Metric.
 */
export function ProjectDocumentDetailCard({
  document: doc,
  canSignQA,
  canSignClient,
  onSignQA,
  onSignClient,
  onRejectRequest,
  onUploadRevision,
  className,
}: ProjectDocumentDetailCardProps): ReactNode {
  const revisionInputRef = useRef<HTMLInputElement>(null);

  const handleRevisionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Permite volver a elegir el mismo archivo tras un error.
    e.target.value = '';
    if (!file || !onUploadRevision) return;

    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      toast.error('La revisión debe ser obligatoriamente un archivo PDF.');
      return;
    }
    await onUploadRevision(file);
  };

  return (
    <Card className={cn('flex h-full flex-col border border-border bg-card/70 shadow-sm', className)}>
      <CardHeader className="border-b pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Badge variant="outline" className="mb-2">
              {formatRevision(doc.version)}
            </Badge>
            <CardTitle className="line-clamp-2 text-sm font-bold leading-snug tracking-tight text-foreground">
              {doc.code}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {doc.name}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5 py-4">
        {/* Visor de PDF embebido con URL fresca (C1) */}
        <ProjectDocumentPdfViewer
          documentId={doc.id}
          version={doc.version}
          title={doc.name}
        />

        {/* Hash FES Audit Trail */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Firma Electrónica Simple (FES)</span>
          <div className="select-all break-all rounded-lg border border-border bg-muted/20 p-2.5 font-mono text-[10px] text-muted-foreground" title="SHA-256 Hash auditado">
            Hash: {doc.fileHash || 'No calculado'}
          </div>
        </div>

        {/* Línea de tiempo */}
        <div className="flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Línea de Tiempo de Aprobaciones</span>

          <div className="relative flex flex-col gap-4 border-l border-border/80 pl-5">
            {/* Paso 1: Carga */}
            <div className="relative">
              <div className="absolute -left-[26px] top-0.5 size-3 rounded-full border-2 border-background bg-emerald-500" />
              <div className="flex flex-col text-xs">
                <span className="font-bold text-foreground">1. Generación y Carga</span>
                <span className="text-muted-foreground">Creado por {doc.owner?.firstName} {doc.owner?.lastName}</span>
                <span className="text-[10px] text-muted-foreground/80">{new Date(doc.createdAt).toLocaleDateString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            {/* Paso 2: QA */}
            <div className="relative">
              {doc.qaSigner ? (
                <>
                  <div className="absolute -left-[26px] top-0.5 size-3 rounded-full border-2 border-background bg-emerald-500" />
                  <div className="flex flex-col text-xs">
                    <span className="font-bold text-foreground">2. Control de Calidad QA</span>
                    <span className="text-muted-foreground">Aprobado y Firmado por {doc.qaSigner.firstName} {doc.qaSigner.lastName}</span>
                    <span className="text-[10px] text-muted-foreground/80">
                      {doc.qaSignedAt ? new Date(doc.qaSignedAt).toLocaleDateString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                </>
              ) : doc.status === 'RECHAZADO' && !doc.qaSignedAt ? (
                <>
                  <div className="absolute -left-[26px] top-0.5 size-3 rounded-full border-2 border-background bg-destructive" />
                  <div className="flex flex-col text-xs">
                    <span className="font-bold text-destructive">2. Control de Calidad QA (Rechazado)</span>
                    <p className="mt-1 text-[11px] italic text-muted-foreground">
                      "{doc.rejectionReason}"
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="absolute -left-[26px] top-0.5 size-3 animate-pulse rounded-full border-2 border-background bg-amber-500" />
                  <div className="flex flex-col text-xs">
                    <span className="font-bold text-amber-500">2. Control de Calidad QA</span>
                    <span className="text-muted-foreground">Esperando revisión y firma de QA</span>
                  </div>
                </>
              )}
            </div>

            {/* Paso 3: Cliente/ITO (si el servicio lo exige) */}
            {doc.service?.docCodingConfig?.requiresClientSignature === true && (
              <div className="relative">
                {doc.clientSigner ? (
                  <>
                    <div className="absolute -left-[26px] top-0.5 size-3 rounded-full border-2 border-background bg-emerald-500" />
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-foreground">3. Aprobación Cliente/ITO</span>
                      <span className="text-muted-foreground">Firmado por {doc.clientSigner.firstName} {doc.clientSigner.lastName}</span>
                      <span className="text-[10px] text-muted-foreground/80">
                        {doc.clientSignedAt ? new Date(doc.clientSignedAt).toLocaleDateString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                  </>
                ) : doc.status === 'RECHAZADO' && doc.qaSignedAt ? (
                  <>
                    <div className="absolute -left-[26px] top-0.5 size-3 rounded-full border-2 border-background bg-destructive" />
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-destructive">3. Aprobación Cliente/ITO (Rechazado)</span>
                      <p className="mt-1 text-[11px] italic text-muted-foreground">
                        "{doc.rejectionReason}"
                      </p>
                    </div>
                  </>
                ) : doc.status === 'PENDIENTE_CLIENTE' ? (
                  <>
                    <div className="absolute -left-[26px] top-0.5 size-3 animate-pulse rounded-full border-2 border-background bg-amber-500" />
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-amber-500">3. Aprobación Cliente/ITO</span>
                      <span className="text-muted-foreground">Pendiente de firma del Cliente/ITO</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="absolute -left-[26px] top-0.5 size-3 rounded-full border-2 border-background bg-muted" />
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-muted-foreground">3. Aprobación Cliente/ITO</span>
                      <span className="text-[10px] text-muted-foreground">Esperando aprobación previa de QA</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Resumen aprobado */}
        {doc.status === 'APROBADO' && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs text-emerald-500">
            <CheckCircle2 className="size-5 shrink-0" />
            <div className="font-medium">
              Documento Aprobado y Vigente para uso operacional.
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 border-t bg-muted/10 pt-4">
        {/* Acciones QA */}
        {doc.status === 'PENDIENTE_QA' && (
          <div className="flex w-full gap-2">
            <Button
              disabled={!canSignQA}
              onClick={onSignQA}
              className="flex-1 text-xs"
            >
              <PenTool className="mr-1 size-3.5" />
              Firmar QA
            </Button>
            <Button
              disabled={!canSignQA}
              variant="destructive"
              onClick={onRejectRequest}
              className="flex-1 text-xs"
            >
              <XCircle className="mr-1 size-3.5" />
              Rechazar
            </Button>
          </div>
        )}

        {/* Acciones Cliente/ITO */}
        {doc.status === 'PENDIENTE_CLIENTE' && (
          <div className="flex w-full gap-2">
            <Button
              disabled={!canSignClient}
              onClick={onSignClient}
              className="flex-1 text-xs"
            >
              <FileCheck className="mr-1 size-3.5" />
              Firmar Cliente
            </Button>
            <Button
              disabled={!canSignClient}
              variant="destructive"
              onClick={onRejectRequest}
              className="flex-1 text-xs"
            >
              <XCircle className="mr-1 size-3.5" />
              Rechazar
            </Button>
          </div>
        )}

        {/* Nueva revisión / corrección */}
        {onUploadRevision && (doc.status === 'APROBADO' || doc.status === 'RECHAZADO') && (
          <div className="w-full">
            <input
              type="file"
              ref={revisionInputRef}
              onChange={(e) => void handleRevisionFileChange(e)}
              accept=".pdf"
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => revisionInputRef.current?.click()}
              className="w-full text-xs"
            >
              <RefreshCw className="mr-1 size-3.5" />
              Subir Nueva Revisión ({doc.status === 'APROBADO' ? 'Incrementar Rev' : 'Corregir'})
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
