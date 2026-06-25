import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { DocumentStatus } from '@prisma/client';

/** Recorta espacios de un valor string (deja intactos los no-string). */
const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Metadatos del documento en el upload multipart (`POST /documents/me`).
 * El archivo va aparte (campo `file`); aquí solo los campos de texto, que en
 * multipart llegan como strings.
 */
export class CreatePersonalDocumentDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  type!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'issuedAt debe ser una fecha ISO-8601.' })
  issuedAt?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'expiresAt debe ser una fecha ISO-8601.' })
  expiresAt?: string;
}

/**
 * Filtros de `GET /documents/me`. `status` enum opcional; `expiring` como string
 * booleana ('true'/'false') porque viene del query string.
 */
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsEnum(DocumentStatus, { message: 'status inválido.' })
  status?: DocumentStatus;

  @IsOptional()
  @IsBooleanString({ message: 'expiring debe ser "true" o "false".' })
  expiring?: string;
}

/**
 * Body de `POST /documents/:id/reject`. `reason` es opcional; el schema NO tiene
 * campo de motivo (MVP), así que se registra en log pero no se persiste.
 */
export class RejectDocumentDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
