import type { DatoCabecera } from './checklist-formato-pdf.util';

/**
 * El bloque "datos del conductor" del PDF del checklist, que hasta ahora salía
 * vacío (`datosConductor: []`) aunque el molde impreso lo reserva.
 *
 * ── De dónde sale cada dato ────────────────────────────────────────────────
 *
 * Dos fuentes, y lo DECLARADO al firmar gana. Quien firma responde por lo que
 * declara: si corrigió el dato en el formulario, el documento tiene que mostrar
 * eso y no el registro de RRHH, que puede estar viejo.
 *
 *   1. Lo que la persona declaró al llenar el checklist.
 *   2. Su documento personal de licencia y su acreditación de faena, en RRHH.
 *
 * Un campo declarado en `null` significa "no lo toqué", no "bórralo": el
 * formulario manda los campos que tiene y no siempre los trae todos.
 *
 * ── Por qué nunca deja una celda vacía ─────────────────────────────────────
 *
 * En un documento que se firma, una celda en blanco se lee como "estaba todo
 * bien". Si no hay dato, el PDF dice "No registrada". Y si la licencia está
 * vencida lo dice también, en vez de imprimir la fecha a secas y obligar al
 * lector a hacer la resta.
 *
 * NO devuelve el nombre: el generador del PDF ya lo antepone al bloque.
 *
 * Módulo PURO: sin Prisma ni Nest.
 */

/**
 * Clase de una licencia municipal, leída del texto del documento.
 *
 * No hay campo para la clase: el tipo y el nombre del documento personal de
 * RRHH son texto libre, escrito por quien lo carga. Se reconocen las clases
 * chilenas (A1–A5, B, C, D, E, F) cuando vienen precedidas de "clase", y las
 * profesionales (A1–A5) también sueltas, porque son inconfundibles.
 *
 * Una letra suelta NO se acepta: en "Licencia de conducir - Juan B. Pérez" la
 * "B" es una inicial, no una clase. Ante la duda devuelve `null`, y el PDF
 * dice "Sí" en vez de afirmar una clase que nadie declaró.
 */
export function claseDeLicencia(texto: string): string | null {
  const conPalabra = /\bclase\s*[:-]?\s*(A[1-5]|[BCDEF])\b/i.exec(texto);
  if (conPalabra?.[1]) return conPalabra[1].toUpperCase();
  const profesional = /\b(A[1-5])\b/i.exec(texto);
  return profesional?.[1] ? profesional[1].toUpperCase() : null;
}

/** Licencia tal como la conoce RRHH. */
export interface Licencia {
  clase?: string | null;
  vence: Date | null;
}

/** Lo que la persona declaró al llenar el checklist. */
export interface DeclaradoConductor {
  clase: string | null;
  vence: Date | null;
  interna: Date | null;
}

export interface EntradaConductor {
  licenciaPerfil: Licencia | null;
  acreditacionFaena: { vence: Date | null } | null;
  declarado: DeclaradoConductor | null;
  /** Inyectable para las pruebas; por defecto, ahora. */
  hoy?: Date;
}

/** Día-mes-año, que es como se lee en faena. */
function fechaCorta(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** ¿`vence` quedó antes de `hoy`? Vencer HOY todavía no es estar vencido. */
function estaVencida(vence: Date, hoy: Date): boolean {
  const soloDia = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return soloDia(vence) < soloDia(hoy);
}

/** Una fila del bloque, con su vencimiento y la marca de vencida si aplica. */
function fila(etiqueta: string, clase: string | null, vence: Date | null, hoy: Date): DatoCabecera {
  if (!vence && !clase) return { etiqueta, valor: 'No registrada' };

  const base = clase ? `Clase ${clase}` : 'Sí';
  const valor = vence && estaVencida(vence, hoy) ? `${base} · VENCIDA` : base;

  return vence ? { etiqueta, valor, vencimiento: fechaCorta(vence) } : { etiqueta, valor };
}

export function construirDatosConductor(entrada: EntradaConductor): DatoCabecera[] {
  const hoy = entrada.hoy ?? new Date();

  // `??` y no `||` a propósito: una clase vacía declarada no debe tapar la del
  // perfil, pero tampoco se quiere que un `null` explícito cuente como valor.
  const claseMunicipal = entrada.declarado?.clase ?? entrada.licenciaPerfil?.clase ?? null;
  const venceMunicipal = entrada.declarado?.vence ?? entrada.licenciaPerfil?.vence ?? null;
  const venceInterna = entrada.declarado?.interna ?? entrada.acreditacionFaena?.vence ?? null;

  return [
    fila('Licencia municipal:', claseMunicipal, venceMunicipal, hoy),
    // La licencia interna es una acreditación por faena: no tiene clase.
    fila('Licencia interna:', null, venceInterna, hoy),
  ];
}
