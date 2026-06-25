import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ORG_ID, ORG_OBJECT_TYPE } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { LiquidationsService } from './liquidations.service';
import { CreateLiquidationDto } from './dto/liquidations.dto';

const FINANCE_RELATION = 'can_manage_finance';
const MAX_LIQUIDATION_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller('liquidations')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class LiquidationsController {
  constructor(private readonly liquidations: LiquidationsService) {}

  /** Sube una nueva liquidación de sueldo PDF para un empleado (sólo gestor). */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LIQUIDATION_BYTES } }))
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateLiquidationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const uploadedById = this.requireUserId(authUser);
    if (!file) {
      throw new BadRequestException('Falta el archivo PDF de la liquidación.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('El archivo de la liquidación debe ser obligatoriamente un PDF.');
    }
    return this.liquidations.create(uploadedById, dto, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }

  /** Lista las liquidaciones propias del colaborador autenticado. */
  @Get('me')
  listMine(@CurrentUser() authUser: AuthUser | undefined) {
    const userId = this.requireUserId(authUser);
    return this.liquidations.listMine(userId);
  }

  /** Lista todas las liquidaciones en el sistema (sólo gestor). */
  @Get()
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  listAll() {
    return this.liquidations.listAll();
  }

  /** Elimina una liquidación por su ID (sólo gestor). */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  remove(@Param('id') id: string) {
    return this.liquidations.remove(id);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
