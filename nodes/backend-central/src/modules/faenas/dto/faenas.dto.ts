import { IsEnum, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { FaenaStatus } from '@prisma/client';

/**
 * Creación de faena. El `code` se autogenera en el service
 * (`${client.code}-${letra correlativa}`), por eso NO es parte del input.
 * supervisor/estado/fechas se gestionan en la edición, no al crear.
 */
export class CreateFaenaDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // Ubicación en el mapa (opcional).
  @IsOptional()
  @IsNumber()
  @Min(-90, { message: 'La latitud debe estar entre -90 y 90.' })
  @Max(90, { message: 'La latitud debe estar entre -90 y 90.' })
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180, { message: 'La longitud debe estar entre -180 y 180.' })
  @Max(180, { message: 'La longitud debe estar entre -180 y 180.' })
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'La dirección no puede superar 255 caracteres.' })
  address?: string;
}

export class UpdateFaenaDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  supervisorId?: string;

  @IsEnum(FaenaStatus)
  @IsOptional()
  status?: FaenaStatus;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;
}
