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
  IsBoolean,
  ValidateNested,
  IsArray,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskStatus, TaskType, TaskPriority } from '@prisma/client';

export class CreateTaskStepDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  startDate?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  reviewDate?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  dueDate?: string;

  @IsObject()
  @IsOptional()
  dataSpec?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  assignedToId?: string;
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsEnum(TaskType)
  @IsOptional()
  type?: TaskType;

  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @IsBoolean()
  @IsOptional()
  priorityManual?: boolean;

  @IsISO8601({ strict: true })
  @IsOptional()
  startDate?: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTaskStepDto)
  @IsOptional()
  steps?: CreateTaskStepDto[];
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
  parentId?: string | null;

  @IsEnum(TaskType)
  @IsOptional()
  type?: TaskType;

  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @IsBoolean()
  @IsOptional()
  priorityManual?: boolean;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601({ strict: true })
  @IsOptional()
  startDate?: string | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @IsOptional()
  assignedToId?: string | null;

  /** Fecha de revisión planificada (#76). */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601({ strict: true })
  @IsOptional()
  reviewDate?: string | null;

  /** Fecha de entrega comprometida (#76). */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601({ strict: true })
  @IsOptional()
  dueDate?: string | null;

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

/**
 * Cuadrilla completa de una tarea. Llega la lista entera y no altas o bajas
 * sueltas: el cliente manda el estado que quiere y no hay que reconciliar.
 */
export class SetTaskCrewDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];

  /** Jefe de cuadrilla. Debe venir dentro de `userIds`; `null` la deja sin jefe. */
  @IsString()
  @IsOptional()
  leadUserId?: string | null;
}

/** La misma cuadrilla para varias tareas del mismo proyecto. */
export class SetTaskCrewBulkDto {
  @IsArray()
  @IsString({ each: true })
  taskIds!: string[];

  @IsArray()
  @IsString({ each: true })
  userIds!: string[];

  @IsString()
  @IsOptional()
  leadUserId?: string | null;
}
