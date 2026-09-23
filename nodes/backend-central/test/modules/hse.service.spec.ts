import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HseService, MAX_FOTOS } from '../../src/modules/hse/hse.service';
import { buildIncidentePdf } from '../../src/modules/hse/incidente-pdf.util';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { CreateIncidentDto } from '../../src/modules/hse/dto/hse.dto';

/**
 * HSE: el número de registro, las fotos y la retención del PDF.
 *
 * El correlativo y la purga son las dos cosas que, si fallan, se notan tarde y
 * mal: un reporte con número repetido no se puede archivar, y un PDF que nunca
 * se borra convierte el storage en un depósito.
 */

const DTO: CreateIncidentDto = {
  fecha: '2026-09-23',
  hora: '10:30',
  descripcion: 'Un bus golpea el parachoque de la camioneta al adelantar por la izquierda.',
  accionesInmediatas: '.- Se informa a la jefatura',
  preparaNombre: 'Jorge Osorio',
};

const FOTO = { buffer: Buffer.alloc(64), originalname: 'foto.jpg', mimetype: 'image/jpeg' };

function armar(opciones: { codes?: string[] } = {}) {
  const create = vi.fn(({ data }: { data: { code: string } }) =>
    Promise.resolve({ id: 'inc-1', code: data.code, publicToken: 'tok-1', photos: [] }),
  );
  const prisma = {
    hseIncident: {
      findMany: vi.fn(() => Promise.resolve((opciones.codes ?? []).map((code) => ({ code })))),
      create,
      findUnique: vi.fn(() => Promise.resolve(null)),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      count: vi.fn(() => Promise.resolve(0)),
    },
  } as unknown as PrismaService;
  const storage = {
    save: vi.fn(() => Promise.resolve({ key: 'hse/incidentes/fotos/x.jpg' })),
    read: vi.fn(() => Promise.resolve(Buffer.alloc(0))),
    delete: vi.fn(() => Promise.resolve()),
  } as unknown as StorageService;
  return { servicio: new HseService(prisma, storage), prisma, storage, create };
}

describe('HseService: número de registro', () => {
  it('el primer reporte arranca en GMT-SG-RG-10', async () => {
    const { servicio, create } = armar({ codes: [] });
    const creado = await servicio.create(DTO, [FOTO]);
    expect(create).toHaveBeenCalled();
    expect(creado.code).toBe('GMT-SG-RG-10');
  });

  it('sigue la serie desde el mayor ya usado', async () => {
    const { servicio } = armar({ codes: ['GMT-SG-RG-10', 'GMT-SG-RG-11'] });
    const creado = await servicio.create(DTO, [FOTO]);
    expect(creado.code).toBe('GMT-SG-RG-12');
  });

  it('ignora códigos que no terminan en número, para no reiniciar la serie', async () => {
    const { servicio } = armar({ codes: ['GMT-SG-RG-14', 'GMT-SG-RG-ANEXO'] });
    const creado = await servicio.create(DTO, [FOTO]);
    expect(creado.code).toBe('GMT-SG-RG-15');
  });

  it('si dos reportes toman el mismo número a la vez, el segundo reintenta', async () => {
    const { servicio, prisma } = armar({ codes: ['GMT-SG-RG-10'] });
    const create = prisma.hseIncident.create as unknown as ReturnType<typeof vi.fn>;
    create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    create.mockImplementationOnce(({ data }: { data: { code: string } }) =>
      Promise.resolve({ id: 'inc-2', code: data.code, publicToken: 'tok-2', photos: [] }),
    );
    const creado = await servicio.create(DTO, [FOTO]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(creado.code).toBe('GMT-SG-RG-11');
  });
});

describe('HseService: fotos', () => {
  it('exige al menos una: es la que va en el recuadro del formato', () => {
    const { servicio } = armar();
    expect(() => servicio.validarFotos([])).toThrow(BadRequestException);
  });

  it('acepta hasta el máximo y rechaza una de más', () => {
    const { servicio } = armar();
    expect(servicio.validarFotos(Array(MAX_FOTOS).fill(FOTO))).toHaveLength(MAX_FOTOS);
    expect(() => servicio.validarFotos(Array(MAX_FOTOS + 1).fill(FOTO))).toThrow(BadRequestException);
  });

  it('rechaza formatos que el PDF no sabe incrustar', () => {
    const { servicio } = armar();
    expect(() =>
      servicio.validarFotos([{ ...FOTO, mimetype: 'image/heic', originalname: 'foto.heic' }]),
    ).toThrow(BadRequestException);
  });
});

describe('HseService: retención del PDF', () => {
  it('borra el archivo de los reportes viejos y deja los datos intactos', async () => {
    const { servicio, prisma, storage } = armar();
    const findMany = prisma.hseIncident.findMany as unknown as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValueOnce([
      { id: 'a', code: 'GMT-SG-RG-10', pdfKey: 'hse/incidentes/pdf/a.pdf' },
    ]);

    const borrados = await servicio.purgarPdfsVencidos(new Date('2026-12-01T00:00:00.000Z'));

    expect(borrados).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith('hse/incidentes/pdf/a.pdf');
    // El registro sigue: solo se suelta la referencia al archivo.
    expect(prisma.hseIncident.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { pdfKey: null, pdfGeneratedAt: null },
    });
    expect(prisma.hseIncident.delete).not.toHaveBeenCalled();
  });
});

describe('HseService: borrar un reporte', () => {
  it('borra las fotos, el PDF y la fila', async () => {
    const { servicio, prisma, storage } = armar();
    const findUnique = prisma.hseIncident.findUnique as unknown as ReturnType<typeof vi.fn>;
    findUnique.mockResolvedValueOnce({
      id: 'inc-1',
      code: 'GMT-SG-RG-10',
      pdfKey: 'hse/pdf/a.pdf',
      photos: [{ fileKey: 'hse/fotos/a.jpg', position: 0 }],
    });

    const r = await servicio.remove('inc-1');

    expect(r).toEqual({ removed: true, code: 'GMT-SG-RG-10' });
    expect(storage.delete).toHaveBeenCalledWith('hse/fotos/a.jpg');
    expect(storage.delete).toHaveBeenCalledWith('hse/pdf/a.pdf');
    expect(prisma.hseIncident.delete).toHaveBeenCalledWith({ where: { id: 'inc-1' } });
  });

  it('si el archivo ya no está en el storage, igual borra el reporte', async () => {
    const { servicio, prisma, storage } = armar();
    const findUnique = prisma.hseIncident.findUnique as unknown as ReturnType<typeof vi.fn>;
    findUnique.mockResolvedValueOnce({
      id: 'inc-2',
      code: 'GMT-SG-RG-11',
      pdfKey: null,
      photos: [{ fileKey: 'hse/fotos/perdida.jpg', position: 0 }],
    });
    (storage.delete as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no existe'),
    );

    await expect(servicio.remove('inc-2')).resolves.toEqual({
      removed: true,
      code: 'GMT-SG-RG-11',
    });
    expect(prisma.hseIncident.delete).toHaveBeenCalled();
  });

  it('un id que no existe responde 404 y no borra nada', async () => {
    const { servicio, prisma } = armar();
    await expect(servicio.remove('fantasma')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.hseIncident.delete).not.toHaveBeenCalled();
  });
});

describe('buildIncidentePdf', () => {
  const base = {
    code: 'GMT-SG-RG-10',
    empresa: 'GMT Ingenieria SPA',
    sitio: 'CASA MATRIZ',
    area: 'CALLE OHIGGINS ANTOFAGASTA',
    turno: null,
    fecha: '23/9/2026',
    hora: '10:30',
    lesionPersonas: false,
    cargoLesionado: null,
    danoInfraestructura: true,
    danoDetalle: 'Parachoque y máscara izquierda',
    fugaDerrame: false,
    fugaSustancia: null,
    fugaDuracionMin: null,
    fugaVolumenM3: null,
    fugaPh: null,
    fugaSuperficieM2: null,
    emisionesAire: false,
    emisionGases: null,
    emisionDuracionMin: null,
    instalaciones: false,
    instalacionesLugar: null,
    cuasiAccidente: false,
    procesoAfectado: false,
    tiempoPerdido: 'SIN' as const,
    descripcion: 'Un bus adelanta por la izquierda y golpea el parachoque de la camioneta.',
    accionesInmediatas: '.- Se informa a la jefatura\n.- Se realiza declaración',
    preparaNombre: 'Jorge Osorio',
    preparaCargo: 'APR',
    preparaFecha: '23/9/2026',
    foto: null,
  };

  it('genera un PDF de una página aunque no haya foto', async () => {
    const bytes = await buildIncidentePdf(base);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('no revienta con caracteres que la fuente no dibuja (emoji del celular)', async () => {
    const bytes = await buildIncidentePdf({
      ...base,
      descripcion: 'Choque en la curva 🚧😬 con daño visible',
      accionesInmediatas: '.- Se avisa 👍',
    });
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
