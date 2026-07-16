import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { WebAuthnService } from './webauthn.service';
import type { WebAuthnDeviceView } from './webauthn.service';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';

/** Ceremonias de credenciales: algo más holgado que login (10/min por IP). */
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Firma verificada (#68) — registro de dispositivos WebAuthn (Fase 1). Todos los
 * endpoints son AUTENTICADOS y operan sobre el PROPIO usuario (userId de la sesión,
 * nunca del body), igual que el perfil. El header `Origin` fija el dominio de la
 * ceremonia (validado en `webauthn.config`).
 */
@Controller('webauthn')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SignaturesController {
  constructor(private readonly webauthn: WebAuthnService) {}

  /** Opciones para registrar el dispositivo actual. 401 si no hay sesión. */
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('register/options')
  registerOptions(
    @CurrentUser() authUser: AuthUser | undefined,
    @Headers('origin') origin: string | undefined,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.webauthn.generateRegistrationOptions(this.requireUserId(authUser), origin);
  }

  /** Verifica el registro y guarda la llave del dispositivo. 401 si no hay sesión. */
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('register/verify')
  registerVerify(
    @CurrentUser() authUser: AuthUser | undefined,
    @Headers('origin') origin: string | undefined,
    @Body() dto: VerifyRegistrationDto,
  ): Promise<WebAuthnDeviceView> {
    return this.webauthn.verifyRegistration(
      this.requireUserId(authUser),
      origin,
      dto.response,
      dto.deviceName,
    );
  }

  /** Dispositivos registrados por el usuario. 401 si no hay sesión. */
  @Get('credentials')
  listCredentials(@CurrentUser() authUser: AuthUser | undefined): Promise<WebAuthnDeviceView[]> {
    return this.webauthn.listCredentials(this.requireUserId(authUser));
  }

  /** Elimina un dispositivo propio. 401 si no hay sesión; 404 si no es del usuario. */
  @Delete('credentials/:id')
  async deleteCredential(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.webauthn.deleteCredential(this.requireUserId(authUser), id);
    return { ok: true };
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
