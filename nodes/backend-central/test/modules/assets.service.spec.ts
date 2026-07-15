import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssetStatus, AssetType, DocumentStatus, ScopeType, UsageCycleStatus } from '@prisma/client';
import type {
  Asset,
  AssetAccessory,
  AssetDocument,
  AssetHistoryEntry,
  ChecklistSubmission,
  ChecklistTemplate,
  User,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { PermissionService } from '../../src/authz/permission.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';
import { AssetsService } from '../../src/modules/assets/assets.service';
import { formatSvgAnswerValue } from '../../src/modules/assets/checklist-pdf.util';

function buildUserRow(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    firstName: 'Juan',
    secondName: null,
    lastName: 'Pérez',
    secondLastName: null,
    username: 'juan',
    email: 'juan@gmt.cl',
    emailInstitucional: 'juan@gmt.cl',
    emailPersonal: null,
    emailInstitucionalVerified: null,
    emailPersonalVerified: null,
    pendingEmail: null,
    pendingEmailKind: null,
    passwordHash: null,
    avatarUrl: null,
    cargo: null,
    status: 'ACTIVE',
    tokenVersion: 0,
    firstLoginAt: null,
    points: 10,
    isClientUser: false,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildAssetRow(overrides: Partial<Asset> = {}): Asset {
  const now = new Date('2026-06-16T00:00:00.000Z');
  return {
    id: 'a-1',
    code: 'GMT-EQ-0001',
    publicToken: 'tok-a-1',
    type: AssetType.EQUIPO,
    name: 'Generador 5kW',
    description: 'Generador de respaldo',
    manufacturer: null,
    identifier: null,
    identifierType: null,
    vehicleSubtype: null,
    status: AssetStatus.DISPONIBLE,
    createdById: null,
    projectId: null,
    assignedToId: null,
    inUseById: null,
    inUseSince: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildDocRow(overrides: Partial<AssetDocument> = {}): AssetDocument {
  const now = new Date('2026-06-16T00:00:00.000Z');
  return {
    id: 'doc-1',
    assetId: 'a-1',
    name: 'Certificación anual',
    type: 'CERT',
    fileUrl: 'http://localhost/cert.pdf',
    status: DocumentStatus.EN_REVISION,
    expirationDate: null,
    previousFileUrl: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildHistoryRow(overrides: Partial<AssetHistoryEntry> = {}): AssetHistoryEntry {
  return {
    id: 'h-1',
    assetId: 'a-1',
    type: 'CREADO',
    description: 'Creado',
    actorId: 'u-1',
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    ...overrides,
  };
}

function buildAccessoryRow(overrides: Partial<AssetAccessory> = {}): AssetAccessory {
  return {
    id: 'acc-1',
    assetId: 'a-1',
    name: 'Cable cargador',
    description: 'Cable USB-C',
    serialNumber: 'SN-ACC-01',
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    updatedAt: new Date('2026-06-16T00:00:00.000Z'),
    ...overrides,
  };
}

function buildTemplateRow(overrides: Partial<ChecklistTemplate> = {}): ChecklistTemplate {
  return {
    id: 'tpl-1',
    assetId: 'a-1',
    name: 'Checklist mensual',
    items: [],
    sections: null,
    status: DocumentStatus.APROBADO,
    previousItems: null,
    reviewedById: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    updatedAt: new Date('2026-06-16T00:00:00.000Z'),
    ...overrides,
  };
}

function buildSubmissionRow(overrides: Partial<ChecklistSubmission> = {}): ChecklistSubmission {
  return {
    id: 'sub-1',
    assetId: 'a-1',
    templateId: 'tpl-1',
    userId: 'u-1',
    answers: [],
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Fila de UsageCycle con el include del service (`user` + `handoffTo`) ya resuelto,
 * lista para `toUsageCycleView`. Por defecto: ciclo EN_PREPARACION del usuario u-1.
 */
function buildUsageCycleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-06-16T00:00:00.000Z');
  return {
    id: 'cyc-1',
    assetId: 'a-1',
    userId: 'u-1',
    status: UsageCycleStatus.EN_PREPARACION,
    startedAt: now,
    confirmedAt: null,
    endedAt: null,
    checklistSubmissionId: null,
    startPhotoUrl: null,
    startPhotoKey: null,
    endPhotoUrl: null,
    endPhotoKey: null,
    endKind: null,
    endLatitude: null,
    endLongitude: null,
    endText: null,
    handoffToUserId: null,
    createdAt: now,
    updatedAt: now,
    user: { id: 'u-1', firstName: 'Juan', lastName: 'Pérez' },
    handoffTo: null,
    ...overrides,
  };
}

type MockFunction = ReturnType<typeof vi.fn>;

interface MockTx {
  asset: {
    create: MockFunction;
    update: MockFunction;
    updateMany: MockFunction;
  };
  assetDocument: {
    create: MockFunction;
    update: MockFunction;
  };
  assetHistoryEntry: {
    create: MockFunction;
  };
  user: {
    findUnique: MockFunction;
  };
  assetAccessory: {
    create: MockFunction;
    update: MockFunction;
    delete: MockFunction;
  };
  checklistTemplate: {
    create: MockFunction;
    update: MockFunction;
  };
  checklistSubmission: {
    create: MockFunction;
    delete: MockFunction;
  };
  usageCycle: {
    create: MockFunction;
    update: MockFunction;
    updateMany: MockFunction;
  };
}

interface MockPrisma {
  $transaction: MockFunction;
  asset: {
    count: MockFunction;
    findFirst: MockFunction;
    findUnique: MockFunction;
    findMany: MockFunction;
    findUniqueOrThrow: MockFunction;
  };
  user: {
    findUnique: MockFunction;
  };
  usageCycle: {
    create: MockFunction;
    findUnique: MockFunction;
    findMany: MockFunction;
    update: MockFunction;
    findUniqueOrThrow: MockFunction;
  };
  membership: {
    findFirst: MockFunction;
    findMany: MockFunction;
  };
  project: {
    findMany: MockFunction;
  };
  assetDocument: {
    findMany: MockFunction;
    findUnique: MockFunction;
  };
  assetHistoryEntry: {
    findMany: MockFunction;
  };
  assetAccessory: {
    findMany: MockFunction;
    findUnique: MockFunction;
  };
  checklistTemplate: {
    findUnique: MockFunction;
    create: MockFunction;
    update: MockFunction;
  };
  checklistSubmission: {
    create: MockFunction;
    findMany: MockFunction;
    findUnique: MockFunction;
  };
}

interface MockFga {
  check: MockFunction;
  writeTuples: MockFunction;
  deleteTuples: MockFunction;
}

interface MockStorage {
  save: MockFunction;
}

interface MockPermissions {
  scopeFilter: MockFunction;
  can: MockFunction;
}

describe('AssetsService', () => {
  let prismaMock: MockPrisma;
  let txMock: MockTx;
  let fgaMock: MockFga;
  let storageMock: MockStorage;
  let permissionsMock: MockPermissions;
  let service: AssetsService;

  beforeEach(() => {
    txMock = {
      asset: {
        create: vi.fn((args) => Promise.resolve(buildAssetRow(args.data))),
        update: vi.fn((args) => Promise.resolve(buildAssetRow(args.data))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      assetDocument: {
        create: vi.fn((args) => Promise.resolve(buildDocRow(args.data))),
        update: vi.fn((args) => Promise.resolve(buildDocRow(args.data))),
      },
      assetHistoryEntry: {
        create: vi.fn((args) => Promise.resolve(buildHistoryRow(args.data))),
      },
      user: {
        findUnique: vi.fn(() => Promise.resolve(buildUserRow())),
      },
      assetAccessory: {
        create: vi.fn((args) => Promise.resolve(buildAccessoryRow(args.data))),
        update: vi.fn((args) => Promise.resolve(buildAccessoryRow(args.data))),
        delete: vi.fn(() => Promise.resolve(undefined)),
      },
      checklistTemplate: {
        create: vi.fn((args) => Promise.resolve(buildTemplateRow(args.data))),
        update: vi.fn((args) => Promise.resolve(buildTemplateRow(args.data))),
      },
      checklistSubmission: {
        create: vi.fn((args) => Promise.resolve(buildSubmissionRow(args.data))),
        delete: vi.fn(() => Promise.resolve(undefined)),
      },
      usageCycle: {
        create: vi.fn((args) => Promise.resolve(buildUsageCycleRow(args.data))),
        update: vi.fn((args) => Promise.resolve(buildUsageCycleRow(args.data))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
    };

    prismaMock = {
      $transaction: vi.fn((cb) => cb(txMock)),
      asset: {
        count: vi.fn(() => Promise.resolve(0)),
        findFirst: vi.fn(() => Promise.resolve(null)),
        findUnique: vi.fn(),
        findMany: vi.fn(() => Promise.resolve([])),
        // Default con include resuelto (project/assignedTo/inUseBy) para que
        // `loadUsageCycleResult` (re-lee el activo tras las mutaciones del ciclo)
        // funcione sin re-mockear en cada test. Los tests que necesitan un estado
        // concreto lo sobrescriben con `mockResolvedValueOnce`.
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({ ...buildAssetRow(), project: null, assignedTo: null, inUseBy: null }),
        ),
      },
      user: {
        findUnique: vi.fn(() => Promise.resolve(buildUserRow())),
      },
      usageCycle: {
        create: vi.fn((args) => Promise.resolve(buildUsageCycleRow(args.data))),
        findUnique: vi.fn(),
        findMany: vi.fn(() => Promise.resolve([])),
        update: vi.fn((args) => Promise.resolve(buildUsageCycleRow(args.data))),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(buildUsageCycleRow())),
      },
      membership: {
        findFirst: vi.fn(() => Promise.resolve(null)),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      project: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
      assetDocument: {
        findMany: vi.fn(() => Promise.resolve([])),
        findUnique: vi.fn(),
      },
      assetHistoryEntry: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
      assetAccessory: {
        findMany: vi.fn(() => Promise.resolve([])),
        findUnique: vi.fn(),
      },
      checklistTemplate: {
        findUnique: vi.fn(),
        create: vi.fn((args) => Promise.resolve(buildTemplateRow(args.data))),
        update: vi.fn((args) => Promise.resolve(buildTemplateRow(args.data))),
      },
      checklistSubmission: {
        create: vi.fn((args) => Promise.resolve(buildSubmissionRow(args.data))),
        findMany: vi.fn(() => Promise.resolve([])),
        findUnique: vi.fn(),
      },
    };

    fgaMock = {
      check: vi.fn(() => Promise.resolve({ allowed: true })),
      writeTuples: vi.fn(() => Promise.resolve(undefined)),
      deleteTuples: vi.fn(() => Promise.resolve(undefined)),
    };

    storageMock = {
      save: vi.fn(() => Promise.resolve({ url: 'http://localhost/new.pdf' })),
    };

    // Por defecto: lector GLOBAL (asset:read con scope none) => ve todo. Cada
    // test que necesite otro scope lo sobrescribe con mockResolvedValueOnce.
    permissionsMock = {
      scopeFilter: vi.fn(() => Promise.resolve({ kind: 'none' })),
      // Por defecto SIN el permiso funcional global: la ejecución del checklist
      // cae al gate estructural (fga.check, que el mock resuelve truthy).
      can: vi.fn(() => Promise.resolve({ effect: 'deny' })),
    };

    service = new AssetsService(
      prismaMock as unknown as PrismaService,
      fgaMock as unknown as FgaService,
      storageMock as unknown as StorageService,
      { awardPoints: vi.fn(() => Promise.resolve()) } as unknown as GamificationService,
      permissionsMock as unknown as PermissionService,
    );
  });

  describe('create', () => {
    it('crea un activo correctamente y genera su código', async () => {
      prismaMock.asset.count.mockResolvedValueOnce(0);
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({ id: 'a-new', code: 'GMT-EQ-0001', assignedToId: 'u-1' }),
        project: null,
        assignedTo: buildUserRow(),
        inUseBy: null,
      });

      const result = await service.create('u-1', {
        type: AssetType.EQUIPO,
        name: 'Generador 5kW',
        description: 'Generador de respaldo',
        assignedToId: 'u-1',
      });

      expect(prismaMock.asset.count).toHaveBeenCalledWith({ where: { type: AssetType.EQUIPO } });
      expect(txMock.asset.create).toHaveBeenCalled();
      expect(fgaMock.writeTuples).toHaveBeenCalledWith([
        { user: 'user:u-1', relation: 'assigned', object: 'asset:a-1' },
      ]);
      expect(txMock.assetHistoryEntry.create).toHaveBeenCalled();
      expect(result.code).toBe('GMT-EQ-0001');
    });

    it('usa el prefijo GMT-MQ y persiste fabricante/identificador para MAQUINARIA', async () => {
      prismaMock.asset.count.mockResolvedValueOnce(0);
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({
          id: 'a-mq',
          code: 'GMT-MQ-0001',
          type: AssetType.MAQUINARIA,
          manufacturer: 'Caterpillar',
          identifier: 'SER-123',
          identifierType: 'NUMERO_SERIE',
        }),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });

      const result = await service.create('u-1', {
        type: AssetType.MAQUINARIA,
        name: 'Excavadora 320',
        manufacturer: 'Caterpillar',
        identifier: 'SER-123',
        identifierType: 'NUMERO_SERIE',
      });

      expect(prismaMock.asset.count).toHaveBeenCalledWith({ where: { type: AssetType.MAQUINARIA } });
      const createArg = txMock.asset.create.mock.calls[0]?.[0] as {
        data: { code: string; manufacturer: string | null; identifier: string | null };
      };
      expect(createArg.data.code).toBe('GMT-MQ-0001');
      expect(createArg.data.manufacturer).toBe('Caterpillar');
      expect(createArg.data.identifier).toBe('SER-123');
      expect(result.code).toBe('GMT-MQ-0001');
      expect(result.manufacturer).toBe('Caterpillar');
    });

    it('rechaza (409) al crear un activo con patente duplicada', async () => {
      // findFirst devuelve un activo existente con el mismo (identifierType, identifier).
      prismaMock.asset.findFirst.mockResolvedValueOnce(
        buildAssetRow({ id: 'a-existente', identifier: 'ABCD12', identifierType: 'PATENTE' }),
      );

      await expect(
        service.create('u-1', {
          type: AssetType.VEHICULO,
          name: 'Camioneta Hilux',
          identifier: 'ABCD12',
          identifierType: 'PATENTE',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith({
        where: { identifier: 'ABCD12', identifierType: 'PATENTE' },
      });
      // No debe intentar crear el activo si la validación de unicidad falla.
      expect(txMock.asset.create).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('lista TODOS los activos (incluidos los de proyecto) con asset:read GLOBAL (kind none)', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'none' });
      prismaMock.asset.findMany.mockResolvedValueOnce([
        { ...buildAssetRow({ projectId: 'p-9' }), project: null, assignedTo: null, inUseBy: null },
        { ...buildAssetRow({ id: 'a-2', projectId: null }), project: null, assignedTo: null, inUseBy: null },
      ]);

      const page = await service.listAll('u-admin');

      expect(page.items.length).toBe(2);
      // Menos de limit+1 filas => no hay página siguiente.
      expect(page.nextCursor).toBeNull();
      // GLOBAL => sin restricción de projectId; orden estable code asc; limit+1 filas.
      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, orderBy: { code: 'asc' }, take: 31 }),
      );
      // No se consultan membresías cuando el scope es GLOBAL.
      expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
    });

    it('lista proyectos asignados + globales con asset:read de PROJECT (kind projects)', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'projects', ids: ['p1'] });
      prismaMock.asset.findMany.mockResolvedValueOnce([]);

      await service.listAll('u-proj');

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { projectId: { in: ['p1'] } },
              { projectId: null },
            ],
          },
        }),
      );
    });

    it('cae al filtro por membresías cuando no tiene asset:read (scopeFilter null)', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce(null);
      prismaMock.membership.findMany.mockResolvedValueOnce([
        { scopeType: ScopeType.PROJECT, scopeId: 'p-1' },
      ]);
      prismaMock.project.findMany.mockResolvedValueOnce([{ id: 'p-1' }]);
      prismaMock.asset.findMany.mockResolvedValueOnce([]);

      await service.listAll('u-normal');

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { projectId: { in: ['p-1'] } },
              { projectId: null },
            ],
          },
        }),
      );
    });

    it('respeta el limit y calcula nextCursor trayendo limit+1 filas', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'none' });
      // Con limit=2 se piden 3 filas; la 3ª es el centinela que indica "hay más".
      prismaMock.asset.findMany.mockResolvedValueOnce([
        { ...buildAssetRow({ id: 'a-1', code: 'GMT-EQ-0001' }), project: null, assignedTo: null, inUseBy: null },
        { ...buildAssetRow({ id: 'a-2', code: 'GMT-EQ-0002' }), project: null, assignedTo: null, inUseBy: null },
        { ...buildAssetRow({ id: 'a-3', code: 'GMT-EQ-0003' }), project: null, assignedTo: null, inUseBy: null },
      ]);

      const page = await service.listAll('u-admin', { limit: 2 });

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3, orderBy: { code: 'asc' } }),
      );
      // Descarta el centinela: devuelve solo `limit` items.
      expect(page.items).toHaveLength(2);
      expect(page.items[0]?.code).toBe('GMT-EQ-0001');
      // nextCursor = code del ÚLTIMO item real de la página (no el centinela).
      expect(page.nextCursor).toBe('GMT-EQ-0002');
    });

    it('tope el limit en 100 aunque se pida más', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'none' });
      prismaMock.asset.findMany.mockResolvedValueOnce([]);

      await service.listAll('u-admin', { limit: 5000 });

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 101 }),
      );
    });

    it('search arma el OR case-insensitive sobre code/name/description', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'none' });
      prismaMock.asset.findMany.mockResolvedValueOnce([]);

      await service.listAll('u-admin', { search: 'genera' });

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: {
              OR: [
                { code: { contains: 'genera', mode: 'insensitive' } },
                { name: { contains: 'genera', mode: 'insensitive' } },
                { description: { contains: 'genera', mode: 'insensitive' } },
              ],
            },
          }),
        }),
      );
    });

    it('keyset: usa code > cursor sobre el orden code asc', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'none' });
      prismaMock.asset.findMany.mockResolvedValueOnce([]);

      await service.listAll('u-admin', { cursor: 'GMT-EQ-0005' });

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ code: { gt: 'GMT-EQ-0005' } }),
          orderBy: { code: 'asc' },
        }),
      );
    });
  });

  describe('getById', () => {
    it('un lector GLOBAL (asset:read none) ve la ficha de un activo de proyecto sin tupla FGA', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce({ kind: 'none' });
      prismaMock.asset.findUnique.mockResolvedValueOnce({
        ...buildAssetRow({ projectId: 'p-9' }),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });

      const asset = await service.getById('a-1', 'u-admin');

      expect(asset.id).toBe('a-1');
      // GLOBAL cortocircuita: no se consulta la tupla por-activo en OpenFGA.
      expect(fgaMock.check).not.toHaveBeenCalled();
    });

    it('un conductor sin asset:read VE la ficha de un vehículo de flota (global) por asset:use:report', async () => {
      // Regresión del hallazgo HIGH: el conductor toma el vehículo pero antes no
      // podía abrir su ficha ni el checklist (canViewAsset devolvía false para el
      // activo global). Ahora el permiso de conductor concede ver la flota.
      permissionsMock.scopeFilter.mockResolvedValueOnce(null); // sin asset:read
      permissionsMock.can.mockResolvedValue({ effect: 'allow' }); // asset:use:report / checklist:run:any
      prismaMock.asset.findUnique.mockResolvedValueOnce({
        ...buildAssetRow({ projectId: null }),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });

      const asset = await service.getById('a-1', 'u-cond');

      expect(asset.id).toBe('a-1');
      // Se concede por el permiso funcional: no cae al respaldo estructural FGA.
      expect(fgaMock.check).not.toHaveBeenCalled();
    });

    it('sin asset:read pero con tupla can_view_list sigue viendo la ficha (fallback FGA)', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce(null);
      prismaMock.asset.findUnique.mockResolvedValueOnce({
        ...buildAssetRow(),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });
      fgaMock.check.mockResolvedValueOnce(true);

      const asset = await service.getById('a-1', 'u-1');

      expect(asset.id).toBe('a-1');
      expect(fgaMock.check).toHaveBeenCalledWith({
        user: 'user:u-1',
        relation: 'can_view_list',
        object: 'asset:a-1',
      });
    });

    it('sin asset:read ni tupla FGA lanza NotFoundException', async () => {
      permissionsMock.scopeFilter.mockResolvedValueOnce(null);
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow());
      fgaMock.check.mockResolvedValueOnce(false);

      await expect(service.getById('a-1', 'u-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicByToken', () => {
    it('busca por token opaco (no por código) y devuelve solo campos no sensibles', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce({
        ...buildAssetRow({
          code: 'GMT-EQ-0001',
          publicToken: 'tok-xyz',
          identifier: 'ABCD12',
          identifierType: 'PATENTE',
          assignedToId: 'u-1',
          inUseById: 'u-2',
        }),
        project: { id: 'p-1', name: 'Proyecto Norte' },
        assignedTo: buildUserRow({ firstName: 'Juan', lastName: 'Pérez' }),
        inUseBy: buildUserRow({ id: 'u-2', firstName: 'Ana', lastName: 'Soto' }),
        documents: [],
        checklistSubmissions: [],
      });

      const view = await service.getPublicByToken('tok-xyz');

      // GAP 3: la consulta pública es por publicToken opaco, NO por el code enumerable.
      expect(prismaMock.asset.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { publicToken: 'tok-xyz' } }),
      );
      expect(view.code).toBe('GMT-EQ-0001');
      expect(view.project).toEqual({ name: 'Proyecto Norte' });
      // No debe filtrar el identificador ni nombres de personas.
      expect(view).not.toHaveProperty('identifier');
      expect(view).not.toHaveProperty('identifierType');
      expect(view).not.toHaveProperty('assignedTo');
      expect(view).not.toHaveProperty('inUseBy');
      // Tanda 5.2: sin docs ni inspecciones → arrays/null vacíos.
      expect(view.documents).toEqual([]);
      expect(view.lastChecklist).toBeNull();
    });

    it('expone documentos aprobados (metadata sin archivo) y la última inspección', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000); // ayer → vencido
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // en 10 días → por vencer
      prismaMock.asset.findUnique.mockResolvedValueOnce({
        ...buildAssetRow({ code: 'GMT-VH-0002', publicToken: 'tok-2' }),
        project: null,
        documents: [
          { name: 'Seguro', type: 'SEGURO', fileUrl: 'https://x/secreto.pdf', expirationDate: future, createdAt: past },
          { name: 'Revisión técnica', type: 'CERT', fileUrl: 'https://x/rt.pdf', expirationDate: past, createdAt: past },
        ],
        checklistSubmissions: [
          { createdAt: future, template: { name: 'Checklist camioneta' } },
        ],
      });

      const view = await service.getPublicByToken('tok-2');

      expect(view.documents).toHaveLength(2);
      // No se filtra el archivo en la ruta pública.
      expect(view.documents[0]).not.toHaveProperty('fileUrl');
      expect(view.documents[0]).toMatchObject({ name: 'Seguro', type: 'SEGURO', expired: false, expiringSoon: true });
      expect(view.documents[1]).toMatchObject({ name: 'Revisión técnica', expired: true, expiringSoon: false });
      expect(view.lastChecklist).toEqual({
        templateName: 'Checklist camioneta',
        submittedAt: future.toISOString(),
      });
    });

    it('lanza NotFoundException cuando el token no existe', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(null);

      await expect(service.getPublicByToken('tok-inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('actualiza el estado y registra en historial', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow());
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({ status: AssetStatus.MANTENIMIENTO }),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });

      const updated = await service.updateStatus('a-1', 'u-1', {
        status: AssetStatus.MANTENIMIENTO,
        description: 'Falla eléctrica',
      });

      expect(txMock.asset.update).toHaveBeenCalledWith({
        where: { id: 'a-1' },
        data: expect.objectContaining({
          status: AssetStatus.MANTENIMIENTO,
        }),
      });
      expect(txMock.assetHistoryEntry.create).toHaveBeenCalled();
      expect(updated.status).toBe(AssetStatus.MANTENIMIENTO);
    });

    it('a estado no operativo con activo en uso: cierra el ciclo activo (no lo deja huérfano)', async () => {
      // Regresión QA #1: un gestor pasa a MANTENIMIENTO un activo EN_USO; el ciclo
      // activo debe cerrarse en la misma transacción, si no "terminar uso" lo sacaría
      // del estado no operativo sin permiso de gestión.
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.EN_USO, inUseById: 'u-cond' }),
      );
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({ status: AssetStatus.MANTENIMIENTO, inUseById: null }),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });

      await service.updateStatus('a-1', 'u-admin', { status: AssetStatus.MANTENIMIENTO });

      expect(txMock.asset.update).toHaveBeenCalledWith({
        where: { id: 'a-1' },
        data: expect.objectContaining({ status: AssetStatus.MANTENIMIENTO, inUseById: null }),
      });
      expect(txMock.usageCycle.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assetId: 'a-1',
            status: { in: [UsageCycleStatus.EN_PREPARACION, UsageCycleStatus.EN_CURSO] },
          }),
          data: expect.objectContaining({ status: UsageCycleStatus.CERRADO }),
        }),
      );
    });

    it('rechaza (403) si el usuario no puede gestionar el activo (solo lectura)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow());
      // assertCanManageAsset: sin can_manage_assets / admin => fga.check falsy.
      fgaMock.check.mockResolvedValueOnce(false);

      await expect(
        service.updateStatus('a-1', 'u-viewer', { status: AssetStatus.MANTENIMIENTO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });
  });

  describe('disputa en uso', () => {
    it('takeUse permite tomar un activo disponible', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      // Model A: reportar uso exige asset:use:report (conductor/admin) Y visibilidad.
      permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({ status: AssetStatus.EN_USO, inUseById: 'u-1' }),
        project: null,
        assignedTo: null,
        inUseBy: buildUserRow(),
      });

      const updated = await service.takeUse('a-1', 'u-1');
      // Toma ATÓMICA: updateMany con la condición inUseById:null en el mismo statement.
      expect(txMock.asset.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a-1', inUseById: null },
          data: expect.objectContaining({
            status: AssetStatus.EN_USO,
            inUseById: 'u-1',
          }),
        })
      );
      expect(updated.inUseById).toBe('u-1');
    });

    it('takeUse lanza ConflictException si la toma atómica no encuentra el activo libre', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ inUseById: 'u-other' }));
      permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });
      txMock.asset.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.takeUse('a-1', 'u-1')).rejects.toThrow(ConflictException);
    });

    it('takeUse rechaza (400) un activo en estado no operativo (DEFECTUOSO)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.DEFECTUOSO }),
      );
      permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });

      await expect(service.takeUse('a-1', 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('takeUse rechaza (403) sin el permiso asset:use:report (Model A: el permiso es obligatorio)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      // Sin el permiso funcional de reporte de uso => 403 inmediato, aunque el
      // usuario pudiera VER el activo (la visibilidad sola ya no habilita tomar).
      permissionsMock.can.mockResolvedValueOnce({ effect: 'deny' });

      await expect(service.takeUse('a-1', 'u-x')).rejects.toBeInstanceOf(ForbiddenException);
      expect(permissionsMock.can).toHaveBeenCalledWith('u-x', 'asset:use:report');
      expect(txMock.asset.updateMany).not.toHaveBeenCalled();
    });

    it('takeUse rechaza (403) a un usuario cliente (client_ito) aunque pueda VER el activo de su proyecto', async () => {
      // Regresión del hallazgo MEDIUM: el externo veía el activo (tupla FGA de su
      // proyecto) y antes esa visibilidad bastaba para tomarlo; ahora se exige
      // asset:use:report, que los bundles cliente (client_ito / viewer) no tienen.
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.DISPONIBLE, projectId: 'p-cli' }),
      );
      permissionsMock.can.mockResolvedValueOnce({ effect: 'deny' });

      await expect(service.takeUse('a-1', 'u-ito')).rejects.toBeInstanceOf(ForbiddenException);
      expect(permissionsMock.can).toHaveBeenCalledWith('u-ito', 'asset:use:report');
      expect(txMock.asset.updateMany).not.toHaveBeenCalled();
    });

    it('takeUse permite al conductor (asset:use:report) tomar un vehículo de flota (global) sin asset:read', async () => {
      // Vehículo global (projectId null) y usuario SIN asset:read (scopeFilter null):
      // canViewAsset lo concede por el permiso de conductor. Es el flujo tomar en uso
      // -> checklist que el guard can_view_list dejaba insatisfacible.
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.DISPONIBLE, projectId: null }),
      );
      permissionsMock.can.mockResolvedValue({ effect: 'allow' }); // asset:use:report y asset:checklist:run:any
      permissionsMock.scopeFilter.mockResolvedValueOnce(null); // no tiene asset:read
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({ status: AssetStatus.EN_USO, inUseById: 'u-cond', projectId: null }),
        project: null,
        assignedTo: null,
        inUseBy: buildUserRow({ id: 'u-cond' }),
      });

      const updated = await service.takeUse('a-1', 'u-cond');

      expect(permissionsMock.can).toHaveBeenCalledWith('u-cond', 'asset:use:report');
      // canViewAsset SÍ se evalúa (Model A: permiso Y visibilidad); se concede por
      // el permiso de conductor sobre el activo global, sin caer al respaldo FGA.
      expect(permissionsMock.scopeFilter).toHaveBeenCalled();
      expect(fgaMock.check).not.toHaveBeenCalled();
      expect(updated.inUseById).toBe('u-cond');
    });

    it('releaseUse rechaza (403) sin el permiso asset:use:report (Model A: el permiso es obligatorio)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.EN_USO, inUseById: 'u-1' }),
      );
      permissionsMock.can.mockResolvedValueOnce({ effect: 'deny' });

      await expect(service.releaseUse('a-1', 'u-x')).rejects.toBeInstanceOf(ForbiddenException);
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });

    it('releaseUse permite al conductor (asset:use:report) liberar el activo que ÉL tiene en uso', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.EN_USO, inUseById: 'u-cond' }),
      );
      permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
        ...buildAssetRow({ status: AssetStatus.DISPONIBLE, inUseById: null }),
        project: null,
        assignedTo: null,
        inUseBy: null,
      });

      const updated = await service.releaseUse('a-1', 'u-cond');

      expect(txMock.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a-1' },
          data: expect.objectContaining({ inUseById: null, status: AssetStatus.DISPONIBLE }),
        }),
      );
      expect(updated.inUseById).toBeNull();
    });

    it('releaseUse con asset:use:report NO libera un activo tomado por otro (regla de negocio intacta)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.EN_USO, inUseById: 'u-otro', projectId: null }),
      );
      permissionsMock.can.mockResolvedValue({ effect: 'allow' }); // conductor: pasa el gate de reportar uso
      // No es org_admin: el escape de admin se resuelve por FGA (no por Membership).
      // Global + scopeFilter none (default) => canViewAsset no consulta FGA; el único
      // fga.check es el de admin, que forzamos a false.
      fgaMock.check.mockResolvedValueOnce(false);

      await expect(service.releaseUse('a-1', 'u-cond')).rejects.toBeInstanceOf(BadRequestException);
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });
  });

  describe('accesorios', () => {
    it('agrega un accesorio correctamente', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow());

      const res = await service.addAccessory('a-1', 'u-1', {
        name: 'Trípode',
        description: 'Trípode de aluminio',
        serialNumber: 'SN-01',
      });

      expect(txMock.assetAccessory.create).toHaveBeenCalled();
      expect(txMock.assetHistoryEntry.create).toHaveBeenCalled();
      expect(res.name).toBe('Trípode');
    });

    it('remueve un accesorio correctamente', async () => {
      prismaMock.assetAccessory.findUnique.mockResolvedValueOnce(buildAccessoryRow());

      await service.removeAccessory('a-1', 'acc-1', 'u-1');

      expect(txMock.assetAccessory.delete).toHaveBeenCalled();
      expect(txMock.assetHistoryEntry.create).toHaveBeenCalled();
    });
  });

  describe('checklists', () => {
    it('obtiene o inicializa una plantilla de checklist vacía para EQUIPO', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.EQUIPO }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(null);

      const res = await service.getChecklistTemplate('a-1', 'u-1');

      expect(prismaMock.checklistTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: [],
          }),
        }),
      );
      expect(res.status).toBe(DocumentStatus.APROBADO);
    });

    it('inicializa una plantilla de checklist con el default tipado para VEHICULO', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.VEHICULO }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(null);

      const res = await service.getChecklistTemplate('a-1', 'u-1');

      expect(prismaMock.checklistTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: expect.arrayContaining([
              // El odómetro ahora es ENTERO tipado con config.isOdometer (ya no 'NUMBER').
              expect.objectContaining({
                id: 'kilometraje',
                label: expect.any(String),
                type: 'ENTERO',
                required: true,
                config: expect.objectContaining({ isOdometer: true }),
              }),
              // Y trae ítems ESTADO con opciones configurables (Bueno/Regular/Malo).
              expect.objectContaining({ id: 'motor', type: 'ESTADO' }),
            ]),
          }),
        }),
      );
      expect(res.status).toBe(DocumentStatus.APROBADO);
    });

    it('actualiza y envía a revisión la plantilla de checklist', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      const res = await service.updateChecklistTemplate('a-1', 'u-1', 'Checklist Diario', [
        { id: '1', label: 'Batería', type: 'YES_NO', required: true }
      ]);

      expect(txMock.checklistTemplate.update).toHaveBeenCalled();
      expect(res.status).toBe(DocumentStatus.EN_REVISION);
    });

    it('envía un checklist y cambia estado a MANTENIMIENTO ante falla (fallback legacy: bool false, plantilla vacía)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow({ status: DocumentStatus.APROBADO }));

      const res = await service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: '1', label: 'Freno de Mano', value: false } // falla reportada
      ]);

      expect(txMock.checklistSubmission.create).toHaveBeenCalled();
      expect(txMock.asset.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: { status: AssetStatus.MANTENIMIENTO }
      }));
      expect(txMock.assetHistoryEntry.create).toHaveBeenCalled();
      expect(res.userId).toBe('u-1');
    });

    it('ESTADO=Malo con observación gatilla falla y MANTENIMIENTO', async () => {
      const estadoTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          {
            id: 'motor',
            label: 'Motor',
            type: 'ESTADO',
            required: true,
            config: {
              options: ['Bueno', 'Regular', 'Malo'],
              failOptions: ['Malo'],
              requireObs: true,
              obsItemId: 'obs_motor',
            },
          },
          { id: 'obs_motor', label: 'Observación motor', type: 'TEXTO', required: false },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(estadoTemplate);

      const res = await service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'motor', label: 'Motor', value: 'Malo' },
        { itemId: 'obs_motor', label: 'Observación motor', value: 'Golpeteo al ralentí' },
      ]);

      expect(txMock.checklistSubmission.create).toHaveBeenCalled();
      expect(txMock.asset.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: { status: AssetStatus.MANTENIMIENTO },
      }));
      expect(res.userId).toBe('u-1');
    });

    it('ESTADO=Malo sin observación rechaza (400) y no crea la submission', async () => {
      const estadoTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          {
            id: 'motor',
            label: 'Motor',
            type: 'ESTADO',
            required: true,
            config: {
              options: ['Bueno', 'Regular', 'Malo'],
              failOptions: ['Malo'],
              requireObs: true,
              obsItemId: 'obs_motor',
            },
          },
          { id: 'obs_motor', label: 'Observación motor', type: 'TEXTO', required: false },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(estadoTemplate);

      await expect(service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'motor', label: 'Motor', value: 'Malo' },
        { itemId: 'obs_motor', label: 'Observación motor', value: '' },
      ])).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistSubmission.create).not.toHaveBeenCalled();
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });

    it('BOOLEAN=No (string) gatilla falla y MANTENIMIENTO', async () => {
      const booleanTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          { id: 'luces', label: '¿Luces operativas?', type: 'BOOLEAN', required: true },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(booleanTemplate);

      await service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'luces', label: '¿Luces operativas?', value: 'no' },
      ]);

      expect(txMock.asset.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: { status: AssetStatus.MANTENIMIENTO },
      }));
    });

    it('legacy YES_NO=false se normaliza a BOOLEAN y sigue gatillando falla', async () => {
      // La plantilla histórica guarda el tipo legacy 'YES_NO'; parseTemplateItems lo
      // normaliza a BOOLEAN al leerla, e isFailure lo detecta como falla.
      const legacyTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          { id: 'freno', label: 'Freno de mano', type: 'YES_NO', required: true },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(legacyTemplate);

      await service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'freno', label: 'Freno de mano', value: false },
      ]);

      expect(txMock.asset.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: { status: AssetStatus.MANTENIMIENTO },
      }));
    });

    it('rechaza (400) al actualizar la plantilla con un ítem ESTADO sin opciones', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      await expect(
        service.updateChecklistTemplate('a-1', 'u-1', 'Checklist Diario', [
          { id: 'motor', label: 'Motor', type: 'ESTADO', required: true, config: { options: [] } },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistTemplate.update).not.toHaveBeenCalled();
    });

    it('permite ejecutar el checklist con el permiso funcional global (admin/gerencia)', async () => {
      permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow({ status: DocumentStatus.APROBADO }));

      const res = await service.submitChecklist('a-1', 'tpl-1', 'u-admin', [
        { itemId: '1', label: 'Freno', value: true },
      ]);

      expect(permissionsMock.can).toHaveBeenCalledWith('u-admin', 'asset:checklist:run:any');
      expect(txMock.checklistSubmission.create).toHaveBeenCalled();
      expect(res.userId).toBe('u-admin');
    });

    it('rechaza (403) si no tiene el permiso funcional ni la asignación estructural', async () => {
      permissionsMock.can.mockResolvedValueOnce({ effect: 'deny' });
      fgaMock.check.mockResolvedValueOnce(false);
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow());

      await expect(
        service.submitChecklist('a-1', 'tpl-1', 'u-x', [{ itemId: '1', value: true }]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(txMock.checklistSubmission.create).not.toHaveBeenCalled();
    });

    it('rechaza (403) a un conductor que ejecuta checklist sobre un activo de proyecto que NO puede ver', async () => {
      // Regresión QA ciclo 2 #2: asset:checklist:run:any (conductor) SIN asset:read no
      // basta para ESCRIBIR el checklist de un activo ajeno; exige además poder verlo.
      permissionsMock.can.mockResolvedValue({ effect: 'allow' }); // checklist:run:any allow
      permissionsMock.scopeFilter.mockResolvedValueOnce(null); // sin asset:read
      fgaMock.check.mockResolvedValueOnce(false); // ni can_view_list del proyecto ajeno
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ projectId: 'p-ajeno' }));

      await expect(
        service.submitChecklist('a-1', 'tpl-1', 'u-cond', [{ itemId: '1', value: true }]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.checklistTemplate.findUnique).not.toHaveBeenCalled();
      expect(txMock.checklistSubmission.create).not.toHaveBeenCalled();
    });

    it('updateTelemetry rechaza (403) a un conductor sobre un vehículo de proyecto que NO puede ver', async () => {
      // Misma asimetría Model A cerrada también en la escritura de telemetría.
      permissionsMock.can.mockResolvedValue({ effect: 'allow' });
      permissionsMock.scopeFilter.mockResolvedValueOnce(null);
      fgaMock.check.mockResolvedValueOnce(false);
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ type: AssetType.VEHICULO, projectId: 'p-ajeno' }),
      );

      await expect(
        service.updateTelemetry('a-1', 'u-cond', { latitude: -33.4, longitude: -70.6, speed: 40 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });

    it('FIX3: un BOOLEAN con obsItemId que cae en falla sin observación rechaza (400)', async () => {
      // La exigencia de observación companion es type-agnóstica: cualquier ítem
      // que declare config.obsItemId (no solo ESTADO) debe traer la observación.
      const boolObsTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          {
            id: 'luces',
            label: '¿Luces operativas?',
            type: 'BOOLEAN',
            required: true,
            config: { obsItemId: 'obs_luces' },
          },
          { id: 'obs_luces', label: 'Observación luces', type: 'TEXTO', required: false },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(boolObsTemplate);

      await expect(
        service.submitChecklist('a-1', 'tpl-1', 'u-1', [
          { itemId: 'luces', label: '¿Luces operativas?', value: false },
          { itemId: 'obs_luces', label: 'Observación luces', value: '' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistSubmission.create).not.toHaveBeenCalled();
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });

    it('FIX4: un ESTADO con un valor fuera de sus opciones rechaza (400)', async () => {
      const estadoTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          {
            id: 'motor',
            label: 'Motor',
            type: 'ESTADO',
            required: true,
            config: { options: ['Bueno', 'Regular', 'Malo'], failOptions: ['Malo'] },
          },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(estadoTemplate);

      await expect(
        service.submitChecklist('a-1', 'tpl-1', 'u-1', [
          { itemId: 'motor', label: 'Motor', value: 'Excelente' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistSubmission.create).not.toHaveBeenCalled();
    });

    it('FIX5: un ítem obligatorio sin respuesta (valor vacío) rechaza (400)', async () => {
      const requiredTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          { id: 'nota', label: 'Nota de inspección', type: 'TEXTO', required: true },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(requiredTemplate);

      await expect(
        service.submitChecklist('a-1', 'tpl-1', 'u-1', [
          { itemId: 'nota', label: 'Nota de inspección', value: '   ' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistSubmission.create).not.toHaveBeenCalled();
    });

    it('FIX2: toTemplateView normaliza ítems legacy (YES_NO→BOOLEAN) al leer la plantilla', async () => {
      // Una plantilla histórica persiste el tipo legacy 'YES_NO'; la vista debe
      // normalizarlo al union nuevo para que la ejecución dibuje el input correcto.
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.VEHICULO }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(
        buildTemplateRow({
          items: [
            { id: 'freno', label: 'Freno de mano', type: 'YES_NO', required: true },
          ] as unknown as ChecklistTemplate['items'],
        }),
      );

      const res = await service.getChecklistTemplate('a-1', 'u-1');

      expect(res.items).toEqual([
        expect.objectContaining({ id: 'freno', label: 'Freno de mano', type: 'BOOLEAN', required: true }),
      ]);
    });

    it('actualiza la plantilla con secciones y persiste el arreglo de secciones', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      const res = await service.updateChecklistTemplate(
        'a-1',
        'u-1',
        'Checklist con secciones',
        [
          {
            id: 'motor',
            label: 'Motor',
            type: 'ESTADO',
            required: true,
            config: { options: ['Bueno', 'Malo'] },
            section: 'sec-1',
          },
        ],
        [{ id: 'sec-1', title: 'Motor y frenos', description: 'Revisión mecánica' }],
      );

      expect(txMock.checklistTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sections: [{ id: 'sec-1', title: 'Motor y frenos', description: 'Revisión mecánica' }],
          }),
        }),
      );
      expect(res.sections).toEqual([
        { id: 'sec-1', title: 'Motor y frenos', description: 'Revisión mecánica' },
      ]);
      expect(res.status).toBe(DocumentStatus.EN_REVISION);
    });

    it('rechaza (400) un ítem que referencia una sección inexistente', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      await expect(
        service.updateChecklistTemplate(
          'a-1',
          'u-1',
          'Checklist',
          [{ id: 'motor', label: 'Motor', type: 'TEXTO', required: false, section: 'sec-fantasma' }],
          [{ id: 'sec-1', title: 'General' }],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistTemplate.update).not.toHaveBeenCalled();
    });

    it('rechaza (400) secciones con ids duplicados', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      await expect(
        service.updateChecklistTemplate(
          'a-1',
          'u-1',
          'Checklist',
          [{ id: 'nota', label: 'Nota', type: 'TEXTO', required: false }],
          [
            { id: 'sec-1', title: 'Motor' },
            { id: 'sec-1', title: 'Frenos' },
          ],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistTemplate.update).not.toHaveBeenCalled();
    });

    it('acepta y persiste un ítem SVG con partes válidas', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      const res = await service.updateChecklistTemplate('a-1', 'u-1', 'Checklist carrocería', [
        {
          id: 'carroceria',
          label: 'Carrocería',
          type: 'SVG',
          required: false,
          config: {
            svg: '<svg><g data-part="puerta"></g></svg>',
            parts: [{ id: 'puerta', name: 'Puerta delantera' }],
          },
        },
      ]);

      expect(txMock.checklistTemplate.update).toHaveBeenCalled();
      expect(res.items).toEqual([
        expect.objectContaining({ id: 'carroceria', type: 'SVG', required: false }),
      ]);
    });

    it('rechaza (400) un ítem SVG sin marcado (svg vacío)', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      await expect(
        service.updateChecklistTemplate('a-1', 'u-1', 'Checklist', [
          {
            id: 'carroceria',
            label: 'Carrocería',
            type: 'SVG',
            required: false,
            config: { svg: '', parts: [{ id: 'puerta', name: 'Puerta' }] },
          },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(txMock.checklistTemplate.update).not.toHaveBeenCalled();
    });

    it('un ítem SVG (comentarios de carrocería) NUNCA gatilla falla ni MANTENIMIENTO', async () => {
      const svgTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          {
            id: 'carroceria',
            label: 'Carrocería',
            type: 'SVG',
            required: true,
            config: {
              svg: '<svg><g data-part="puerta"></g></svg>',
              parts: [{ id: 'puerta', name: 'Puerta delantera' }],
            },
          },
        ] as unknown as ChecklistTemplate['items'],
      });
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(svgTemplate);

      const res = await service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        {
          itemId: 'carroceria',
          label: 'Carrocería',
          value: '{"puerta":{"comment":"Rayón leve en la puerta"}}',
        },
      ]);

      expect(txMock.checklistSubmission.create).toHaveBeenCalled();
      expect(txMock.asset.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: AssetStatus.MANTENIMIENTO } }),
      );
      expect(res.userId).toBe('u-1');
    });

    it('getChecklistTemplate expone las secciones persistidas', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.VEHICULO }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(
        buildTemplateRow({
          items: [
            { id: 'motor', label: 'Motor', type: 'TEXTO', required: false, section: 'sec-1' },
          ] as unknown as ChecklistTemplate['items'],
          sections: [{ id: 'sec-1', title: 'Mecánica' }] as unknown as ChecklistTemplate['sections'],
        }),
      );

      const res = await service.getChecklistTemplate('a-1', 'u-1');

      expect(res.sections).toEqual([{ id: 'sec-1', title: 'Mecánica' }]);
      expect(res.items).toEqual([
        expect.objectContaining({ id: 'motor', section: 'sec-1' }),
      ]);
    });

    it('genera el PDF de preview del formulario agrupado por secciones', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.VEHICULO }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(
        buildTemplateRow({
          items: [
            {
              id: 'motor',
              label: 'Motor',
              type: 'ESTADO',
              required: true,
              config: { options: ['Bueno', 'Malo'] },
              section: 'sec-1',
            },
            {
              id: 'carroceria',
              label: 'Carrocería',
              type: 'SVG',
              required: false,
              config: {
                svg: '<svg><g data-part="puerta"></g></svg>',
                parts: [{ id: 'puerta', name: 'Puerta delantera' }],
              },
              section: 'sec-2',
            },
          ] as unknown as ChecklistTemplate['items'],
          sections: [
            { id: 'sec-1', title: 'Mecánica' },
            { id: 'sec-2', title: 'Carrocería' },
          ] as unknown as ChecklistTemplate['sections'],
        }),
      );

      const pdf = await service.generateChecklistTemplatePreviewPdf('a-1', 'u-1');

      // Es un PDF válido (encabezado %PDF-).
      expect(Buffer.from(pdf).subarray(0, 5).toString('utf8')).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(0);
    });

    it('sanea (server-side) el marcado SVG antes de persistir: elimina <foreignObject>/<iframe>', async () => {
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow());

      await service.updateChecklistTemplate('a-1', 'u-1', 'Checklist carrocería', [
        {
          id: 'carroceria',
          label: 'Carrocería',
          type: 'SVG',
          required: false,
          config: {
            svg:
              '<svg xmlns="http://www.w3.org/2000/svg">' +
              '<foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject>' +
              '<script>alert(2)</script>' +
              '<g id="puerta" onclick="evil()"><rect width="10" height="10"/></g>' +
              '</svg>',
            parts: [{ id: 'puerta', name: 'Puerta' }],
          },
        },
      ]);

      expect(txMock.checklistTemplate.update).toHaveBeenCalled();
      const updateArg = txMock.checklistTemplate.update.mock.calls[0]?.[0] as {
        data: { items: Array<{ type: string; config?: { svg?: string } }> };
      };
      const svgItem = updateArg.data.items.find((item) => item.type === 'SVG');
      const persistedSvg = svgItem?.config?.svg ?? '';
      // Lo persistido ya NO contiene los elementos/atributos peligrosos.
      expect(persistedSvg).not.toMatch(/<iframe/i);
      expect(persistedSvg).not.toMatch(/<foreignObject/i);
      expect(persistedSvg).not.toMatch(/<script/i);
      expect(persistedSvg).not.toMatch(/onclick/i);
      // La parte interactiva (id del <g>) se conserva.
      expect(persistedSvg).toMatch(/id="puerta"/i);
    });

    it('genera el PDF de una submission con ítem SVG sin volcar JSON crudo', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce({ id: 'a-1', projectId: null });
      prismaMock.checklistSubmission.findUnique.mockResolvedValueOnce({
        ...buildSubmissionRow({
          answers: [
            {
              itemId: 'carroceria',
              label: 'Carrocería',
              value:
                '{"puerta":{"part":"Puerta delantera","comment":"Rayón leve"},' +
                '"capo":{"part":"Capó","comment":"Abolladura"}}',
            },
          ],
        }),
        user: buildUserRow(),
        asset: buildAssetRow({ type: AssetType.VEHICULO }),
        template: buildTemplateRow({
          items: [
            {
              id: 'carroceria',
              label: 'Carrocería',
              type: 'SVG',
              required: false,
              config: {
                svg: '<svg><g id="puerta"></g></svg>',
                parts: [{ id: 'puerta', name: 'Puerta delantera' }],
              },
            },
          ] as unknown as ChecklistTemplate['items'],
        }),
      });

      const pdf = await service.generateChecklistSubmissionPdf('a-1', 'sub-1', 'u-1');

      // Es un PDF válido (no crashea al expandir el mapa de observaciones).
      expect(Buffer.from(pdf).subarray(0, 5).toString('utf8')).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(0);
    });
  });

  describe('formatSvgAnswerValue', () => {
    it('resume el mapa de observaciones a "N observaciones" + líneas parte:comentario', () => {
      const result = formatSvgAnswerValue(
        '{"puerta":{"part":"Puerta delantera","comment":"Rayón leve"},' +
          '"capo":{"part":"Capó","comment":"Abolladura"}}',
      );
      expect(result).not.toBeNull();
      expect(result?.summary).toBe('2 observaciones');
      expect(result?.lines).toEqual([
        'Puerta delantera: Rayón leve',
        'Capó: Abolladura',
      ]);
    });

    it('usa singular y omite partes sin comentario; cae a la key si falta el nombre', () => {
      const result = formatSvgAnswerValue(
        '{"puerta":{"part":"Puerta","comment":"Rayón"},"capo":{"part":"Capó","comment":"  "},"techo":{"comment":"Golpe"}}',
      );
      expect(result?.summary).toBe('2 observaciones');
      expect(result?.lines).toEqual(['Puerta: Rayón', 'techo: Golpe']);
    });

    it('mapa vacío => "Sin observaciones" sin líneas', () => {
      const result = formatSvgAnswerValue('{}');
      expect(result).toEqual({ summary: 'Sin observaciones', lines: [] });
    });

    it('devuelve null ante un value que no parsea al mapa (déjalo como está)', () => {
      expect(formatSvgAnswerValue('Bueno')).toBeNull();
      expect(formatSvgAnswerValue('no es json {')).toBeNull();
      expect(formatSvgAnswerValue('{"a":"texto plano"}')).toBeNull();
      expect(formatSvgAnswerValue(42)).toBeNull();
      expect(formatSvgAnswerValue(null)).toBeNull();
      expect(formatSvgAnswerValue(undefined)).toBeNull();
    });
  });

  describe('vehículos y telemetría', () => {
    it('sube un documento de activo con fecha de expiración', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.VEHICULO }));

      const res = await service.uploadDocument('a-1', 'u-1', 'SOAP', 'SOAP_PDF', {
        buffer: Buffer.from('test'),
        originalname: 'soap.pdf',
        mimetype: 'application/pdf',
      }, '2026-12-31T00:00:00.000Z');

      expect(txMock.assetDocument.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'SOAP',
          type: 'SOAP_PDF',
          expirationDate: new Date('2026-12-31T00:00:00.000Z'),
        }),
      }));
      expect(res.expirationDate).toBe('2026-12-31T00:00:00.000Z');
    });

    it('actualiza telemetría de vehículo y genera alertas de velocidad', async () => {
      // Caso 1: Telemetría normal
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: { odometerKm: 500, speedLimit: 100 }
      }));
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: {
          odometerKm: 500,
          speedLimit: 100,
          location: { latitude: -33.45, longitude: -70.66, updatedAt: '2026-06-16T00:00:00.000Z' },
          speed: 80
        }
      }));

      await service.updateTelemetry('a-1', 'u-1', {
        latitude: -33.45,
        longitude: -70.66,
        speed: 80
      });

      expect(txMock.asset.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            speed: 80
          })
        })
      }));
      expect(txMock.assetHistoryEntry.create).not.toHaveBeenCalled();

      // Caso 2: Exceso de velocidad
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: { odometerKm: 500, speedLimit: 100 }
      }));
      prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: {
          odometerKm: 500,
          speedLimit: 100,
          location: { latitude: -33.45, longitude: -70.66, updatedAt: '2026-06-16T00:00:00.000Z' },
          speed: 120
        }
      }));

      await service.updateTelemetry('a-1', 'u-1', {
        latitude: -33.45,
        longitude: -70.66,
        speed: 120
      });

      expect(txMock.assetHistoryEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESTADO',
          description: expect.stringContaining('Alerta: Exceso de velocidad detectado'),
        })
      }));
    });

    it('valida kilometraje no decreciente en checklists de vehículo', async () => {
      // El odómetro se detecta por el ítem ENTERO con config.isOdometer en la plantilla.
      const odometerTemplate = buildTemplateRow({
        status: DocumentStatus.APROBADO,
        items: [
          {
            id: 'kilometraje',
            label: 'Kilometraje actual (odómetro)',
            type: 'ENTERO',
            required: true,
            config: { isOdometer: true },
          },
        ] as unknown as ChecklistTemplate['items'],
      });

      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: { odometerKm: 1000 }
      }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(odometerTemplate);

      // Kilometraje menor que el actual (debe fallar)
      await expect(service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'kilometraje', label: 'Kilometraje Actual', value: 950 }
      ])).rejects.toThrow(BadRequestException);

      // Kilometraje mayor o igual (debe pasar y actualizar odómetro)
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: { odometerKm: 1000 }
      }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(odometerTemplate);

      await service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'kilometraje', label: 'Kilometraje Actual', value: 1050 }
      ]);

      expect(txMock.asset.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: {
          metadata: expect.objectContaining({
            odometerKm: 1050
          })
        }
      }));
      expect(txMock.assetHistoryEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESTADO',
          description: expect.stringContaining('Kilometraje (odómetro) actualizado automáticamente'),
        })
      }));
    });
  });

  describe('ciclo de uso', () => {
    describe('startUsageCycle', () => {
      it('con checklist APROBADO deja el activo EN_PREPARACION y el ciclo EN_PREPARACION', async () => {
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
        permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' }); // asset:use:report
        // hasApprovedChecklist => plantilla aprobada => withChecklist = true.
        prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(
          buildTemplateRow({ status: DocumentStatus.APROBADO }),
        );

        const res = await service.startUsageCycle('a-1', 'u-1');

        // Reclamo ATÓMICO (inUseById:null + estado operativo en el mismo UPDATE) hacia EN_PREPARACION.
        expect(txMock.asset.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: 'a-1', inUseById: null }),
            data: expect.objectContaining({ status: AssetStatus.EN_PREPARACION, inUseById: 'u-1' }),
          }),
        );
        expect(txMock.usageCycle.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              assetId: 'a-1',
              userId: 'u-1',
              status: UsageCycleStatus.EN_PREPARACION,
              confirmedAt: null,
            }),
          }),
        );
        expect(res.asset).toBeDefined();
        expect(res.cycle).toBeDefined();
      });

      it('SIN plantilla deja el activo EN_USO y el ciclo EN_CURSO con confirmedAt seteado', async () => {
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
        permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });
        // Sin plantilla aprobada => withChecklist = false => pasa directo a EN_USO.
        prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(null);

        await service.startUsageCycle('a-1', 'u-1');

        expect(txMock.asset.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: AssetStatus.EN_USO }),
          }),
        );
        const createArg = txMock.usageCycle.create.mock.calls[0]?.[0] as {
          data: { status: string; confirmedAt: Date | null };
        };
        expect(createArg.data.status).toBe(UsageCycleStatus.EN_CURSO);
        // Sin checklist inicial el ciclo nace confirmado (confirmedAt = ahora).
        expect(createArg.data.confirmedAt).toBeInstanceOf(Date);
      });

      it('lanza ConflictException si el reclamo atómico no encuentra el activo libre (count 0)', async () => {
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
        permissionsMock.can.mockResolvedValueOnce({ effect: 'allow' });
        prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(null);
        txMock.asset.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect(service.startUsageCycle('a-1', 'u-1')).rejects.toBeInstanceOf(ConflictException);
        expect(txMock.usageCycle.create).not.toHaveBeenCalled();
      });

      it('lanza ForbiddenException sin el permiso asset:use:report (mismo gate que takeUse)', async () => {
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
        permissionsMock.can.mockResolvedValueOnce({ effect: 'deny' });

        await expect(service.startUsageCycle('a-1', 'u-x')).rejects.toBeInstanceOf(ForbiddenException);
        expect(permissionsMock.can).toHaveBeenCalledWith('u-x', 'asset:use:report');
        expect(txMock.asset.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('confirmUsageCycle', () => {
      it('éxito (checklist sin falla): activo EN_USO, ciclo EN_CURSO y submission ligada', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_PREPARACION, userId: 'u-1' }),
        );
        // submitChecklist: permiso funcional + activo + plantilla aprobada.
        permissionsMock.can.mockResolvedValue({ effect: 'allow' }); // asset:checklist:run:any
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
        prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(
          buildTemplateRow({ status: DocumentStatus.APROBADO }),
        );
        // Tras submitChecklist el activo NO quedó en mantenimiento (default DISPONIBLE).

        await service.confirmUsageCycle('a-1', 'cyc-1', 'u-1', 'tpl-1', [
          { itemId: '1', label: 'Freno', value: true },
        ]);

        expect(txMock.asset.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'a-1' }, data: { status: AssetStatus.EN_USO } }),
        );
        // Avance ATÓMICO: updateMany condicionado a que siga EN_PREPARACION.
        expect(txMock.usageCycle.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'cyc-1', status: UsageCycleStatus.EN_PREPARACION },
            data: expect.objectContaining({
              status: UsageCycleStatus.EN_CURSO,
              checklistSubmissionId: 'sub-1',
            }),
          }),
        );
      });

      it('checklist con falla: activo a mantenimiento, ciclo CANCELADO e inUseById liberado', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_PREPARACION, userId: 'u-1' }),
        );
        permissionsMock.can.mockResolvedValue({ effect: 'allow' });
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ status: AssetStatus.DISPONIBLE }));
        // Plantilla vacía + valor false => submitChecklist detecta falla (fallback legacy).
        prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(
          buildTemplateRow({ status: DocumentStatus.APROBADO }),
        );
        // Re-lectura tras submitChecklist: el activo quedó en MANTENIMIENTO.
        prismaMock.asset.findUniqueOrThrow.mockResolvedValueOnce({
          ...buildAssetRow({ status: AssetStatus.MANTENIMIENTO }),
          project: null,
          assignedTo: null,
          inUseBy: null,
        });

        await service.confirmUsageCycle('a-1', 'cyc-1', 'u-1', 'tpl-1', [
          { itemId: '1', label: 'Freno de Mano', value: false },
        ]);

        expect(txMock.usageCycle.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'cyc-1', status: UsageCycleStatus.EN_PREPARACION },
            data: expect.objectContaining({
              status: UsageCycleStatus.CANCELADO,
              checklistSubmissionId: 'sub-1',
            }),
          }),
        );
        // Se libera el activo (inUseById null); el estado MANTENIMIENTO ya lo dejó el checklist.
        expect(txMock.asset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'a-1' },
            data: expect.objectContaining({ inUseById: null, inUseSince: null }),
          }),
        );
      });

      it('lanza ConflictException si el ciclo no está EN_PREPARACION', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );

        await expect(
          service.confirmUsageCycle('a-1', 'cyc-1', 'u-1', 'tpl-1', [{ itemId: '1', value: true }]),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('lanza ForbiddenException si lo confirma otro usuario', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_PREPARACION, userId: 'u-otro' }),
        );

        await expect(
          service.confirmUsageCycle('a-1', 'cyc-1', 'u-1', 'tpl-1', [{ itemId: '1', value: true }]),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    describe('cancelUsageCycle', () => {
      it('cancela un ciclo EN_PREPARACION: activo DISPONIBLE y ciclo CANCELADO', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_PREPARACION, userId: 'u-1' }),
        );

        await service.cancelUsageCycle('a-1', 'cyc-1', 'u-1');

        expect(txMock.asset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'a-1' },
            data: expect.objectContaining({
              status: AssetStatus.DISPONIBLE,
              inUseById: null,
              inUseSince: null,
            }),
          }),
        );
        expect(txMock.usageCycle.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'cyc-1' },
            data: expect.objectContaining({ status: UsageCycleStatus.CANCELADO }),
          }),
        );
      });

      it('lanza ConflictException si el ciclo no está EN_PREPARACION', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );

        await expect(service.cancelUsageCycle('a-1', 'cyc-1', 'u-1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });
    });

    describe('endUsageCycle', () => {
      it('GPS: guarda lat/lng y deja el activo DISPONIBLE', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );

        await service.endUsageCycle('a-1', 'cyc-1', 'u-1', {
          endKind: 'GPS',
          latitude: -33.45,
          longitude: -70.66,
        });

        expect(txMock.usageCycle.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'cyc-1' },
            data: expect.objectContaining({
              status: UsageCycleStatus.CERRADO,
              endKind: 'GPS',
              endLatitude: -33.45,
              endLongitude: -70.66,
            }),
          }),
        );
        expect(txMock.asset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'a-1' },
            data: expect.objectContaining({ status: AssetStatus.DISPONIBLE, inUseById: null }),
          }),
        );
      });

      it('ESTACIONAMIENTO: guarda el texto de cierre', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );

        await service.endUsageCycle('a-1', 'cyc-1', 'u-1', {
          endKind: 'ESTACIONAMIENTO',
          text: 'Estacionamiento subterráneo B2',
        });

        expect(txMock.usageCycle.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              endKind: 'ESTACIONAMIENTO',
              endText: 'Estacionamiento subterráneo B2',
              endLatitude: null,
              endLongitude: null,
            }),
          }),
        );
      });

      it('TRASPASO: valida el usuario destino, lo guarda y deja el activo DISPONIBLE', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );
        prismaMock.user.findUnique.mockResolvedValueOnce(buildUserRow({ id: 'u-2' }));

        await service.endUsageCycle('a-1', 'cyc-1', 'u-1', {
          endKind: 'TRASPASO',
          handoffToUserId: 'u-2',
        });

        expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u-2' } });
        expect(txMock.usageCycle.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ endKind: 'TRASPASO', handoffToUserId: 'u-2' }),
          }),
        );
        expect(txMock.asset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: AssetStatus.DISPONIBLE, inUseById: null }),
          }),
        );
      });

      it('TRASPASO sin handoffToUserId lanza BadRequestException', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );

        await expect(
          service.endUsageCycle('a-1', 'cyc-1', 'u-1', { endKind: 'TRASPASO' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(txMock.usageCycle.update).not.toHaveBeenCalled();
      });

      it('TRASPASO a un usuario inexistente lanza BadRequestException', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_CURSO, userId: 'u-1' }),
        );
        prismaMock.user.findUnique.mockResolvedValueOnce(null);

        await expect(
          service.endUsageCycle('a-1', 'cyc-1', 'u-1', { endKind: 'TRASPASO', handoffToUserId: 'u-x' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(txMock.usageCycle.update).not.toHaveBeenCalled();
      });

      it('lanza ConflictException si el ciclo no está EN_CURSO', async () => {
        prismaMock.usageCycle.findUnique.mockResolvedValueOnce(
          buildUsageCycleRow({ status: UsageCycleStatus.EN_PREPARACION, userId: 'u-1' }),
        );

        await expect(
          service.endUsageCycle('a-1', 'cyc-1', 'u-1', { endKind: 'GPS' }),
        ).rejects.toBeInstanceOf(ConflictException);
      });
    });

    describe('listUsageCycles / getUsageCycle', () => {
      it('listUsageCycles lanza NotFoundException si no puede ver el activo', async () => {
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ projectId: 'p-ajeno' }));
        permissionsMock.scopeFilter.mockResolvedValueOnce(null); // sin asset:read
        fgaMock.check.mockResolvedValueOnce(false); // ni can_view_list del proyecto ajeno

        await expect(service.listUsageCycles('a-1', 'u-x')).rejects.toBeInstanceOf(NotFoundException);
        expect(prismaMock.usageCycle.findMany).not.toHaveBeenCalled();
      });

      it('getUsageCycle lanza NotFoundException si no puede ver el activo', async () => {
        prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ projectId: 'p-ajeno' }));
        permissionsMock.scopeFilter.mockResolvedValueOnce(null);
        fgaMock.check.mockResolvedValueOnce(false);

        await expect(service.getUsageCycle('a-1', 'cyc-1', 'u-x')).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(prismaMock.usageCycle.findUnique).not.toHaveBeenCalled();
      });
    });
  });
});
