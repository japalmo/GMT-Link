import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';
import type { PermissionService } from '../../src/authz/permission.service';
import { TasksService } from '../../src/modules/tasks/tasks.service';

interface PrismaMock {
  task: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  taskTimeLog: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findMany: ReturnType<typeof vi.fn>;
  };
}

function buildPrisma(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    taskTimeLog: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

describe('TasksService', () => {
  let prismaMock: PrismaMock;
  let prismaService: PrismaService;
  let fgaMock: { check: ReturnType<typeof vi.fn> };
  let gamificationMock: { awardPoints: ReturnType<typeof vi.fn> };
  let permissionMock: {
    scopeFilter: ReturnType<typeof vi.fn>;
    can: ReturnType<typeof vi.fn>;
    usersWithPermissionOnProject: ReturnType<typeof vi.fn>;
  };
  let service: TasksService;

  beforeEach(() => {
    const bits = buildPrisma();
    prismaMock = bits.mock;
    prismaService = bits.prisma;
    fgaMock = { check: vi.fn(() => Promise.resolve(true)) };
    gamificationMock = { awardPoints: vi.fn(() => Promise.resolve()) };
    permissionMock = {
      scopeFilter: vi.fn(() => Promise.resolve({ kind: 'none' })),
      can: vi.fn(() => Promise.resolve({ effect: 'allow' })),
      usersWithPermissionOnProject: vi.fn(() => Promise.resolve([])),
    };
    service = new TasksService(
      prismaService,
      fgaMock as unknown as FgaService,
      gamificationMock as unknown as GamificationService,
      permissionMock as unknown as PermissionService,
    );
  });

  describe('create', () => {
    it('crea la tarea exitosamente si FGA da permiso', async () => {
      const dto = { name: 'Tarea 1', projectId: 'p1', estimatedPoints: 5 };
      prismaMock.task.create.mockResolvedValue({ id: 't1', ...dto });

      const res = await service.create('u1', dto);

      expect(res).toBeDefined();
      expect(fgaMock.check).toHaveBeenCalledWith({
        user: 'user:u1',
        relation: 'can_create_task',
        object: 'project:p1',
      });
      expect(prismaMock.task.create).toHaveBeenCalled();
      expect(gamificationMock.awardPoints).toHaveBeenCalledWith('u1', 'CREATE_TASK');
    });

    it('lanza BadRequestException si FGA no da permiso', async () => {
      fgaMock.check.mockResolvedValue(false);
      const dto = { name: 'Tarea 1', projectId: 'p1' };

      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException);
    });

    it('persiste las fechas de revisión y entrega (#76)', async () => {
      const dto = {
        name: 'Tarea con fechas',
        projectId: 'p1',
        reviewDate: '2026-07-20',
        dueDate: '2026-07-25',
      };
      prismaMock.task.create.mockResolvedValue({ id: 't1', ...dto });

      await service.create('u1', dto);

      const data = prismaMock.task.create.mock.calls[0][0].data as { reviewDate: Date; dueDate: Date };
      expect(data.reviewDate).toEqual(new Date('2026-07-20'));
      expect(data.dueDate).toEqual(new Date('2026-07-25'));
    });
  });

  describe('list', () => {
    it('retorna array vacío si el scope de permisos es null (denegado)', async () => {
      permissionMock.scopeFilter.mockResolvedValue(null);
      const res = await service.list('u1', {});
      expect(res).toEqual([]);
    });

    it('aplica filtro WHERE con kind:own (solo tareas asignadas o creadas por el usuario)', async () => {
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'own' });
      prismaMock.task.findMany.mockResolvedValue([]);

      await service.list('u1', {});

      const prismaArgs = prismaMock.task.findMany.mock.calls[0]?.[0];
      expect(prismaArgs.where.OR).toEqual([
        { assignedToId: 'u1' },
        { createdById: 'u1' },
      ]);
    });

    it('aplica filtro WHERE con kind:projects', async () => {
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'projects', ids: ['p1', 'p2'] });
      prismaMock.task.findMany.mockResolvedValue([]);

      await service.list('u1', {});

      const prismaArgs = prismaMock.task.findMany.mock.calls[0]?.[0];
      expect(prismaArgs.where.projectId).toEqual({ in: ['p1', 'p2'] });
    });

    it('lanza error si filtra por proyecto y no tiene permiso sobre ese proyecto', async () => {
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'projects', ids: ['p1'] });
      await expect(service.list('u1', { projectId: 'p2' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('getById', () => {
    it('retorna la tarea si existe y FGA autoriza', async () => {
      const mockTask = { id: 't1', projectId: 'p1' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);

      const res = await service.getById('t1', 'u1');

      expect(res).toEqual(mockTask);
      expect(fgaMock.check).toHaveBeenCalledWith({
        user: 'user:u1',
        relation: 'can_view',
        object: 'project:p1',
      });
    });

    it('lanza NotFoundException si la tarea no existe', async () => {
      prismaMock.task.findUnique.mockResolvedValue(null);
      await expect(service.getById('t1', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si FGA no autoriza a ver el proyecto', async () => {
      prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1' });
      fgaMock.check.mockResolvedValue(false);

      await expect(service.getById('t1', 'u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('modifica el estado y otorga puntos de gamificación al completarse', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.PENDIENTE, assignedToId: 'u2', estimatedPoints: 10 };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      fgaMock.check.mockResolvedValue(true);
      prismaMock.task.update.mockResolvedValue({ ...mockTask, status: TaskStatus.COMPLETADO });

      const res = await service.updateStatus('t1', 'u1', { status: TaskStatus.COMPLETADO, actualPoints: 12 });

      expect(res.status).toBe(TaskStatus.COMPLETADO);
      expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: {
          status: TaskStatus.COMPLETADO,
          actualPoints: 12,
          rejectionReason: null, // aprobar limpia cualquier motivo previo (#77)
        },
      }));
      expect(gamificationMock.awardPoints).toHaveBeenCalledWith('u2', 'COMPLETE_TASK');
    });

    it('rechazar (REVISADO→EN_PROGRESO) exige gestión y guarda el motivo', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.REVISADO, assignedToId: 'u2', createdById: 'u1' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      fgaMock.check.mockResolvedValue(true);
      prismaMock.task.update.mockResolvedValue({ ...mockTask, status: TaskStatus.EN_PROGRESO });

      await service.updateStatus('t1', 'u1', {
        status: TaskStatus.EN_PROGRESO,
        rejectionReason: 'Falta el informe firmado',
      });

      expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: TaskStatus.EN_PROGRESO, rejectionReason: 'Falta el informe firmado' },
      }));
    });

    it('el responsable NO puede aprobar su propia tarea (solo gestión)', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.REVISADO, assignedToId: 'u2', createdById: 'u9' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      // can_view + can_create_task = true (ve el proyecto y pasa el gate base como asignado);
      // solo can_assign_task = false → no es gestión → no puede aprobar.
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation !== 'can_assign_task'),
      );

      await expect(
        service.updateStatus('t1', 'u2', { status: TaskStatus.COMPLETADO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('reabrir una tarea COMPLETADO exige gestión (un no-gestor no revierte la aprobación)', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.COMPLETADO, assignedToId: 'u2', createdById: 'u9' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      // asignado con can_view + can_create_task, pero sin can_assign_task → no gestiona.
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation !== 'can_assign_task'),
      );

      await expect(
        service.updateStatus('t1', 'u2', { status: TaskStatus.EN_PROGRESO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('el responsable envía a revisión (EN_PROGRESO→REVISADO) y limpia el motivo previo', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.EN_PROGRESO, assignedToId: 'u2', createdById: 'u9' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      // asignado sin can_create_task ni can_assign_task (solo can_view para getById).
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation === 'can_view'),
      );
      prismaMock.task.update.mockResolvedValue({ ...mockTask, status: TaskStatus.REVISADO });

      await service.updateStatus('t1', 'u2', { status: TaskStatus.REVISADO });

      expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: TaskStatus.REVISADO, rejectionReason: null },
      }));
    });

    it('un gestor con SOLO can_assign_task (sin can_create_task ni ser asignado) puede aprobar', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.REVISADO, assignedToId: 'u2', createdById: 'u9' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      // u3 no es asignado ni creador; can_view + can_assign_task = true, can_create_task = false.
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation === 'can_view' || relation === 'can_assign_task'),
      );
      prismaMock.task.update.mockResolvedValue({ ...mockTask, status: TaskStatus.COMPLETADO });

      const res = await service.updateStatus('t1', 'u3', { status: TaskStatus.COMPLETADO });

      expect(res.status).toBe(TaskStatus.COMPLETADO);
      expect(prismaMock.task.update).toHaveBeenCalled();
    });
  });

  describe('startTime', () => {
    it('registra el inicio de tiempo si no hay otra actividad abierta para esa tarea', async () => {
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      fgaMock.check.mockResolvedValue(true);
      prismaMock.taskTimeLog.findFirst.mockResolvedValue(null);
      prismaMock.taskTimeLog.create.mockResolvedValue({ id: 'log1', taskId: 't1', userId: 'u1' });

      const res = await service.startTime('t1', 'u1', 'Nota inicial');

      expect(res).toBeDefined();
      expect(prismaMock.taskTimeLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          taskId: 't1',
          userId: 'u1',
          note: 'Nota inicial',
        }),
      }));
    });

    it('rechaza si ya hay una actividad abierta (endedAt = null) para esa tarea y usuario', async () => {
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      prismaMock.taskTimeLog.findFirst.mockResolvedValue({ id: 'log1', endedAt: null });

      await expect(service.startTime('t1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('finishTime', () => {
    it('registra el fin de la actividad abierta exitosamente', async () => {
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      prismaMock.taskTimeLog.findFirst.mockResolvedValue({ id: 'log1', startedAt: new Date() });
      prismaMock.taskTimeLog.update.mockResolvedValue({ id: 'log1', endedAt: new Date() });

      const res = await service.finishTime('t1', 'u1', 'Nota final');

      expect(res).toBeDefined();
      expect(prismaMock.taskTimeLog.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'log1' },
        data: expect.objectContaining({
          note: 'Nota final',
        }),
      }));
    });

    it('rechaza si no hay una actividad abierta', async () => {
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1' };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      prismaMock.taskTimeLog.findFirst.mockResolvedValue(null);

      await expect(service.finishTime('t1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAssignees', () => {
    it('retorna la lista de usuarios con permisos sobre el proyecto', async () => {
      permissionMock.usersWithPermissionOnProject.mockResolvedValue(['u1', 'u2']);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', firstName: 'Juan', lastName: 'Pérez', email: 'juan@gmt.cl' },
      ]);

      const res = await service.getAssignees('p1', 'u1');

      expect(res).toBeDefined();
      expect(permissionMock.usersWithPermissionOnProject).toHaveBeenCalledWith('task:read', 'p1');
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['u1', 'u2'] } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
    });
  });
});
