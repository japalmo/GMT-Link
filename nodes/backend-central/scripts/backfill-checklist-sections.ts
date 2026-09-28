import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  CHECKLIST_VEHICULO_GMT,
  SECCIONES_CHECKLIST_VEHICULO,
} from '@gmt-platform/contracts';

// Misma convención que el resto de los scripts: el .env vive en la raíz del
// monorepo. Para correrlo contra producción se exporta `DATABASE_URL` antes,
// que tiene prioridad sobre el archivo.
config({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * Le devuelve las secciones a las plantillas de checklist de vehículos que ya
 * viven en producción.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * El formulario de llenado (`ChecklistFillBody`) pagina por
 * `template.sections`: una página por sección, con Anterior/Siguiente. Pero las
 * plantillas se sembraron SIN secciones y sin el campo `section` en cada ítem,
 * así que el conductor ve los 73 ítems en una sola página interminable. El
 * motor de pasos funciona; le faltan los datos.
 *
 * La definición canónica (`CHECKLIST_VEHICULO_GMT`) sí trae la sección de cada
 * ítem y comparte los ids con las plantillas desplegadas, así que sirve de mapa.
 *
 * ── Garantías ──────────────────────────────────────────────────────────────
 *
 * - IDEMPOTENTE: correrlo dos veces deja el mismo resultado.
 * - Solo agrega el campo `section` a cada ítem. Antes de escribir se comprueba
 *   que no cambió nada más: ni la cantidad de ítems, ni sus ids, ni etiquetas,
 *   opciones u orden. Si algo más cambió, aborta sin tocar la base.
 * - Un ítem que no está en la canónica se deja INTACTO: queda sin `section` y
 *   cae en la página "General" que el front ya contempla. Perder un ítem de un
 *   documento que se firma sería mucho peor que mostrarlo en la tabla de al lado.
 * - NO toca los envíos históricos.
 *
 * Uso:
 *   pnpm tsx scripts/backfill-checklist-sections.ts            # simulación
 *   pnpm tsx scripts/backfill-checklist-sections.ts --apply    # escribe
 */

const prisma = new PrismaClient();

/** Sección canónica de cada id de ítem. */
const SECCION_DE = new Map(
  CHECKLIST_VEHICULO_GMT.filter((i) => i.section).map((i) => [i.id, i.section as string]),
);

/**
 * Ítems que viven en las plantillas de producción pero NO están en la
 * definición canónica. Se les asigna sección a mano porque la alternativa es
 * peor: sin sección caen en una página "General" al final del formulario, y
 * quedaría un paso entero con un solo campo suelto.
 *
 * - `docsFisicos`: pregunta agregada después de sembrar la plantilla. Es
 *   legítima y pregunta por los documentos del vehículo, así que va con ellos.
 * - `firma`: campo INTERNO donde el importador de la planilla guardaba la URL
 *   de la firma. No es una pregunta y hoy se dibuja como un campo de texto que
 *   le pide "Firma (URL)" al conductor —un bug que ya existe en producción—.
 *   Acá solo se lo manda al cierre para no darle una página propia; esconderlo
 *   o sacarlo es una decisión aparte.
 */
const SECCION_EXTRA: ReadonlyMap<string, string> = new Map([
  ['docsFisicos', 'datos-vehiculo'],
  ['firma', 'cierre'],
]);

function seccionDe(id: string): string | undefined {
  return SECCION_DE.get(id) ?? SECCION_EXTRA.get(id);
}

/**
 * Mínimo de ítems reconocidos para considerar que una plantilla es del
 * checklist de vehículos. Las reales traen 73; con este piso quedan fuera las
 * plantillas de juguete (el activo "Prueba" tiene 6 ítems) sin depender del
 * nombre del activo, que lo escribe una persona y no es confiable.
 */
const MINIMO_ITEMS_VEHICULO = 50;

/** Un ítem tal como está guardado en el Json de la plantilla. */
type ItemJson = Record<string, unknown>;

function esObjeto(v: unknown): v is ItemJson {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Comprueba que `nuevos` sea `viejos` con el único agregado del campo
 * `section`. Devuelve el motivo del rechazo, o `null` si está todo bien.
 *
 * Es la red de seguridad del script: escribe sobre plantillas con miles de
 * checklists colgando, y una transformación mal escrita podría reordenar u
 * omitir ítems sin que se note hasta que alguien imprima un PDF.
 */
function diferenciaSoloEnSeccion(viejos: unknown[], nuevos: unknown[]): string | null {
  if (viejos.length !== nuevos.length) {
    return `cambió la cantidad de ítems (${viejos.length} → ${nuevos.length})`;
  }
  for (let i = 0; i < viejos.length; i += 1) {
    const viejo = viejos[i];
    const nuevo = nuevos[i];
    if (!esObjeto(viejo) || !esObjeto(nuevo)) {
      if (JSON.stringify(viejo) !== JSON.stringify(nuevo)) return `cambió el ítem ${i}`;
      continue;
    }
    // Se comparan ignorando `section`, que es justamente lo que agregamos.
    const sinSeccion = (o: ItemJson): string => {
      const copia = { ...o };
      delete copia.section;
      // Claves ordenadas: sin esto, dos objetos iguales con distinto orden de
      // propiedades se verían como diferentes.
      return JSON.stringify(copia, Object.keys(copia).sort());
    };
    if (sinSeccion(viejo) !== sinSeccion(nuevo)) {
      return `cambió algo más que la sección en el ítem ${i} (id=${String(viejo.id)})`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--apply');

  const plantillas = await prisma.checklistTemplate.findMany({
    select: { id: true, name: true, items: true, sections: true, assetId: true },
  });

  console.log('plantillas en total: %d\n', plantillas.length);

  let candidatas = 0;
  let escritas = 0;
  const problemas: string[] = [];

  for (const plantilla of plantillas) {
    const items: unknown[] = Array.isArray(plantilla.items) ? plantilla.items : [];
    if (items.length === 0) continue;

    // ¿Es una plantilla de vehículo? Se decide por los IDS de sus ítems.
    const reconocidos = items.filter((i) => esObjeto(i) && seccionDe(String(i.id))).length;
    if (reconocidos < MINIMO_ITEMS_VEHICULO) continue;

    candidatas += 1;

    const nuevos = items.map((item) => {
      if (!esObjeto(item)) return item;
      const seccion = seccionDe(String(item.id));
      return seccion ? { ...item, section: seccion } : item;
    });

    const motivo = diferenciaSoloEnSeccion(items, nuevos);
    if (motivo) {
      problemas.push(`${plantilla.id}: ${motivo}`);
      continue;
    }

    const yaTenia = Array.isArray(plantilla.sections) ? plantilla.sections.length : 0;
    const sinReconocer = items.length - reconocidos;

    // Reparto por sección: comprobar que "no cambió nada más" no demuestra que
    // la asignación haya funcionado. Esto sí.
    const reparto = new Map<string, number>();
    for (const item of nuevos) {
      if (!esObjeto(item)) continue;
      const clave = typeof item.section === 'string' ? item.section : '(sin sección)';
      reparto.set(clave, (reparto.get(clave) ?? 0) + 1);
    }
    const resumen = [...reparto.entries()].map(([s, n]) => `${s}=${n}`).join(' ');

    // Node no entiende el relleno estilo printf (`%-4s`), así que se arma con
    // padEnd: con `%-4s` los argumentos se corren y la salida miente.
    console.log(
      `${plantilla.id}  ítems=${String(items.length).padEnd(3)} ` +
        `reconocidos=${String(reconocidos).padEnd(3)} ` +
        `sin reconocer=${String(sinReconocer).padEnd(2)} ` +
        `secciones previas=${yaTenia}\n    ${resumen}`,
    );

    if (aplicar) {
      await prisma.checklistTemplate.update({
        where: { id: plantilla.id },
        data: { items: nuevos, sections: SECCIONES_CHECKLIST_VEHICULO },
      });
      escritas += 1;
    }
  }

  if (problemas.length > 0) {
    console.error('\nABORTADO. Estas plantillas cambiarían algo más que la sección:');
    for (const p of problemas) console.error('  ' + p);
    process.exitCode = 1;
    return;
  }

  console.log(
    '\nplantillas de vehículo: %d   %s: %d',
    candidatas,
    aplicar ? 'actualizadas' : 'se actualizarían',
    aplicar ? escritas : candidatas,
  );
  if (!aplicar) console.log('Simulación. Para escribir de verdad: --apply');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
