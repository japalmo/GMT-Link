import { IsNotEmpty, IsString, Matches } from 'class-validator';

/** Body de `POST /liquidations` para subir una liquidación de sueldo. */
export class CreateLiquidationDto {
  @IsNotEmpty()
  @IsString()
  userId!: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period debe tener el formato YYYY-MM (ej. 2026-06).',
  })
  period!: string;
}
