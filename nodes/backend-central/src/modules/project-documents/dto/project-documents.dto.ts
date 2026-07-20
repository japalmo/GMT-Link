import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

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

  /**
   * Entregable de una tarea (#77): linkea el documento a la tarea que lo produjo,
   * además del proyecto. Opcional: los documentos de proyecto normales no lo llevan.
   */
  @IsString()
  @IsOptional()
  taskId?: string;
}

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes ingresar un motivo de rechazo.' })
  reason!: string;
}
