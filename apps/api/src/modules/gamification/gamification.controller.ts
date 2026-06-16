import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GamificationService } from './gamification.service';
import type { GamificationProfile } from './gamification.service';

/**
 * Controlador de gamificación (§6-7.1).
 * Solo expone el perfil personal del usuario autenticado (sin leaderboard).
 */
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  /** GET /gamification/profile — puntos, logros desbloqueados, y progreso. */
  @Get('profile')
  getProfile(@Req() req: Request): Promise<GamificationProfile> {
    const userId = (req as Request & { userId: string }).userId;
    return this.gamification.getProfile(userId);
  }
}
