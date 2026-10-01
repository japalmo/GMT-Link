import 'reflect-metadata';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsController } from '../../src/modules/metrics/metrics.controller';
import type { MetricsService } from '../../src/modules/metrics/metrics.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { StorageService } from '../../src/common/storage/storage.service';

/**
 * GET /metrics/uploads/:filename arma la clave `metrics/${filename}`. Express
 * entrega el parámetro ya decodificado, así que `..%2Fdocuments%2Fx` llega como
 * `../documents/x` y salía de `metrics/` hacia documentos, CV o boletas de otros.
 */
describe('MetricsController.downloadUploadedFile — el filename no sale de metrics/', () => {
  const user = { id: 'u-1', email: 'a@gmt.cl' };
  let read: ReturnType<typeof vi.fn>;
  let controller: MetricsController;
  let res: { setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    read = vi.fn(() => Promise.resolve(Buffer.from('%PDF-')));
    controller = new MetricsController(
      {} as MetricsService,
      {} as FgaService,
      { read } as unknown as StorageService,
    );
    res = { setHeader: vi.fn(), end: vi.fn() };
  });

  const download = (filename: string) =>
    controller.downloadUploadedFile(user, filename, res as unknown as Response);

  it.each([
    ['../documents/x', 'traversal (..%2Fdocuments%2Fx ya decodificado)'],
    ['..', 'solo ".."'],
    ['documents/x.pdf', 'separador /'],
    ['..\\documents\\x', 'separador \\'],
    ['informe.pdf\0.png', 'byte nulo'],
    ['informe con espacios.pdf', 'nombre que cambia al sanitizar'],
  ])('rechaza %j con 400 sin leer el storage (%s)', async (filename) => {
    await expect(download(filename)).rejects.toBeInstanceOf(BadRequestException);
    expect(read).not.toHaveBeenCalled();
  });

  it('un nombre válido se lee bajo metrics/', async () => {
    await download('3f2a-informe_final.pdf');
    expect(read).toHaveBeenCalledWith('metrics/3f2a-informe_final.pdf');
    expect(res.end).toHaveBeenCalled();
  });

  it('sin sesión sigue respondiendo 401', async () => {
    await expect(
      controller.downloadUploadedFile(undefined, '3f2a-informe.pdf', res as unknown as Response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(read).not.toHaveBeenCalled();
  });
});
