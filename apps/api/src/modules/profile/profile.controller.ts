import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import '../../auth/auth-request.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import type { ChangePasswordResponse, ProfileMe } from './profile.types';

/**
 * Perfil propio (§6-1.3 "Mis datos: ver/editar, cambiar clave").
 *
 * Todos los endpoints son AUTENTICADOS pero SIN `@RequirePermission`: cualquier
 * usuario con sesión opera sobre SU PROPIO perfil. No hay permiso FGA que
 * verificar (no se accede a recursos de otros); por eso el guard global no
 * aplica metadata aquí y la exigencia de sesión se hace a mano: si falta
 * `request.authUser` → 401. El `userId`/`firebaseUid` salen SIEMPRE de la
 * sesión, jamás del body.
 */
@Controller('profile')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** Perfil propio. 401 si no hay sesión. */
  @Get('me')
  me(@CurrentUser() authUser: AuthUser | undefined): Promise<ProfileMe> {
    return this.profileService.getMe(this.requireUserId(authUser));
  }

  /** Edita el propio perfil (campos editables §4.2). 401 si no hay sesión. */
  @Patch('me')
  updateMe(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileMe> {
    return this.profileService.updateMe(this.requireUserId(authUser), dto);
  }

  /**
   * Cambia la clave del propio usuario en Firebase. 401 si no hay sesión o si la
   * sesión no trae `firebaseUid` (no se expone cambiar la clave de otros).
   */
  @Post('change-password')
  changePassword(
    @CurrentUser() authUser: AuthUser | undefined,
    @Req() req: Request,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponse> {
    this.requireUserId(authUser);
    const firebaseUid = req.firebaseUid;
    if (!firebaseUid) {
      throw new UnauthorizedException('Falta el identificador de Firebase en la sesión.');
    }
    return this.profileService.changePassword(firebaseUid, dto.newPassword);
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
