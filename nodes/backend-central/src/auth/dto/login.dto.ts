import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Correo inválido.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña.' })
  password!: string;
}
