import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpsertWorkScheduleInput } from '@gmt-platform/contracts';
import type { FgaService } from '../../src/fga/fga.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { RolesService } from '../../src/modules/roles/roles.service';
import type { EmailService } from '../../src/common/email.service';
import type { OvertimeService } from '../../src/modules/overtime/overtime.service';
import { UsersService } from '../../src/modules/users/users.service';

/** Data que UsersService pasa a workSchedule.upsert (create = userId + update). */
interface UpsertScheduleData {
  shiftPattern: string;
  workDays: number | null;
  restDays: number | null;
  cycleStart: Date | null;
  dayNight: string;
  startTime: string | null;
  endTime: string | null;
  weeklyHours: unknown;
  notes: string | null;
}

interface UpsertScheduleArgs {
  where: { userId: string };
  create: UpsertScheduleData & { userId: string };
  update: UpsertScheduleData;
}

/**
 * Prisma mock mínimo para el flujo de jornada: el usuario siempre existe y el
 * upsert de work_schedules devuelve la fila tal como se persistiría (echo de
 * `update` + metadatos), igual que Postgres con RETURNING.
 */
function buildScheduleHarness(): {
  service: UsersService;
  upsert: ReturnType<typeof vi.fn>;
  lastData: () => UpsertScheduleData;
} {
  const upsert = vi.fn((args: UpsertScheduleArgs) =>
    Promise.resolve({
      id: 'ws-1',
      userId: args.where.userId,
      ...args.update,
      // Prisma devuelve null en la columna cuando se escribió el guard JsonNull.
      weeklyHours: args.update.weeklyHours === Prisma.JsonNull ? null : args.update.weeklyHours,
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
      updatedAt: new Date('2026-07-15T12:00:00.000Z'),
    }),
  );

  const prismaLike: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(() => Promise.resolve({ id: 'user-1' })),
    },
    workSchedule: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      upsert,
    },
  };
  // upsertSchedule guarda el turno y recalcula las HE pendientes en una MISMA
  // transacción: el tx reusa los mismos mocks.
  prismaLike.$transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prismaLike));

  // El recálculo de HE al cambiar el turno se stubbea (su lógica se prueba en
  // overtime.service.spec); aquí solo interesa el flujo de la jornada.
  const overtime = {
    recomputePendingForWorker: vi.fn(() => Promise.resolve(0)),
  } as unknown as OvertimeService;

  const service = new UsersService(
    prismaLike as unknown as PrismaService,
    {} as FgaService,
    {} as StorageService,
    {} as RolesService,
    {} as EmailService,
    overtime,
  );

  const lastData = (): UpsertScheduleData => {
    const call = upsert.mock.calls.at(-1) as [UpsertScheduleArgs] | undefined;
    if (!call) throw new Error('workSchedule.upsert no fue invocado');
    return call[0].update;
  };

  return { service, upsert, lastData };
}

/** Input ADMINISTRATIVO base (los tests ajustan weeklyHours/horas). */
function adminInput(partial: Partial<UpsertWorkScheduleInput> = {}): UpsertWorkScheduleInput {
  return {
    shiftPattern: 'ADMINISTRATIVO',
    dayNight: 'DIA',
    ...partial,
  };
}

describe('UsersService.upsertSchedule — horario semanal (weeklyHours)', () => {
  let harness: ReturnType<typeof buildScheduleHarness>;

  beforeEach(() => {
    harness = buildScheduleHarness();
  });

  it('guarda weeklyHours para ADMINISTRATIVO ordenado por día y sincroniza la jornada legacy con el lunes', async () => {
    // Régimen de la spec: oficina lunes a jueves 08:00-18:00 y viernes hasta las 14:00.
    const view = await harness.service.upsertSchedule(
      'user-1',
      adminInput({
        weeklyHours: [
          { weekday: 5, start: '08:00', end: '14:00' },
          { weekday: 1, start: '08:00', end: '18:00' },
          { weekday: 3, start: '08:00', end: '18:00' },
          { weekday: 2, start: '08:00', end: '18:00' },
          { weekday: 4, start: '08:00', end: '18:00' },
        ],
      }),
    );

    const data = harness.lastData();
    expect(data.weeklyHours).toEqual([
      { weekday: 1, start: '08:00', end: '18:00' },
      { weekday: 2, start: '08:00', end: '18:00' },
      { weekday: 3, start: '08:00', end: '18:00' },
      { weekday: 4, start: '08:00', end: '18:00' },
      { weekday: 5, start: '08:00', end: '14:00' },
    ]);
    // Lectores viejos siguen viendo la jornada única = horas del lunes.
    expect(data.startTime).toBe('08:00');
    expect(data.endTime).toBe('18:00');
    expect(data.workDays).toBeNull();
    expect(data.restDays).toBeNull();
    expect(data.cycleStart).toBeNull();
    expect(view.weeklyHours).toHaveLength(5);
    expect(view.weeklyHours?.[4]).toEqual({ weekday: 5, start: '08:00', end: '14:00' });
  });

  it('deja la jornada legacy en null si el lunes no se trabaja', async () => {
    await harness.service.upsertSchedule(
      'user-1',
      adminInput({ weeklyHours: [{ weekday: 6, start: '09:00', end: '13:00' }] }),
    );

    const data = harness.lastData();
    expect(data.startTime).toBeNull();
    expect(data.endTime).toBeNull();
    expect(data.weeklyHours).toEqual([{ weekday: 6, start: '09:00', end: '13:00' }]);
  });

  it('deriva lunes a viernes de startTime/endTime cuando un escritor legacy no manda weeklyHours', async () => {
    const view = await harness.service.upsertSchedule(
      'user-1',
      adminInput({ startTime: '08:00', endTime: '18:00' }),
    );

    const data = harness.lastData();
    expect(data.weeklyHours).toEqual([
      { weekday: 1, start: '08:00', end: '18:00' },
      { weekday: 2, start: '08:00', end: '18:00' },
      { weekday: 3, start: '08:00', end: '18:00' },
      { weekday: 4, start: '08:00', end: '18:00' },
      { weekday: 5, start: '08:00', end: '18:00' },
    ]);
    expect(view.startTime).toBe('08:00');
    expect(view.endTime).toBe('18:00');
  });

  it('persiste weeklyHours en null (guard JsonNull) si el escritor legacy no manda horas', async () => {
    const view = await harness.service.upsertSchedule('user-1', adminInput());

    const data = harness.lastData();
    expect(data.weeklyHours).toBe(Prisma.JsonNull);
    expect(view.weeklyHours).toBeNull();
  });

  it('rechaza una hora de término no posterior a la de inicio', async () => {
    await expect(
      harness.service.upsertSchedule(
        'user-1',
        adminInput({ weeklyHours: [{ weekday: 1, start: '18:00', end: '08:00' }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      harness.service.upsertSchedule(
        'user-1',
        adminInput({ weeklyHours: [{ weekday: 1, start: '08:00', end: '08:00' }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  it('en turno NOCHE permite cruzar medianoche y solo rechaza inicio igual a término', async () => {
    // Jornada nocturna típica de faena: 20:00 a 08:00 del día siguiente.
    const view = await harness.service.upsertSchedule('user-1', {
      shiftPattern: 'SIETE_POR_SIETE',
      dayNight: 'NOCHE',
      cycleStart: '2026-07-13',
      startTime: '20:00',
      endTime: '08:00',
    });
    expect(view.startTime).toBe('20:00');
    expect(view.endTime).toBe('08:00');

    // También en el horario semanal administrativo (p. ej. sereno nocturno).
    await harness.service.upsertSchedule(
      'user-1',
      adminInput({
        dayNight: 'NOCHE',
        weeklyHours: [{ weekday: 1, start: '22:00', end: '06:00' }],
      }),
    );

    // Inicio igual a término sigue siendo inválido incluso de noche.
    await expect(
      harness.service.upsertSchedule('user-1', {
        shiftPattern: 'SIETE_POR_SIETE',
        dayNight: 'NOCHE',
        cycleStart: '2026-07-13',
        startTime: '20:00',
        endTime: '20:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un día de la semana duplicado', async () => {
    await expect(
      harness.service.upsertSchedule(
        'user-1',
        adminInput({
          weeklyHours: [
            { weekday: 2, start: '08:00', end: '18:00' },
            { weekday: 2, start: '09:00', end: '17:00' },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  it('rechaza weekday fuera de 1..7 y horas sin formato HH:mm', async () => {
    await expect(
      harness.service.upsertSchedule(
        'user-1',
        adminInput({ weeklyHours: [{ weekday: 8, start: '08:00', end: '18:00' }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      harness.service.upsertSchedule(
        'user-1',
        adminInput({ weeklyHours: [{ weekday: 1, start: '8am', end: '18:00' }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un ADMINISTRATIVO con weeklyHours vacío (al menos un día trabajado)', async () => {
    await expect(
      harness.service.upsertSchedule('user-1', adminInput({ weeklyHours: [] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('en patrones cíclicos ignora weeklyHours y valida el par único como jornada en faena', async () => {
    const cyclic: UpsertWorkScheduleInput = {
      shiftPattern: 'SIETE_POR_SIETE',
      dayNight: 'DIA',
      cycleStart: '2026-07-13',
      startTime: '08:00',
      endTime: '20:00',
      weeklyHours: [{ weekday: 1, start: '08:00', end: '18:00' }],
    };

    const view = await harness.service.upsertSchedule('user-1', cyclic);

    const data = harness.lastData();
    // En faena todos los días son iguales: el horario semanal por día no aplica.
    expect(data.weeklyHours).toBe(Prisma.JsonNull);
    expect(data.startTime).toBe('08:00');
    expect(data.endTime).toBe('20:00');
    expect(view.weeklyHours).toBeNull();

    await expect(
      harness.service.upsertSchedule('user-1', {
        ...cyclic,
        startTime: '20:00',
        endTime: '08:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
