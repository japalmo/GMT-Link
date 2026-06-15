import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
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
}
