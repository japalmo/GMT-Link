import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { FgaService } from './fga.service';
import { MEMBERSHIP_RELATION_MAP } from './fga.types';
import { ORG_ID } from '../common/org.constant';

/**
 * Escribe las tuplas de los roles de alcance ORGANIZACIÓN que faltan.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * Durante un tiempo, asignar un rol de organización solo escribía tupla si era
 * `org_admin`: los cuatro puntos que lo hacían comparaban a mano contra esa
 * clave en vez de consultar `MEMBERSHIP_RELATION_MAP`. Ya está corregido, pero
 * las asignaciones HECHAS ANTES quedaron sin su tupla, y nadie las va a escribir
 * solo: el usuario tiene el rol en la base y FGA le niega todo.
 *
 * Corre desde acá y no desde un script porque el servicio de OpenFGA en Railway
 * no tiene dominio público: la API es el único proceso que lo alcanza.
 *
 * ── Idempotente ────────────────────────────────────────────────────────────
 *
 * `writeTuples` tolera el "already exists" de OpenFGA, así que volver a correrlo
 * no rompe nada. Aun así va detrás de `FGA_RESYNC_ORG_ROLES=true` para que sea
 * una decisión y no un efecto de cada reinicio: recorre todas las membresías y
 * no vale la pena pagarlo en cada arranque.
 *
 * Un fallo NO tumba la API: se registra y el arranque sigue.
 */
@Injectable()
export class FgaOrgRolesResync implements OnApplicationBootstrap {
  private readonly logger = new Logger(FgaOrgRolesResync.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.FGA_RESYNC_ORG_ROLES !== 'true') return;

    try {
      const membresias = await this.prisma.membership.findMany({
        where: { scopeType: 'ORGANIZATION' },
        select: { userId: true, roleKey: true, user: { select: { username: true } } },
      });

      let escritas = 0;
      let yaEstaban = 0;
      let sinRelacion = 0;
      for (const m of membresias) {
        const relacion = MEMBERSHIP_RELATION_MAP.ORGANIZATION[m.roleKey];
        if (!relacion) {
          // Los roles funcionales a nivel org no generan tupla, y está bien.
          sinRelacion += 1;
          continue;
        }
        try {
          await this.fga.writeTuples([
            { user: `user:${m.userId}`, relation: relacion, object: `organization:${ORG_ID}` },
          ]);
          escritas += 1;
          this.logger.log(`Tupla asegurada: ${m.user.username} -> ${relacion}`);
        } catch (error) {
          // Que la tupla ya exista es ÉXITO, no fallo: el objetivo es que esté,
          // no haberla escrito esta vez. Registrarlo como error hacía leer un
          // resync correcto como si todo hubiera fallado.
          const msg = (error as Error).message;
          if (/already exist/i.test(msg)) {
            yaEstaban += 1;
          } else {
            this.logger.error(`No se pudo escribir ${relacion} de ${m.user.username}: ${msg}`);
          }
        }
      }

      this.logger.warn(
        `Resincronización de roles de organización: ${escritas} tuplas escritas, ` +
          `${yaEstaban} ya existían, ${sinRelacion} membresías sin relación FGA ` +
          `(correcto: los roles funcionales a nivel org no generan tupla). ` +
          `Apaga FGA_RESYNC_ORG_ROLES.`,
      );
    } catch (error) {
      this.logger.error(`Resincronización de roles falló: ${(error as Error).message}`);
    }
  }
}
