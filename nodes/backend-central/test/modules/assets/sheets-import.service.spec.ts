import { describe, expect, it, vi } from 'vitest';

import { SheetsImportService } from '../../../src/modules/assets/sheets-import.service';
import type { SheetsClientService } from '../../../src/modules/assets/sheets-client.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Lo que importa acá es lo que el orquestador agrega sobre el mapeo: que no
 * duplique al re-correr, que no invente vehículos ni personas, y que lo que no
 * pudo importar salga reportado en vez de desaparecer.
 */

const CABECERA = ['idForm', 'datetime', 'nombreTrab', 'patente', 'kilometraje', 'sistemaFrenos'];

function fila(id: string, patente: string, fecha = '14/05/2025 9:34:27'): string[] {
  return [id, fecha, 'yerko jara', patente, '103699', 'Bueno'];
}

interface Opciones {
  filas?: string[][];
  vehiculos?: Array<{ id: string; code: string; identifier: string; templateId: string | null }>;
  yaImportados?: string[];
  configurado?: boolean;
}

function armar(o: Opciones = {}) {
  const leerRango = vi.fn().mockResolvedValue([CABECERA, ...(o.filas ?? [])]);
  const sheets = {
    estaConfigurado: () => o.configurado ?? true,
    leerRango,
  } as unknown as SheetsClientService;

  const vehiculos = o.vehiculos ?? [
    { id: 'a-1', code: 'GMT-VH-0012', identifier: 'SKRF88', templateId: 'tpl-1' },
  ];
  const findManyAssets = vi.fn().mockResolvedValue(
    vehiculos.map((v) => ({
      id: v.id,
      code: v.code,
      identifier: v.identifier,
      checklistTemplate: v.templateId ? { id: v.templateId } : null,
    })),
  );
  const findManySubs = vi
    .fn()
    .mockResolvedValue((o.yaImportados ?? []).map((externalId) => ({ externalId })));
  const createMany = vi.fn((args: { data: unknown[] }) =>
    Promise.resolve({ count: args.data.length }),
  );

  const prisma = {
    asset: { findMany: findManyAssets },
    checklistSubmission: { findMany: findManySubs, createMany },
  } as unknown as PrismaService;

  return { servicio: new SheetsImportService(prisma, sheets), leerRango, createMany };
}

describe('SheetsImportService: configuración', () => {
  it('sin credencial no revienta ni lee: avisa y no hace nada', async () => {
    // La API tiene que arrancar igual en un entorno sin la planilla configurada.
    const { servicio, leerRango } = armar({ configurado: false });
    const r = await servicio.importar();

    expect(r.configurado).toBe(false);
    expect(r.importadas).toBe(0);
    expect(leerRango).not.toHaveBeenCalled();
  });

  it('una planilla vacía no revienta', async () => {
    const { servicio } = armar({ filas: [] });
    const r = await servicio.importar();
    expect(r.leidas).toBe(0);
    expect(r.importadas).toBe(0);
  });
});

describe('SheetsImportService: idempotencia', () => {
  it('salta los idForm repetidos DENTRO de la planilla', async () => {
    // La planilla real trae 11 repetidos. Sin esto el índice único los
    // rechazaría de a uno y la importación fallaría a mitad de camino.
    const { servicio, createMany } = armar({
      filas: [fila('F0001', 'SKRF88'), fila('F0001', 'SKRF88'), fila('F0002', 'SKRF88')],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(2);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(2);
    const repetido = r.descartadas.find((d) => d.motivo.includes('repetido'));
    expect(repetido?.externalId).toBe('F0001');
  });

  it('no reimporta lo que ya entró en una pasada anterior', async () => {
    const { servicio, createMany } = armar({
      filas: [fila('F0001', 'SKRF88'), fila('F0002', 'SKRF88')],
      yaImportados: ['F0001'],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(1);
    expect(r.yaExistian).toBe(1);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(1);
  });

  it('correr dos veces seguidas no agrega nada la segunda vez', async () => {
    const filas = [fila('F0001', 'SKRF88'), fila('F0002', 'SKRF88')];
    expect((await armar({ filas }).servicio.importar()).importadas).toBe(2);
    // Segunda pasada: la base ya los conoce.
    const segunda = await armar({ filas, yaImportados: ['F0001', 'F0002'] }).servicio.importar();
    expect(segunda.importadas).toBe(0);
    expect(segunda.yaExistian).toBe(2);
  });

  it('pide skipDuplicates como red ante dos importaciones simultáneas', async () => {
    const { servicio, createMany } = armar({ filas: [fila('F0001', 'SKRF88')] });
    await servicio.importar();
    expect(createMany.mock.calls[0]![0].skipDuplicates).toBe(true);
  });
});

describe('SheetsImportService: qué se guarda', () => {
  it('guarda SIN usuario y con el conductor como texto informativo', async () => {
    // Adivinar la persona cruzando el nombre escrito a mano sería inventar
    // autoría en un registro que se firma (decisión del dueño).
    const { servicio, createMany } = armar({ filas: [fila('F0001', 'SKRF88')] });
    await servicio.importar();

    const guardado = createMany.mock.calls[0]![0].data[0] as {
      userId: null;
      externalAuthor: string;
      externalSource: string;
      externalId: string;
    };
    expect(guardado.userId).toBeNull();
    expect(guardado.externalAuthor).toBe('Yerko Jara');
    expect(guardado.externalSource).toBe('SHEETS');
    expect(guardado.externalId).toBe('F0001');
  });

  it('usa la fecha REAL del checklist, no la de la importación', async () => {
    // Con la fecha de importación los 2.000 registros históricos aterrizarían
    // todos hoy y el gráfico de uso quedaría inservible.
    const { servicio, createMany } = armar({
      filas: [fila('F0001', 'SKRF88', '03/02/2025 14:05:00')],
    });
    await servicio.importar();

    const { createdAt } = createMany.mock.calls[0]![0].data[0] as { createdAt: Date };
    expect(createdAt.getFullYear()).toBe(2025);
    expect(createdAt.getMonth()).toBe(1);
    expect(createdAt.getDate()).toBe(3);
  });

  it('cuelga el checklist del vehículo y de su plantilla', async () => {
    const { servicio, createMany } = armar({ filas: [fila('F0001', 'SKRF88')] });
    await servicio.importar();
    const g = createMany.mock.calls[0]![0].data[0] as { assetId: string; templateId: string };
    expect(g.assetId).toBe('a-1');
    expect(g.templateId).toBe('tpl-1');
  });

  it('cruza la patente NORMALIZADA en los dos lados', async () => {
    // En la planilla viene "SK RF 88" y en GMT Link puede estar con guion.
    const { servicio, createMany } = armar({
      filas: [fila('F0001', 'SK RF 88')],
      vehiculos: [{ id: 'a-1', code: 'GMT-VH-0012', identifier: 'SKRF-88', templateId: 'tpl-1' }],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(1);
    expect((createMany.mock.calls[0]![0].data[0] as { assetId: string }).assetId).toBe('a-1');
  });
});

describe('SheetsImportService: lo que no puede importar lo REPORTA', () => {
  it('reporta la patente que no existe como vehículo, con su conteo', async () => {
    // No se inventa el vehículo: se reporta para que una persona decida.
    const { servicio, createMany } = armar({
      filas: [fila('F0001', 'PZXP25'), fila('F0002', 'PZXP25'), fila('F0003', 'SKRF88')],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(1);
    expect(r.sinVehiculo).toEqual([{ patente: 'PZXP25', filas: 2 }]);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(1);
  });

  it('reporta el vehículo sin plantilla en vez de crearle una', async () => {
    // Crear y aprobar una plantilla tiene su propio flujo de revisión; no puede
    // ocurrir como efecto colateral de una importación.
    const { servicio, createMany } = armar({
      filas: [fila('F0001', 'SKRF88')],
      vehiculos: [{ id: 'a-1', code: 'GMT-VH-0012', identifier: 'SKRF88', templateId: null }],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(0);
    expect(r.sinPlantilla).toEqual([{ patente: 'SKRF88', code: 'GMT-VH-0012', filas: 1 }]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('reporta las filas que el mapeo descartó, con su motivo', async () => {
    const { servicio } = armar({
      filas: [
        ['', '14/05/2025 9:34:27', 'x', 'SKRF88', '1', 'Bueno'], // sin idForm
        fila('F0002', 'Prueba'), // patente no reconocible
        fila('F0003', 'SKRF88', 'ayer'), // fecha ilegible
        fila('F0004', 'SKRF88'), // sana
      ],
    });
    const r = await servicio.importar();

    expect(r.leidas).toBe(4);
    expect(r.importadas).toBe(1);
    expect(r.descartadas.map((d) => d.motivo).join(' | ')).toMatch(
      /Sin idForm.*Patente no reconocible.*Fecha no interpretable/s,
    );
  });

  it('un lote con problemas no impide importar el resto', async () => {
    const { servicio } = armar({
      filas: [fila('F0001', 'NOEXISTE99'), fila('F0002', 'SKRF88'), fila('F0003', 'SKRF88')],
    });
    const r = await servicio.importar();
    expect(r.importadas).toBe(2);
  });
});

describe('SheetsImportService: dirección', () => {
  it('el cliente de Sheets no expone ninguna forma de ESCRIBIR', async () => {
    // GMT Link es el sistema principal: la planilla se lee y nunca se actualiza
    // (decisión del dueño). Se fija estructuralmente para que agregar una
    // escritura sea una decisión consciente y no un descuido.
    const { SheetsClientService: Cliente } = await import(
      '../../../src/modules/assets/sheets-client.service'
    );
    const metodos = Object.getOwnPropertyNames(Cliente.prototype);
    expect(metodos.filter((m) => /escrib|write|update|append|set/i.test(m))).toEqual([]);
    expect(metodos).toContain('leerRango');
  });
});
