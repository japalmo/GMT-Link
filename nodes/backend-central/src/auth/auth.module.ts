import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GamificationModule } from '../modules/gamification/gamification.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [AuthController],
})
export class AuthModule {}
