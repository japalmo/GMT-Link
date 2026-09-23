import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Datos del reporte de incidente que llega del formulario público.
 *
 * Viaja en multipart junto con las fotos, así que TODO llega como texto: los
 * "sí/no" de las consecuencias vienen como "true"/"false" y los números como
 * string. Se convierten acá, en el borde, y el resto del módulo trabaja con
 * tipos reales.
 */

const recortar = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/**
 * "true"/"1"/"on" => true. Cualquier otra cosa (o ausencia) => false.
 *
 * Lleva `@IsBoolean` además del `@Transform` porque el ValidationPipe corre con
 * `forbidNonWhitelisted`: una propiedad SIN regla de validación no entra en la
 * lista blanca y el envío completo se rechaza.
 */
const casilla = (): PropertyDecorator => (target, clave) => {
  Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true' || value === '1' || value === 'on',
  )(target, clave);
  IsOptional()(target, clave);
  IsBoolean()(target, clave);
};

/** Texto numérico a número; vacío o no numérico => null. Con regla, igual que `casilla`. */
const numero = (): PropertyDecorator => (target, clave) => {
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  })(target, clave);
  IsOptional()(target, clave);
  IsNumber()(target, clave);
};

export class CreateIncidentDto {
  @recortar()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  empresa?: string;

  @recortar()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sitio?: string;

  @recortar()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  area?: string;

  @recortar()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  turno?: string;

  /** Día del incidente, aaaa-mm-dd. */
  @IsISO8601({ strict: true }, { message: 'La fecha del incidente no es válida.' })
  fecha!: string;

  /** Hora del incidente, HH:mm. */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'La hora debe tener el formato HH:MM.' })
  hora!: string;

  @casilla() lesionPersonas?: boolean;
  @recortar() @IsOptional() @IsString() @MaxLength(160) cargoLesionado?: string;

  @casilla() danoInfraestructura?: boolean;
  @recortar() @IsOptional() @IsString() @MaxLength(300) danoDetalle?: string;

  @casilla() fugaDerrame?: boolean;
  @recortar() @IsOptional() @IsString() @MaxLength(160) fugaSustancia?: string;
  @numero() fugaDuracionMin?: number | null;
  @numero() fugaVolumenM3?: number | null;
  @numero() fugaPh?: number | null;
  @numero() fugaSuperficieM2?: number | null;

  @casilla() emisionesAire?: boolean;
  @recortar() @IsOptional() @IsString() @MaxLength(160) emisionGases?: string;
  @numero() emisionDuracionMin?: number | null;

  @casilla() instalaciones?: boolean;
  @recortar() @IsOptional() @IsString() @MaxLength(200) instalacionesLugar?: string;

  @casilla() cuasiAccidente?: boolean;
  @casilla() procesoAfectado?: boolean;

  @IsOptional()
  @IsIn(['CON', 'SIN'], { message: 'Indica si hubo o no tiempo perdido.' })
  tiempoPerdido?: 'CON' | 'SIN';

  @recortar()
  @IsString()
  @MinLength(20, { message: 'Describe lo ocurrido con al menos 20 caracteres.' })
  @MaxLength(2000)
  descripcion!: string;

  @recortar()
  @IsString()
  @MinLength(3, { message: 'Indica al menos una acción inmediata.' })
  @MaxLength(1200)
  accionesInmediatas!: string;

  @recortar()
  @IsString()
  @MinLength(3, { message: 'Indica quién prepara el reporte.' })
  @MaxLength(120)
  preparaNombre!: string;

  @recortar()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  preparaCargo?: string;

  @recortar()
  @IsOptional()
  @IsEmail({}, { message: 'El correo de contacto no es válido.' })
  reporterEmail?: string;
}
