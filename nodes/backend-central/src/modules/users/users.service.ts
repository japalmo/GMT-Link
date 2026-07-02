import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ORG_ID } from '../../common/org.constant';
import { generateProvisionalPassword } from '../../common/provisional-password';
import { hashPassword } from '../../common/password';
import type { RoleKey } from '../../common/role-keys';
import { FgaService } from '../../fga/fga.service';
import type { TupleKey } from '../../fga/fga.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

import { StorageService } from '../../common/storage/storage.service';

/** Rol cuya asignación org-scope sí confiere acceso de admin en OpenFGA (§4.3). */
const ORG_ADMIN_ROLE: RoleKey = 'org_admin';
import type {
  CreateUserResponse,
  ImportErrorRow,
  ImportUsersResponse,
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
 * Decisión §9: NO se envía email; la clave provisoria se RETORNA en la respuesta
 * para que el admin la comparta. Solo se persiste su hash bcrypt; nunca en claro.
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
  ) {}

  /** Crea un usuario aprovisionado. Retorna la vista pública + la clave provisoria. */
  async create(dto: CreateUserDto): Promise<CreateUserResponse> {
    const roleKeys = await this.validateRoleKeys(dto.roleKeys);
    await this.assertEmailFree(dto.email);

    const provisionalPassword = generateProvisionalPassword();
    const passwordHash = await hashPassword(provisionalPassword);

    let user: UserWithMemberships;
    try {
      user = await this.persistUserWithMemberships(dto, roleKeys, passwordHash);
    } catch (error: unknown) {
      if (this.isUniqueEmailViolation(error)) {
        throw new ConflictException(`Ya existe un usuario con el email "${dto.email}".`);
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

    return { user: this.toProvisionedUser(user, roleKeys), provisionalPassword };
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
          provisionalPassword: result.provisionalPassword,
        });
      } catch (error: unknown) {
        errors.push({ index, email: validation.dto.email, message: this.errorMessage(error) });
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

  /** Lista usuarios con sus roleKeys (datos para RoleScopedList, §5). `search` opcional. */
  async list(search?: string): Promise<UserListItem[]> {
    const trimmed = search?.trim();
    const where: Prisma.UserWhereInput | undefined =
      trimmed && trimmed.length > 0
        ? {
            OR: [
              { firstName: { contains: trimmed, mode: 'insensitive' } },
              { lastName: { contains: trimmed, mode: 'insensitive' } },
              { secondName: { contains: trimmed, mode: 'insensitive' } },
              { secondLastName: { contains: trimmed, mode: 'insensitive' } },
              { email: { contains: trimmed, mode: 'insensitive' } },
            ],
          }
        : undefined;

    const users = await this.prisma.user.findMany({
      where,
      include: { memberships: true },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.toListItem(user));
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

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

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
  ): Promise<UserWithMemberships> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: dto.firstName,
          secondName: dto.secondName ?? null,
          lastName: dto.lastName,
          secondLastName: dto.secondLastName ?? null,
          email: dto.email,
          passwordHash,
          isClientUser: dto.isClientUser ?? false,
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

  private async currentRoles(userId: string): Promise<UserRolesResponse> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      select: { roleKey: true },
    });
    return { id: userId, roleKeys: this.collectRoleKeys(memberships.map((m) => m.roleKey)) };
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
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
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
      status: user.status,
      isClientUser: user.isClientUser,
      roleKeys: this.collectRoleKeys(user.memberships.map((m) => m.roleKey)),
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** ¿El error es la violación de unicidad de email de Prisma (P2002 sobre email)? */
  private isUniqueEmailViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
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

/** Extrae el email de una fila cruda para etiquetar errores de importación (`''` si no aplica). */
function extractEmail(row: unknown): string {
  if (typeof row === 'object' && row !== null && 'email' in row) {
    const value = (row as { email?: unknown }).email;
    if (typeof value === 'string') return value;
  }
  return '';
}
