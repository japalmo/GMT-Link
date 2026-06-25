import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// auth de firebase mockeado: api.ts importa `auth` desde '@/lib/firebase'.
const { mockGetIdToken } = vi.hoisted(() => ({ mockGetIdToken: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: mockGetIdToken } },
}));

import { getMe, deleteTask, uploadUserAvatar, ApiError } from '@/lib/api';

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

  it('204 No Content → resuelve undefined sin intentar parsear el cuerpo', async () => {
    mockGetIdToken.mockResolvedValue('tok');
    // json() rechaza: si request() lo llamara en un 204, el test fallaría.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error('no debería parsearse')),
      } as unknown as Response),
    );

    await expect(deleteTask('t1')).resolves.toBeUndefined();
  });
});

describe('api — uploadRequest() (subida multipart de archivos)', () => {
  beforeEach(() => {
    mockGetIdToken.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envía PATCH multipart con Authorization y SIN Content-Type (boundary del navegador)', async () => {
    mockGetIdToken.mockResolvedValue('tok-up');
    const fetchMock = vi.fn().mockResolvedValue(res({ id: 'u1', firstName: 'Ada' }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });

    const result = await uploadUserAvatar('u1', file);

    expect(result).toEqual({ id: 'u1', firstName: 'Ada' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/users/u1/avatar');
    expect(init.method).toBe('PATCH');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok-up');
    expect(headers.get('Content-Type')).toBeNull();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('error no-2xx en subida → ApiError con mensaje y status', async () => {
    mockGetIdToken.mockResolvedValue('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res({ message: 'Archivo demasiado grande' }, false, 413)),
    );
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    const err = await uploadUserAvatar('u1', file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Archivo demasiado grande');
    expect((err as ApiError).status).toBe(413);
  });
});
