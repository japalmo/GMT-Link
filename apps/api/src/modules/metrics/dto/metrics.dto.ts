import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateElementDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: string; // "POZA" | "ACOPIO" | "RESERVORIO"

  @IsString()
  @IsOptional()
  locationPolygon?: string;

  @IsOptional()
  metadata?: any;

  @IsString()
  @IsNotEmpty()
  projectId!: string;
}

export class CreatePhaseDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  serviceId!: string;
}

export class SaveDataPointDto {
  @IsString()
  @IsNotEmpty()
  value!: string;

  @IsString()
  @IsOptional()
  fileUrl?: string;

  @IsString()
  @IsNotEmpty()
  variableId!: string;

  @IsString()
  @IsOptional()
  elementId?: string;

  @IsString()
  @IsNotEmpty()
  phaseId!: string;
}

export class BulkSaveDataDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveDataPointDto)
  points!: SaveDataPointDto[];
}

export class GenerateOtpDto {
  @IsString()
  @IsNotEmpty()
  email!: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  otp!: string;
}
