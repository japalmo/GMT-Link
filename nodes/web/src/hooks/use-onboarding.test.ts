import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

// El hook llama getCv() y listDocuments() del cliente API: los mockeamos.
const { getCv, listDocuments } = vi.hoisted(() => ({
  getCv: vi.fn(),
  listDocuments: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ getCv, listDocuments }));

import { useOnboarding } from '@/hooks/use-onboarding';

const cvData = (over: Record<string, unknown> = {}) => ({
  summary: '',
  experiences: [] as unknown[],
  education: [] as unknown[],
  certifications: [] as unknown[],
  ...over,
});

describe('useOnboarding', () => {
  beforeEach(() => {
    getCv.mockReset();
    listDocuments.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('marca todos los pasos como hechos con datos completos', async () => {
    getCv.mockResolvedValue(cvData({ summary: 'Mi resumen', experiences: [{ id: 'e1' }] }));
    listDocuments.mockResolvedValue([{ id: 'd1' }]);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.total).toBe(3);
    expect(result.current.completed).toBe(3);
    expect(result.current.allComplete).toBe(true);
  });

  it('ningún paso hecho cuando no hay datos', async () => {
    getCv.mockResolvedValue(cvData());
    listDocuments.mockResolvedValue([]);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.completed).toBe(0);
    expect(result.current.total).toBe(3);
    expect(result.current.allComplete).toBe(false);
  });

  it('deriva pasos individuales (resumen y documento sí; entradas no)', async () => {
    getCv.mockResolvedValue(cvData({ summary: 'Hola' }));
    listDocuments.mockResolvedValue([{ id: 'd1' }]);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.completed).toBe(2);
    const byKey = Object.fromEntries(result.current.steps.map((s) => [s.key, s.done]));
    expect(byKey['cv-summary']).toBe(true);
    expect(byKey['cv-entries']).toBe(false);
    expect(byKey['first-document']).toBe(true);
  });

  it('ante error de la API no muestra pasos', async () => {
    getCv.mockRejectedValue(new Error('down'));
    listDocuments.mockResolvedValue([]);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.steps).toEqual([]);
    expect(result.current.allComplete).toBe(false);
  });

  it('dismiss() pospone en sessionStorage y marca dismissed', async () => {
    getCv.mockResolvedValue(cvData());
    listDocuments.mockResolvedValue([]);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.dismissed).toBe(false);
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);
    expect(window.sessionStorage.getItem('gmt.onboarding.dismissed')).toBe('1');
  });

  it('inicia dismissed si ya estaba pospuesto en la sesión', async () => {
    window.sessionStorage.setItem('gmt.onboarding.dismissed', '1');
    getCv.mockResolvedValue(cvData());
    listDocuments.mockResolvedValue([]);

    const { result } = renderHook(() => useOnboarding());
    expect(result.current.dismissed).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
