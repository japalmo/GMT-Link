import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateProviderDto {
  @IsString()
  @IsOptional()
  rut?: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del proveedor es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;
}

export class AddProviderProductDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del producto es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  unit?: string;
}

export class SubmitProviderRatingDto {
  @IsInt()
  @Min(1, { message: 'La calificación mínima es 1 estrella' })
  @Max(5, { message: 'La calificación máxima es 5 estrellas' })
  score!: number;

  @IsString()
  @IsOptional()
  comment?: string;
}

export class CleanProviderDataDto {
  @IsString()
  @IsNotEmpty({ message: 'Los datos de entrada no pueden estar vacíos' })
  rawData!: string;
}
