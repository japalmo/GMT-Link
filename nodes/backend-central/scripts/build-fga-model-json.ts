/**
 * Transforma `fga/model.fga` (DSL) a `fga/model.json`.
 *
 * Por qué existe: el transformador de DSL es dependencia de DESARROLLO y no
 * viaja en la imagen de producción, pero el modelo hay que publicarlo desde
 * DENTRO de la API, que es el único proceso que alcanza a OpenFGA (el servicio
 * no tiene dominio público). Se deja el JSON versionado y la API solo necesita
 * el SDK, que sí es dependencia de runtime.
 *
 * Correrlo cada vez que se toque `model.fga`. Hay una prueba que falla si el
 * JSON versionado se queda atrás del DSL.
 *
 * Uso: pnpm exec tsx scripts/build-fga-model-json.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { transformer } from '@openfga/syntax-transformer';

const DSL = path.resolve(process.cwd(), 'fga/model.fga');
const JSON_PATH = path.resolve(process.cwd(), 'fga/model.json');

const modelo = transformer.transformDSLToJSONObject(readFileSync(DSL, 'utf8'));
const salida = {
  schema_version: modelo.schema_version,
  type_definitions: modelo.type_definitions,
  conditions: modelo.conditions,
};
writeFileSync(JSON_PATH, `${JSON.stringify(salida, null, 2)}\n`, 'utf8');

const org = modelo.type_definitions.find((t) => t.type === 'organization');
console.log(`tipos: ${modelo.type_definitions.length}`);
console.log(`relaciones de organization: ${Object.keys(org?.relations ?? {}).join(', ')}`);
console.log(`escrito: ${JSON_PATH}`);
