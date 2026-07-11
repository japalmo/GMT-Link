import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsIn,
} from 'class-validator';

/** Tope del `amount` (CLP): máximo Int32 de Postgres (columna Prisma `Int`). */
const MAX_AMOUNT_CLP = 2_147_483_647;
import { FinanceStatus } from '@prisma/client';

/** Recorta espacios de un valor string (deja intactos los no-string). */
const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Body de `POST /reimbursements` (RequestForm §5). El `userId` NUNCA viene del
 * body: lo deriva el controller de la sesión. `amount` es CLP entero positivo.
 */
export class CreateReimbursementDto {
  @Type(() => Number)
  @IsInt({ message: 'amount debe ser un entero (CLP, sin decimales).' })
  @Min(1, { message: 'amount debe ser mayor a 0.' })
  @Max(MAX_AMOUNT_CLP, { message: `amount no puede superar ${MAX_AMOUNT_CLP} (CLP).` })
  amount!: number;

  @IsISO8601({ strict: true }, { message: 'date debe ser una fecha ISO-8601.' })
  date!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  concept!: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  subcategory?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(120)
  vehicle?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  observations?: string;
}

/** Filtros opcionales de `GET /reimbursements/me` y `GET /reimbursements`. */
export class ListReimbursementsQueryDto {
  @IsOptional()
  @IsEnum(FinanceStatus, { message: 'status inválido.' })
  status?: FinanceStatus;

  /** Solo para la vista del gestor (`GET /reimbursements`); ignorado en /me. */
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month debe ser "YYYY-MM".' })
  month?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc.' })
  order?: 'asc' | 'desc';

  /** Selector "pendientes de impresión" (`printed=false`). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  )
  @IsBoolean()
  printed?: boolean;
}

/** Body opcional de `POST /reimbursements/:id/reject`. */
export class RejectReimbursementDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** Body de `POST /reimbursements/import` para importación masiva. */
export class ImportReimbursementsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'El lote debe traer al menos un reembolso.' })
  @ArrayMaxSize(200, { message: 'No se pueden importar más de 200 reembolsos a la vez.' })
  @ValidateNested({ each: true })
  @Type(() => CreateReimbursementDto)
  items!: CreateReimbursementDto[];
}

/**
 * Body de `POST /reimbursements/print` (§6-3.2). Genera un PDF en el servidor con
 * las boletas seleccionadas en una grilla de `perPage` por página.
 */
export class PrintReimbursementsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecciona al menos un reembolso.' })
  @ArrayMaxSize(200, { message: 'No se pueden imprimir más de 200 boletas a la vez.' })
  @IsString({ each: true })
  ids!: string[];

  @Type(() => Number)
  @IsIn([2, 4, 6], { message: 'perPage debe ser 2, 4 o 6.' })
  perPage!: 2 | 4 | 6;

  @IsOptional()
  @IsIn(['portrait', 'landscape'], { message: 'orientation inválida.' })
  orientation?: 'portrait' | 'landscape';

  @IsOptional()
  @IsIn(['A4', 'letter'], { message: 'size inválido.' })
  size?: 'A4' | 'letter';
}

/** Body de `POST /reimbursements/print/mark` — marca impresas tras confirmar descarga. */
export class MarkPrintedDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecciona al menos un reembolso.' })
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

