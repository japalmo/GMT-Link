import { describe, expect, it } from 'vitest';

import {
  cuerpoAviso,
  diasHasta,
  hitoVigente,
  tituloAviso,
} from '../../../src/modules/assets/expiry-notices.util';

/**
 * Calendario decidido por el dueño: aviso a los 30 días, a los 10, diario los
 * últimos 5, y cada 3 días mientras siga vencido.
 *
 * Lo que más importa verificar acá no es el camino feliz sino la ROBUSTEZ ante
 * corridas salteadas: si el proceso no corre un día, el aviso no puede perderse
 * para siempre. Y la IDEMPOTENCIA: la clave del hito es lo que impide que un
 * proceso que corre cada hora mande el mismo aviso 24 veces.
 */

const HOY = new Date(2026, 7, 7); // 7 de agosto de 2026

function enDias(n: number): Date {
  const d = new Date(HOY);
  d.setDate(d.getDate() + n);
  return d;
}

// ─────────────────────────── conteo de días ───────────────────────────

describe('diasHasta', () => {
  it('cuenta días calendario completos', () => {
    expect(diasHasta(enDias(30), HOY)).toBe(30);
    expect(diasHasta(enDias(1), HOY)).toBe(1);
    expect(diasHasta(HOY, HOY)).toBe(0);
  });

  it('da negativo cuando ya venció', () => {
    expect(diasHasta(enDias(-1), HOY)).toBe(-1);
    expect(diasHasta(enDias(-10), HOY)).toBe(-10);
  });

  it('NO depende de la hora del día', () => {
    // Sin normalizar a medianoche, un documento que vence hoy daría 0 a las
    // 22:00 y -1 pasada la medianoche: el hito cambiaría según cuándo corriera
    // el proceso, que es exactamente el tipo de error que no se ve venir.
    const venceHoyTarde = new Date(2026, 7, 7, 23, 59);
    const corridaTemprano = new Date(2026, 7, 7, 0, 1);
    const corridaTarde = new Date(2026, 7, 7, 22, 0);
    expect(diasHasta(venceHoyTarde, corridaTemprano)).toBe(0);
    expect(diasHasta(venceHoyTarde, corridaTarde)).toBe(0);
  });

  it('cruza meses y años sin desviarse', () => {
    expect(diasHasta(new Date(2027, 0, 1), new Date(2026, 11, 31))).toBe(1);
    expect(diasHasta(new Date(2026, 8, 7), new Date(2026, 7, 7))).toBe(31);
  });
});

// ─────────────────────────── el calendario ───────────────────────────

describe('hitoVigente', () => {
  it('no avisa cuando falta más de un mes', () => {
    expect(hitoVigente(31)).toBeNull();
    expect(hitoVigente(90)).toBeNull();
  });

  it('avisa al cruzar los 30 días', () => {
    expect(hitoVigente(30)?.clave).toBe('antes-30');
    expect(hitoVigente(30)?.urgencia).toBe('informativo');
  });

  it('mantiene el hito de 30 hasta cruzar los 10', () => {
    // Es lo que hace que una corrida salteada no pierda el aviso: si el proceso
    // no corrió el día 30 pero sí el 25, igual manda el de "antes-30".
    for (const dias of [30, 25, 20, 15, 11]) {
      expect(hitoVigente(dias)?.clave).toBe('antes-30');
    }
  });

  it('avisa al cruzar los 10 días y lo mantiene hasta los 5', () => {
    for (const dias of [10, 9, 8, 7, 6]) {
      expect(hitoVigente(dias)?.clave).toBe('antes-10');
      expect(hitoVigente(dias)?.urgencia).toBe('proximo');
    }
  });

  it('los últimos 5 días avisa a diario, con clave distinta cada día', () => {
    const claves = [5, 4, 3, 2, 1, 0].map((d) => hitoVigente(d)?.clave);
    expect(claves).toEqual(['dia-5', 'dia-4', 'dia-3', 'dia-2', 'dia-1', 'dia-0']);
    expect(new Set(claves).size).toBe(6); // todas distintas: uno por día
  });

  it('el día del vencimiento es crítico, no vencido todavía', () => {
    expect(hitoVigente(0)?.urgencia).toBe('critico');
    expect(hitoVigente(-1)?.urgencia).toBe('vencido');
  });

  it('vencido: insiste cada 3 días', () => {
    expect(hitoVigente(-1)?.clave).toBe('vencido-0');
    expect(hitoVigente(-2)?.clave).toBe('vencido-0');
    expect(hitoVigente(-3)?.clave).toBe('vencido-3');
    expect(hitoVigente(-5)?.clave).toBe('vencido-3');
    expect(hitoVigente(-6)?.clave).toBe('vencido-6');
    expect(hitoVigente(-30)?.clave).toBe('vencido-30');
  });

  it('vencido: la alerta NUNCA se apaga sola', () => {
    // Decisión del dueño: solo se calla renovando el documento. Un vencido que
    // deja de avisar es peor que no tener aviso, porque da sensación de orden.
    for (const dias of [-1, -30, -365, -3650]) {
      expect(hitoVigente(dias)).not.toBeNull();
      expect(hitoVigente(dias)?.urgencia).toBe('vencido');
    }
  });

  it('ningún tramo comparte clave con otro', () => {
    // Es la propiedad de la que depende la idempotencia: si dos tramos
    // produjeran la misma clave, al llegar el segundo se lo creería ya enviado y
    // el aviso se perdería en silencio. Se comprueba barriendo un año entero en
    // vez de una muestra elegida a dedo.
    const porTramo = new Map<string, Set<string>>();
    for (let dias = 365; dias >= -365; dias -= 1) {
      const hito = hitoVigente(dias);
      if (!hito) continue;
      const tramo = hito.urgencia;
      if (!porTramo.has(tramo)) porTramo.set(tramo, new Set());
      porTramo.get(tramo)!.add(hito.clave);
    }

    const tramos = [...porTramo.entries()];
    for (const [tramoA, clavesA] of tramos) {
      for (const [tramoB, clavesB] of tramos) {
        if (tramoA === tramoB) continue;
        const compartidas = [...clavesA].filter((c) => clavesB.has(c));
        expect(compartidas, `${tramoA} y ${tramoB} comparten claves`).toEqual([]);
      }
    }
  });

  it('en un año entero, cada día tiene un hito bien formado o ninguno', () => {
    for (let dias = 400; dias >= -400; dias -= 1) {
      const hito = hitoVigente(dias);
      if (dias > 30) {
        expect(hito).toBeNull();
      } else {
        expect(hito).not.toBeNull();
        expect(hito!.clave).toMatch(/^(antes-30|antes-10|dia-[0-5]|vencido-\d+)$/);
        expect(hito!.diasRestantes).toBe(dias);
      }
    }
  });
});

// ─────────────────────────── textos ───────────────────────────

describe('textos del aviso', () => {
  it('dice el plazo real, no una frase genérica', () => {
    expect(tituloAviso('Revisión técnica', hitoVigente(30)!)).toContain('30 días');
    expect(tituloAviso('Revisión técnica', hitoVigente(1)!)).toContain('1 día');
    expect(tituloAviso('Revisión técnica', hitoVigente(0)!)).toContain('vence hoy');
  });

  it('concuerda el singular y el plural', () => {
    expect(tituloAviso('SOAP', hitoVigente(1)!)).toContain('1 día');
    expect(tituloAviso('SOAP', hitoVigente(2)!)).toContain('2 días');
    expect(tituloAviso('SOAP', hitoVigente(-1)!)).toContain('hace 1 día');
    expect(tituloAviso('SOAP', hitoVigente(-4)!)).toContain('hace 4 días');
  });

  it('el aviso de vencido dice que el vehículo circula en falta', () => {
    const texto = cuerpoAviso('SKWR57', 'JAC T8', hitoVigente(-3)!);
    expect(texto).toContain('SKWR57');
    expect(texto).toContain('vencida');
  });

  it('el cuerpo siempre identifica el vehículo', () => {
    for (const dias of [30, 10, 3, 0, -5]) {
      const texto = cuerpoAviso('SKWR57', 'JAC T8', hitoVigente(dias)!);
      expect(texto).toContain('SKWR57');
      expect(texto).toContain('JAC T8');
    }
  });

  it('los textos no usan em-dash', () => {
    for (const dias of [30, 0, -3]) {
      expect(tituloAviso('SOAP', hitoVigente(dias)!)).not.toContain('—');
      expect(cuerpoAviso('SKWR57', 'JAC T8', hitoVigente(dias)!)).not.toContain('—');
    }
  });
});
