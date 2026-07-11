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
import { PERMISSIONS, ROLES } from './rbac-catalog';

// El CLI de Prisma carga el .env raíz vía prisma.config.ts; al correr con tsx hay que cargarlo aquí.
config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

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
