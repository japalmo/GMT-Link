import { WarehouseTxType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty({ message: 'El código de la bodega es requerido' })
  @MaxLength(4, { message: 'El código de la bodega no puede exceder 4 caracteres' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre de la bodega es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  location?: string;
}

export class CreateSupplyDto {
  @IsString()
  @IsNotEmpty({ message: 'El código del insumo es requerido' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del insumo es requerido' })
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  providerId?: string;
}

export class ImportItemDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  providerId?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  initialStock?: number;

  @IsString()
  @IsOptional()
  warehouseId?: string;
}

export class ImportSuppliesDto {
  @ValidateNested({ each: true })
  @Type(() => ImportItemDto)
  items!: ImportItemDto[];
}

export class RegisterTransactionDto {
  @IsString()
  @IsNotEmpty({ message: 'El id del insumo es requerido' })
  supplyId!: string;

  @IsEnum(WarehouseTxType, { message: 'El tipo de transacción debe ser ENTRY o EXIT' })
  type!: WarehouseTxType;

  @IsNumber()
  @Min(0.01, { message: 'La cantidad debe ser mayor a cero' })
  quantity!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
