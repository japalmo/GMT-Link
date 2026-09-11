import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthzModule } from '../../authz/authz.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

/**
 * RRHH: antecedentes laborales y habilitación del trabajador.
 *
 * El gate se resuelve con `PermissionService` inline y no con `@RequirePermission`
 * porque `hr:read` acepta además el permiso viejo del directorio extendido, para
 * no apagarle la sección a quien ya la tenía cuando se llamaba Directorio.
 */
@Module({
  imports: [PrismaModule, AuthzModule],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
