import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACHIEVEMENTS_CATALOG,
  POINTS_TABLE,
  type AchievementDefinition,
} from './achievements.catalog';

/** Vista pública de un logro desbloqueado. */
export interface UnlockedAchievement {
  key: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: Date;
}

/** Vista pública del progreso de un logro aún no desbloqueado. */
export interface AchievementProgress {
  key: string;
  title: string;
  description: string;
  icon: string;
  current: number;
  target: number;
}

/** Perfil completo de gamificación del usuario. */
export interface GamificationProfile {
  points: number;
  periodPoints: number;
  rank: 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';
  rankProgress: number;
  nextRank: string;
  unlocked: UnlockedAchievement[];
  progress: AchievementProgress[];
  recentPoints: Array<{ action: string; points: number; createdAt: Date }>;
}

/**
 * Motor de gamificación (§6-7.1).
 *
 * Centraliza la lógica de otorgar puntos, registrar acciones, y evaluar
 * logros automáticamente. Los servicios de dominio llaman a `awardPoints()`
 * después de cada acción relevante.
 */
@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Otorga puntos al usuario por una acción, registra en PointsLog,
   * incrementa User.points, y evalúa logros.
   */
  async awardPoints(userId: string, action: string): Promise<void> {
    const points = POINTS_TABLE[action];
    if (!points) {
      this.logger.warn(`Acción desconocida "${action}" para gamificación; ignorando.`);
      return;
    }

    try {
      await this.prisma.$transaction([
        this.prisma.pointsLog.create({
          data: { userId, action, points },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { points: { increment: points } },
        }),
      ]);

      // Evaluar logros en background (no bloquea la respuesta)
      void this.checkAndUnlockAchievements(userId);
    } catch (err) {
      // Gamificación es best-effort: no debe romper el flujo principal
      this.logger.error(`Error al otorgar ${points} pts (${action}) a ${userId}:`, err);
    }
  }

  /**
   * Evalúa todos los logros del catálogo contra las stats del usuario
   * y desbloquea los que correspondan.
   */
  async checkAndUnlockAchievements(userId: string): Promise<void> {
    const existing = await this.prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementKey: true },
    });
    const unlockedKeys = new Set(existing.map((a) => a.achievementKey));

    const pending = ACHIEVEMENTS_CATALOG.filter((a) => !unlockedKeys.has(a.key));
    if (pending.length === 0) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { points: true, createdAt: true },
    });
    if (!user) return;

    // Pre-fetch action counts for all needed actions
    const actionsNeeded = new Set<string>();
    for (const ach of pending) {
      if (ach.condition.type === 'action_count' || ach.condition.type === 'first_action') {
        actionsNeeded.add(ach.condition.action);
      }
    }

    const actionCounts: Record<string, number> = {};
    if (actionsNeeded.size > 0) {
      const counts = await this.prisma.pointsLog.groupBy({
        by: ['action'],
        where: { userId, action: { in: [...actionsNeeded] } },
        _count: { action: true },
      });
      for (const c of counts) {
        actionCounts[c.action] = c._count.action;
      }
    }

    const accountAgeDays = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    const toUnlock: string[] = [];
    for (const ach of pending) {
      if (this.isConditionMet(ach, user.points, actionCounts, accountAgeDays)) {
        toUnlock.push(ach.key);
      }
    }

    if (toUnlock.length > 0) {
      await this.prisma.userAchievement.createMany({
        data: toUnlock.map((key) => ({ userId, achievementKey: key })),
        skipDuplicates: true,
      });
      this.logger.log(`Usuario ${userId} desbloqueó logros: ${toUnlock.join(', ')}`);
    }
  }

  /** Perfil de gamificación del usuario actual. */
  async getProfile(userId: string): Promise<GamificationProfile> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [user, achievements, recentLogs, periodPointsSum] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { points: true, createdAt: true },
      }),
      this.prisma.userAchievement.findMany({
        where: { userId },
        orderBy: { unlockedAt: 'desc' },
      }),
      this.prisma.pointsLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { action: true, points: true, createdAt: true },
      }),
      this.prisma.pointsLog.aggregate({
        where: {
          userId,
          createdAt: { gte: thirtyDaysAgo },
        },
        _sum: {
          points: true,
        },
      }),
    ]);

    if (!user) {
      return {
        points: 0,
        periodPoints: 0,
        rank: 'BRONCE',
        rankProgress: 0,
        nextRank: 'Plata',
        unlocked: [],
        progress: [],
        recentPoints: [],
      };
    }

    const periodPoints = periodPointsSum._sum.points || 0;

    // Calculate rank and progress
    let rank: 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO' = 'BRONCE';
    let nextRank = 'Plata';
    let rankProgress = 0;

    if (periodPoints >= 600) {
      rank = 'PLATINO';
      nextRank = 'Max';
      rankProgress = 100;
    } else if (periodPoints >= 300) {
      rank = 'ORO';
      nextRank = 'Platino';
      rankProgress = Math.round(((periodPoints - 300) / 300) * 100);
    } else if (periodPoints >= 100) {
      rank = 'PLATA';
      nextRank = 'Oro';
      rankProgress = Math.round(((periodPoints - 100) / 200) * 100);
    } else {
      rank = 'BRONCE';
      nextRank = 'Plata';
      rankProgress = Math.round((periodPoints / 100) * 100);
    }

    const unlockedKeys = new Set(achievements.map((a) => a.achievementKey));

    // Build unlocked list
    const unlocked: UnlockedAchievement[] = achievements
      .map((a) => {
        const def = ACHIEVEMENTS_CATALOG.find((d) => d.key === a.achievementKey);
        if (!def) return null;
        return {
          key: def.key,
          title: def.title,
          description: def.description,
          icon: def.icon,
          unlockedAt: a.unlockedAt,
        };
      })
      .filter((a): a is UnlockedAchievement => a !== null);

    // Build progress for pending achievements
    const actionsNeeded = new Set<string>();
    const pendingAchs = ACHIEVEMENTS_CATALOG.filter((a) => !unlockedKeys.has(a.key));
    for (const ach of pendingAchs) {
      if (ach.condition.type === 'action_count' || ach.condition.type === 'first_action') {
        actionsNeeded.add(ach.condition.action);
      }
    }

    const actionCounts: Record<string, number> = {};
    if (actionsNeeded.size > 0) {
      const counts = await this.prisma.pointsLog.groupBy({
        by: ['action'],
        where: { userId, action: { in: [...actionsNeeded] } },
        _count: { action: true },
      });
      for (const c of counts) {
        actionCounts[c.action] = c._count.action;
      }
    }

    const accountAgeDays = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    const progress: AchievementProgress[] = pendingAchs.map((ach) => {
      const { current, target } = this.getProgress(ach, user.points, actionCounts, accountAgeDays);
      return {
        key: ach.key,
        title: ach.title,
        description: ach.description,
        icon: ach.icon,
        current,
        target,
      };
    });

    return {
      points: user.points,
      periodPoints,
      rank,
      rankProgress,
      nextRank,
      unlocked,
      progress,
      recentPoints: recentLogs,
    };
  }

  // ============ Private helpers ============

  private isConditionMet(
    ach: AchievementDefinition,
    totalPoints: number,
    actionCounts: Record<string, number>,
    accountAgeDays: number,
  ): boolean {
    const cond = ach.condition;
    switch (cond.type) {
      case 'first_action':
        return (actionCounts[cond.action] ?? 0) >= 1;
      case 'action_count':
        return (actionCounts[cond.action] ?? 0) >= cond.threshold;
      case 'total_points':
        return totalPoints >= cond.threshold;
      case 'account_age_days':
        return accountAgeDays >= cond.threshold;
      default:
        return false;
    }
  }

  private getProgress(
    ach: AchievementDefinition,
    totalPoints: number,
    actionCounts: Record<string, number>,
    accountAgeDays: number,
  ): { current: number; target: number } {
    const cond = ach.condition;
    switch (cond.type) {
      case 'first_action':
        return { current: Math.min(actionCounts[cond.action] ?? 0, 1), target: 1 };
      case 'action_count':
        return { current: actionCounts[cond.action] ?? 0, target: cond.threshold };
      case 'total_points':
        return { current: totalPoints, target: cond.threshold };
      case 'account_age_days':
        return { current: accountAgeDays, target: cond.threshold };
      default:
        return { current: 0, target: 1 };
    }
  }
}
