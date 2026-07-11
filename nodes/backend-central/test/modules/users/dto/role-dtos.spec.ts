/**
 * Los DTOs de roleKeys ya NO restringen a ROLE_KEYS (§7 design doc RBAC): un
 * rol personalizado (c_xxx) debe pasar la validación de forma; la validación
 * dura contra la BD vive en UsersService (Task 1.3). Se mantiene el rechazo
 * de valores no-string / vacíos.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AssignRoleDto } from '../../../../src/modules/users/dto/assign-role.dto';
import { CreateUserDto } from '../../../../src/modules/users/dto/create-user.dto';

describe('CreateUserDto.roleKeys — acepta roles personalizados', () => {
  it('un rol personalizado (c_xxx) pasa la validación de forma', async () => {
    const dto = plainToInstance(CreateUserDto, {
      firstName: 'Ana',
      lastName: 'Pérez',
      username: 'ana.perez',
      emailInstitucional: 'ana@gmt.cl',
      roleKeys: ['c_inspector_de_campo'],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('un roleKey vacío o no-string sigue siendo rechazado', async () => {
    const dto = plainToInstance(CreateUserDto, {
      firstName: 'Ana',
      lastName: 'Pérez',
      username: 'ana.perez',
      emailInstitucional: 'ana@gmt.cl',
      roleKeys: [42],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('un roleKey string vacío es rechazado', async () => {
    const dto = plainToInstance(CreateUserDto, {
      firstName: 'Ana',
      lastName: 'Pérez',
      username: 'ana.perez',
      emailInstitucional: 'ana@gmt.cl',
      roleKeys: [''],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('AssignRoleDto.roleKey — acepta un rol personalizado', () => {
  it('un rol personalizado (c_xxx) pasa la validación de forma', async () => {
    const dto = plainToInstance(AssignRoleDto, { roleKey: 'c_inspector_de_campo' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('un roleKey no-string es rechazado', async () => {
    const dto = plainToInstance(AssignRoleDto, { roleKey: 42 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('un roleKey string vacío es rechazado', async () => {
    const dto = plainToInstance(AssignRoleDto, { roleKey: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
