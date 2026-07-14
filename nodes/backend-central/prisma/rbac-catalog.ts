/**
 * Catálogo RBAC (permisos + bundles de rol) — fuente de verdad testeable.
 * `seed.ts` lo importa y hace el upsert idempotente; los tests validan invariantes
 * sin tocar la BD. Convención de claves: `:` (consistente con §8).
 */
export type Kind = 'FUNCTIONAL' | 'STRUCTURAL';
export type Scope = 'OWN' | 'PROJECT' | 'GLOBAL';

export interface PermDef {
  key: string;
  label: string;
  module: string;
  kind: Kind;
  fgaRelation?: string; // solo STRUCTURAL: relación FGA a consultar para el scope PROJECT
  scopeable: boolean; // false = sin selector de scope en la matriz (siempre GLOBAL)
}

export interface RoleDef {
  key: string;
  label: string;
  grants: ReadonlyArray<{ perm: string; scope: Scope }>;
}

/** Helper: grant con scope (default PROJECT). */
export const g = (perm: string, scope: Scope = 'PROJECT'): { perm: string; scope: Scope } => ({ perm, scope });

/** Catálogo de permisos atómicos (§8 + tareas/v-metric del Módulo 5 + finanzas/proyectos/sistema Fase 1). */
export const PERMISSIONS: ReadonlyArray<PermDef> = [
  // ── sistema / rbac ──
  { key: 'user:create', label: 'Crear usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'user:read', label: 'Ver usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'user:update', label: 'Editar usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'role:assign', label: 'Asignar roles a usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'system:beta:full', label: 'Acceso completo con alerta de beta', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
  // ── directorio ──
  { key: 'directory:view:extended', label: 'Ver datos extendidos de directorio', module: 'directorio', kind: 'STRUCTURAL', fgaRelation: 'can_view_directory_extended', scopeable: true },
  // ── clientes ──
  { key: 'client:create', label: 'Crear cliente', module: 'clientes', kind: 'FUNCTIONAL', scopeable: false },
  // ── proveedores / bodegas (subsecciones con permiso especial) ──
  // Acceso a la subsección Proveedores (list/detalle/crear/productos/ratings/limpiar).
  // FUNCTIONAL org-scope (siempre GLOBAL): gatea toda la subsección, no un recurso por proyecto.
  { key: 'provider:access', label: 'Acceder a Proveedores', module: 'proveedores', kind: 'FUNCTIONAL', scopeable: false },
  // Acceso a la subsección Bodegas/Insumos (bodegas: list/detalle/crear/transacciones; insumos: list/crear/importar).
  { key: 'warehouse:access', label: 'Acceder a Bodegas', module: 'bodegas', kind: 'FUNCTIONAL', scopeable: false },
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
  { key: 'project:delete', label: 'Eliminar proyecto', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: true },
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
  // Permisos FUNCTIONAL org-scope de Fase 1 (spec §2.2/§2.3). Siempre GLOBAL:
  // gates de UI/módulo + bundle. El enforcement real (crear cliente/faena/
  // proyecto/equipo, subir docs) sigue en los endpoints existentes / plan de Proyectos.
  { key: 'project:view:all', label: 'Ver toda la sección proyectos (solo lectura)', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:manage', label: 'Gestionar proyectos (cliente/faena/proyecto + equipo)', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:doc:upload:worker', label: 'Subir documentación de trabajadores', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:doc:upload:project', label: 'Subir documentación del proyecto', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:doc:upload:hse', label: 'Subir documentación HSE', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
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
  // Permisos FUNCTIONAL org-scope de Fase 1 (spec §2.2). Siempre GLOBAL. Su
  // enforcement en endpoints de finanzas es del plan de Finanzas (spec §2.4).
  { key: 'finance:request:create', label: 'Crear solicitudes propias (reembolso + horas extra)', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:overtime:create:onbehalf', label: 'Crear horas extra en nombre de otro (sin restricción de fecha)', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:request:view:all', label: 'Ver todas las solicitudes', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:overtime:view:all', label: 'Ver todas las horas extra', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:request:approve', label: 'Aprobar / rechazar solicitudes', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:payment:register', label: 'Registrar pago', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
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
  // Relaciones FGA de activos que se heredan al ASIGNAR el activo/proyecto (no se
  // marcan en un rol): existen en el catálogo como STRUCTURAL informativos y NO
  // componibles (fuera de COMPOSABLE_STRUCTURAL). Cierran el hueco de las relaciones
  // huérfanas can_view_list / can_view_speed del modelo FGA (tipo asset).
  { key: 'asset:list:view', label: 'Ver listado de activos', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_list', scopeable: true },
  { key: 'asset:speed:view', label: 'Ver velocidad del activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_speed', scopeable: true },
  { key: 'asset:fields:edit', label: 'Editar campos de equipo', module: 'recursos', kind: 'FUNCTIONAL', scopeable: true },
  // Acceso de SOLO LECTURA al módulo Recursos (enciende la pestaña de nav vía
  // PERMISSION_MODULE en auth.controller). FUNCTIONAL org-scope (siempre GLOBAL):
  // NO concede los botones de crear/configurar (esos dependen de asset:manage).
  { key: 'asset:read', label: 'Ver recursos (solo lectura)', module: 'recursos', kind: 'FUNCTIONAL', scopeable: false },
  // Ejecutar el checklist de CUALQUIER activo (admin/gerencia), sin depender de la
  // asignación por-activo (can_run_checklist). FUNCTIONAL org-scope (siempre GLOBAL);
  // el submit lo honra ADEMÁS del gate estructural del usuario asignado.
  { key: 'asset:checklist:run:any', label: 'Ejecutar checklist de cualquier activo', module: 'recursos', kind: 'FUNCTIONAL', scopeable: false },
];

/** Todo el catálogo a GLOBAL EXCEPTO system:beta:full (org_admin / admin_ti). */
const ALL_GLOBAL_EXCEPT_BETA = (): ReadonlyArray<{ perm: string; scope: Scope }> =>
  PERMISSIONS.filter((p) => p.key !== 'system:beta:full').map((p) => g(p.key, 'GLOBAL'));

/**
 * Roles = bundles (§3.1). Keys alineadas con las relaciones de §4.3. `isSystem`.
 * org_admin / admin_ti reciben TODO el catálogo a GLOBAL menos system:beta:full.
 *
 * RESOLUCIÓN #2 (Fase 1 INDICE, override): `finance:request:create` es un derecho
 * BASE de todo trabajador → va en el bundle de LOS 10 roles de sistema. Los roles
 * cuyo bundle es ALL_GLOBAL_EXCEPT_BETA (org_admin, admin_ti) ya lo incluyen por
 * el catálogo; el resto lo declara explícitamente.
 */
export const ROLES: ReadonlyArray<RoleDef> = [
  { key: 'org_admin', label: 'Administrador de organización', grants: ALL_GLOBAL_EXCEPT_BETA() },
  {
    key: 'department_admin',
    label: 'Administrador de departamento',
    grants: [g('project:create', 'GLOBAL'), g('client:create', 'GLOBAL'), g('faena:create', 'GLOBAL'), g('provider:access', 'GLOBAL'), g('warehouse:access', 'GLOBAL'), g('project:team:manage'), g('asset:fields:edit'), g('project:read'), g('project:update'), g('project:delete'), g('project:kpi:define'), g('task:create'), g('task:assign'), g('task:read'), g('asset:manage'), g('asset:create')],
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
  // ── Roles de sistema Fase 1 (spec §2.3) — bundles GLOBAL. `finance:request:create`
  //    va en LOS 10 (RESOLUCIÓN #2). ──
  { key: 'trabajador', label: 'Trabajador', grants: [g('finance:request:create', 'GLOBAL')] },
  {
    key: 'admin_contrato',
    label: 'Administrador de Contrato',
    grants: [
      g('finance:request:create', 'GLOBAL'),
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:request:approve', 'GLOBAL'),
      g('finance:overtime:create:onbehalf', 'GLOBAL'),
      g('project:manage', 'GLOBAL'),
      g('asset:read', 'GLOBAL'),
      g('asset:checklist:run:any', 'GLOBAL'),
    ],
  },
  {
    key: 'admin_finanzas',
    label: 'Administrador de Finanzas',
    grants: [
      g('finance:request:create', 'GLOBAL'),
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:request:approve', 'GLOBAL'),
      g('finance:payment:register', 'GLOBAL'),
      g('finance:print:batch', 'GLOBAL'),
      g('project:view:all', 'GLOBAL'),
      g('project:doc:upload:worker', 'GLOBAL'),
      g('project:doc:upload:project', 'GLOBAL'),
      g('asset:read', 'GLOBAL'),
      g('asset:checklist:run:any', 'GLOBAL'),
    ],
  },
  {
    key: 'analista_rh',
    label: 'Analista de RH',
    grants: [
      g('finance:request:create', 'GLOBAL'),
      g('finance:overtime:view:all', 'GLOBAL'),
      g('project:view:all', 'GLOBAL'),
      g('project:doc:upload:worker', 'GLOBAL'),
    ],
  },
  {
    key: 'analista_finanzas',
    label: 'Analista de Finanzas',
    grants: [
      g('finance:request:create', 'GLOBAL'),
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:payment:register', 'GLOBAL'),
      g('finance:print:batch', 'GLOBAL'),
    ],
  },
  {
    key: 'asesor_hse',
    label: 'Asesor HSE',
    grants: [
      g('finance:request:create', 'GLOBAL'),
      g('project:view:all', 'GLOBAL'),
      g('project:doc:upload:hse', 'GLOBAL'),
    ],
  },
  {
    key: 'gerencia_proyectos',
    label: 'Gerencia de Proyectos',
    grants: [
      g('finance:request:create', 'GLOBAL'),
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:request:approve', 'GLOBAL'),
      g('finance:overtime:create:onbehalf', 'GLOBAL'),
      g('project:manage', 'GLOBAL'),
      g('asset:read', 'GLOBAL'),
      g('asset:checklist:run:any', 'GLOBAL'),
    ],
  },
  { key: 'gerencia_rh', label: 'Gerencia de RH', grants: [g('finance:request:create', 'GLOBAL'), g('system:beta:full', 'GLOBAL')] },
  { key: 'gerencia_general', label: 'Gerencia General', grants: [g('finance:request:create', 'GLOBAL'), g('system:beta:full', 'GLOBAL')] },
  { key: 'admin_ti', label: 'Administrador TI', grants: ALL_GLOBAL_EXCEPT_BETA() },
];
