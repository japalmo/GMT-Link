/**
 * Seed del catálogo de permisos (§8 + módulos nuevos) y los roles espejo del
 * modelo OpenFGA (§4.3), ahora con METADATA de scope del Módulo 4 (ADR-0001):
 *  - Permission.{module,kind,fgaRelation,scopeable}
 *  - RolePermission.scope  (OWN | PROJECT | GLOBAL)
 *  - Role.isSystem  (roles sembrados: no editables por el admin)
 *
 * Convención de claves: `:` (consistente con el catálogo §8 existente).
 * La fachada `PermissionService` resuelve los permisos FUNCTIONAL contra estos
 * grants; los STRUCTURAL delegan en OpenFGA vía `fgaRelation`. Idempotente (upsert).
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// El CLI de Prisma carga el .env raíz vía prisma.config.ts; al correr con tsx hay que cargarlo aquí.
config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

type Kind = 'FUNCTIONAL' | 'STRUCTURAL';
type Scope = 'OWN' | 'PROJECT' | 'GLOBAL';

interface PermDef {
  key: string;
  label: string;
  module: string;
  kind: Kind;
  fgaRelation?: string; // solo STRUCTURAL: relación FGA a consultar para el scope PROJECT
  scopeable: boolean; // false = sin selector de scope en la matriz (siempre GLOBAL)
}

/** Catálogo de permisos atómicos (§8 + tareas/v-metric del Módulo 5). */
const PERMISSIONS: ReadonlyArray<PermDef> = [
  // ── sistema / rbac ──
  { key: 'user:create', label: 'Crear usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'user:read', label: 'Ver usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'user:update', label: 'Editar usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'role:assign', label: 'Asignar roles a usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: true },
  // ── directorio ──
  { key: 'directory:view:extended', label: 'Ver datos extendidos de directorio', module: 'directorio', kind: 'STRUCTURAL', fgaRelation: 'can_view_directory_extended', scopeable: true },
  // ── clientes ──
  { key: 'client:create', label: 'Crear cliente', module: 'clientes', kind: 'FUNCTIONAL', scopeable: false },
  // ── proyectos ──
  { key: 'project:create', label: 'Crear proyectos', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'faena:create', label: 'Crear faena', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:team:manage', label: 'Gestionar trabajadores del proyecto', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_manage_team', scopeable: true },
  // ⚠️ Granularidad compartida (review Tasks 2.2 y 2.4): project:read,
  // measurement:read y task:read materializan la MISMA tupla FGA (`can_view`
  // sobre project). Otorgar cualquiera de los tres en un rol custom concede
  // de facto la visibilidad de los otros dos a nivel FGA — y también lo que
  // gatean `service:read` y `document:read` (misma relación `can_view`, pero
  // NO componibles: solo llegan vía roles del sistema). La separación de keys
  // es catálogo/UI, no enforcement. Desacoplarlas requeriría relaciones FGA
  // propias por recurso (deuda post-MVP).
  { key: 'project:read', label: 'Ver proyectos', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { key: 'project:update', label: 'Editar proyecto', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'project:kpi:define', label: 'Definir KPIs', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_define_kpi', scopeable: true },
  { key: 'service:read', label: 'Ver servicios', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  // ⚠️ Acople conocido (review Task 1.5): en el modelo FGA `asset.can_create =
  // can_create_service from project`, así que otorgar este permiso TAMBIÉN
  // habilita crear/asignar/actualizar activos del proyecto. El label lo dice
  // explícitamente; desacoplarlo (gate propio de assets) es deuda post-MVP.
  { key: 'service:create', label: 'Crear servicios', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_create_service', scopeable: true },
  { key: 'measurement:submit', label: 'Subir cubicaciones/mediciones', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_submit_measurements', scopeable: true },
  // ⚠️ Comparte `can_view` con project:read y task:read — ver nota en project:read.
  { key: 'measurement:read', label: 'Ver mediciones', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  // ── tareas (Módulo 5) ──
  // ⚠️ Comparte `can_view` con project:read y measurement:read — ver nota en project:read.
  { key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { key: 'task:create', label: 'Crear tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_create_task', scopeable: true },
  { key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task', scopeable: true },
  { key: 'task:update', label: 'Mover / editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'task:time:log', label: 'Registrar inicio/fin de actividad', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'task:time:read', label: 'Ver tiempos de tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
  // ── documentos ──
  { key: 'document:read', label: 'Ver documentos', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { key: 'document:upload', label: 'Subir documento', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_upload_revision', scopeable: true },
  { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_sign_qa', scopeable: true },
  { key: 'document:sign:client', label: 'Firmar cliente', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_sign_client', scopeable: true },
  { key: 'document:review', label: 'Revisar documentos', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents', scopeable: false },
  // ── v-metric (Módulo 5) ──
  { key: 'vmetric:view', label: 'Acceder a V-metric', module: 'v-metric', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'vmetric:dem:view', label: 'Ver visor 3D de DEM', module: 'v-metric', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'vmetric:dem:compare', label: 'Comparar DEMs', module: 'v-metric', kind: 'FUNCTIONAL', scopeable: true },
  // ── finanzas ──
  { key: 'finance:reimbursement:import', label: 'Importar reembolsos', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'finance:print:batch', label: 'Impresión en lote', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'finance:manage', label: 'Gestionar finanzas', module: 'finanzas', kind: 'STRUCTURAL', fgaRelation: 'can_manage_finance', scopeable: false },
  // ── activos ──
  // Gate propio de la gestión de activos (crear/asignar/accesorios/plantillas):
  // desacoplado de service:create; project_creator lo deriva en FGA.
  { key: 'asset:manage', label: 'Gestionar activos', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_manage_assets', scopeable: true },
  { key: 'asset:create', label: 'Crear activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_create', scopeable: true },
  { key: 'asset:checklist:run', label: 'Ejecutar checklist', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_run_checklist', scopeable: true },
  { key: 'asset:location:view', label: 'Ver ubicación de activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_location', scopeable: true },
  { key: 'asset:history:view', label: 'Ver históricos de activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_history', scopeable: true },
  { key: 'asset:doc:upload', label: 'Subir doc de activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_upload_doc', scopeable: true },
  { key: 'asset:doc:approve', label: 'Aprobar doc de activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_upload_and_approve_doc', scopeable: true },
  { key: 'asset:fields:edit', label: 'Editar campos de equipo', module: 'recursos', kind: 'FUNCTIONAL', scopeable: true },
];

interface RoleDef {
  key: string;
  label: string;
  grants: ReadonlyArray<{ perm: string; scope: Scope }>;
}

/** Helper: grant con scope (default PROJECT). */
const g = (perm: string, scope: Scope = 'PROJECT'): { perm: string; scope: Scope } => ({ perm, scope });

/**
 * Roles = bundles (§3.1). Keys alineadas con las relaciones de §4.3. `isSystem`.
 * org_admin recibe TODO el catálogo a scope GLOBAL (el admin de FGA deriva el resto).
 */
const ROLES: ReadonlyArray<RoleDef> = [
  { key: 'org_admin', label: 'Administrador de organización', grants: PERMISSIONS.map((p) => g(p.key, 'GLOBAL')) },
  {
    key: 'department_admin',
    label: 'Administrador de departamento',
    grants: [g('project:create', 'GLOBAL'), g('client:create', 'GLOBAL'), g('faena:create', 'GLOBAL'), g('project:team:manage'), g('asset:fields:edit'), g('project:read'), g('project:update'), g('project:kpi:define'), g('task:create'), g('task:assign'), g('task:read'), g('asset:manage'), g('asset:create')],
  },
  {
    key: 'project_creator',
    label: 'Creador de proyecto',
    grants: [g('project:read'), g('project:kpi:define'), g('service:create'), g('task:create'), g('task:assign'), g('task:read'), g('asset:manage'), g('asset:create')],
  },
  {
    key: 'operator',
    label: 'Operador',
    grants: [g('task:create'), g('task:read'), g('measurement:submit'), g('document:upload'), g('asset:doc:upload')],
  },
  { key: 'qa', label: 'QA', grants: [g('document:read'), g('document:sign:qa'), g('task:read'), g('measurement:read')] },
  { key: 'finance', label: 'Finanzas', grants: [g('finance:reimbursement:import'), g('finance:print:batch')] },
  { key: 'viewer', label: 'Visualizador', grants: [g('project:read'), g('document:read'), g('task:read')] },
  {
    key: 'client_ito',
    label: 'Cliente ITO',
    grants: [g('project:read'), g('document:read'), g('document:sign:client'), g('task:read'), g('vmetric:view'), g('vmetric:dem:view'), g('vmetric:dem:compare')],
  },
];

/**
 * Departamentos internos de GMT (agrupan proyectos administrativamente). Se
 * siembran idempotentes para que exista al menos uno al crear proyectos: el
 * `admin` de un departamento deriva del `admin` de la organización (model.fga),
 * así que el org_admin es admin de todos.
 */
const DEPARTMENTS = [
  { code: 'OPS', name: 'Operaciones' },
  { code: 'GEO', name: 'Geofísica y Geotecnia' },
  { code: 'TOP', name: 'Topografía' },
];

async function main(): Promise<void> {
  for (const p of PERMISSIONS) {
    const data = {
      label: p.label,
      module: p.module,
      kind: p.kind,
      fgaRelation: p.fgaRelation ?? null,
      scopeable: p.scopeable,
    };
    await prisma.permission.upsert({ where: { key: p.key }, update: data, create: { key: p.key, ...data } });
  }
  console.log(`Permisos asegurados: ${PERMISSIONS.length}`);

  for (const role of ROLES) {
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
  console.log(`Roles asegurados: ${ROLES.map((r) => r.key).join(', ')}`);

  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name },
      create: { code: d.code, name: d.name },
    });
  }
  console.log(`Departamentos asegurados: ${DEPARTMENTS.length}`);
  console.log(`Bundles rol→permiso: ${await prisma.rolePermission.count()}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
