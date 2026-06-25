import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum ConvertDirection {
  UTM_TO_LL = 'UTM_TO_LL',
  LL_TO_UTM = 'LL_TO_UTM',
}

export class ConvertPointDto {
  @IsEnum(ConvertDirection, { message: 'Dirección de conversión inválida' })
  direction!: ConvertDirection;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsNumber()
  @IsOptional()
  easting?: number;

  @IsNumber()
  @IsOptional()
  northing?: number;

  @IsNumber()
  @IsOptional()
  zone?: number;

  @IsBoolean()
  @IsOptional()
  southernHemisphere?: boolean;
}

export class BulkConvertDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConvertPointDto)
  points!: ConvertPointDto[];
}

export class ShoreDetectDto {
  @IsString()
  @IsNotEmpty({ message: 'La imagen en Base64 es requerida' })
  fileBase64!: string;

  @IsString()
  @IsOptional()
  fileName?: string;
}
