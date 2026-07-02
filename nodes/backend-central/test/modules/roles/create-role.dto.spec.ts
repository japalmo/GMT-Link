import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateRoleDto } from '../../../src/modules/roles/dto/create-role.dto';
import { UpdateRoleDto } from '../../../src/modules/roles/dto/update-role.dto';

/** Aplana constraints recursivamente: los fallos de grants anidados viven en `children`. */
function collectConstraints(failures: ValidationError[]): string[] {
  return failures.flatMap((f) => [
    ...Object.values(f.constraints ?? {}),
    ...collectConstraints(f.children ?? []),
  ]);
}

async function validateDto<T extends object>(cls: new () => T, plain: unknown): Promise<string[]> {
  const instance = plainToInstance(cls, plain, {});
  const failures = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return collectConstraints(failures);
}

describe('CreateRoleDto', () => {
  it('acepta un payload válido mínimo', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Supervisor Norte',
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(errors).toEqual([]);
  });

  it('acepta grants: [] (A6 — el rol se crea vacío y se edita después)', async () => {
    const errors = await validateDto(CreateRoleDto, { label: 'Demo', grants: [] });
    expect(errors).toEqual([]);
  });

  it('rechaza label vacío', async () => {
    const errors = await validateDto(CreateRoleDto, { label: '', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza label > 80 chars', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'a'.repeat(81),
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza description > 255 chars', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Demo',
      description: 'a'.repeat(256),
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza grants ausente (el campo es obligatorio, aunque pueda ser [])', async () => {
    const errors = await validateDto(CreateRoleDto, { label: 'Demo' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza más de 50 grants', async () => {
    const grants = Array.from({ length: 51 }, (_, i) => ({ permissionKey: `perm:${i}`, scope: 'PROJECT' }));
    const errors = await validateDto(CreateRoleDto, { label: 'Demo', grants });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza scope inválido dentro de un grant', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Demo',
      grants: [{ permissionKey: 'task:read', scope: 'BOGUS' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza campos extra (whitelist)', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Demo',
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
      isSystem: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateRoleDto', () => {
  it('acepta payload vacío (todos los campos opcionales)', async () => {
    const errors = await validateDto(UpdateRoleDto, {});
    expect(errors).toEqual([]);
  });

  it('acepta solo label', async () => {
    const errors = await validateDto(UpdateRoleDto, { label: 'Nuevo nombre' });
    expect(errors).toEqual([]);
  });

  it('acepta solo grants', async () => {
    const errors = await validateDto(UpdateRoleDto, {
      grants: [{ permissionKey: 'task:read', scope: 'GLOBAL' }],
    });
    expect(errors).toEqual([]);
  });

  it('acepta grants: [] (A6 — dejar el rol sin permisos es una edición válida)', async () => {
    const errors = await validateDto(UpdateRoleDto, { grants: [] });
    expect(errors).toEqual([]);
  });

  it('rechaza label vacío si viene presente', async () => {
    const errors = await validateDto(UpdateRoleDto, { label: '' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
