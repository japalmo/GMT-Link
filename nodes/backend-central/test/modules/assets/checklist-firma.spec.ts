import { describe, expect, it } from 'vitest';
import {
  decodificarFirma,
  esFirmaNueva,
  FirmaInvalidaError,
  MAX_BYTES_FIRMA,
} from '../../../src/modules/assets/checklist-firma.util';

/** PNG mínimo válido (1x1 transparente). */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const comoDataUrl = (base64: string): string => `data:image/png;base64,${base64}`;

describe('esFirmaNueva', () => {
  it('reconoce un data URL recién trazado', () => {
    expect(esFirmaNueva(comoDataUrl(PNG_1X1))).toBe(true);
  });

  it('no confunde una clave de storage ya guardada con una firma nueva', () => {
    // Al reenviar un checklist el valor ya es la clave; volver a decodificarla
    // sería un error.
    expect(esFirmaNueva('checklist-firmas/abc123-firma.png')).toBe(false);
  });

  it('descarta lo que no es texto', () => {
    expect(esFirmaNueva(null)).toBe(false);
    expect(esFirmaNueva(42)).toBe(false);
    expect(esFirmaNueva(undefined)).toBe(false);
  });
});

describe('decodificarFirma', () => {
  it('devuelve los bytes del PNG', () => {
    const bytes = decodificarFirma(comoDataUrl(PNG_1X1));
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('rechaza un tipo que no sea PNG', () => {
    expect(() => decodificarFirma(`data:image/jpeg;base64,${PNG_1X1}`)).toThrow(FirmaInvalidaError);
    expect(() => decodificarFirma('data:text/html;base64,PHNjcmlwdD4=')).toThrow(
      FirmaInvalidaError,
    );
  });

  it('rechaza un texto que no es data URL', () => {
    expect(() => decodificarFirma('https://ejemplo.cl/firma.png')).toThrow(FirmaInvalidaError);
  });

  it('rechaza una firma vacía', () => {
    expect(() => decodificarFirma(comoDataUrl(''))).toThrow(FirmaInvalidaError);
  });

  it('rechaza bytes que dicen ser PNG pero no lo son', () => {
    // El encabezado del data URL lo escribe el cliente: decir "image/png" no
    // obliga a que el contenido lo sea.
    const noEsPng = Buffer.from('<svg onload=alert(1)>').toString('base64');
    expect(() => decodificarFirma(comoDataUrl(noEsPng))).toThrow(FirmaInvalidaError);
  });

  it('rechaza una firma más grande que el máximo', () => {
    const enorme = Buffer.alloc(MAX_BYTES_FIRMA + 1024, 0x41).toString('base64');
    expect(() => decodificarFirma(comoDataUrl(enorme))).toThrow(FirmaInvalidaError);
  });
});
