import { createSign } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

/**
 * Lectura de Google Sheets con una cuenta de servicio.
 *
 * SIN dependencias nuevas: firma el JWT con `node:crypto`, lo cambia por un
 * token en el endpoint OAuth y llama a la API REST con `fetch`. Traer el paquete
 * `googleapis` para esto significaría arrastrar el cliente de las ~200 APIs de
 * Google (decenas de MB) por dos llamadas HTTP.
 *
 * SOLO LECTURA, y el alcance que se pide lo deja explícito: GMT Link es el
 * sistema principal y la planilla es la fuente legada. Nunca se escribe de
 * vuelta (decisión del dueño).
 */
@Injectable()
export class SheetsClientService {
  private readonly logger = new Logger(SheetsClientService.name);
  /** Token cacheado: dura una hora y pedir uno por lectura sería gratuito pero lento. */
  private cache: { token: string; expira: number } | null = null;

  /** ¿Hay credencial configurada? Sin ella el importador no corre y no falla. */
  estaConfigurado(): boolean {
    return Boolean(process.env.GOOGLE_SHEETS_CREDENTIALS && this.idPlanilla());
  }

  idPlanilla(): string {
    return process.env.GOOGLE_SHEETS_CHECKLIST_ID ?? '';
  }

  private credencial(): { client_email: string; private_key: string } {
    const crudo = process.env.GOOGLE_SHEETS_CREDENTIALS;
    if (!crudo) {
      throw new Error('Falta GOOGLE_SHEETS_CREDENTIALS.');
    }
    const json = JSON.parse(crudo) as { client_email?: string; private_key?: string };
    if (!json.client_email || !json.private_key) {
      throw new Error('GOOGLE_SHEETS_CREDENTIALS no tiene client_email y private_key.');
    }
    // La clave suele viajar con los saltos de línea escapados al pasar por una
    // variable de entorno; sin desescaparlos la firma falla con un error de
    // formato PEM que no dice nada de la causa.
    return { client_email: json.client_email, private_key: json.private_key.replace(/\\n/g, '\n') };
  }

  private b64url(dato: string | Buffer): string {
    return Buffer.from(dato as never)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /** Token de acceso, reusando el cacheado mientras le quede vida. */
  private async token(): Promise<string> {
    const ahora = Math.floor(Date.now() / 1000);
    // Margen de 60 s: un token que vence en el camino daría un 401 esporádico
    // imposible de reproducir.
    if (this.cache && this.cache.expira > ahora + 60) return this.cache.token;

    const clave = this.credencial();
    const cabecera = this.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const cuerpo = this.b64url(
      JSON.stringify({
        iss: clave.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: ahora,
        exp: ahora + 3600,
      }),
    );
    const firma = this.b64url(
      createSign('RSA-SHA256').update(`${cabecera}.${cuerpo}`).sign(clave.private_key),
    );

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${cabecera}.${cuerpo}.${firma}`,
      }),
    });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!json.access_token) {
      throw new Error(`Google rechazó la credencial: ${json.error_description ?? res.status}`);
    }
    this.cache = { token: json.access_token, expira: ahora + (json.expires_in ?? 3600) };
    return json.access_token;
  }

  /**
   * Lee un rango y devuelve las filas como llegan (matriz de texto).
   *
   * Google recorta las filas por la derecha: si las últimas columnas vienen
   * vacías, la fila llega más corta que la cabecera. Quien consuma esto debe
   * indexar con cuidado, no asumir largo fijo.
   */
  async leerRango(rango: string): Promise<string[][]> {
    const token = await this.token();
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.idPlanilla())}` +
      `/values/${encodeURIComponent(rango)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detalle = await res.text();
      if (res.status === 403) {
        throw new Error(
          'Google denegó el acceso: revisa que la Sheets API esté habilitada y que la ' +
            `planilla esté compartida con la cuenta de servicio. (${detalle.slice(0, 200)})`,
        );
      }
      if (res.status === 404) {
        throw new Error(`No se encontró la planilla o el rango "${rango}".`);
      }
      throw new Error(`Google respondió ${res.status}: ${detalle.slice(0, 200)}`);
    }
    const json = (await res.json()) as { values?: string[][] };
    return json.values ?? [];
  }

  /** Nombre de la planilla; sirve para confirmar en un log a qué documento se conectó. */
  async nombrePlanilla(): Promise<string> {
    const token = await this.token();
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.idPlanilla())}` +
        '?fields=properties.title',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return '(desconocida)';
    const json = (await res.json()) as { properties?: { title?: string } };
    return json.properties?.title ?? '(sin título)';
  }
}
