import { describe, it, expect } from 'vitest';
import { documentTypeFromCode } from './documents-section';
import { formatRevision } from '@/components/documents/project-document-detail-card';

describe('documentTypeFromCode — tipo documental embebido en el código (§7)', () => {
  it('extrae el token de tipo (antepenúltimo segmento) y lo traduce', () => {
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-INF-NT-001')).toBe('Informe');
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-PRT-NT-014')).toBe('Protocolo');
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-PLN-CIV-002')).toBe('Plano');
  });

  it('en códigos GMT-* con tipo de protocolo V-Metric también manda el antepenúltimo segmento', () => {
    expect(documentTypeFromCode('GMT-SQM-SD-P1-TOP-CR-GEN-001')).toBe('Cubicación Reservorio');
    expect(documentTypeFromCode('GMT-SQM-SD-P1-TOP-AE-GEN-002')).toBe('Área Efectiva');
  });

  it('devuelve el token crudo cuando no está en el catálogo', () => {
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-ZZZ-NT-001')).toBe('ZZZ');
  });

  it('devuelve un guion cuando el código no tiene la forma esperada', () => {
    expect(documentTypeFromCode('SINFORMATO')).toBe('—');
    expect(documentTypeFromCode('A-B')).toBe('—');
  });

  describe('códigos del escritorio ({TIPO}-{ELEMENTO}-{YYYYMMDD}-{HHMMSS}-{microseg})', () => {
    it('usa el PRIMER segmento como tipo cuando no empieza con GMT- y el token existe en el catálogo', () => {
      expect(documentTypeFromCode('CR-R1-20260723-005150-533213')).toBe('Cubicación Reservorio');
      expect(documentTypeFromCode('CP-P2-20260723-010203-000001')).toBe('Cubicación Poza');
      expect(documentTypeFromCode('CA-AC1-20260101-120000-999999')).toBe('Cubicación Acopio');
      expect(documentTypeFromCode('CL-R3-20260315-083000-123456')).toBe('Cota Lámina');
      expect(documentTypeFromCode('AE-R1-20260723-005150-533213')).toBe('Área Efectiva');
    });

    it('nunca muestra la fecha como tipo (regresión QA fase 1B)', () => {
      expect(documentTypeFromCode('CR-R1-20260723-005150-533213')).not.toBe('20260723');
    });

    it('si el primer segmento no está en el catálogo, conserva el fallback del antepenúltimo', () => {
      // No es código del escritorio conocido ni GMT-*: se mantiene el comportamiento previo.
      expect(documentTypeFromCode('XX-YY-ZZ-WW-001')).toBe('ZZ');
    });
  });
});

describe('formatRevision — revisión del documento (rev0 / revA / revB…)', () => {
  it('versión 0 es rev0 y las siguientes usan letras', () => {
    expect(formatRevision(0)).toBe('rev0');
    expect(formatRevision(1)).toBe('revA');
    expect(formatRevision(2)).toBe('revB');
    expect(formatRevision(26)).toBe('revZ');
  });
});
