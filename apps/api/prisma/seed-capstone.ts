/**
 * Seed del flujo MVP "Capstone Copper / Mantos Blancos" y "Albemarle / Salar de Atacama" (Módulo 5).
 *
 * Idempotente (upsert en todo). Asegura, end-to-end, un proyecto demostrable:
 *  1. 4 ROLES MVP (Role.isSystem=true) con grants RolePermission (scope) que
 *     reusan los Permission ya sembrados por `seed.ts` (convención ':').
 *  2. Clientes Capstone Copper y Albemarle.
 *  3. Proyectos Mantos Blancos (MBL) y Salar de Atacama (ATA).
 *  4. Servicios Topografía (TOP) y Control V-Metric (CUB).
 *  5. 8 usuarios MVP (5 Capstone, 4 Albemarle - supervisor@capstone es compartido o separado).
 *  6. Memberships PROJECT por usuario + sincronización a OpenFGA.
 *  7. Element R2 (Reservorio 2) y sus variables de cubicación para Albemarle.
 *  8. Historial de DataPoints para R2 para poblar el dashboard.
 *  9. Tareas de ejemplo para ambos proyectos (incluyendo dataSpec).
 *
 * Ejecutar con: pnpm --filter @gmt-link/api seed:capstone
 */
import fs from 'node:fs';
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
  VariableType,
} from '@prisma/client';
import { MEMBERSHIP_RELATION_MAP, SCOPE_OBJECT_TYPE } from '../src/fga/fga.types';

// El CLI de Prisma carga el .env raíz vía prisma.config.ts; al correr con tsx hay que cargarlo aquí.
config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// 1) Permisos de respaldo + Roles MVP
// ─────────────────────────────────────────────────────────────────────────────

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

const MVP_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'supervisor',
    label: 'Supervisor',
    grants: [g('task:create'), g('task:assign'), g('task:read'), g('task:update'), g('task:time:read'), g('service:read')],
  },
  {
    key: 'operador',
    label: 'Operador',
    grants: [g('task:read', S.PROJECT), g('task:time:log'), g('measurement:submit'), g('document:upload')],
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
// 2) Organizaciones MVP
// ─────────────────────────────────────────────────────────────────────────────

// Capstone Copper / Mantos Blancos
const CAP_CLIENT = { code: 'CAP', name: 'Capstone Copper' } as const;
const CAP_DEPT = { code: 'MB', name: 'Mantos Blancos' } as const;
const CAP_PROJ = { code: 'MBL', name: 'Mantos Blancos' } as const;
const CAP_SERV = { code: 'TOP', name: 'Topografía' } as const;

// Albemarle / Salar de Atacama
const ALB_CLIENT = { code: 'ALB', name: 'Albemarle' } as const;
const ALB_DEPT = { code: 'SLA', name: 'Salar de Atacama' } as const;
const ALB_PROJ = { code: 'ATA', name: 'Salar de Atacama' } as const;
const ALB_SERV = { code: 'CUB', name: 'Control V-Metric' } as const;

// Variables de Albemarle
const ALB_VARIABLES = [
  { code: 'borde_libre', name: 'Borde libre', type: VariableType.SCALAR, unit: 'm' },
  { code: 'altura_salmuera', name: 'Altura de salmuera', type: VariableType.SCALAR, unit: 'm' },
  { code: 'altura_sal', name: 'Altura de sal', type: VariableType.SCALAR, unit: 'm' },
  { code: 'vol_salmuera_libre', name: 'Volumen Salmuera Libre', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'vol_sal', name: 'Volumen de Sal', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'vol_salmuera_ocluida', name: 'Volumen Salmuera Ocluida', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'vol_salmuera_total', name: 'Volumen Total Salmuera', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'cota_espejo', name: 'Cota de Espejo de Agua', type: VariableType.SCALAR, unit: 'm' },
  { code: 'cota_sal', name: 'Cota de Sal', type: VariableType.SCALAR, unit: 'm' },
  { code: 'area_espejo', name: 'Área de Espejo de Agua', type: VariableType.SCALAR, unit: 'm²' },
  { code: 'perimetro', name: 'Perímetro de la Poza', type: VariableType.SCALAR, unit: 'm' },
  { code: 'dem_file', name: 'Archivo DEM de Elevación', type: VariableType.FILE, unit: '' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3) Usuarios MVP
// ─────────────────────────────────────────────────────────────────────────────

interface UserDef {
  email: string;
  firstName: string;
  lastName: string;
  roleKey: string;
}

const USERS: ReadonlyArray<UserDef> = [
  // Capstone Copper
  { email: 'supervisor@capstone.cl', firstName: 'Camila', lastName: 'Tapia', roleKey: 'supervisor' },
  { email: 'operador@capstone.cl', firstName: 'Diego', lastName: 'Rojas', roleKey: 'operador' },
  { email: 'operador2@capstone.cl', firstName: 'Matías', lastName: 'Soto', roleKey: 'operador' },
  { email: 'ito@capstone.cl', firstName: 'Fernanda', lastName: 'Núñez', roleKey: 'ito' },
  { email: 'adm@capstone.cl', firstName: 'Rodrigo', lastName: 'Vásquez', roleKey: 'adm_contrato' },
  // Albemarle
  { email: 'supervisor@albemarle.cl', firstName: 'Sofía', lastName: 'Contreras', roleKey: 'supervisor' },
  { email: 'operador@albemarle.cl', firstName: 'Cristián', lastName: 'Muñoz', roleKey: 'operador' },
  { email: 'ito@albemarle.cl', firstName: 'Claudio', lastName: 'Jara', roleKey: 'ito' },
  { email: 'adm@albemarle.cl', firstName: 'Patricia', lastName: 'Gómez', roleKey: 'adm_contrato' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4) Tareas de ejemplo
// ─────────────────────────────────────────────────────────────────────────────

const DATA_SPEC_TOP = {
  type: 'custom_metrics',
  label: 'Ingreso de datos / Mediciones',
  fields: {
    cota_espejo: 'Cota espejo (m)',
    vol_salmuera: 'Volumen salmuera (m³)',
  },
} as const;

const DATA_SPEC_PDF = {
  type: 'pdf_report',
  label: 'Informe en PDF',
} as const;

interface TaskDef {
  key: string;
  name: string;
  description: string;
  dataSpec: Record<string, unknown>;
  isAlbemarle: boolean;
}

const TASKS: ReadonlyArray<TaskDef> = [
  // Capstone
  { key: 'TOP-LEV-R1', name: 'Levantamiento topográfico Reservorio 1', description: 'Medición de cota de espejo y volumen de salmuera en R1.', dataSpec: DATA_SPEC_TOP, isAlbemarle: false },
  { key: 'TOP-LEV-R2', name: 'Levantamiento topográfico Reservorio 2', description: 'Medición de cota de espejo y volumen de salmuera en R2.', dataSpec: DATA_SPEC_TOP, isAlbemarle: false },
  { key: 'TOP-DEM-MENSUAL', name: 'Captura DEM mensual del sector', description: 'Vuelo y procesamiento de modelo de elevación del sector Mantos Blancos.', dataSpec: DATA_SPEC_PDF, isAlbemarle: false },
  // Albemarle
  { key: 'ATA-VME-R2', name: 'Cubicación Reservorio 2', description: 'Realizar vuelo e importación de DEM para R2.', dataSpec: DATA_SPEC_TOP, isAlbemarle: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers FGA
// ─────────────────────────────────────────────────────────────────────────────

function makeFgaClient(): OpenFgaClient | null {
  const storeId = process.env.FGA_STORE_ID;
  if (!storeId) return null;
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
  const modelId = process.env.FGA_MODEL_ID || undefined;
  return new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
}

async function writeProjectTuple(
  client: OpenFgaClient,
  userId: string,
  roleKey: string,
  projectId: string,
): Promise<boolean> {
  const relation = MEMBERSHIP_RELATION_MAP.PROJECT[roleKey];
  if (relation === undefined) {
    console.warn(`  FGA: rol "${roleKey}" no mapeado a relación PROJECT — tupla omitida`);
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
  // ── 1a. Permisos de respaldo ──
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

  // ── 2a. Capstone: Cliente → Departamento → Proyecto → Servicio ──
  const capClient = await prisma.client.upsert({
    where: { code: CAP_CLIENT.code },
    update: { name: CAP_CLIENT.name },
    create: { code: CAP_CLIENT.code, name: CAP_CLIENT.name },
  });

  const capDepartment = await prisma.department.upsert({
    where: { code: CAP_DEPT.code },
    update: { name: CAP_DEPT.name },
    create: { code: CAP_DEPT.code, name: CAP_DEPT.name },
  });

  const capProject = await prisma.project.upsert({
    where: { departmentId_code: { departmentId: capDepartment.id, code: CAP_PROJ.code } },
    update: { name: CAP_PROJ.name, clientId: capClient.id },
    create: { code: CAP_PROJ.code, name: CAP_PROJ.name, departmentId: capDepartment.id, clientId: capClient.id },
  });

  const capService = await prisma.service.upsert({
    where: { projectId_code: { projectId: capProject.id, code: CAP_SERV.code } },
    update: { name: CAP_SERV.name },
    create: { code: CAP_SERV.code, name: CAP_SERV.name, projectId: capProject.id, docCodingConfig: {} },
  });
  console.log(`Capstone: ${capClient.name} -> ${capProject.name}`);

  // ── 2b. Albemarle: Cliente → Departamento → Proyecto → Servicio ──
  const albClient = await prisma.client.upsert({
    where: { code: ALB_CLIENT.code },
    update: { name: ALB_CLIENT.name },
    create: { code: ALB_CLIENT.code, name: ALB_CLIENT.name },
  });

  const albDepartment = await prisma.department.upsert({
    where: { code: ALB_DEPT.code },
    update: { name: ALB_DEPT.name },
    create: { code: ALB_DEPT.code, name: ALB_DEPT.name },
  });

  const albProject = await prisma.project.upsert({
    where: { departmentId_code: { departmentId: albDepartment.id, code: ALB_PROJ.code } },
    update: { name: ALB_PROJ.name, clientId: albClient.id },
    create: { code: ALB_PROJ.code, name: ALB_PROJ.name, departmentId: albDepartment.id, clientId: albClient.id },
  });

  const albService = await prisma.service.upsert({
    where: { projectId_code: { projectId: albProject.id, code: ALB_SERV.code } },
    update: { name: ALB_SERV.name },
    create: { code: ALB_SERV.code, name: ALB_SERV.name, projectId: albProject.id, docCodingConfig: {} },
  });
  console.log(`Albemarle: ${albClient.name} -> ${albProject.name}`);

  // Load reservoirs JSON data
  const dataPath = path.join(__dirname, 'data-reservorios.json');
  let reservoirsData: Record<string, { name: string; polygon?: unknown; metadata?: unknown }> = {};
  try {
    if (fs.existsSync(dataPath)) {
      reservoirsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      console.log(`Loaded ${Object.keys(reservoirsData).length} reservoirs from data-reservorios.json`);
    } else {
      console.warn(`WARNING: data-reservorios.json not found at ${dataPath}`);
    }
  } catch (err) {
    console.error('Error reading data-reservorios.json:', err);
  }

  const phase = await prisma.phase.upsert({
    where: { serviceId_code: { serviceId: albService.id, code: 'anual-2026' } },
    update: { name: 'Campaña Anual 2026' },
    create: { code: 'anual-2026', name: 'Campaña Anual 2026', serviceId: albService.id },
  });

  const varMap = new Map<string, { id: string }>();
  for (const v of ALB_VARIABLES) {
    const createdVar = await prisma.variable.upsert({
      where: { phaseId_code: { phaseId: phase.id, code: v.code } },
      update: { name: v.name, type: v.type, unit: v.unit },
      create: { code: v.code, name: v.name, type: v.type, unit: v.unit, phaseId: phase.id },
    });
    varMap.set(v.code, createdVar);
  }
  console.log(`Variables de cubicación Albemarle sembradas.`);

  // ── 3. Usuarios MVP (Mapeados por email) ──
  const userIdByEmail = new Map<string, string>();
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { firstName: u.firstName, lastName: u.lastName, status: UserStatus.ACTIVE },
      create: {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        status: UserStatus.ACTIVE,
        isClientUser: u.roleKey === 'ito',
      },
    });
    userIdByEmail.set(u.email, user.id);
  }
  console.log(`Usuarios asegurados: ${USERS.length}`);

  // ── 3.1. Sembrar Elements y DataPoints históricos desde JSON ──
  const operadorAlbId = userIdByEmail.get('operador@albemarle.cl');
  
  if (operadorAlbId) {
    for (const [code, resObj] of Object.entries(reservoirsData)) {
      // 1. Upsert Element
      const element = await prisma.element.upsert({
        where: { code },
        update: {
          name: resObj.name,
          type: 'POZA',
          locationPolygon: JSON.stringify(resObj.polygon),
          metadata: resObj.metadata,
          projectId: albProject.id,
        },
        create: {
          code,
          name: resObj.name,
          type: 'POZA',
          locationPolygon: JSON.stringify(resObj.polygon),
          metadata: resObj.metadata,
          projectId: albProject.id,
        },
      });

      // 2. Seed measurements (SKIPPED to let reload-volumes do it faster)
      /*
      for (const record of resObj.measurements) {
        const valMap: Record<string, number | null | undefined> = {
          borde_libre: record.borde_libre,
          altura_salmuera: record.altura_salmuera,
          altura_sal: record.altura_sal,
          vol_salmuera_libre: record.vol_salmuera_libre,
          vol_sal: record.vol_sal,
          vol_salmuera_ocluida: record.vol_salmuera_ocluida,
          vol_salmuera_total: record.vol_total_salmuera,
          cota_espejo: record.cota_espejo,
          cota_sal: record.cota_sal,
          area_espejo: record.area_espejo,
          perimetro: record.perimetro,
        };

        for (const [vCode, val] of Object.entries(valMap)) {
          if (val === null || val === undefined) continue;
          const variable = varMap.get(vCode);
          if (!variable) continue;

          const exist = await prisma.dataPoint.findFirst({
            where: {
              elementId: element.id,
              variableId: variable.id,
              phaseId: phase.id,
              createdAt: new Date(record.date),
            },
          });

          if (!exist) {
            await prisma.dataPoint.create({
              data: {
                value: String(val),
                variableId: variable.id,
                elementId: element.id,
                phaseId: phase.id,
                createdById: operadorAlbId,
                createdAt: new Date(record.date),
              },
            });
          }
        }
      }
      */

      // 3. Seed dem_file DataPoint
      const demVariable = varMap.get('dem_file');
      if (demVariable) {
        const demExist = await prisma.dataPoint.findFirst({
          where: {
            elementId: element.id,
            variableId: demVariable.id,
            phaseId: phase.id,
          },
        });

        if (!demExist) {
          await prisma.dataPoint.create({
            data: {
              value: `MDE_${code}.tif`,
              fileUrl: `/dem/${code}.json`,
              variableId: demVariable.id,
              elementId: element.id,
              phaseId: phase.id,
              createdById: operadorAlbId,
              createdAt: new Date('2026-06-18T12:00:00Z'),
            },
          });
        }
      }
      
      console.log(`Reservorio ${code}: Elemento y ${resObj.measurements.length} mediciones sembradas.`);
    }
  }

  // Obtener el Elemento R2 para compatibilidad con las tareas posteriores del seed
  const elementR2 = await prisma.element.findUniqueOrThrow({
    where: { code: 'R2' },
  });

  // ── 4. Memberships PROJECT + sincronización a FGA ──
  const fga = makeFgaClient();
  if (!fga) {
    console.warn('OpenFGA: FGA_STORE_ID vacío — se omite la escritura de tuplas estructurales.');
  }

  let memberships = 0;
  let fgaTuples = 0;
  for (const u of USERS) {
    const userId = userIdByEmail.get(u.email);
    if (!userId) continue;

    const isAlb = u.email.endsWith('@albemarle.cl');
    const projId = isAlb ? albProject.id : capProject.id;

    await prisma.membership.upsert({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: u.roleKey,
          scopeType: ScopeType.PROJECT,
          scopeId: projId,
        },
      },
      update: {},
      create: { userId, roleKey: u.roleKey, scopeType: ScopeType.PROJECT, scopeId: projId },
    });
    memberships += 1;

    if (fga) {
      const ok = await writeProjectTuple(fga, userId, u.roleKey, projId);
      if (ok) fgaTuples += 1;
    }
  }
  console.log(`Memberships PROJECT aseguradas: ${memberships}`);

  // ── 5. Tareas de ejemplo ──
  let tasks = 0;
  for (const t of TASKS) {
    const proj = t.isAlbemarle ? albProject : capProject;
    const serv = t.isAlbemarle ? albService : capService;

    const domain = t.isAlbemarle ? '@albemarle.cl' : '@capstone.cl';
    const opId = userIdByEmail.get(`operador${domain}`);
    const supId = userIdByEmail.get(`supervisor${domain}`);

    if (!opId || !supId) continue;

    const existing = await prisma.task.findFirst({ where: { projectId: proj.id, name: t.name } });
    if (existing) {
      await prisma.task.update({
        where: { id: existing.id },
        data: {
          description: t.description,
          status: TaskStatus.PENDIENTE,
          serviceId: serv.id,
          assignedToId: opId,
          dataSpec: t.dataSpec,
          phaseId: t.isAlbemarle ? phase.id : null,
          elementId: t.isAlbemarle ? elementR2.id : null,
        },
      });
    } else {
      await prisma.task.create({
        data: {
          name: t.name,
          description: t.description,
          status: TaskStatus.PENDIENTE,
          projectId: proj.id,
          serviceId: serv.id,
          assignedToId: opId,
          createdById: supId,
          dataSpec: t.dataSpec,
          phaseId: t.isAlbemarle ? phase.id : null,
          elementId: t.isAlbemarle ? elementR2.id : null,
        },
      });
    }
    tasks += 1;
  }
  console.log(`Tareas de ejemplo aseguradas: ${tasks}`);

  // ── Resumen ──
  console.log('\n=== Resumen seed Capstone / Albemarle MVP ===');
  console.log(`  Usuarios:             ${USERS.length}`);
  console.log(`  Memberships PROJECT:  ${memberships}`);
  console.log(`  Tuplas FGA escritas:  ${fga ? fgaTuples : 'omitidas (FGA_STORE_ID vacío)'}`);
  console.log(`  Tareas (PENDIENTE):   ${tasks}`);
  console.log(`  Capstone Project:     ${capProject.name} (id=${capProject.id})`);
  console.log(`  Albemarle Project:    ${albProject.name} (id=${albProject.id})`);
  console.log('==============================================');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
