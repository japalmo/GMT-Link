import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ScopeType } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import { ProjectsService } from '../../src/modules/projects/projects.service';
import type {
  CreateProjectDto,
  CreateServiceDto,
  UpdateProjectDto,
  UpdateProjectKpisDto,
} from '../../src/modules/projects/dto/projects.dto';

interface PrismaMock {
  project: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  faena: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  membership: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  service: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  serviceType: { findUnique: ReturnType<typeof vi.fn> };
  asset: { count: ReturnType<typeof vi.fn> };
  task: { aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
  department: { findMany: ReturnType<typeof vi.fn> };
  client: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

function buildPrisma(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    project: {
      findFirst: vi.fn(),
      // Default: sin proyectos previos en la faena → el correlativo arranca en 1.
      findMany: vi.fn(() => Promise.resolve([])),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    faena: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    service: { findFirst: vi.fn(), findMany: vi.fn(() => Promise.resolve([])), create: vi.fn() },
    serviceType: { findUnique: vi.fn() },
    asset: { count: vi.fn(() => Promise.resolve(0)) },
    task: {
      aggregate: vi.fn(() => Promise.resolve({ _sum: { actualPoints: 0 } })),
      groupBy: vi.fn(() => Promise.resolve([])),
    },
    department: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    // $transaction ejecuta el callback con el mismo mock como `tx`.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(mock)),
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

const dto = (over: Partial<CreateProjectDto> = {}): CreateProjectDto =>
  ({ name: 'Proyecto', clientId: 'c1', faenaId: 'f1', ...over }) as CreateProjectDto;

describe('ProjectsService', () => {
  let mock: PrismaMock;
  let prisma: PrismaService;
  let fga: {
    check: ReturnType<typeof vi.fn>;
    syncMembershipToFGA: ReturnType<typeof vi.fn>;
    writeTuples: ReturnType<typeof vi.fn>;
    deleteTuples: ReturnType<typeof vi.fn>;
  };
  let service: ProjectsService;

  beforeEach(() => {
    const bits = buildPrisma();
    mock = bits.mock;
    prisma = bits.prisma;
    fga = {
      check: vi.fn(() => Promise.resolve(true)),
      syncMembershipToFGA: vi.fn(() => Promise.resolve()),
      writeTuples: vi.fn(() => Promise.resolve()),
      deleteTuples: vi.fn(() => Promise.resolve()),
    };
    service = new ProjectsService(prisma, fga as unknown as FgaService);
  });

  describe('create', () => {
    it('rechaza si la faena indicada no existe', async () => {
      mock.faena.findUnique.mockResolvedValue(null);
      await expect(service.create('u1', dto())).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza si la faena no pertenece al cliente del proyecto', async () => {
      mock.faena.findUnique.mockResolvedValue({ id: 'f1', code: 'FAE', clientId: 'otro' });
      await expect(service.create('u1', dto())).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.$transaction).not.toHaveBeenCalled();
    });

    it('autogenera code `${faena.code}-1` (primer proyecto), crea membresía project_creator y solo escribe la tupla de cliente en FGA', async () => {
      mock.faena.findUnique.mockResolvedValue({ id: 'f1', code: 'FAE', clientId: 'c1' });
      mock.project.findMany.mockResolvedValue([]); // sin proyectos previos en la faena
      mock.project.create.mockResolvedValue({
        id: 'p1',
        code: 'FAE-1',
        departmentId: null,
        clientId: 'c1',
        kpis: {},
      });
      mock.membership.create.mockResolvedValue({});
      mock.task.aggregate.mockResolvedValue({ _sum: { actualPoints: 12 } });

      const result = await service.create('u1', dto());

      expect(mock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'FAE-1', faenaId: 'f1', clientId: 'c1' }),
        }),
      );
      // Ya no se escribe departmentId en la creación.
      expect(mock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ departmentId: expect.anything() }),
        }),
      );
      expect(mock.membership.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          roleKey: 'project_creator',
          scopeType: ScopeType.PROJECT,
          scopeId: 'p1',
        },
      });
      expect(fga.syncMembershipToFGA).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', roleKey: 'project_creator', scopeId: 'p1' }),
        'create',
      );
      // Sin departamento → solo la tupla de cliente.
      expect(fga.writeTuples).toHaveBeenCalledWith([
        { user: 'client:c1', relation: 'client', object: 'project:p1' },
      ]);
      expect((result.kpis as { current: number }).current).toBe(12);
    });

    it('autogenera el correlativo por faena: con FAE-1 y FAE-2 existentes → FAE-3 (ignora sufijos no numéricos)', async () => {
      mock.faena.findUnique.mockResolvedValue({ id: 'f1', code: 'FAE', clientId: 'c1' });
      mock.project.findMany.mockResolvedValue([
        { code: 'FAE-1' },
        { code: 'FAE-2' },
        { code: 'FAE-legacy' }, // sufijo no numérico: se ignora
        { code: 'OTRA-9' }, // otra faena: no matchea el prefijo
      ]);
      mock.project.create.mockResolvedValue({ id: 'p3', code: 'FAE-3', clientId: 'c1', kpis: {} });
      mock.membership.create.mockResolvedValue({});

      await service.create('u1', dto());

      expect(mock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'FAE-3' }) }),
      );
    });

    it('persiste startDate/endDate cuando se envían', async () => {
      mock.faena.findUnique.mockResolvedValue({ id: 'f1', code: 'FAE', clientId: 'c1' });
      mock.project.findMany.mockResolvedValue([]);
      mock.project.create.mockResolvedValue({ id: 'p1', code: 'FAE-1', clientId: 'c1', kpis: {} });
      mock.membership.create.mockResolvedValue({});

      await service.create(
        'u1',
        dto({ startDate: '2026-07-01', endDate: '2026-08-01' }),
      );

      const createArgs = mock.project.create.mock.calls[0]?.[0] as {
        data: { startDate: Date | null; endDate: Date | null };
      };
      expect(createArgs.data.startDate).toBeInstanceOf(Date);
      expect(createArgs.data.endDate).toBeInstanceOf(Date);
    });
  });

  describe('listAll', () => {
    it('org_admin ve todos los proyectos con el KPI actual por lotes (una sola agregación)', async () => {
      mock.membership.findFirst.mockResolvedValue({ id: 'adm' });
      mock.project.findMany.mockResolvedValue([{ id: 'p1', kpis: {} }]);
      // Batch: UNA sola agregación groupBy por proyecto (no aggregate por proyecto).
      mock.task.groupBy.mockResolvedValue([{ projectId: 'p1', _sum: { actualPoints: 5 } }]);

      const result = await service.listAll('admin');

      expect(mock.membership.findMany).not.toHaveBeenCalled();
      expect(mock.project.findMany).toHaveBeenCalledTimes(1);
      expect(mock.task.groupBy).toHaveBeenCalledTimes(1);
      expect(mock.task.aggregate).not.toHaveBeenCalled();
      expect((result[0]?.kpis as { current: number }).current).toBe(5);
    });

    it('no-admin filtra por membresías de proyecto y departamento', async () => {
      mock.membership.findFirst.mockResolvedValue(null);
      mock.membership.findMany.mockResolvedValue([
        { scopeType: ScopeType.PROJECT, scopeId: 'p1' },
        { scopeType: ScopeType.DEPARTMENT, scopeId: 'd2' },
      ]);
      mock.project.findMany.mockResolvedValue([{ id: 'p1', kpis: {} }]);

      await service.listAll('u1');

      expect(mock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ id: { in: ['p1'] } }, { departmentId: { in: ['d2'] } }],
          },
        }),
      );
    });
  });

  describe('getById', () => {
    it('404 si el proyecto no existe', async () => {
      mock.project.findUnique.mockResolvedValue(null);
      await expect(service.getById('p1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 si FGA no autoriza la visualización', async () => {
      mock.project.findUnique.mockResolvedValue({ id: 'p1', kpis: {} });
      fga.check.mockResolvedValue(false);
      await expect(service.getById('p1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve el proyecto con KPI actual cuando hay acceso', async () => {
      mock.project.findUnique.mockResolvedValue({ id: 'p1', kpis: { meta: 100 } });
      fga.check.mockResolvedValue(true);
      mock.task.aggregate.mockResolvedValue({ _sum: { actualPoints: 7 } });

      const result = await service.getById('p1', 'u1');

      expect(fga.check).toHaveBeenCalledWith({
        user: 'user:u1',
        relation: 'can_view',
        object: 'project:p1',
      });
      const kpis = result.kpis as { current: number; meta: number };
      expect(kpis.current).toBe(7);
      expect(kpis.meta).toBe(100);
    });
  });

  describe('createService', () => {
    const svcDto = (): CreateServiceDto => ({ serviceTypeId: 'st1' }) as unknown as CreateServiceDto;

    const serviceType = {
      id: 'st1',
      code: 'CUB',
      name: 'Cubicación',
      description: null,
      requiresClientSignature: true,
      procedures: [],
      isActive: true,
    };

    it('rechaza si FGA no permite crear servicios', async () => {
      fga.check.mockResolvedValue(false);
      await expect(service.createService('p1', svcDto(), 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza si el tipo de servicio no existe', async () => {
      fga.check.mockResolvedValue(true);
      mock.serviceType.findUnique.mockResolvedValue(null);
      await expect(service.createService('p1', svcDto(), 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza si el tipo de servicio está desactivado', async () => {
      fga.check.mockResolvedValue(true);
      mock.serviceType.findUnique.mockResolvedValue({ ...serviceType, isActive: false });
      await expect(service.createService('p1', svcDto(), 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('deriva el código y la config del tipo, nombra por defecto con el tipo y escribe la tupla FGA', async () => {
      fga.check.mockResolvedValue(true);
      mock.serviceType.findUnique.mockResolvedValue(serviceType);
      mock.service.findMany.mockResolvedValue([]); // no hay servicios previos → code = CUB
      mock.service.create.mockResolvedValue({ id: 's1' });

      await service.createService('p1', svcDto(), 'u1');

      expect(mock.service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'CUB',
            name: 'Cubicación',
            projectId: 'p1',
            serviceTypeId: 'st1',
            docCodingConfig: { requiresClientSignature: true },
          }),
        }),
      );
      expect(fga.writeTuples).toHaveBeenCalledWith([
        { user: 'project:p1', relation: 'project', object: 'service:s1' },
      ]);
    });

    it('deriva un código con sufijo cuando el base ya está tomado en el proyecto', async () => {
      fga.check.mockResolvedValue(true);
      mock.serviceType.findUnique.mockResolvedValue(serviceType);
      mock.service.findMany.mockResolvedValue([{ code: 'CUB' }, { code: 'CUB2' }]);
      mock.service.create.mockResolvedValue({ id: 's2' });

      await service.createService('p1', svcDto(), 'u1');

      expect(mock.service.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'CUB3' }) }),
      );
    });
  });

  describe('updateKpis', () => {
    const kpiDto = (): UpdateProjectKpisDto =>
      ({ kpis: { meta: 50 } }) as unknown as UpdateProjectKpisDto;

    it('rechaza si FGA no permite definir KPIs', async () => {
      fga.check.mockResolvedValue(false);
      await expect(service.updateKpis('p1', kpiDto(), 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('actualiza KPIs y reinyecta el current', async () => {
      fga.check.mockResolvedValue(true);
      mock.project.update.mockResolvedValue({ id: 'p1', kpis: { meta: 50 } });
      mock.task.aggregate.mockResolvedValue({ _sum: { actualPoints: 3 } });

      const result = await service.updateKpis('p1', kpiDto(), 'u1');

      expect(mock.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { kpis: { meta: 50 } },
      });
      const kpis = result.kpis as { current: number; meta: number };
      expect(kpis.current).toBe(3);
      expect(kpis.meta).toBe(50);
    });
  });

  describe('updateGeneral', () => {
    const upd = (over: Partial<UpdateProjectDto> = {}): UpdateProjectDto =>
      ({ name: 'Nuevo nombre', ...over }) as UpdateProjectDto;

    it('404 si el proyecto no existe', async () => {
      mock.project.findUnique.mockResolvedValue(null);
      await expect(service.updateGeneral('p1', upd())).rejects.toBeInstanceOf(NotFoundException);
      expect(mock.project.update).not.toHaveBeenCalled();
    });

    it('actualiza name/description y reinyecta el current', async () => {
      mock.project.findUnique.mockResolvedValue({ id: 'p1', name: 'Viejo', kpis: {} });
      mock.project.update.mockResolvedValue({
        id: 'p1',
        name: 'Nuevo nombre',
        description: 'Desc',
        kpis: { meta: 10 },
      });
      mock.task.aggregate.mockResolvedValue({ _sum: { actualPoints: 4 } });

      const result = await service.updateGeneral('p1', upd({ description: 'Desc' }));

      expect(mock.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Nuevo nombre', description: 'Desc' },
      });
      const kpis = result.kpis as { current: number; meta: number };
      expect(kpis.current).toBe(4);
      expect(kpis.meta).toBe(10);
    });
  });

  describe('remove', () => {
    const cleanProject = () => ({
      id: 'p1',
      clientId: 'c1',
      departmentId: null,
      _count: { services: 0, tasks: 0, documents: 0, elements: 0, workers: 0 },
    });

    it('404 si el proyecto no existe', async () => {
      mock.project.findUnique.mockResolvedValue(null);
      await expect(service.remove('p1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mock.project.delete).not.toHaveBeenCalled();
    });

    it.each([
      ['services', { services: 2 }],
      ['tasks', { tasks: 1 }],
      ['documents', { documents: 3 }],
      ['elements', { elements: 5 }],
      ['workers', { workers: 1 }],
    ])('bloquea 409 si _count.%s > 0', async (_label, overrides) => {
      mock.project.findUnique.mockResolvedValue({
        ...cleanProject(),
        _count: { ...cleanProject()._count, ...overrides },
      });
      mock.asset.count.mockResolvedValue(0);

      await expect(service.remove('p1')).rejects.toBeInstanceOf(ConflictException);
      expect(mock.project.delete).not.toHaveBeenCalled();
    });

    it('bloquea 409 si hay activos (asset.count > 0)', async () => {
      mock.project.findUnique.mockResolvedValue(cleanProject());
      mock.asset.count.mockResolvedValue(2);

      await expect(service.remove('p1')).rejects.toBeInstanceOf(ConflictException);
      expect(mock.project.delete).not.toHaveBeenCalled();
    });

    it('proyecto limpio: borra memberships + project.delete y sincroniza la baja FGA', async () => {
      mock.project.findUnique.mockResolvedValue(cleanProject());
      mock.asset.count.mockResolvedValue(0);
      mock.membership.findMany.mockResolvedValue([
        { userId: 'u1', roleKey: 'project_creator', scopeType: ScopeType.PROJECT, scopeId: 'p1' },
      ]);
      mock.membership.deleteMany.mockResolvedValue({ count: 1 });
      mock.project.delete.mockResolvedValue({ id: 'p1' });

      const result = await service.remove('p1');

      expect(fga.syncMembershipToFGA).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', roleKey: 'project_creator', scopeId: 'p1' }),
        'delete',
      );
      expect(fga.deleteTuples).toHaveBeenCalledWith([
        { user: 'client:c1', relation: 'client', object: 'project:p1' },
      ]);
      expect(mock.membership.deleteMany).toHaveBeenCalledWith({
        where: { scopeType: ScopeType.PROJECT, scopeId: 'p1' },
      });
      expect(mock.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(result).toEqual({ success: true });
    });
  });

  describe('listados auxiliares', () => {
    it('listDepartments ordena por nombre asc', async () => {
      mock.department.findMany.mockResolvedValue([{ id: 'd1' }]);
      const res = await service.listDepartments();
      expect(mock.department.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
      expect(res).toEqual([{ id: 'd1' }]);
    });

    it('listClients ordena por nombre asc', async () => {
      mock.client.findMany.mockResolvedValue([{ id: 'c1' }]);
      const res = await service.listClients();
      expect(mock.client.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
      expect(res).toEqual([{ id: 'c1' }]);
    });
  });
});
