import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { TicketsService } from './tickets.service';
import {
  CommentTicketDto,
  CreateTicketDto,
  TransitionTicketDto,
  TriageTicketDto,
} from './dto/tickets.dto';

/**
 * Soporte TI (PR-TI-01). No expone borrado a propósito: un ticket es el registro
 * formal de una solicitud y su bitácora es la trazabilidad que el procedimiento
 * exige, así que no se elimina ni se edita hacia atrás.
 */
@Controller('tickets')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** Levanta un ticket y lo deja ENVIADO, con correlativo y SLA ya calculados. */
  @Post()
  create(@CurrentUser() authUser: AuthUser | undefined, @Body() dto: CreateTicketDto) {
    return this.tickets.create(this.requireUserId(authUser), dto);
  }

  /** Bandeja del solicitante. */
  @Get('mine')
  listMine(@CurrentUser() authUser: AuthUser | undefined) {
    return this.tickets.listMine(this.requireUserId(authUser));
  }

  /**
   * Panel de Informática (motor de tablas). Va ANTES de `@Get(':id')` para que
   * "table" no se interprete como un id.
   */
  @Get('table')
  listTable(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<unknown>> {
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters,
    };
    return this.tickets.listTable(this.requireUserId(authUser), req);
  }

  /** Contadores del panel: sin triage, SLA vencido y en curso. */
  @Get('stats')
  stats(@CurrentUser() authUser: AuthUser | undefined) {
    return this.tickets.queueStats(this.requireUserId(authUser));
  }

  /** Detalle con bitácora y las transiciones que este usuario puede ejecutar. */
  @Get(':id')
  getById(@CurrentUser() authUser: AuthUser | undefined, @Param('id') id: string) {
    return this.tickets.getById(this.requireUserId(authUser), id);
  }

  /** Clasificación del triage (vía, tamaño, prioridad, responsable). */
  @Patch(':id/triage')
  triage(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: TriageTicketDto,
  ) {
    return this.tickets.triage(this.requireUserId(authUser), id, dto);
  }

  /** Transición de estado, validada contra la máquina de estados. */
  @Patch(':id/status')
  transition(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: TransitionTicketDto,
  ) {
    return this.tickets.transition(this.requireUserId(authUser), id, dto);
  }

  /** Comentario en la bitácora, sin cambiar de estado. */
  @Post(':id/comments')
  comment(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CommentTicketDto,
  ) {
    return this.tickets.comment(this.requireUserId(authUser), id, dto);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
