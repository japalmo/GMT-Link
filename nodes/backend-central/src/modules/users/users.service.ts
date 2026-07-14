import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User, WorkSchedule } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  AssignRoleInput,
  ProjectAdminOption,
  ResendInvitePreview,
  ResendInviteResult,
  ScopeType,
  TablePage,
  TableRequest,
  UpdateUserAdminInput,
  UpsertWorkScheduleInput,
  UserMembership,
  WorkScheduleView,
} from '@gmt-platform/contracts';
import { SHIFT_PATTERN_CYCLE } from '@gmt-platform/contracts';
import { ORG_ID } from '../../common/org.constant';
import { generateProvisionalPassword } from '../../common/provisional-password';
import { hashPassword } from '../../common/password';
import type { RoleKey } from '../../common/role-keys';
import { FgaService } from '../../fga/fga.service';
import type { TupleKey } from '../../fga/fga.types';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesService } from '../roles/roles.service';
import { CreateUserDto } from './dto/create-user.dto';
import type { ResendInviteDto } from './dto/resend-invite.dto';
import {
  tableAndWhere,
  tableOrderBy,
  tablePage,
  tableSearchWhere,
  tableSkipTake,
} from '../../common/table-pagination.util';

import { StorageService } from '../../common/storage/storage.service';
import { EmailService, NoopEmailService } from '../../common/email.service';
import { credentialsEmail, resendCredentialsEmail, defaultResendMessage } from '../../common/email-templates';

/** Rol cuya asignación org-scope sí confiere acceso de admin en OpenFGA (§4.3). */
const ORG_ADMIN_ROLE: RoleKey = 'org_admin';
/** Permiso que define quién puede ser administrador de proyecto (dropdown filtrado). */
const PROJECT_MANAGE_PERMISSION = 'project:manage';
/** Estados válidos de `User.status` (enum Prisma) — whitelist del filtro de la tabla. */
const VALID_USER_STATUSES: readonly string[] = ['PENDING_FIRST_LOGIN', 'ACTIVE', 'SUSPENDED'];
import type {
  CreateUserResponse,
  ImportErrorRow,
  ImportUsersResponse,
  Paginated,
  UserListItem,
  UserRolesResponse,
} from './users.types';

/** Usuario con sus memberships, forma común de las consultas internas. */
type UserWithMemberships = Prisma.UserGetPayload<{ include: { memberships: true } }>;

/**
 * Provisión de usuarios por el admin (§1.1, §6-1.1).
 *
 * Orquesta dos sistemas por usuario creado:
 *  1. Postgres   — User (PENDING_FIRST_LOGIN) con el HASH bcrypt de la clave
 *                  provisoria + Membership por rol (espejo §4.1).
 *  2. OpenFGA    — tupla de acceso org (member/admin).
 *
 * Decisión §9: la clave provisoria se RETORNA en la respuesta para que el admin
 * la comparta (y se muestra en la UI). Solo se persiste su hash bcrypt; nunca en
 * claro. ADEMÁS, si el usuario trae email primario y hay un proveedor de correo
 * real configurado (Brevo/SMTP), se le envían las credenciales por correo como
 * conveniencia (best-effort: un fallo de envío NO aborta la creación).
 *
 * Modelo de roles en la provisión (decisión §9 "acceso org + roles por defecto"):
 * a nivel ORGANIZACIÓN OpenFGA solo distingue acceso (admin/member). Por eso al
 * crear un usuario se escribe UNA tupla de acceso: `organization#member` siempre,
 * y además `organization#admin` si trae el rol org_admin. Los demás roles del CSV
 * (operator, qa, finance, viewer, client_ito) se guardan como Membership ORG —
 * "rol por defecto" visible en el directorio — pero NO generan tupla funcional a
 * nivel org; se materializan como tuplas FGA recién al asignar el usuario a un
 * proyecto (Etapa 4). OpenFGA write no es idempotente, así que `member` se escribe
 * una sola vez aquí (no en cada rol funcional).
 *
 * Compensación best-effort: si tras persistir el User en Postgres falla la
 * escritura FGA, se borra el User (cascada de memberships) para no dejar huérfanos.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
    private readonly roles: RolesService,
    private readonly emailService: EmailService,
  ) {}

  /** Crea un usuario aprovisionado. Retorna la vista pública + la clave provisoria. */
  async create(dto: CreateUserDto): Promise<CreateUserResponse> {
    const roleKeys = await this.validateRoleKeys(dto.roleKeys);
    const email = (dto.emailInstitucional ?? dto.emailPersonal ?? '').trim();
    await this.assertUsernameFree(dto.username);
    await this.assertEmailFree(email);

    const provisionalPassword = generateProvisionalPassword();
    const passwordHash = await hashPassword(provisionalPassword);

    let user: UserWithMemberships;
    try {
      user = await this.persistUserWithMemberships(dto, roleKeys, passwordHash, email);
    } catch (error: unknown) {
      const conflict = this.uniqueConflictField(error);
      if (conflict) {
        throw new ConflictException(conflict);
      }
      throw error;
    }

    // Acceso org en FGA: member siempre; admin además si trae org_admin.
    try {
      const orgWrites: TupleKey[] = [this.orgAccessTuple(user.id, 'member')];
      if (roleKeys.includes(ORG_ADMIN_ROLE)) {
        orgWrites.push(this.orgAccessTuple(user.id, 'admin'));
      }
      await this.fga.writeTuples(orgWrites);
    } catch (error: unknown) {
      await this.compensateUser(user.id);
      throw error;
    }

    // Envío ADICIONAL (best-effort) de las credenciales por correo: NO reemplaza
    // el retorno de la clave (§9-1.1 sigue vigente: el admin también la ve en la
    // UI). Solo se intenta si hay email primario y un proveedor de correo real.
    await this.trySendCredentialsEmail(email, dto, provisionalPassword);

    return { user: this.toProvisionedUser(user, roleKeys), provisionalPassword };
  }

  /**
   * Revoca todas las sesiones activas del usuario incrementando su época de
   * sesión (`tokenVersion`): cualquier JWT emitido antes deja de ser válido de
   * inmediato (A3). Útil para forzar el cierre de sesión de una cuenta ACTIVA.
   */
  async revokeSessions(userId: string): Promise<void> {
    await this.assertUserExists(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  /**
   * Revoca el acceso de un usuario (lo suspende) e invalida cualquier token ya
   * emitido. Pensado para invitaciones aún NO usadas ("se envió el token y no lo
   * han usado"), pero también sirve para cortar el acceso de una cuenta activa.
   */
  async revokeInvite(userId: string): Promise<UserListItem> {
    await this.assertUserExists(userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', tokenVersion: { increment: 1 } },
      include: { memberships: true },
    });
    return this.toListItem(updated);
  }

  /**
   * Vista previa del correo de reenvío de clave (sin efectos). Valida que la
   * invitación NO haya sido usada (409 si ya definió su contraseña) y devuelve el
   * asunto y mensaje POR DEFECTO (editables por el admin), el destinatario y si se
   * puede enviar desde el servidor (`canEmail`). La clave NO se genera aquí ni
   * viaja al front: se regenera y se inyecta recién al enviar.
   */
  async resendInvitePreview(userId: string): Promise<ResendInvitePreview> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        username: true,
        email: true,
        emailInstitucional: true,
        emailPersonal: true,
        firstLoginAt: true,
        status: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id "${userId}".`);
    }
    this.assertInviteUnused(user.firstLoginAt, user.status);

    const to = this.primaryEmail(user);
    return {
      to,
      canEmail: to.length > 0 && this.isRealEmailProvider(),
      username: user.username,
      nombre: user.firstName,
      subject: 'Tus credenciales de acceso a GMT Link',
      message: defaultResendMessage(),
    };
  }

  /**
   * Reenvía la clave provisoria. Regenera la clave (invalida la anterior + bump de
   * tokenVersion) y deja al usuario en PENDING_FIRST_LOGIN. 409 si la invitación YA
   * fue usada. Dos caminos según `sendEmail`:
   *  - CON correo (`sendEmail` y hay destinatario + proveedor real): el servidor
   *    arma el correo con el asunto/mensaje editados por el admin, inyecta la clave
   *    y lo envía. NO retorna la clave (`provisionalPassword: null`). Un fallo de
   *    envío revierte a 502 para que el admin lo sepa (la clave ya fue rotada).
   *  - SIN correo (camino manual): retorna la clave una vez para compartirla a mano.
   */
  async resendInvite(userId: string, input: ResendInviteDto): Promise<ResendInviteResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        username: true,
        email: true,
        emailInstitucional: true,
        emailPersonal: true,
        firstLoginAt: true,
        status: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id "${userId}".`);
    }
    this.assertInviteUnused(user.firstLoginAt, user.status);

    const to = this.primaryEmail(user);
    const wantsEmail = input.sendEmail === true;
    if (wantsEmail && (to.length === 0 || !this.isRealEmailProvider())) {
      throw new ConflictException(
        'No se puede enviar el correo: el usuario no tiene correo o no hay un proveedor de correo configurado.',
      );
    }

    const provisionalPassword = generateProvisionalPassword();
    const passwordHash = await hashPassword(provisionalPassword);
    await this.prisma.user.update({
      where: { id: userId },
      // Reemplazar el hash invalida la clave provisoria anterior; el bump de
      // tokenVersion invalida cualquier token que hubiese quedado dando vueltas.
      data: { passwordHash, status: 'PENDING_FIRST_LOGIN', tokenVersion: { increment: 1 } },
    });

    if (!wantsEmail) {
      // Camino manual: la clave se retorna una vez para compartirla a mano.
      return { sent: false, to: null, provisionalPassword };
    }

    try {
      await this.emailService.send({
        to,
        ...resendCredentialsEmail({
          nombre: user.firstName,
          username: user.username,
          provisionalPassword,
          loginUrl: this.loginUrl(),
          subject: input.subject ?? '',
          message: input.message ?? '',
        }),
      });
    } catch (error: unknown) {
      // La clave ya se rotó; avisar del fallo de envío (no dejarlo silencioso como
      // en la creación, porque aquí el admin espera que el correo salga).
      this.logger.error(`No se pudo reenviar el correo de credenciales a ${to}: ${this.errorMessage(error)}`);
      throw new HttpException(
        { code: 'EMAIL_SEND_FAILED', message: 'La clave se regeneró, pero no se pudo enviar el correo.' },
        502,
      );
    }
    return { sent: true, to, provisionalPassword: null };
  }

  /**
   * 409 si el usuario no está en un estado apto para reenviar clave. Se EXIGE
   * `PENDING_FIRST_LOGIN` (y sin primer ingreso): así reenviar clave nunca
   * reactiva de forma implícita una cuenta ACTIVA (ya tiene su clave) ni una
   * SUSPENDED (acceso revocado a propósito). Re-otorgar acceso a un usuario
   * revocado debe ser una acción explícita, no un efecto colateral del reenvío.
   */
  private assertInviteUnused(firstLoginAt: Date | null, status: string): void {
    if (firstLoginAt !== null || status !== 'PENDING_FIRST_LOGIN') {
      throw new ConflictException(
        'No se puede reenviar la clave: la invitación ya fue usada o el acceso está revocado.',
      );
    }
  }

  /** Email primario del usuario (institucional > personal > compat), o '' si no tiene. */
  private primaryEmail(user: {
    email: string | null;
    emailInstitucional: string | null;
    emailPersonal: string | null;
  }): string {
    return (user.emailInstitucional ?? user.emailPersonal ?? user.email ?? '').trim();
  }

  /** URL de login del frontend para los correos (configurable por env). */
  private loginUrl(): string {
    return process.env.APP_WEB_URL || 'https://web-dev-production-05f2.up.railway.app';
  }

  /**
   * Envía las credenciales de acceso por correo (usuario + clave provisoria +
   * enlace de login). Best-effort: si no hay email primario o el proveedor de
   * correo no es real (Noop), no hace nada; si el envío falla, solo se loguea —
   * NUNCA aborta la creación del usuario (la clave ya se retorna igual).
   */
  private async trySendCredentialsEmail(
    email: string,
    dto: CreateUserDto,
    provisionalPassword: string,
  ): Promise<void> {
    if (email.length === 0 || !this.isRealEmailProvider()) {
      return;
    }
    const loginUrl = process.env.APP_WEB_URL || 'https://web-dev-production-05f2.up.railway.app';
    try {
      await this.emailService.send({
        to: email,
        ...credentialsEmail({
          nombre: dto.firstName,
          username: dto.username,
          provisionalPassword,
          loginUrl,
        }),
      });
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo enviar el correo de credenciales a ${email} (el usuario se creó igual): ${this.errorMessage(error)}`,
      );
    }
  }

  /** ¿Hay un proveedor de correo real activo (no el Noop de "sin envío")? */
  private isRealEmailProvider(): boolean {
    return !(this.emailService instanceof NoopEmailService);
  }

  /**
   * Importa un lote de usuarios (§1.1). Procesa fila por fila; una fila mala
   * NO aborta el lote: se acumula en `errors`. Cada fila llega CRUDA (`unknown`)
   * y se valida aquí (forma de DTO + semántica), de modo que un email mal escrito
   * o un rol con typo solo afecta a esa fila, no a las 199 buenas.
   */
  async importBatch(rows: readonly unknown[]): Promise<ImportUsersResponse> {
    const created: ImportUsersResponse['created'] = [];
    const errors: ImportErrorRow[] = [];

    for (const [index, row] of rows.entries()) {
      const email = extractEmail(row);
      const validation = await this.validateRowShape(row);
      if ('message' in validation) {
        errors.push({ index, email, message: validation.message });
        continue;
      }
      try {
        const result = await this.create(validation.dto);
        created.push({
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          provisionalPassword: result.provisionalPassword,
        });
      } catch (error: unknown) {
        const label =
          validation.dto.emailInstitucional ?? validation.dto.emailPersonal ?? validation.dto.username;
        errors.push({ index, email: label, message: this.errorMessage(error) });
      }
    }

    return { created, errors };
  }

  /**
   * Valida la FORMA de una fila cruda contra `CreateUserDto` (class-validator),
   * con las mismas reglas que el endpoint individual (whitelist + sin campos
   * extra). Devuelve el DTO validado o un mensaje agregado de los errores.
   */
  private async validateRowShape(
    row: unknown,
  ): Promise<{ dto: CreateUserDto } | { message: string }> {
    const instance = plainToInstance(CreateUserDto, row);
    const failures = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (failures.length > 0) {
      const message = failures
        .flatMap((failure) => Object.values(failure.constraints ?? {}))
        .join(' ');
      return { message: message.length > 0 ? message : 'Fila con formato inválido.' };
    }
    return { dto: instance };
  }

  /**
   * Lista usuarios con sus roleKeys (datos para `RoleScopedList`, §5) con
   * paginación KEYSET estable. El orden es `createdAt desc` — NO único (dos
   * usuarios pueden compartir el mismo timestamp) — así que se desempata por
   * `id desc`: el cursor de la página siguiente es
   * `${createdAt.toISOString()}_${id}` del último item de la página previa, y la
   * siguiente página pide `createdAt < cursor.createdAt` OR (`createdAt =
   * cursor.createdAt` AND `id < cursor.id`). Se trae `limit + 1` filas para saber
   * si hay más páginas sin un `count` adicional; la fila centinela sobrante se
   * descarta y su ausencia marca el fin (`nextCursor = null`). `limit` default
   * 30, máximo 100. `search` (opcional) filtra server-side por nombre / apellido
   * / email / username (case-insensitive).
   */
  async list(
    opts: { search?: string; limit?: number; cursor?: string } = {},
  ): Promise<Paginated<UserListItem>> {
    const { search, cursor } = opts;

    // Normaliza el límite: default 30, tope 100, mínimo 1. Ignora valores no
    // numéricos (p. ej. un `?limit=` mal formado que llega como NaN).
    const requestedLimit = opts.limit;
    const limit =
      requestedLimit !== undefined && Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 30;

    // Cada condición viaja en su propio `AND` para no pisar el `OR` de la otra
    // (búsqueda vs. keyset).
    const conditions: Prisma.UserWhereInput[] = [];

    const trimmedSearch = search?.trim();
    if (trimmedSearch && trimmedSearch.length > 0) {
      conditions.push({
        OR: [
          { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
          { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
          { secondName: { contains: trimmedSearch, mode: 'insensitive' } },
          { secondLastName: { contains: trimmedSearch, mode: 'insensitive' } },
          { email: { contains: trimmedSearch, mode: 'insensitive' } },
          { username: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      });
    }

    if (cursor) {
      const decoded = decodeUserCursor(cursor);
      if (decoded) {
        conditions.push({
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        });
      }
    }

    const where: Prisma.UserWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    // limit + 1: la fila extra solo sirve para saber si hay página siguiente.
    const rows = await this.prisma.user.findMany({
      where,
      include: { memberships: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeUserCursor(lastRow.createdAt, lastRow.id) : null;

    return {
      items: pageRows.map((user) => this.toListItem(user)),
      nextCursor,
    };
  }

  /**
   * Lista usuarios con el MOTOR de tablas server-side (offset). A diferencia de
   * `list` (keyset, para selects que cargan "casi todo"), aquí la búsqueda, el
   * filtro por estado/tipo y el orden se resuelven en el servidor sobre el dataset
   * COMPLETO y se devuelve una página numerada con el total. Lo consume la tabla
   * del directorio (`useDataTable` + `DataTable`). Columnas ordenables: nombre
   * (firstName), usuario, email, estado, creado. Filtros: `status`, `tipo`
   * (interno/cliente). Orden por defecto: más nuevos primero (createdAt desc, id desc).
   */
  async listTable(req: TableRequest): Promise<TablePage<UserListItem>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);

    const searchWhere = tableSearchWhere<Prisma.UserWhereInput>(req.search, [
      'firstName',
      'secondName',
      'lastName',
      'secondLastName',
      'email',
      'username',
      'emailInstitucional',
      'emailPersonal',
    ]);

    const filters = req.filters ?? {};
    const filterParts: Prisma.UserWhereInput[] = [];
    // Los valores de `filters` llegan crudos del query string (qs puede anidarlos):
    // se coaccionan a string y el `status` se valida contra el enum, para degradar a
    // "filtro ignorado" en vez de reventar la consulta de Prisma con un 500.
    const status = typeof filters.status === 'string' ? filters.status.trim() : '';
    if (VALID_USER_STATUSES.includes(status)) {
      filterParts.push({ status: status as User['status'] });
    }
    const tipo = typeof filters.tipo === 'string' ? filters.tipo.trim() : '';
    if (tipo === 'cliente') filterParts.push({ isClientUser: true });
    else if (tipo === 'interno') filterParts.push({ isClientUser: false });

    const where =
      tableAndWhere<Prisma.UserWhereInput>(searchWhere, ...filterParts) ?? {};

    const orderBy = tableOrderBy<Prisma.UserOrderByWithRelationInput[]>(
      req,
      {
        nombre: (dir) => [{ firstName: dir }, { lastName: dir }, { id: 'desc' }],
        usuario: (dir) => [{ username: dir }, { id: 'desc' }],
        email: (dir) => [{ email: dir }, { id: 'desc' }],
        estado: (dir) => [{ status: dir }, { id: 'desc' }],
        creado: (dir) => [{ createdAt: dir }, { id: 'desc' }],
      },
      [{ createdAt: 'desc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: { memberships: true }, orderBy, skip, take }),
      this.prisma.user.count({ where }),
    ]);

    return tablePage(rows.map((user) => this.toListItem(user)), total, page, pageSize);
  }

  /**
   * Usuarios elegibles como administrador de proyecto: aquellos cuyo rol otorga
   * el permiso `project:manage`. El set de roleKeys se DERIVA de `RolePermission`
   * (no se hardcodea): se consultan los grants del permiso y se listan los
   * usuarios con una Membership en alguno de esos roles. Devuelve `{id, fullName,
   * roleKeys}` (roleKeys = los roles del usuario que conceden el permiso) para
   * poblar el select del formulario de proyecto.
   */
  async listProjectAdmins(): Promise<ProjectAdminOption[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { permission: { key: PROJECT_MANAGE_PERMISSION } },
      include: { role: { select: { key: true } } },
    });
    const grantingRoleKeys = new Set(grants.map((grant) => grant.role.key));
    if (grantingRoleKeys.size === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: { memberships: { some: { roleKey: { in: [...grantingRoleKeys] } } } },
      select: {
        id: true,
        firstName: true,
        secondName: true,
        lastName: true,
        secondLastName: true,
        memberships: { select: { roleKey: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return users.map((user) => ({
      id: user.id,
      fullName: [user.firstName, user.secondName, user.lastName, user.secondLastName]
        .filter((part): part is string => Boolean(part))
        .join(' '),
      roleKeys: [...new Set(user.memberships.map((m) => m.roleKey))].filter((key) =>
        grantingRoleKeys.has(key),
      ),
    }));
  }

  /** Detalle de un usuario por id. 404 si no existe. */
  async getById(id: string): Promise<UserListItem> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { memberships: true },
    });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id "${id}".`);
    }
    return this.toListItem(user);
  }

  // ============ Horario / turnos del trabajador ============

  /**
   * Jornada/turnos de un trabajador (`GET /users/:id/schedule`). 404 si el usuario
   * no existe; `null` si todavía no tiene jornada configurada. Solo lectura del admin.
   */
  async getSchedule(id: string): Promise<WorkScheduleView | null> {
    await this.assertUserExists(id);
    const row = await this.prisma.workSchedule.findUnique({ where: { userId: id } });
    return row ? this.toScheduleView(row) : null;
  }

  /**
   * Upsert de la jornada de un trabajador (`PUT /users/:id/schedule`). Reemplazo
   * completo. Normaliza los días de ciclo según el patrón: ADMINISTRATIVO no rota
   * (workDays/restDays/cycleStart quedan en null); los preset cíclicos derivan
   * workDays/restDays de la tabla; PERSONALIZADO exige workDays/restDays (≥1). 404
   * si el usuario no existe.
   */
  async upsertSchedule(id: string, input: UpsertWorkScheduleInput): Promise<WorkScheduleView> {
    await this.assertUserExists(id);

    let workDays: number | null;
    let restDays: number | null;
    let cycleStart: Date | null;

    if (input.shiftPattern === 'ADMINISTRATIVO') {
      // Jornada administrativa: lunes a viernes, sin ciclo rotativo.
      workDays = null;
      restDays = null;
      cycleStart = null;
    } else {
      const preset = SHIFT_PATTERN_CYCLE[input.shiftPattern];
      if (preset) {
        workDays = preset.workDays;
        restDays = preset.restDays;
      } else {
        // PERSONALIZADO: el admin fija los días a mano (obligatorios y ≥1).
        workDays = input.workDays ?? null;
        restDays = input.restDays ?? null;
        if (workDays === null || restDays === null || workDays < 1 || restDays < 1) {
          throw new BadRequestException(
            'El turno personalizado requiere días de faena y de descanso (al menos 1 de cada uno).',
          );
        }
      }
      cycleStart = this.parseScheduleDate(input.cycleStart);
      // Un turno cíclico sin fecha de inicio no permite computar faena/descanso:
      // se exige el ancla del ciclo (día 1 en faena).
      if (cycleStart === null) {
        throw new BadRequestException('Los turnos cíclicos requieren una fecha de inicio de ciclo.');
      }
    }

    const data = {
      shiftPattern: input.shiftPattern,
      workDays,
      restDays,
      cycleStart,
      dayNight: input.dayNight,
      startTime: this.normalizeTime(input.startTime),
      endTime: this.normalizeTime(input.endTime),
      notes: input.notes?.trim() || null,
    };

    const row = await this.prisma.workSchedule.upsert({
      where: { userId: id },
      create: { userId: id, ...data },
      update: data,
    });
    return this.toScheduleView(row);
  }

  /** Mapea la fila WorkSchedule a la vista de contrato (fechas en ISO). */
  private toScheduleView(row: WorkSchedule): WorkScheduleView {
    return {
      shiftPattern: row.shiftPattern,
      workDays: row.workDays,
      restDays: row.restDays,
      // cycleStart es date-only en el contrato: la columna guarda medianoche UTC
      // (new Date("YYYY-MM-DD")), así que la porción de fecha del ISO es la fecha
      // calendario correcta sin drift de zona horaria.
      cycleStart: row.cycleStart ? row.cycleStart.toISOString().slice(0, 10) : null,
      dayNight: row.dayNight,
      startTime: row.startTime,
      endTime: row.endTime,
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** ISO date/datetime opcional → Date; null si vacío; 400 si inválido. */
  private parseScheduleDate(value: string | null | undefined): Date | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('La fecha de inicio de ciclo no es válida.');
    }
    return date;
  }

  /** "HH:mm" opcional: '' / undefined / null → null; resto se recorta. */
  private normalizeTime(value: string | null | undefined): string | null {
    return value === undefined || value === null || value.trim() === '' ? null : value.trim();
  }

  /**
   * Edición del detalle de un usuario por un administrador (`PATCH /users/:id`).
   * Aplica solo los campos presentes. Al tocar cualquier email re-deriva el `email`
   * legacy (= institucional ?? personal) y exige que quede al menos un correo. 409
   * si el nuevo username/email choca (P2002). No cambia clave, estado ni roles.
   */
  async adminUpdate(id: string, dto: UpdateUserAdminInput): Promise<UserListItem> {
    const current = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true, emailInstitucional: true, emailPersonal: true },
    });
    if (!current) {
      throw new NotFoundException(`No existe un usuario con id "${id}".`);
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.secondName !== undefined) data.secondName = dto.secondName?.trim() || null;
    if (dto.secondLastName !== undefined) data.secondLastName = dto.secondLastName?.trim() || null;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.cargo !== undefined) data.cargo = dto.cargo?.trim() || null;
    if (dto.isClientUser !== undefined) data.isClientUser = dto.isClientUser;

    // Emails: recomputa el `email` compat (D1) y valida que quede al menos uno.
    if (dto.emailInstitucional !== undefined || dto.emailPersonal !== undefined) {
      const nextInstitucional =
        dto.emailInstitucional !== undefined
          ? dto.emailInstitucional?.trim() || null
          : current.emailInstitucional;
      const nextPersonal =
        dto.emailPersonal !== undefined ? dto.emailPersonal?.trim() || null : current.emailPersonal;
      const nextEmail = nextInstitucional ?? nextPersonal;
      if (!nextEmail) {
        throw new BadRequestException('El usuario debe conservar al menos un correo (institucional o personal).');
      }
      data.emailInstitucional = nextInstitucional;
      data.emailPersonal = nextPersonal;
      data.email = nextEmail;
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data,
        include: { memberships: true },
      });
      return this.toListItem(updated);
    } catch (error: unknown) {
      const conflict = this.uniqueConflictField(error);
      if (conflict) {
        throw new ConflictException(conflict);
      }
      throw error;
    }
  }

  /**
   * Borra un usuario (hard delete) por un administrador. Guarda de auto-borrado
   * (no puedes borrarte a ti mismo). Borra sus Memberships y el User en una
   * transacción; si un FK lo impide (P2003 — el usuario tiene reembolsos,
   * checklists, proyectos u otros registros), responde 409 sugiriendo revocar el
   * acceso en su lugar. Tras el borrado limpia sus tuplas de acceso org en FGA
   * (best-effort). Pensado para depurar duplicados de la importación.
   */
  async adminDelete(id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) {
      throw new ConflictException('No puedes borrar tu propia cuenta.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, memberships: { select: { roleKey: true, scopeType: true, scopeId: true } } },
    });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id "${id}".`);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.membership.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
      });
    } catch (error: unknown) {
      if (this.isForeignKeyError(error)) {
        throw new ConflictException(
          'No se puede borrar: el usuario tiene registros asociados (reembolsos, checklists, proyectos, etc.). Revoca su acceso en lugar de borrarlo.',
        );
      }
      throw error;
    }

    // Limpieza FGA best-effort. Solo se borran tuplas que EXISTEN: member siempre
    // (se escribe al aprovisionar) y admin solo si tenía el rol org_admin org-scope.
    const hadAdmin = user.memberships.some(
      (m) => m.roleKey === ORG_ADMIN_ROLE && m.scopeType === 'ORGANIZATION' && m.scopeId === ORG_ID,
    );
    const tuples: TupleKey[] = [this.orgAccessTuple(id, 'member')];
    if (hadAdmin) {
      tuples.push(this.orgAccessTuple(id, 'admin'));
    }
    try {
      await this.fga.deleteTuples(tuples);
    } catch (error: unknown) {
      this.logger.error(
        `Usuario ${id} borrado, pero no se pudieron limpiar sus tuplas FGA de acceso: ${this.errorMessage(error)}`,
      );
    }
  }

  /** ¿El error es una violación de llave foránea de Prisma (P2003)? */
  private isForeignKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2003'
    );
  }

  /** Asigna un rol org-scope a un usuario (Membership + tupla FGA). 409 si ya lo tiene. */
  async assignRole(userId: string, roleKey: string): Promise<UserRolesResponse> {
    const [valid] = await this.validateRoleKeys([roleKey]);
    const key = valid as RoleKey;
    await this.assertUserExists(userId);

    const existing = await this.prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: key,
          scopeType: 'ORGANIZATION',
          scopeId: ORG_ID,
        },
      },
    });
    if (existing) {
      throw new ConflictException(`El usuario ya tiene el rol "${key}".`);
    }

    await this.prisma.membership.create({
      data: { userId, roleKey: key, scopeType: 'ORGANIZATION', scopeId: ORG_ID },
    });
    // Solo org_admin altera el acceso FGA (→ organization#admin). Los roles
    // funcionales son "rol por defecto" (Postgres); el acceso member ya existe
    // desde la provisión. No se reescribe member (write FGA no es idempotente).
    if (key === ORG_ADMIN_ROLE) {
      await this.fga.writeTuples([this.orgAccessTuple(userId, 'admin')]);
    }

    return this.currentRoles(userId);
  }

  /** Quita un rol org-scope de un usuario (Membership + tupla FGA). 404 si no lo tiene. */
  async removeRole(userId: string, roleKey: string): Promise<UserRolesResponse> {
    const [valid] = await this.validateRoleKeys([roleKey]);
    const key = valid as RoleKey;
    await this.assertUserExists(userId);

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: key,
          scopeType: 'ORGANIZATION',
          scopeId: ORG_ID,
        },
      },
    });
    if (!membership) {
      throw new NotFoundException(`El usuario no tiene el rol "${key}".`);
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });
    // Quitar org_admin retira el acceso admin; el usuario sigue siendo member.
    // Quitar un rol funcional no toca FGA (era solo "rol por defecto").
    if (key === ORG_ADMIN_ROLE) {
      await this.fga.deleteTuples([this.orgAccessTuple(userId, 'admin')]);
    }

    return this.currentRoles(userId);
  }

  /**
   * Asigna un rol (sistema o custom) a un usuario en un scope arbitrario
   * (ORGANIZATION|PROJECT). El gate `allowedScopeTypes` aplica SOLO a roles
   * CUSTOM: los roles del SISTEMA conservan la semántica §9-1.1 — asignados
   * org-scope son "rol por defecto" (Membership sin tupla funcional; solo
   * org_admin escribe la tupla de acceso admin) y en PROJECT usan el mapeo
   * fijo legacy. (Validar los del sistema contra `allowedScopeTypes`, que para
   * 7/8 roles del seed es ['PROJECT'], rompería la asignación org retro-compat
   * y el approve() de permission-requests.) Si es PROJECT, valida que `scopeId`
   * exista. Crea la Membership y sincroniza FGA por el camino correcto según
   * `Role.isSystem`. Si el sync FGA falla, borra la Membership creada y
   * responde 502 (enmienda A11) — en ambos caminos.
   */
  async assignRoleScoped(userId: string, input: AssignRoleInput): Promise<UserRolesResponse> {
    await this.assertUserExists(userId);
    const role = await this.roles.getRole(input.roleKey);
    if (!role.isSystem) {
      this.assertScopeAllowed(role, input.scopeType);
    }
    if (input.scopeType === 'PROJECT') {
      await this.assertProjectExists(input.scopeId);
    }

    const existing = await this.prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: input.roleKey,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(`El usuario ya tiene el rol "${input.roleKey}" en ese scope.`);
    }

    const membership = await this.prisma.membership.create({
      data: {
        userId,
        roleKey: input.roleKey,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
    });

    try {
      await this.syncScopedAssignment(
        role.isSystem,
        {
          userId,
          roleKey: input.roleKey,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
        'create',
      );
    } catch (error: unknown) {
      // A11: FGA falló → revertir la Membership recién creada y responder 502.
      try {
        await this.prisma.membership.delete({ where: { id: membership.id } });
      } catch (cleanupError: unknown) {
        this.logger.error(
          `Rollback parcial: no se pudo borrar la Membership ${membership.id} tras fallo FGA. Causa: ${this.errorMessage(cleanupError)}`,
        );
      }
      this.logger.error(`Sync FGA falló al asignar rol: ${this.errorMessage(error)}`);
      throw new HttpException(
        {
          code: 'FGA_SYNC_FAILED',
          message: 'No se pudo sincronizar OpenFGA; se revirtió la asignación.',
        },
        502,
      );
    }

    return this.currentRoles(userId);
  }

  /**
   * Quita un rol (sistema o custom) de un usuario en un scope arbitrario.
   * 404 si no existe la Membership. Simétrico a `assignRoleScoped` (§9-1.1):
   * un rol del sistema org-scope solo toca FGA si es org_admin (borra la tupla
   * de acceso admin); en PROJECT usa el sync legacy; custom usa
   * `syncRoleAssignment` con op 'delete'.
   */
  async removeRoleScoped(userId: string, input: AssignRoleInput): Promise<UserRolesResponse> {
    await this.assertUserExists(userId);
    const role = await this.roles.getRole(input.roleKey);

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: input.roleKey,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
    });
    if (!membership) {
      throw new NotFoundException('El usuario no tiene ese rol en ese scope.');
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });

    await this.syncScopedAssignment(
      role.isSystem,
      {
        userId,
        roleKey: input.roleKey,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
      'delete',
    );

    return this.currentRoles(userId);
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  /** 400 INVALID_SCOPE_FOR_ROLE si scopeType no está en los allowedScopeTypes del rol. */
  private assertScopeAllowed(role: { allowedScopeTypes: string[] }, scopeType: string): void {
    if (!role.allowedScopeTypes.includes(scopeType)) {
      throw new HttpException(
        { code: 'INVALID_SCOPE_FOR_ROLE', message: `El rol no admite el scope "${scopeType}".` },
        400,
      );
    }
  }

  /** 400 INVALID_SCOPE_ID si el proyecto no existe. */
  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new HttpException(
        { code: 'INVALID_SCOPE_ID', message: `No existe un proyecto con id "${projectId}".` },
        400,
      );
    }
  }

  /**
   * Sincronización FGA de una asignación por scope, según la clase de rol:
   *  - SISTEMA + ORGANIZATION → semántica §9-1.1 ("rol por defecto"): NO se
   *    materializa tupla funcional; solo `org_admin` escribe/borra la tupla de
   *    acceso `organization#admin`. El acceso `member` no se toca (existe desde
   *    la provisión; el write de FGA no es idempotente).
   *  - SISTEMA + otro scope (PROJECT) → camino legacy Membership→relación fija
   *    (`syncMembershipToFGA`; una combinación no mapeada en
   *    `MEMBERSHIP_RELATION_MAP` lanza — correcto, no se escribe tupla ambigua).
   *  - CUSTOM → `syncRoleAssignment` (unión multi-rol A5). Solo admite
   *    ORGANIZATION|PROJECT (los niveles FGA de la matriz); `assertScopeAllowed`
   *    ya lo garantizó, se re-verifica aquí para estrechar el tipo.
   */
  private async syncScopedAssignment(
    isSystem: boolean,
    input: { userId: string; roleKey: string; scopeType: ScopeType; scopeId: string },
    op: 'create' | 'delete',
  ): Promise<void> {
    if (isSystem) {
      if (input.scopeType === 'ORGANIZATION') {
        if (input.roleKey === ORG_ADMIN_ROLE) {
          const tuple = this.orgAccessTuple(input.userId, 'admin');
          if (op === 'create') {
            await this.fga.writeTuples([tuple]);
          } else {
            await this.fga.deleteTuples([tuple]);
          }
        }
        return;
      }
      await this.fga.syncMembershipToFGA(input, op);
      return;
    }
    if (input.scopeType !== 'ORGANIZATION' && input.scopeType !== 'PROJECT') {
      throw new HttpException(
        {
          code: 'INVALID_SCOPE_FOR_ROLE',
          message: `El rol no admite el scope "${input.scopeType}".`,
        },
        400,
      );
    }
    await this.fga.syncRoleAssignment(
      { ...input, scopeType: input.scopeType },
      op,
    );
  }

  /**
   * Valida `roleKeys` contra la tabla `Role` de Postgres (§4.1, matriz RBAC
   * dinámica §7): acepta cualquier string que exista como `Role.key`, incluidos
   * roles personalizados (`c_xxx`) creados por `RolesService`. El gate de forma
   * (`isRoleKey`) se eliminó — la consulta `role.findMany` de abajo es la única
   * validación. Deduplica preservando orden. 400 si hay claves fuera de la BD.
   */
  private async validateRoleKeys(roleKeys: readonly string[]): Promise<RoleKey[]> {
    const unique: RoleKey[] = [];
    for (const raw of roleKeys) {
      if (!unique.includes(raw)) {
        unique.push(raw);
      }
    }
    if (unique.length === 0) {
      throw new BadRequestException('Debe asignar al menos un rol.');
    }

    const found = await this.prisma.role.findMany({
      where: { key: { in: unique } },
      select: { key: true },
    });
    const foundKeys = new Set(found.map((r) => r.key));
    const missing = unique.filter((k) => !foundKeys.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Estos roles no existen en el catálogo: ${missing.join(', ')}.`,
      );
    }
    return unique;
  }

  /** 409 si el email ya está en Postgres (pre-chequeo amistoso; el @unique cubre la carrera). */
  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(`Ya existe un usuario con el email "${email}".`);
    }
  }

  /** 409 si el username ya está en Postgres (pre-chequeo; el @unique cubre la carrera). */
  private async assertUsernameFree(username: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException(`Ya existe un usuario con el usuario "${username}".`);
    }
  }

  private async assertUserExists(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id "${id}".`);
    }
  }

  /** Crea User + Memberships en una transacción Postgres (espejo §4.1, sin FGA aquí). */
  private async persistUserWithMemberships(
    dto: CreateUserDto,
    roleKeys: RoleKey[],
    passwordHash: string,
    email: string,
  ): Promise<UserWithMemberships> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: dto.firstName,
          secondName: dto.secondName ?? null,
          lastName: dto.lastName,
          secondLastName: dto.secondLastName ?? null,
          email, // compat (D1): = emailInstitucional ?? emailPersonal
          username: dto.username,
          emailInstitucional: dto.emailInstitucional ?? null,
          emailPersonal: dto.emailPersonal ?? null,
          passwordHash,
          isClientUser: dto.isClientUser ?? false,
          cargo: dto.cargo?.trim() || null,
          status: 'PENDING_FIRST_LOGIN',
          memberships: {
            create: roleKeys.map((roleKey) => ({
              roleKey,
              scopeType: 'ORGANIZATION' as const,
              scopeId: ORG_ID,
            })),
          },
        },
        include: { memberships: true },
      });
      return user;
    });
  }

  /** Tupla de acceso org en FGA (`organization:gmt#admin|member`) para un usuario. */
  private orgAccessTuple(userId: string, relation: 'admin' | 'member'): TupleKey {
    return { user: `user:${userId}`, relation, object: `organization:${ORG_ID}` };
  }

  /** Compensación best-effort: borra User en Postgres (cascada de memberships). No re-lanza. */
  private async compensateUser(userId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.membership.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      });
    } catch (error: unknown) {
      this.logger.error(
        `Compensación parcial: no se pudo borrar el User ${userId} tras un fallo de sync FGA. Requiere limpieza manual. Causa: ${this.errorMessage(error)}`,
      );
    }
  }

  /**
   * Respuesta extendida (A4): trae TODAS las memberships del usuario. `roleKeys`
   * conserva la semántica legacy (roles a nivel org, para el directorio);
   * `memberships` expone cada asignación con su scope exacto para que la UI
   * pueda remover con precisión.
   */
  private async currentRoles(userId: string): Promise<UserRolesResponse> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { roleKey: true, scopeType: true, scopeId: true },
    });
    const orgRoleKeys = memberships
      .filter((m) => m.scopeType === 'ORGANIZATION' && m.scopeId === ORG_ID)
      .map((m) => m.roleKey);
    return {
      id: userId,
      roleKeys: this.collectRoleKeys(orgRoleKeys),
      memberships: memberships.map((m) => this.toUserMembership(m)),
    };
  }

  /** Proyección pública de una Membership (contrato UserMembership, A4). */
  private toUserMembership(m: { roleKey: string; scopeType: string; scopeId: string }): UserMembership {
    return { roleKey: m.roleKey, scopeType: m.scopeType as ScopeType, scopeId: m.scopeId };
  }

  /**
   * Deduplica roleKeys preservando orden. Ya NO filtra por `isRoleKey` (matriz
   * RBAC §7): los roles personalizados (`c_xxx`) son válidos y deben aparecer
   * en las respuestas (`UserListItem`/`UserRolesResponse`); ocultarlos rompería
   * la UI de roles dinámicos.
   */
  private collectRoleKeys(raw: readonly string[]): RoleKey[] {
    const out: RoleKey[] = [];
    for (const key of raw) {
      if (!out.includes(key)) {
        out.push(key);
      }
    }
    return out;
  }

  private toProvisionedUser(
    user: User,
    roleKeys: RoleKey[],
  ): CreateUserResponse['user'] {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      emailInstitucional: user.emailInstitucional,
      emailPersonal: user.emailPersonal,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      cargo: user.cargo,
      roleKeys,
    };
  }

  private toListItem(user: UserWithMemberships): UserListItem {
    return {
      id: user.id,
      firstName: user.firstName,
      secondName: user.secondName,
      lastName: user.lastName,
      secondLastName: user.secondLastName,
      email: user.email,
      username: user.username,
      emailInstitucional: user.emailInstitucional,
      emailPersonal: user.emailPersonal,
      status: user.status,
      isClientUser: user.isClientUser,
      cargo: user.cargo,
      roleKeys: this.collectRoleKeys(user.memberships.map((m) => m.roleKey)),
      memberships: user.memberships.map((m) => this.toUserMembership(m)),
      createdAt: user.createdAt.toISOString(),
      firstLoginAt: user.firstLoginAt ? user.firstLoginAt.toISOString() : null,
    };
  }

  /** Si el error es P2002 (unicidad), devuelve un mensaje por campo; si no, null. */
  private uniqueConflictField(error: unknown): string | null {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      (error as { code?: unknown }).code !== 'P2002'
    ) {
      return null;
    }
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    if (fields.some((f) => f.includes('username'))) return 'Ya existe un usuario con ese nombre de usuario.';
    if (fields.some((f) => f.includes('emailInstitucional'))) return 'Ya existe un usuario con ese email institucional.';
    return 'Ya existe un usuario con ese email.';
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return typeof error === 'string' ? error : 'Error desconocido.';
  }

  /**
   * Sube la imagen del avatar de un usuario y actualiza su avatarUrl.
   */
  async uploadAvatar(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<UserListItem> {
    await this.assertUserExists(id);

    const folder = `users/${id}/avatar`;
    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder,
    });

    const updated = await this.prisma.user.update({
      where: { id },
      data: { avatarUrl: saved.url },
      include: { memberships: true },
    });

    return this.toListItem(updated);
  }

  /**
   * Verifica si el usuario tiene permisos de administrador (can_manage_users) en FGA.
   */
  async checkAdminPermission(userId: string): Promise<boolean> {
    return this.fga.check({
      user: `user:${userId}`,
      relation: 'can_manage_users',
      object: `organization:${ORG_ID}`,
    });
  }
}

/** Codifica el cursor keyset compuesto (`createdAt`, `id`) de `UsersService.list`. */
function encodeUserCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}_${id}`;
}

/**
 * Decodifica un cursor de `UsersService.list`. `null` si el formato es inválido
 * (cursor corrupto o mal formado): en ese caso `list` simplemente lo ignora en
 * vez de romper la página, igual que un `limit` no numérico.
 */
function decodeUserCursor(raw: string): { createdAt: Date; id: string } | null {
  const separatorIndex = raw.indexOf('_');
  if (separatorIndex === -1) return null;
  const isoPart = raw.slice(0, separatorIndex);
  const idPart = raw.slice(separatorIndex + 1);
  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime()) || idPart.length === 0) return null;
  return { createdAt, id: idPart };
}

/** Etiqueta para errores de import: email institucional/personal/legacy o username (`''` si nada). */
function extractEmail(row: unknown): string {
  if (typeof row === 'object' && row !== null) {
    const r = row as Record<string, unknown>;
    for (const key of ['emailInstitucional', 'emailPersonal', 'email', 'username']) {
      const value = r[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return '';
}
