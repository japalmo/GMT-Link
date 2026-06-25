import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import type { GamificationProfile } from './gamification.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';

/**
 * Controlador de gamificación (§6-7.1).
 * Solo expone el perfil personal del usuario autenticado (sin leaderboard).
 */
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  /** GET /gamification/profile — puntos, logros desbloqueados, y progreso. */
  @Get('profile')
  getProfile(@CurrentUser() authUser: AuthUser | undefined): Promise<GamificationProfile> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return this.gamification.getProfile(authUser.id);
  }
}

