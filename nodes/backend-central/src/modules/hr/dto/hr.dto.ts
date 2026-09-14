import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AccreditationStatus, ExamResult } from '@prisma/client';

const recortar = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

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

  /** `true` = no vence. Si viene, la fecha de vencimiento se descarta. */
  @IsOptional()
  @IsBoolean()
  noExpiry?: boolean;

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
  @IsBoolean()
  noExpiry?: boolean;

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
  @IsBoolean()
  noExpiry?: boolean;

  @IsOptional()
  @IsString()
  fileUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/**
 * Datos de un documento subido por RRHH. Llega en multipart junto con el archivo,
 * así que todo es texto: `noExpiry` viaja como "true" o "false".
 */
export class CreateHrDocumentDto {
  @recortar()
  @IsString()
  @MinLength(1, { message: 'Indica el tipo de documento.' })
  @MaxLength(80)
  type!: string;

  @recortar()
  @IsString()
  @MinLength(1, { message: 'Indica el nombre del documento.' })
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== null)
  @IsISO8601({ strict: true }, { message: 'La fecha de emisión no es válida.' })
  issuedAt?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== null)
  @IsISO8601({ strict: true }, { message: 'La fecha de vencimiento no es válida.' })
  expiresAt?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  noExpiry?: string;
}

/** Corrección de los datos de un documento, sin tocar el archivo. JSON. */
export class UpdateHrDocumentDto {
  @IsOptional()
  @recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  type?: string;

  @IsOptional()
  @recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== null)
  @IsISO8601({ strict: true })
  issuedAt?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== null)
  @IsISO8601({ strict: true })
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  noExpiry?: boolean;
}
