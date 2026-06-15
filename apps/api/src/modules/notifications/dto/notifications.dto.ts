import { IsBooleanString, IsOptional } from 'class-validator';

/**
 * Filtros de `GET /notifications`. `unreadOnly` llega como string booleana
 * ('true'/'false') porque viene del query string; el controller la interpreta.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @IsBooleanString({ message: 'unreadOnly debe ser "true" o "false".' })
  unreadOnly?: string;
}
