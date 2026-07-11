import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'Ingresa tu usuario.' })
  username!: string;

  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña.' })
  password!: string;
}
