import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CVCertification,
  CVEducation,
  CVExperience,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { GamificationService } from '../gamification/gamification.service';
import type {
  CreateCertificationDto,
  CreateEducationDto,
  CreateExperienceDto,
  UpdateCertificationDto,
  UpdateCvDto,
  UpdateEducationDto,
  UpdateExperienceDto,
} from './dto/cv.dto';
import type {
  CvCertificationView,
  CvEducationView,
  CvExperienceView,
  CvView,
} from './cv.types';

/** CV con sus tres arrays — forma común de las consultas de este servicio. */
type CvWithArrays = Prisma.CVGetPayload<{
  include: { experiences: true; education: true; certifications: true };
}>;

/** Carpeta lógica del storage para los diplomas PDF (§6-1.4). */
const DIPLOMAS_FOLDER = 'diplomas';

/**
 * CV propio del usuario autenticado (§6-1.4 "Mi CV").
 *
 * Regla de seguridad transversal: el `userId` SIEMPRE llega del controller
 * (derivado de `request.authUser`), NUNCA del body ni de ids de ruta. Toda
 * operación sobre filas hijas (experiencia/educación/certificación) verifica que
 * la fila pertenezca al CV del propio usuario; si no, 404 (no se distingue
 * "no existe" de "es de otro" para no filtrar existencia).
 */
@Injectable()
export class CvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gamification: GamificationService,
  ) {}

  /** CV propio con sus arrays. Crea uno vacío (lazy) si aún no existe. */
  async getMe(userId: string): Promise<CvView> {
    const cv = await this.ensureCv(userId);
    return this.toView(cv);
  }

  /** Actualiza el resumen del CV propio. '' → null (limpiar). */
  async updateMe(userId: string, dto: UpdateCvDto): Promise<CvView> {
    const cv = await this.ensureCv(userId);
    if (dto.summary !== undefined) {
      await this.prisma.cV.update({
        where: { id: cv.id },
        data: { summary: dto.summary === '' ? null : dto.summary },
      });
      // Gamificación: otorgar puntos por completar CV (best-effort, idempotente por PointsLog)
      void this.gamification.awardPoints(userId, 'COMPLETE_CV');
    }
    return this.getMe(userId);
  }

  // ============ Experiencia ============

  async addExperience(userId: string, dto: CreateExperienceDto): Promise<CvExperienceView> {
    const cv = await this.ensureCv(userId);
    const row = await this.prisma.cVExperience.create({
      data: {
        cvId: cv.id,
        role: dto.role,
        company: dto.company,
        startDate: parseDate(dto.startDate),
        endDate: parseOptionalDate(dto.endDate),
        description: normalizeOptional(dto.description),
      },
    });
    return this.toExperienceView(row);
  }

  async updateExperience(
    userId: string,
    id: string,
    dto: UpdateExperienceDto,
  ): Promise<CvExperienceView> {
    const cv = await this.ensureCv(userId);
    await this.assertExperienceOwned(cv.id, id);
    const data: Prisma.CVExperienceUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.company !== undefined) data.company = dto.company;
    if (dto.startDate !== undefined) data.startDate = parseDate(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = parseOptionalDate(dto.endDate);
    if (dto.description !== undefined) data.description = normalizeOptional(dto.description);
    const row = await this.prisma.cVExperience.update({ where: { id }, data });
    return this.toExperienceView(row);
  }

  async deleteExperience(userId: string, id: string): Promise<void> {
    const cv = await this.ensureCv(userId);
    await this.assertExperienceOwned(cv.id, id);
    await this.prisma.cVExperience.delete({ where: { id } });
  }

  // ============ Educación ============

  async addEducation(userId: string, dto: CreateEducationDto): Promise<CvEducationView> {
    const cv = await this.ensureCv(userId);
    const row = await this.prisma.cVEducation.create({
      data: {
        cvId: cv.id,
        institution: dto.institution,
        degree: dto.degree,
        startDate: parseOptionalDate(dto.startDate),
        endDate: parseOptionalDate(dto.endDate),
      },
    });
    return this.toEducationView(row);
  }

  async updateEducation(
    userId: string,
    id: string,
    dto: UpdateEducationDto,
  ): Promise<CvEducationView> {
    const cv = await this.ensureCv(userId);
    await this.assertEducationOwned(cv.id, id);
    const data: Prisma.CVEducationUpdateInput = {};
    if (dto.institution !== undefined) data.institution = dto.institution;
    if (dto.degree !== undefined) data.degree = dto.degree;
    if (dto.startDate !== undefined) data.startDate = parseOptionalDate(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = parseOptionalDate(dto.endDate);
    const row = await this.prisma.cVEducation.update({ where: { id }, data });
    return this.toEducationView(row);
  }

  async deleteEducation(userId: string, id: string): Promise<void> {
    const cv = await this.ensureCv(userId);
    await this.assertEducationOwned(cv.id, id);
    await this.prisma.cVEducation.delete({ where: { id } });
  }

  // ============ Certificación ============

  async addCertification(
    userId: string,
    dto: CreateCertificationDto,
  ): Promise<CvCertificationView> {
    const cv = await this.ensureCv(userId);
    const row = await this.prisma.cVCertification.create({
      data: {
        cvId: cv.id,
        name: dto.name,
        issuer: normalizeOptional(dto.issuer),
        issuedAt: parseOptionalDate(dto.issuedAt),
        expiresAt: parseOptionalDate(dto.expiresAt),
      },
    });
    return this.toCertificationView(row);
  }

  async updateCertification(
    userId: string,
    id: string,
    dto: UpdateCertificationDto,
  ): Promise<CvCertificationView> {
    const cv = await this.ensureCv(userId);
    await this.assertCertificationOwned(cv.id, id);
    const data: Prisma.CVCertificationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.issuer !== undefined) data.issuer = normalizeOptional(dto.issuer);
    if (dto.issuedAt !== undefined) data.issuedAt = parseOptionalDate(dto.issuedAt);
    if (dto.expiresAt !== undefined) data.expiresAt = parseOptionalDate(dto.expiresAt);
    const row = await this.prisma.cVCertification.update({ where: { id }, data });
    return this.toCertificationView(row);
  }

  async deleteCertification(userId: string, id: string): Promise<void> {
    const cv = await this.ensureCv(userId);
    await this.assertCertificationOwned(cv.id, id);
    await this.prisma.cVCertification.delete({ where: { id } });
  }

  /**
   * Sube el diploma PDF de una certificación propia (§6-1.4). El controller ya
   * validó mimetype (solo application/pdf) y presencia del archivo; aquí se
   * verifica la propiedad, se persiste en el storage (carpeta diplomas) y se
   * guarda la `fileUrl` en la certificación.
   */
  async setCertificationDiploma(
    userId: string,
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<CvCertificationView> {
    const cv = await this.ensureCv(userId);
    await this.assertCertificationOwned(cv.id, id);

    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: DIPLOMAS_FOLDER,
    });

    const row = await this.prisma.cVCertification.update({
      where: { id },
      data: { fileUrl: saved.url },
    });
    return this.toCertificationView(row);
  }

  // ============ Helpers de propiedad / lazy CV ============

  /** Obtiene el CV propio con arrays; lo crea vacío si no existe (lazy). */
  private async ensureCv(userId: string): Promise<CvWithArrays> {
    const existing = await this.prisma.cV.findUnique({
      where: { userId },
      include: { experiences: true, education: true, certifications: true },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.cV.create({
      data: { userId },
      include: { experiences: true, education: true, certifications: true },
    });
  }

  /** 404 si la experiencia no pertenece al CV del usuario (o no existe). */
  private async assertExperienceOwned(cvId: string, id: string): Promise<void> {
    const found = await this.prisma.cVExperience.findFirst({
      where: { id, cvId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('La experiencia no existe o no pertenece a tu CV.');
    }
  }

  /** 404 si la educación no pertenece al CV del usuario (o no existe). */
  private async assertEducationOwned(cvId: string, id: string): Promise<void> {
    const found = await this.prisma.cVEducation.findFirst({
      where: { id, cvId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('El ítem de educación no existe o no pertenece a tu CV.');
    }
  }

  /** 404 si la certificación no pertenece al CV del usuario (o no existe). */
  private async assertCertificationOwned(cvId: string, id: string): Promise<void> {
    const found = await this.prisma.cVCertification.findFirst({
      where: { id, cvId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('La certificación no existe o no pertenece a tu CV.');
    }
  }

  // ============ Mapeo a vistas ============

  private toView(cv: CvWithArrays): CvView {
    return {
      id: cv.id,
      summary: cv.summary,
      experiences: cv.experiences.map((e) => this.toExperienceView(e)),
      education: cv.education.map((e) => this.toEducationView(e)),
      certifications: cv.certifications.map((c) => this.toCertificationView(c)),
    };
  }

  private toExperienceView(e: CVExperience): CvExperienceView {
    return {
      id: e.id,
      role: e.role,
      company: e.company,
      startDate: e.startDate.toISOString(),
      endDate: e.endDate ? e.endDate.toISOString() : null,
      description: e.description,
    };
  }

  private toEducationView(e: CVEducation): CvEducationView {
    return {
      id: e.id,
      institution: e.institution,
      degree: e.degree,
      startDate: e.startDate ? e.startDate.toISOString() : null,
      endDate: e.endDate ? e.endDate.toISOString() : null,
    };
  }

  private toCertificationView(c: CVCertification): CvCertificationView {
    return {
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      issuedAt: c.issuedAt ? c.issuedAt.toISOString() : null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      fileUrl: c.fileUrl,
    };
  }
}

/** Convierte un string ISO requerido a Date; 400 si es inválido (defensivo). */
function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Fecha inválida.');
  }
  return date;
}

/** Convierte un string ISO opcional a Date | null. '' / null / undefined → null. */
function parseOptionalDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return parseDate(value);
}

/** Normaliza un opcional string: '' o undefined → null; resto → tal cual. */
function normalizeOptional(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}
