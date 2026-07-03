import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// token store mockeado: api.ts lee el JWT vía getToken() de '@/lib/auth-token'.
const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({
  getToken: mockGetToken,
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { getMe, deleteTask, uploadUserAvatar, ApiError } from '@/lib/api';

/** Construye un Response mínimo para el mock de fetch. */
function res(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('api — request() vía getMe (núcleo del cliente)', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adjunta Authorization Bearer con token y parsea la respuesta', async () => {
    mockGetToken.mockReturnValue('tok-123');
    const fetchMock = vi.fn().mockResolvedValue(res({ id: 'u1', email: 'a@b.cl' }));
    vi.stubGlobal('fetch', fetchMock);

    const me = await getMe();

    expect(me).toEqual({ id: 'u1', email: 'a@b.cl' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/me');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok-123');
  });

  it('sin token no envía Authorization', async () => {
    mockGetToken.mockReturnValue(null);
    const fetchMock = vi.fn().mockResolvedValue(res({ id: 'u1' }));
    vi.stubGlobal('fetch', fetchMock);

    await getMe();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });

  it('lanza ApiError con el mensaje del backend en respuestas no-2xx', async () => {
    mockGetToken.mockReturnValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ message: 'No autorizado' }, false, 401)));

    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('No autorizado');
    expect((err as ApiError).status).toBe(401);
  });

  it('une mensajes en array (errores de validación NestJS)', async () => {
    mockGetToken.mockReturnValue('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res({ message: ['campo a inválido', 'campo b inválido'] }, false, 400)),
    );

    const err = await getMe().catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('campo a inválido campo b inválido');
    expect((err as ApiError).status).toBe(400);
  });

  it('usa un fallback cuando el cuerpo de error no es JSON', async () => {
    mockGetToken.mockReturnValue('tok');
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
    mockGetToken.mockReturnValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it('204 No Content → resuelve undefined sin intentar parsear el cuerpo', async () => {
    mockGetToken.mockReturnValue('tok');
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
    mockGetToken.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envía PATCH multipart con Authorization y SIN Content-Type (boundary del navegador)', async () => {
    mockGetToken.mockReturnValue('tok-up');
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
    mockGetToken.mockReturnValue('tok');
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

import {
  getPermissionsCatalog,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  cloneRole,
} from '@/lib/api';
import type { CloneRoleResponse, PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

describe('api — módulo de roles dinámicos (catálogo + CRUD)', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockReturnValue('tok');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const group: PermissionCatalogGroup = {
    module: 'operaciones',
    items: [
      {
        key: 'project:read',
        label: 'Ver proyecto',
        module: 'operaciones',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: 'project',
        composable: true,
      },
    ],
  };

  const roleDetail: RoleDetail = {
    key: 'c_inspector',
    label: 'Inspector',
    description: null,
    isSystem: false,
    allowedScopeTypes: ['PROJECT'],
    grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
  };

  it('getPermissionsCatalog — GET /permissions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res([group]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getPermissionsCatalog();

    expect(result).toEqual([group]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/permissions');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('listRoles — GET /roles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res([roleDetail]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listRoles();

    expect(result).toEqual([roleDetail]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles');
  });

  it('getRole — GET /roles/:key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(roleDetail));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getRole('c_inspector');

    expect(result).toEqual(roleDetail);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector');
  });

  it('createRole — POST /roles con el body serializado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(roleDetail));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createRole({ label: 'Inspector', grants: roleDetail.grants });

    expect(result).toEqual(roleDetail);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector', grants: roleDetail.grants });
  });

  it('updateRole — PATCH /roles/:key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(roleDetail));
    vi.stubGlobal('fetch', fetchMock);

    const result = await updateRole('c_inspector', { label: 'Inspector v2' });

    expect(result).toEqual(roleDetail);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector v2' });
  });

  it('deleteRole — DELETE /roles/:key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: () => Promise.reject(new Error('no debería parsearse')) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteRole('c_inspector')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector');
    expect(init.method).toBe('DELETE');
  });

  it('deleteRole — 409 ROLE_IN_USE propaga ApiError con status 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ message: 'Rol en uso', code: 'ROLE_IN_USE' }, false, 409)));

    const err = await deleteRole('c_inspector').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it('cloneRole — POST /roles/:key/clone devuelve CloneRoleResponse (role + omittedPermissionKeys)', async () => {
    const cloned: CloneRoleResponse = {
      role: { ...roleDetail, key: 'c_inspector_2', label: 'Inspector (copia)' },
      omittedPermissionKeys: ['document:review'],
    };
    const fetchMock = vi.fn().mockResolvedValue(res(cloned));
    vi.stubGlobal('fetch', fetchMock);

    const result = await cloneRole('c_inspector', 'Inspector (copia)');

    expect(result).toEqual(cloned);
    expect(result.omittedPermissionKeys).toEqual(['document:review']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector/clone');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector (copia)' });
  });
});
