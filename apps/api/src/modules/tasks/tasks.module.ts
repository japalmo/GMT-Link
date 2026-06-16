import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { GamificationModule } from '../gamification/gamification.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [PrismaModule, FgaModule, GamificationModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
