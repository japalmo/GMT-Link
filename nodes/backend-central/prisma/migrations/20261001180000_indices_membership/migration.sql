-- Indices de busqueda en "Membership".
--
-- El unico indice compuesto existente empieza por "userId", asi que las
-- busquedas por rol (resync de OpenFGA al editar un rol) y por scope (usuarios
-- de un proyecto) recorrian la tabla completa.
--
-- Aditiva e idempotente: solo crea indices y no falla si ya existen. Los nombres
-- son los que Prisma deriva de @@index, para que `migrate diff` no vea deriva.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Membership_roleKey_idx" ON "Membership"("roleKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Membership_scopeType_scopeId_idx" ON "Membership"("scopeType", "scopeId");
