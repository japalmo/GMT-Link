-- #68 Firma verificada: WebAuthn (biometría) + fallback OTP al correo.
-- Additive: 2 enums + 3 tablas nuevas. No toca datos existentes.

-- Enums
CREATE TYPE "SignatureMethod" AS ENUM ('WEBAUTHN', 'EMAIL_OTP');
CREATE TYPE "SignatureContextType" AS ENUM ('CHECKLIST_SUBMISSION', 'PROJECT_DOCUMENT');

-- Llaves WebAuthn (passkeys) registradas por usuario+dispositivo.
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "deviceName" TEXT,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");
CREATE INDEX "webauthn_credentials_userId_idx" ON "webauthn_credentials"("userId");
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Desafíos de un solo uso (registro o firma), TTL corto.
CREATE TABLE "webauthn_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "contextType" TEXT,
    "contextId" TEXT,
    "contextHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webauthn_challenges_userId_purpose_idx" ON "webauthn_challenges"("userId", "purpose");
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pruebas de firma verificada (polimórficas por contextType + contextId).
CREATE TABLE "signature_proofs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "SignatureMethod" NOT NULL,
    "contextType" "SignatureContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "credentialId" TEXT,
    "deviceName" TEXT,
    "signature" BYTEA,
    "authenticatorData" BYTEA,
    "clientDataJSON" BYTEA,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signature_proofs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "signature_proofs_contextType_contextId_idx" ON "signature_proofs"("contextType", "contextId");
CREATE INDEX "signature_proofs_userId_idx" ON "signature_proofs"("userId");
ALTER TABLE "signature_proofs" ADD CONSTRAINT "signature_proofs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
