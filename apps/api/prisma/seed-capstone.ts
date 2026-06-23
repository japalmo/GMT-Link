/**
 * Seed del flujo MVP "Capstone Copper / Mantos Blancos" (Módulo 5).
 *
 * Idempotente (upsert en todo). Asegura, end-to-end, un proyecto demostrable:
 *  1. 4 ROLES MVP (Role.isSystem=true) con grants RolePermission (scope) que
 *     reusan los Permission ya sembrados por `seed.ts` (convención ':'). Si algún
 *     permiso faltara, se crea con upsert (metadata razonable).
 *  2. Cliente Capstone Copper → Departamento Mantos Blancos → Proyecto Mantos
 *     Blancos → Servicio Topografía.
 *  3. 4 usuarios (uno por rol MVP) status ACTIVE.
 *  4. Membership PROJECT por usuario + sincronización a OpenFGA: se escribe la
 *     tupla ESTRUCTURAL (user:<id> <relación> project:<id>) usando el mapeo
 *     MEMBERSHIP_RELATION_MAP (supervisor/adm_contrato→project_creator,
 *     operador→operator, ito→client_ito). Idempotente (ignora "ya existe").
 *  5. 2-3 Task de ejemplo (status PENDIENTE) asignadas al operador, con dataSpec.
 *
 * Requiere: Postgres arriba, `seed.ts` corrido (catálogo de permisos) y, para
 * la sincronización FGA, OpenFGA bootstrapeado (FGA_STORE_ID en .env). Si
 * FGA_STORE_ID no está, el seed siembra Postgres igual y avisa que omite FGA.
 *
 * Ejecutar con: pnpm --filter @gmt-link/api seed:capstone
 */
import path from 'node:path';
import { config } from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import {
  PrismaClient,
  PermissionKind,
  PermissionScope,
  ScopeType,
  TaskStatus,
  UserStatus,
} from '@prisma/client';
import { MEMBERSHIP_RELATION_MAP, SCOPE_OBJECT_TYPE } from '../src/fga/fga.types';

// El CLI de Prisma carga el .env raíz vía prisma.config.ts; al correr con tsx hay que cargarlo aquí.
config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// 1) Permisos de respaldo + Roles MVP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Permisos que estos roles MVP referencian. `seed.ts` ya siembra todos los
 * usados aquí; estas defs son el respaldo idempotente por si `seed.ts` no corrió.
 * Convención ':' (NO duplicar con '.'). metadata alineada a seed.ts.
 */
interface PermDef {
  key: string;
  label: string;
  module: string;
  kind: PermissionKind;
  fgaRelation?: string;
  scopeable: boolean;
}

const FALLBACK_PERMISSIONS: ReadonlyArray<PermDef> = [
  // tareas
  { key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_view', scopeable: true },
  { key: 'task:create', label: 'Crear tareas', module: 'tareas', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_create_task', scopeable: true },
  { key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_assign_task', scopeable: true },
  { key: 'task:update', label: 'Mover / editar tareas', module: 'tareas', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  { key: 'task:time:log', label: 'Registrar inicio/fin de actividad', module: 'tareas', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  { key: 'task:time:read', label: 'Ver tiempos de tareas', module: 'tareas', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  // proyectos
  { key: 'project:read', label: 'Ver proyectos', module: 'proyectos', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_view', scopeable: true },
  { key: 'project:update', label: 'Editar proyecto', module: 'proyectos', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  { key: 'service:read', label: 'Ver servicios', module: 'proyectos', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_view', scopeable: true },
  { key: 'measurement:submit', label: 'Subir cubicaciones/mediciones', module: 'proyectos', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_submit_measurements', scopeable: true },
  // documentos
  { key: 'document:read', label: 'Ver documentos', module: 'documentos', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_view', scopeable: true },
  { key: 'document:upload', label: 'Subir documento', module: 'documentos', kind: PermissionKind.STRUCTURAL, fgaRelation: 'can_upload_revision', scopeable: true },
  // v-metric
  { key: 'vmetric:view', label: 'Acceder a V-metric', module: 'v-metric', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  { key: 'vmetric:dem:view', label: 'Ver visor 3D de DEM', module: 'v-metric', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  { key: 'vmetric:dem:compare', label: 'Comparar DEMs', module: 'v-metric', kind: PermissionKind.FUNCTIONAL, scopeable: true },
  // sistema / rbac
  { key: 'role:assign', label: 'Asignar roles a usuarios', module: 'sistema', kind: PermissionKind.FUNCTIONAL, scopeable: true },
];

const S = PermissionScope; // alias corto

interface RoleDef {
  key: string;
  label: string;
  grants: ReadonlyArray<{ perm: string; scope: PermissionScope }>;
}

const g = (perm: string, scope: PermissionScope = S.PROJECT): { perm: string; scope: PermissionScope } => ({ perm, scope });

/** Roles MVP del cliente (Módulo 5). isSystem=true: no editables por el admin. */
const MVP_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'supervisor',
    label: 'Supervisor',
    grants: [g('task:create'), g('task:assign'), g('task:read'), g('task:update'), g('task:time:read'), g('service:read')],
  },
  {
    key: 'operador',
    label: 'Operador',
    grants: [g('task:read', S.OWN), g('task:time:log'), g('measurement:submit'), g('document:upload')],
  },
  {
    key: 'ito',
    label: 'ITO',
    grants: [g('task:read'), g('task:time:read'), g('document:read'), g('vmetric:view'), g('vmetric:dem:view'), g('vmetric:dem:compare')],
  },
  {
    key: 'adm_contrato',
    label: 'Adm. Contrato',
    grants: [g('project:read'), g('project:update'), g('task:read'), g('task:assign'), g('document:read'), g('role:assign')],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2) Organización: Cliente → Departamento → Proyecto → Servicio
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT = { code: 'CAP', name: 'Capstone Copper' } as const;
const DEPARTMENT = { code: 'MB', name: 'Mantos Blancos' } as const;
const PROJECT = { code: 'MBL', name: 'Mantos Blancos' } as const;
const SERVICE = { code: 'TOP', name: 'Topografía' } as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3) Usuarios MVP (uno por rol)
// ─────────────────────────────────────────────────────────────────────────────

interface UserDef {
  email: string;
  firstName: string;
  lastName: string;
  roleKey: string;
}

const USERS: ReadonlyArray<UserDef> = [
  { email: 'supervisor@capstone.cl', firstName: 'Camila', lastName: 'Tapia', roleKey: 'supervisor' },
  { email: 'operador@capstone.cl', firstName: 'Diego', lastName: 'Rojas', roleKey: 'operador' },
  { email: 'ito@capstone.cl', firstName: 'Fernanda', lastName: 'Núñez', roleKey: 'ito' },
  { email: 'adm@capstone.cl', firstName: 'Rodrigo', lastName: 'Vásquez', roleKey: 'adm_contrato' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4) Tareas de ejemplo
// ─────────────────────────────────────────────────────────────────────────────

const DATA_SPEC = {
  cota_espejo: { label: 'Cota espejo (m)' },
  vol_salmuera: { label: 'Volumen salmuera (m³)' },
} as const;

interface TaskDef {
  key: string; // identificador lógico para idempotencia (name único dentro del proyecto)
  name: string;
  description: string;
}

const TASKS: ReadonlyArray<TaskDef> = [
  { key: 'TOP-LEV-R1', name: 'Levantamiento topográfico Reservorio 1', description: 'Medición de cota de espejo y volumen de salmuera en R1.' },
  { key: 'TOP-LEV-R2', name: 'Levantamiento topográfico Reservorio 2', description: 'Medición de cota de espejo y volumen de salmuera en R2.' },
  { key: 'TOP-DEM-MENSUAL', name: 'Captura DEM mensual del sector', description: 'Vuelo y procesamiento de modelo de elevación del sector Mantos Blancos.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers FGA
// ─────────────────────────────────────────────────────────────────────────────

/** Cliente FGA configurado desde .env, o null si OpenFGA no está inicializado. */
function makeFgaClient(): OpenFgaClient | null {
  const storeId = process.env.FGA_STORE_ID;
  if (!storeId) {
    return null;
  }
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
  const modelId = process.env.FGA_MODEL_ID || undefined;
  return new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
}

/**
 * Escribe la tupla estructural de una Membership PROJECT (idempotente: ignora
 * "ya existe"). Devuelve true si quedó escrita/existente, false si se omitió.
 */
async function writeProjectTuple(
  client: OpenFgaClient,
  userId: string,
  roleKey: string,
  projectId: string,
): Promise<boolean> {
  const relation = MEMBERSHIP_RELATION_MAP.PROJECT[roleKey];
  if (relation === undefined) {
    console.warn(`  FGA: rol "${roleKey}" no mapeado a relación PROJECT (§4.3) — tupla omitida`);
    return false;
  }
  const tuple = {
    user: `user:${userId}`,
    relation,
    object: `${SCOPE_OBJECT_TYPE.PROJECT}:${projectId}`,
  };
  try {
    await client.write({ writes: [tuple] });
    console.log(`  FGA: ${tuple.user} ${tuple.relation} ${tuple.object}`);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|write_failed_due_to_invalid_input|duplicate/i.test(message)) {
      console.log(`  FGA: tupla ya existía ${tuple.user} ${tuple.relation} ${tuple.object}`);
      return true;
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── 1a. Permisos de respaldo (no duplica los de seed.ts: upsert por key) ──
  for (const p of FALLBACK_PERMISSIONS) {
    const data = {
      label: p.label,
      module: p.module,
      kind: p.kind,
      fgaRelation: p.fgaRelation ?? null,
      scopeable: p.scopeable,
    };
    await prisma.permission.upsert({ where: { key: p.key }, update: data, create: { key: p.key, ...data } });
  }

  // ── 1b. Roles MVP + grants ──
  for (const role of MVP_ROLES) {
    const created = await prisma.role.upsert({
      where: { key: role.key },
      update: { label: role.label, isSystem: true },
      create: { key: role.key, label: role.label, isSystem: true },
    });
    for (const grant of role.grants) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: grant.perm } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: created.id, permissionId: perm.id } },
        update: { scope: grant.scope },
        create: { roleId: created.id, permissionId: perm.id, scope: grant.scope },
      });
    }
  }
  console.log(`Roles MVP asegurados: ${MVP_ROLES.map((r) => r.key).join(', ')}`);

  // ── 2. Cliente → Departamento → Proyecto → Servicio ──
  const client = await prisma.client.upsert({
    where: { code: CLIENT.code },
    update: { name: CLIENT.name },
    create: { code: CLIENT.code, name: CLIENT.name },
  });

  const department = await prisma.department.upsert({
    where: { code: DEPARTMENT.code },
    update: { name: DEPARTMENT.name },
    create: { code: DEPARTMENT.code, name: DEPARTMENT.name },
  });

  const project = await prisma.project.upsert({
    where: { departmentId_code: { departmentId: department.id, code: PROJECT.code } },
    update: { name: PROJECT.name, clientId: client.id },
    create: { code: PROJECT.code, name: PROJECT.name, departmentId: department.id, clientId: client.id },
  });

  const service = await prisma.service.upsert({
    where: { projectId_code: { projectId: project.id, code: SERVICE.code } },
    update: { name: SERVICE.name },
    create: { code: SERVICE.code, name: SERVICE.name, projectId: project.id, docCodingConfig: {} },
  });
  console.log(
    `Organización: ${client.name} (${client.code}) → ${department.name} (${department.code}) → ` +
      `${project.name} (${project.code}) → ${service.name} (${service.code})`,
  );

  // ── 3. Usuarios MVP ──
  const userIdByRole = new Map<string, string>();
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { firstName: u.firstName, lastName: u.lastName, status: UserStatus.ACTIVE },
      create: {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        status: UserStatus.ACTIVE,
        isClientUser: false,
      },
    });
    userIdByRole.set(u.roleKey, user.id);
  }
  console.log(`Usuarios asegurados: ${USERS.length} (${USERS.map((u) => u.email).join(', ')})`);

  // ── 4. Memberships PROJECT + sincronización a FGA ──
  const fga = makeFgaClient();
  if (!fga) {
    console.warn('OpenFGA: FGA_STORE_ID vacío — se omite la escritura de tuplas estructurales.');
    console.warn('         Corre `pnpm --filter @gmt-link/api fga:bootstrap` y vuelve a sembrar para sincronizar FGA.');
  }
  let memberships = 0;
  let fgaTuples = 0;
  for (const u of USERS) {
    const userId = userIdByRole.get(u.roleKey);
    if (userId === undefined) {
      continue;
    }
    await prisma.membership.upsert({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: u.roleKey,
          scopeType: ScopeType.PROJECT,
          scopeId: project.id,
        },
      },
      update: {},
      create: { userId, roleKey: u.roleKey, scopeType: ScopeType.PROJECT, scopeId: project.id },
    });
    memberships += 1;
    if (fga) {
      const ok = await writeProjectTuple(fga, userId, u.roleKey, project.id);
      if (ok) {
        fgaTuples += 1;
      }
    }
  }
  console.log(`Memberships PROJECT aseguradas: ${memberships}`);

  // ── 5. Tareas de ejemplo (assignedTo = operador, createdBy = supervisor) ──
  const operadorId = userIdByRole.get('operador');
  const supervisorId = userIdByRole.get('supervisor');
  if (operadorId === undefined || supervisorId === undefined) {
    throw new Error('No se pudo resolver operador/supervisor para las tareas de ejemplo.');
  }
  let tasks = 0;
  for (const t of TASKS) {
    // Idempotencia: buscar por (projectId, name) — no hay unique compuesto en Task.
    const existing = await prisma.task.findFirst({ where: { projectId: project.id, name: t.name } });
    if (existing) {
      await prisma.task.update({
        where: { id: existing.id },
        data: {
          description: t.description,
          status: TaskStatus.PENDIENTE,
          serviceId: service.id,
          assignedToId: operadorId,
          dataSpec: DATA_SPEC,
        },
      });
    } else {
      await prisma.task.create({
        data: {
          name: t.name,
          description: t.description,
          status: TaskStatus.PENDIENTE,
          projectId: project.id,
          serviceId: service.id,
          assignedToId: operadorId,
          createdById: supervisorId,
          dataSpec: DATA_SPEC,
        },
      });
    }
    tasks += 1;
  }
  console.log(`Tareas de ejemplo aseguradas: ${tasks} (assignedTo=${USERS.find((u) => u.roleKey === 'operador')?.email})`);

  // ── Resumen ──
  console.log('\n=== Resumen seed Capstone / Mantos Blancos ===');
  console.log(`  Roles MVP:            ${MVP_ROLES.length}`);
  console.log(`  Grants rol→permiso:   ${await prisma.rolePermission.count({ where: { role: { key: { in: MVP_ROLES.map((r) => r.key) } } } })}`);
  console.log(`  Usuarios:             ${USERS.length}`);
  console.log(`  Memberships PROJECT:  ${memberships}`);
  console.log(`  Tuplas FGA escritas:  ${fga ? fgaTuples : 'omitidas (FGA_STORE_ID vacío)'}`);
  console.log(`  Tareas (PENDIENTE):   ${tasks}`);
  console.log(`  Proyecto:             ${project.name} (id=${project.id})`);
  console.log('==============================================');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
