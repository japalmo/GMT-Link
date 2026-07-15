# Firma verificada (biometría / WebAuthn) — Diseño para revisión

> **Estado:** propuesta para tu OK (#68). NO se ha construido nada. Antes de escribir código
> necesito tu decisión en las preguntas del final, porque hay dos temas de factibilidad que
> cambian por completo el alcance.

**Fecha:** 2026-07-15
**Autor:** Claude (para revisión de Juan Apalmo)

---

## 1. Qué tenemos hoy (firma "blanda")

Hoy una firma en GMT Link es un registro de base de datos atado a la sesión:

- **Documentos de proyecto** (`ProjectDocument`): `qaSignerId` + `qaSignedAt` (y `clientSignerId` +
  `clientSignedAt`). Es decir: "el usuario X, que tenía sesión iniciada, apretó Firmar el día T".
- **Checklists** (`ChecklistSubmission`): `userId` + `createdAt`. La sección "Firma" del formulario
  (la que replicamos en #64) es texto/diagrama, sin vínculo criptográfico.

El problema: si alguien cuestiona una firma ("yo no firmé eso"), lo único que tenemos es un token
de sesión y un registro en la BD. No hay prueba de que la persona real, presente, haya consentido
ESE contenido en ESE momento. Eso es lo que #68 busca subir de nivel.

## 2. Qué garantiza WebAuthn (y qué NO)

WebAuthn / passkeys (estándar FIDO2) permite que el dispositivo firme un desafío con una llave
privada que nunca sale del dispositivo, y que solo se desbloquea con la biometría o PIN del equipo
(Windows Hello, Touch ID, biometría de Android).

**Lo que SÍ garantiza (no-repudio fuerte):** que un dispositivo REGISTRADO por ese usuario, con
verificación de usuario presente (biometría/PIN), firmó criptográficamente un contenido específico
en un momento específico. El servidor verifica la firma contra la llave pública guardada. Esto es
muchísimo más fuerte que la firma blanda de hoy.

**Lo que NO es:** WebAuthn NO identifica "esta huella dactilar es de Felipe". La biometría solo
desbloquea la llave EN el dispositivo; nunca viaja al servidor. La prueba es "dispositivo registrado
+ usuario verificado en el equipo", no "esta persona biométricamente".

## 3. Dos temas de factibilidad que definen el alcance (decisión tuya)

### 3.1 Validez legal en Chile (Ley 19.799)

La ley chilena distingue **firma electrónica simple** y **firma electrónica avanzada (FEA)**. La FEA
exige un certificado emitido por un **prestador acreditado** (E-Sign, Acepta, etc.). WebAuthn, por
sí solo, es una **firma electrónica simple con no-repudio fuerte**, NO es FEA acreditada.

- Si el objetivo es **control operacional interno** (dejar constancia sólida de quién firmó qué
  checklist/documento, defendible ante un cliente o una auditoría interna): WebAuthn es excelente
  y suficiente.
- Si el objetivo es **validez legal plena de FEA** (documentos que deban tener el mismo valor que
  una firma manuscrita ante terceros/tribunales): WebAuthn NO alcanza; habría que integrar un
  prestador acreditado (otro proyecto, con costo por firma).

**Necesito saber cuál de los dos buscas.** El resto del diseño asume el primero (no-repudio
operacional), que es lo que cubre la biometría.

### 3.2 Dispositivos compartidos en faena

La biometría de plataforma (Windows Hello / Touch ID) va atada al **usuario del sistema operativo**,
no al usuario de la app. En un tablet de faena compartido con UN solo login de Windows/Android,
NO se puede tener una biometría distinta por trabajador: todos desbloquearían la misma llave.

- En **dispositivos personales** (el celular de cada trabajador, el notebook de cada supervisor):
  biometría funciona perfecto.
- En **dispositivos compartidos** (un tablet de la faena que rota entre trabajadores): la biometría
  no sirve para distinguir personas. Ahí necesitamos un segundo camino.

Por eso propongo NO amarrar la firma verificada solo a biometría, sino a una abstracción con dos
proveedores (ver abajo).

## 4. Diseño propuesto: "firma verificada" con dos proveedores

Una sola abstracción de firma que produce una **prueba auditable ligada a un hash del contenido**,
con dos formas de obtenerla:

1. **Biometría (WebAuthn)** — para dispositivos personales. La preferida: un toque, sin escribir nada.
2. **Código al correo (OTP)** — para dispositivos compartidos o equipos sin biometría. Reutiliza la
   infraestructura de OTP que acabamos de construir en #66 (mismo `OtpService` + correo).

Ambos caminos generan el mismo tipo de prueba: "usuario X confirmó el contenido con hash H el día T,
verificado por [biometría en dispositivo Y | código enviado a su correo]". El auditor ve el método
usado. Así la firma verificada funciona para TODOS los trabajadores, no solo los que tienen un
equipo con biometría.

## 5. Modelo de datos (nuevo)

```prisma
// Una llave registrada por un usuario en un dispositivo (WebAuthn).
model WebAuthnCredential {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  credentialId   String   @unique // base64url del credential id del autenticador
  publicKey      Bytes    // llave pública COSE (la usa el server para verificar)
  counter        Int      @default(0) // contador anti-clonación del autenticador
  deviceName     String?  // "Celular de Felipe", nombrado al registrar
  transports     String?  // hint de transporte (internal, hybrid, usb...)
  createdAt      DateTime @default(now())
  lastUsedAt     DateTime?
  @@index([userId])
}

// Desafío de un solo uso (registro o firma), con TTL corto. Single-use = anti-replay.
model WebAuthnChallenge {
  id          String   @id @default(cuid())
  userId      String
  challenge   String   // random, base64url
  purpose     String   // REGISTER | SIGN
  contextHash String?  // en SIGN: sha256 del contenido que se firma
  expiresAt   DateTime // ~2 minutos
  consumedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([userId, purpose])
}

// La prueba de firma que queda pegada al artefacto firmado (checklist/documento).
model SignatureProof {
  id           String   @id @default(cuid())
  userId       String
  method       String   // WEBAUTHN | EMAIL_OTP
  contextType  String   // CHECKLIST_SUBMISSION | PROJECT_DOCUMENT
  contextId    String   // id del checklist/documento firmado
  contextHash  String   // sha256 del contenido firmado (lo que se selló)
  // Para WEBAUTHN: la evidencia criptográfica verificable.
  credentialId String?
  signature    Bytes?
  authData     Bytes?
  clientData   Bytes?
  signedAt     DateTime @default(now())
  @@index([contextType, contextId])
}
```

Nota: no uso Redis para los desafíos (aún no está accesible desde Windows, ver CLAUDE.md); una
tabla con TTL + limpieza es suficiente y correcta (single-use).

## 6. Flujos

**Registro de dispositivo (una vez por equipo personal):**
Perfil → Seguridad → "Registrar este dispositivo para firmar" → el server genera opciones
(`generateRegistrationOptions`, excluye las llaves ya registradas) → el navegador corre la ceremonia
(`navigator.credentials.create`, pide biometría) → el server verifica y guarda `credentialId` +
`publicKey` + nombre del dispositivo.

**Firma de un checklist o documento:**
1. El usuario termina el checklist/documento y aprieta "Firmar".
2. El server calcula `contextHash = sha256(contenido)`, genera el desafío ligado a ese hash y lo
   guarda single-use.
3. Biometría: el navegador corre `navigator.credentials.get` con el desafío → toque biométrico →
   aserción firmada. / O el usuario pide "Firmar con código al correo" → OTP (infra de #66).
4. El server verifica la aserción contra la `publicKey` guardada (o verifica el OTP), chequea el
   contador anti-clonación, confirma que el `contextHash` coincide con el contenido real, y guarda
   `SignatureProof` pegado al artefacto.
5. En la auditoría futura: "firmado por Felipe, dispositivo 'Celular de Felipe', 2026-07-20 10:14,
   sobre el contenido con hash H, verificado criptográficamente" (o "código verificado al correo").

## 7. Librería

`@simplewebauthn/server` (verificación en el backend) + `@simplewebauthn/browser` (ceremonias en el
navegador). Es la librería madura y mantenida del ecosistema; maneja toda la complejidad de
COSE/CBOR/attestation. Coherente con la regla del repo de NO escribir criptografía a mano.

## 8. Alcance sugerido (por fases, si apruebas)

- **Fase 1:** modelo + registro de dispositivos WebAuthn + pantalla Perfil → Seguridad. Sin firmar
  nada todavía (solo enrolar).
- **Fase 2:** firmar el checklist con firma verificada (biometría + fallback OTP) + mostrar la prueba
  en el historial/ficha.
- **Fase 3:** extender a documentos de proyecto (reemplaza/complementa qaSignedAt/clientSignedAt).

## 9. Decisiones que necesito de ti antes de construir

1. **Objetivo legal:** ¿no-repudio operacional interno (WebAuthn basta) o firma electrónica
   avanzada con validez legal plena (requiere prestador acreditado, otro proyecto con costo)?
2. **Dispositivos compartidos:** ¿te sirve el enfoque de dos proveedores (biometría en equipos
   personales + código al correo en tablets compartidos), o el uso real es solo en equipos
   personales y podemos ir solo con biometría?
3. **Qué se firma:** ¿checklists, documentos de proyecto, o ambos? ¿Y es obligatorio firmar o es
   opcional/gradual?
4. **Enrolamiento:** ¿el registro de dispositivo es voluntario (el usuario lo activa) u obligatorio
   para ciertos roles?
