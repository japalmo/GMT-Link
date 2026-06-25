import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { StorageModule } from '../../common/storage/storage.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [PrismaModule, FgaModule, StorageModule, GamificationModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
