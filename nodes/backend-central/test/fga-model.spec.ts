/**
 * Tests del modelo OpenFGA §4.3 contra un servidor REAL (http://localhost:8080).
 * Crea un store efímero propio ("gmt-link-test"), carga el modelo desde fga/model.fga,
 * escribe tuplas estructurales + asignaciones de rol y verifica las derivaciones y el
 * aislamiento entre clientes (§3.4). El store se borra en afterAll (re-ejecutable).
 *
 * + Tests unitarios del mapeo de FgaService.syncMembershipToFGA con un cliente fake.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import { transformer } from '@openfga/syntax-transformer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FgaService } from '../src/fga/fga.service';
import type { FgaClientLike, TupleKey } from '../src/fga/fga.types';

// Cargar .env de la raíz o de la carpeta local de la API
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const API_URL = process.env.FGA_API_URL ?? 'http://localhost:8080';
const TEST_STORE = 'gmt-link-test';
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

  it('b5) admin de organización deriva can_manage_finance; un no-admin no (§3.1/3.3)', async () => {
    expect(await allowed('user:anna', 'can_manage_finance', 'organization:gmt')).toBe(true);
    expect(await allowed('user:bob', 'can_manage_finance', 'organization:gmt')).toBe(false);
  });

  it('c) operator: can_create_task y can_view sí, can_define_kpi no', async () => {
    expect(await allowed('user:bob', 'can_create_task', 'project:p1')).toBe(true);
    expect(await allowed('user:bob', 'can_view', 'project:p1')).toBe(true);
    expect(await allowed('user:bob', 'can_define_kpi', 'project:p1')).toBe(false);
  });

  it('c2) operator/qa pueden can_submit_measurements; client_ito no (D3)', async () => {
    expect(await allowed('user:bob', 'can_submit_measurements', 'project:p1')).toBe(true);
    expect(await allowed('user:dana', 'can_submit_measurements', 'project:p1')).toBe(true);
    expect(await allowed('user:carla', 'can_submit_measurements', 'project:p1')).toBe(false);
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

  it('j) can_manage_roles: admin de organización lo deriva; un no-admin no (§5)', async () => {
    expect(await allowed('user:anna', 'can_manage_roles', 'organization:gmt')).toBe(true);
    expect(await allowed('user:bob', 'can_manage_roles', 'organization:gmt')).toBe(false);
  });

  it('k) tupla directa [user] en project.can_view pasa el check aunque no tenga ningún rol bundle (§5)', async () => {
    // 'gina' no tiene viewer/operator/qa/finance/project_creator/client_ito en p1.
    expect(await allowed('user:gina', 'can_view', 'project:p1')).toBe(false);
    await client.write({
      writes: [{ user: 'user:gina', relation: 'can_view', object: 'project:p1' }],
    });
    expect(await allowed('user:gina', 'can_view', 'project:p1')).toBe(true);
    // Aislamiento: la tupla directa en p1 no da acceso a p2 (§3.4).
    expect(await allowed('user:gina', 'can_view', 'project:p2')).toBe(false);
  });

  it('l) tupla directa [user] en project.can_create_task pasa el check (§5)', async () => {
    expect(await allowed('user:henry', 'can_create_task', 'project:p1')).toBe(false);
    await client.write({
      writes: [{ user: 'user:henry', relation: 'can_create_task', object: 'project:p1' }],
    });
    expect(await allowed('user:henry', 'can_create_task', 'project:p1')).toBe(true);
  });

  it('m) tupla directa [user] en las 3 relaciones org componibles pasa el check (A1)', async () => {
    // 'kevin' no es admin de la org: sin tupla directa, ningún can_* org le da true.
    expect(await allowed('user:kevin', 'can_review_documents', 'organization:gmt')).toBe(false);
    await client.write({
      writes: [
        { user: 'user:kevin', relation: 'can_review_documents', object: 'organization:gmt' },
        { user: 'user:kevin', relation: 'can_view_directory_extended', object: 'organization:gmt' },
        { user: 'user:kevin', relation: 'can_manage_finance', object: 'organization:gmt' },
      ],
    });
    expect(await allowed('user:kevin', 'can_review_documents', 'organization:gmt')).toBe(true);
    expect(await allowed('user:kevin', 'can_view_directory_extended', 'organization:gmt')).toBe(true);
    expect(await allowed('user:kevin', 'can_manage_finance', 'organization:gmt')).toBe(true);
    // can_manage_users NO es componible: sigue siendo solo derivado de admin.
    expect(await allowed('user:kevin', 'can_manage_users', 'organization:gmt')).toBe(false);
  });

  it('n) derivación cruzada §12 (A14a): tupla directa can_view sobre project:P satisface can_view en service con service.project = P', async () => {
    // 'iris' no tiene ningún rol ni tupla: no ve el servicio s1 (que cuelga de p1).
    expect(await allowed('user:iris', 'can_view', 'service:s1')).toBe(false);
    await client.write({
      writes: [{ user: 'user:iris', relation: 'can_view', object: 'project:p1' }],
    });
    // service.can_view = can_view from project → la tupla directa en p1 alcanza a s1.
    expect(await allowed('user:iris', 'can_view', 'service:s1')).toBe(true);
    expect(await allowed('user:iris', 'can_view', 'project:p1')).toBe(true);
  });

  it('o) can_manage_roles NO es componible: la tupla directa se rechaza; admin sí lo deriva (§5)', async () => {
    await expect(
      client.write({
        writes: [{ user: 'user:leo', relation: 'can_manage_roles', object: 'organization:gmt' }],
      }),
    ).rejects.toThrow(/type 'user' is not an allowed type restriction/);
    expect(await allowed('user:leo', 'can_manage_roles', 'organization:gmt')).toBe(false);
    expect(await allowed('user:anna', 'can_manage_roles', 'organization:gmt')).toBe(true);
  });

  it('p) tupla directa org NO deriva a project: can_view_directory_extended en la org no da can_view en p1 (A1)', async () => {
    await client.write({
      writes: [
        { user: 'user:laura', relation: 'can_view_directory_extended', object: 'organization:gmt' },
      ],
    });
    expect(await allowed('user:laura', 'can_view_directory_extended', 'organization:gmt')).toBe(
      true,
    );
    expect(await allowed('user:laura', 'can_view', 'project:p1')).toBe(false);
  });

  it('q) independencia atómica: SOLO can_create_task directo en p1 no otorga can_view en p1 (§5)', async () => {
    await client.write({
      writes: [{ user: 'user:mike', relation: 'can_create_task', object: 'project:p1' }],
    });
    expect(await allowed('user:mike', 'can_create_task', 'project:p1')).toBe(true);
    // La visibilidad se otorga aparte: cada permiso atómico es independiente.
    expect(await allowed('user:mike', 'can_view', 'project:p1')).toBe(false);
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
