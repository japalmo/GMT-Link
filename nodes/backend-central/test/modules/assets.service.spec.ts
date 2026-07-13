import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssetStatus, AssetType, DocumentStatus, ScopeType } from '@prisma/client';
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
      },
    };

    prismaMock = {
      $transaction: vi.fn((cb) => cb(txMock)),
      asset: {
        count: vi.fn(() => Promise.resolve(0)),
        findFirst: vi.fn(() => Promise.resolve(null)),
        findUnique: vi.fn(),
        findMany: vi.fn(() => Promise.resolve([])),
        findUniqueOrThrow: vi.fn(),
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
      txMock.asset.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.takeUse('a-1', 'u-1')).rejects.toThrow(ConflictException);
    });

    it('takeUse rechaza (400) un activo en estado no operativo (DEFECTUOSO)', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(
        buildAssetRow({ status: AssetStatus.DEFECTUOSO }),
      );

      await expect(service.takeUse('a-1', 'u-1')).rejects.toBeInstanceOf(BadRequestException);
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

    it('inicializa una plantilla de checklist con ítems desde CSV para VEHICULO', async () => {
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({ type: AssetType.VEHICULO }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(null);

      const res = await service.getChecklistTemplate('a-1', 'u-1');

      expect(prismaMock.checklistTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ id: 'kilometraje', label: expect.any(String), type: 'NUMBER', required: true }),
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

    it('envía un checklist y cambia estado a MANTENIMIENTO ante falla', async () => {
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
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: { odometerKm: 1000 }
      }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow({ status: DocumentStatus.APROBADO }));

      // Kilometraje menor que el actual (debe fallar)
      await expect(service.submitChecklist('a-1', 'tpl-1', 'u-1', [
        { itemId: 'kilometraje', label: 'Kilometraje Actual', value: 950 }
      ])).rejects.toThrow(BadRequestException);

      // Kilometraje mayor o igual (debe pasar y actualizar odómetro)
      prismaMock.asset.findUnique.mockResolvedValueOnce(buildAssetRow({
        type: AssetType.VEHICULO,
        metadata: { odometerKm: 1000 }
      }));
      prismaMock.checklistTemplate.findUnique.mockResolvedValueOnce(buildTemplateRow({ status: DocumentStatus.APROBADO }));
      
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
});
