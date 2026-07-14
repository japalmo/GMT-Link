import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { ORG_ID } from '../../common/org.constant';
import { isRoleKey } from '../../common/role-keys';
import type { RoleKey } from '../../common/role-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { tableOrderBy, tablePage, tableSkipTake } from '../../common/table-pagination.util';
import type { DirectoryEntry, DirectoryEntryExtended } from './directory.types';

/** Usuario con memberships y cliente, forma común de las consultas de este servicio. */
type UserWithMemberships = Prisma.UserGetPayload<{ include: { memberships: true; client: true } }>;

/**
 * Directorio de personas (§6-1.6, scopeado por rol).
 *
 * AISLAMIENTO CLIENTE/COLABORADOR (§3.4) — es LÓGICA DE NEGOCIO, no un permiso
 * FGA: el filtro depende del `isClientUser` del SOLICITANTE, un dato de fila, no
 * de una relación de autorización. Por eso vive aquí (filtro de datos) y no en
 * el guard. Regla MVP:
 *  - solicitante cliente (isClientUser=true): ve SOLO colaboradores
 *    (isClientUser=false). Nunca a otros clientes ni datos internos.
 *  - solicitante colaborador (isClientUser=false): ve a todos.
 *
 * El permiso FGA `directory:view:extended`
 * (organization#can_view_directory_extended, derivado de admin) NO se chequea
 * aquí: lo aplica el guard en el endpoint `/directory/:id/extended`. Este
 * servicio expone dos formas (`toEntry` básica, `toEntryExtended`) y el
 * controller elige cuál según el guard. El aislamiento cliente se respeta en
 * AMBAS rutas (básica y extendida).
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista del directorio (campos básicos). `search` server-side por nombre o
   * email. El aislamiento se aplica según el `isClientUser` del SOLICITANTE,
   * resuelto desde Postgres por su `requesterId` (nunca confiado del body).
   */
  async list(requesterId: string, search?: string): Promise<DirectoryEntry[]> {
    const requesterIsClient = await this.resolveRequesterIsClient(requesterId);
    const where = this.buildWhere(requesterIsClient, search);
    const users = await this.prisma.user.findMany({
      where,
      include: { memberships: true, client: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return users.map((user) => this.toEntry(user));
  }

  /**
   * Lista del directorio con el MOTOR de tablas server-side (offset). Aplica el
   * MISMO aislamiento cliente/colaborador que `list` (según el `isClientUser` del
   * solicitante) + un filtro `tipo` (colaborador/cliente) + búsqueda, con orden
   * configurable (persona/email/cargo, default nombre asc). Lo consume la tabla de
   * Colaboradores del directorio (filtro `tipo=colaborador`).
   */
  async listTable(requesterId: string, req: TableRequest): Promise<TablePage<DirectoryEntry>> {
    const requesterIsClient = await this.resolveRequesterIsClient(requesterId);
    const { page, pageSize, skip, take } = tableSkipTake(req);
    const tipo = typeof req.filters?.tipo === 'string' ? req.filters.tipo.trim() : '';
    const where = this.buildWhere(requesterIsClient, req.search, tipo) ?? {};

    const orderBy = tableOrderBy<Prisma.UserOrderByWithRelationInput[]>(
      req,
      {
        persona: (dir) => [{ firstName: dir }, { lastName: dir }, { id: 'asc' }],
        email: (dir) => [{ email: dir }, { id: 'asc' }],
        cargo: (dir) => [{ cargo: dir }, { firstName: 'asc' }],
      },
      [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { memberships: true, client: true },
        orderBy,
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return tablePage(rows.map((user) => this.toEntry(user)), total, page, pageSize);
  }

  /**
   * Detalle BÁSICO de una persona. Respeta el aislamiento: un cliente que pida a
   * otro cliente recibe 404 (no debe ni saber que existe). 404 si no existe.
   */
  async getBasic(requesterId: string, id: string): Promise<DirectoryEntry> {
    const requesterIsClient = await this.resolveRequesterIsClient(requesterId);
    const user = await this.findVisible(requesterIsClient, id);
    return this.toEntry(user);
  }

  /**
   * Detalle EXTENDIDO (básicos + status/points/segundos nombres). El permiso ya
   * lo verificó el guard; aquí solo se respeta el aislamiento cliente. 404 si no
   * existe o no es visible para el solicitante.
   */
  async getExtended(requesterId: string, id: string): Promise<DirectoryEntryExtended> {
    const requesterIsClient = await this.resolveRequesterIsClient(requesterId);
    const user = await this.findVisible(requesterIsClient, id);
    return this.toEntryExtended(user);
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  /**
   * Resuelve si el SOLICITANTE es un usuario cliente, leyendo su fila de
   * Postgres. 401 si el usuario de la sesión ya no existe (no se puede decidir
   * el aislamiento sin conocerlo).
   */
  private async resolveRequesterIsClient(requesterId: string): Promise<boolean> {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { isClientUser: true },
    });
    if (!requester) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }
    return requester.isClientUser;
  }

  /** Busca un usuario visible para el solicitante (aplica aislamiento). 404 si no. */
  private async findVisible(
    requesterIsClient: boolean,
    id: string,
  ): Promise<UserWithMemberships> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { memberships: true, client: true },
    });
    // Aislamiento (§3.4): un cliente no ve a otros clientes — se trata como
    // inexistente (404), no 403, para no revelar su existencia.
    if (!user || (requesterIsClient && user.isClientUser)) {
      throw new NotFoundException(`No existe una persona con id "${id}" en el directorio.`);
    }
    return user;
  }

  /**
   * Arma el `where` de Prisma: aislamiento cliente + filtro `tipo` opcional
   * (colaborador/cliente) + búsqueda server-side. El aislamiento manda: un
   * solicitante cliente nunca ve a otros clientes, aunque pida `tipo=cliente`.
   */
  private buildWhere(
    requesterIsClient: boolean,
    search?: string,
    tipo?: string,
  ): Prisma.UserWhereInput | undefined {
    const conditions: Prisma.UserWhereInput[] = [];

    // Aislamiento: el cliente solo ve colaboradores.
    if (requesterIsClient) {
      conditions.push({ isClientUser: false });
    }

    // Filtro por tipo (la tabla de Colaboradores usa `colaborador`).
    if (tipo === 'colaborador') {
      conditions.push({ isClientUser: false });
    } else if (tipo === 'cliente') {
      conditions.push({ isClientUser: true });
    }

    // El query string puede llegar anidado/repetido (qs) y no ser un string;
    // se coacciona para no reventar con `.trim is not a function` (500).
    const trimmed = typeof search === 'string' ? search.trim() : '';
    if (trimmed.length > 0) {
      conditions.push({
        OR: [
          { firstName: { contains: trimmed, mode: 'insensitive' } },
          { lastName: { contains: trimmed, mode: 'insensitive' } },
          { secondName: { contains: trimmed, mode: 'insensitive' } },
          { secondLastName: { contains: trimmed, mode: 'insensitive' } },
          { email: { contains: trimmed, mode: 'insensitive' } },
        ],
      });
    }

    if (conditions.length === 0) {
      return undefined;
    }
    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  /** Vista BÁSICA del directorio (visible para cualquier autenticado). */
  private toEntry(user: UserWithMemberships): DirectoryEntry {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      cargo: user.cargo,
      roleKeys: this.collectRoleKeys(user.memberships),
      isClientUser: user.isClientUser,
      companyName: user.client?.name ?? null,
    };
  }

  /** Vista EXTENDIDA: básicos + campos internos (solo con permiso). */
  private toEntryExtended(user: UserWithMemberships): DirectoryEntryExtended {
    return {
      ...this.toEntry(user),
      status: user.status,
      points: user.points,
      secondName: user.secondName,
      secondLastName: user.secondLastName,
    };
  }

  /** roleKeys ORGANIZATION del usuario, filtradas a claves conocidas (defensivo).
      El directorio no las muestra, pero otros flujos (p.ej. filtrar autorizadores
      de horas extra) las consumen. */
  private collectRoleKeys(
    memberships: ReadonlyArray<{ roleKey: string; scopeType: string; scopeId: string }>,
  ): RoleKey[] {
    const out: RoleKey[] = [];
    for (const m of memberships) {
      if (m.scopeType !== 'ORGANIZATION' || m.scopeId !== ORG_ID) {
        continue;
      }
      if (isRoleKey(m.roleKey) && !out.includes(m.roleKey)) {
        out.push(m.roleKey);
      }
    }
    return out;
  }
}
