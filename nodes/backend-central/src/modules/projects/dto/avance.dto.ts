import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Ediciones del control de avance de obra.
 *
 * Se recibe UNA celda por llamada, no la tabla entera: dos personas editando
 * semanas distintas no deben pisarse, y un guardado parcial no puede escribir
 * de vuelta valores viejos que el otro acaba de cambiar.
 *
 * Los porcentajes viajan como fracción 0-1, que es como los guarda la base. La
 * pantalla muestra 0-100 y convierte: mezclar las dos escalas en el transporte
 * es la forma más fácil de multiplicar por cien un informe firmado.
 */

/** Una celda de la tabla de actividades: el acumulado de una actividad en una semana. */
export class EditarAvanceActividadDto {
  /** Id de la actividad en el programa (MS Project). */
  @Type(() => Number)
  @IsInt()
  wbsId!: number;

  /** Índice de semana desde S-1. 0 = S-1. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  semana!: number;

  /** Acumulado 0-1. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  valor!: number;
}

/**
 * Una celda de la tabla de semanas.
 *
 * Todos los campos son opcionales: cada llamada trae el que se editó. Los de
 * sobreescritura admiten `null` explícito, que es como se QUITA la
 * sobreescritura para volver al valor calculado; por eso llevan `ValidateIf`
 * en vez de `IsOptional`, que descartaría el null y dejaría el override vivo.
 */
export class EditarSemanaDto {
  /**
   * Código de la semana: "S-3".
   *
   * Con su validador, no de adorno: el `ValidationPipe` corre con `whitelist`,
   * así que una propiedad SIN reglas se descarta en silencio y llega
   * `undefined`. Ya pasó dos veces en este repo.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^S-\d+$/, { message: 'El código de semana debe ser como "S-3".' })
  code!: string;

  // ── Plan (el programa base) ──
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hhPlan?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  parPlan?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  acmPlan?: number;

  // ── Sobreescritura del real ──
  @ValidateIf((_, valor) => valor !== null && valor !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  parRealOverride?: number | null;

  @ValidateIf((_, valor) => valor !== null && valor !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  acmRealOverride?: number | null;
}

/**
 * El corte del informe vigente: la fecha y cuánto esperaba el programa ESE día.
 *
 * Existe porque al cargar una semana nueva el real avanza, y si el corte se
 * quedara en el informe anterior el encabezado compararía el real de S-4 contra
 * el plan de S-3: una desviación inventada.
 */
export class EditarCorteDto {
  /** aaaa-mm-dd. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha de corte debe ser aaaa-mm-dd.' })
  cutoffDate!: string;

  /**
   * Plan al corte, 0-1. `null` = usar el acumulado plan de la última semana
   * informada, que es la aproximación que ya hace el informe sin este dato.
   */
  @ValidateIf((_, valor) => valor !== null && valor !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  planAtCutoff?: number | null;
}
