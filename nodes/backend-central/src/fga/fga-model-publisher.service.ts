import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { OpenFgaClient } from '@openfga/sdk';

/**
 * Publica el modelo de autorización en OpenFGA al arrancar la API.
 *
 * ── Por qué desde acá ──────────────────────────────────────────────────────
 *
 * El modelo se escribe con `scripts/fga-bootstrap.ts`, pero ese script necesita
 * alcanzar OpenFGA, y en Railway el servicio NO tiene dominio público: solo se
 * llega desde dentro de la red privada. La API es el único proceso que está ahí,
 * así que la publicación tiene que salir de ella.
 *
 * El transformador de DSL es dependencia de desarrollo y no viaja en la imagen,
 * por eso se lee `fga/model.json` (versionado, generado con
 * `scripts/build-fga-model-json.ts`) y solo se usa el SDK.
 *
 * ── Por qué detrás de una bandera ──────────────────────────────────────────
 *
 * Publicar crea una VERSIÓN nueva del modelo cada vez. Si corriera en cada
 * arranque, un reinicio cualquiera dejaría versiones sueltas y el `FGA_MODEL_ID`
 * fijado en el entorno apuntando a una vieja. Se enciende a mano cuando el
 * modelo cambia, se lee el id nuevo del log, se fija en `FGA_MODEL_ID` y se
 * vuelve a apagar.
 *
 * Un fallo acá NO tumba la API: se registra y el arranque sigue. El modelo
 * anterior queda vigente, que es peor que el nuevo pero mucho mejor que una
 * plataforma caída.
 */
@Injectable()
export class FgaModelPublisher implements OnApplicationBootstrap {
  private readonly logger = new Logger(FgaModelPublisher.name);

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.FGA_PUBLISH_MODEL !== 'true') return;

    const apiUrl = process.env.FGA_API_URL;
    const storeId = process.env.FGA_STORE_ID;
    if (!apiUrl || !storeId) {
      this.logger.error('No se puede publicar el modelo: falta FGA_API_URL o FGA_STORE_ID.');
      return;
    }

    try {
      // `dist/` queda un nivel bajo la raíz del paquete, así que se prueban las
      // dos ubicaciones en vez de asumir desde dónde arrancó el proceso.
      const candidatos = [
        path.resolve(process.cwd(), 'fga/model.json'),
        path.resolve(__dirname, '../../fga/model.json'),
        path.resolve(__dirname, '../../../fga/model.json'),
      ];
      const ruta = candidatos.find((p) => {
        try {
          readFileSync(p);
          return true;
        } catch {
          return false;
        }
      });
      if (!ruta) {
        this.logger.error(`No se encontró fga/model.json. Se probó: ${candidatos.join(', ')}`);
        return;
      }

      const modelo = JSON.parse(readFileSync(ruta, 'utf8')) as {
        schema_version: string;
        type_definitions: unknown[];
        conditions?: unknown;
      };

      const client = new OpenFgaClient({ apiUrl, storeId });
      const res = await client.writeAuthorizationModel(modelo as never);
      const id = res.authorization_model_id;

      // El id va en el log a propósito y bien visible: es lo que hay que copiar
      // a `FGA_MODEL_ID` para que la API deje de usar el modelo anterior.
      this.logger.warn(
        `MODELO FGA PUBLICADO. Nuevo FGA_MODEL_ID = ${id}. ` +
          `Fíjalo en el entorno y apaga FGA_PUBLISH_MODEL.`,
      );
      const tipos = modelo.type_definitions.length;
      this.logger.log(`El modelo publicado trae ${tipos} tipos (leído de ${ruta}).`);
    } catch (error) {
      // Nunca tumbar el arranque por esto: sin modelo nuevo la plataforma sigue
      // funcionando con el anterior; sin API no funciona nada.
      this.logger.error(`No se pudo publicar el modelo FGA: ${(error as Error).message}`);
    }
  }
}
