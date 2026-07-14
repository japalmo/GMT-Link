import { IsEnum, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma, ProjectType, ProjectWorkerStatus, ServiceFrequency } from '@prisma/client';

/**
 * Creación de proyecto. El `code` se autogenera en el service
 * (`${faena.code}-${n}`), por eso NO es parte del input y `faenaId` es
 * OBLIGATORIO. El departamento ya no se pide (jerarquía Cliente→Faena→Proyecto).
 */
export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  faenaId!: string;

  @IsString()
  @IsOptional()
  contractNumber?: string;

  @IsEnum(ProjectType)
  @IsOptional()
  projectType?: ProjectType;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  projectAdminId?: string;
}

/**
 * Creación de servicio por TIPO (Tanda 4). Se elige un tipo del catálogo
 * (`serviceTypeId`) y, opcionalmente, un nombre propio (default = nombre del tipo).
 * El código corto (§7) y `docCodingConfig` se derivan del tipo en el service; ya no
 * se pide un código manual.
 */
export class CreateServiceDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes elegir un tipo de servicio.' })
  serviceTypeId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  name?: string;

  @IsEnum(ServiceFrequency)
  @IsOptional()
  frequency?: ServiceFrequency | null;
}

/**
 * Actualización GENERAL del proyecto. En este corte solo se editan `name` y
 * `description`; la faena (y demás claves estructurales: clientId/code/FGA) NO
 * se cambian aquí.
 */
export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string | null;
}

export class UpdateProjectKpisDto {
  @IsObject()
  @IsNotEmpty()
  kpis!: Prisma.InputJsonValue;
}

/** Setea la frecuencia de un servicio del proyecto. */
export class UpdateServiceFrequencyDto {
  @IsEnum(ServiceFrequency)
  @IsNotEmpty()
  frequency!: ServiceFrequency;
}

// ── Asignación de trabajadores a proyecto ──────────────────────────────────

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  roleKey!: string;

  @IsEnum(ProjectWorkerStatus)
  @IsOptional()
  status?: ProjectWorkerStatus;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;
}

export class UpdateAssignmentDto {
  @IsEnum(ProjectWorkerStatus)
  @IsOptional()
  status?: ProjectWorkerStatus;

  @IsString()
  @IsOptional()
  roleKey?: string;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;
}
