import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Recorta espacios de un valor string (deja intactos los no-string). */
const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

// ============ CV (resumen) ============

/** Body de `PATCH /cv/me`. `summary` opcional; '' limpia el resumen (→ null). */
export class UpdateCvDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(5000)
  summary?: string;
}

// ============ Experiencia ============

/** Body de `POST /cv/me/experiences`. */
export class CreateExperienceDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  role!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  company!: string;

  @IsISO8601({ strict: true }, { message: 'startDate debe ser una fecha ISO-8601.' })
  startDate!: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'endDate debe ser una fecha ISO-8601.' })
  endDate?: string | null;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/** Body de `PATCH /cv/me/experiences/:id` (todos los campos opcionales). */
export class UpdateExperienceDto {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  role?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  company?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'startDate debe ser una fecha ISO-8601.' })
  startDate?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'endDate debe ser una fecha ISO-8601.' })
  endDate?: string | null;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

// ============ Educación ============

/** Body de `POST /cv/me/education`. */
export class CreateEducationDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  institution!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  degree!: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'startDate debe ser una fecha ISO-8601.' })
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'endDate debe ser una fecha ISO-8601.' })
  endDate?: string | null;
}

/** Body de `PATCH /cv/me/education/:id`. */
export class UpdateEducationDto {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  institution?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  degree?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'startDate debe ser una fecha ISO-8601.' })
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'endDate debe ser una fecha ISO-8601.' })
  endDate?: string | null;
}

// ============ Certificación ============

/** Body de `POST /cv/me/certifications`. */
export class CreateCertificationDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(160)
  issuer?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'issuedAt debe ser una fecha ISO-8601.' })
  issuedAt?: string | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'expiresAt debe ser una fecha ISO-8601.' })
  expiresAt?: string | null;
}

/** Body de `PATCH /cv/me/certifications/:id`. */
export class UpdateCertificationDto {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(160)
  issuer?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'issuedAt debe ser una fecha ISO-8601.' })
  issuedAt?: string | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value !== null)
  @IsISO8601({ strict: true }, { message: 'expiresAt debe ser una fecha ISO-8601.' })
  expiresAt?: string | null;
}
