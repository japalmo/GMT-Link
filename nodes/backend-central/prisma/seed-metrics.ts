import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, VariableType, ScopeType } from '@prisma/client';

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

const POZAS = [
  { code: 'R1', name: 'Reservorio 1', cota_lamina_critica: 2301.80, cota_salm: 2301.429, cota_sal_ref: 2301.14, cota_fondo: 2300.70, cota_segura: 2301.50 },
  { code: 'R2', name: 'Reservorio 2', cota_lamina_critica: 2302.13, cota_salm: 2301.737, cota_sal_ref: 2301.17, cota_fondo: 2300.74, cota_segura: 2301.83 },
  { code: 'R3', name: 'Reservorio 3', cota_lamina_critica: 2302.11, cota_salm: 2301.404, cota_sal_ref: 2301.19, cota_fondo: 2300.52, cota_segura: 2301.81 },
  { code: 'R4', name: 'Reservorio 4', cota_lamina_critica: 2302.10, cota_salm: 2301.909, cota_sal_ref: 2301.09, cota_fondo: 2300.60, cota_segura: 2301.80 },
  { code: 'R5', name: 'Reservorio 5', cota_lamina_critica: 2302.04, cota_salm: 2302.013, cota_sal_ref: 2301.66, cota_fondo: 2301.20, cota_segura: 2301.74 },
  { code: 'R6', name: 'Reservorio 6', cota_lamina_critica: 2302.45, cota_salm: 2301.588, cota_sal_ref: 2301.33, cota_fondo: 2300.57, cota_segura: 2302.15 },
  { code: 'R7', name: 'Reservorio 7', cota_lamina_critica: 2302.37, cota_salm: 2302.183, cota_sal_ref: 2301.70, cota_fondo: 2301.29, cota_segura: 2302.07 },
  { code: 'R8', name: 'Reservorio 8', cota_lamina_critica: 2301.91, cota_salm: 2301.910, cota_sal_ref: 2301.54, cota_fondo: 2300.65, cota_segura: 2301.61 },
  { code: 'R9', name: 'Reservorio 9', cota_lamina_critica: 2301.663, cota_salm: 2301.663, cota_sal_ref: 2301.22, cota_fondo: 2300.63, cota_segura: 2301.53 },
  { code: 'R10', name: 'Reservorio 10', cota_lamina_critica: 2301.91, cota_salm: 2301.302, cota_sal_ref: 2300.97, cota_fondo: 2300.66, cota_segura: 2301.61 },
];

const VARIABLES = [
  { code: 'cota_espejo', name: 'Cota de Espejo de Agua', type: VariableType.SCALAR, unit: 'm' },
  { code: 'cota_sal', name: 'Cota de Sal', type: VariableType.SCALAR, unit: 'm' },
  { code: 'vol_salmuera_total', name: 'Volumen Total Salmuera', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'vol_salmuera_libre', name: 'Volumen Salmuera Libre', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'vol_sal', name: 'Volumen de Sal', type: VariableType.SCALAR, unit: 'm³' },
  { code: 'dem_file', name: 'Archivo DEM GeoTIFF', type: VariableType.FILE, unit: 'archivo' },
];

async function main(): Promise<void> {
  // 1. Asegurar Cliente
  const client = await prisma.client.upsert({
    where: { code: 'gmt' },
    update: { name: 'GMT Operaciones' },
    create: { code: 'gmt', name: 'GMT Operaciones' },
  });
  console.log(`Cliente: ${client.name} (id=${client.id})`);

  // 2. Asegurar Faena (jerarquía Cliente→Faena→Proyecto del esquema actual).
  const faena = await prisma.faena.upsert({
    where: { clientId_code: { clientId: client.id, code: 'ATA' } },
    update: { name: 'Faena Atacama' },
    create: { code: 'ATA', name: 'Faena Atacama', clientId: client.id },
  });
  console.log(`Faena: ${faena.name} (id=${faena.id})`);

  // 2b. Departamento: la autorización estructural de OpenFGA deriva `can_view` de
  //     proyecto por la cadena proyecto→department→organization. Sin departamento el
  //     proyecto no es visible ni para el org_admin (el gate de métricas usa fga.check
  //     crudo, sin el bypass funcional). Se adjunta a OPS y `fga-resync` escribe la tupla.
  const department = await prisma.department.upsert({
    where: { code: 'OPS' },
    update: {},
    create: { code: 'OPS', name: 'Operaciones' },
  });

  // 3. Asegurar Proyecto (único por [faenaId, code]).
  const project = await prisma.project.upsert({
    where: { faenaId_code: { faenaId: faena.id, code: 'ATA' } },
    update: { name: 'Proyecto Atacama', departmentId: department.id },
    create: {
      code: 'ATA',
      name: 'Proyecto Atacama',
      faenaId: faena.id,
      clientId: client.id,
      departmentId: department.id,
    },
  });
  console.log(`Proyecto: ${project.name} (id=${project.id}, dept=${department.code})`);

  // 4. Asegurar Servicio
  const service = await prisma.service.upsert({
    where: { projectId_code: { projectId: project.id, code: 'CUB' } },
    update: { name: 'Servicio Cubicaciones Pozas' },
    create: {
      code: 'CUB',
      name: 'Servicio Cubicaciones Pozas',
      projectId: project.id,
      docCodingConfig: {},
    },
  });
  console.log(`Servicio: ${service.name} (id=${service.id})`);

  // 5. Asegurar Pozas (Elements)
  for (const poza of POZAS) {
    const { cota_lamina_critica, cota_salm, cota_sal_ref, cota_fondo, cota_segura, ...base } = poza;
    const metadata = { cota_lamina_critica, cota_salm, cota_sal_ref, cota_fondo, cota_segura };

    await prisma.element.upsert({
      where: { code: base.code },
      update: { name: base.name, type: 'POZA', metadata, projectId: project.id },
      create: { code: base.code, name: base.name, type: 'POZA', metadata, projectId: project.id },
    });
  }
  console.log(`Pozas registradas: ${POZAS.length}`);

  // 6. Asegurar Fase
  const phase = await prisma.phase.upsert({
    where: { serviceId_code: { serviceId: service.id, code: 'anual-2026' } },
    update: { name: 'Campaña Anual 2026' },
    create: {
      code: 'anual-2026',
      name: 'Campaña Anual 2026',
      serviceId: service.id,
    },
  });
  console.log(`Fase: ${phase.name} (id=${phase.id})`);

  // 7. Asegurar Variables
  for (const variable of VARIABLES) {
    await prisma.variable.upsert({
      where: { phaseId_code: { phaseId: phase.id, code: variable.code } },
      update: { name: variable.name, type: variable.type, unit: variable.unit },
      create: {
        code: variable.code,
        name: variable.name,
        type: variable.type,
        unit: variable.unit,
        phaseId: phase.id,
      },
    });
  }
  console.log(`Variables registradas: ${VARIABLES.length}`);

  // 8. Acceso demo a V-Metric: admin y gerencia deben VER el proyecto ATA. El gate de
  //    métricas usa fga.check('can_view') estructural, así que un rol funcional org no
  //    basta: hace falta una relación FGA por-proyecto. Se crea una membresía `viewer`
  //    (roleKey 'viewer' → MEMBERSHIP_RELATION_MAP PROJECT → FGA viewer → can_view) en ATA
  //    para cada usuario con rol org admin_* o gerencia_*; fga-resync (paso siguiente del
  //    arranque) materializa la tupla. Idempotente. El org_admin ya ve ATA por la cadena
  //    org→depto→proyecto, así que no necesita esta membresía.
  const adminGerencia = await prisma.membership.findMany({
    where: {
      scopeType: ScopeType.ORGANIZATION,
      OR: [{ roleKey: { startsWith: 'admin_' } }, { roleKey: { startsWith: 'gerencia_' } }],
    },
    select: { userId: true },
  });
  const viewerUserIds = [...new Set(adminGerencia.map((m) => m.userId))];
  for (const userId of viewerUserIds) {
    await prisma.membership.upsert({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: 'viewer',
          scopeType: ScopeType.PROJECT,
          scopeId: project.id,
        },
      },
      update: {},
      create: { userId, roleKey: 'viewer', scopeType: ScopeType.PROJECT, scopeId: project.id },
    });
  }
  console.log(`Acceso V-Metric (viewer@ATA) para admin/gerencia: ${viewerUserIds.length} usuarios`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
