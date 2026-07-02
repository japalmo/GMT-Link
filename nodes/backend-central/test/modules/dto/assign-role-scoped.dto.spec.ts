import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignRoleScopedDto } from '../../../src/modules/users/dto/assign-role-scoped.dto';

describe('AssignRoleScopedDto', () => {
  it('acepta roleKey/scopeType/scopeId válidos', async () => {
    const dto = plainToInstance(AssignRoleScopedDto, {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('rechaza scopeType fuera de ORGANIZATION|PROJECT', async () => {
    const dto = plainToInstance(AssignRoleScopedDto, {
      roleKey: 'c_auditor',
      scopeType: 'SERVICE',
      scopeId: 's1',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza campos extra', async () => {
    const dto = plainToInstance(AssignRoleScopedDto, {
      roleKey: 'c_auditor',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
      extra: 'no',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
