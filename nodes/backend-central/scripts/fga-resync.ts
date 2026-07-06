/**
 * Resync masivo Postgres → OpenFGA (one-off tras migrar datos a un store FGA nuevo).
 * Reconstruye las tuplas que el backend escribe normalmente al crear usuarios/proyectos:
 *  - organization:gmt#member  para TODOS los usuarios (acceso org base).
 *  - relación por membresía (MEMBERSHIP_RELATION_MAP): org_admin→admin, roles de
 *    proyecto/servicio→su relación. Roles funcionales @ORG no generan tupla (correcto).
 *  - estructurales: department#organization, project#department, project#client, service#project.
 * Idempotente: tolera "already exists". Roles CUSTOM (isSystem=false) se listan aparte
 * (sus grants estructurales requieren resyncRole del FgaService; no hay ninguno en datos de sistema).
 *
 * Uso: env DATABASE_URL, FGA_API_URL, FGA_STORE_ID, FGA_MODEL_ID apuntando al entorno destino.
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { OpenFgaClient } from '@openfga/sdk';
import { MEMBERSHIP_RELATION_MAP, SCOPE_OBJECT_TYPE } from '../src/fga/fga.types';
import { ORG_ID } from '../src/common/org.constant';

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();
const fga = new OpenFgaClient({
  apiUrl: process.env.FGA_API_URL as string,
  storeId: process.env.FGA_STORE_ID as string,
  authorizationModelId: process.env.FGA_MODEL_ID,
});

interface T {
  user: string;
  relation: string;
  object: string;
}

async function writeTolerant(t: T): Promise<'ok' | 'skip' | 'fail'> {
  try {
    await fga.write({ writes: [t] });
    return 'ok';
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    const extra = JSON.stringify(e ?? {});
    if (/already exists|write_failed_due_to_invalid_input|duplicate/i.test(m + extra)) return 'skip';
    console.error('FAIL', JSON.stringify(t), m);
    return 'fail';
  }
}

async function main(): Promise<void> {
  const seen = new Set<string>();
  const tuples: T[] = [];
  const add = (t: T): void => {
    const id = `${t.user}|${t.relation}|${t.object}`;
    if (!seen.has(id)) {
      seen.add(id);
      tuples.push(t);
    }
  };

  const users = await prisma.user.findMany({ select: { id: true } });
  for (const u of users) add({ user: `user:${u.id}`, relation: 'member', object: `organization:${ORG_ID}` });

  const departments = await prisma.department.findMany({ select: { id: true } });
  for (const d of departments) add({ user: `organization:${ORG_ID}`, relation: 'organization', object: `department:${d.id}` });

  const projects = await prisma.project.findMany({ select: { id: true, departmentId: true, clientId: true } });
  for (const p of projects) {
    add({ user: `department:${p.departmentId}`, relation: 'department', object: `project:${p.id}` });
    add({ user: `client:${p.clientId}`, relation: 'client', object: `project:${p.id}` });
  }

  const services = await prisma.service.findMany({ select: { id: true, projectId: true } });
  for (const s of services) add({ user: `project:${s.projectId}`, relation: 'project', object: `service:${s.id}` });

  const roles = await prisma.role.findMany({ select: { key: true, isSystem: true } });
  const isSystem = new Map(roles.map((r) => [r.key, r.isSystem]));
  const customRoles = new Set<string>();
  let unmapped = 0;
  const memberships = await prisma.membership.findMany({ select: { userId: true, roleKey: true, scopeType: true, scopeId: true } });
  for (const m of memberships) {
    if (isSystem.get(m.roleKey) === false) {
      customRoles.add(m.roleKey);
      continue;
    }
    const relByRole = (MEMBERSHIP_RELATION_MAP as Record<string, Record<string, string>>)[m.scopeType] ?? {};
    const rel = relByRole[m.roleKey];
    if (rel) {
      const objType = (SCOPE_OBJECT_TYPE as Record<string, string>)[m.scopeType];
      add({ user: `user:${m.userId}`, relation: rel, object: `${objType}:${m.scopeId}` });
    } else {
      unmapped++;
    }
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const t of tuples) {
    const r = await writeTolerant(t);
    if (r === 'ok') ok++;
    else if (r === 'skip') skip++;
    else fail++;
  }

  console.log(
    `RESYNC FGA: total=${tuples.length} escritas=${ok} ya_existian=${skip} fallidas=${fail} | ` +
      `membresias_no_mapeadas(func@ORG)=${unmapped} | roles_custom=${[...customRoles].join(',') || 'ninguno'} | ` +
      `usuarios=${users.length} depts=${departments.length} proyectos=${projects.length} servicios=${services.length} membresias=${memberships.length}`,
  );

  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
