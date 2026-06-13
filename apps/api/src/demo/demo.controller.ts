import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermission } from '../authz/require-permission.decorator';

interface DemoSecretResponse {
  secret: string;
  projectId: string;
}

/**
 * Endpoint de prueba del guard de permisos (DoD Etapa 0.4):
 * GET /demo/projects/:projectId/secret responde 200 solo si OpenFGA
 * confirma `can_view` del usuario sobre `project:<projectId>`.
 * SE ELIMINA cuando exista un módulo real que use @RequirePermission.
 */
@Controller('demo')
export class DemoController {
  @Get('projects/:projectId/secret')
  @RequirePermission('can_view', { type: 'project', param: 'projectId' })
  getProjectSecret(@Param('projectId') projectId: string): DemoSecretResponse {
    return { secret: 'gtm', projectId };
  }
}
