import { Controller, Get, Param, Query, UnauthorizedException } from '@nestjs/common';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { ORG_ID } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { DirectoryService } from './directory.service';
import type { DirectoryEntry, DirectoryEntryExtended } from './directory.types';

/**
 * Directorio de personas (§6-1.6, scopeado por rol).
 *
 * Lista y detalle BÁSICO: AUTENTICADOS sin `@RequirePermission` — visibles para
 * cualquier sesión. El aislamiento cliente/colaborador (§3.4) es lógica de
 * negocio del service (filtra por el `isClientUser` del solicitante), NO un
 * permiso FGA.
 *
 * Detalle EXTENDIDO: protegido por `@RequirePermission('can_view_directory_extended',
 * organization:gmt)` (catálogo §8 directory:view:extended; relación derivada de
 * admin, §4.3). Se separa en su propia ruta para que el guard corte con 403
 * cuando falta el permiso, dejando el detalle básico siempre accesible.
 */
@Controller('directory')
export class DirectoryController {
  constructor(private readonly directoryService: DirectoryService) {}

  /** Lista del directorio (básicos). `?search=` server-side. 401 si no hay sesión. */
  @Get()
  list(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('search') search?: string,
  ): Promise<DirectoryEntry[]> {
    return this.directoryService.list(this.requireUserId(authUser), search);
  }

  /**
   * Lista con el MOTOR de tablas server-side (offset): búsqueda, filtro `tipo`
   * (colaborador/cliente) y orden sobre TODO el directorio visible, con página +
   * total. Lo consume la tabla de Colaboradores. Respeta el mismo aislamiento
   * cliente que el resto. DEBE declararse antes de `@Get(':id')`.
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
  ): Promise<TablePage<DirectoryEntry>> {
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    return this.directoryService.listTable(this.requireUserId(authUser), req);
  }

  /**
   * Detalle EXTENDIDO. Requiere `can_view_directory_extended` sobre
   * `organization:gmt`. Definido antes que `/:id` para evitar que el comodín de
   * ruta lo capture. 403 si no tiene el permiso; 404 si no es visible.
   */
  @Get(':id/extended')
  @RequirePermission('can_view_directory_extended', { type: 'organization', id: ORG_ID })
  getExtended(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<DirectoryEntryExtended> {
    return this.directoryService.getExtended(this.requireUserId(authUser), id);
  }

  /** Detalle BÁSICO de una persona. 401 si no hay sesión; 404 si no es visible. */
  @Get(':id')
  getBasic(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<DirectoryEntry> {
    return this.directoryService.getBasic(this.requireUserId(authUser), id);
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
