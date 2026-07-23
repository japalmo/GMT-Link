import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsObject, IsEnum, IsBoolean, IsIn, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { VariableType } from '@prisma/client';

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

// ── DataSpec de una fase: definición de las Variables a capturar ────────────

export class DataSpecVariableDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(VariableType)
  @IsNotEmpty()
  type!: VariableType;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  required?: boolean;
}

export class SetPhaseDataSpecDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DataSpecVariableDto)
  variables!: DataSpecVariableDto[];
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

/**
 * Ingreso de un documento emitido desde el escritorio (V-Metric, Fase 1B).
 * Campos en snake_case: es el dialecto que el canal desktop ya habla.
 * El vínculo llega por `task_id` (preferente) o `element_code` (resolver
 * existente); al menos uno es obligatorio (se valida en el service).
 */
export class CreateDesktopDocumentDto {
  @IsString()
  @IsNotEmpty()
  blob_path!: string;

  @IsString()
  @IsNotEmpty()
  file_hash!: string;

  @IsString()
  @IsNotEmpty()
  doc_type!: string;

  @IsString()
  @IsNotEmpty()
  codigo!: string;

  @IsString()
  @IsOptional()
  task_id?: string;

  @IsString()
  @IsOptional()
  element_code?: string;

  // D3: el escritorio solo emite BORRADOR o PENDIENTE_QA (default). Los demás
  // estados del ciclo (PENDIENTE_CLIENTE, APROBADO, RECHAZADO) son del flujo web.
  @IsIn(['BORRADOR', 'PENDIENTE_QA'], {
    message: 'El estado debe ser BORRADOR o PENDIENTE_QA.',
  })
  @IsOptional()
  estado?: 'BORRADOR' | 'PENDIENTE_QA';
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
