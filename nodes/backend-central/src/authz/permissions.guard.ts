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

    const resourceId = this.resolveResourceId(metadata.resource, request);

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

  /**
   * Resuelve el id del recurso FGA según la forma del descriptor:
   *  - id estático → se usa tal cual (acciones org-scope, §1.1);
   *  - param de ruta → se lee de `request.params`, 400 si falta.
   * La unión es discriminada por la presencia de `param`, así nunca se
   * consulta un objeto ambiguo.
   */
  private resolveResourceId(
    resource: PermissionMetadata['resource'],
    request: Request,
  ): string {
    if (resource.param !== undefined) {
      // En Express 5 un param puede ser string o string[] (rutas con comodín);
      // para un id de recurso esperamos un único segmento → tomamos el primero.
      const raw = request.params[resource.param];
      const fromRoute = Array.isArray(raw) ? raw[0] : raw;
      if (!fromRoute) {
        throw new BadRequestException(
          `Falta el parámetro de ruta "${resource.param}" necesario para evaluar el permiso sobre "${resource.type}".`,
        );
      }
      return fromRoute;
    }
    return resource.id;
  }
}
