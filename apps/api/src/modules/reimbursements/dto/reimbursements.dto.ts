import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
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
  @ValidateNested({ each: true })
  @Type(() => CreateReimbursementDto)
  items!: CreateReimbursementDto[];
}

