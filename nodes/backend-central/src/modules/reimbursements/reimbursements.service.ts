import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FinanceStatus } from '@prisma/client';
import type { Prisma, Reimbursement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextFinanceStatus } from '../finance/finance-status.util';
import type { FinanceTransition } from '../finance/finance-status.util';
import { CreateReimbursementDto, ImportReimbursementsDto } from './dto/reimbursements.dto';
import type { ReimbursementView } from './reimbursements.types';
import { composeReceiptsPdf, sniffReceiptKind } from './reimbursements-pdf.util';
import type { ReceiptForPdf, ReceiptsPerPage } from './reimbursements-pdf.util';

/** Carpeta lógica del storage para boletas de reembolso (§6-3.1). */
const RECEIPTS_FOLDER = 'reimbursements';

/** Tipo de notificación que recibe el solicitante en cada transición (§6-2.2). */
const NOTIFICATION_TYPE = 'reimbursement.decided';

/** Enlace destino de la notificación (ruta del front). */
const REIMBURSEMENTS_LINK = '/finanzas/reembolsos';

/** Selección de datos del solicitante para la vista del gestor. */
const REQUESTER_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

/** Fila con el solicitante incluido (vistas de gestión). */
type ReimbursementWithRequester = Prisma.ReimbursementGetPayload<{
  include: { user: typeof REQUESTER_SELECT };
}>;

/** Archivo subido (multipart) ya validado por el controller. */
export interface UploadedReceiptFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/** Filtros de listado (ya parseados desde el query). */
export interface ListReimbursementsFilters {
  status?: FinanceStatus;
  /** Solo aplica a la vista del gestor (lista global). */
  userId?: string;
}

/**
 * Reembolsos (§6-3.1, primitivas `RoleScopedList` + `RequestForm`).
 *
 * Seguridad: el `userId` SIEMPRE llega del controller (sesión), nunca del body.
 * "Solo el dueño" (crear/listar propios/subir boleta) es lógica de este service
 * (filtra por `userId`). La GESTIÓN (lista global, aprobar/rechazar/pagar) la
 * autoriza OpenFGA en el controller vía
 * `@RequirePermission('can_manage_finance', organization:gmt)` → el guard corta
 * con 403 si el usuario no es gestor. `getById` admite al dueño O a un gestor:
 * como el guard no aplica a esa ruta, la decisión es lógica de service.
 */
@Injectable()
export class ReimbursementsService {
  private readonly logger = new Logger(ReimbursementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crea un reembolso del propio usuario en estado PENDIENTE (RequestForm).
   * `amount` es CLP entero; `date` es la fecha del gasto.
   */
  async create(userId: string, dto: CreateReimbursementDto): Promise<ReimbursementView> {
    const row = await this.prisma.reimbursement.create({
      data: {
        userId,
        amount: dto.amount,
        date: parseDate(dto.date),
        concept: dto.concept,
        category: dto.category ?? null,
        status: FinanceStatus.PENDIENTE,
      },
    });
    return toView(row);
  }

  /**
   * Importa un lote de reembolsos para el propio usuario en estado PENDIENTE.
   */
  async importBatch(userId: string, dto: ImportReimbursementsDto): Promise<ReimbursementView[]> {
    const created = await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.reimbursement.create({
          data: {
            userId,
            amount: item.amount,
            date: parseDate(item.date),
            concept: item.concept,
            category: item.category ?? null,
            status: FinanceStatus.PENDIENTE,
          },
        }),
      ),
    );
    return created.map(toView);
  }

  /**
   * Genera (servidor, §6-3.2) un PDF con las boletas de los reembolsos indicados,
   * en grilla de `perPage` por página. Gating FGA en el controller. Solo incluye
   * los que tienen boleta adjunta y cuyo archivo se puede leer; 400 si ninguno.
   */
  async generateBatchPdf(ids: string[], perPage: ReceiptsPerPage): Promise<Uint8Array> {
    if (ids.length === 0) {
      throw new BadRequestException('Selecciona al menos un reembolso.');
    }
    const rows = await this.prisma.reimbursement.findMany({
      where: { id: { in: ids } },
      include: { user: REQUESTER_SELECT },
      orderBy: { date: 'desc' },
    });

    const receipts: ReceiptForPdf[] = [];
    for (const row of rows) {
      if (!row.receiptUrl) continue;
      const key = extractStorageKey(row.receiptUrl);
      if (!key) continue;
      let bytes: Buffer;
      try {
        bytes = await this.storage.read(key);
      } catch {
        continue; // boleta inaccesible: se omite, no se aborta el lote
      }
      receipts.push({
        concept: row.concept,
        amountLabel: formatClp(row.amount),
        requesterName: `${row.user.firstName} ${row.user.lastName}`,
        dateLabel: row.date.toISOString().slice(0, 10),
        bytes,
        kind: sniffReceiptKind(bytes),
      });
    }

    if (receipts.length === 0) {
      throw new BadRequestException(
        'Ninguno de los reembolsos seleccionados tiene una boleta adjunta legible.',
      );
    }
    return composeReceiptsPdf(receipts, perPage);
  }

  /**
   * Lista los reembolsos propios (orden createdAt desc). Filtro opcional por
   * `status`.
   */
  async listMine(userId: string, status?: FinanceStatus): Promise<ReimbursementView[]> {
    const where: Prisma.ReimbursementWhereInput = { userId };
    if (status !== undefined) {
      where.status = status;
    }
    const rows = await this.prisma.reimbursement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  /**
   * Lista TODOS los reembolsos (vista del gestor — RoleScopedList). El permiso lo
   * verifica el guard en el controller. Filtros opcionales `status` y `userId`.
   * Incluye datos del solicitante (nombre/email).
   */
  async listAll(filters: ListReimbursementsFilters): Promise<ReimbursementView[]> {
    const where: Prisma.ReimbursementWhereInput = {};
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.userId !== undefined) {
      where.userId = filters.userId;
    }
    const rows = await this.prisma.reimbursement.findMany({
      where,
      include: { user: REQUESTER_SELECT },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toViewWithRequester);
  }

  /**
   * Detalle de un reembolso visible para el DUEÑO o para un GESTOR. `isManager`
   * lo resuelve el controller (check FGA `can_manage_finance`); si no es ninguno,
   * 404 (no revela existencia de ajenos). El gestor recibe los datos del
   * solicitante.
   */
  async getById(
    id: string,
    requesterId: string,
    isManager: boolean,
  ): Promise<ReimbursementView> {
    const row = await this.prisma.reimbursement.findUnique({
      where: { id },
      include: { user: REQUESTER_SELECT },
    });
    if (!row || (!isManager && row.userId !== requesterId)) {
      throw new NotFoundException('El reembolso no existe.');
    }
    return isManager ? toViewWithRequester(row) : toView(row);
  }

  /**
   * Sube/actualiza la boleta del reembolso (multipart). SOLO el dueño y SOLO si
   * sigue PENDIENTE (no se edita uno ya resuelto). 404 si no existe o es ajeno;
   * 409 si ya no está PENDIENTE.
   */
  async attachReceipt(
    userId: string,
    id: string,
    file: UploadedReceiptFile,
  ): Promise<ReimbursementView> {
    const current = await this.prisma.reimbursement.findFirst({ where: { id, userId } });
    if (!current) {
      throw new NotFoundException('El reembolso no existe o no te pertenece.');
    }
    if (current.status !== FinanceStatus.PENDIENTE) {
      throw new ConflictException('No se puede editar un reembolso ya resuelto.');
    }

    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: RECEIPTS_FOLDER,
    });

    const row = await this.prisma.reimbursement.update({
      where: { id },
      data: { receiptUrl: saved.url },
    });
    return toView(row);
  }

  /** Aprueba un reembolso (gestor; gating FGA en el controller). PENDIENTE→APROBADO. */
  async approve(managerId: string, id: string): Promise<ReimbursementView> {
    return this.transition(id, 'approve', managerId);
  }

  /**
   * Rechaza un reembolso (gestor). PENDIENTE→RECHAZADO. El `reason` no se persiste
   * en la fila (el schema no tiene campo, MVP): viaja al solicitante en el BODY de
   * la notificación (promesa de la UI) y se registra en log.
   */
  async reject(managerId: string, id: string, reason?: string): Promise<ReimbursementView> {
    if (reason) {
      this.logger.log(`Reembolso ${id} rechazado por ${managerId}. Motivo: ${reason}`);
    }
    return this.transition(id, 'reject', managerId, reason);
  }

  /** Marca pagado un reembolso (gestor). Solo desde APROBADO→PAGADO. */
  async pay(managerId: string, id: string): Promise<ReimbursementView> {
    return this.transition(id, 'pay', managerId);
  }

  // ============ Helpers ============

  /**
   * Aplica una transición de estado validada (máquina común de finanzas):
   * lee el actual (404 si no existe), valida la transición (409 si inválida),
   * persiste estado + decisor (decidedBy/At) y notifica al SOLICITANTE.
   */
  private async transition(
    id: string,
    transition: FinanceTransition,
    managerId: string,
    reason?: string,
  ): Promise<ReimbursementView> {
    const current = await this.prisma.reimbursement.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('El reembolso no existe.');
    }
    const status = nextFinanceStatus(current.status, transition);

    const row = await this.prisma.reimbursement.update({
      where: { id },
      data: { status, decidedById: managerId, decidedAt: new Date() },
    });

    await this.notifyRequester(row, status, reason);
    return toView(row);
  }

  /** Notifica al solicitante el resultado de la transición (salvo que él la haga). */
  private async notifyRequester(
    row: Reimbursement,
    status: FinanceStatus,
    reason?: string,
  ): Promise<void> {
    await this.notifications.create(row.userId, {
      type: NOTIFICATION_TYPE,
      title: `Tu reembolso "${row.concept}" cambió a ${statusLabel(status)}`,
      body: reason ? `Motivo: ${reason}` : undefined,
      link: REIMBURSEMENTS_LINK,
    });
  }
}

/** Etiqueta legible del estado para el texto de la notificación. */
function statusLabel(status: FinanceStatus): string {
  switch (status) {
    case FinanceStatus.APROBADO:
      return 'aprobado';
    case FinanceStatus.RECHAZADO:
      return 'rechazado';
    case FinanceStatus.PAGADO:
      return 'pagado';
    case FinanceStatus.PENDIENTE:
      return 'pendiente';
  }
}

/** Mapea la fila Prisma a la vista pública (fechas a ISO-8601), sin solicitante. */
function toView(row: Reimbursement): ReimbursementView {
  return {
    id: row.id,
    userId: row.userId,
    amount: row.amount,
    date: row.date.toISOString(),
    concept: row.concept,
    category: row.category,
    receiptUrl: row.receiptUrl,
    status: row.status,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Vista de gestión: incluye los datos del solicitante. */
function toViewWithRequester(row: ReimbursementWithRequester): ReimbursementView {
  return {
    ...toView(row),
    requester: {
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      email: row.user.email,
    },
  };
}

/** Convierte un string ISO a Date; inválido → 400. */
function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Fecha inválida.');
  }
  return date;
}

/** Formateador de pesos chilenos (sin decimales) para los encabezados del PDF. */
const CLP_FORMAT = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

/** Formatea un monto CLP entero (ej. 15000 → "$15.000"). */
function formatClp(amount: number): string {
  return CLP_FORMAT.format(amount);
}

/**
 * Extrae la `key` del storage desde una `receiptUrl` pública (`.../files/<key>`).
 * Devuelve `null` si la URL no tiene el prefijo esperado.
 */
function extractStorageKey(url: string): string | null {
  const marker = '/files/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const key = url.slice(index + marker.length);
  return key.length > 0 ? decodeURIComponent(key) : null;
}
