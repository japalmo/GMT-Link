import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { FinanceStatus } from '@prisma/client';

/** Recorta espacios de un valor string (deja intactos los no-string). */
const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Body de `POST /overtime` (RequestForm §5). El `userId` NUNCA viene del body:
 * lo deriva el controller de la sesión. `hours` es decimal positivo (Float).
 */
export class CreateOvertimeDto {
  @IsISO8601({ strict: true }, { message: 'date debe ser una fecha ISO-8601.' })
  date!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'hours debe ser un número.' })
  @Min(0.01, { message: 'hours debe ser mayor a 0.' })
  hours!: number;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** Filtros opcionales de `GET /overtime/me` y `GET /overtime`. */
export class ListOvertimeQueryDto {
  @IsOptional()
  @IsEnum(FinanceStatus, { message: 'status inválido.' })
  status?: FinanceStatus;

  /** Solo para la vista del gestor (`GET /overtime`); ignorado en /me. */
  @IsOptional()
  @IsString()
  userId?: string;
}

/** Body opcional de `POST /overtime/:id/reject`. */
export class RejectOvertimeDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
