import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FieldWorkersService } from '../../src/modules/users/field-workers.service';

/**
 * El trabajador de faena vive en la tabla de usuarios pero NO es una cuenta.
 * Lo que estas pruebas cuidan es justamente esa frontera: que la ficha nazca
 * sin clave y sin acceso, que su correo no pueda salir a ninguna casilla real,
 * y que esta puerta no sirva para tocar a un usuario de verdad.
 */

interface Mock {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  taskWorker: { count: ReturnType<typeof vi.fn> };
}

function build(usernamesTomados: string[] = []): { service: FieldWorkersService; mock: Mock } {
  const tomados = new Set(usernamesTomados);
  const mock: Mock = {
    user: {
      findUnique: vi.fn((args: { where: { username?: string; id?: string } }) => {
        if (args.where.username) {
          return Promise.resolve(tomados.has(args.where.username) ? { id: 'otro' } : null);
        }
        return Promise.resolve(null);
      }),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'w1',
          firstName: args.data.firstName,
          lastName: args.data.lastName,
          cargo: args.data.cargo ?? null,
        }),
      ),
      update: vi.fn(() =>
        Promise.resolve({
          id: 'w1',
          firstName: 'Juan',
          lastName: 'Pérez',
          cargo: null,
          _count: { crewMemberships: 0 },
        }),
      ),
      delete: vi.fn(() => Promise.resolve({ id: 'w1' })),
    },
    taskWorker: { count: vi.fn(() => Promise.resolve(0)) },
  };
  return { service: new FieldWorkersService(mock as unknown as PrismaService), mock };
}

describe('FieldWorkersService', () => {
  it('crea la ficha sin clave: sin hash no hay login posible', async () => {
    const { service, mock } = build();
    await service.create({ firstName: 'Juan', lastName: 'Pérez' });

    const data = mock.user.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data.passwordHash).toBeNull();
    expect(data.isFieldWorker).toBe(true);
  });

  it('le inventa un correo en un dominio que no resuelve', async () => {
    const { service, mock } = build();
    await service.create({ firstName: 'Juan', lastName: 'Pérez' });

    const data = mock.user.create.mock.calls[0]?.[0].data as Record<string, string>;
    // `.invalid` está reservado por la RFC 2606 para direcciones que nunca
    // resuelven: ningún correo puede terminar en la casilla de una persona real.
    expect(data.email.endsWith('@trabajador.invalid')).toBe(true);
  });

  it('saca tildes y espacios del nombre de usuario', async () => {
    const { service, mock } = build();
    await service.create({ firstName: 'José', lastName: 'Muñoz Díaz' });

    const data = mock.user.create.mock.calls[0]?.[0].data as Record<string, string>;
    expect(data.username).toBe('jmunozdiaz');
  });

  it('numera cuando el nombre de usuario ya está tomado', async () => {
    const { service, mock } = build(['jperez', 'jperez2']);
    await service.create({ firstName: 'Juan', lastName: 'Perez' });

    const data = mock.user.create.mock.calls[0]?.[0].data as Record<string, string>;
    expect(data.username).toBe('jperez3');
  });

  it('exige nombre y apellido', async () => {
    const { service } = build();
    await expect(service.create({ firstName: '  ', lastName: 'Pérez' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('no deja editar por esta puerta a alguien con cuenta', async () => {
    const { service, mock } = build();
    mock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      firstName: 'Ana',
      lastName: 'Soto',
      isFieldWorker: false,
    });

    // Acá no hay gestión de roles, sesiones ni OpenFGA: tocar una cuenta real
    // por este camino la dejaría a medias.
    await expect(service.update('u1', { cargo: 'Jefe' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mock.user.update).not.toHaveBeenCalled();
  });

  it('avisa antes de borrar a alguien que está en cuadrillas', async () => {
    const { service, mock } = build();
    mock.user.findUnique.mockResolvedValueOnce({
      id: 'w1',
      firstName: 'Juan',
      lastName: 'Pérez',
      isFieldWorker: true,
    });
    mock.taskWorker.count.mockResolvedValueOnce(3);

    await expect(service.remove('w1', false)).rejects.toThrow(/3 tareas/);
    expect(mock.user.delete).not.toHaveBeenCalled();
  });

  it('borra cuando se confirma, y dice de cuántas cuadrillas salió', async () => {
    const { service, mock } = build();
    mock.user.findUnique.mockResolvedValueOnce({
      id: 'w1',
      firstName: 'Juan',
      lastName: 'Pérez',
      isFieldWorker: true,
    });
    mock.taskWorker.count.mockResolvedValueOnce(3);

    await expect(service.remove('w1', true)).resolves.toEqual({ removed: true, assignments: 3 });
    expect(mock.user.delete).toHaveBeenCalled();
  });
});
