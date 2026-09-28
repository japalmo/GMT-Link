import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

/**
 * Convierte el ítem `firma` de las plantillas vivas de TEXTO a FIRMA.
 *
 * ── Qué arregla ────────────────────────────────────────────────────────────
 *
 * Ese ítem lo dejó el importador de la planilla de AppScript para guardar la
 * URL de la firma. Como quedó declarado TEXTO, el formulario lo dibuja como un
 * campo de texto con la etiqueta "Firma (URL)": hoy, en producción, al
 * conductor le aparece un recuadro pidiéndole que escriba una dirección web.
 * Nadie va a escribir eso.
 *
 * Declarado FIRMA, el formulario muestra el lienzo para firmar con el dedo y el
 * PDF dibuja el trazo sobre la línea de firma.
 *
 * ── Qué NO toca ────────────────────────────────────────────────────────────
 *
 * Las respuestas ya registradas. Los 1.927 checklists importados siguen
 * guardando su URL de Drive, y el PDF dice que la firma quedó en la planilla de
 * origen en vez de afirmar que no se firmó.
 *
 * IDEMPOTENTE: si el ítem ya es FIRMA, no hace nada.
 *
 * ── ORDEN OBLIGATORIO ──────────────────────────────────────────────────────
 *
 * Este script se corre DESPUÉS de desplegar la API que conoce el tipo FIRMA.
 *
 * El esquema Zod valida los ítems con un union discriminado por `type`, y
 * `readTemplateItems` atrapa el error de validación devolviendo `[]`. O sea:
 * una API que no conoce FIRMA no da error — entrega la plantilla VACÍA, y el
 * conductor ve "no hay preguntas configuradas". El formulario queda inservible
 * sin que nada se caiga ni aparezca en los registros.
 *
 * Pasó de verdad al escribir esto: se aplicó antes de desplegar y las 16
 * plantillas quedaron vacías en producción. De ahí el `--revert`.
 *
 * Uso:
 *   pnpm tsx scripts/migrate-checklist-firma.ts            # simulación
 *   pnpm tsx scripts/migrate-checklist-firma.ts --apply    # escribe
 *   pnpm tsx scripts/migrate-checklist-firma.ts --revert --apply   # deshace
 */

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

/** Id del ítem, tal como lo sembró el importador. */
const ID_FIRMA = 'firma';

/** Etiqueta nueva: la vieja decía "Firma (URL)", que ya no describe nada. */
const ETIQUETA = 'Firma del conductor';

/** Etiqueta original, para poder deshacer. */
const ETIQUETA_VIEJA = 'Firma (URL)';

type ItemJson = Record<string, unknown>;

function esObjeto(v: unknown): v is ItemJson {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--apply');
  const revertir = process.argv.includes('--revert');
  const destino = revertir ? 'TEXTO' : 'FIRMA';

  const plantillas = await prisma.checklistTemplate.findMany({
    select: { id: true, items: true },
  });

  let convertidas = 0;
  let yaEstaban = 0;

  for (const plantilla of plantillas) {
    const items: unknown[] = Array.isArray(plantilla.items) ? plantilla.items : [];
    const indice = items.findIndex((i) => esObjeto(i) && i.id === ID_FIRMA);
    if (indice === -1) continue;

    const actual = items[indice] as ItemJson;
    if (actual.type === destino) {
      yaEstaban += 1;
      continue;
    }

    const nuevos = [...items];
    nuevos[indice] = {
      ...actual,
      type: destino,
      label: revertir ? ETIQUETA_VIEJA : ETIQUETA,
      // Obligatoria NO: hay 21 plantillas vivas y miles de checklists hechos
      // sin firma. Exigirla de golpe bloquearía el formulario en faena.
      required: false,
      // `config` vacío: FIRMA no lleva configuración y el esquema Zod solo
      // admite un objeto vacío.
      config: {},
    };

    console.log(
      `${plantilla.id}  ítem ${indice}: ${String(actual.type)} "${String(actual.label)}" → ${destino}`,
    );

    if (aplicar) {
      await prisma.checklistTemplate.update({
        where: { id: plantilla.id },
        data: { items: nuevos },
      });
    }
    convertidas += 1;
  }

  console.log(
    '\nplantillas %s a %s: %d   ya estaban: %d',
    aplicar ? 'convertidas' : 'que se convertirían',
    destino,
    convertidas,
    yaEstaban,
  );
  if (!aplicar) console.log('Simulación. Para escribir de verdad: --apply');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
