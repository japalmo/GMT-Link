import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// auth de firebase mockeado: api.ts importa `auth` desde '@/lib/firebase'.
const { mockGetIdToken } = vi.hoisted(() => ({ mockGetIdToken: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: mockGetIdToken } },
}));

import { getMe, ApiError } from '@/lib/api';

/** Construye un Response mínimo para el mock de fetch. */
function res(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('api — request() vía getMe (núcleo del cliente)', () => {
  beforeEach(() => {
    mockGetIdToken.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adjunta Authorization Bearer con token y parsea la respuesta', async () => {
    mockGetIdToken.mockResolvedValue('tok-123');
    const fetchMock = vi.fn().mockResolvedValue(res({ id: 'u1', email: 'a@b.cl' }));
    vi.stubGlobal('fetch', fetchMock);

    const me = await getMe();

    expect(me).toEqual({ id: 'u1', email: 'a@b.cl' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/me');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok-123');
  });

  it('sin token no envía Authorization', async () => {
    mockGetIdToken.mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(res({ id: 'u1' }));
    vi.stubGlobal('fetch', fetchMock);

    await getMe();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });

  it('lanza ApiError con el mensaje del backend en respuestas no-2xx', async () => {
    mockGetIdToken.mockResolvedValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ message: 'No autorizado' }, false, 401)));

    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('No autorizado');
    expect((err as ApiError).status).toBe(401);
  });

  it('une mensajes en array (errores de validación NestJS)', async () => {
    mockGetIdToken.mockResolvedValue('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res({ message: ['campo a inválido', 'campo b inválido'] }, false, 400)),
    );

    const err = await getMe().catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('campo a inválido campo b inválido');
    expect((err as ApiError).status).toBe(400);
  });

  it('usa un fallback cuando el cuerpo de error no es JSON', async () => {
    mockGetIdToken.mockResolvedValue('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('no json')),
      } as unknown as Response),
    );

    const err = await getMe().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toContain('500');
  });

  it('fallo de red → ApiError status 0', async () => {
    mockGetIdToken.mockResolvedValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });
});
