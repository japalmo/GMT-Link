import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';

/**
 * Módulo de gamificación (§6-7.1).
 * Exporta GamificationService para que otros módulos puedan inyectarlo
 * y llamar a awardPoints() después de acciones relevantes.
 */
@Module({
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
