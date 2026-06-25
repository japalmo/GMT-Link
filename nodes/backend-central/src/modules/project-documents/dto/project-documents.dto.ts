import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateProjectDocumentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  @Length(2, 4, { message: 'El código de tipo de documento debe tener entre 2 y 4 caracteres.' })
  documentType!: string;

  @IsString()
  @IsNotEmpty()
  @Length(2, 4, { message: 'El código de área debe tener entre 2 y 4 caracteres.' })
  areaCode!: string;
}

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes ingresar un motivo de rechazo.' })
  reason!: string;
}
