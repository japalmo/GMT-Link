import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  sanitizeFilename,
  resolveWithinUploads,
  UPLOADS_ROOT,
} from '../../src/common/storage/local-storage.service';

describe('LocalStorageService — sanitizeFilename (anti path-traversal en nombres)', () => {
  it('descarta cualquier ruta y deja solo el basename', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('/abs/path/cedula.pdf')).toBe('cedula.pdf');
    expect(sanitizeFilename('carpeta/sub/doc.pdf')).toBe('doc.pdf');
  });

  it('neutraliza ".." y nombres ocultos (puntos iniciales)', () => {
    expect(sanitizeFilename('..')).toBe('archivo');
    expect(sanitizeFilename('.env')).toBe('env');
    expect(sanitizeFilename('...hidden')).toBe('hidden');
  });

  it('reemplaza caracteres no seguros y nunca deja separadores ni espacios', () => {
    const out = sanitizeFilename('my report (final)!.pdf');
    expect(out).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(out).not.toContain(' ');
    expect(out).not.toContain('/');
    expect(out).not.toContain('\\');
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('cae a "archivo" cuando queda vacío', () => {
    expect(sanitizeFilename('')).toBe('archivo');
    expect(sanitizeFilename('///')).toBe('archivo');
  });

  it('acota el largo a 120 caracteres', () => {
    expect(sanitizeFilename('a'.repeat(300)).length).toBe(120);
  });
});

describe('LocalStorageService — resolveWithinUploads (defensa anti-escape de la raíz)', () => {
  it('resuelve claves válidas dentro de la raíz de uploads', () => {
    const r = resolveWithinUploads('documents/file.pdf');
    expect(r).not.toBeNull();
    expect(r?.startsWith(UPLOADS_ROOT)).toBe(true);
  });

  it('rechaza (null) claves que escapan con ".."', () => {
    expect(resolveWithinUploads('../../etc/passwd')).toBeNull();
    expect(resolveWithinUploads('documents/../../../../etc/passwd')).toBeNull();
  });

  it('rechaza (null) rutas absolutas que escapan de la raíz', () => {
    expect(resolveWithinUploads('/etc/passwd')).toBeNull();
  });

  it('acepta subcarpetas anidadas legítimas', () => {
    const r = resolveWithinUploads('projects/p1/documents/doc.pdf');
    expect(r).not.toBeNull();
    expect(r?.startsWith(UPLOADS_ROOT)).toBe(true);
  });
});
