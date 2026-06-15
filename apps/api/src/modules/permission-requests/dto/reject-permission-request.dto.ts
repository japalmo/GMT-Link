import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /permission-requests/:id/reject`. El motivo es opcional; se
 * persiste en `reason` (sobrescribe el del solicitante) para que quede el motivo
 * del rechazo del admin.
 */
export class RejectPermissionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
