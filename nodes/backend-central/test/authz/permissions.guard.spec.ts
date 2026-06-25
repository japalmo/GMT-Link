import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
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

/** Forma mínima del request que consume el guard. */
interface RequestLike {
  authUser?: AuthUser;
  params: Record<string, string | undefined>;
}

/** Controller de juguete: un handler protegido por el decorador real y uno libre. */
class FixtureController {
  @RequirePermission('can_view', { type: 'project', param: 'projectId' })
  protectedHandler(): string {
    return 'protected';
  }

  openHandler(): string {
    return 'open';
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
  // Cast estructural: el guard solo usa `check`, el resto de FgaService es irrelevante aquí.
  return { check, service: { check } as unknown as FgaService };
}

function createContext(handler: HandlerRef, request: RequestLike): ExecutionContext {
  const partialContext = {
    getHandler: (): HandlerRef => handler,
    getClass: (): typeof FixtureController => FixtureController,
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

describe('PermissionsGuard', () => {
  it('permite handlers sin metadata de @RequirePermission sin consultar FGA', async () => {
    const { guard, check } = createGuard(false);
    const context = createContext(FixtureController.prototype.openHandler, {
      params: {},
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException si no hay authUser en el request', async () => {
    const { guard, check } = createGuard(true);
    const context = createContext(FixtureController.prototype.protectedHandler, {
      params: { projectId: 'p1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(check).not.toHaveBeenCalled();
  });

  it('permite el acceso cuando FGA responde true y arma user/object correctos', async () => {
    const { guard, check } = createGuard(true);
    const context = createContext(FixtureController.prototype.protectedHandler, {
      authUser: { id: 'u1' },
      params: { projectId: 'p1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({
      user: 'user:u1',
      relation: 'can_view',
      object: 'project:p1',
    });
  });

  it('lanza ForbiddenException cuando FGA responde false', async () => {
    const { guard, check } = createGuard(false);
    const context = createContext(FixtureController.prototype.protectedHandler, {
      authUser: { id: 'u1' },
      params: { projectId: 'p1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('lanza BadRequestException si falta el parámetro de ruta declarado', async () => {
    const { guard, check } = createGuard(true);
    const context = createContext(FixtureController.prototype.protectedHandler, {
      authUser: { id: 'u1' },
      params: {},
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(BadRequestException);
    expect(check).not.toHaveBeenCalled();
  });
});
