import {
  AssetIdentifierType,
  AssetStatus,
  AssetType,
  DocumentStatus,
  VehicleSubtype,
} from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateAssetDto {
  @IsEnum(AssetType, { message: 'El tipo de activo debe ser EQUIPO, VEHICULO o MAQUINARIA' })
  type!: AssetType;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del activo es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** Fabricante o marca del activo. */
  @IsString()
  @IsOptional()
  manufacturer?: string;

  /** Identificador único: patente (vehículos) o número de serie (equipos/maquinaria). */
  @IsString()
  @IsOptional()
  identifier?: string;

  @IsEnum(AssetIdentifierType, { message: 'El tipo de identificador debe ser PATENTE o NUMERO_SERIE' })
  @IsOptional()
  identifierType?: AssetIdentifierType;

  /** Subtipo de vehículo (solo aplica cuando type = VEHICULO). */
  @ValidateIf((o: CreateAssetDto) => o.type === AssetType.VEHICULO)
  @IsEnum(VehicleSubtype, {
    message: 'El subtipo debe ser PICKUP, FURGON, AUTO, AUTOBUS o CAMION',
  })
  @IsOptional()
  vehicleSubtype?: VehicleSubtype;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  assignedToId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * Edición de los campos DESCRIPTIVOS de un activo (Tanda 5.2). Parcial: solo se
 * aplican los presentes. NO incluye type, projectId, assignedToId ni status: el
 * tipo y el proyecto quedan fijos (cambiarlos re-sincroniza FGA y el código), y
 * estado/responsable/uso siguen con sus endpoints dedicados.
 */
export class UpdateAssetDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del activo no puede quedar vacío' })
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsString()
  @IsOptional()
  manufacturer?: string | null;

  @IsString()
  @IsOptional()
  identifier?: string | null;

  @IsEnum(AssetIdentifierType, { message: 'El tipo de identificador debe ser PATENTE o NUMERO_SERIE' })
  @IsOptional()
  identifierType?: AssetIdentifierType | null;

  @IsEnum(VehicleSubtype, {
    message: 'El subtipo debe ser PICKUP, FURGON, AUTO, AUTOBUS o CAMION',
  })
  @IsOptional()
  vehicleSubtype?: VehicleSubtype | null;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateAssetStatusDto {
  @IsEnum(AssetStatus, { message: 'Estado del activo inválido' })
  status!: AssetStatus;

  @IsString()
  @IsOptional()
  description?: string;
}

export class AssignAssetDto {
  @IsString()
  @IsOptional()
  assignedToId?: string;
}

export class ReviewAssetDocDto {
  @IsEnum([DocumentStatus.APROBADO, DocumentStatus.RECHAZADO], {
    message: 'El estado de revisión debe ser APROBADO o RECHAZADO',
  })
  status!: DocumentStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateAccessoryDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del accesorio es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;
}

export class UpdateAccessoryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;
}

export class UpdateChecklistTemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la plantilla es requerido' })
  name!: string;

  @IsArray()
  @IsNotEmpty({ message: 'Los ítems del checklist son requeridos' })
  items!: Record<string, unknown>[];
}

export class ReviewChecklistTemplateDto {
  @IsEnum([DocumentStatus.APROBADO, DocumentStatus.RECHAZADO], {
    message: 'El estado de revisión debe ser APROBADO o RECHAZADO',
  })
  status!: DocumentStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class SubmitChecklistDto {
  @IsString()
  @IsNotEmpty({ message: 'El ID de la plantilla es requerido' })
  templateId!: string;

  @IsArray()
  @IsNotEmpty({ message: 'Las respuestas son requeridas' })
  answers!: Record<string, unknown>[];
}

export class SubmitTelemetryDto {
  @IsNumber({}, { message: 'La latitud debe ser un número' })
  latitude!: number;

  @IsNumber({}, { message: 'La longitud debe ser un número' })
  longitude!: number;

  @IsNumber({}, { message: 'La velocidad debe ser un número' })
  speed!: number;
}
