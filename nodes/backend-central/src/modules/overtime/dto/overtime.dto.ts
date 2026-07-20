import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
 * (no las envía el cliente). `endTime` ausente => borrador. La fecha debe caer en el
 * mes en curso, salvo que el creador tenga `finance:overtime:create:onbehalf` (que lo
 * exime de la ventana y puede fijar cualquier fecha; lo resuelve el service).
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

  /**
   * Fin de semana o feriado: cuando es true, NO se descuenta el turno; todo el
   * periodo entra como hora extra (el service pasa shift=null al cálculo).
   */
  @IsOptional()
  @IsBoolean()
  weekendOrHoliday?: boolean;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Body de `PUT /overtime/:id` — edita una solicitud PROPIA aún PENDIENTE (spec §5.6).
 * Subconjunto editable: NO incluye `userId`/`date`/`onBehalfOfUserId` (el
 * ValidationPipe con whitelist los descarta). Las horas se RECOMPUTAN de
 * `startTime`/`endTime` en el service; `endTime` ausente => vuelve a borrador.
 */
export class UpdateOvertimeDto {
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

  /** Fin de semana o feriado: todo el periodo entra como hora extra (shift=null). */
  @IsOptional()
  @IsBoolean()
  weekendOrHoliday?: boolean;

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

  /**
   * Tope de filas de la página. Sin validación de rango a propósito: el
   * `service` normaliza (default 30, tope 100) e ignora valores no numéricos, en
   * vez de responder 400 por un límite mal formado.
   */
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  /** Cursor keyset opaco de la página siguiente (`Paginated.nextCursor`). */
  @IsOptional()
  @IsString()
  cursor?: string;
}

/** Body opcional de `POST /overtime/:id/reject`. */
export class RejectOvertimeDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
