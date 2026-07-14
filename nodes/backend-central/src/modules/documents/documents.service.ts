import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import type { PersonalDocument, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationService } from '../gamification/gamification.service';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { tableOrderBy, tablePage, tableSkipTake } from '../../common/table-pagination.util';
import type { CreatePersonalDocumentDto } from './dto/documents.dto';
import type { PersonalDocumentView } from './documents.types';

/** Carpeta lógica del storage para documentos personales (§6-1.5). */
const DOCUMENTS_FOLDER = 'documents';

/** Tipo de notificación que recibe el dueño al revisarse su documento (§6-2.2). */
const NOTIFICATION_TYPE_DOCUMENT_REVIEWED = 'document.reviewed';

/** Enlace destino de la notificación de revisión (ruta del front). */
const DOCUMENTS_LINK = '/perfil/documentos';

/** Umbral de "por vencer": <= 30 días (§6-1.5). */
const EXPIRING_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Archivo subido (multipart) ya validado por el controller. */
export interface UploadedDocumentFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/** Filtros de listado (ya parseados desde el query). */
export interface ListDocumentsFilters {
  status?: DocumentStatus;
  /** Solo documentos que vencen en <= 30 días (excluye ya vencidos y sin vencimiento). */
  expiring?: boolean;
}

/**
 * Documentos personales del usuario autenticado (§6-1.5 "Mis documentos").
 *
 * Versionado vía la primitiva `ApprovalWorkflow`: un upload nuevo entra
 * PENDIENTE (`EN_REVISION`); subir una nueva versión conserva el archivo previo
 * en `previousFileUrl`, repone el estado a `EN_REVISION` y limpia el revisor.
 *
 * Seguridad: el `userId` SIEMPRE llega del controller (sesión), nunca del body.
 * "Solo el dueño" (listar/subir/versionar/borrar) es lógica de service: se filtra
 * por `userId`. La REVISIÓN (approve/reject) la autoriza OpenFGA en el controller
 * vía `@RequirePermission('can_review_documents', organization:gmt)`; por eso el
 * dueño normal no aprueba sus propios documentos.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly gamification: GamificationService,
  ) {}

  /**
   * Lista los documentos propios con filtros opcionales. Orden: por vencimiento
   * ascendente (los que vencen antes primero; los sin vencimiento al final),
   * desempate por creación descendente.
   */
  async listMine(userId: string, filters: ListDocumentsFilters): Promise<PersonalDocumentView[]> {
    const where: Prisma.PersonalDocumentWhereInput = { userId };
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.expiring === true) {
      const now = new Date();
      where.expiresAt = { gte: now, lte: this.addDays(now, EXPIRING_WINDOW_DAYS) };
    }

    const rows = await this.prisma.personalDocument.findMany({
      where,
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Lista TODOS los documentos de un trabajador para la pestaña Documentos del
   * detalle de usuario (admin). Mismo orden que `listMine`. El control de acceso
   * (`can_manage_users`) lo aplica el controller; la aprobación/rechazo sigue en
   * los endpoints de revisión (`:id/approve|reject`).
   */
  async listForUser(userId: string): Promise<PersonalDocumentView[]> {
    const rows = await this.prisma.personalDocument.findMany({
      where: { userId },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Lista los documentos propios con el MOTOR de tablas server-side (offset). Mismo
   * filtrado (userId + estado + por-vencer) que `listMine`, pero devuelve una página
   * numerada + total con orden configurable (documento/tipo/estado/vencimiento/creado,
   * default vencimiento asc con los sin fecha al final). Lo consume la tabla de
   * "Mis documentos".
   */
  async listMineTable(
    userId: string,
    filters: ListDocumentsFilters,
    req: TableRequest,
  ): Promise<TablePage<PersonalDocumentView>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);

    const where: Prisma.PersonalDocumentWhereInput = { userId };
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.expiring === true) {
      const now = new Date();
      where.expiresAt = { gte: now, lte: this.addDays(now, EXPIRING_WINDOW_DAYS) };
    }

    const orderBy = tableOrderBy<Prisma.PersonalDocumentOrderByWithRelationInput[]>(
      req,
      {
        documento: (dir) => [{ name: dir }, { id: 'desc' }],
        tipo: (dir) => [{ type: dir }, { id: 'desc' }],
        estado: (dir) => [{ status: dir }, { id: 'desc' }],
        vencimiento: (dir) => [{ expiresAt: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
        creado: (dir) => [{ createdAt: dir }, { id: 'desc' }],
      },
      [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.personalDocument.findMany({ where, orderBy, skip, take }),
      this.prisma.personalDocument.count({ where }),
    ]);

    return tablePage(rows.map((row) => this.toView(row)), total, page, pageSize);
  }

  /**
   * Crea un documento personal. Sube el archivo al storage (carpeta documents) y
   * deja el registro en `EN_REVISION` (PENDIENTE — DoD §6-1.5).
   */
  async create(
    userId: string,
    dto: CreatePersonalDocumentDto,
    file: UploadedDocumentFile,
  ): Promise<PersonalDocumentView> {
    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: DOCUMENTS_FOLDER,
    });

    const row = await this.prisma.personalDocument.create({
      data: {
        userId,
        type: dto.type,
        name: dto.name,
        fileUrl: saved.url,
        issuedAt: parseOptionalDate(dto.issuedAt),
        expiresAt: parseOptionalDate(dto.expiresAt),
        status: DocumentStatus.EN_REVISION,
      },
    });

    // Gamificación: otorgar puntos por subir documento (best-effort)
    void this.gamification.awardPoints(userId, 'UPLOAD_DOC');

    return this.toView(row);
  }

  /**
   * Sube una nueva VERSIÓN del documento (solo el dueño). Conserva el `fileUrl`
   * actual en `previousFileUrl`, fija el nuevo `fileUrl`, repone `EN_REVISION` y
   * limpia el revisor (`reviewedBy`/`reviewedAt`) — patrón ApprovalWorkflow.
   */
  async addVersion(
    userId: string,
    id: string,
    file: UploadedDocumentFile,
  ): Promise<PersonalDocumentView> {
    const current = await this.findOwned(userId, id);

    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: DOCUMENTS_FOLDER,
    });

    const row = await this.prisma.personalDocument.update({
      where: { id },
      data: {
        previousFileUrl: current.fileUrl,
        fileUrl: saved.url,
        status: DocumentStatus.EN_REVISION,
        reviewedById: null,
        reviewedAt: null,
      },
    });
    return this.toView(row);
  }

  /**
   * Borra un documento propio (solo el dueño) y, best-effort, su archivo (y la
   * versión anterior) en el storage. Un fallo de borrado de archivo no aborta
   * el borrado del registro.
   */
  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.findOwned(userId, id);
    await this.prisma.personalDocument.delete({ where: { id } });
    await this.bestEffortDelete(doc.fileUrl);
    await this.bestEffortDelete(doc.previousFileUrl);
  }

  /**
   * Aprueba un documento (revisor con permiso FGA — gating en el controller).
   * Fija `APROBADO` + `reviewedBy`/`reviewedAt`. 404 si el documento no existe.
   */
  async approve(reviewerId: string, id: string): Promise<PersonalDocumentView> {
    return this.review(id, DocumentStatus.APROBADO, reviewerId);
  }

  /**
   * Rechaza un documento (revisor con permiso FGA — gating en el controller).
   * Fija `RECHAZADO` + `reviewedBy`/`reviewedAt`. El `reason` no se persiste (el
   * schema no tiene campo, MVP): se registra en log si viene.
   */
  async reject(reviewerId: string, id: string, reason?: string): Promise<PersonalDocumentView> {
    if (reason) {
      this.logger.log(`Documento ${id} rechazado por ${reviewerId}. Motivo: ${reason}`);
    }
    return this.review(id, DocumentStatus.RECHAZADO, reviewerId);
  }

  // ============ Helpers ============

  /**
   * Aplica el resultado de revisión (estado + revisor) y notifica al DUEÑO del
   * documento (§6-2.2 "llega"): tipo `document.reviewed`, título según el
   * resultado, link a "Mis documentos". 404 si el documento no existe. No
   * notifica si el dueño es quien revisa (no debería ocurrir: el dueño no tiene
   * permiso de revisión).
   */
  private async review(
    id: string,
    status: DocumentStatus,
    reviewerId: string,
  ): Promise<PersonalDocumentView> {
    let row: PersonalDocument;
    try {
      row = await this.prisma.personalDocument.update({
        where: { id },
        data: { status, reviewedById: reviewerId, reviewedAt: new Date() },
      });
    } catch (error: unknown) {
      if (isRecordNotFound(error)) {
        throw new NotFoundException('El documento no existe.');
      }
      throw error;
    }

    await this.notifyOwnerReviewed(row, status, reviewerId);
    return this.toView(row);
  }

  /** Crea la notificación de revisión para el dueño (salvo que él mismo revise). */
  private async notifyOwnerReviewed(
    doc: PersonalDocument,
    status: DocumentStatus,
    reviewerId: string,
  ): Promise<void> {
    if (doc.userId === reviewerId) {
      return;
    }
    const approved = status === DocumentStatus.APROBADO;
    await this.notifications.create(doc.userId, {
      type: NOTIFICATION_TYPE_DOCUMENT_REVIEWED,
      title: approved
        ? `Tu documento "${doc.name}" fue aprobado`
        : `Tu documento "${doc.name}" fue rechazado`,
      link: DOCUMENTS_LINK,
    });
  }

  /** Documento del propio usuario o 404 (no distingue inexistente de ajeno). */
  private async findOwned(userId: string, id: string): Promise<PersonalDocument> {
    const doc = await this.prisma.personalDocument.findFirst({ where: { id, userId } });
    if (!doc) {
      throw new NotFoundException('El documento no existe o no te pertenece.');
    }
    return doc;
  }

  /**
   * Borra del storage un archivo dado su URL (best-effort). Convierte la URL
   * pública a la `key` del storage (todo lo que sigue a `/files/`). Si la URL no
   * corresponde a este storage o el borrado falla, solo se registra.
   */
  private async bestEffortDelete(fileUrl: string | null): Promise<void> {
    if (!fileUrl) {
      return;
    }
    const key = extractStorageKey(fileUrl);
    if (key === null) {
      return;
    }
    try {
      await this.storage.delete(key);
    } catch (error: unknown) {
      this.logger.warn(`No se pudo borrar el archivo "${key}" del storage: ${String(error)}`);
    }
  }

  /** Fecha + N días (copia; no muta el original). */
  private addDays(from: Date, days: number): Date {
    return new Date(from.getTime() + days * MS_PER_DAY);
  }

  /** Mapea la fila Prisma a la vista pública, derivando el estado de vencimiento. */
  private toView(row: PersonalDocument): PersonalDocumentView {
    const { expiringSoon, daysToExpire } = this.expiry(row.expiresAt);
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      fileUrl: row.fileUrl,
      previousFileUrl: row.previousFileUrl,
      issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      status: row.status,
      reviewedById: row.reviewedById,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      expiringSoon,
      daysToExpire,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Deriva `expiringSoon` (vence en <= 30 días, aún no vencido) y `daysToExpire`. */
  private expiry(expiresAt: Date | null): { expiringSoon: boolean; daysToExpire: number | null } {
    if (!expiresAt) {
      return { expiringSoon: false, daysToExpire: null };
    }
    const days = Math.ceil((expiresAt.getTime() - Date.now()) / MS_PER_DAY);
    return { expiringSoon: days >= 0 && days <= EXPIRING_WINDOW_DAYS, daysToExpire: days };
  }
}

/** Convierte un string ISO opcional a Date | null. '' / null / undefined → null. */
function parseOptionalDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Fecha inválida.');
  }
  return date;
}

/**
 * Extrae la `key` del storage desde una URL pública (`.../files/<key>`).
 * Devuelve null si la URL no contiene el prefijo `/files/` (no es de este
 * storage, p. ej. una URL firmada de R2 en el futuro).
 */
function extractStorageKey(fileUrl: string): string | null {
  const marker = '/files/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  const key = fileUrl.slice(idx + marker.length);
  return key.length > 0 ? decodeURIComponent(key) : null;
}

/** ¿El error es "registro no encontrado" de Prisma (P2025)? */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  );
}
