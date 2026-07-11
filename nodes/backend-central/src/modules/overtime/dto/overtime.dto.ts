import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { FinanceStatus } from '@prisma/client';

/** Recorta espacios de un valor string (deja intactos los no-string). */
const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** Formato "HH:mm" (00:00–23:59). */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Body de `POST /overtime` (spec §5.6). El `userId` NUNCA viene del body: lo
 * deriva el controller de la sesión. Las horas se COMPUTAN de `startTime`/`endTime`
 * (no las envía el cliente). `endTime` ausente => borrador. La fecha se fuerza a hoy
 * salvo que el creador tenga `finance:overtime:create:onbehalf` (lo resuelve el service).
 */
export class CreateOvertimeDto {
  @IsISO8601({ strict: true }, { message: 'date debe ser una fecha ISO-8601.' })
  date!: string;

  @IsString()
  @Matches(HHMM, { message: 'startTime debe tener formato HH:mm.' })
  startTime!: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'endTime debe tener formato HH:mm.' })
  endTime?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  projectOther?: string;

  @IsOptional()
  @IsString()
  authorizedById?: string;

  @IsOptional()
  @IsString()
  onBehalfOfUserId?: string; // id del TRABAJADOR objetivo (requiere permiso; el service valida)

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Body de `POST /overtime/:id/close` — cierra un borrador con la hora de término. */
export class CloseOvertimeDto {
  @IsString()
  @Matches(HHMM, { message: 'endTime debe tener formato HH:mm.' })
  endTime!: string;
}

/** Filtros opcionales de `GET /overtime/me` y `GET /overtime`. */
export class ListOvertimeQueryDto {
  @IsOptional()
  @IsEnum(FinanceStatus, { message: 'status inválido.' })
  status?: FinanceStatus;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string; // fecha exacta (día)

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month debe ser "YYYY-MM".' })
  month?: string; // mes contable (cierre día 20)

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc.' })
  order?: 'asc' | 'desc';
}

/** Body opcional de `POST /overtime/:id/reject`. */
export class RejectOvertimeDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
