import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Alta de un trabajador de faena. NO pide correo, clave ni rol: la ficha existe
 * para armar cuadrillas, no para entrar al sistema.
 */
export class CreateFieldWorkerDto {
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(60)
  firstName!: string;

  @IsString()
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres.' })
  @MaxLength(60)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cargo?: string | null;
}

export class UpdateFieldWorkerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cargo?: string | null;
}

/** Borrado: `force` confirma que se le quite de las cuadrillas donde esté. */
export class RemoveFieldWorkerDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
