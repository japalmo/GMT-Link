import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseService } from '../../src/auth/firebase.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
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
  status: string;
  isClientUser: boolean;
  createdAt: Date;
  memberships: Array<{ roleKey: string }>;
}

/** Estado mutable que respalda los mocks de Prisma. */
interface PrismaState {
  rolesInCatalog: Set<string>;
  emailExists: boolean;
  failPersist: boolean;
}

function buildPrismaMock(state: PrismaState): {
  prisma: PrismaService;
  createdRow: () => FakeUserRow | null;
} {
  let created: FakeUserRow | null = null;

  const userCreate = vi.fn(
    (args: {
      data: {
        firstName: string;
        secondName: string | null;
        lastName: string;
        secondLastName: string | null;
        email: string;
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
        status: args.data.status,
        isClientUser: args.data.isClientUser,
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        memberships: args.data.memberships.create.map((m) => ({ roleKey: m.roleKey })),
      };
      created = row;
      return Promise.resolve(row);
    },
  );

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
        (): Promise<{ id: string } | null> =>
          Promise.resolve(state.emailExists ? { id: 'existing' } : null),
      ),
      create: userCreate,
      delete: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
    },
    membership: {
      deleteMany: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
    },
    // $transaction ejecuta el callback con un tx que reusa los mismos mocks.
    $transaction: vi.fn(
      <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(prismaLike),
    ),
  };

  return {
    prisma: prismaLike as unknown as PrismaService,
    createdRow: () => created,
  };
}

function buildFirebaseMock(opts: { uid?: string } = {}): {
  firebase: FirebaseService;
  createUser: ReturnType<typeof vi.fn>;
  deleteUser: ReturnType<typeof vi.fn>;
} {
  const createUser = vi.fn(
    (): Promise<{ uid: string }> => Promise.resolve({ uid: opts.uid ?? 'fb-uid' }),
  );
  const deleteUser = vi.fn((): Promise<void> => Promise.resolve());
  return {
    firebase: { createUser, deleteUser } as unknown as FirebaseService,
    createUser,
    deleteUser,
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

function validDto(overrides: Partial<CreateUserDto> = {}): CreateUserDto {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@gmt.cl',
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

describe('UsersService.create', () => {
  let state: PrismaState;

  beforeEach(() => {
    state = { rolesInCatalog: new Set(ALL_ROLES), emailExists: false, failPersist: false };
  });

  it('crea el usuario, asigna memberships, llama syncMembershipToFGA y retorna la clave provisoria', async () => {
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock({ uid: 'fb-123' });
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    const result = await service.create(validDto());

    // Se crea el usuario Firebase con la clave provisoria generada y emailVerified.
    expect(fb.createUser).toHaveBeenCalledTimes(1);
    const fbArg = fb.createUser.mock.calls[0]?.[0] as {
      email: string;
      password: string;
      emailVerified?: boolean;
    };
    expect(fbArg.email).toBe('ana@gmt.cl');
    expect(fbArg.emailVerified).toBe(true);
    expect(fbArg.password).toBe(result.provisionalPassword);
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
      firstName: 'Ana',
      lastName: 'Pérez',
      status: 'PENDING_FIRST_LOGIN',
      roleKeys: ['operator', 'viewer'],
    });
  });

  it('si trae org_admin, escribe acceso member + admin en FGA', async () => {
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    await service.create(validDto({ roleKeys: ['org_admin'] }));

    expect(fga.writeTuples).toHaveBeenCalledTimes(1);
    expect(fga.writeTuples).toHaveBeenCalledWith([
      { user: 'user:user-generated-id', relation: 'member', object: 'organization:gmt' },
      { user: 'user:user-generated-id', relation: 'admin', object: 'organization:gmt' },
    ]);
  });

  it('NO persiste la clave provisoria en claro (no aparece en los datos guardados en Postgres)', async () => {
    const { prisma, createdRow } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    const result = await service.create(validDto());

    const row = createdRow();
    expect(row).not.toBeNull();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(result.provisionalPassword);
  });

  it('rechaza (400) roleKeys que no existen en el catálogo de la BD', async () => {
    state.rolesInCatalog = new Set(['operator']); // 'viewer' no está en la BD
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    await expect(service.create(validDto({ roleKeys: ['operator', 'viewer'] }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No se debe haber tocado Firebase si la validación falla antes.
    expect(fb.createUser).not.toHaveBeenCalled();
  });

  it('rechaza (409) si el email ya existe en Postgres y no crea en Firebase', async () => {
    state.emailExists = true;
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    await expect(service.create(validDto())).rejects.toBeInstanceOf(ConflictException);
    expect(fb.createUser).not.toHaveBeenCalled();
  });

  it('compensa borrando el usuario Firebase si falla la persistencia en Postgres', async () => {
    state.failPersist = true;
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock({ uid: 'fb-orphan' });
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    await expect(service.create(validDto())).rejects.toThrow();
    expect(fb.createUser).toHaveBeenCalledTimes(1);
    expect(fb.deleteUser).toHaveBeenCalledWith('fb-orphan');
  });

  it('compensa (borra User + Firebase) si falla el sync FGA tras crear en Postgres', async () => {
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock({ uid: 'fb-456' });
    const fga = buildFgaMock({ fail: true });
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    await expect(service.create(validDto())).rejects.toThrow();
    expect(fb.deleteUser).toHaveBeenCalledWith('fb-456');
  });
});

describe('UsersService.importBatch', () => {
  it('continúa ante una fila mala: acumula errores sin abortar el lote', async () => {
    const state: PrismaState = {
      // 'viewer' NO está en el catálogo: la segunda fila debe fallar.
      rolesInCatalog: new Set(['operator']),
      emailExists: false,
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    const result = await service.importBatch([
      validDto({ email: 'ok@gmt.cl', roleKeys: ['operator'] }),
      validDto({ email: 'bad@gmt.cl', roleKeys: ['viewer'] }),
      validDto({ email: 'ok2@gmt.cl', roleKeys: ['operator'] }),
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
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    // Filas CRUDAS (como llegan del CSV): la del medio tiene email inválido.
    const result = await service.importBatch([
      { firstName: 'Ana', lastName: 'Pérez', email: 'ok@gmt.cl', roleKeys: ['operator'] },
      { firstName: 'Mal', lastName: 'Correo', email: 'no-es-un-email', roleKeys: ['operator'] },
      { firstName: 'Eva', lastName: 'Soto', email: 'ok2@gmt.cl', roleKeys: ['operator'] },
    ]);

    // Las dos filas buenas se importan; la mala no tumba el lote.
    expect(result.created.map((c) => c.email)).toEqual(['ok@gmt.cl', 'ok2@gmt.cl']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
    expect(result.errors[0]?.email).toBe('no-es-un-email');
    // No se intentó crear en Firebase la fila inválida (solo las 2 buenas).
    expect(fb.createUser).toHaveBeenCalledTimes(2);
  });

  it('una fila que no es objeto cae en errors sin romper el proceso', async () => {
    const state: PrismaState = {
      rolesInCatalog: new Set(ALL_ROLES),
      emailExists: false,
      failPersist: false,
    };
    const { prisma } = buildPrismaMock(state);
    const fb = buildFirebaseMock();
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fb.firebase, fga.fga);

    const result = await service.importBatch([
      { firstName: 'Ana', lastName: 'Pérez', email: 'ok@gmt.cl', roleKeys: ['operator'] },
      'fila-corrupta',
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
  });
});
