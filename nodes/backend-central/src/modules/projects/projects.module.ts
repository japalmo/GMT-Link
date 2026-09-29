import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { StorageModule } from '../../common/storage/storage.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ClimaService } from './clima.service';

@Module({
  // StorageModule: las fotos de terreno de los cercos.
  imports: [PrismaModule, FgaModule, StorageModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ClimaService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
