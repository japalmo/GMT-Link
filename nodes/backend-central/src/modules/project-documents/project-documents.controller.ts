import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
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
import { ProjectDocumentsService } from './project-documents.service';
import { CreateProjectDocumentDto, RejectDocumentDto } from './dto/project-documents.dto';

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('project-documents')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ProjectDocumentsController {
  constructor(private readonly service: ProjectDocumentsService) {}

  /**
   * Sube un nuevo documento de proyecto.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES } }))
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateProjectDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const userId = this.requireUserId(authUser);
    if (!file) {
      throw new BadRequestException('Falta el archivo PDF del documento.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('El documento debe ser obligatoriamente un archivo PDF.');
    }
    return this.service.create(userId, dto, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }

  /**
   * Sube una nueva revisión de un documento existente.
   */
  @Post(':id/revision')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES } }))
  uploadRevision(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const userId = this.requireUserId(authUser);
    if (!file) {
      throw new BadRequestException('Falta el archivo PDF de la nueva revisión.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('La revisión debe ser obligatoriamente un archivo PDF.');
    }
    return this.service.uploadRevision(id, userId, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }

  /**
   * Firma digital simple (FES) de control de calidad QA.
   */
  @Post(':id/sign-qa')
  @HttpCode(200)
  signQA(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.service.signQA(id, userId);
  }

  /**
   * Firma digital simple (FES) de aprobación de Cliente/ITO.
   */
  @Post(':id/sign-client')
  @HttpCode(200)
  signClient(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.service.signClient(id, userId);
  }

  /**
   * Rechaza el documento de proyecto (por QA o Cliente).
   */
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectDocumentDto,
  ) {
    const userId = this.requireUserId(authUser);
    return this.service.reject(id, userId, dto.reason);
  }

  /**
   * Lista documentos visibles de proyectos con filtros opcionales.
   */
  @Get()
  list(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('projectId') projectId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('taskId') taskId?: string,
  ) {
    const userId = this.requireUserId(authUser);
    // Estrecha el valor (Express 5 puede entregar objeto/array en `?taskId[x]=`).
    return this.service.list(
      userId,
      projectId,
      serviceId,
      typeof taskId === 'string' ? taskId : undefined,
    );
  }

  /**
   * URL fresca de descarga/visualización del archivo del documento (Fase 1B).
   * Si `fileUrl` es una clave de storage se presigna al leer; si es una URL
   * absoluta legada, se devuelve tal cual. Mismo gate de visibilidad de `list`.
   */
  @Get(':id/file-url')
  getFileUrl(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.service.getFileUrl(id, userId);
  }

  /**
   * Elimina un documento de proyecto.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.service.remove(id, userId);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
