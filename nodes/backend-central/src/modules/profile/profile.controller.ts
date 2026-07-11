import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../../authz/auth-user.types';

/** Límite estricto para operaciones de credenciales (5/min por IP), igual que auth. */
const CREDENTIAL_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
import { CurrentUser } from '../../auth/current-user.decorator';
import { ChangeEmailConfirmDto } from './dto/change-email-confirm.dto';
import { ChangeEmailRequestDto } from './dto/change-email-request.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import type { ChangePasswordResponse, OkResponse, ProfileMe } from './profile.types';

/**
 * Perfil propio (§6-1.3 "Mis datos: ver/editar, cambiar clave").
 *
 * Todos los endpoints son AUTENTICADOS pero SIN `@RequirePermission`: cualquier
 * usuario con sesión opera sobre SU PROPIO perfil. No hay permiso FGA que
 * verificar (no se accede a recursos de otros); por eso el guard global no
 * aplica metadata aquí y la exigencia de sesión se hace a mano: si falta
 * `request.authUser` → 401. El `userId` sale SIEMPRE de la sesión, jamás del
 * body.
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
   * Solicita el OTP para cambiar el correo del propio usuario. El código se envía
   * al NUEVO correo (nunca se retorna en la respuesta). 401 si no hay sesión.
   */
  @Post('email/change-request')
  @Throttle(CREDENTIAL_THROTTLE)
  requestEmailChange(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: ChangeEmailRequestDto,
  ): Promise<OkResponse> {
    return this.profileService.requestEmailChange(this.requireUserId(authUser), dto);
  }

  /**
   * Confirma el cambio de correo pendiente con el OTP. Devuelve el perfil
   * actualizado (correo aplicado + verificado). 401 si no hay sesión.
   */
  @Post('email/change-confirm')
  @Throttle(CREDENTIAL_THROTTLE)
  confirmEmailChange(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: ChangeEmailConfirmDto,
  ): Promise<ProfileMe> {
    return this.profileService.confirmEmailChange(this.requireUserId(authUser), dto);
  }

  /**
   * Solicita el OTP para cambiar la contraseña. Se envía al primer correo
   * verificado del usuario (o al primario). Sin body. 401 si no hay sesión.
   */
  @Post('password/change-request')
  @Throttle(CREDENTIAL_THROTTLE)
  requestPasswordChange(
    @CurrentUser() authUser: AuthUser | undefined,
  ): Promise<OkResponse> {
    return this.profileService.requestPasswordChange(this.requireUserId(authUser));
  }

  /**
   * Cambia la clave del propio usuario (bcrypt → passwordHash en Postgres),
   * ENDURECIDO: exige contraseña actual + OTP (ver ChangePasswordDto). 401 si no
   * hay sesión. Pasa el userId de la sesión al servicio; el cliente no puede
   * inyectar un id ajeno.
   */
  @Post('change-password')
  @Throttle(CREDENTIAL_THROTTLE)
  changePassword(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponse> {
    const userId = this.requireUserId(authUser);
    return this.profileService.changePassword(userId, dto);
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
