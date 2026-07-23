import { describe, it, expect } from 'vitest';
import { documentTypeFromCode } from './documents-section';
import { formatRevision } from '@/components/documents/project-document-detail-card';

describe('documentTypeFromCode — tipo documental embebido en el código (§7)', () => {
  it('extrae el token de tipo (antepenúltimo segmento) y lo traduce', () => {
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-INF-NT-001')).toBe('Informe');
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-PRT-NT-014')).toBe('Protocolo');
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-PLN-CIV-002')).toBe('Plano');
  });

  it('devuelve el token crudo cuando no está en el catálogo', () => {
    expect(documentTypeFromCode('GMT-ALS-GEO-ATA-CUB-ZZZ-NT-001')).toBe('ZZZ');
  });

  it('devuelve un guion cuando el código no tiene la forma esperada', () => {
    expect(documentTypeFromCode('SINFORMATO')).toBe('—');
    expect(documentTypeFromCode('A-B')).toBe('—');
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
