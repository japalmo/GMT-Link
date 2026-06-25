/**
 * Formas de respuesta del módulo CV (§6-1.4 "Mi CV").
 * Las fechas se serializan como ISO-8601 (string) para el frontend; el service
 * convierte los `Date`/`null` de Prisma a estas formas.
 */

/** Una experiencia laboral del CV. */
export interface CvExperienceView {
  id: string;
  role: string;
  company: string;
  /** ISO-8601. */
  startDate: string;
  /** ISO-8601 o null (cargo actual). */
  endDate: string | null;
  description: string | null;
}

/** Un ítem de educación del CV. */
export interface CvEducationView {
  id: string;
  institution: string;
  degree: string;
  /** ISO-8601 o null. */
  startDate: string | null;
  /** ISO-8601 o null. */
  endDate: string | null;
}

/** Una certificación del CV (con diploma PDF opcional). */
export interface CvCertificationView {
  id: string;
  name: string;
  issuer: string | null;
  /** ISO-8601 o null. */
  issuedAt: string | null;
  /** ISO-8601 o null. */
  expiresAt: string | null;
  /** URL del diploma PDF en el storage (o null si no se subió). */
  fileUrl: string | null;
}

/** CV propio completo con sus tres arrays. */
export interface CvView {
  id: string;
  summary: string | null;
  experiences: CvExperienceView[];
  education: CvEducationView[];
  certifications: CvCertificationView[];
}
