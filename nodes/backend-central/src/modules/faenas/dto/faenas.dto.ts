import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { FaenaStatus } from '@prisma/client';

export class CreateFaenaDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 8, { message: 'El código de la faena debe tener entre 1 y 8 caracteres.' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

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
