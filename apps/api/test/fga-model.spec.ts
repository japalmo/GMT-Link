/**
 * Tests del modelo OpenFGA §4.3 contra un servidor REAL (http://localhost:8080).
 * Crea un store efímero propio ("gtm-link-test"), carga el modelo desde fga/model.fga,
 * escribe tuplas estructurales + asignaciones de rol y verifica las derivaciones y el
 * aislamiento entre clientes (§3.4). El store se borra en afterAll (re-ejecutable).
 *
 * + Tests unitarios del mapeo de FgaService.syncMembershipToFGA con un cliente fake.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OpenFgaClient } from '@openfga/sdk';
import { transformer } from '@openfga/syntax-transformer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FgaService } from '../src/fga/fga.service';
import type { FgaClientLike, TupleKey } from '../src/fga/fga.types';

const API_URL = process.env.FGA_API_URL ?? 'http://localhost:8080';
const TEST_STORE = 'gtm-link-test';
const MODEL_PATH = path.resolve(process.cwd(), 'fga/model.fga');

let client: OpenFgaClient;
let storeId = '';

async function allowed(user: string, relation: string, object: string): Promise<boolean> {
  const response = await client.check({ user, relation, object });
  return response.allowed === true;
}

beforeAll(async () => {
  const root = new OpenFgaClient({ apiUrl: API_URL });

  // Limpieza de corridas previas: borrar cualquier store con el mismo nombre.
  const { stores } = await root.listStores();
  for (const store of stores.filter((s) => s.name === TEST_STORE)) {
    await new OpenFgaClient({ apiUrl: API_URL, storeId: store.id }).deleteStore();
  }

  storeId = (await root.createStore({ name: TEST_STORE })).id;
  const scoped = new OpenFgaClient({ apiUrl: API_URL, storeId });

  const dsl = readFileSync(MODEL_PATH, 'utf8');
  const model = transformer.transformDSLToJSONObject(dsl);
  const { authorization_model_id: modelId } = await scoped.writeAuthorizationModel({
    schema_version: model.schema_version,
    type_definitions: model.type_definitions,
    conditions: model.conditions,
  });

  client = new OpenFgaClient({ apiUrl: API_URL, storeId, authorizationModelId: modelId });

  await client.write({
    writes: [
      // Estructura: org → dept → project(s) → service → document/asset.
      { user: 'organization:gmt', relation: 'organization', object: 'department:geo' },
      { user: 'department:geo', relation: 'department', object: 'project:p1' },
      { user: 'client:acme', relation: 'client', object: 'project:p1' },
      { user: 'department:geo', relation: 'department', object: 'project:p2' },
      { user: 'client:otro', relation: 'client', object: 'project:p2' },
      { user: 'project:p1', relation: 'project', object: 'service:s1' },
      { user: 'service:s1', relation: 'service', object: 'document:d1' },
      { user: 'project:p1', relation: 'project', object: 'asset:a1' },
      // Asignaciones de rol (bundles §4.3).
      { user: 'user:anna', relation: 'admin', object: 'organization:gmt' },
      { user: 'user:bob', relation: 'operator', object: 'project:p1' },
      { user: 'user:carla', relation: 'client_ito', object: 'project:p1' },
      { user: 'user:dana', relation: 'qa', object: 'project:p1' },
      { user: 'user:eva', relation: 'owner', object: 'document:d1' },
      { user: 'user:carla', relation: 'client_signer', object: 'service:s1' },
      { user: 'user:frank', relation: 'assigned', object: 'asset:a1' },
    ],
  });
}, 30000);

afterAll(async () => {
  if (storeId) {
    await new OpenFgaClient({ apiUrl: API_URL, storeId }).deleteStore();
  }
});

describe('Modelo OpenFGA §4.3 — derivaciones', () => {
  it('a) admin de organización deriva admin de departamento', async () => {
    expect(await allowed('user:anna', 'admin', 'department:geo')).toBe(true);
  });

  it('b) admin de departamento deriva project_creator y can_assign_task', async () => {
    expect(await allowed('user:anna', 'project_creator', 'project:p1')).toBe(true);
    expect(await allowed('user:anna', 'can_assign_task', 'project:p1')).toBe(true);
  });

  it('b2) admin de organización deriva can_manage_users; un no-admin no (§1.1)', async () => {
    expect(await allowed('user:anna', 'can_manage_users', 'organization:gmt')).toBe(true);
    expect(await allowed('user:bob', 'can_manage_users', 'organization:gmt')).toBe(false);
  });

  it('b3) admin de organización deriva can_view_directory_extended; un no-admin no (§1.6)', async () => {
    expect(await allowed('user:anna', 'can_view_directory_extended', 'organization:gmt')).toBe(true);
    expect(await allowed('user:bob', 'can_view_directory_extended', 'organization:gmt')).toBe(false);
  });

  it('b4) admin de organización deriva can_review_documents; un no-admin no (§1.5)', async () => {
    expect(await allowed('user:anna', 'can_review_documents', 'organization:gmt')).toBe(true);
    expect(await allowed('user:bob', 'can_review_documents', 'organization:gmt')).toBe(false);
  });

  it('c) operator: can_create_task y can_view sí, can_define_kpi no', async () => {
    expect(await allowed('user:bob', 'can_create_task', 'project:p1')).toBe(true);
    expect(await allowed('user:bob', 'can_view', 'project:p1')).toBe(true);
    expect(await allowed('user:bob', 'can_define_kpi', 'project:p1')).toBe(false);
  });

  it('d) client_ito ve su proyecto pero NO crea tareas ni ve otro proyecto (aislamiento §3.4)', async () => {
    expect(await allowed('user:carla', 'can_view', 'project:p1')).toBe(true);
    expect(await allowed('user:carla', 'can_create_task', 'project:p1')).toBe(false);
    expect(await allowed('user:carla', 'can_view', 'project:p2')).toBe(false);
  });

  it('e) qa de proyecto deriva qa de servicio y can_sign_qa del documento', async () => {
    expect(await allowed('user:dana', 'qa', 'service:s1')).toBe(true);
    expect(await allowed('user:dana', 'can_sign_qa', 'document:d1')).toBe(true);
  });

  it('f) operator de servicio puede subir revisión; owner ve el documento', async () => {
    expect(await allowed('user:bob', 'can_upload_revision', 'document:d1')).toBe(true);
    expect(await allowed('user:eva', 'can_view', 'document:d1')).toBe(true);
  });

  it('g) client_signer del servicio firma como cliente', async () => {
    expect(await allowed('user:carla', 'can_sign_client', 'document:d1')).toBe(true);
  });

  it('h) solo el asignado corre el checklist del activo', async () => {
    expect(await allowed('user:frank', 'can_run_checklist', 'asset:a1')).toBe(true);
    expect(await allowed('user:bob', 'can_run_checklist', 'asset:a1')).toBe(false);
  });

  it('i) admin (vía project_creator→can_create_service) puede crear activo', async () => {
    expect(await allowed('user:anna', 'can_create', 'asset:a1')).toBe(true);
  });
});

/** Cliente fake que registra la última operación de write para inspección. */
function createRecordingClient(): {
  client: FgaClientLike;
  lastWrite: { writes?: TupleKey[]; deletes?: TupleKey[] } | null;
} {
  const state: { lastWrite: { writes?: TupleKey[]; deletes?: TupleKey[] } | null } = {
    lastWrite: null,
  };
  const fake: FgaClientLike = {
    check: (): Promise<{ allowed?: boolean }> => Promise.resolve({ allowed: false }),
    write: (body): Promise<unknown> => {
      state.lastWrite = body;
      return Promise.resolve(undefined);
    },
  };
  return {
    client: fake,
    get lastWrite() {
      return state.lastWrite;
    },
  };
}

describe('FgaService.syncMembershipToFGA — mapeo §4.1/§4.3', () => {
  it('org_admin + ORGANIZATION → organization#admin (create escribe tupla)', async () => {
    const recorder = createRecordingClient();
    const service = new FgaService(recorder.client);
    await service.syncMembershipToFGA(
      { userId: 'u1', roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      'create',
    );
    expect(recorder.lastWrite?.writes).toEqual([
      { user: 'user:u1', relation: 'admin', object: 'organization:gmt' },
    ]);
  });

  it('operator + PROJECT → project#operator (delete borra la tupla)', async () => {
    const recorder = createRecordingClient();
    const service = new FgaService(recorder.client);
    await service.syncMembershipToFGA(
      { userId: 'u2', roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' },
      'delete',
    );
    expect(recorder.lastWrite?.deletes).toEqual([
      { user: 'user:u2', relation: 'operator', object: 'project:p1' },
    ]);
  });

  it('combinación inválida (org_admin en PROJECT) lanza error', async () => {
    const recorder = createRecordingClient();
    const service = new FgaService(recorder.client);
    await expect(
      service.syncMembershipToFGA(
        { userId: 'u3', roleKey: 'org_admin', scopeType: 'PROJECT', scopeId: 'p1' },
        'create',
      ),
    ).rejects.toThrow(/inválida/);
  });
});
