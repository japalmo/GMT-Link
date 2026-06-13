/**
 * Bootstrap idempotente de OpenFGA (§6-0.3).
 * 1. Busca el store "gtm-link" (o lo crea).
 * 2. Transforma el DSL fga/model.fga (§4.3) a JSON y escribe el authorization model.
 * 3. Persiste FGA_STORE_ID y FGA_MODEL_ID en el .env de la raíz del monorepo.
 * Ejecutar desde apps/api: `pnpm run fga:bootstrap`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import { transformer } from '@openfga/syntax-transformer';

const ENV_PATH = path.resolve(process.cwd(), '../../.env');
const MODEL_PATH = path.resolve(process.cwd(), 'fga/model.fga');
const STORE_NAME = 'gtm-link';

config({ path: ENV_PATH });

async function main(): Promise<void> {
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';

  // 1. Store: buscar por nombre o crear.
  const rootClient = new OpenFgaClient({ apiUrl });
  const { stores } = await rootClient.listStores();
  const existing = stores.find((store) => store.name === STORE_NAME);
  const storeId = existing?.id ?? (await rootClient.createStore({ name: STORE_NAME })).id;
  console.log(`Store "${STORE_NAME}": ${storeId} ${existing ? '(existente)' : '(creado)'}`);

  // 2. DSL → JSON → authorization model.
  const dsl = readFileSync(MODEL_PATH, 'utf8');
  const model = transformer.transformDSLToJSONObject(dsl);
  const client = new OpenFgaClient({ apiUrl, storeId });
  const { authorization_model_id: modelId } = await client.writeAuthorizationModel({
    schema_version: model.schema_version,
    type_definitions: model.type_definitions,
    conditions: model.conditions,
  });
  console.log(`Authorization model: ${modelId}`);

  // 3. Persistir IDs en el .env raíz.
  updateEnv({ FGA_STORE_ID: storeId, FGA_MODEL_ID: modelId });
  console.log(`IDs escritos en ${ENV_PATH}`);
}

/** Reemplaza (o agrega) líneas KEY="value" en el .env conservando el resto. */
function updateEnv(vars: Record<string, string>): void {
  let content = readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV_PATH, content);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
