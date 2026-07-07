import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FaenasController } from './faenas.controller';
import { FaenasService } from './faenas.service';

@Module({
  imports: [PrismaModule],
  controllers: [FaenasController],
  providers: [FaenasService],
  exports: [FaenasService],
})
export class FaenasModule {}
