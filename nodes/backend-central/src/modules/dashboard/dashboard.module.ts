import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Módulo del dashboard modular (§6-2.1). Consume `PrismaService` (global) y
 * `FgaService` (global, FgaModule) para filtrar widgets por permiso.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
