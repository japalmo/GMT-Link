-- Remove the Inventario feature area (módulo Inventario + Bodegas + Proveedores +
-- pestaña Insumos). Se elimina todo el código y los datos (tablas vacías en
-- producción; nadie asignado al rol logística). CASCADE limpia las FKs entrantes;
-- las columnas del modelo User que apuntaban a estas tablas ya se quitaron del schema.
DROP TABLE IF EXISTS "supply_assignments" CASCADE;
DROP TABLE IF EXISTS "supply_request_items" CASCADE;
DROP TABLE IF EXISTS "supply_requests" CASCADE;
DROP TABLE IF EXISTS "supply_providers" CASCADE;
DROP TABLE IF EXISTS "warehouse_transactions" CASCADE;
DROP TABLE IF EXISTS "warehouse_stocks" CASCADE;
DROP TABLE IF EXISTS "supplies" CASCADE;
DROP TABLE IF EXISTS "warehouses" CASCADE;
DROP TABLE IF EXISTS "provider_ratings" CASCADE;
DROP TABLE IF EXISTS "provider_products" CASCADE;
DROP TABLE IF EXISTS "providers" CASCADE;

DROP TYPE IF EXISTS "WarehouseTxType";
DROP TYPE IF EXISTS "SupplyRequestStatus";

-- El seed es upsert-only (nunca borra lo que se quitó del catálogo), así que la
-- BD de producción conserva los permisos y el rol de sistema del área eliminada.
-- Se purgan explícitamente: los RolePermission caen por onDelete: Cascade desde
-- Permission y Role (así se limpian los grants en department_admin y en los roles
-- base de trabajador). Membership.roleKey -> Role.key es Restrict, pero hay 0
-- usuarios con el rol 'logistica', por lo que el borrado no se bloquea.
DELETE FROM "Permission" WHERE "key" IN (
  'inventory:access',
  'inventory:request:own',
  'provider:access',
  'warehouse:access'
);
DELETE FROM "Role" WHERE "key" = 'logistica';

-- Referencias al rol 'logistica' por STRING (sin FK, no las alcanza el CASCADE).
-- La sustantiva es permission_requests: una solicitud PENDIENTE del rol borrado
-- fallaría con P2003 al aprobarse (crea Membership contra un Role.key inexistente).
-- Las otras dos se esperan vacías (0 usuarios logística, logros nunca alcanzables),
-- se limpian por higiene.
DELETE FROM "permission_requests" WHERE "roleKey" = 'logistica';
DELETE FROM "ProjectWorkerAssignment" WHERE "roleKey" = 'logistica';
DELETE FROM "user_achievements" WHERE "achievementKey" IN ('warehouse_10', 'evaluator_5');
