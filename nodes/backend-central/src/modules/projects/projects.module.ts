import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ClimaService } from './clima.service';

@Module({
  imports: [PrismaModule, FgaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ClimaService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
