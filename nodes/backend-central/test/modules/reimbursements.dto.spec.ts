import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateReimbursementDto } from '../../src/modules/reimbursements/dto/reimbursements.dto';

/** Valida una instancia con las mismas opciones que el ValidationPipe global. */
async function failuresOf(instance: object): Promise<string[]> {
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const VALID_BODY = {
  amount: 15000,
  date: '2026-06-10T00:00:00.000Z',
  concept: 'Taxi',
};

describe('CreateReimbursementDto — límites de amount (CLP entero Int32)', () => {
  it('acepta un amount válido', async () => {
    const dto = plainToInstance(CreateReimbursementDto, VALID_BODY);
    expect(await failuresOf(dto)).toHaveLength(0);
  });

  it('rechaza amount mayor al Int32 de Postgres (antes: 500 de Prisma)', async () => {
    const dto = plainToInstance(CreateReimbursementDto, {
      ...VALID_BODY,
      amount: 3_000_000_000,
    });
    const failures = await failuresOf(dto);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(' ')).toMatch(/amount/i);
  });
});
