/**
 * Tipos del frontend para "Mi CV" (§6-1.4). Reflejan el contrato HTTP de la API
 * (`/cv/me`). Las fechas viajan como string ISO; los campos opcionales como
 * `string | null`. No hay dependencia con `@gmt-platform/contracts` porque estos
 * contratos son específicos del frontend de esta etapa.
 */

/** Experiencia laboral del CV. `startDate`/`endDate` en ISO; `endDate` null = actual. */
export interface CvExperienceView {
  id: string;
  role: string;
  company: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
}

/** Formación académica del CV. */
export interface CvEducationView {
  id: string;
  institution: string;
  degree: string;
  startDate: string | null;
  endDate: string | null;
}

/** Certificación del CV. Puede tener un diploma PDF (`fileUrl`). */
export interface CvCertificationView {
  id: string;
  name: string;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  fileUrl: string | null;
}

/** Vista completa del CV propio (se crea vacío de forma perezosa en el backend). */
export interface CvView {
  id: string;
  summary: string | null;
  experiences: CvExperienceView[];
  education: CvEducationView[];
  certifications: CvCertificationView[];
}

/** Cuerpo para crear/editar una experiencia (`startDate` obligatorio). */
export interface CvExperienceInput {
  role: string;
  company: string;
  startDate: string;
  endDate?: string;
  description?: string;
}

/** Cuerpo para crear/editar una formación académica. */
export interface CvEducationInput {
  institution: string;
  degree: string;
  startDate?: string;
  endDate?: string;
}

/** Cuerpo para crear/editar una certificación. */
export interface CvCertificationInput {
  name: string;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
}
