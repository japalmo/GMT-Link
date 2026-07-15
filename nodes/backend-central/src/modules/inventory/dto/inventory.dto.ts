import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Crear un artículo individual del catálogo de Inventario. Crear NO implica stock. */
export class CreateInventoryItemDto {
  @IsString()
  @IsNotEmpty({ message: 'El código del artículo es requerido' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del artículo es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  brand?: string;

  // `category` hace de "tipo" del artículo en la UI.
  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

/**
 * Editar los campos DESCRIPTIVOS de un artículo. El `code` es identidad (clave del
 * import por upsert) y NO se edita por acá. String vacío limpia el campo opcional.
 */
export class UpdateInventoryItemDto {
  // ValidateIf (y no IsOptional): un `name: null` explícito SÍ corre los
  // validadores y devuelve 400 legible en vez de un 500 de Prisma (IsOptional
  // omite los validadores también con null, no solo con undefined).
  @IsString()
  @IsNotEmpty({ message: 'El nombre del artículo no puede quedar vacío' })
  @ValidateIf((o: UpdateInventoryItemDto) => o.name !== undefined)
  name?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

/** Stock inicial de una fila del import: bodega POR CÓDIGO + cantidad. */
export class ImportInventoryStockDto {
  @IsString()
  @IsNotEmpty({ message: 'El código de la bodega es requerido' })
  warehouseCode!: string;

  @IsNumber()
  @Min(0, { message: 'La cantidad de stock inicial no puede ser negativa' })
  quantity!: number;
}

/** Fila del import masivo de artículos (formato CSV de la dueña). */
export class ImportInventoryItemDto {
  @IsString()
  @IsNotEmpty({ message: 'El código del artículo es requerido' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del artículo es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @ArrayMaxSize(4, { message: 'El stock inicial admite máximo 4 bodegas por artículo' })
  @ValidateNested({ each: true })
  @Type(() => ImportInventoryStockDto)
  @IsOptional()
  stocks?: ImportInventoryStockDto[];
}

/** Body de `POST /inventory/items/import`. */
export class ImportInventoryDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Debes incluir al menos un artículo' })
  @ValidateNested({ each: true })
  @Type(() => ImportInventoryItemDto)
  items!: ImportInventoryItemDto[];
}

/** Vincular un proveedor a un artículo (precio CLP + URL opcionales). */
export class LinkProviderDto {
  @IsString()
  @IsNotEmpty({ message: 'El proveedor es requerido' })
  providerId!: string;

  @IsInt({ message: 'El precio debe ser un entero en CLP' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  url?: string;
}

/**
 * Editar el precio/URL de un vínculo artículo-proveedor existente.
 * `price: null` explícito LIMPIA el precio (paridad con la URL, que se limpia
 * con string vacío); `price` ausente lo conserva.
 */
export class UpdateProviderLinkDto {
  @IsInt({ message: 'El precio debe ser un entero en CLP' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  @IsOptional()
  price?: number | null;

  @IsString()
  @IsOptional()
  url?: string;
}

/** Entregar una solicitud de insumos descontando stock de UNA bodega. */
export class DeliverRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'La bodega es requerida' })
  warehouseId!: string;

  @IsString()
  @IsOptional()
  note?: string;
}

/** Rechazar una solicitud de insumos. */
export class RejectRequestDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

/** Ítem de una solicitud propia: artículo + cantidad mayor a cero. */
export class MyRequestItemDto {
  @IsString()
  @IsNotEmpty({ message: 'El artículo es requerido' })
  supplyId!: string;

  @IsNumber()
  @Min(0.01, { message: 'La cantidad debe ser mayor a cero' })
  quantity!: number;
}

/** Body de `POST /inventory/me/requests` (crear solicitud de insumos propia). */
export class CreateMyRequestDto {
  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Debes incluir al menos un artículo' })
  @ValidateNested({ each: true })
  @Type(() => MyRequestItemDto)
  items!: MyRequestItemDto[];
}
