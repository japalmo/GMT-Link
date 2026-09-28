/**
 * La firma a mano alzada que manda el formulario, como binario listo para
 * guardar.
 *
 * El navegador entrega un `data:` URL (`data:image/png;base64,iVBOR…`). Ese
 * texto NO puede quedar guardado dentro del JSON de respuestas: son decenas de
 * kilobytes por checklist en una columna que se lee entera en cada listado del
 * historial. Se guarda como archivo, igual que las fotos, y en la respuesta
 * queda solo la clave.
 *
 * Módulo PURO: sin Prisma, sin Nest y sin storage. Solo valida y decodifica.
 */

/** Tamaño máximo aceptado, ya decodificado. */
export const MAX_BYTES_FIRMA = 512 * 1024;

/**
 * PNG únicamente.
 *
 * El componente de firma exporta PNG y nada más, así que aceptar otros
 * formatos sería abrir la puerta a contenido arbitrario sin ninguna necesidad.
 * El PDF también lo necesita PNG: pdf-lib solo incrusta PNG y JPEG, y el JPEG
 * no tiene transparencia, que es justo lo que hace que la firma se vea sobre
 * la línea del formato en vez de taparla con un recuadro blanco.
 */
const PREFIJO = 'data:image/png;base64,';

/** Los ocho primeros bytes de todo PNG. */
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class FirmaInvalidaError extends Error {}

/** ¿El valor parece una firma recién trazada (y no una clave ya guardada)? */
export function esFirmaNueva(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith('data:');
}

/**
 * Decodifica el `data:` URL de una firma.
 *
 * Lanza `FirmaInvalidaError` si el formato no es el esperado, si excede el
 * tamaño máximo o si los bytes no son realmente un PNG. Lo último importa: el
 * encabezado del `data:` URL lo escribe el cliente y decir "image/png" no
 * obliga a que lo sea.
 */
export function decodificarFirma(valor: string): Buffer {
  if (!valor.startsWith(PREFIJO)) {
    throw new FirmaInvalidaError('La firma debe venir como una imagen PNG.');
  }

  const base64 = valor.slice(PREFIJO.length);
  if (base64.length === 0) {
    throw new FirmaInvalidaError('La firma llegó vacía.');
  }

  // Se corta ANTES de decodificar: un base64 enorme no debería convertirse en
  // memoria solo para descubrir después que no cabía. 4 caracteres → 3 bytes.
  if (Math.floor((base64.length * 3) / 4) > MAX_BYTES_FIRMA) {
    throw new FirmaInvalidaError('La firma es demasiado grande.');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) {
    throw new FirmaInvalidaError('La firma llegó vacía.');
  }
  if (bytes.length > MAX_BYTES_FIRMA) {
    throw new FirmaInvalidaError('La firma es demasiado grande.');
  }
  if (!bytes.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG)) {
    throw new FirmaInvalidaError('La firma no es una imagen PNG válida.');
  }

  return bytes;
}
