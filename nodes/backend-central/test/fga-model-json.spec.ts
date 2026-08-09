import { readFileSync } from 'node:fs';
import path from 'node:path';

import { transformer } from '@openfga/syntax-transformer';
import { describe, expect, it } from 'vitest';

/**
 * `fga/model.json` es el modelo que la API publica en OpenFGA al arrancar. Se
 * genera desde `fga/model.fga` con `scripts/build-fga-model-json.ts`, y existe
 * porque el transformador de DSL es dependencia de desarrollo y no viaja en la
 * imagen de producción.
 *
 * La trampa obvia es tocar el DSL y olvidar regenerar el JSON: la relación
 * nueva quedaría en el repositorio y nunca en producción, que es exactamente el
 * error que hizo fallar el rol de admin de vehículos con
 * "relation 'organization#can_manage_fleet' not found".
 */
const RAIZ = path.resolve(__dirname, '..');

function leer(archivo: string): string {
  return readFileSync(path.join(RAIZ, 'fga', archivo), 'utf8');
}

describe('modelo FGA versionado', () => {
  it('el JSON está al día con el DSL', () => {
    const esperado = transformer.transformDSLToJSONObject(leer('model.fga'));
    const actual = JSON.parse(leer('model.json')) as { type_definitions: unknown[] };

    expect(
      actual.type_definitions,
      'fga/model.json quedó atrás: corre `pnpm exec tsx scripts/build-fga-model-json.ts`',
    ).toEqual(esperado.type_definitions);
  });

  it('trae la relación del admin de flota sobre la organización', () => {
    // Producción falló justamente por no tenerla publicada.
    const modelo = JSON.parse(leer('model.json')) as {
      type_definitions: Array<{ type: string; relations?: Record<string, unknown> }>;
    };
    const org = modelo.type_definitions.find((t) => t.type === 'organization');
    expect(Object.keys(org?.relations ?? {})).toContain('can_manage_fleet');
  });
});
