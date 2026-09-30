import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { MAX_DOCUMENT_BYTES, validarArchivoDocumento } from '../documents/document-file.util';
import { HrService } from './hr.service';
import {
  CreateHrDocumentDto,
  UpdateHrDocumentDto,
  UpsertAccreditationDto,
  UpsertExamDto,
  UpsertInductionDto,
} from './dto/hr.dto';
import type {
  HrAccreditation,
  HrDashboard,
  HrDocument,
  HrExam,
  HrHours,
  HrInduction,
  HrPersonPage,
  HrRequirementPage,
  HrWorkerRow,
  HrWorkerSummary,
  TableRequest,
} from '@gmt-platform/contracts';

/**
 * RRHH — antecedentes laborales y habilitación del trabajador.
 *
 * Dos permisos, consultados por clave y nunca comparando roles (ADR-0001):
 * `hr:read` para consultar y `hr:manage` para crear, editar y borrar. Ninguno
 * reparte acceso a la plataforma: los roles siguen administrándose en Usuarios.
 *
 * Son FUNCTIONAL y sin recurso, así que `can` resuelve con los grants de
 * Postgres y no consulta OpenFGA: RRHH es de toda la empresa, no de un proyecto.
 */
@Controller('hr')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class HrController {
  constructor(
    private readonly hr: HrService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Tablero y consulta ────────────────────────────────────────────────────

  @Get('dashboard')
  async dashboard(@CurrentUser() authUser: AuthUser | undefined): Promise<HrDashboard> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.dashboard();
  }

  /** Tabla de consulta: una fila por requisito. */
  @Get('requirements')
  async requirements(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<HrRequirementPage> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.requirementsTable(tabla(page, pageSize, search, sortBy, sortDir, filters));
  }

  /** La misma consulta, agrupada por persona. */
  @Get('people')
  async people(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<HrPersonPage> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.peopleTable(tabla(page, pageSize, search, sortBy, sortDir, filters));
  }

  // ── Directorio y ficha ────────────────────────────────────────────────────

  @Get('workers')
  async listWorkers(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('search') search?: string,
  ): Promise<HrWorkerRow[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listWorkers(search);
  }

  @Get('workers/:userId/summary')
  async summary(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrWorkerSummary> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.summary(userId);
  }

  @Get('workers/:userId/hours')
  async hours(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<HrHours> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.hours(userId, from, to);
  }

  // ── Documentos ────────────────────────────────────────────────────────────

  @Get('workers/:userId/documents')
  async listDocuments(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrDocument[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listDocuments(userId);
  }

  /** Sube un documento en nombre del trabajador (multipart, campo `file`). */
  @Post('workers/:userId/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async createDocument(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
    @Body() dto: CreateHrDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<HrDocument> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.createDocument(
      userId,
      {
        type: dto.type,
        name: dto.name,
        issuedAt: dto.issuedAt || null,
        expiresAt: dto.expiresAt || null,
        noExpiry: dto.noExpiry === 'true',
      },
      validarArchivoDocumento(file),
    );
  }

  @Patch('documents/:id')
  async updateDocument(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateHrDocumentDto,
  ): Promise<HrDocument> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.updateDocument(id, dto);
  }

  /** Sustituye el archivo conservando la versión anterior. */
  @Post('documents/:id/version')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async replaceDocumentFile(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<HrDocument> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.replaceDocumentFile(id, validarArchivoDocumento(file));
  }

  @Delete('documents/:id')
  async removeDocument(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeDocument(id);
  }

  @Get('documents/:id/file-url')
  async documentFileUrl(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Query('previous') previous?: string,
  ): Promise<{ url: string }> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.documentFileUrl(id, previous === 'true');
  }

  // ── Exámenes ──────────────────────────────────────────────────────────────

  @Get('workers/:userId/exams')
  async listExams(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrExam[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listExams(userId);
  }

  @Post('exams')
  async createExam(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpsertExamDto,
  ): Promise<HrExam> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertExam(dto);
  }

  @Put('exams/:id')
  async updateExam(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertExamDto,
  ): Promise<HrExam> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertExam(dto, id);
  }

  @Delete('exams/:id')
  async removeExam(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeExam(id);
  }

  // ── Inducciones ───────────────────────────────────────────────────────────

  @Get('workers/:userId/inductions')
  async listInductions(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrInduction[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listInductions(userId);
  }

  @Post('inductions')
  async createInduction(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpsertInductionDto,
  ): Promise<HrInduction> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertInduction(dto);
  }

  @Put('inductions/:id')
  async updateInduction(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertInductionDto,
  ): Promise<HrInduction> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertInduction(dto, id);
  }

  @Delete('inductions/:id')
  async removeInduction(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeInduction(id);
  }

  // ── Acreditaciones ────────────────────────────────────────────────────────

  @Get('workers/:userId/accreditations')
  async listAccreditations(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrAccreditation[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listAccreditations(userId);
  }

  @Post('accreditations')
  async createAccreditation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpsertAccreditationDto,
  ): Promise<HrAccreditation> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertAccreditation(dto);
  }

  @Put('accreditations/:id')
  async updateAccreditation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertAccreditationDto,
  ): Promise<HrAccreditation> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertAccreditation(dto, id);
  }

  @Delete('accreditations/:id')
  async removeAccreditation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeAccreditation(id);
  }

  /**
   * Gate de la sección. `directory:view:extended` se acepta para LEER porque es
   * el permiso que encendía la sección cuando se llamaba Directorio: quien ya
   * la tenía no debe perderla por el cambio de nombre.
   */
  private async assertPuede(
    authUser: AuthUser | undefined,
    clave: 'hr:read' | 'hr:manage',
  ): Promise<void> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const claves: string[] =
      clave === 'hr:read' ? ['hr:read', 'hr:manage', 'directory:view:extended'] : ['hr:manage'];
    const decisiones = await Promise.all(claves.map((k) => this.permissions.can(authUser.id, k)));
    if (!decisiones.some((d) => d.effect === 'allow')) {
      throw new ForbiddenException(
        clave === 'hr:manage'
          ? 'No tienes permisos para modificar antecedentes en RRHH.'
          : 'No tienes permisos para ver RRHH.',
      );
    }
  }
}

/** Query del motor de tablas a `TableRequest`, igual que el resto de la API. */
function tabla(
  page: string | undefined,
  pageSize: string | undefined,
  search: string | undefined,
  sortBy: string | undefined,
  sortDir: string | undefined,
  filters: Record<string, string> | undefined,
): TableRequest {
  return {
    page: page !== undefined ? Number(page) : 1,
    pageSize: pageSize !== undefined ? Number(pageSize) : 20,
    search,
    sortBy,
    sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
    filters: filters && typeof filters === 'object' ? filters : undefined,
  };
}
