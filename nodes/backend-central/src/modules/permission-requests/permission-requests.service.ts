import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionRequest, Prisma, RequestStatus } from '@prisma/client';
import { ORG_ID } from '../../common/org.constant';
import { isRoleKey } from '../../common/role-keys';
import type { RoleKey } from '../../common/role-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import type { CreatePermissionRequestDto } from './dto/create-permission-request.dto';
import type {
  PermissionRequestAdminView,
  PermissionRequestView,
} from './permission-requests.types';

/** Tipo de notificación de resolución (aprobada/rechazada) que recibe el solicitante. */
const NOTIFICATION_TYPE_RESOLVED = 'permission.request.resolved';

/** Enlace destino de la notificación (sección Configuración del front). */
const SETTINGS_LINK = '/configuracion';

/** Fila con el solicitante incluido (vista del admin). */
type PermissionRequestWithRequester = Prisma.PermissionRequestGetPayload<{
  include: { user: { select: { id: true; firstName: true; lastName: true; email: true } } };
}>;

/**
 * Solicitudes de permisos/rol a un admin (§6-2.3 "solicitar permisos a admin").
 *
 * Un usuario solicita un rol; en el MVP la solicitud es a nivel ORGANIZACIÓN
 * (scopeType ORGANIZATION, scopeId ORG_ID) — no hay UI para elegir scope todavía.
 * El admin (autorizado por OpenFGA `can_manage_users` sobre `organization:gmt`,
 * gating en el controller) la aprueba o rechaza. Aprobar APLICA el permiso
 * reusando `UsersService.assignRole` (Membership + sync FGA verificado).
 *
 * Seguridad: el `userId` del solicitante SIEMPRE llega del controller (sesión).
 * Las acciones de admin (listar pendientes, aprobar, rechazar) las gatea el
 * `PermissionsGuard` en el controller; este service no re-chequea el rol.
 *
 * NOTA: al crear una solicitud NO se notifica al admin. No hay forma barata de
 * listar todos los admins (la pertenencia admin vive en OpenFGA, no en una tabla
 * consultable directamente), así que se omite la notificación al admin en el MVP;
 * el admin descubre las solicitudes vía `GET /permission-requests` (pendientes).
 */
@Injectable()
export class PermissionRequestsService {
  private readonly logger = new Logger(PermissionRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crea una solicitud del propio usuario para `roleKey` a nivel organización.
   * 400 si el roleKey no es válido; 409 si ya existe una PENDIENTE del mismo
   * usuario+roleKey (evita duplicados). No notifica al admin (ver JSDoc de clase).
   */
  async create(userId: string, dto: CreatePermissionRequestDto): Promise<PermissionRequestView> {
    const roleKey = this.parseRoleKey(dto.roleKey);

    const existing = await this.prisma.permissionRequest.findFirst({
      where: { userId, roleKey, status: 'PENDIENTE' },
    });
    if (existing !== null) {
      throw new ConflictException(`Ya tienes una solicitud pendiente para el rol "${roleKey}".`);
    }

    const row = await this.prisma.permissionRequest.create({
      data: {
        userId,
        roleKey,
        scopeType: 'ORGANIZATION',
        scopeId: ORG_ID,
        reason: dto.reason ?? null,
        status: 'PENDIENTE',
      },
    });
    return toView(row);
  }

  /** Solicitudes propias (orden createdAt desc). */
  async listMine(userId: string): Promise<PermissionRequestView[]> {
    const rows = await this.prisma.permissionRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  /**
   * Solicitudes PENDIENTES de todos (vista del admin), con datos del solicitante.
   * Orden createdAt asc (las más antiguas primero, para atenderlas en orden).
   */
  async listPending(): Promise<PermissionRequestAdminView[]> {
    const rows = await this.prisma.permissionRequest.findMany({
      where: { status: 'PENDIENTE' },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return rows.map(toAdminView);
  }

  /**
   * Aprueba una solicitud PENDIENTE: la marca APROBADA (+ decidedBy/At) y APLICA
   * el rol reusando `UsersService.assignRole`. Si el usuario YA tenía el rol,
   * `assignRole` lanza 409: se captura como "ya asignado" (no es error — el
   * objetivo es que el usuario tenga el rol), y la solicitud igual queda aprobada.
   * Notifica al solicitante. 404 si no existe; 409 si no está PENDIENTE.
   */
  async approve(adminId: string, id: string): Promise<PermissionRequestView> {
    const request = await this.findPending(id);

    try {
      await this.users.assignRole(request.userId, request.roleKey);
    } catch (error: unknown) {
      // El usuario ya tenía el rol: el efecto deseado ya está, seguimos aprobando.
      if (error instanceof ConflictException) {
        this.logger.log(
          `El usuario ${request.userId} ya tenía el rol "${request.roleKey}" al aprobar la solicitud ${id}; se marca aprobada igualmente.`,
        );
      } else {
        throw error;
      }
    }

    const updated = await this.markDecided(id, 'APROBADA', adminId);
    await this.notifyRequester(updated, true);
    return toView(updated);
  }

  /**
   * Rechaza una solicitud PENDIENTE: la marca RECHAZADA (+ decidedBy/At) y, si
   * viene `reason`, lo persiste (motivo del admin). Notifica al solicitante.
   * 404 si no existe; 409 si no está PENDIENTE.
   */
  async reject(adminId: string, id: string, reason?: string): Promise<PermissionRequestView> {
    await this.findPending(id);
    const updated = await this.markDecided(id, 'RECHAZADA', adminId, reason);
    await this.notifyRequester(updated, false);
    return toView(updated);
  }

  // ============ Helpers ============

  /** Valida el roleKey contra el contrato RoleKey (400 si es desconocido). */
  private parseRoleKey(raw: string): RoleKey {
    if (!isRoleKey(raw)) {
      throw new BadRequestException(`Rol desconocido: "${raw}".`);
    }
    return raw;
  }

  /** Solicitud PENDIENTE por id, o excepción: 404 si no existe, 409 si ya decidida. */
  private async findPending(id: string): Promise<PermissionRequest> {
    const request = await this.prisma.permissionRequest.findUnique({ where: { id } });
    if (request === null) {
      throw new NotFoundException('La solicitud no existe.');
    }
    if (request.status !== 'PENDIENTE') {
      throw new ConflictException('La solicitud ya fue resuelta.');
    }
    return request;
  }

  /** Aplica la decisión (estado + decidedBy/At + reason opcional) y devuelve la fila. */
  private markDecided(
    id: string,
    status: Extract<RequestStatus, 'APROBADA' | 'RECHAZADA'>,
    adminId: string,
    reason?: string,
  ): Promise<PermissionRequest> {
    return this.prisma.permissionRequest.update({
      where: { id },
      data: {
        status,
        decidedById: adminId,
        decidedAt: new Date(),
        ...(reason !== undefined ? { reason } : {}),
      },
    });
  }

  /** Notifica al solicitante el resultado (aprobada/rechazada) con link a Configuración. */
  private async notifyRequester(request: PermissionRequest, approved: boolean): Promise<void> {
    await this.notifications.create(request.userId, {
      type: NOTIFICATION_TYPE_RESOLVED,
      title: approved
        ? `Tu solicitud del rol "${request.roleKey}" fue aprobada`
        : `Tu solicitud del rol "${request.roleKey}" fue rechazada`,
      link: SETTINGS_LINK,
    });
  }
}

/** Mapea la fila Prisma a la vista pública (fechas a ISO-8601). */
function toView(row: PermissionRequest): PermissionRequestView {
  return {
    id: row.id,
    userId: row.userId,
    roleKey: row.roleKey as RoleKey,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    reason: row.reason,
    status: row.status,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Mapea la fila + solicitante a la vista del admin. */
function toAdminView(row: PermissionRequestWithRequester): PermissionRequestAdminView {
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
