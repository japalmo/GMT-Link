import { useState, type ReactNode, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useProjects, useProjectDocuments } from '@/hooks/use-operations';
import { useProfile } from '@/hooks/use-profile';
import {
  Plus,
  Search,
  FileText,
  CheckCircle2,
  XCircle,
  Download,
  PenTool,
  FileCheck,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '@/components/ui/modal';
import type { ProjectDocumentStatus } from '@/types/operations';

export function formatRevision(version: number): string {
  if (version === 0) return 'rev0';
  const charCode = 'A'.charCodeAt(0) + (version - 1);
  return `rev${String.fromCharCode(charCode)}`;
}

export function DocumentosTab(): ReactNode {
  const { profile } = useProfile();
  const { projects } = useProjects();
  
  // Filters state
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const { documents, loading, upload, uploadRevision, signQA, signClient, reject } = useProjectDocuments(
    filterProject === 'all' ? undefined : filterProject,
    filterService === 'all' ? undefined : filterService
  );

  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  // Modals state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  // Create form states
  const [docName, setDocName] = useState('');
  const [docProjId, setDocProjId] = useState('');
  const [docSrvId, setDocSrvId] = useState('');
  const [docType, setDocType] = useState('INF'); // Default INF (Informe)
  const [docArea, setDocArea] = useState('NT'); // Default NT (Geotecnia)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Reject form states
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  // Revision file input ref
  const revisionInputRef = useRef<HTMLInputElement>(null);

  // Dynamically select services based on current project select in creation
  const projectServices = useMemo(() => {
    if (!docProjId) return [];
    const proj = projects.find((p) => p.id === docProjId);
    return proj?.services || [];
  }, [docProjId, projects]);

  const filterProjectServices = useMemo(() => {
    if (filterProject === 'all') return [];
    const proj = projects.find((p) => p.id === filterProject);
    return proj?.services || [];
  }, [filterProject, projects]);

  // Filter documents in memory for the search query
  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      const matchSearch =
        doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.code.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [documents, searchQuery]);

  // Derive activeDoc from activeDocId using the live documents list
  const activeDoc = useMemo(() => {
    if (!activeDocId) return null;
    return documents.find((d) => d.id === activeDocId) || null;
  }, [activeDocId, documents]);

  const handleCloseRejectModal = () => {
    setRejectOpen(false);
    setRejectReason('');
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!docName || !docProjId || !docSrvId || !selectedFile) {
      setFormError('Por favor completa todos los campos requeridos y selecciona un archivo PDF.');
      return;
    }

    if (selectedFile.type !== 'application/pdf' && !selectedFile.name.endsWith('.pdf')) {
      setFormError('La revisión debe ser obligatoriamente un archivo PDF.');
      return;
    }

    setIsUploading(true);
    try {
      await upload(
        {
          name: docName,
          projectId: docProjId,
          serviceId: docSrvId,
          documentType: docType,
          areaCode: docArea,
        },
        selectedFile
      );

      // Reset form
      setDocName('');
      setDocProjId('');
      setDocSrvId('');
      setDocType('INF');
      setDocArea('NT');
      setSelectedFile(null);
      setUploadOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al subir el documento.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadRevisionClick = () => {
    revisionInputRef.current?.click();
  };

  const handleRevisionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeDoc) return;

    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      toast.error('La revisión debe ser obligatoriamente un archivo PDF.');
      return;
    }

    try {
      await uploadRevision(activeDoc.id, file);
      toast.success('Nueva revisión subida con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir la revisión del documento.');
    }
  };

  const handleSignQA = async () => {
    if (!activeDoc) return;
    try {
      await signQA(activeDoc.id);
      toast.success('Documento firmado con éxito como QA.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al firmar documento como QA.');
    }
  };

  const handleSignClient = async () => {
    if (!activeDoc) return;
    try {
      await signClient(activeDoc.id);
      toast.success('Documento firmado con éxito como Cliente/ITO.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al firmar documento como Cliente/ITO.');
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDoc || !rejectReason.trim()) return;

    setIsRejecting(true);
    try {
      await reject(activeDoc.id, rejectReason);
      handleCloseRejectModal();
      toast.success('Documento rechazado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al rechazar el documento.');
    } finally {
      setIsRejecting(false);
    }
  };

  const getStatusColor = (status: ProjectDocumentStatus) => {
    switch (status) {
      case 'BORRADOR':
        return 'bg-muted border-border text-muted-foreground';
      case 'PENDIENTE_QA':
        return 'bg-amber-500/10 border-amber-500/20 text-amber-500';
      case 'PENDIENTE_CLIENTE':
        return 'bg-purple-500/10 border-purple-500/20 text-purple-500';
      case 'APROBADO':
        return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500';
      case 'RECHAZADO':
        return 'bg-destructive/10 border-destructive/20 text-destructive';
    }
  };

  // Check roles from Profile
  const isQARole = profile?.roleKeys.includes('qa') || profile?.roleKeys.includes('org_admin');
  const isClientRole = profile?.roleKeys.includes('client_ito') || profile?.roleKeys.includes('org_admin');

  return (
    <div className="flex flex-col gap-6">
      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/60 p-4 shadow-xs backdrop-blur-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="size-4 text-primary" />
            <span>Control de Documentación Técnica</span>
          </div>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="size-4 mr-2" />
            Subir Documento
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-doc-proj" className="text-xs">Proyecto</Label>
            <select
              id="filter-doc-proj"
              value={filterProject}
              onChange={(e) => {
                setFilterProject(e.target.value);
                setFilterService('all');
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">Todos los proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-doc-srv" className="text-xs">Servicio</Label>
            <select
              id="filter-doc-srv"
              value={filterService}
              disabled={filterProject === 'all'}
              onChange={(e) => setFilterService(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              <option value="all">Todos los servicios</option>
              {filterProjectServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search-doc" className="text-xs">Buscar Código o Nombre</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                id="search-doc"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ej. GMT-ALS-GEO-MAP-001..."
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grid Principal: Listado y Detalle */}
      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted/40 border border-border" />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Listado de Documentos */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Card className="bg-card/50">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-md">Documentos del Sistema</CardTitle>
                <CardDescription>
                  Listado de informes, planos y especificaciones técnicas codificados.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-[600px] overflow-y-auto">
                <div className="divide-y divide-border">
                  {filteredDocs.map((doc) => {
                    const isSelected = activeDocId === doc.id;
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setActiveDocId(doc.id)}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary/5 hover:bg-primary/5 border-l-2 border-primary'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <FileText className={`size-5 mt-0.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm tracking-tight text-foreground truncate">
                              {doc.code}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-1 font-medium mt-0.5">
                              {doc.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground/80 mt-1">
                              Servicio: {doc.service?.name} | Autor: {doc.owner?.firstName} {doc.owner?.lastName}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <Badge variant="outline" className="text-[10px]">
                            {formatRevision(doc.version)}
                          </Badge>
                          <Badge className={getStatusColor(doc.status)}>
                            {doc.status}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}

                  {filteredDocs.length === 0 && (
                    <div className="py-16 text-center">
                      <FolderOpen className="size-10 text-muted-foreground/60 mx-auto mb-3" />
                      <h3 className="font-semibold text-base">No se encontraron documentos</h3>
                      <p className="text-sm text-muted-foreground px-4">
                        Modifica los filtros o sube un nuevo documento para ver su flujo de aprobación.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Panel Lateral: Detalle, Auditoría y Firmas (FES) */}
          <div className="flex flex-col gap-6">
            {activeDoc ? (
              <Card className="bg-card/70 shadow-sm border border-border flex flex-col h-full">
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge variant="outline" className="mb-2">
                        {formatRevision(activeDoc.version)}
                      </Badge>
                      <CardTitle className="text-sm font-bold tracking-tight text-foreground line-clamp-2 leading-snug">
                        {activeDoc.code}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {activeDoc.name}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col gap-5 py-4">
                  {/* File Download / View Link */}
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-primary/5 border-primary/10">
                    <div className="flex items-center gap-2">
                      <FileText className="size-5 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Archivo PDF</span>
                    </div>
                    <a
                      href={activeDoc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary font-bold hover:underline cursor-pointer"
                      title="Descargar o visualizar archivo"
                    >
                      <Download className="size-3.5" />
                      Ver/Descargar
                    </a>
                  </div>

                  {/* Hash FES Audit Trail */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Firma Electrónica Simple (FES)</span>
                    <div className="p-2.5 rounded-lg border bg-muted/20 border-border font-mono text-[10px] text-muted-foreground select-all break-all" title="SHA-256 Hash auditado">
                      Hash: {activeDoc.fileHash || 'No calculado'}
                    </div>
                  </div>

                  {/* Timeline Tracker */}
                  <div className="flex flex-col gap-4">
                    <span className="text-xs font-bold text-muted-foreground tracking-wide uppercase">Línea de Tiempo de Aprobaciones</span>

                    <div className="flex flex-col gap-4 relative pl-5 border-l border-border/80">
                      {/* Step 1: Upload */}
                      <div className="relative">
                        <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-emerald-500 border-2 border-background" />
                        <div className="flex flex-col text-xs">
                          <span className="font-bold text-foreground">1. Generación y Carga</span>
                          <span className="text-muted-foreground">Creado por {activeDoc.owner?.firstName} {activeDoc.owner?.lastName}</span>
                          <span className="text-[10px] text-muted-foreground/80">{new Date(activeDoc.createdAt).toLocaleDateString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>

                      {/* Step 2: QA Review */}
                      <div className="relative">
                        {activeDoc.qaSigner ? (
                          <>
                            <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-emerald-500 border-2 border-background" />
                            <div className="flex flex-col text-xs">
                              <span className="font-bold text-foreground">2. Control de Calidad QA</span>
                              <span className="text-muted-foreground">Aprobado y Firmado por {activeDoc.qaSigner.firstName} {activeDoc.qaSigner.lastName}</span>
                              <span className="text-[10px] text-muted-foreground/80">
                                {activeDoc.qaSignedAt ? new Date(activeDoc.qaSignedAt).toLocaleDateString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          </>
                        ) : activeDoc.status === 'RECHAZADO' && !activeDoc.qaSignedAt ? (
                          <>
                            <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-destructive border-2 border-background" />
                            <div className="flex flex-col text-xs">
                              <span className="font-bold text-destructive">2. Control de Calidad QA (Rechazado)</span>
                              <p className="text-[11px] text-muted-foreground mt-1 italic">
                                "{activeDoc.rejectionReason}"
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-amber-500 animate-pulse border-2 border-background" />
                            <div className="flex flex-col text-xs">
                              <span className="font-bold text-amber-500">2. Control de Calidad QA</span>
                              <span className="text-muted-foreground">Esperando revisión y firma de QA</span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Step 3: Client Signature (If required) */}
                      {activeDoc.service?.docCodingConfig?.requiresClientSignature === true && (
                        <div className="relative">
                          {activeDoc.clientSigner ? (
                            <>
                              <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-emerald-500 border-2 border-background" />
                              <div className="flex flex-col text-xs">
                                <span className="font-bold text-foreground">3. Aprobación Cliente/ITO</span>
                                <span className="text-muted-foreground">Firmado por {activeDoc.clientSigner.firstName} {activeDoc.clientSigner.lastName}</span>
                                <span className="text-[10px] text-muted-foreground/80">
                                  {activeDoc.clientSignedAt ? new Date(activeDoc.clientSignedAt).toLocaleDateString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                              </div>
                            </>
                          ) : activeDoc.status === 'RECHAZADO' && activeDoc.qaSignedAt ? (
                            <>
                              <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-destructive border-2 border-background" />
                              <div className="flex flex-col text-xs">
                                <span className="font-bold text-destructive">3. Aprobación Cliente/ITO (Rechazado)</span>
                                <p className="text-[11px] text-muted-foreground mt-1 italic">
                                  "{activeDoc.rejectionReason}"
                                </p>
                              </div>
                            </>
                          ) : activeDoc.status === 'PENDIENTE_CLIENTE' ? (
                            <>
                              <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-amber-500 animate-pulse border-2 border-background" />
                              <div className="flex flex-col text-xs">
                                <span className="font-bold text-amber-500">3. Aprobación Cliente/ITO</span>
                                <span className="text-muted-foreground">Pendiente de firma del Cliente/ITO</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="absolute -left-[26px] top-0.5 size-3 rounded-full bg-muted border-2 border-background" />
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

                  {/* Summary Approved status */}
                  {activeDoc.status === 'APROBADO' && (
                    <div className="flex items-center gap-2 p-3.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-500 mt-2 text-xs">
                      <CheckCircle2 className="size-5 shrink-0" />
                      <div className="font-medium">
                        Documento Aprobado y Vigente para uso operacional.
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-2 border-t pt-4 bg-muted/10">
                  {/* QA actions */}
                  {activeDoc.status === 'PENDIENTE_QA' && (
                    <div className="flex w-full gap-2">
                      <Button
                        disabled={!isQARole}
                        onClick={handleSignQA}
                        className="flex-1 text-xs"
                      >
                        <PenTool className="size-3.5 mr-1" />
                        Firmar QA
                      </Button>
                      <Button
                        disabled={!isQARole}
                        variant="destructive"
                        onClick={() => setRejectOpen(true)}
                        className="flex-1 text-xs"
                      >
                        <XCircle className="size-3.5 mr-1" />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  {/* Client actions */}
                  {activeDoc.status === 'PENDIENTE_CLIENTE' && (
                    <div className="flex w-full gap-2">
                      <Button
                        disabled={!isClientRole}
                        onClick={handleSignClient}
                        className="flex-1 text-xs"
                      >
                        <FileCheck className="size-3.5 mr-1" />
                        Firmar Cliente
                      </Button>
                      <Button
                        disabled={!isClientRole}
                        variant="destructive"
                        onClick={() => setRejectOpen(true)}
                        className="flex-1 text-xs"
                      >
                        <XCircle className="size-3.5 mr-1" />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  {/* Revision / Correction Action */}
                  {(activeDoc.status === 'APROBADO' || activeDoc.status === 'RECHAZADO') && (
                    <div className="w-full">
                      <input
                        type="file"
                        ref={revisionInputRef}
                        onChange={handleRevisionFileChange}
                        accept=".pdf"
                        className="hidden"
                      />
                      <Button
                        variant="outline"
                        onClick={handleUploadRevisionClick}
                        className="w-full text-xs"
                      >
                        <RefreshCw className="size-3.5 mr-1" />
                        Subir Nueva Revisión ({activeDoc.status === 'APROBADO' ? 'Incrementar Rev' : 'Corregir'})
                      </Button>
                    </div>
                  )}
                </CardFooter>
              </Card>
            ) : (
              <div className="h-64 flex items-center justify-center border border-dashed rounded-xl p-6 text-center text-muted-foreground bg-card/25">
                Selecciona un documento del listado para revisar su trazabilidad, firmas y FES.
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL SUBIR DOCUMENTO */}
      <Modal open={uploadOpen} onOpenChange={setUploadOpen}>
        <ModalContent className="max-w-md">
          <form onSubmit={handleCreateDocument}>
            <ModalHeader>
              <ModalTitle>Subir Documento Técnico</ModalTitle>
              <ModalDescription>
                Ingresa los datos. El código correlativo se auto-generará.
              </ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-4 py-4">
              {formError && (
                <div className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive font-medium">
                  {formError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-name">Nombre del Documento</Label>
                <Input
                  id="doc-name"
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="Ej. Informe de Prospección Geofísica"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-proj">Proyecto</Label>
                  <select
                    id="doc-proj"
                    required
                    value={docProjId}
                    onChange={(e) => {
                      setDocProjId(e.target.value);
                      setDocSrvId(''); // Reset service
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Selecciona proyecto</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-srv">Servicio</Label>
                  <select
                    id="doc-srv"
                    required
                    value={docSrvId}
                    disabled={!docProjId}
                    onChange={(e) => setDocSrvId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <option value="">Selecciona servicio</option>
                    {projectServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-type">Tipo de Documento</Label>
                  <select
                    id="doc-type"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="INF">Informe (INF)</option>
                    <option value="PLN">Plano (PLN)</option>
                    <option value="PRC">Procedimiento (PRC)</option>
                    <option value="EST">Estudio (EST)</option>
                    <option value="REP">Reporte (REP)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-area">Código de Área</Label>
                  <select
                    id="doc-area"
                    value={docArea}
                    onChange={(e) => setDocArea(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="NT">Geotecnia / No Destructivo (NT)</option>
                    <option value="CIV">Obras Civiles (CIV)</option>
                    <option value="MEC">Mecánica (MEC)</option>
                    <option value="MIN">Minería (MIN)</option>
                    <option value="INS">Instrumentación (INS)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-file">Archivo PDF</Label>
                <input
                  id="doc-file"
                  type="file"
                  required
                  accept=".pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs file:border-0 file:bg-transparent file:text-sm file:font-medium text-muted-foreground outline-none"
                />
              </div>
            </div>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setUploadOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isUploading}>
                {isUploading ? 'Subiendo...' : 'Subir y Registrar'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* MODAL RECHAZAR DOCUMENTO */}
      <Modal open={rejectOpen} onOpenChange={(open) => { if (!open) handleCloseRejectModal(); }}>
        <ModalContent className="max-w-sm">
          <form onSubmit={handleReject}>
            <ModalHeader>
              <ModalTitle>Rechazar Documento</ModalTitle>
              <ModalDescription>
                Por favor indica el motivo del rechazo para informar al autor.
              </ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reject-reason">Motivo del Rechazo</Label>
                <textarea
                  id="reject-reason"
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Detalla qué correcciones son necesarias..."
                />
              </div>
            </div>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={handleCloseRejectModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={isRejecting}>
                {isRejecting ? 'Procesando...' : 'Rechazar Documento'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}
