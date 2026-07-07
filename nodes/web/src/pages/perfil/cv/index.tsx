import { useState, type ReactNode } from 'react';
import { ExternalLink, FileCheck2 } from 'lucide-react';
import { ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { useCv } from '@/hooks/use-cv';
import { formatDate, formatDateRange } from '@/lib/format';
import type {
  CvCertificationView,
  CvEducationView,
  CvExperienceView,
} from '@/types/cv';
import { ProfileTabs } from '../profile-tabs';
import { ConfirmDialog } from '../confirm-dialog';
import { CvSection } from './cv-section';
import { CvItemRow } from './cv-item-row';
import { SummaryCard } from './summary-card';
import { ExperienceDialog } from './experience-dialog';
import { EducationDialog } from './education-dialog';
import { CertificationDialog } from './certification-dialog';

/** Skeleton de carga del CV con la forma de las tarjetas. */
function CvSkeleton(): ReactNode {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      <div className="h-44 rounded-lg border border-border bg-muted/40" />
      <div className="h-52 rounded-lg border border-border bg-muted/40" />
      <div className="h-52 rounded-lg border border-border bg-muted/40" />
    </div>
  );
}

/**
 * Página "Mi CV" (§6-1.4).
 *
 * Compone el hook `useCv` con: edición del resumen y tres secciones
 * (Experiencia, Educación, Certificaciones), cada una con lista + agregar /
 * editar / eliminar vía Modal. En Certificaciones se adjunta el diploma PDF
 * (validado en cliente) y se muestra el enlace al `fileUrl` cuando existe.
 * Estados vacío / carga / error siempre presentes. Mobile-first.
 */
export default function CvPage(): ReactNode {
  const cv = useCv();

  // Estado de los modales (item en edición; `null` mientras está cerrado).
  const [expDialogOpen, setExpDialogOpen] = useState(false);
  const [expEditing, setExpEditing] = useState<CvExperienceView | null>(null);
  const [eduDialogOpen, setEduDialogOpen] = useState(false);
  const [eduEditing, setEduEditing] = useState<CvEducationView | null>(null);
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [certEditing, setCertEditing] = useState<CvCertificationView | null>(null);

  // Confirmación de borrado: guarda el tipo + id a eliminar.
  const [toDelete, setToDelete] = useState<
    | { kind: 'experience'; id: string; label: string }
    | { kind: 'education'; id: string; label: string }
    | { kind: 'certification'; id: string; label: string }
    | null
  >(null);

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    if (toDelete.kind === 'experience') await cv.deleteExperience(toDelete.id);
    else if (toDelete.kind === 'education') await cv.deleteEducation(toDelete.id);
    else await cv.deleteCertification(toDelete.id);
  }

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-4">
        <PageHeader
          title="Mi CV"
          description="Tu trayectoria, formación y certificaciones."
        />
        <ProfileTabs />
      </header>

      {cv.loading && <CvSkeleton />}

      {!cv.loading && cv.error && (
        <ErrorState message={cv.error} onRetry={() => void cv.refetch()} />
      )}

      {!cv.loading && !cv.error && cv.cv && (
        <>
          <SummaryCard summary={cv.cv.summary} onSave={cv.saveSummary} />

          {/* Experiencia */}
          <CvSection
            title="Experiencia laboral"
            description="Cargos y empresas donde has trabajado."
            isEmpty={cv.cv.experiences.length === 0}
            emptyMessage="Aún no agregas experiencia laboral."
            addLabel="Agregar experiencia"
            onAdd={() => {
              setExpEditing(null);
              setExpDialogOpen(true);
            }}
          >
            <div className="divide-y divide-border">
              {cv.cv.experiences.map((exp) => (
                <CvItemRow
                  key={exp.id}
                  title={exp.role}
                  subtitle={exp.company}
                  meta={formatDateRange(exp.startDate, exp.endDate)}
                  extra={
                    exp.description ? (
                      <p className="mt-1 text-sm text-foreground">{exp.description}</p>
                    ) : undefined
                  }
                  editLabel={`Editar ${exp.role}`}
                  deleteLabel={`Eliminar ${exp.role}`}
                  onEdit={() => {
                    setExpEditing(exp);
                    setExpDialogOpen(true);
                  }}
                  onDelete={() =>
                    setToDelete({
                      kind: 'experience',
                      id: exp.id,
                      label: `${exp.role} en ${exp.company}`,
                    })
                  }
                />
              ))}
            </div>
          </CvSection>

          {/* Educación */}
          <CvSection
            title="Educación"
            description="Tu formación académica."
            isEmpty={cv.cv.education.length === 0}
            emptyMessage="Aún no agregas formación académica."
            addLabel="Agregar formación"
            onAdd={() => {
              setEduEditing(null);
              setEduDialogOpen(true);
            }}
          >
            <div className="divide-y divide-border">
              {cv.cv.education.map((edu) => (
                <CvItemRow
                  key={edu.id}
                  title={edu.degree}
                  subtitle={edu.institution}
                  meta={formatDateRange(edu.startDate, edu.endDate, '')}
                  editLabel={`Editar ${edu.degree}`}
                  deleteLabel={`Eliminar ${edu.degree}`}
                  onEdit={() => {
                    setEduEditing(edu);
                    setEduDialogOpen(true);
                  }}
                  onDelete={() =>
                    setToDelete({
                      kind: 'education',
                      id: edu.id,
                      label: `${edu.degree} (${edu.institution})`,
                    })
                  }
                />
              ))}
            </div>
          </CvSection>

          {/* Certificaciones */}
          <CvSection
            title="Certificaciones"
            description="Cursos y certificaciones, con su diploma en PDF."
            isEmpty={cv.cv.certifications.length === 0}
            emptyMessage="Aún no agregas certificaciones."
            addLabel="Agregar certificación"
            onAdd={() => {
              setCertEditing(null);
              setCertDialogOpen(true);
            }}
          >
            <div className="divide-y divide-border">
              {cv.cv.certifications.map((cert) => (
                <CvItemRow
                  key={cert.id}
                  title={cert.name}
                  subtitle={cert.issuer}
                  meta={
                    cert.issuedAt || cert.expiresAt
                      ? [
                          cert.issuedAt ? `Emitida ${formatDate(cert.issuedAt)}` : null,
                          cert.expiresAt ? `vence ${formatDate(cert.expiresAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : null
                  }
                  extra={
                    cert.fileUrl ? (
                      <a
                        href={cert.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                      >
                        <FileCheck2 className="size-4" aria-hidden />
                        Ver diploma (PDF)
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : (
                      <span className="mt-1 text-xs text-muted-foreground">
                        Sin diploma adjunto
                      </span>
                    )
                  }
                  editLabel={`Editar ${cert.name}`}
                  deleteLabel={`Eliminar ${cert.name}`}
                  onEdit={() => {
                    setCertEditing(cert);
                    setCertDialogOpen(true);
                  }}
                  onDelete={() =>
                    setToDelete({
                      kind: 'certification',
                      id: cert.id,
                      label: cert.name,
                    })
                  }
                />
              ))}
            </div>
          </CvSection>

          {/* Modales */}
          <ExperienceDialog
            open={expDialogOpen}
            onOpenChange={setExpDialogOpen}
            experience={expEditing}
            onSubmit={(input) =>
              expEditing
                ? cv.updateExperience(expEditing.id, input)
                : cv.addExperience(input)
            }
          />

          <EducationDialog
            open={eduDialogOpen}
            onOpenChange={setEduDialogOpen}
            education={eduEditing}
            onSubmit={(input) =>
              eduEditing
                ? cv.updateEducation(eduEditing.id, input)
                : cv.addEducation(input)
            }
          />

          <CertificationDialog
            open={certDialogOpen}
            onOpenChange={setCertDialogOpen}
            certification={certEditing}
            onSubmit={(input) =>
              certEditing
                ? cv.updateCertification(certEditing.id, input)
                : cv.addCertification(input)
            }
            onUploadDiploma={cv.uploadDiploma}
          />

          <ConfirmDialog
            open={toDelete !== null}
            onOpenChange={(next) => (next ? undefined : setToDelete(null))}
            title="Eliminar del CV"
            description={
              <>
                ¿Seguro que quieres eliminar{' '}
                <span className="font-medium text-foreground">{toDelete?.label}</span>?
                Esta acción no se puede deshacer.
              </>
            }
            onConfirm={confirmDelete}
          />
        </>
      )}
    </div>
  );
}
