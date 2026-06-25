import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LiquidationsController } from './liquidations.controller';
import { LiquidationsService } from './liquidations.service';

/** Módulo de liquidaciones de sueldo (§6-3.4). */
@Module({
  imports: [PrismaModule],
  controllers: [LiquidationsController],
  providers: [LiquidationsService],
  exports: [LiquidationsService],
})
export class LiquidationsModule {}
