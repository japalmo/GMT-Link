import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Un ítem de layout dentro del body de `PUT /dashboard/me`. */
export class LayoutItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  widgetKey!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsBoolean()
  visible!: boolean;
}

/**
 * Body de `PUT /dashboard/me`. El service valida además que cada `widgetKey`
 * esté entre los widgets DISPONIBLES del usuario (rechaza desconocidos/no
 * permitidos con 400). El tope de tamaño acota el JSONB persistido.
 */
export class UpdateDashboardDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LayoutItemDto)
  layout!: LayoutItemDto[];
}
