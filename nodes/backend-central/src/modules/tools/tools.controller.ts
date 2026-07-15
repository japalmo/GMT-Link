import { Body, Controller, Post, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { BulkConvertDto, ConvertPointDto, ShoreDetectDto } from './dto/tools.dto';
import { ToolsService } from './tools.service';

@Controller('tools')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ToolsController {
  constructor(private readonly service: ToolsService) {}

  @Post('coords/convert')
  convertSingle(@Body() dto: ConvertPointDto) {
    return this.service.convertPoint(dto);
  }

  @Post('coords/convert/bulk')
  convertBulk(@Body() dto: BulkConvertDto) {
    return dto.points.map((pt) => this.service.convertPoint(pt));
  }

  @Post('gis/shore-detect')
  detectShoreline(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: ShoreDetectDto,
  ): Promise<{ polygon: Array<{ x: number; y: number }> }> {
    const userId = this.requireUserId(user);
    return this.service.detectShoreline(userId, dto.fileBase64);
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
