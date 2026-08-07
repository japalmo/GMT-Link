import { describe, expect, it, vi } from 'vitest';

import { SheetsImportService } from '../../../src/modules/assets/sheets-import.service';
import type { SheetsClientService } from '../../../src/modules/assets/sheets-client.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Lo que importa acá es lo que el orquestador agrega sobre el mapeo: que no
 * duplique al re-correr, que no invente vehículos ni personas, y que lo que no
 * pudo importar salga reportado en vez de desaparecer.
 */

const CABECERA = [
  'idForm',
  'datetime',
  'nombreTrab',
  'idVeh',
  'patente',
  'kilometraje',
  'sistemaFrenos',
];

/** Fila sin idVeh: cae al respaldo de la patente escrita. */
function fila(id: string, patente: string, fecha = '14/05/2025 9:34:27'): string[] {
  return [id, fecha, 'yerko jara', '', patente, '103699', 'Bueno'];
}

/** Fila con idVeh, que es la clave autoritativa. */
function filaConId(id: string, idVeh: string, patenteEscrita: string): string[] {
  return [id, '14/05/2025 9:34:27', 'yerko jara', idVeh, patenteEscrita, '103699', 'Bueno'];
}

interface Opciones {
  filas?: string[][];
  /** Filas del maestro VEHICULOS: [idVeh, patente]. */
  maestro?: string[][];
  vehiculos?: Array<{ id: string; code: string; identifier: string; templateId: string | null }>;
  yaImportados?: string[];
  configurado?: boolean;
}

function armar(o: Opciones = {}) {
  const leerRango = vi.fn((rango: string) => {
    // El servicio lee dos pestañas: los checklists y el maestro de vehículos.
    if (rango.startsWith('VEHICULOS')) {
      return Promise.resolve([
        ['idVeh', 'patente'],
        ...(o.maestro ?? [['V011', 'SKRF88']]),
      ]);
    }
    return Promise.resolve([CABECERA, ...(o.filas ?? [])]);
  });
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

  let serie = vehiculos.length;
  const findFirst = vi.fn(() =>
    Promise.resolve({ code: `GMT-VH-${String(serie).padStart(4, '0')}` }),
  );
  const crearAsset = vi.fn((args: { data: { code: string } }) => {
    serie += 1;
    return Promise.resolve({
      id: `nuevo-${args.data.code}`,
      code: args.data.code,
      checklistTemplate: { id: `tpl-${args.data.code}` },
    });
  });

  const prisma = {
    asset: { findMany: findManyAssets, findFirst, create: crearAsset },
    checklistSubmission: { findMany: findManySubs, createMany },
  } as unknown as PrismaService;

  return {
    servicio: new SheetsImportService(prisma, sheets),
    leerRango,
    createMany,
    crearAsset,
  };
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
  it('CREA el vehículo cuya patente no existe, y sus checklists entran', async () => {
    // Decisión del dueño: que entren igual y después se ordena. Antes se
    // reportaban y quedaban fuera.
    const { servicio, createMany, crearAsset } = armar({
      filas: [fila('F0001', 'PZXP25'), fila('F0002', 'PZXP25'), fila('F0003', 'SKRF88')],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(3);
    expect(r.sinVehiculo).toEqual([]);
    // El código sigue la serie: había un GMT-VH-0001, así que el nuevo es 0002.
    expect(r.vehiculosCreados).toEqual([
      { patente: 'PZXP25', code: 'GMT-VH-0002', filas: 2 },
    ]);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(3);
    expect(crearAsset).toHaveBeenCalledTimes(1);
  });

  it('crea UN vehículo por patente, no uno por checklist', async () => {
    const { servicio, crearAsset } = armar({
      filas: [fila('F0001', 'PZXP25'), fila('F0002', 'PZXP25'), fila('F0003', 'PZXP25')],
    });
    await servicio.importar();
    expect(crearAsset).toHaveBeenCalledTimes(1);
  });

  it('el vehículo creado queda MARCADO y con su plantilla', async () => {
    // Algunas de estas patentes son casi con seguridad tipeos: hay que poder
    // reconocerlos después para fusionarlos o darlos de baja. Y sin plantilla
    // sus checklists no tendrían de qué colgar.
    const { servicio, crearAsset } = armar({ filas: [fila('F0001', 'PZXP25')] });
    await servicio.importar();

    const datos = crearAsset.mock.calls[0]![0].data as {
      identifier: string;
      identifierType: string;
      type: string;
      status: string;
      description: string;
      checklistTemplate: { create: { status: string; items: unknown[] } };
    };
    expect(datos.identifier).toBe('PZXP25');
    expect(datos.identifierType).toBe('PATENTE');
    expect(datos.type).toBe('VEHICULO');
    expect(datos.description).toContain('Creado automáticamente');
    // Nace NO disponible: nadie confirmó todavía que sea un vehículo real.
    expect(datos.status).toBe('NO_DISPONIBLE');
    expect(datos.checklistTemplate.create.status).toBe('APROBADO');
    expect(datos.checklistTemplate.create.items.length).toBeGreaterThan(60);
  });

  it('NO crea nada cuando la patente ya existe', async () => {
    const { servicio, crearAsset } = armar({ filas: [fila('F0001', 'SKRF88')] });
    const r = await servicio.importar();
    expect(crearAsset).not.toHaveBeenCalled();
    expect(r.vehiculosCreados).toEqual([]);
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
      /Sin idForm.*Sin idVeh.*Fecha no interpretable/s,
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

describe('SheetsImportService: códigos de los vehículos creados', () => {
  it('no reusa el código de un vehículo existente', async () => {
    // Reusarlo reventaría contra la unicidad del código y tumbaría la
    // importación entera por una patente desconocida.
    const { servicio, crearAsset } = armar({
      filas: [fila('F0001', 'PZXP25'), fila('F0002', 'TBFG42')],
      vehiculos: [
        { id: 'a-1', code: 'GMT-VH-0016', identifier: 'SKRF88', templateId: 'tpl-1' },
        { id: 'a-2', code: 'GMT-VH-0017', identifier: 'TRBF43', templateId: 'tpl-2' },
      ],
    });
    await servicio.importar();

    const codigos = crearAsset.mock.calls.map(
      (c) => (c[0] as { data: { code: string } }).data.code,
    );
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos).not.toContain('GMT-VH-0016');
    expect(codigos).not.toContain('GMT-VH-0017');
  });
});

describe('SheetsImportService: el vehículo se identifica por idVeh', () => {
  it('cuando la patente escrita está CRUZADA, manda el idVeh', async () => {
    // La importación anterior ya había detectado que la columna `patente` de
    // RESPUESTAS trae cientos de filas con la placa de otro vehículo. Confiar en
    // ella le sumaría kilómetros a una camioneta que nunca hizo ese viaje.
    const { servicio, createMany, crearAsset } = armar({
      filas: [filaConId('F0001', 'V011', 'TRBF43')],
      maestro: [['V011', 'SKRF88']],
      vehiculos: [{ id: 'a-1', code: 'GMT-VH-0012', identifier: 'SKRF88', templateId: 'tpl-1' }],
    });
    const r = await servicio.importar();

    expect(r.importadas).toBe(1);
    // Fue al vehículo del maestro, no al de la patente escrita.
    expect((createMany.mock.calls[0]![0].data[0] as { assetId: string }).assetId).toBe('a-1');
    expect(crearAsset).not.toHaveBeenCalled();
  });

  it('sin idVeh cae al respaldo de la patente escrita', async () => {
    const { servicio, createMany } = armar({ filas: [fila('F0001', 'SKRF88')] });
    const r = await servicio.importar();
    expect(r.importadas).toBe(1);
    expect((createMany.mock.calls[0]![0].data[0] as { assetId: string }).assetId).toBe('a-1');
  });

  it('descarta la fila sin idVeh y con patente irreconocible', async () => {
    const { servicio } = armar({ filas: [fila('F0001', 'Prueba')] });
    const r = await servicio.importar();
    expect(r.importadas).toBe(0);
    expect(r.descartadas[0]!.motivo).toContain('Sin idVeh');
  });

  it('un idVeh que no está en el maestro cae a la patente escrita', async () => {
    const { servicio, createMany } = armar({
      filas: [filaConId('F0001', 'V999', 'SKRF88')],
      maestro: [['V011', 'SKRF88']],
    });
    expect((await servicio.importar()).importadas).toBe(1);
    expect((createMany.mock.calls[0]![0].data[0] as { assetId: string }).assetId).toBe('a-1');
  });
});
