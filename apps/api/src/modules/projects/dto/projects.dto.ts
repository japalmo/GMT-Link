import { IsNotEmpty, IsObject, IsString, Length } from 'class-validator';
import { Prisma } from '@prisma/client';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 4, { message: 'El código del proyecto debe tener entre 3 y 4 caracteres.' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  departmentId!: string;

  @IsString()
  @IsNotEmpty()
  clientId!: string;
}

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 3, { message: 'El código del servicio debe tener exactamente 3 caracteres.' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  @IsNotEmpty()
  docCodingConfig!: Prisma.InputJsonValue;
}

export class UpdateProjectKpisDto {
  @IsObject()
  @IsNotEmpty()
  kpis!: Prisma.InputJsonValue;
}
