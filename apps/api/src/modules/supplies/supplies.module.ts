import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';
import { SuppliesController } from './supplies.controller';
import { WarehousesController } from './warehouses.controller';
import { SuppliesService } from './supplies.service';

@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [SuppliesController, WarehousesController],
  providers: [SuppliesService],
  exports: [SuppliesService],
})
export class SuppliesModule {}
