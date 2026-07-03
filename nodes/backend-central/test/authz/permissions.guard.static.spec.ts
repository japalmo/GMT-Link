import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../src/authz/auth-user.types';
import { PermissionsGuard } from '../../src/authz/permissions.guard';
import { RequirePermission } from '../../src/authz/require-permission.decorator';
import type { FgaService } from '../../src/fga/fga.service';

/** Parámetros del contrato FgaService.check. */
interface FgaCheckParams {
  user: string;
  relation: string;
  object: string;
}

interface RequestLike {
  authUser?: AuthUser;
  params: Record<string, string | undefined>;
}

/** Controller de juguete con un recurso de id ESTÁTICO (org-scope, §1.1). */
const ORG_ID = 'gmt';
class OrgFixtureController {
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  manageUsers(): string {
    return 'ok';
  }
}

type HandlerRef = () => string;

function createFgaMock(result: boolean): {
  check: ReturnType<typeof vi.fn>;
  service: FgaService;
} {
  const check = vi.fn((params: FgaCheckParams): Promise<boolean> => {
    void params;
    return Promise.resolve(result);
  });
  return { check, service: { check } as unknown as FgaService };
}

function createContext(handler: HandlerRef, request: RequestLike): ExecutionContext {
  const partialContext = {
    getHandler: (): HandlerRef => handler,
    getClass: (): typeof OrgFixtureController => OrgFixtureController,
    switchToHttp: (): { getRequest: () => RequestLike } => ({
      getRequest: (): RequestLike => request,
    }),
  };
  return partialContext as unknown as ExecutionContext;
}

function createGuard(checkResult: boolean): {
  guard: PermissionsGuard;
  check: ReturnType<typeof vi.fn>;
} {
  const { check, service } = createFgaMock(checkResult);
  return { guard: new PermissionsGuard(new Reflector(), service), check };
}

describe('PermissionsGuard — recurso de id estático (org-scope §1.1)', () => {
  it('permite y arma object con el id estático (sin param de ruta) cuando FGA responde true', async () => {
    const { guard, check } = createGuard(true);
    const context = createContext(OrgFixtureController.prototype.manageUsers, {
      authUser: { id: 'admin1' },
      params: {}, // sin params: el id del recurso es estático
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({
      user: 'user:admin1',
      relation: 'can_manage_users',
      object: `organization:${ORG_ID}`,
    });
  });

  it('deniega (Forbidden) cuando FGA responde false, igual que con param', async () => {
    const { guard, check } = createGuard(false);
    const context = createContext(OrgFixtureController.prototype.manageUsers, {
      authUser: { id: 'noadmin' },
      params: {},
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('exige sesión: 401 si no hay authUser, sin consultar FGA', async () => {
    const { guard, check } = createGuard(true);
    const context = createContext(OrgFixtureController.prototype.manageUsers, { params: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('PermissionsGuard — can_manage_roles sobre organization:gmt (Fase 4 RBAC matriz)', () => {
  class RolesFixtureController {
    @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
    manageRoles(): string {
      return 'ok';
    }
  }

  function createRolesContext(request: RequestLike): ExecutionContext {
    const partialContext = {
      getHandler: (): HandlerRef => RolesFixtureController.prototype.manageRoles,
      getClass: (): typeof RolesFixtureController => RolesFixtureController,
      switchToHttp: (): { getRequest: () => RequestLike } => ({
        getRequest: (): RequestLike => request,
      }),
    };
    return partialContext as unknown as ExecutionContext;
  }

  it('200: admin con can_manage_roles=true accede', async () => {
    const { guard, check } = createGuard(true);
    const context = createRolesContext({ authUser: { id: 'admin1' }, params: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith({
      user: 'user:admin1',
      relation: 'can_manage_roles',
      object: `organization:${ORG_ID}`,
    });
  });

  it('403: usuario sin can_manage_roles es rechazado', async () => {
    const { guard, check } = createGuard(false);
    const context = createRolesContext({ authUser: { id: 'noadmin' }, params: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
