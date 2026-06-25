import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule, FgaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
