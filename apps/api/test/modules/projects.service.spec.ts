import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScopeType } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import { ProjectsService } from '../../src/modules/projects/projects.service';
import type {
  CreateProjectDto,
  CreateServiceDto,
  UpdateProjectKpisDto,
} from '../../src/modules/projects/dto/projects.dto';

interface PrismaMock {
  project: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  membership: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  service: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  task: { aggregate: ReturnType<typeof vi.fn> };
  department: { findMany: ReturnType<typeof vi.fn> };
  client: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

function buildPrisma(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    membership: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    service: { findFirst: vi.fn(), create: vi.fn() },
    task: { aggregate: vi.fn(() => Promise.resolve({ _sum: { actualPoints: 0 } })) },
    department: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    // $transaction ejecuta el callback con el mismo mock como `tx`.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(mock)),
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

const dto = (over: Partial<CreateProjectDto> = {}): CreateProjectDto =>
  ({ code: 'abc', name: 'Proyecto', departmentId: 'd1', clientId: 'c1', ...over }) as CreateProjectDto;

describe('ProjectsService', () => {
  let mock: PrismaMock;
  let prisma: PrismaService;
  let fga: {
    check: ReturnType<typeof vi.fn>;
    syncMembershipToFGA: ReturnType<typeof vi.fn>;
    writeTuples: ReturnType<typeof vi.fn>;
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
    };
    service = new ProjectsService(prisma, fga as unknown as FgaService);
  });

  describe('create', () => {
    it('rechaza si ya existe un proyecto con el mismo código en el departamento', async () => {
      mock.project.findFirst.mockResolvedValue({ id: 'p0' });
      await expect(service.create('u1', dto())).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.$transaction).not.toHaveBeenCalled();
    });

    it('crea proyecto + membresía project_creator y sincroniza FGA; código en mayúsculas', async () => {
      mock.project.findFirst.mockResolvedValue(null);
      mock.project.create.mockResolvedValue({
        id: 'p1',
        code: 'ABC',
        departmentId: 'd1',
        clientId: 'c1',
        kpis: {},
      });
      mock.membership.create.mockResolvedValue({});
      mock.task.aggregate.mockResolvedValue({ _sum: { actualPoints: 12 } });

      const result = await service.create('u1', dto({ code: 'abc' }));

      expect(mock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'ABC' }) }),
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
      expect(fga.writeTuples).toHaveBeenCalledWith([
        { user: 'department:d1', relation: 'department', object: 'project:p1' },
        { user: 'client:c1', relation: 'client', object: 'project:p1' },
      ]);
      expect((result.kpis as { current: number }).current).toBe(12);
    });
  });

  describe('listAll', () => {
    it('org_admin ve todos los proyectos', async () => {
      mock.membership.findFirst.mockResolvedValue({ id: 'adm' });
      mock.project.findMany.mockResolvedValue([{ id: 'p1', kpis: {} }]);
      mock.task.aggregate.mockResolvedValue({ _sum: { actualPoints: 5 } });

      const result = await service.listAll('admin');

      expect(mock.membership.findMany).not.toHaveBeenCalled();
      expect(mock.project.findMany).toHaveBeenCalledTimes(1);
      expect((result[0].kpis as { current: number }).current).toBe(5);
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
      expect((result.kpis as { current: number; meta: number }).current).toBe(7);
      expect((result.kpis as { meta: number }).meta).toBe(100);
    });
  });

  describe('createService', () => {
    const svcDto = (): CreateServiceDto =>
      ({ code: 'cub', name: 'Cubicación', docCodingConfig: {} }) as unknown as CreateServiceDto;

    it('rechaza si FGA no permite crear servicios', async () => {
      fga.check.mockResolvedValue(false);
      await expect(service.createService('p1', svcDto(), 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza si ya existe el código de servicio', async () => {
      fga.check.mockResolvedValue(true);
      mock.service.findFirst.mockResolvedValue({ id: 's0' });
      await expect(service.createService('p1', svcDto(), 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('crea el servicio en mayúsculas y escribe la tupla FGA', async () => {
      fga.check.mockResolvedValue(true);
      mock.service.findFirst.mockResolvedValue(null);
      mock.service.create.mockResolvedValue({ id: 's1' });

      await service.createService('p1', svcDto(), 'u1');

      expect(mock.service.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'CUB', projectId: 'p1' }) }),
      );
      expect(fga.writeTuples).toHaveBeenCalledWith([
        { user: 'project:p1', relation: 'project', object: 'service:s1' },
      ]);
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
      expect((result.kpis as { current: number; meta: number }).current).toBe(3);
      expect((result.kpis as { meta: number }).meta).toBe(50);
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
