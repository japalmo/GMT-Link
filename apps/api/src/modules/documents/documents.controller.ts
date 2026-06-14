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
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ORG_ID } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { DocumentsService } from './documents.service';
import {
  CreatePersonalDocumentDto,
  ListDocumentsQueryDto,
  RejectDocumentDto,
} from './dto/documents.dto';
import type { PersonalDocumentView } from './documents.types';

/** Tamaño máximo del documento (10 MB) — alineado con el storage. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** MIME types aceptados: PDF e imágenes comunes (§6-1.5). */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
]);

/**
 * Documentos personales (§6-1.5 "Mis documentos").
 *
 * Rutas `/documents/me*`: AUTENTICADAS, "solo el dueño" (lógica de service que
 * deriva el `userId` de la sesión). Rutas de REVISIÓN `/documents/:id/approve|reject`:
 * protegidas por `@RequirePermission('can_review_documents', organization:gmt)` →
 * el guard corta con 403 si el usuario no es revisor (admin). Así el dueño normal
 * NO puede aprobar sus propios documentos.
 *
 * Las rutas `me/*` se declaran ANTES que `:id/*` para que el literal `me` no sea
 * capturado por el parámetro de ruta.
 */
@Controller('documents')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /** Lista los documentos propios. Filtros opcionales `?status=&expiring=`. */
  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<PersonalDocumentView[]> {
    return this.documentsService.listMine(this.requireUserId(authUser), {
      status: query.status,
      expiring: query.expiring === undefined ? undefined : query.expiring === 'true',
    });
  }

  /**
   * Sube un documento propio (multipart, campo `file` PDF/imagen + metadatos).
   * Queda en `EN_REVISION` (pendiente).
   */
  @Post('me')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreatePersonalDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<PersonalDocumentView> {
    const userId = this.requireUserId(authUser);
    const checked = this.requireValidFile(file);
    return this.documentsService.create(userId, dto, checked);
  }

  /**
   * Sube una nueva versión del documento (solo el dueño): conserva el archivo
   * anterior y vuelve a `EN_REVISION`. multipart, campo `file`.
   */
  @Post('me/:id/version')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  addVersion(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<PersonalDocumentView> {
    const userId = this.requireUserId(authUser);
    const checked = this.requireValidFile(file);
    return this.documentsService.addVersion(userId, id, checked);
  }

  /** Borra un documento propio (solo el dueño). */
  @Delete('me/:id')
  @HttpCode(204)
  remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    return this.documentsService.remove(this.requireUserId(authUser), id);
  }

  /**
   * Aprueba un documento. Requiere `can_review_documents` sobre `organization:gmt`
   * (revisor/admin). 403 si no lo tiene; 404 si el documento no existe.
   */
  @Post(':id/approve')
  @RequirePermission('can_review_documents', { type: 'organization', id: ORG_ID })
  approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<PersonalDocumentView> {
    return this.documentsService.approve(this.requireUserId(authUser), id);
  }

  /**
   * Rechaza un documento. Requiere `can_review_documents` sobre `organization:gmt`.
   * El `reason` del body es opcional y NO se persiste (MVP): se registra en log.
   */
  @Post(':id/reject')
  @RequirePermission('can_review_documents', { type: 'organization', id: ORG_ID })
  reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectDocumentDto,
  ): Promise<PersonalDocumentView> {
    return this.documentsService.reject(this.requireUserId(authUser), id, dto.reason);
  }

  /** Valida presencia y MIME del archivo subido; retorna su forma mínima. */
  private requireValidFile(file: Express.Multer.File | undefined): {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  } {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException('El archivo debe ser PDF o imagen (PNG/JPEG/WebP/HEIC).');
    }
    return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
