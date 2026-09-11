import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AccreditationStatus, ExamResult } from '@prisma/client';

/** Examen ocupacional. Renovar es crear otro del mismo `type`: el historial son las filas. */
export class UpsertExamDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Indica el tipo de examen.' })
  @MaxLength(120)
  type!: string;

  @IsOptional()
  @IsISO8601()
  issuedAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  center?: string | null;

  @IsOptional()
  @IsEnum(ExamResult)
  result?: ExamResult | null;

  @IsOptional()
  @IsString()
  fileUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Inducción: un cliente y las faenas de ESE cliente donde vale. */
export class UpsertInductionDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Indica el cliente de la inducción.' })
  clientId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Indica el nombre de la inducción.' })
  @MaxLength(160)
  name!: string;

  /** Faenas donde vale. Llega la lista completa y reemplaza a la anterior. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  faenaIds?: string[];

  @IsOptional()
  @IsISO8601()
  issuedAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  fileUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Acreditación ante un cliente, opcionalmente acotada a una faena suya. */
export class UpsertAccreditationDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Indica el cliente que acredita.' })
  clientId!: string;

  /** `null` = acreditado ante el cliente, sin faena específica. */
  @IsOptional()
  @IsString()
  faenaId?: string | null;

  @IsOptional()
  @IsEnum(AccreditationStatus)
  status?: AccreditationStatus;

  @IsOptional()
  @IsISO8601()
  issuedAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  fileUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
