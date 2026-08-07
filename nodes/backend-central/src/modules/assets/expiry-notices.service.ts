import { Injectable, Logger } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { EmailService, escapeHtml } from '../../common/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  cuerpoAviso,
  diasHasta,
  hitoVigente,
  tituloAviso,
  type HitoAviso,
} from './expiry-notices.util';

/** Resultado de una corrida, para el log y para las pruebas. */
export interface ResumenBarrido {
  documentosRevisados: number;
  avisosEnviados: number;
  destinatarios: number;
  errores: number;
}

/**
 * Barrido de documentos de vehículos próximos a vencer.
 *
 * Recorre los documentos APROBADOS con fecha de vencimiento, calcula el hito de
 * aviso vigente hoy (ver `expiry-notices.util.ts`) y avisa a quienes administran
 * la flota, por la aplicación y por correo.
 *
 * Tres decisiones que sostienen la utilidad de la alerta:
 *
 *  · IDEMPOTENCIA. Cada aviso enviado queda registrado por (documento, persona,
 *    hito). Sin eso, un barrido que corre cada hora mandaría el mismo aviso 24
 *    veces al día y la gente aprendería a ignorarlo, que es peor que no avisar.
 *  · UN FALLO NO DETIENE EL BARRIDO. Si el correo de una persona rebota, se
 *    registra el error y se sigue con el resto: perder todos los avisos porque
 *    uno falló sería el peor resultado posible.
 *  · SOLO DOCUMENTOS APROBADOS. Uno en revisión todavía no es el vigente, y
 *    avisar de su vencimiento confundiría sobre cuál es el documento válido.
 */
@Injectable()
export class ExpiryNoticesService {
  private readonly logger = new Logger(ExpiryNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  /**
   * Personas que deben recibir los avisos: quienes administran toda la flota.
   *
   * Se resuelve por PERMISO y no por nombre de rol (ADR-0001): si mañana se crea
   * otro rol con `asset:manage:fleet`, sus miembros reciben los avisos sin tocar
   * este código. Incluye a los administradores de la organización, que tienen
   * ese permiso por su bundle completo.
   */
  async destinatarios(): Promise<string[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { permission: { key: 'asset:manage:fleet' } },
      include: { role: true },
    });
    const roleKeys = [...new Set(grants.map((g) => g.role.key))];
    if (roleKeys.length === 0) return [];

    const memberships = await this.prisma.membership.findMany({
      where: { roleKey: { in: roleKeys } },
      select: { userId: true },
    });
    return [...new Set(memberships.map((m) => m.userId))];
  }

  /**
   * Corre el barrido. `hoy` es inyectable para poder probar el calendario sin
   * depender de la fecha del sistema.
   */
  async barrer(hoy: Date = new Date()): Promise<ResumenBarrido> {
    const resumen: ResumenBarrido = {
      documentosRevisados: 0,
      avisosEnviados: 0,
      destinatarios: 0,
      errores: 0,
    };

    const personas = await this.destinatarios();
    resumen.destinatarios = personas.length;
    if (personas.length === 0) {
      // Sin nadie a quien avisar no se hace el trabajo, pero se deja rastro: es
      // un síntoma de que el rol no está asignado, no de que todo esté al día.
      this.logger.warn(
        'Barrido de vencimientos sin destinatarios: nadie tiene asset:manage:fleet.',
      );
      return resumen;
    }

    const documentos = await this.prisma.assetDocument.findMany({
      where: {
        status: DocumentStatus.APROBADO,
        expirationDate: { not: null },
        asset: { type: 'VEHICULO' },
      },
      include: { asset: { select: { code: true, name: true, identifier: true } } },
    });
    resumen.documentosRevisados = documentos.length;

    for (const doc of documentos) {
      if (!doc.expirationDate) continue;
      const hito = hitoVigente(diasHasta(doc.expirationDate, hoy));
      if (!hito) continue;

      for (const userId of personas) {
        try {
          const enviado = await this.avisarSiCorresponde(doc, hito, userId);
          if (enviado) resumen.avisosEnviados += 1;
        } catch (error) {
          // Se registra y se sigue: un destinatario problemático no puede dejar
          // sin aviso a los demás ni frenar el resto de los documentos.
          resumen.errores += 1;
          this.logger.error(
            `Fallo avisando ${doc.id} a ${userId}: ${(error as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `Barrido de vencimientos: ${resumen.documentosRevisados} documentos, ` +
        `${resumen.avisosEnviados} avisos, ${resumen.errores} errores.`,
    );
    return resumen;
  }

  /**
   * Envía el aviso a una persona si ese hito todavía no se le envió.
   * Devuelve `true` si envió algo.
   */
  private async avisarSiCorresponde(
    doc: {
      id: string;
      name: string;
      asset: { code: string; name: string; identifier: string | null };
    },
    hito: HitoAviso,
    userId: string,
  ): Promise<boolean> {
    const yaEnviado = await this.prisma.assetDocumentExpiryNotice.findUnique({
      where: {
        documentId_userId_clave: { documentId: doc.id, userId, clave: hito.clave },
      },
      select: { id: true },
    });
    if (yaEnviado) return false;

    const patente = doc.asset.identifier ?? doc.asset.code;
    const titulo = tituloAviso(doc.name, hito);
    const cuerpo = cuerpoAviso(patente, doc.asset.name, hito);

    // La notificación en la aplicación respeta la preferencia del destinatario
    // (devuelve null si la tiene apagada); eso NO cancela el correo.
    const enApp = await this.notifications.create(userId, {
      type: 'ASSET_DOC_EXPIRY',
      title: titulo,
      body: cuerpo,
      link: `/recursos?asset=${doc.id}`,
    });

    const porCorreo = await this.enviarCorreo(userId, titulo, cuerpo);

    // Se registra AUNQUE los dos canales estén apagados: el hito se considera
    // atendido para esta persona. Si no, cada corrida volvería a intentarlo y el
    // registro crecería sin control.
    await this.prisma.assetDocumentExpiryNotice.create({
      data: {
        documentId: doc.id,
        userId,
        clave: hito.clave,
        enviadoApp: enApp !== null,
        enviadoCorreo: porCorreo,
      },
    });
    return enApp !== null || porCorreo;
  }

  /** Manda el correo si la persona lo tiene habilitado. Devuelve si se envió. */
  private async enviarCorreo(
    userId: string,
    titulo: string,
    cuerpo: string,
  ): Promise<boolean> {
    const usuario = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, preferences: { select: { notifyEmail: true } } },
    });
    // La preferencia de correo viene APAGADA por defecto en el sistema: quien no
    // la encendió no recibe correo, solo la notificación en la aplicación.
    if (!usuario?.email || usuario.preferences?.notifyEmail !== true) {
      return false;
    }

    await this.email.send({
      to: usuario.email,
      subject: titulo,
      body: `${titulo}\n\n${cuerpo}`,
      html:
        `<p><strong>${escapeHtml(titulo)}</strong></p>` +
        `<p>${escapeHtml(cuerpo)}</p>`,
    });
    return true;
  }

  /**
   * Borra los avisos de un documento. Se llama al renovarlo: con la fecha nueva
   * el ciclo empieza limpio, y si no se borraran, el hito "vencido-0" ya enviado
   * impediría avisar del vencimiento siguiente.
   */
  async limpiarAvisosDe(documentId: string): Promise<void> {
    await this.prisma.assetDocumentExpiryNotice.deleteMany({ where: { documentId } });
  }
}
