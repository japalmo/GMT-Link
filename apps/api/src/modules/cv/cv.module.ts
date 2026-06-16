import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';
import { CvController } from './cv.controller';
import { CvService } from './cv.service';

/**
 * Módulo de CV propio (§6-1.4 "Mi CV").
 * Consume `PrismaService` (global) y `StorageService` (global, vía StorageModule)
 * para los diplomas PDF. No requiere FGA: opera sobre el propio usuario.
 */
@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [CvController],
  providers: [CvService],
  exports: [CvService],
})
export class CvModule {}
