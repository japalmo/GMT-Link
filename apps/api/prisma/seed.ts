/**
 * Seed mínimo — Etapa 0.2 (plan maestro §6).
 * Inserta el catálogo de permisos (§8) y los roles espejo del modelo OpenFGA (§4.3),
 * con sus bundles rol→permiso. Este catálogo es el espejo LEGIBLE para la UI de
 * configuración (§4.1); la fuente de verdad de autorización es OpenFGA (Etapa 0.3).
 * Idempotente: usa upsert en todo.
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// El CLI de Prisma carga el .env raíz vía prisma.config.ts; al correr con tsx hay que cargarlo aquí.
config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

/** Catálogo de permisos atómicos (§8). */
const PERMISSIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'project:create', label: 'Crear proyectos' },
  { key: 'project:kpi:define', label: 'Definir KPIs' },
  { key: 'task:create', label: 'Crear tareas' },
  { key: 'task:assign', label: 'Asignar tareas' },
  { key: 'document:upload', label: 'Subir documento' },
  { key: 'document:sign:qa', label: 'Firmar QA' },
  { key: 'document:sign:client', label: 'Firmar cliente' },
  { key: 'asset:checklist:run', label: 'Ejecutar checklist' },
  { key: 'asset:location:view', label: 'Ver ubicación de activo' },
  { key: 'asset:history:view', label: 'Ver históricos de activo' },
  { key: 'asset:create', label: 'Crear activo' },
  { key: 'asset:doc:upload', label: 'Subir doc de activo' },
  { key: 'asset:doc:approve', label: 'Aprobar doc de activo' },
  { key: 'finance:reimbursement:import', label: 'Importar reembolsos' },
  { key: 'finance:print:batch', label: 'Impresión en lote' },
  { key: 'directory:view:extended', label: 'Ver datos extendidos de directorio' },
  // Revisión de documentos personales (§6-1.5). Espejo legible; la autorización
  // real es FGA (organization#can_review_documents = admin). Solo org_admin.
  { key: 'document:review', label: 'Revisar documentos' },
  // Provisión de usuarios (§1.1). Espejo legible; la autorización real es FGA
  // (organization#can_manage_users = admin). Solo el rol org_admin los porta.
  { key: 'user:create', label: 'Crear usuarios' },
  { key: 'user:read', label: 'Ver usuarios' },
  { key: 'user:update', label: 'Editar usuarios' },
  { key: 'role:assign', label: 'Asignar roles a usuarios' },
];

/** Permisos de gestión de usuarios (§1.1) — solo para org_admin. */
const USER_MANAGEMENT_PERMISSIONS = ['user:create', 'user:read', 'user:update', 'role:assign'];

/**
 * Roles = bundles (§3.1). Keys alineadas con las relaciones de asignación directa de §4.3.
 * El mapeo refleja las derivaciones del DSL:
 *  - org_admin / department_admin derivan project_creator (admin from department).
 *  - project_creator → can_create_task, can_assign_task, can_define_kpi, can_create_service
 *    (asset.can_create deriva de can_create_service).
 *  - operator → can_create_task, can_upload_revision (document:upload).
 *  - qa → can_sign_qa · client_ito → can_sign_client · finance → permisos finance:*.
 *  - viewer → solo can_view (sin permiso atómico en el catálogo §8): bundle vacío.
 *  - asset:checklist:run es relación "assigned" (por asignación, no por rol): sin bundle.
 */
const ROLES: ReadonlyArray<{ key: string; label: string; permissions: string[] }> = [
  {
    key: 'org_admin',
    // admin deriva a todo (§4.3): el catálogo completo incluye los permisos de
    // gestión de usuarios (§1.1). El dedup vía Set deja explícita la inclusión.
    label: 'Administrador de organización',
    permissions: [...new Set([...PERMISSIONS.map((p) => p.key), ...USER_MANAGEMENT_PERMISSIONS])],
  },
  {
    key: 'department_admin',
    label: 'Administrador de departamento',
    // 'directory:view:extended' NO se incluye: el modelo OpenFGA deriva
    // can_view_directory_extended solo de organization#admin (org_admin). El
    // espejo del catálogo debe coincidir con FGA para no prometer un acceso que
    // el guard niega (§4.1). Si más adelante los dept admins deben verlo, hay que
    // extender la relación en fga/model.fga primero.
    permissions: [
      'project:create',
      'project:kpi:define',
      'task:create',
      'task:assign',
      'asset:create',
    ],
  },
  {
    key: 'project_creator',
    label: 'Creador de proyecto',
    permissions: ['project:create', 'project:kpi:define', 'task:create', 'task:assign', 'asset:create'],
  },
  {
    key: 'operator',
    label: 'Operador',
    permissions: ['task:create', 'document:upload', 'asset:doc:upload'],
  },
  { key: 'qa', label: 'QA', permissions: ['document:sign:qa'] },
  {
    key: 'finance',
    label: 'Finanzas',
    permissions: ['finance:reimbursement:import', 'finance:print:batch'],
  },
  { key: 'viewer', label: 'Visualizador', permissions: [] },
  { key: 'client_ito', label: 'Cliente ITO', permissions: ['document:sign:client'] },
];

async function main(): Promise<void> {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label },
      create: perm,
    });
  }
  console.log(`Permisos asegurados: ${PERMISSIONS.length}`);

  for (const role of ROLES) {
    const created = await prisma.role.upsert({
      where: { key: role.key },
      update: { label: role.label },
      create: { key: role.key, label: role.label },
    });
    for (const permKey of role.permissions) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: created.id, permissionId: perm.id } },
        update: {},
        create: { roleId: created.id, permissionId: perm.id },
      });
    }
  }
  console.log(`Roles asegurados: ${ROLES.map((r) => r.key).join(', ')}`);

  const bundles = await prisma.rolePermission.count();
  console.log(`Bundles rol→permiso: ${bundles}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
