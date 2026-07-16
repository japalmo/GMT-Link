import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

/** Body de `POST /webauthn/register/verify`: la respuesta del autenticador + nombre. */
export class VerifyRegistrationDto {
  /** Respuesta cruda de `startRegistration()` del navegador (la valida SimpleWebAuthn). */
  @IsObject()
  response!: RegistrationResponseJSON;

  /** Nombre legible para el dispositivo (p. ej. "Celular de Felipe"). Opcional. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  deviceName?: string;
}
