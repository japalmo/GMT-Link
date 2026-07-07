import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Actualización parcial de un cliente. Solo `name` y `rut` son editables;
 * el `code` es inmutable (parte de la codificación de documentos, §7).
 */
export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  rut?: string;
}
