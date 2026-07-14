import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /users/:id/resend-invite`. `sendEmail` decide el camino:
 *  - `true`  → el servidor regenera la clave, la inyecta en el correo (asunto +
 *    mensaje editables) y lo envía. La clave NO se retorna.
 *  - `false` (o ausente) → regenera la clave y la retorna una vez para que el
 *    admin la comparta manualmente (camino sin correo).
 * `subject`/`message` solo se usan en el camino con correo.
 */
export class ResendInviteDto {
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;
}
