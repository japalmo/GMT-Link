import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { DayNight, ShiftPattern } from '@gmt-platform/contracts';

/** Patrones de turno válidos (espejo del enum Prisma / contrato). */
const SHIFT_PATTERNS: readonly ShiftPattern[] = [
  'ADMINISTRATIVO',
  'SIETE_POR_SIETE',
  'CUATRO_POR_TRES',
  'CATORCE_POR_CATORCE',
  'PERSONALIZADO',
];

/** Turno diurno / nocturno. */
const DAY_NIGHTS: readonly DayNight[] = ['DIA', 'NOCHE'];

/** "HH:mm" 24h (00:00 a 23:59). */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Body de `PUT /users/:id/schedule` — upsert de la jornada de un trabajador por
 * un administrador. Es un reemplazo completo (no patch parcial): `shiftPattern` y
 * `dayNight` son obligatorios. Para `PERSONALIZADO`, `workDays`/`restDays` deben
 * venir (≥1); los preset cíclicos los derivan y en `ADMINISTRATIVO` se ignoran.
 * La regla cruzada (qué campos exige cada patrón) la valida el service.
 */
export class UpsertWorkScheduleDto {
  @IsIn(SHIFT_PATTERNS, { message: 'Patrón de turno inválido.' })
  shiftPattern!: ShiftPattern;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Los días de faena deben ser al menos 1.' })
  @Max(60, { message: 'Los días de faena no pueden superar 60.' })
  workDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Los días de descanso deben ser al menos 1.' })
  @Max(60, { message: 'Los días de descanso no pueden superar 60.' })
  restDays?: number | null;

  /** Día 1 del ciclo (ISO-8601 date o datetime); `null`/ausente = sin definir. */
  @IsOptional()
  @IsString()
  cycleStart?: string | null;

  @IsIn(DAY_NIGHTS, { message: 'Turno inválido (día o noche).' })
  dayNight!: DayNight;

  @IsOptional()
  @IsString()
  @Matches(HHMM_RE, { message: 'La hora de inicio debe tener formato HH:mm.' })
  startTime?: string | null;

  @IsOptional()
  @IsString()
  @Matches(HHMM_RE, { message: 'La hora de término debe tener formato HH:mm.' })
  endTime?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
