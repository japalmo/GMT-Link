import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FgaService } from '../../src/fga/fga.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { RolesService } from '../../src/modules/roles/roles.service';
import type { EmailService } from '../../src/common/email.service';
import { verifyPassword } from '../../src/common/password';
import { UsersService } from '../../src/modules/users/users.service';
import type { CreateUserDto } from '../../src/modules/users/dto/create-user.dto';

/**
 * Forma mínima del User que devuelve Prisma en estos tests.
 * Coincide con los campos que UsersService lee al construir respuestas.
 */
interface FakeUserRow {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  username: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  passwordHash: string;
  status: string;
  isClientUser: boolean;
  createdAt: Date;
  memberships: Array<{ roleKey: string }>;
}

/** Estado mutable que respalda los mocks de Prisma. */
interface PrismaState {
  rolesInCatalog: Set<string>;
  emailExists: boolean;
  usernameExists: boolean;
  failPersist: boolean;
}

function buildPrismaMock(state: PrismaState): {
  prisma: PrismaService;
  createdRow: () => FakeUserRow | null;
  userDelete: ReturnType<typeof vi.fn>;
  membershipDeleteMany: ReturnType<typeof vi.fn>;
} {
  let created: FakeUserRow | null = null;

  // Memberships creadas vía assignRole (respaldan membership.findMany). Guardan
  // scopeType/scopeId porque el nuevo currentRoles filtra roleKeys por ORG.
  const orgMemberships: Array<{ roleKey: string; scopeType: string; scopeId: string }> = [];

  const userCreate = vi.fn(
    (args: {
      data: {
        firstName: string;
        secondName: string | null;
        lastName: string;
        secondLastName: string | null;
        email: string;
        username: string;
        emailInstitucional: string | null;
        emailPersonal: string | null;
        passwordHash: string;
        isClientUser: boolean;
        status: string;
        memberships: { create: Array<{ roleKey: string }> };
      };
    }): Promise<FakeUserRow> => {
      if (state.failPersist) {
        return Promise.reject(new Error('fallo simulado al persistir'));
      }
      const row: FakeUserRow = {
        id: 'user-generated-id',
        firstName: args.data.firstName,
        secondName: args.data.secondName,
        lastName: args.data.lastName,
        secondLastName: args.data.secondLastName,
        email: args.data.email,
        username: args.data.username,
        emailInstitucional: args.data.emailInstitucional ?? null,
        emailPersonal: args.data.emailPersonal ?? null,
        passwordHash: args.data.passwordHash,
        status: args.data.status,
        isClientUser: args.data.isClientUser,
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        memberships: args.data.memberships.create.map((m) => ({ roleKey: m.roleKey })),
      };
      created = row;
      return Promise.resolve(row);
    },
  );

  const userDelete = vi.fn((): Promise<unknown> => Promise.resolve(undefined));
  const membershipDeleteMany = vi.fn((): Promise<unknown> => Promise.resolve(undefined));

  const prismaLike = {
    role: {
      findMany: vi.fn(
        (args: { where: { key: { in: string[] } } }): Promise<Array<{ key: string }>> =>
          Promise.resolve(
            args.where.key.in
              .filter((k) => state.rolesInCatalog.has(k))
              .map((key) => ({ key })),
          ),
      ),
    },
    user: {
      findUnique: vi.fn(
        (args: {
          where: { id?: string; email?: string; username?: string };
        }): Promise<{ id: string } | null> => {
          if (args.where.id !== undefined) {
            // assertUserExists (assignRole/removeRole): el usuario del test existe.
            return Promise.resolve({ id: args.where.id });
          }
          if (args.where.username !== undefined) {
            // assertUsernameFree (create): controlado por el estado del test.
            return Promise.resolve(state.usernameExists ? { id: 'existing' } : null);
          }
          // assertEmailFree (create): controlado por el estado del test.
          return Promise.resolve(state.emailExists ? { id: 'existing' } : null);
        },
      ),
      create: userCreate,
      delete: userDelete,
    },
    membership: {
      deleteMany: membershipDeleteMany,
      findUnique: vi.fn((): Promise<unknown> => Promise.resolve(null)),
      create: vi.fn(
        (args: {
          data: { userId: string; roleKey: string; scopeType: string; scopeId: string };
        }): Promise<unknown> => {
          orgMemberships.push({
            roleKey: args.data.roleKey,
            scopeType: args.data.scopeType,
            scopeId: args.data.scopeId,
          });
          return Promise.resolve(args.data);
        },
      ),
      findMany: vi.fn(
        (): Promise<Array<{ roleKey: string; scopeType: string; scopeId: string }>> =>
          Promise.resolve([...orgMemberships]),
      ),
    },
    // $transaction ejecuta el callback con un tx que reusa los mismos mocks.
    $transaction: vi.fn(
      <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(prismaLike),
    ),
  };

  return {
    prisma: prismaLike as unknown as PrismaService,
    createdRow: () => created,
    userDelete,
    membershipDeleteMany,
  };
}

function buildFgaMock(opts: { fail?: boolean } = {}): {
  fga: FgaService;
  writeTuples: ReturnType<typeof vi.fn>;
  deleteTuples: ReturnType<typeof vi.fn>;
} {
  const writeTuples = vi.fn(
    (): Promise<void> =>
      opts.fail ? Promise.reject(new Error('fallo simulado de FGA')) : Promise.resolve(),
  );
  const deleteTuples = vi.fn((): Promise<void> => Promise.resolve());
  const syncMembershipToFGA = vi.fn((): Promise<void> => Promise.resolve());
  return {
    fga: { writeTuples, deleteTuples, syncMembershipToFGA } as unknown as FgaService,
    writeTuples,
    deleteTuples,
  };
}

/** Storage stub: UsersService lo inyecta pero create()/importBatch() no lo usan. */
function buildStorageMock(): StorageService {
  return { save: vi.fn() } as unknown as StorageService;
}

/**
 * EmailService stub. No es una instancia de NoopEmailService, así que
 * `isRealEmailProvider()` lo considera "proveedor real": create() intentará
 * enviar credenciales (best-effort). El `send` resuelve sin efectos.
 */
function buildEmailMock(): EmailService {
  return { send: vi.fn(() => Promise.resolve()) } as unknown as EmailService;
}

/** Roles stub: los tests viejos (create/importBatch/assignRole) no llaman assignRoleScoped. */
function buildRolesStub(): RolesService {
  return {} as unknown as RolesService;
}

/** Roles mock parametrizable para los tests de assignRoleScoped/removeRoleScoped. */
function buildRolesMock(
  over: {
    allowedScopeTypes?: string[];
    isSystem?: boolean;
    roleKey?: string;
  } = {},
): RolesService {
  return {
    getRole: vi.fn(() =>
      Promise.resolve({
        key: over.roleKey ?? 'c_auditor',
        label: 'Auditor',
        description: null,
        isSystem: over.isSystem ?? false,
        allowedScopeTypes: over.allowedScopeTypes ?? ['ORGANIZATION', 'PROJECT'],
        grants: [],
      }),
    ),
  } as unknown as RolesService;
}

function validDto(overrides: Partial<CreateUserDto> = {}): CreateUserDto {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    username: 'ana.perez',
    emailInstitucional: 'ana@gmt.cl',
    roleKeys: ['operator', 'viewer'],
    ...overrides,
  } as CreateUserDto;
}

const ALL_ROLES = new Set([
  'org_admin',
  'department_admin',
  'project_creator',
  'operator',
  'qa',
  'finance',
  'viewer',
  'client_ito',
]);

describe('UsersService — gestión de invitación y sesiones (A3)', () => {
  function fullUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'u1',
      firstName: 'Ana',
      secondName: null,
      lastName: 'Pérez',
      secondLastName: null,
      email: 'ana@gmt.cl',
      username: 'ana',
      emailInstitucional: 'ana@gmt.cl',
      emailPersonal: null,
      status: 'SUSPENDED',
      isClientUser: false,
      tokenVersion: 1,
      firstLoginAt: null,
      createdAt: new Date('2026-06-13T00:00:00.000Z'),
      memberships: [],
      ...overrides,
    };
  }

  function serviceWith(userMock: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }): UsersService {
    const prisma = { user: userMock } as unknown as PrismaService;
    return new UsersService(prisma, buildFgaMock().fga, buildStorageMock(), buildRolesStub(), buildEmailMock());
  }

  it('revokeSessions incrementa la época de sesión (tokenVersion) del usuario', async () => {
    const findUnique = vi.fn(() => Promise.resolve({ id: 'u1' }));
    const update = vi.fn(() => Promise.resolve({}));
    const service = serviceWith({ findUnique, update });

    await service.revokeSessions('u1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    });
  });

  it('revokeSessions lanza 404 si el usuario no existe', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const update = vi.fn();
    const service = serviceWith({ findUnique, update });

    await expect(service.revokeSessions('ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('revokeInvite suspende al usuario e incrementa tokenVersion', async () => {
    const findUnique = vi.fn(() => Promise.resolve({ id: 'u1' }));
    const update = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve(fullUser({ ...args.data })),
    );
    const service = serviceWith({ findUnique, update });

    const result = await service.revokeInvite('u1');

    const data = update.mock.calls[0]?.[0]?.data as { status: string; tokenVersion: unknown };
    expect(data.status).toBe('SUSPENDED');
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(result.status).toBe('SUSPENDED');
  });

  it('resendInvite regenera la clave provisoria de una invitación pendiente', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve({ firstLoginAt: null, status: 'PENDING_FIRST_LOGIN' }),
    );
    const update = vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({}));
    const service = serviceWith({ findUnique, update });

    const { provisionalPassword } = await service.resendInvite('u1', { sendEmail: false });

    expect(provisionalPassword).toBeTruthy();
    const data = update.mock.calls[0]?.[0]?.data as { status: string; passwordHash: string };
    expect(data.status).toBe('PENDING_FIRST_LOGIN');
    expect(typeof data.passwordHash).toBe('string');
  });

  it('resendInvite rechaza (409) si la invitación ya fue usada', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve({ firstLoginAt: new Date('2026-07-01T00:00:00.000Z'), status: 'ACTIVE' }),
    );
    const update = vi.fn();
    const service = serviceWith({ findUnique, update });

    await expect(service.resendInvite('u1', { sendEmail: false })).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('resendInvite lanza 404 si el usuario no existe', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const update = vi.fn();
    const service = serviceWith({ findUnique, update });

    await expect(service.resendInvite('ghost', { sendEmail: false })).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('UsersService.create', () => {
  let state: PrismaState;

  beforeEach(() => {
    state = { rolesInCatalog: new Set(ALL_ROLES), emailExists: false, usernameExists: false, failPersist: false };
  });

  it('crea el usuario, persiste el hash bcrypt de la clave provisoria, escribe acceso FGA y retorna la clave', async () => {
    const { prisma, createdRow } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    const result = await service.create(validDto());

    // El User persistido lleva un passwordHash no vacío que verifica contra la clave provisoria.
    const row = createdRow();
    expect(row).not.toBeNull();
    expect(typeof row?.passwordHash).toBe('string');
    expect(row?.passwordHash.length).toBeGreaterThan(0);
    expect(row?.passwordHash).not.toBe(result.provisionalPassword);
    await expect(verifyPassword(result.provisionalPassword, row?.passwordHash ?? '')).resolves.toBe(
      true,
    );
    expect(result.provisionalPassword.length).toBeGreaterThanOrEqual(12);

    // Acceso org: solo member (no trae org_admin → sin tupla admin).
    expect(fga.writeTuples).toHaveBeenCalledTimes(1);
    expect(fga.writeTuples).toHaveBeenCalledWith([
      { user: 'user:user-generated-id', relation: 'member', object: 'organization:gmt' },
    ]);

    // La respuesta expone la vista pública con roleKeys, status PENDING_FIRST_LOGIN.
    expect(result.user).toEqual({
      id: 'user-generated-id',
      email: 'ana@gmt.cl',
      username: 'ana.perez',
      emailInstitucional: 'ana@gmt.cl',
      emailPersonal: null,
      firstName: 'Ana',
      lastName: 'Pérez',
      status: 'PENDING_FIRST_LOGIN',
      roleKeys: ['operator', 'viewer'],
    });
  });

  it('si trae org_admin, escribe acceso member + admin en FGA', async () => {
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await service.create(validDto({ roleKeys: ['org_admin'] }));

    expect(fga.writeTuples).toHaveBeenCalledTimes(1);
    expect(fga.writeTuples).toHaveBeenCalledWith([
      { user: 'user:user-generated-id', relation: 'member', object: 'organization:gmt' },
      { user: 'user:user-generated-id', relation: 'admin', object: 'organization:gmt' },
    ]);
  });

  it('NO persiste la clave provisoria en claro (solo su hash bcrypt)', async () => {
    const { prisma, createdRow } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    const result = await service.create(validDto());

    const row = createdRow();
    expect(row).not.toBeNull();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(result.provisionalPassword);
  });

  it('rechaza (400) roleKeys que no existen en el catálogo de la BD', async () => {
    state.rolesInCatalog = new Set(['operator']); // 'viewer' no está en la BD
    const { prisma, createdRow } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(service.create(validDto({ roleKeys: ['operator', 'viewer'] }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No se debe haber persistido nada si la validación falla antes.
    expect(createdRow()).toBeNull();
    expect(fga.writeTuples).not.toHaveBeenCalled();
  });

  it('rechaza (409) si el email ya existe en Postgres y no persiste el usuario', async () => {
    state.emailExists = true;
    const { prisma, createdRow } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(service.create(validDto())).rejects.toBeInstanceOf(ConflictException);
    expect(createdRow()).toBeNull();
    expect(fga.writeTuples).not.toHaveBeenCalled();
  });

  it('rechaza (409) si el username ya existe en Postgres y no persiste el usuario', async () => {
    state.usernameExists = true;
    const { prisma, createdRow } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(service.create(validDto())).rejects.toBeInstanceOf(ConflictException);
    expect(createdRow()).toBeNull();
    expect(fga.writeTuples).not.toHaveBeenCalled();
  });

  it('mapea P2002 sobre username a 409 (conflicto de nombre de usuario)', async () => {
    const { prisma } = buildPrismaMock(state);
    // Fuerza el path del catch: el create de Prisma revienta con P2002 target username.
    (prisma as unknown as { user: { create: ReturnType<typeof vi.fn> } }).user.create = vi.fn(() =>
      Promise.reject(Object.assign(new Error('P2002'), { code: 'P2002', meta: { target: ['username'] } })),
    );
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(service.create(validDto())).rejects.toBeInstanceOf(ConflictException);
    expect(fga.writeTuples).not.toHaveBeenCalled();
  });

  it('propaga el error si falla la persistencia en Postgres (sin escribir FGA)', async () => {
    state.failPersist = true;
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(service.create(validDto())).rejects.toThrow();
    expect(fga.writeTuples).not.toHaveBeenCalled();
  });

  it('compensa borrando el User (rollback Postgres) si falla la escritura FGA', async () => {
    const { prisma, userDelete, membershipDeleteMany } = buildPrismaMock(state);
    const fga = buildFgaMock({ fail: true });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(service.create(validDto())).rejects.toThrow();
    // Rollback: se borran memberships + user del recién creado (solo Postgres, sin Firebase).
    expect(membershipDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-generated-id' } });
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'user-generated-id' } });
  });
});

describe('UsersService.importBatch', () => {
  it('continúa ante una fila mala: acumula errores sin abortar el lote', async () => {
    const state: PrismaState = {
      // 'viewer' NO está en el catálogo: la segunda fila debe fallar.
      rolesInCatalog: new Set(['operator']),
      emailExists: false,
      usernameExists: false,
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    const result = await service.importBatch([
      validDto({ username: 'ok1', emailInstitucional: 'ok@gmt.cl', roleKeys: ['operator'] }),
      validDto({ username: 'bad', emailInstitucional: 'bad@gmt.cl', roleKeys: ['viewer'] }),
      validDto({ username: 'ok2', emailInstitucional: 'ok2@gmt.cl', roleKeys: ['operator'] }),
    ]);

    expect(result.created).toHaveLength(2);
    expect(result.created.map((c) => c.email)).toEqual(['ok@gmt.cl', 'ok2@gmt.cl']);
    expect(result.created.every((c) => c.provisionalPassword.length >= 12)).toBe(true);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
    expect(result.errors[0]?.email).toBe('bad@gmt.cl');
    expect(result.errors[0]?.message).toMatch(/viewer/);
  });

  it('una fila con formato inválido (email mal escrito) cae en errors sin abortar el lote', async () => {
    const state: PrismaState = {
      rolesInCatalog: new Set(ALL_ROLES),
      emailExists: false,
      usernameExists: false,
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    // Filas CRUDAS (como llegan del CSV): la del medio tiene email inválido.
    const result = await service.importBatch([
      { firstName: 'Ana', lastName: 'Pérez', username: 'ana', emailInstitucional: 'ok@gmt.cl', roleKeys: ['operator'] },
      { firstName: 'Mal', lastName: 'Correo', username: 'mal', emailInstitucional: 'no-es-un-email', roleKeys: ['operator'] },
      { firstName: 'Eva', lastName: 'Soto', username: 'eva', emailInstitucional: 'ok2@gmt.cl', roleKeys: ['operator'] },
    ]);

    // Las dos filas buenas se importan; la mala no tumba el lote.
    expect(result.created.map((c) => c.email)).toEqual(['ok@gmt.cl', 'ok2@gmt.cl']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
    expect(result.errors[0]?.email).toBe('no-es-un-email');
    // Solo se escribió acceso FGA por las 2 filas buenas.
    expect(fga.writeTuples).toHaveBeenCalledTimes(2);
  });

  it('una fila que no es objeto cae en errors sin romper el proceso', async () => {
    const state: PrismaState = {
      rolesInCatalog: new Set(ALL_ROLES),
      emailExists: false,
      usernameExists: false,
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    const result = await service.importBatch([
      { firstName: 'Ana', lastName: 'Pérez', username: 'ana', emailInstitucional: 'ok@gmt.cl', roleKeys: ['operator'] },
      'fila-corrupta',
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
  });
});

describe('UsersService — roles dinámicos (§7, matriz RBAC): valida contra Role, no por forma', () => {
  let state: PrismaState;

  beforeEach(() => {
    state = {
      // El catálogo de la BD incluye un rol personalizado NO sembrado en ROLE_KEYS.
      rolesInCatalog: new Set([...ALL_ROLES, 'c_inspector_de_campo']),
      emailExists: false,
      usernameExists: false,
      failPersist: false,
    };
  });

  it('create acepta un rol personalizado (c_xxx) que SÍ existe en la tabla Role', async () => {
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    const result = await service.create(validDto({ roleKeys: ['c_inspector_de_campo'] }));

    // El rol c_xxx aparece en la respuesta (nada lo filtra por forma).
    expect(result.user.roleKeys).toEqual(['c_inspector_de_campo']);
  });

  it('create rechaza (400) un roleKey de forma libre que NO existe en la tabla Role', async () => {
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    await expect(
      service.create(validDto({ roleKeys: ['c_no_existe'] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assignRole acepta un rol personalizado y lo refleja en roleKeys (collectRoleKeys ya no filtra)', async () => {
    const { prisma } = buildPrismaMock(state);
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub(), buildEmailMock());

    const result = await service.assignRole('u1', 'c_inspector_de_campo');

    expect(result.id).toBe('u1');
    expect(result.roleKeys).toContain('c_inspector_de_campo');
    // Un rol funcional (no org_admin) no toca FGA en la asignación org (decisión §9).
    expect(fga.writeTuples).not.toHaveBeenCalled();
  });
});

describe('UsersService.assignRoleScoped / removeRoleScoped', () => {
  it('asigna un rol custom en scope PROJECT: crea Membership, llama fga.syncRoleAssignment y devuelve la respuesta extendida', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
      findMany: vi.fn(() =>
        Promise.resolve([{ roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }]),
      ),
    };
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );

    const fga = buildFgaMock();
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;

    const roles = buildRolesMock({ allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    const result = await service.assignRoleScoped('u1', {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });

    expect(syncRoleAssignment).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );
    // Respuesta extendida (A4): id + roleKeys + memberships con scope exacto.
    expect(result).toEqual({
      id: 'u1',
      roleKeys: [],
      memberships: [{ roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }],
    });
  });

  it('502 FGA_SYNC_FAILED si el sync FGA falla tras crear la Membership: borra la Membership creada (A11)', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    const membershipDelete = vi.fn(() => Promise.resolve(undefined));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: membershipDelete,
      findMany: vi.fn(() => Promise.resolve([])),
    };
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    (fga.fga as unknown as { syncRoleAssignment: unknown }).syncRoleAssignment = vi.fn(() =>
      Promise.reject(new Error('fga caída')),
    );
    const roles = buildRolesMock({ allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }),
    ).rejects.toMatchObject({ status: 502, response: { code: 'FGA_SYNC_FAILED' } });
    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('400 INVALID_SCOPE_FOR_ROLE si scopeType no está en allowedScopeTypes del rol', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_SCOPE_FOR_ROLE' } });
  });

  it('400 INVALID_SCOPE_ID si scopeType=PROJECT y el proyecto no existe', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve(null)),
    };
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'no-existe' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_SCOPE_ID' } });
  });

  it('rol isSystem usa fga.syncMembershipToFGA (camino legacy), no syncRoleAssignment', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
      findMany: vi.fn(() =>
        Promise.resolve([{ roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' }]),
      ),
    };
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const syncMembershipToFGA = vi.fn(() => Promise.resolve(undefined));
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncMembershipToFGA: typeof syncMembershipToFGA }).syncMembershipToFGA =
      syncMembershipToFGA;
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;

    const roles = buildRolesMock({ isSystem: true, roleKey: 'operator', allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await service.assignRoleScoped('u1', { roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' });

    expect(syncMembershipToFGA).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );
    expect(syncRoleAssignment).not.toHaveBeenCalled();
  });

  it('idempotencia: 409 si la Membership ya existe para userId+roleKey+scopeType+scopeId', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'existing' })),
      create: vi.fn(),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('removeRoleScoped borra la Membership, llama al sync de delete y devuelve la respuesta extendida', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    const membershipDelete = vi.fn(() => Promise.resolve(undefined));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: membershipDelete,
      findMany: vi.fn(() => Promise.resolve([])),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    const result = await service.removeRoleScoped('u1', {
      roleKey: 'c_auditor',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
    });

    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(syncRoleAssignment).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      'delete',
    );
    expect(result).toEqual({ id: 'u1', roleKeys: [], memberships: [] });
  });

  it('removeRoleScoped: 404 si la Membership no existe', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await expect(
      service.removeRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.assignRoleScoped/removeRoleScoped — roles del SISTEMA org-scope (§9-1.1: gate de scope solo para custom)', () => {
  /** Espías FGA extra (syncMembershipToFGA/syncRoleAssignment) sobre el mock base. */
  function withScopedFgaSpies(fga: ReturnType<typeof buildFgaMock>): {
    syncMembershipToFGA: ReturnType<typeof vi.fn>;
    syncRoleAssignment: ReturnType<typeof vi.fn>;
  } {
    const syncMembershipToFGA = vi.fn(() => Promise.resolve(undefined));
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncMembershipToFGA: typeof syncMembershipToFGA }).syncMembershipToFGA =
      syncMembershipToFGA;
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;
    return { syncMembershipToFGA, syncRoleAssignment };
  }

  const freshState = (): PrismaState => ({
    rolesInCatalog: new Set(['operator']),
    emailExists: false,
    usernameExists: false,
    failPersist: false,
  });

  it('rol del SISTEMA (viewer) en ORGANIZATION: crea la Membership como "rol por defecto" y NO toca FGA aunque allowedScopeTypes sea [PROJECT]', async () => {
    const { prisma } = buildPrismaMock(freshState());
    const membershipCreate = vi.fn(() => Promise.resolve({ id: 'm1' }));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: membershipCreate,
      findMany: vi.fn(() =>
        Promise.resolve([{ roleKey: 'viewer', scopeType: 'ORGANIZATION', scopeId: 'gmt' }]),
      ),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const spies = withScopedFgaSpies(fga);
    // allowedScopeTypes ['PROJECT'] como el viewer REAL del seed (grants
    // project-level): el gate de allowedScopeTypes NO aplica a roles del sistema.
    const roles = buildRolesMock({ isSystem: true, roleKey: 'viewer', allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    const result = await service.assignRoleScoped('u1', {
      roleKey: 'viewer',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
    });

    expect(membershipCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', roleKey: 'viewer', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
    });
    // §9-1.1: "rol por defecto" → CERO FGA (ni acceso, ni sync legacy, ni unión custom).
    expect(fga.writeTuples).not.toHaveBeenCalled();
    expect(fga.deleteTuples).not.toHaveBeenCalled();
    expect(spies.syncMembershipToFGA).not.toHaveBeenCalled();
    expect(spies.syncRoleAssignment).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'u1',
      roleKeys: ['viewer'],
      memberships: [{ roleKey: 'viewer', scopeType: 'ORGANIZATION', scopeId: 'gmt' }],
    });
  });

  it('org_admin en ORGANIZATION escribe la tupla de acceso admin (organization:gmt), sin sync de membership', async () => {
    const { prisma } = buildPrismaMock(freshState());
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
      findMany: vi.fn(() =>
        Promise.resolve([{ roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' }]),
      ),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const spies = withScopedFgaSpies(fga);
    const roles = buildRolesMock({ isSystem: true, roleKey: 'org_admin', allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await service.assignRoleScoped('u1', {
      roleKey: 'org_admin',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
    });

    expect(fga.writeTuples).toHaveBeenCalledTimes(1);
    expect(fga.writeTuples).toHaveBeenCalledWith([
      { user: 'user:u1', relation: 'admin', object: 'organization:gmt' },
    ]);
    expect(spies.syncMembershipToFGA).not.toHaveBeenCalled();
    expect(spies.syncRoleAssignment).not.toHaveBeenCalled();
  });

  it('removeRoleScoped de rol del SISTEMA (viewer) en ORGANIZATION: borra la Membership sin tocar FGA (§9-1.1)', async () => {
    const { prisma } = buildPrismaMock(freshState());
    const membershipDelete = vi.fn(() => Promise.resolve(undefined));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: membershipDelete,
      findMany: vi.fn(() => Promise.resolve([])),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const spies = withScopedFgaSpies(fga);
    const roles = buildRolesMock({ isSystem: true, roleKey: 'viewer', allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    const result = await service.removeRoleScoped('u1', {
      roleKey: 'viewer',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
    });

    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(fga.writeTuples).not.toHaveBeenCalled();
    expect(fga.deleteTuples).not.toHaveBeenCalled();
    expect(spies.syncMembershipToFGA).not.toHaveBeenCalled();
    expect(spies.syncRoleAssignment).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'u1', roleKeys: [], memberships: [] });
  });

  it('removeRoleScoped de org_admin en ORGANIZATION borra la tupla de acceso admin, sin sync de membership', async () => {
    const { prisma } = buildPrismaMock(freshState());
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: vi.fn(() => Promise.resolve(undefined)),
      findMany: vi.fn(() => Promise.resolve([])),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const spies = withScopedFgaSpies(fga);
    const roles = buildRolesMock({ isSystem: true, roleKey: 'org_admin', allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles, buildEmailMock());

    await service.removeRoleScoped('u1', {
      roleKey: 'org_admin',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
    });

    expect(fga.deleteTuples).toHaveBeenCalledTimes(1);
    expect(fga.deleteTuples).toHaveBeenCalledWith([
      { user: 'user:u1', relation: 'admin', object: 'organization:gmt' },
    ]);
    expect(fga.writeTuples).not.toHaveBeenCalled();
    expect(spies.syncMembershipToFGA).not.toHaveBeenCalled();
    expect(spies.syncRoleAssignment).not.toHaveBeenCalled();
  });
});

describe('UsersService.listProjectAdmins — dropdown filtrado por project:manage', () => {
  it('deriva los roleKeys que otorgan project:manage desde RolePermission y proyecta {id, fullName, roleKeys}', async () => {
    const rolePermissionFindMany = vi.fn(() =>
      Promise.resolve([
        { role: { key: 'admin_contrato' } },
        { role: { key: 'gerencia_proyectos' } },
        { role: { key: 'org_admin' } },
        { role: { key: 'admin_ti' } },
      ]),
    );
    const userFindMany = vi.fn(() =>
      Promise.resolve([
        {
          id: 'u1',
          firstName: 'Ana',
          secondName: null,
          lastName: 'Pérez',
          secondLastName: null,
          memberships: [{ roleKey: 'admin_contrato' }, { roleKey: 'trabajador' }],
        },
        {
          id: 'u2',
          firstName: 'Luis',
          secondName: 'Al',
          lastName: 'Soto',
          secondLastName: 'Ríos',
          memberships: [{ roleKey: 'gerencia_proyectos' }],
        },
      ]),
    );
    const prisma = {
      rolePermission: { findMany: rolePermissionFindMany },
      user: { findMany: userFindMany },
    } as unknown as PrismaService;

    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesMock(), buildEmailMock());

    const result = await service.listProjectAdmins();

    // Se consultó el permiso project:manage para derivar el set de roleKeys.
    expect(rolePermissionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { permission: { key: 'project:manage' } } }),
    );
    // Los usuarios se filtran por Membership en alguno de esos roles.
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          memberships: {
            some: { roleKey: { in: ['admin_contrato', 'gerencia_proyectos', 'org_admin', 'admin_ti'] } },
          },
        },
      }),
    );
    // fullName = nombres no vacíos unidos; roleKeys = solo los que otorgan el permiso.
    expect(result).toEqual([
      { id: 'u1', fullName: 'Ana Pérez', roleKeys: ['admin_contrato'] },
      { id: 'u2', fullName: 'Luis Al Soto Ríos', roleKeys: ['gerencia_proyectos'] },
    ]);
  });

  it('si ningún rol otorga project:manage devuelve [] sin consultar usuarios', async () => {
    const userFindMany = vi.fn(() => Promise.resolve([]));
    const prisma = {
      rolePermission: { findMany: vi.fn(() => Promise.resolve([])) },
      user: { findMany: userFindMany },
    } as unknown as PrismaService;
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesMock(), buildEmailMock());

    const result = await service.listProjectAdmins();

    expect(result).toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});

describe('UsersService — memberships en UserListItem (H13)', () => {
  it('getById expone memberships (roleKey, scopeType, scopeId) para la UI', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, usernameExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({
        id: 'u1',
        firstName: 'Ana',
        secondName: null,
        lastName: 'Pérez',
        secondLastName: null,
        email: 'ana@gmt.cl',
        username: 'ana.perez',
        emailInstitucional: 'ana@gmt.cl',
        emailPersonal: null,
        status: 'ACTIVE',
        isClientUser: false,
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        memberships: [
          { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
          { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
        ],
      }),
    );
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesMock(), buildEmailMock());

    const item = await service.getById('u1');

    expect(item.memberships).toEqual([
      { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
  });
});

describe('UsersService.list — paginación keyset (createdAt desc, desempate id)', () => {
  interface FakeListRow {
    id: string;
    firstName: string;
    secondName: string | null;
    lastName: string;
    secondLastName: string | null;
    email: string;
    username: string;
    emailInstitucional: string | null;
    emailPersonal: string | null;
    status: string;
    isClientUser: boolean;
    createdAt: Date;
    memberships: Array<{ roleKey: string }>;
  }

  function buildRow(overrides: Partial<FakeListRow> = {}): FakeListRow {
    return {
      id: 'u-1',
      firstName: 'Ana',
      secondName: null,
      lastName: 'Pérez',
      secondLastName: null,
      email: 'ana@gmt.cl',
      username: 'ana.perez',
      emailInstitucional: 'ana@gmt.cl',
      emailPersonal: null,
      status: 'ACTIVE',
      isClientUser: false,
      createdAt: new Date('2026-06-13T00:00:00.000Z'),
      memberships: [],
      ...overrides,
    };
  }

  function makeService(userFindMany: ReturnType<typeof vi.fn>): UsersService {
    const state: PrismaState = {
      rolesInCatalog: new Set(),
      emailExists: false,
      usernameExists: false,
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findMany: ReturnType<typeof vi.fn> } }).user.findMany = userFindMany;
    const fga = buildFgaMock();
    return new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesMock(), buildEmailMock());
  }

  it('devuelve nextCursor=null cuando hay menos de limit+1 filas (orden createdAt desc + id desc, take=31)', async () => {
    const userFindMany = vi.fn(() => Promise.resolve([buildRow()]));
    const service = makeService(userFindMany);

    const page = await service.list();

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 31,
      }),
    );
  });

  it('respeta el limit y calcula nextCursor (`createdAt_id`) trayendo limit+1 filas', async () => {
    const userFindMany = vi.fn(() =>
      Promise.resolve([
        buildRow({ id: 'u-1', createdAt: new Date('2026-06-13T00:00:03.000Z') }),
        buildRow({ id: 'u-2', createdAt: new Date('2026-06-13T00:00:02.000Z') }),
        buildRow({ id: 'u-3', createdAt: new Date('2026-06-13T00:00:01.000Z') }),
      ]),
    );
    const service = makeService(userFindMany);

    const page = await service.list({ limit: 2 });

    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    // Descarta el centinela: devuelve solo `limit` items.
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe('u-1');
    // nextCursor = `createdAt_id` del ÚLTIMO item real de la página (no el centinela).
    expect(page.nextCursor).toBe('2026-06-13T00:00:02.000Z_u-2');
  });

  it('tope el limit en 100 aunque se pida más', async () => {
    const userFindMany = vi.fn(() => Promise.resolve([]));
    const service = makeService(userFindMany);

    await service.list({ limit: 5000 });

    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });

  it('search arma el OR case-insensitive sobre nombre/apellido/email/username', async () => {
    const userFindMany = vi.fn<(args: { where: unknown }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const service = makeService(userFindMany);

    await service.list({ search: 'ana' });

    const call = userFindMany.mock.calls[0]?.[0] as { where: unknown };
    expect(call.where).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: 'ana', mode: 'insensitive' } },
            { lastName: { contains: 'ana', mode: 'insensitive' } },
            { secondName: { contains: 'ana', mode: 'insensitive' } },
            { secondLastName: { contains: 'ana', mode: 'insensitive' } },
            { email: { contains: 'ana', mode: 'insensitive' } },
            { username: { contains: 'ana', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('keyset: desempata por id cuando createdAt coincide con el cursor', async () => {
    const userFindMany = vi.fn<(args: { where: unknown }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const service = makeService(userFindMany);

    await service.list({ cursor: '2026-06-13T00:00:02.000Z_u-2' });

    const call = userFindMany.mock.calls[0]?.[0] as { where: unknown };
    expect(call.where).toEqual({
      AND: [
        {
          OR: [
            { createdAt: { lt: new Date('2026-06-13T00:00:02.000Z') } },
            { createdAt: new Date('2026-06-13T00:00:02.000Z'), id: { lt: 'u-2' } },
          ],
        },
      ],
    });
  });

  it('cursor mal formado se ignora en vez de romper la página', async () => {
    const userFindMany = vi.fn<(args: { where: unknown }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const service = makeService(userFindMany);

    await service.list({ cursor: 'no-es-un-cursor-valido' });

    const call = userFindMany.mock.calls[0]?.[0] as { where: unknown };
    expect(call.where).toEqual({});
  });
});
