import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { StorageModule } from '../../common/storage/storage.module';
import { GamificationModule } from '../gamification/gamification.module';
import { SignaturesModule } from '../signatures/signatures.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { ExpiryNoticesService } from './expiry-notices.service';
import { ExpiryNoticesScheduler } from './expiry-notices.scheduler';
import { VehicleUsageService } from './vehicle-usage.service';
import { SheetsClientService } from './sheets-client.service';
import { SheetsImportService } from './sheets-import.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    FgaModule,
    StorageModule,
    GamificationModule,
    SignaturesModule,
    NotificationsModule,
    // El barrido de vencimientos corre dentro del proceso de la API.
    ScheduleModule.forRoot(),
  ],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    ExpiryNoticesService,
    ExpiryNoticesScheduler,
    VehicleUsageService,
    SheetsClientService,
    SheetsImportService,
  ],
  exports: [AssetsService, ExpiryNoticesService, VehicleUsageService, SheetsImportService],
})
export class AssetsModule {}
