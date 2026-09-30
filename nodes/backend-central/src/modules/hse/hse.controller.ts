import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { HseService, MAX_FOTO_BYTES, MAX_FOTOS } from './hse.service';
import { CreateIncidentDto } from './dto/hse.dto';
import type {
  HseIncidentCreated,
  HseIncidentDetail,
  HseIncidentRow,
  TablePage,
  TableRequest,
} from '@gmt-platform/contracts';

/**
 * HSE — reportes de incidente.
 *
 * Dos puertas distintas:
 *  - `public/*`: el formulario de terreno, SIN sesión. La credencial es el token
 *    del reporte recién creado, que solo sirve para bajar ese PDF. Va con
 *    `@Throttle` porque cualquiera con el enlace puede llamarlo.
 *  - el resto: el historial de la sección HSE, con permiso `hse:read`.
 */
@Controller('hse')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class HseController {
  constructor(
    private readonly hse: HseService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Formulario público ────────────────────────────────────────────────────

  /**
   * Recibe un reporte desde el enlace público. Hasta 3 fotos; la primera es
   * obligatoria y es la que va en el recuadro del formato.
   */
  @Throttle({ default: { limit: 6, ttl: 60_000 } }) // 6/min por IP: endpoint sin auth
  @Post('public/incidents')
  @UseInterceptors(FilesInterceptor('fotos', MAX_FOTOS, { limits: { fileSize: MAX_FOTO_BYTES } }))
  async createPublic(
    @Body() dto: CreateIncidentDto,
    @UploadedFiles() fotos: Express.Multer.File[] | undefined,
  ): Promise<HseIncidentCreated> {
    return this.hse.create(dto, this.hse.validarFotos(fotos));
  }

  /**
   * Descarga el PDF recién enviado, sin sesión. El token es del reporte y no
   * se puede adivinar; no expone el listado ni ningún otro reporte.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('public/incidents/:token/pdf')
  async pdfPublico(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const { bytes, code } = await this.hse.pdf({ publicToken: token });
    enviarPdf(res, bytes, code);
  }

  // ── Historial de la sección HSE ───────────────────────────────────────────

  @Get('incidents')
  async table(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ): Promise<TablePage<HseIncidentRow>> {
    await this.assertPuedeVer(authUser);
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 20,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
    };
    return this.hse.table(req);
  }

  @Get('incidents/:id')
  async detail(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<HseIncidentDetail> {
    await this.assertPuedeVer(authUser);
    return this.hse.detail(id);
  }

  @Get('incidents/:id/pdf')
  async pdf(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertPuedeVer(authUser);
    const { bytes, code } = await this.hse.pdf({ id });
    enviarPdf(res, bytes, code);
  }

  /** Borra un reporte del historial. Definitivo: se lleva fotos y PDF. */
  @Delete('incidents/:id')
  async remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true; code: string }> {
    await this.assertPuede(authUser, 'hse:manage');
    return this.hse.remove(id);
  }

  private async assertPuedeVer(authUser: AuthUser | undefined): Promise<void> {
    return this.assertPuede(authUser, 'hse:read');
  }

  private async assertPuede(
    authUser: AuthUser | undefined,
    clave: 'hse:read' | 'hse:manage',
  ): Promise<void> {
    if (!authUser) throw new UnauthorizedException('Se requiere un usuario autenticado.');
    const decision = await this.permissions.can(authUser.id, clave);
    if (decision.effect !== 'allow') {
      throw new ForbiddenException(
        clave === 'hse:manage'
          ? 'No tienes permisos para borrar reportes de HSE.'
          : 'No tienes permisos para ver los reportes de HSE.',
      );
    }
  }
}

/** Manda el PDF como descarga, con el número de registro por nombre. */
function enviarPdf(res: Response, bytes: Buffer, code: string): void {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${code}.pdf"`,
    'Content-Length': String(bytes.length),
  });
  res.end(bytes);
}
