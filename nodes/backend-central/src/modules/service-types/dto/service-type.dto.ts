import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Código de tipo de servicio: 2 a 4 caracteres alfanuméricos (se guarda en MAYÚSCULAS). */
const CODE_RE = /^[A-Za-z0-9]{2,4}$/;

/** Un procedimiento (paso con instrucciones) dentro de un tipo de servicio. */
export class ProcedimientoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  id!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del procedimiento es obligatorio.' })
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instrucciones?: string | null;
}

/** Cuerpo de `POST /service-types`. */
export class CreateServiceTypeDto {
  @IsString()
  @Matches(CODE_RE, { message: 'El código debe tener 2 a 4 caracteres alfanuméricos.' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresClientSignature?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcedimientoDto)
  procedures?: ProcedimientoDto[];
}

/** Cuerpo de `PATCH /service-types/:id` — parcial (solo se aplican los presentes). */
export class UpdateServiceTypeDto {
  @IsOptional()
  @IsString()
  @Matches(CODE_RE, { message: 'El código debe tener 2 a 4 caracteres alfanuméricos.' })
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede quedar vacío.' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresClientSignature?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcedimientoDto)
  procedures?: ProcedimientoDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
