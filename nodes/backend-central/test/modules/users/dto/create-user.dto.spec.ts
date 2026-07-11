import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from '../../../../src/modules/users/dto/create-user.dto';

function make(overrides: Record<string, unknown>) {
  return plainToInstance(CreateUserDto, {
    firstName: 'Ana',
    lastName: 'Pérez',
    username: 'ana.perez',
    emailInstitucional: 'ana.perez@gmt.cl',
    roleKeys: ['viewer'],
    ...overrides,
  });
}

async function keys(dto: object): Promise<string[]> {
  const failures = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return failures.map((f) => f.property);
}

describe('CreateUserDto', () => {
  it('acepta username válido + email institucional', async () => {
    expect(await keys(make({}))).toEqual([]);
  });
  it('acepta solo email personal (≥1 email)', async () => {
    expect(await keys(make({ emailInstitucional: undefined, emailPersonal: 'ana@gmail.com' }))).toEqual([]);
  });
  it('rechaza cuando faltan ambos emails', async () => {
    expect(await keys(make({ emailInstitucional: undefined, emailPersonal: undefined }))).toContain('username');
  });
  it('rechaza username con mayúsculas/espacios', async () => {
    expect(await keys(make({ username: 'Ana Perez' }))).toContain('username');
  });
  it('rechaza username < 3 chars', async () => {
    expect(await keys(make({ username: 'ab' }))).toContain('username');
  });
  it('rechaza email institucional inválido', async () => {
    expect(await keys(make({ emailInstitucional: 'no-es-email' }))).toContain('emailInstitucional');
  });
});
