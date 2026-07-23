import { useState, type ReactNode, useMemo } from 'react';
import { toast } from 'sonner';
import { useProjects, useProjectDocuments } from '@/hooks/use-operations';
import { useProfile } from '@/hooks/use-profile';
import {
  Plus,
  FileText,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { SearchInput } from '@/components/ui/search-input';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '@/components/ui/modal';
import { errorToMessage } from '@/lib/api';
import {
  DOC_STATUS_META,
  formatRevision,
  ProjectDocumentDetailCard,
} from '@/components/documents/project-document-detail-card';

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

  const handleUploadRevision = async (file: File) => {
    if (!activeDoc) return;
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

  const handleReject = async (reason: string): Promise<void> => {
    if (!activeDoc) return;
    try {
      await reject(activeDoc.id, reason);
      toast.success('Documento rechazado.');
    } catch (err) {
      throw new Error(errorToMessage(err, 'Error al rechazar el documento.'));
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
            <Select
              id="filter-doc-proj"
              aria-label="Filtrar documentos por proyecto"
              value={filterProject}
              onChange={(e) => {
                setFilterProject(e.target.value);
                setFilterService('all');
              }}
            >
              <option value="all">Todos los proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-doc-srv" className="text-xs">Servicio</Label>
            <Select
              id="filter-doc-srv"
              aria-label="Filtrar documentos por servicio"
              value={filterService}
              disabled={filterProject === 'all'}
              onChange={(e) => setFilterService(e.target.value)}
            >
              <option value="all">Todos los servicios</option>
              {filterProjectServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search-doc" className="text-xs">Buscar Código o Nombre</Label>
            <SearchInput
              id="search-doc"
              label="Buscar documento por código o nombre"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ej. GMT-ALS-GEO-MAP-001..."
            />
          </div>
        </div>
      </div>

      {/* Grid Principal: Listado y Detalle */}
      {loading ? (
        <LoadingState rows={6} />
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
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => setActiveDocId(doc.id)}
                        className={`flex w-full flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 text-left transition-colors ${
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
                          <Badge variant={DOC_STATUS_META[doc.status].variant}>
                            {DOC_STATUS_META[doc.status].label}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}

                  {filteredDocs.length === 0 && (
                    <EmptyState
                      icon={FolderOpen}
                      title="No se encontraron documentos"
                      message="Modifica los filtros o sube un nuevo documento para ver su flujo de aprobación."
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Panel Lateral: Detalle, Auditoría y Firmas (FES) */}
          <div className="flex flex-col gap-6">
            {activeDoc ? (
              <ProjectDocumentDetailCard
                document={activeDoc}
                canSignQA={Boolean(isQARole)}
                canSignClient={Boolean(isClientRole)}
                onSignQA={() => void handleSignQA()}
                onSignClient={() => void handleSignClient()}
                onRejectRequest={() => setRejectOpen(true)}
                onUploadRevision={handleUploadRevision}
              />
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
                <Alert variant="destructive" live>
                  {formError}
                </Alert>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-proj">Proyecto</Label>
                  <Select
                    id="doc-proj"
                    aria-label="Proyecto del documento"
                    required
                    value={docProjId}
                    onChange={(e) => {
                      setDocProjId(e.target.value);
                      setDocSrvId(''); // Reset service
                    }}
                  >
                    <option value="">Selecciona proyecto</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-srv">Servicio</Label>
                  <Select
                    id="doc-srv"
                    aria-label="Servicio del documento"
                    required
                    value={docSrvId}
                    disabled={!docProjId}
                    onChange={(e) => setDocSrvId(e.target.value)}
                  >
                    <option value="">Selecciona servicio</option>
                    {projectServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-type">Tipo de Documento</Label>
                  <Select
                    id="doc-type"
                    aria-label="Tipo de documento"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                  >
                    <option value="INF">Informe (INF)</option>
                    <option value="PLN">Plano (PLN)</option>
                    <option value="PRC">Procedimiento (PRC)</option>
                    <option value="EST">Estudio (EST)</option>
                    <option value="REP">Reporte (REP)</option>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="doc-area">Código de Área</Label>
                  <Select
                    id="doc-area"
                    aria-label="Código de área del documento"
                    value={docArea}
                    onChange={(e) => setDocArea(e.target.value)}
                  >
                    <option value="NT">Geotecnia / No Destructivo (NT)</option>
                    <option value="CIV">Obras Civiles (CIV)</option>
                    <option value="MEC">Mecánica (MEC)</option>
                    <option value="MIN">Minería (MIN)</option>
                    <option value="INS">Instrumentación (INS)</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-file">Archivo PDF</Label>
                <Input
                  id="doc-file"
                  type="file"
                  required
                  accept=".pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="file:border-0 file:bg-transparent file:text-sm file:font-medium"
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
