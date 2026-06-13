import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { FgaService } from '../fga/fga.service';
import { PERMISSION_METADATA_KEY } from './require-permission.decorator';
import type { PermissionMetadata } from './require-permission.decorator';

/**
 * Guard global de autorización (§3.1).
 * Toda decisión de permiso se resuelve en OpenFGA vía `FgaService.check`:
 * PROHIBIDO consultar roles directamente aquí o en cualquier handler.
 * Sin metadata de `@RequirePermission` la ruta se considera pública
 * para este guard (la autenticación es responsabilidad de la Etapa 0.5).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly fgaService: FgaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata | undefined>(
      PERMISSION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authUser = request.authUser;
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }

    const resourceId = request.params[metadata.resource.param];
    if (!resourceId) {
      throw new BadRequestException(
        `Falta el parámetro de ruta "${metadata.resource.param}" necesario para evaluar el permiso "${metadata.relation}" sobre "${metadata.resource.type}".`,
      );
    }

    const allowed = await this.fgaService.check({
      user: `user:${authUser.id}`,
      relation: metadata.relation,
      object: `${metadata.resource.type}:${resourceId}`,
    });
    if (!allowed) {
      throw new ForbiddenException(
        `No tienes el permiso "${metadata.relation}" sobre este recurso.`,
      );
    }
    return true;
  }
}
