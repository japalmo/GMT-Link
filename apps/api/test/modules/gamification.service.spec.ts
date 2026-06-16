import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GamificationService } from '../../src/modules/gamification/gamification.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

describe('GamificationService', () => {
  let prismaMock: Record<string, unknown>;
  let service: GamificationService;

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
      pointsLog: {
        create: vi.fn(() =>
          Promise.resolve({ id: 'pl-1', userId: 'u-1', action: 'FIRST_LOGIN', points: 50 }),
        ),
        groupBy: vi.fn(() => Promise.resolve([])),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      user: {
        update: vi.fn(() => Promise.resolve({ id: 'u-1', points: 50 })),
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: 'u-1',
            points: 50,
            createdAt: new Date('2025-01-01'),
          }),
        ),
      },
      userAchievement: {
        findMany: vi.fn(() => Promise.resolve([])),
        createMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
    };

    service = new GamificationService(prismaMock as unknown as PrismaService);
  });

  describe('awardPoints', () => {
    it('debería otorgar puntos para una acción conocida', async () => {
      await service.awardPoints('u-1', 'FIRST_LOGIN');

      expect(prismaMock.$transaction).toHaveBeenCalledWith([
        expect.anything(), // pointsLog.create
        expect.anything(), // user.update (increment)
      ]);
    });

    it('debería ignorar una acción desconocida', async () => {
      await service.awardPoints('u-1', 'UNKNOWN_ACTION');

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('checkAndUnlockAchievements', () => {
    it('debería desbloquear logro "first_day" cuando hay una acción FIRST_LOGIN', async () => {
      // User has no achievements yet
      (prismaMock.userAchievement as Record<string, unknown>).findMany = vi.fn(() =>
        Promise.resolve([]),
      );
      // Simulate 1 FIRST_LOGIN action
      (prismaMock.pointsLog as Record<string, unknown>).groupBy = vi.fn(() =>
        Promise.resolve([{ action: 'FIRST_LOGIN', _count: { action: 1 } }]),
      );

      await service.checkAndUnlockAchievements('u-1');

      expect(
        (prismaMock.userAchievement as { createMany: ReturnType<typeof vi.fn> }).createMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ achievementKey: 'first_day' }),
          ]),
        }),
      );
    });

    it('no debería desbloquear un logro ya desbloqueado', async () => {
      (prismaMock.userAchievement as Record<string, unknown>).findMany = vi.fn(() =>
        Promise.resolve([{ achievementKey: 'first_day' }]),
      );

      await service.checkAndUnlockAchievements('u-1');

      // Should not create any achievements that include first_day
      const createManyCalls = (
        prismaMock.userAchievement as { createMany: ReturnType<typeof vi.fn> }
      ).createMany.mock.calls;

      // Either createMany was not called, or it was called without first_day
      if (createManyCalls.length > 0) {
        const data = createManyCalls[0][0].data as Array<{ achievementKey: string }>;
        expect(data.find((d) => d.achievementKey === 'first_day')).toBeUndefined();
      }
    });
  });

  describe('getProfile', () => {
    it('debería devolver el perfil del usuario con puntos y listas vacías', async () => {
      const profile = await service.getProfile('u-1');

      expect(profile).toHaveProperty('points', 50);
      expect(profile.unlocked).toEqual([]);
      expect(profile.progress).toBeInstanceOf(Array);
      expect(profile.recentPoints).toEqual([]);
    });

    it('debería manejar un usuario inexistente graciosamente', async () => {
      (prismaMock.user as Record<string, unknown>).findUnique = vi.fn(() =>
        Promise.resolve(null),
      );

      const profile = await service.getProfile('nonexistent');

      expect(profile.points).toBe(0);
      expect(profile.unlocked).toEqual([]);
    });
  });
});
