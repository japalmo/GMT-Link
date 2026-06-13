import {
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../authz/auth-user.types';
import { CurrentUser } from './current-user.decorator';
import { CompleteFirstLoginDto } from './dto/complete-first-login.dto';
import { FirebaseService } from './firebase.service';
import './auth-request.types';

/** Vista pública del usuario autenticado. Nunca expone campos internos. */
interface MeResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
}

/** Respuesta de completar el primer login. */
interface FirstLoginCompleteResponse {
  status: 'ACTIVE';
}

/**
 * Endpoints de sesión (Etapa 0.5). Dependen de `SessionMiddleware`, que puebla
 * `request.authUser` y `request.firebaseUid` a partir del Bearer token. Cuando
 * no hay usuario autenticado, los handlers responden 401 explícitamente.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
  ) {}

  /** Datos del usuario autenticado. 401 si no hay sesión. */
  @Get('me')
  async me(@CurrentUser() authUser: AuthUser | undefined): Promise<MeResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    };
  }

  /**
   * Completa el primer login: fija la contraseña en Firebase y activa la cuenta.
   * Requiere sesión (401), que el usuario esté en `PENDING_FIRST_LOGIN`
   * (409 si ya está activo/otro estado) y un `uid` de Firebase en el token.
   */
  @Post('first-login/complete')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async completeFirstLogin(
    @CurrentUser() authUser: AuthUser | undefined,
    @Req() req: Request,
    @Body() body: CompleteFirstLoginDto,
  ): Promise<FirstLoginCompleteResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const firebaseUid = req.firebaseUid;
    if (!firebaseUid) {
      throw new UnauthorizedException('Falta el identificador de Firebase en la sesión.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { status: true },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }
    if (user.status !== 'PENDING_FIRST_LOGIN') {
      throw new ConflictException('El primer login ya fue completado.');
    }

    await this.firebase.setPassword(firebaseUid, body.newPassword);
    await this.prisma.user.update({
      where: { id: authUser.id },
      data: { status: 'ACTIVE' },
    });

    return { status: 'ACTIVE' };
  }
}
