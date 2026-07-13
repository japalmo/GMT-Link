import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinanceStatus } from '@prisma/client';
import type { Prisma, Reimbursement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { callNvidiaChat } from '../../common/nvidia';
import { nextFinanceStatus } from '../finance/finance-status.util';
import type { FinanceTransition } from '../finance/finance-status.util';
import { monthRange } from '../finance/finance-month.util';
import { CreateReimbursementDto } from './dto/reimbursements.dto';
import type { Paginated, ReimbursementView } from './reimbursements.types';
import { composeReceiptsPdf, sniffReceiptKind } from './reimbursements-pdf.util';
import type { ReceiptForPdf, ComposeOptions } from './reimbursements-pdf.util';
import { buildReceiptOcrMessages, parseReceiptOcr } from './receipt-ocr.util';
import type { ReceiptScanResult } from './receipt-ocr.util';
import { buildReimbursementSummary } from './reimbursements-summary.util';
import type { ReimbursementSummary } from './reimbursements-summary.util';

/** Carpeta lógica del storage para boletas de reembolso (§6-3.1). */
const RECEIPTS_FOLDER = 'reimbursements';

/** Cuota diaria de IA por usuario (mismo mecanismo/límite que tools y providers). */
const DAILY_AI_QUOTA = 3;

/** Acción registrada en `geminiUsage` por cada OCR de boleta (comparte cuota con el resto de IA). */
const RECEIPT_OCR_ACTION = 'RECEIPT_OCR';

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
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  month?: string;
  order?: 'asc' | 'desc';
  printed?: boolean;
  /** Tope de filas de la página (default 30, máx. 100). */
  limit?: number;
  /** Cursor keyset opaco (página siguiente); ver doc de `listAll`. */
  cursor?: string;
}

/**
 * Reembolsos (§6-3.1, primitivas `RoleScopedList` + `RequestForm`).
 *
 * Seguridad: el `userId` SIEMPRE llega del controller (sesión), nunca del body.
 * "Solo el dueño" (crear/listar propios/subir boleta) es lógica de este service
 * (filtra por `userId`). La GESTIÓN (lista global, aprobar/rechazar/pagar) la
 * autoriza el controller con un check de permiso funcional inline
 * (`PermissionService.can`, respaldado por Postgres) → 403 si el usuario no tiene
 * el permiso. `getById` admite al dueño O a un gestor: como ese check no aplica a
 * esa ruta, la decisión es lógica de service.
 */
@Injectable()
export class ReimbursementsService {
  private readonly logger = new Logger(ReimbursementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea un reembolso del propio usuario en estado PENDIENTE (RequestForm). La
   * BOLETA es obligatoria (control interno): el archivo llega por multipart ya
   * validado por el controller y se persiste de forma atómica junto con la fila,
   * evitando la ventana en que un reembolso quedaba sin respaldo. `amount` es CLP
   * entero; `date` es la fecha del gasto.
   */
  async create(
    userId: string,
    dto: CreateReimbursementDto,
    file: UploadedReceiptFile,
  ): Promise<ReimbursementView> {
    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: RECEIPTS_FOLDER,
    });

    const row = await this.prisma.reimbursement.create({
      data: {
        userId,
        amount: dto.amount,
        date: parseDate(dto.date),
        concept: dto.concept,
        category: dto.category ?? null,
        subcategory: dto.subcategory ?? null,
        vehicle: dto.vehicle ?? null,
        observations: dto.observations ?? null,
        // Persistimos la `key` ESTABLE del storage (la `url` de R2 es firmada/efímera).
        receiptUrl: saved.url,
        receiptKey: saved.key,
        status: FinanceStatus.PENDIENTE,
      },
    });
    return toView(row);
  }

  /**
   * Genera (servidor, §6-3.2) un PDF con las boletas de los reembolsos indicados,
   * en grilla de `perPage` por página. Gating por permiso funcional inline en el controller. Solo incluye
   * los que tienen boleta adjunta y cuyo archivo se puede leer; 400 si ninguno.
   */
  async generateBatchPdf(ids: string[], options: ComposeOptions): Promise<Uint8Array> {
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
      // Con R2 la `key` estable vive en `receiptKey`; para filas viejas (o local)
      // se deriva de la URL pública `/files/<key>` como fallback.
      const key = row.receiptKey ?? (row.receiptUrl ? extractStorageKey(row.receiptUrl) : null);
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
        categoryLabel: row.category ?? 'Sin categoría',
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
    return composeReceiptsPdf(receipts, options);
  }

  /** Marca como impresas las boletas indicadas (post-descarga, spec §5.7). */
  async markPrinted(ids: string[]): Promise<{ marked: number }> {
    if (ids.length === 0) return { marked: 0 };
    const res = await this.prisma.reimbursement.updateMany({
      where: { id: { in: ids } },
      data: { printed: true, printedAt: new Date() },
    });
    return { marked: res.count };
  }

  /**
   * Lista los reembolsos propios con paginación KEYSET estable. El orden es
   * `createdAt desc` — NO único — así que se desempata por `id desc`: el cursor
   * de la página siguiente es `${createdAt.toISOString()}_${id}` del último item
   * de la página previa, y la siguiente pide `createdAt < cursor.createdAt` OR
   * (`createdAt = cursor.createdAt` AND `id < cursor.id`). Se trae `limit + 1`
   * filas para saber si hay más páginas sin un `count` adicional. `limit`
   * default 30, máximo 100. Filtro opcional por `status`.
   */
  async listMine(
    userId: string,
    opts: { status?: FinanceStatus; limit?: number; cursor?: string } = {},
  ): Promise<Paginated<ReimbursementView>> {
    const { status, cursor } = opts;
    const limit = normalizeLimit(opts.limit);

    const where: Prisma.ReimbursementWhereInput = { userId };
    if (status !== undefined) {
      where.status = status;
    }
    if (cursor) {
      const decoded = decodeKeysetCursor(cursor);
      if (decoded) {
        where.AND = createdAtKeysetWhere(decoded);
      }
    }

    const rows = await this.prisma.reimbursement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeKeysetCursor(lastRow.createdAt, lastRow.id) : null;

    return { items: pageRows.map(toView), nextCursor };
  }

  /**
   * Lista TODOS los reembolsos (vista del gestor — RoleScopedList) con
   * paginación KEYSET estable. El orden es `date` (fecha del gasto), configurable
   * asc/desc vía `filters.order` (default desc) — NO único — así que se
   * desempata por `id` en la MISMA dirección: el cursor de la página siguiente es
   * `${date.toISOString()}_${id}` del último item de la página previa. El
   * permiso lo verifica el guard en el controller. Filtros opcionales `status` /
   * `userId` / rango de fecha / mes / impresión. Incluye datos del solicitante.
   */
  async listAll(filters: ListReimbursementsFilters): Promise<Paginated<ReimbursementView>> {
    const limit = normalizeLimit(filters.limit);
    const order = filters.order ?? 'desc';
    const where = buildReimbursementWhere(filters);

    if (filters.cursor) {
      const decoded = decodeKeysetCursor(filters.cursor);
      if (decoded) {
        where.AND = dateKeysetWhere(decoded, order);
      }
    }

    const rows = await this.prisma.reimbursement.findMany({
      where,
      include: { user: REQUESTER_SELECT },
      orderBy: [{ date: order }, { id: order }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeKeysetCursor(lastRow.date, lastRow.id) : null;

    return { items: pageRows.map(toViewWithRequester), nextCursor };
  }

  /**
   * Agregaciones para las cards (spec §5.2), sobre el MISMO filtro que la tabla.
   * Se calcula todo en BD (conteos por estado, suma de APROBADO y ranking por
   * trabajador) en vez de traer TODAS las filas y sumar en JS. Los nombres del
   * ranking se resuelven con UN `findMany` acotado a los userId del top.
   */
  async summary(filters: ListReimbursementsFilters): Promise<ReimbursementSummary> {
    const where = buildReimbursementWhere(filters);
    const approvedWhere: Prisma.ReimbursementWhereInput = {
      ...where,
      status: FinanceStatus.APROBADO,
    };

    const [statusGroups, approvedAgg, rankingGroups] = await Promise.all([
      this.prisma.reimbursement.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.reimbursement.aggregate({ where: approvedWhere, _sum: { amount: true } }),
      this.prisma.reimbursement.groupBy({
        by: ['userId'],
        where: approvedWhere,
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
    ]);

    const userIds = rankingGroups.map((g) => g.userId);
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

    return buildReimbursementSummary({
      statusCounts: statusGroups.map((g) => ({ status: g.status, count: g._count })),
      approvedPendingAmount: approvedAgg._sum.amount ?? 0,
      ranking: rankingGroups.map((g) => ({ userId: g.userId, total: g._sum.amount ?? 0 })),
      names,
    });
  }

  /**
   * OCR de boleta (spec §5.5): imagen (data URL base64) → NVIDIA visión → campos
   * sugeridos. Protegido por una cuota diaria por usuario (MISMO mecanismo que
   * `tools.detectShoreline` y `providers.cleanProviderData`: tabla `geminiUsage`,
   * conteo de filas del día, límite `DAILY_AI_QUOTA`) para acotar el costo del
   * modelo de visión. Si no hay clave NVIDIA, devuelve objeto vacío SIN consumir
   * cuota (no hay llamada paga; el usuario llena a mano).
   */
  async scanReceipt(userId: string, imageDataUrl: string): Promise<ReceiptScanResult> {
    // 1. Cuota diaria por usuario (comparte contador con el resto de features de IA).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const usageCount = await this.prisma.geminiUsage.count({
      where: { userId, createdAt: { gte: today } },
    });
    if (usageCount >= DAILY_AI_QUOTA) {
      throw new BadRequestException(
        `Alcanzaste el límite diario de lectura automática de boletas (${DAILY_AI_QUOTA}/día). Completa los datos a mano.`,
      );
    }

    const apiKey =
      this.config.get<string>('NVIDIA_API_KEY_VISION') ?? this.config.get<string>('NVIDIA_API_KEY');
    if (!apiKey) return {};
    const model =
      this.config.get<string>('NVIDIA_VISION_MODEL') ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

    // 2. Registrar el uso ANTES de la llamada paga (cuenta como una consulta de IA).
    await this.prisma.geminiUsage.create({ data: { userId, action: RECEIPT_OCR_ACTION } });

    try {
      const content = await callNvidiaChat({
        apiKey,
        model,
        maxTokens: 1024,
        temperature: 0,
        messages: buildReceiptOcrMessages(imageDataUrl),
      });
      return parseReceiptOcr(content);
    } catch (err) {
      this.logger.warn(`OCR de boleta falló: ${String(err)}`);
      return {}; // degradación suave: el usuario completa manualmente
    }
  }

  /**
   * Detalle de un reembolso visible para el DUEÑO o para un GESTOR. `isManager`
   * lo resuelve el controller (check de permiso `finance:request:view:all`); si no es ninguno,
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
      // Persistimos la `key` ESTABLE del storage (fix R2 §5.5/5.7): la `url` de R2
      // es firmada/efímera y no sirve para leer la boleta al imprimir en lote.
      data: { receiptUrl: saved.url, receiptKey: saved.key },
    });
    return toView(row);
  }

  /** Aprueba un reembolso (gestor; gating por permiso inline en el controller). PENDIENTE→APROBADO. */
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
    // Maker-checker (control interno): nadie aprueba ni paga su propio reembolso.
    if (transition === 'approve' && current.userId === managerId) {
      throw new ForbiddenException('No puedes aprobar tu propio reembolso.');
    }
    if (transition === 'pay' && current.userId === managerId) {
      throw new ForbiddenException('No puedes registrar el pago de tu propio reembolso.');
    }
    const status = nextFinanceStatus(current.status, transition);

    const row = await this.prisma.reimbursement.update({
      where: { id },
      data: {
        status,
        decidedById: managerId,
        decidedAt: new Date(),
        ...(transition === 'reject' && reason ? { rejectionReason: reason } : {}),
      },
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
    subcategory: row.subcategory,
    vehicle: row.vehicle,
    observations: row.observations,
    receiptUrl: row.receiptUrl,
    rejectionReason: row.rejectionReason,
    printed: row.printed,
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
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
 * Normaliza el `limit` de paginación: default 30, tope 100, mínimo 1. Ignora
 * valores no numéricos (p. ej. un `?limit=` mal formado que llega como NaN).
 */
function normalizeLimit(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 100)
    : 30;
}

/** Codifica el cursor keyset compuesto (fecha, `id`) de `listMine`/`listAll`. */
function encodeKeysetCursor(date: Date, id: string): string {
  return `${date.toISOString()}_${id}`;
}

/**
 * Decodifica un cursor de `listMine`/`listAll`. `null` si el formato es
 * inválido (cursor corrupto o mal formado): en ese caso se ignora en vez de
 * romper la página, igual que un `limit` no numérico.
 */
function decodeKeysetCursor(raw: string): { date: Date; id: string } | null {
  const separatorIndex = raw.indexOf('_');
  if (separatorIndex === -1) return null;
  const isoPart = raw.slice(0, separatorIndex);
  const idPart = raw.slice(separatorIndex + 1);
  const date = new Date(isoPart);
  if (Number.isNaN(date.getTime()) || idPart.length === 0) return null;
  return { date, id: idPart };
}

/** OR de keyset para `listMine` (orden fijo `createdAt desc`). */
function createdAtKeysetWhere(cursor: { date: Date; id: string }): Prisma.ReimbursementWhereInput {
  return {
    OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }],
  };
}

/** OR de keyset para `listAll` (orden `date`, configurable asc/desc vía `order`). */
function dateKeysetWhere(
  cursor: { date: Date; id: string },
  order: 'asc' | 'desc',
): Prisma.ReimbursementWhereInput {
  return order === 'desc'
    ? { OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }] }
    : { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] };
}

/** Construye el `where` de reembolsos desde los filtros (trabajador/fecha/mes/orden/impresa). */
function buildReimbursementWhere(f: ListReimbursementsFilters): Prisma.ReimbursementWhereInput {
  const where: Prisma.ReimbursementWhereInput = {};
  if (f.status !== undefined) where.status = f.status;
  if (f.userId !== undefined) where.userId = f.userId;
  if (f.printed !== undefined) where.printed = f.printed;

  const dateWhere: Prisma.DateTimeFilter = {};
  if (f.month) {
    const { gte, lt } = monthRange(f.month);
    dateWhere.gte = gte;
    dateWhere.lt = lt;
  }
  if (f.date) {
    const day = new Date(f.date);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    dateWhere.gte = start;
    dateWhere.lt = end;
  }
  if (f.dateFrom) dateWhere.gte = new Date(f.dateFrom);
  if (f.dateTo) {
    // Half-open: `lt` del día siguiente (mismo criterio que el filtro `date`
    // exacto) para no excluir un `dateTo` con hora ≠ 0. Se mantiene UTC.
    const end = new Date(f.dateTo);
    end.setUTCDate(end.getUTCDate() + 1);
    dateWhere.lt = end;
  }
  if (Object.keys(dateWhere).length > 0) where.date = dateWhere;

  return where;
}

/**
 * Extrae la `key` del storage desde una `receiptUrl` pública LOCAL (`.../files/<key>`).
 * Solo aplica al backend local; con R2 la `key` se lee de `receiptKey` (columna).
 * Tolera querystring. Devuelve `null` si no matchea el patrón local.
 */
export function extractStorageKey(url: string): string | null {
  const marker = '/files/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const afterMarker = url.slice(index + marker.length);
  const key = afterMarker.split('?')[0] ?? ''; // descarta querystring (URLs firmadas)
  return key.length > 0 ? decodeURIComponent(key) : null;
}
