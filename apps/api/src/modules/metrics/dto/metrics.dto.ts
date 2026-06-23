import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsObject } from 'class-validator';
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
  metadata?: Record<string, unknown>;

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

// ── Mock Cloud Functions (Desktop PyQt Client) ──────────────────────────────

export class SaveCubicacionDto {
  @IsString()
  @IsNotEmpty()
  reservorio_codigo!: string;

  @IsObject()
  @IsNotEmpty()
  datos!: Record<string, unknown>;

  @IsString()
  @IsOptional()
  phase_code?: string;
}

export class SaveReservorioMetadataDto {
  @IsString()
  @IsNotEmpty()
  reservorio_codigo!: string;

  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsObject()
  @IsOptional()
  extra?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  proyecto_id?: string;
}

export class LogActivityDto {
  @IsString()
  @IsNotEmpty()
  accion!: string;

  @IsObject()
  @IsOptional()
  detalle!: Record<string, unknown>;
}

export class ExportCubicacionToSheetsDto {
   @IsArray()
   @IsNotEmpty()
   rows!: Array<Array<string | number | boolean | null>>;

  @IsString()
  @IsNotEmpty()
  reservorio_codigo!: string;

  @IsString()
  @IsOptional()
  fuente_dem?: string;

  @IsString()
  @IsOptional()
  operador?: string;
}
