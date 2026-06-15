import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FgaModule } from '../../fga/fga.module';
import { StorageModule } from '../../common/storage/storage.module';
import { ProjectDocumentsController } from './project-documents.controller';
import { ProjectDocumentsService } from './project-documents.service';

@Module({
  imports: [PrismaModule, FgaModule, StorageModule],
  controllers: [ProjectDocumentsController],
  providers: [ProjectDocumentsService],
  exports: [ProjectDocumentsService],
})
export class ProjectDocumentsModule {}
