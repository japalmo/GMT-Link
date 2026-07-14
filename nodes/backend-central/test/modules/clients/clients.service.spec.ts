import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { ClientsService } from '../../../src/modules/clients/clients.service';

/** Fake mínimo de PrismaService: solo los métodos que ClientsService.remove usa. */
function makePrismaMock() {
  return {
    client: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    faena: {
      count: vi.fn(),
    },
    project: {
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
  };
}

describe('ClientsService.remove', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ClientsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ClientsService(prisma as unknown as PrismaService);
  });

  it('lanza 404 si el cliente no existe (findUnique → null)', async () => {
    prisma.client.findUnique.mockResolvedValue(null);

    await expect(service.remove('c_no_existe')).rejects.toMatchObject({ status: 404 });
    expect(prisma.client.delete).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si tiene faenas asociadas (delete NO llamado)', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'cli_1', code: 'ACME', name: 'Acme', rut: null });
    prisma.faena.count.mockResolvedValue(2);
    prisma.project.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);

    await expect(service.remove('cli_1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.client.delete).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si tiene proyectos asociados (delete NO llamado)', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'cli_1', code: 'ACME', name: 'Acme', rut: null });
    prisma.faena.count.mockResolvedValue(0);
    prisma.project.count.mockResolvedValue(5);
    prisma.user.count.mockResolvedValue(0);

    await expect(service.remove('cli_1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.client.delete).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si tiene usuarios asociados (User.clientId es SetNull, no lo frena la FK)', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'cli_1', code: 'ACME', name: 'Acme', rut: null });
    prisma.faena.count.mockResolvedValue(0);
    prisma.project.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(3);

    await expect(service.remove('cli_1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.client.delete).not.toHaveBeenCalled();
  });

  it('borra el cliente y devuelve { success: true } si no tiene faenas, proyectos ni usuarios', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'cli_1', code: 'ACME', name: 'Acme', rut: null });
    prisma.faena.count.mockResolvedValue(0);
    prisma.project.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.client.delete.mockResolvedValue({ id: 'cli_1' });

    const result = await service.remove('cli_1');

    expect(prisma.client.delete).toHaveBeenCalledWith({ where: { id: 'cli_1' } });
    expect(result).toEqual({ success: true });
  });

  it('mapea P2003 de client.delete (carrera count→delete: la FK clientId lo frena) a 409', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'cli_1', code: 'ACME', name: 'Acme', rut: null });
    // El count no vio registros…
    prisma.faena.count.mockResolvedValue(0);
    prisma.project.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    // …pero entre count y delete otro request creó una faena/proyecto → la FK
    // Faena/Project.clientId → Client.id revienta con P2003.
    prisma.client.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(service.remove('cli_1')).rejects.toMatchObject({ status: 409 });
  });
});
