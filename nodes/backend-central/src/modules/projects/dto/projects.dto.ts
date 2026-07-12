import { IsEnum, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, Length } from 'class-validator';
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

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 3, { message: 'El código del servicio debe tener exactamente 3 caracteres.' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  @IsNotEmpty()
  docCodingConfig!: Prisma.InputJsonValue;
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
