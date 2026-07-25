import 'reflect-metadata';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import { DirectoryService } from '../../src/modules/directory/directory.service';

/** Fila de usuario en la "BD" simulada. */
interface FakeUserRow {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  avatarUrl: string | null;
  status: string;
  points: number;
  isClientUser: boolean;
  cargo: string | null;
  memberships: Array<{ roleKey: string; scopeType: string; scopeId: string }>;
}

function makeUser(overrides: Partial<FakeUserRow> & Pick<FakeUserRow, 'id'>): FakeUserRow {
  return {
    firstName: 'Nom',
    secondName: null,
    lastName: 'Ape',
    secondLastName: null,
    email: `${overrides.id}@gmt.cl`,
    avatarUrl: null,
    status: 'ACTIVE',
    points: 0,
    isClientUser: false,
    cargo: 'Operador',
    memberships: [],
    ...overrides,
  };
}

/**
 * "BD" en memoria con un evaluador mínimo del `where` que arma el service:
 * soporta `{ isClientUser }`, `{ OR: [...] }` (contains insensitive), y
 * la combinación `{ AND: [...] }`. Suficiente para verificar aislamiento + search.
 */
const DB: FakeUserRow[] = [
  makeUser({ id: 'colab-ana', firstName: 'Ana', lastName: 'Pérez', email: 'ana@gmt.cl', isClientUser: false }),
  makeUser({
    id: 'colab-beto',
    firstName: 'Beto',
    lastName: 'Lagos',
    email: 'beto@gmt.cl',
    isClientUser: false,
    // CLAVE de storage (avatar subido): la vista la resuelve a URL fresca.
    avatarUrl: 'users/colab-beto/avatar/uuid-b.png',
  }),
  makeUser({
    id: 'cli-carla',
    firstName: 'Carla',
    lastName: 'Ruiz',
    email: 'carla@acme.cl',
    isClientUser: true,
    cargo: 'ITO',
    // URL externa (pegada a mano en el perfil): passthrough tal cual.
    avatarUrl: 'https://gravatar.com/avatar/carla',
  }),
  makeUser({
    id: 'cli-dario',
    firstName: 'Darío',
    lastName: 'Mena',
    email: 'dario@acme.cl',
    isClientUser: true,
    cargo: 'ITO',
  }),
];

type WhereInput = Record<string, unknown> | undefined;

function matchesContains(row: FakeUserRow, fragment: string): boolean {
  const f = fragment.toLowerCase();
  return [row.firstName, row.secondName, row.lastName, row.secondLastName, row.email].some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(f),
  );
}

function rowMatches(row: FakeUserRow, where: WhereInput): boolean {
  if (!where) return true;
  if ('AND' in where && Array.isArray(where.AND)) {
    return (where.AND as WhereInput[]).every((cond) => rowMatches(row, cond));
  }
  if ('isClientUser' in where) {
    if (row.isClientUser !== where.isClientUser) return false;
  }
  if ('OR' in where && Array.isArray(where.OR)) {
    const fragments = (where.OR as Array<Record<string, { contains?: string }>>)
      .map((cond) => Object.values(cond)[0]?.contains)
      .filter((v): v is string => typeof v === 'string');
    const fragment = fragments[0];
    if (fragment !== undefined && !matchesContains(row, fragment)) return false;
  }
  return true;
}

function buildService(): { service: DirectoryService } {
  const findMany = vi.fn(
    (args: { where?: WhereInput }): Promise<FakeUserRow[]> =>
      Promise.resolve(DB.filter((r) => rowMatches(r, args.where))),
  );
  const findUnique = vi.fn(
    (args: { where: { id: string }; select?: { isClientUser: true } }): Promise<unknown> => {
      const row = DB.find((r) => r.id === args.where.id) ?? null;
      if (row && args.select?.isClientUser) {
        return Promise.resolve({ isClientUser: row.isClientUser });
      }
      return Promise.resolve(row);
    },
  );

  const prisma = { user: { findMany, findUnique } } as unknown as PrismaService;
  // Storage NO-R2 (dev): freshFileUrl resuelve claves a /files/ del FilesController.
  const storage = {} as unknown as StorageService;
  return { service: new DirectoryService(prisma, storage) };
}

describe('DirectoryService.list — aislamiento cliente/colaborador (§3.4)', () => {
  it('un COLABORADOR ve a todos (colaboradores y clientes)', async () => {
    const { service } = buildService();
    const result = await service.list('colab-ana');
    expect(result.map((e) => e.id).sort()).toEqual(
      ['cli-carla', 'cli-dario', 'colab-ana', 'colab-beto'].sort(),
    );
  });

  it('un CLIENTE ve SOLO colaboradores (nunca a otros clientes)', async () => {
    const { service } = buildService();
    const result = await service.list('cli-carla');
    expect(result.map((e) => e.id).sort()).toEqual(['colab-ana', 'colab-beto'].sort());
    expect(result.every((e) => e.isClientUser === false)).toBe(true);
  });

  it('resuelve la CLAVE del avatar a URL fresca y hace passthrough de URLs externas', async () => {
    const { service } = buildService();
    const result = await service.list('colab-ana');
    const byId = new Map(result.map((e) => [e.id, e.avatarUrl]));
    expect(byId.get('colab-beto')).toBe(
      'http://localhost:3001/files/users/colab-beto/avatar/uuid-b.png',
    );
    expect(byId.get('cli-carla')).toBe('https://gravatar.com/avatar/carla');
    expect(byId.get('colab-ana')).toBeNull();
  });

  it('expone solo campos BÁSICOS (sin status ni points)', async () => {
    const { service } = buildService();
    const [entry] = await service.list('colab-ana');
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ['avatarUrl', 'cargo', 'companyName', 'email', 'firstName', 'id', 'isClientUser', 'lastName', 'roleKeys'].sort(),
    );
  });
});

describe('DirectoryService.list — búsqueda server-side', () => {
  it('filtra por nombre (insensible a mayúsculas)', async () => {
    const { service } = buildService();
    const result = await service.list('colab-ana', 'beto');
    expect(result.map((e) => e.id)).toEqual(['colab-beto']);
  });

  it('filtra por email', async () => {
    const { service } = buildService();
    const result = await service.list('colab-ana', 'acme');
    expect(result.map((e) => e.id).sort()).toEqual(['cli-carla', 'cli-dario'].sort());
  });

  it('combina aislamiento + búsqueda: un cliente buscando "acme" no encuentra clientes', async () => {
    const { service } = buildService();
    const result = await service.list('cli-carla', 'acme');
    expect(result).toEqual([]);
  });
});

describe('DirectoryService.getBasic / getExtended — aislamiento en el detalle', () => {
  it('un colaborador obtiene el detalle básico de cualquiera', async () => {
    const { service } = buildService();
    const entry = await service.getBasic('colab-ana', 'cli-carla');
    expect(entry.id).toBe('cli-carla');
  });

  it('un cliente NO puede ver el detalle de otro cliente (404, no revela existencia)', async () => {
    const { service } = buildService();
    await expect(service.getBasic('cli-carla', 'cli-dario')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getExtended incluye campos internos (status, points, segundos nombres)', async () => {
    const { service } = buildService();
    const entry = await service.getExtended('colab-ana', 'colab-beto');
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('points');
    expect(entry).toHaveProperty('secondName');
    expect(entry).toHaveProperty('secondLastName');
  });

  it('getExtended respeta el aislamiento cliente (404 a otro cliente)', async () => {
    const { service } = buildService();
    await expect(service.getExtended('cli-carla', 'cli-dario')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 si la persona no existe', async () => {
    const { service } = buildService();
    await expect(service.getBasic('colab-ana', 'no-existe')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DirectoryService — solicitante inexistente', () => {
  it('401 si el usuario de la sesión ya no existe en Postgres', async () => {
    const { service } = buildService();
    await expect(service.list('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
