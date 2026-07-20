import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsOptional()
  serviceId?: string;

  @IsString()
  @IsOptional()
  assignedToId?: string;

  /** Fecha de revisión planificada (#76), ISO-8601 (date-only o completa). */
  @IsISO8601({ strict: true })
  @IsOptional()
  reviewDate?: string;

  /** Fecha de entrega comprometida (#76). */
  @IsISO8601({ strict: true })
  @IsOptional()
  dueDate?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  estimatedPoints?: number;

  @IsString()
  @IsOptional()
  recurrence?: string;

  @IsString()
  @IsOptional()
  clientUserId?: string;

  // Módulo 5 — captura de ejecución (datos a obtener, contexto de fase/elemento).
  @IsObject()
  @IsOptional()
  dataSpec?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  phaseId?: string;

  @IsString()
  @IsOptional()
  elementId?: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  assignedToId?: string;

  /** Fecha de revisión planificada (#76). */
  @IsISO8601({ strict: true })
  @IsOptional()
  reviewDate?: string;

  /** Fecha de entrega comprometida (#76). */
  @IsISO8601({ strict: true })
  @IsOptional()
  dueDate?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  estimatedPoints?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  actualPoints?: number;

  @IsString()
  @IsOptional()
  recurrence?: string;

  @IsString()
  @IsOptional()
  clientUserId?: string;
}

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @IsInt()
  @Min(0)
  @IsOptional()
  actualPoints?: number;

  /**
   * Motivo del rechazo (#77): al mover a EN_PROGRESO desde REVISADO, el gestor puede
   * dejar el porqué. Se persiste en la tarea y se limpia al reenviar a revisión.
   */
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  rejectionReason?: string;
}

/** Nota opcional al iniciar/finalizar una actividad (time-log) de la tarea. */
export class TaskTimeNoteDto {
  @IsString()
  @IsOptional()
  note?: string;
}
