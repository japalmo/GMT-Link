import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 4, { message: 'El código del cliente debe tener entre 1 y 4 caracteres.' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  rut?: string;
}
