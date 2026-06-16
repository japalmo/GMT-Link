import { AssetStatus, AssetType, DocumentStatus } from '@prisma/client';
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateAssetDto {
  @IsEnum(AssetType, { message: 'El tipo de activo debe ser EQUIPO o VEHICULO' })
  type!: AssetType;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del activo es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

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
