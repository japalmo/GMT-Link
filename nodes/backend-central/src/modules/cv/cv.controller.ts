import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { CvService } from './cv.service';
import {
  CreateCertificationDto,
  CreateEducationDto,
  CreateExperienceDto,
  UpdateCertificationDto,
  UpdateCvDto,
  UpdateEducationDto,
  UpdateExperienceDto,
} from './dto/cv.dto';
import type {
  CvCertificationView,
  CvEducationView,
  CvExperienceView,
  CvView,
} from './cv.types';

/** Límite de tamaño del diploma PDF (10 MB) — alineado con el storage. */
const MAX_DIPLOMA_BYTES = 10 * 1024 * 1024;

/**
 * CV propio (§6-1.4 "Mi CV"). Todos los endpoints AUTENTICADOS, SIN
 * `@RequirePermission`: cada usuario opera sobre SU propio CV (no hay recurso de
 * otro que autorizar vía FGA). El `userId` sale SIEMPRE de la sesión; los ids de
 * ruta solo identifican filas hijas, y el service verifica que pertenezcan al CV
 * del usuario (404 si no).
 */
@Controller('cv')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class CvController {
  constructor(private readonly cvService: CvService) {}

  /** CV propio (crea uno vacío lazy si no existe). 401 si no hay sesión. */
  @Get('me')
  me(@CurrentUser() authUser: AuthUser | undefined): Promise<CvView> {
    return this.cvService.getMe(this.requireUserId(authUser));
  }

  /** Actualiza el resumen del CV propio. */
  @Patch('me')
  updateMe(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpdateCvDto,
  ): Promise<CvView> {
    return this.cvService.updateMe(this.requireUserId(authUser), dto);
  }

  // ============ Experiencia ============

  @Post('me/experiences')
  addExperience(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateExperienceDto,
  ): Promise<CvExperienceView> {
    return this.cvService.addExperience(this.requireUserId(authUser), dto);
  }

  @Patch('me/experiences/:id')
  updateExperience(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateExperienceDto,
  ): Promise<CvExperienceView> {
    return this.cvService.updateExperience(this.requireUserId(authUser), id, dto);
  }

  @Delete('me/experiences/:id')
  @HttpCode(204)
  deleteExperience(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    return this.cvService.deleteExperience(this.requireUserId(authUser), id);
  }

  // ============ Educación ============

  @Post('me/education')
  addEducation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateEducationDto,
  ): Promise<CvEducationView> {
    return this.cvService.addEducation(this.requireUserId(authUser), dto);
  }

  @Patch('me/education/:id')
  updateEducation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateEducationDto,
  ): Promise<CvEducationView> {
    return this.cvService.updateEducation(this.requireUserId(authUser), id, dto);
  }

  @Delete('me/education/:id')
  @HttpCode(204)
  deleteEducation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    return this.cvService.deleteEducation(this.requireUserId(authUser), id);
  }

  // ============ Certificación ============

  @Post('me/certifications')
  addCertification(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateCertificationDto,
  ): Promise<CvCertificationView> {
    return this.cvService.addCertification(this.requireUserId(authUser), dto);
  }

  @Patch('me/certifications/:id')
  updateCertification(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateCertificationDto,
  ): Promise<CvCertificationView> {
    return this.cvService.updateCertification(this.requireUserId(authUser), id, dto);
  }

  @Delete('me/certifications/:id')
  @HttpCode(204)
  deleteCertification(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    return this.cvService.deleteCertification(this.requireUserId(authUser), id);
  }

  /**
   * Sube/reemplaza el diploma PDF de una certificación propia.
   * multipart/form-data, campo `file`, SOLO `application/pdf`, máx 10 MB.
   */
  @Post('me/certifications/:id/diploma')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DIPLOMA_BYTES } }))
  uploadDiploma(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<CvCertificationView> {
    const userId = this.requireUserId(authUser);
    if (!file) {
      throw new BadRequestException('Falta el archivo del diploma (campo "file").');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new UnsupportedMediaTypeException('El diploma debe ser un PDF.');
    }
    return this.cvService.setCertificationDiploma(userId, id, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
