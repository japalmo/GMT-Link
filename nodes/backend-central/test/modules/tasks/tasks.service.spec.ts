import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TasksService } from '../../../src/modules/tasks/tasks.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { FgaService } from '../../../src/fga/fga.service';
import { GamificationService } from '../../../src/modules/gamification/gamification.service';
import { PermissionService } from '../../../src/authz/permission.service';
import { TaskStatus } from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('TasksService - canOperateStandaloneTask', () => {
  let tasksService: any;
  let mockPrisma: any;
  let mockFga: any;
  let mockGamification: any;
  let mockPermissions: any;

  beforeEach(() => {
    mockPrisma = {
      task: {
        findUnique: vi.fn(),
      }
    };
    mockFga = {
      check: vi.fn(),
    };
    mockGamification = {};
    mockPermissions = {
      scopeFilter: vi.fn(),
    };

    tasksService = new TasksService(
      mockPrisma as any,
      mockFga as any,
      mockGamification as any,
      mockPermissions as any,
    );
  });

  describe('update', () => {
    it('debe permitir si es el creador de la tarea suelta', async () => {
      const task = { id: 't1', createdById: 'user1', projectId: null, priority: 'BAJA' };
      mockPrisma.task.findUnique.mockResolvedValue(task);
      mockPermissions.scopeFilter.mockResolvedValueOnce({ kind: 'projects', ids: [] }); // scopeFilter returns own or projects filter
      mockPermissions.scopeFilter.mockResolvedValueOnce({ kind: 'projects', ids: [] }); // for task:update

      // act
      // Mock update to avoid actual DB call
      mockPrisma.task.update = vi.fn().mockResolvedValue(task);

      await expect(tasksService.update('t1', 'user1', { name: 'new name' })).resolves.toBeDefined();
    });

    it('debe permitir a un usuario GLOBAL editar una tarea suelta ajena', async () => {
      const task = { id: 't1', createdById: 'user1', projectId: null, priority: 'BAJA' };
      mockPrisma.task.findUnique.mockResolvedValue(task);
      mockPermissions.scopeFilter.mockResolvedValueOnce({ kind: 'none' }); // task:read
      mockPermissions.scopeFilter.mockResolvedValueOnce({ kind: 'none' }); // task:update

      mockPrisma.task.update = vi.fn().mockResolvedValue(task);

      await expect(tasksService.update('t1', 'admin_global', { name: 'new name' })).resolves.toBeDefined();
    });

    it('debe denegar a un gestor con alcance de proyectos editar una tarea suelta ajena', async () => {
      const taskAjena = { id: 't1', createdById: 'user1', assignedToId: 'user2', projectId: null, priority: 'BAJA' };
      mockPrisma.task.findUnique.mockResolvedValue(taskAjena);
      mockPermissions.scopeFilter.mockResolvedValueOnce({ kind: 'projects', ids: ['p1'] }); // task:read -> permite acceso inicial si el getById no lo bloquea?
      // Wait, if it's not assigned to them and created by someone else and projectId is null, getById WILL block it!
      // Because applyScope limits read access. Let's mock getById so we can test the update logic specifically.
      tasksService.getById = vi.fn().mockResolvedValue(taskAjena);
      mockPermissions.scopeFilter.mockResolvedValueOnce({ kind: 'projects', ids: ['p1'] }); // for task:update

      await expect(tasksService.update('t1', 'gestor1', { name: 'new name' })).rejects.toThrow(BadRequestException);
    });
  });
});
