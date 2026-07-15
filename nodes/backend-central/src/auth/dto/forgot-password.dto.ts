import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /auth/forgot-password`. Solo el usuario: el servidor decide el
 * flujo (reenviar credencial provisoria a una cuenta pendiente, o enviar un OTP a
 * una cuenta activa) según el estado de la cuenta, y responde con el correo
 * enmascarado a donde envió el mensaje.
 */
export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresa tu usuario.' })
  @MaxLength(120, { message: 'El usuario no puede superar los 120 caracteres.' })
  username!: string;
}
