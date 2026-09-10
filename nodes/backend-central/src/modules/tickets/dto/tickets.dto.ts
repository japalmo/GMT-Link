import {
  Equals,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  TicketFrequency,
  TicketLane,
  TicketPeopleAffected,
  TicketPriority,
  TicketSize,
  TicketStatus,
  TicketType,
} from '@prisma/client';

/**
 * Alta de un ticket. El formulario envía y el ticket queda en ENVIADO: el
 * estado BORRADOR existe en el modelo para guardados parciales futuros, pero
 * esta iteración no expone guardar borrador.
 */
export class CreateTicketDto {
  @IsEnum(TicketType)
  type!: TicketType;

  @IsString()
  @IsNotEmpty({ message: 'El título es obligatorio.' })
  @MaxLength(200, { message: 'El título no puede superar los 200 caracteres.' })
  title!: string;

  /** Área organizacional que levanta la solicitud (Department). */
  @IsString()
  @IsNotEmpty({ message: 'Debes indicar el área que levanta la solicitud.' })
  departmentId!: string;

  /** Contexto opcional: de qué faena o proyecto nace el requerimiento. */
  @IsString()
  @IsOptional()
  faenaId?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Debes identificar la jefatura que respalda la solicitud.' })
  @MaxLength(150)
  managerName!: string;

  /**
   * Declaración explícita de que la jefatura respalda. Sin jefatura identificada
   * el ticket no entra a priorización, así que se exige `true`, no solo presente.
   */
  @IsBoolean()
  @Equals(true, { message: 'Debes confirmar que tu jefatura respalda esta solicitud.' })
  managerAck!: boolean;

  @IsString()
  @IsNotEmpty({ message: 'Indica el módulo afectado.' })
  @MaxLength(80)
  module!: string;

  @IsString()
  @IsNotEmpty({ message: 'Describe qué necesitas que el sistema haga.' })
  @MaxLength(4000)
  expected!: string;

  @IsString()
  @IsNotEmpty({ message: 'Describe qué pasa hoy si esto no existe.' })
  @MaxLength(4000)
  impact!: string;

  @IsEnum(TicketPeopleAffected)
  peopleAffected!: TicketPeopleAffected;

  @IsEnum(TicketFrequency)
  frequency!: TicketFrequency;

  @IsISO8601({ strict: true })
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  milestone?: string;
}

/** Clasificación que pone Informática en el triage. */
export class TriageTicketDto {
  @IsEnum(TicketLane)
  @IsOptional()
  lane?: TicketLane;

  @IsEnum(TicketSize)
  @IsOptional()
  size?: TicketSize;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  @IsOptional()
  assignedToId?: string;
}

/**
 * Transición de estado. El servidor valida contra la máquina de estados: que el
 * par (actual → `to`) exista, que el usuario tenga el rol que la regla exige y
 * que traiga comentario cuando el procedimiento lo obliga.
 */
export class TransitionTicketDto {
  @IsEnum(TicketStatus)
  to!: TicketStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}

/** Comentario suelto en la bitácora, sin cambiar de estado. */
export class CommentTicketDto {
  @IsString()
  @IsNotEmpty({ message: 'El comentario no puede estar vacío.' })
  @MaxLength(2000)
  comment!: string;
}
