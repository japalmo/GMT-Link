import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { FgaService } from '../../../src/fga/fga.service';
import type { GamificationService } from '../../../src/modules/gamification/gamification.service';
import type { PermissionService } from '../../../src/authz/permission.service';
import { TasksService } from '../../../src/modules/tasks/tasks.service';

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
      can: vi.fn(() => Promise.resolve({ effect: 'allow', filter: { kind: 'none' } })),
      usersWithPermissionOnProject: vi.fn(() => Promise.resolve([])),
    };
    service = new TasksService(
      prismaService,
      fgaMock as unknown as FgaService,
      gamificationMock as unknown as GamificationService,
      permissionMock as unknown as PermissionService,
    );
  });

  // ─── create ──────────────────────────────────────────────────────────
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
      prismaMock.task.create.mockResolvedValue({
        id: 't1',
        name: dto.name,
        projectId: dto.projectId,
        reviewDate: new Date('2026-07-20T00:00:00Z'),
        dueDate: new Date('2026-07-25T00:00:00Z')
      } as Record<string, unknown>);

      await service.create('u1', dto);

      const data = (prismaMock.task.create.mock.calls[0]?.[0] as { data: { reviewDate: Date; dueDate: Date } }).data;
      expect(data.reviewDate).toEqual(new Date('2026-07-20'));
      expect(data.dueDate).toEqual(new Date('2026-07-25'));
    });

    it('genera pasos hijos (cascada) si se proporcionan en el dto', async () => {
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'none' });
      prismaMock.task.create.mockResolvedValue({ id: 'parent1', priority: 'BAJA' });
      gamificationMock.awardPoints.mockResolvedValue(undefined);

      const dto = {
        name: 'Actividad Principal',
        steps: [
          { name: 'Paso 1', startDate: '2026-08-01' },
          { name: 'Paso 2', dueDate: '2026-08-05' }
        ]
      };

      await service.create('user1', dto);

      expect(prismaMock.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Actividad Principal',
            children: {
              create: expect.arrayContaining([
                expect.objectContaining({ name: 'Paso 1' }),
                expect.objectContaining({ name: 'Paso 2' }),
              ])
            }
          })
        })
      );
    });

    it('un paso sin priority explícita no hereda la prioridad manual del padre', async () => {
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'none' });
      prismaMock.task.create.mockResolvedValue({ id: 'parent1', priority: 'URGENTE', priorityManual: true });
      gamificationMock.awardPoints.mockResolvedValue(undefined);

      const dto = {
        name: 'Actividad Urgente',
        priority: 'URGENTE' as TaskPriority,
        priorityManual: true,
        steps: [
          { name: 'Paso con fecha', dueDate: '2026-09-01' }
        ]
      };

      await service.create('user1', dto);

      const createCall = prismaMock.task.create.mock.calls[0][0];
      const stepCreated = createCall.data.children.create[0];

      expect(stepCreated.priority).toBe('BAJA');
      expect(stepCreated.priorityManual).toBe(false);
    });
  });

  // ─── list ────────────────────────────────────────────────────────────
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
      expect(prismaArgs.where.OR).toEqual([
        { projectId: { in: ['p1', 'p2'] } },
        { projectId: null, assignedToId: 'u1' },
        { projectId: null, createdById: 'u1' },
      ]);
    });

    it('lanza error si filtra por proyecto y no tiene permiso sobre ese proyecto', async () => {
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'projects', ids: ['p1'] });
      await expect(service.list('u1', { projectId: 'p2' })).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getById ─────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna la tarea si permissions.can devuelve allow', async () => {
      const mockTask = { id: 't1', projectId: 'p1', createdById: 'u2', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });

      const res = await service.getById('t1', 'u1');
      expect(res).toBeDefined();
      expect(permissionMock.can).toHaveBeenCalledWith('u1', 'task:read', {
        projectId: 'p1',
        createdById: 'u2',
      });
    });

    it('lanza NotFoundException si la tarea no existe', async () => {
      prismaMock.task.findUnique.mockResolvedValue(null);
      await expect(service.getById('t1', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si permissions.can devuelve deny para tarea con proyecto', async () => {
      prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', createdById: 'u1', assignedToId: 'u1' });
      permissionMock.can.mockResolvedValue({ effect: 'deny', filter: { kind: 'projects', ids: [] } });

      await expect(service.getById('t1', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('deniega a creador de tarea con proyecto si FGA no da acceso al proyecto', async () => {
      const task = { id: 't1', projectId: 'p1', createdById: 'user1', assignedToId: 'user2' };
      prismaMock.task.findUnique.mockResolvedValue(task);
      permissionMock.can.mockResolvedValue({ effect: 'deny', filter: { kind: 'projects', ids: [] } });

      await expect(service.getById('t1', 'user1')).rejects.toThrow(NotFoundException);
      expect(permissionMock.can).toHaveBeenCalledWith('user1', 'task:read', { projectId: 'p1', createdById: 'user1' });
    });

    it('deniega a asignado de tarea con proyecto si FGA no da acceso al proyecto', async () => {
      const task = { id: 't1', projectId: 'p1', createdById: 'user2', assignedToId: 'user1' };
      prismaMock.task.findUnique.mockResolvedValue(task);
      permissionMock.can.mockResolvedValue({ effect: 'deny', filter: { kind: 'projects', ids: [] } });

      await expect(service.getById('t1', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('permite a miembro del proyecto (FGA allow)', async () => {
      const task = { id: 't1', projectId: 'p1', createdById: 'user2', assignedToId: 'user2', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(task);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });

      const res = await service.getById('t1', 'user1');
      expect(res).toBeDefined();
    });
  });

  // ─── update ──────────────────────────────────────────────────────────
  describe('update', () => {
    it('permite al creador editar su tarea suelta', async () => {
      const task = { id: 't1', createdById: 'user1', projectId: null, priority: 'BAJA', priorityManual: false, dueDate: null, assignedToId: null };
      prismaMock.task.findUnique.mockResolvedValue(task);
      // getById llama permissions.can → allow (creador de tarea suelta)
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'none' } });
      // update llama canOperateStandaloneTask → scopeFilter
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'projects', ids: [] });
      prismaMock.task.update.mockResolvedValue(task);

      await expect(service.update('t1', 'user1', { name: 'new name' })).resolves.toBeDefined();
    });

    it('permite a un usuario GLOBAL editar una tarea suelta ajena', async () => {
      const task = { id: 't1', createdById: 'user1', projectId: null, priority: 'BAJA', priorityManual: false, dueDate: null, assignedToId: null };
      prismaMock.task.findUnique.mockResolvedValue(task);
      // getById: allow (GLOBAL)
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'none' } });
      // canOperateStandaloneTask: kind:none = GLOBAL
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'none' });
      prismaMock.task.update.mockResolvedValue(task);

      await expect(service.update('t1', 'admin_global', { name: 'new name' })).resolves.toBeDefined();
    });

    it('deniega a un gestor con alcance de proyectos editar una tarea suelta ajena', async () => {
      const task = { id: 't1', createdById: 'user1', assignedToId: 'user2', projectId: null, priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(task);
      // getById: allow (let's say the gestor has projects scope, but can see it)
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
      // canOperateStandaloneTask for task:update: kind:projects → not GLOBAL, not creator
      permissionMock.scopeFilter.mockResolvedValue({ kind: 'projects', ids: ['p1'] });
      prismaMock.task.update.mockResolvedValue(task);

      // gestor1 is not the creator (user1), not assignedTo (user2), canAssign is false
      await expect(service.update('t1', 'gestor1', { name: 'new name' })).rejects.toThrow(BadRequestException);
    });

    it('bloquea ciclo directo (parentId === id)', async () => {
      const task = { id: 't1', createdById: 'user1', projectId: 'p1', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(task);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
      fgaMock.check.mockResolvedValue(true);

      await expect(service.update('t1', 'user1', { parentId: 't1' })).rejects.toThrow('Una tarea no puede ser padre de sí misma.');
    });

    it('bloquea ciclo indirecto (A es ancestro de B y se intenta asignar B como padre de A)', async () => {
      // t1 (parent=null) -> t2 (parent=t1). Intentamos hacer t1.parentId = t2.
      const taskA = { id: 't1', createdById: 'user1', projectId: 'p1', parentId: null, priority: 'BAJA', priorityManual: false, dueDate: null };
      const taskB = { id: 't2', createdById: 'user1', projectId: 'p1', parentId: 't1', priority: 'BAJA', priorityManual: false, dueDate: null };

      prismaMock.task.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 't1') return Promise.resolve(taskA);
        if (where.id === 't2') return Promise.resolve(taskB);
        return Promise.resolve(null);
      });

      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
      fgaMock.check.mockResolvedValue(true);

      await expect(service.update('t1', 'user1', { parentId: 't2' })).rejects.toThrow('El parentId crea un ciclo en la jerarquía de tareas.');
    });
  });

  // ─── updateStatus ────────────────────────────────────────────────────
  describe('updateStatus', () => {
    /** Helper: mock getById pass-through for project tasks via permissions.can */
    function mockGetByIdAllow() {
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
    }

    it('modifica el estado y otorga puntos de gamificación al completarse', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.PENDIENTE, assignedToId: 'u2', estimatedPoints: 10, createdById: 'u1', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      mockGetByIdAllow();
      fgaMock.check.mockResolvedValue(true);
      prismaMock.task.update.mockResolvedValue({ ...mockTask, status: TaskStatus.COMPLETADO });

      const res = await service.updateStatus('t1', 'u1', { status: TaskStatus.COMPLETADO, actualPoints: 12 });

      expect(res.status).toBe(TaskStatus.COMPLETADO);
      expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: {
          status: TaskStatus.COMPLETADO,
          actualPoints: 12,
          rejectionReason: null,
        },
      }));
      expect(gamificationMock.awardPoints).toHaveBeenCalledWith('u2', 'COMPLETE_TASK');
    });

    it('rechazar (REVISADO→EN_PROGRESO) exige gestión y guarda el motivo', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.REVISADO, assignedToId: 'u2', createdById: 'u1', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      mockGetByIdAllow();
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
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.REVISADO, assignedToId: 'u2', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      mockGetByIdAllow();
      // u2 has can_view + can_create_task but NOT can_assign_task → not a manager
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation !== 'can_assign_task'),
      );

      await expect(
        service.updateStatus('t1', 'u2', { status: TaskStatus.COMPLETADO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('reabrir una tarea COMPLETADO exige gestión (un no-gestor no revierte la aprobación)', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.COMPLETADO, assignedToId: 'u2', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      mockGetByIdAllow();
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation !== 'can_assign_task'),
      );

      await expect(
        service.updateStatus('t1', 'u2', { status: TaskStatus.EN_PROGRESO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('el responsable envía a revisión (EN_PROGRESO→REVISADO) y limpia el motivo previo', async () => {
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.EN_PROGRESO, assignedToId: 'u2', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      mockGetByIdAllow();
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
      const mockTask = { id: 't1', projectId: 'p1', status: TaskStatus.REVISADO, assignedToId: 'u2', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      mockGetByIdAllow();
      fgaMock.check.mockImplementation(({ relation }: { relation: string }) =>
        Promise.resolve(relation === 'can_view' || relation === 'can_assign_task'),
      );
      prismaMock.task.update.mockResolvedValue({ ...mockTask, status: TaskStatus.COMPLETADO });

      const res = await service.updateStatus('t1', 'u3', { status: TaskStatus.COMPLETADO });

      expect(res.status).toBe(TaskStatus.COMPLETADO);
      expect(prismaMock.task.update).toHaveBeenCalled();
    });
  });

  // ─── startTime ───────────────────────────────────────────────────────
  describe('startTime', () => {
    it('registra el inicio de tiempo si no hay otra actividad abierta para esa tarea', async () => {
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
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
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
      prismaMock.taskTimeLog.findFirst.mockResolvedValue({ id: 'log1', endedAt: null });

      await expect(service.startTime('t1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── finishTime ──────────────────────────────────────────────────────
  describe('finishTime', () => {
    it('registra el fin de la actividad abierta exitosamente', async () => {
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
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
      const mockTask = { id: 't1', projectId: 'p1', assignedToId: 'u1', createdById: 'u9', priority: 'BAJA', priorityManual: false, dueDate: null };
      prismaMock.task.findUnique.mockResolvedValue(mockTask);
      permissionMock.can.mockResolvedValue({ effect: 'allow', filter: { kind: 'projects', ids: ['p1'] } });
      prismaMock.taskTimeLog.findFirst.mockResolvedValue(null);

      await expect(service.finishTime('t1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getAssignees ────────────────────────────────────────────────────
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
