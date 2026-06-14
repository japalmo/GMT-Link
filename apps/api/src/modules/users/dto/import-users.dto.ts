import { ArrayMaxSize, ArrayMinSize, IsArray, IsObject } from 'class-validator';

/** Tope de filas por importación (§1.1) para acotar el costo de un lote. */
export const MAX_IMPORT_ROWS = 200;

/**
 * Body de `POST /users/import` (§1.1). Lote de hasta 200 filas.
 *
 * Las filas se reciben CRUDAS (`unknown[]`) a propósito: la validación de forma
 * de CADA fila se hace dentro del servicio (`UsersService.importBatch`), de modo
 * que una fila con formato inválido (email mal escrito, rol con typo, campo de
 * más) NO tumba el lote completo — se reporta en `errors[]` y las filas buenas
 * sí se importan (contrato §6-1.1). El ValidationPipe global solo valida aquí los
 * límites del lote (1..200) y que cada fila sea un objeto.
 */
export class ImportUsersDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe enviar al menos una fila.' })
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `No se pueden importar más de ${MAX_IMPORT_ROWS} filas por lote.`,
  })
  @IsObject({ each: true, message: 'Cada fila debe ser un objeto.' })
  rows!: unknown[];
}
