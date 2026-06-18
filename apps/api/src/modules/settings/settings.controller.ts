import {
  Body,
  Controller,
  Get,
  Patch,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';
import type { UserPreferencesView } from './settings.types';

/**
 * Configuración del usuario (§6-2.3). Rutas AUTENTICADAS que operan SOLO sobre
 * las preferencias del propio usuario: el `userId` se deriva de la sesión, nunca
 * del body. El `ValidationPipe` (whitelist + forbidNonWhitelisted) rechaza
 * campos extra y `theme` fuera de la lista válida.
 */
@Controller('settings')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** Preferencias propias (crea defaults lazy si no existen). */
  @Get('me')
  getMine(@CurrentUser() authUser: AuthUser | undefined): Promise<UserPreferencesView> {
    return this.settingsService.getMine(this.requireUserId(authUser));
  }

  /** Aplica un patch parcial de preferencias propias (upsert). Retorna el resultado. */
  @Patch('me')
  updateMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpdateSettingsDto,
  ): Promise<UserPreferencesView> {
    return this.settingsService.updateMine(this.requireUserId(authUser), dto);
  }

  /** Devuelve los tokens visuales para el cliente de escritorio (PyQt). */
  @Get('theme')
  getTheme() {
    return {
      name: "GMT Link",
      bg_base: "#F1F5F9",
      bg_secondary: "#E2E8F0",
      bg_surface: "#FFFFFF",
      bg_input: "#FFFFFF",
      bg_header_a: "#1C3A6B",
      bg_header_b: "#E05A00",
      bg_status: "#F1F5F9",
      text_base: "#0F172A",
      text_muted: "#475569",
      text_disabled: "#94A3B8",
      text_on_primary: "#FFFFFF",
      text_placeholder: "#94A3B8",
      text_header: "#FFFFFF",
      border_main: "#CBD5E1",
      border_light: "#E2E8F0",
      border_focus: "#E05A00",
      primary: "#1C3A6B",
      primary_dark: "#142A4F",
      primary_light: "#2563EB",
      secondary: "#64748B",
      accent_pos: "#E05A00",
      accent_pos_d: "#C04500",
      accent_warn: "#D97706",
      accent_warn_d: "#B45309",
      success_bg: "#E05A00",
      success_hover: "#C04500",
      success_press: "#A03A00",
      success_text: "#FFFFFF",
      btn_bg: "#F8FAFC",
      btn_text: "#1C3A6B",
      btn_border: "#CBD5E1",
      btn_pri_bg: "#1C3A6B",
      btn_pri_bg2: "#E05A00",
      btn_pri_text: "#FFFFFF",
      sidebar_bg: "#1C3A6B",
      sidebar_active: "#E05A00",
      sidebar_hover: "#244B7E",
      sidebar_text: "#DDE7F5",
      sidebar_pill: "#244B7E",
      sidebar_active_text: "#FFFFFF",
      card_bg: "#FFFFFF",
      stat_label: "#64748B",
      stat_value: "#0F172A",
      card_shadow: "rgba(0,0,0,50)",
      radius_sm: "8px",
      radius_md: "12px",
      radius_lg: "16px",
      tbl_hdr_bg: "#1C3A6B",
      tbl_hdr_bg2: "#E05A00",
      tbl_hdr_text: "#F8FAFC",
      tbl_sel_bg: "#E05A00",
      tbl_sel_text: "#FFFFFF",
      grp_top_brd: "#E05A00",
      grp_title: "#1C3A6B"
    };
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
