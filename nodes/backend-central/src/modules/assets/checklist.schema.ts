import { z } from 'zod';
import type { ChecklistItemConfig, ChecklistItemType, ChecklistTemplateItem } from '@gmt-platform/contracts';

/**
 * Esquemas Zod del checklist tipado (Tanda 5). Fuente única de validación: el
 * `assets.service` normaliza + valida los ítems y las respuestas con estas
 * funciones ANTES de persistir. Los tipos canónicos viven en
 * `@gmt-platform/contracts`; aquí solo se aporta la validación en runtime.
 *
 * La BD NO se migra: `items`/`answers` siguen siendo Json. Los ítems legacy
 * (YES_NO/NUMBER/TEXT) se siguen leyendo: `parseTemplateItems` los normaliza al
 * union nuevo antes de validar.
 */

const idSchema = z.string().trim().min(1, 'El id del ítem es requerido');
const labelSchema = z.string().trim().min(1, 'La etiqueta del ítem es requerida');

/** BOOLEAN: pregunta Sí/No. `config` opcional (sin campos obligatorios). */
const booleanItemSchema = z.object({
  id: idSchema,
  label: labelSchema,
  type: z.literal('BOOLEAN'),
  required: z.boolean(),
  config: z
    .object({
      requireObs: z.boolean().optional(),
      obsItemId: z.string().optional(),
    })
    .optional(),
});

/** ENTERO: número entero. `config` admite min/max e `isOdometer`. */
const enteroItemSchema = z.object({
  id: idSchema,
  label: labelSchema,
  type: z.literal('ENTERO'),
  required: z.boolean(),
  config: z
    .object({
      isOdometer: z.boolean().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});

/** FECHA: fecha (ISO). `config` opcional. */
const fechaItemSchema = z.object({
  id: idSchema,
  label: labelSchema,
  type: z.literal('FECHA'),
  required: z.boolean(),
  config: z.object({}).optional(),
});

/** TEXTO: texto libre. Puede actuar como ítem companion de observación. */
const textoItemSchema = z.object({
  id: idSchema,
  label: labelSchema,
  type: z.literal('TEXTO'),
  required: z.boolean(),
  config: z.object({}).optional(),
});

/**
 * ESTADO: selección de una opción configurable (p. ej. Bueno/Regular/Malo).
 * `config.options` es requerido (al menos una opción, únicas y no vacías).
 * `failOptions` es opcional y debe ser subconjunto de `options`; si se omite,
 * `parseTemplateItems` lo completa con las opciones cuyo texto normalizado sea
 * `'malo'`. `requireObs`/`obsItemId` vinculan un ítem TEXTO companion.
 */
const estadoItemSchema = z.object({
  id: idSchema,
  label: labelSchema,
  type: z.literal('ESTADO'),
  required: z.boolean(),
  config: z.object({
    options: z
      .array(z.string().trim().min(1, 'Las opciones no pueden estar vacías'))
      .min(1, 'Debes definir al menos una opción')
      .refine(
        (opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length,
        'Las opciones deben ser únicas',
      ),
    failOptions: z.array(z.string().trim().min(1)).optional(),
    requireObs: z.boolean().optional(),
    obsItemId: z.string().optional(),
  }),
});

/** Union discriminado por `type` de un ítem de plantilla ya normalizado. */
export const templateItemSchema = z.discriminatedUnion('type', [
  booleanItemSchema,
  enteroItemSchema,
  fechaItemSchema,
  textoItemSchema,
  estadoItemSchema,
]);

/** Opciones cuyo texto normalizado es `'malo'` (default de `failOptions`). */
function defaultFailOptions(options: string[]): string[] {
  return options.filter((o) => o.trim().toLowerCase() === 'malo');
}

/**
 * Plantilla completa: array de ítems con validaciones cruzadas (ids únicos y,
 * cuando un ítem exige observación (`requireObs`) o declara `obsItemId`, que
 * `obsItemId` apunte a un ítem TEXTO existente; `failOptions` subconjunto de
 * `options`). El `.transform` completa el default de `failOptions` de cada ESTADO.
 */
export const templateSchema = z
  .array(templateItemSchema)
  .superRefine((items, ctx) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) {
        ctx.addIssue({ code: 'custom', message: `El id "${item.id}" está duplicado.` });
      }
      ids.add(item.id);
    }

    const byId = new Map(items.map((item) => [item.id, item] as const));
    for (const item of items) {
      // Validación cruzada de opciones/failOptions: exclusiva de ESTADO.
      if (item.type === 'ESTADO') {
        const { options, failOptions } = item.config;
        if (failOptions) {
          const optionSet = new Set(options.map((o) => o.toLowerCase()));
          for (const fail of failOptions) {
            if (!optionSet.has(fail.toLowerCase())) {
              ctx.addIssue({
                code: 'custom',
                message: `La opción de falla "${fail}" no está entre las opciones de "${item.label}".`,
              });
            }
          }
        }
      }

      // Validación cruzada requireObs → obsItemId → ítem TEXTO: aplica a CUALQUIER
      // ítem que declare `requireObs` u `obsItemId` (no solo ESTADO), para que un
      // BOOLEAN u otro tipo con observación companion también quede cubierto.
      const config: ChecklistItemConfig | undefined = item.config;
      const requireObs = config?.requireObs === true;
      const obsItemId = config?.obsItemId;
      if (requireObs || obsItemId) {
        if (requireObs && !obsItemId) {
          ctx.addIssue({
            code: 'custom',
            message: `El ítem "${item.label}" exige observación pero no define obsItemId.`,
          });
        } else if (obsItemId) {
          const target = byId.get(obsItemId);
          if (!target || target.type !== 'TEXTO') {
            ctx.addIssue({
              code: 'custom',
              message: `obsItemId "${obsItemId}" debe apuntar a un ítem TEXTO existente.`,
            });
          }
        }
      }
    }
  })
  .transform((items) =>
    items.map((item) =>
      item.type === 'ESTADO'
        ? {
            ...item,
            config: {
              ...item.config,
              failOptions: item.config.failOptions ?? defaultFailOptions(item.config.options),
            },
          }
        : item,
    ),
  );

/** Valor admitido en una respuesta de checklist. */
const answerValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Respuesta a un ítem: `{ itemId, label, value, comment? }`. */
export const answerSchema = z.object({
  itemId: z.string().trim().min(1, 'El itemId de la respuesta es requerido'),
  label: z.string(),
  value: answerValueSchema,
  comment: z.string().optional(),
});

/** Conjunto de respuestas de una ejecución de checklist. */
export const submitAnswersSchema = z.array(answerSchema);

/** Mapa de tipos legacy → union nuevo. Los tipos nuevos pasan sin cambios. */
const LEGACY_TYPE_MAP: Record<string, ChecklistItemType> = {
  YES_NO: 'BOOLEAN',
  NUMBER: 'ENTERO',
  TEXT: 'TEXTO',
};

/**
 * Normaliza un tipo de ítem legacy al union nuevo (YES_NO→BOOLEAN,
 * NUMBER→ENTERO, TEXT→TEXTO). Cualquier otro valor se devuelve intacto para que
 * Zod lo valide (o lo rechace si es desconocido).
 */
export function mapLegacyItemType(rawType: string): string {
  return LEGACY_TYPE_MAP[rawType] ?? rawType;
}

/**
 * Normaliza ítems legacy y valida la plantilla con Zod. Lanza `ZodError` si la
 * estructura es inválida; el servicio traduce ese error a `BadRequestException`.
 */
export function parseTemplateItems(raw: unknown): ChecklistTemplateItem[] {
  const normalized = Array.isArray(raw)
    ? raw.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          if (typeof record.type === 'string') {
            return { ...record, type: mapLegacyItemType(record.type) };
          }
        }
        return item;
      })
    : raw;

  return templateSchema.parse(normalized);
}

/**
 * ¿La respuesta `value` para `item` cuenta como falla?
 * - BOOLEAN: `false` o `'no'`.
 * - ESTADO: el valor coincide (case-insensitive) con alguna `failOptions`
 *   (default `['Malo']`).
 * - Sin ítem definido (plantilla vacía / respuesta legacy): un booleano `false`
 *   sigue contando como falla.
 * - Resto de tipos: nunca es falla.
 */
export function isFailure(
  item: ChecklistTemplateItem | undefined,
  value: string | number | boolean | null,
): boolean {
  if (item?.type === 'BOOLEAN') {
    return value === false || value === 'no';
  }
  if (item?.type === 'ESTADO') {
    const failOptions = item.config?.failOptions ?? ['Malo'];
    return failOptions.some((option) => option.toLowerCase() === String(value).toLowerCase());
  }
  if (item === undefined) {
    return value === false;
  }
  return false;
}

/**
 * Plantilla por defecto de camioneta (VEHICULO). Fuente tipada (reemplaza al
 * CSV histórico para el shape nuevo). Debe coincidir con el default del front.
 */
export const DEFAULT_VEHICLE_CHECKLIST: ChecklistTemplateItem[] = [
  {
    id: 'motor',
    label: 'Motor: nivel de aceite e inspección visual',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_motor',
    },
  },
  { id: 'obs_motor', label: 'Observación motor', type: 'TEXTO', required: false },
  {
    id: 'frenos',
    label: 'Frenos: nivel de líquido e inspección visual',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_frenos',
    },
  },
  { id: 'obs_frenos', label: 'Observación frenos', type: 'TEXTO', required: false },
  {
    id: 'neumaticos',
    label: 'Neumáticos: presión y estado general',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_neumaticos',
    },
  },
  { id: 'obs_neumaticos', label: 'Observación neumáticos', type: 'TEXTO', required: false },
  {
    id: 'luces',
    label: 'Luces: altas, bajas, intermitentes y freno',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_luces',
    },
  },
  { id: 'obs_luces', label: 'Observación luces', type: 'TEXTO', required: false },
  {
    id: 'kilometraje',
    label: 'Kilometraje actual (odómetro)',
    type: 'ENTERO',
    required: true,
    config: { isOdometer: true },
  },
  { id: 'observaciones', label: 'Observaciones generales', type: 'TEXTO', required: false },
];
