# Diseño — Autenticación propia (JWT) reemplazando Firebase

**Fecha:** 2026-06-26
**Estado:** aprobado (diseño) — pendiente revisión del spec antes del plan de implementación.

## 1. Contexto y objetivo

Hoy la app autentica con **Firebase Auth** (web con el SDK de Firebase → ID token; backend lo verifica con `firebase-admin` en `SessionMiddleware`). Para desplegar en Railway eso exige un *service account* secreto que el usuario debe cargar a mano. El objetivo es **reemplazar Firebase por autenticación propia (JWT)** dentro de `backend-central`, para que:
- No haya secretos de terceros que el usuario deba gestionar (yo seteo todo y entrego una URL pública con login funcionando).
- Coincida con lo que se esperaba ("autenticación propia").
- La demo en línea funcione end-to-end: **un admin sembrado** entra y **crea usuarios desde el sistema**.

Esto adelanta parcialmente la Fase 4 del diseño multicloud, pero **dentro de `backend-central`** (no en el nodo `auth-service` separado todavía — eso queda para después).

## 2. Decisiones (cerradas)

| Tema | Decisión |
| :-- | :-- |
| Mecanismo | Login propio email+contraseña → **JWT HS256** firmado por el backend (secreto `AUTH_JWT_SECRET`, que genero yo). |
| Hashing | **bcrypt** (cost 10) sobre `User.passwordHash`. |
| Token | TTL **7 días**, payload `{ sub: userId }`. **Sin refresh tokens** (YAGNI demo). Guardado en `localStorage` del navegador. |
| Firebase | Se **elimina** del flujo de auth (login, verificación, provisión, primer login, cambio de clave). `firebase-admin` deja de usarse. |
| OpenFGA | **No se despliega.** Verificado en `permission.service.ts`: el `org_admin` tiene grants GLOBAL → `can()` corta en `filter.kind==='none'` y permite sin tocar FGA. FGA queda lazy/no-configurado. |
| Seed | **Un solo usuario admin** (`org_admin`, ACTIVE) + el catálogo del sistema (permisos/roles/grants). El admin crea el resto desde la UI. |
| Permisos/OpenFGA/módulos | **Sin cambios.** El middleware sigue poblando `request.authUser`; `PermissionService` y guards funcionan igual. |

## 3. Modelo de datos

Una sola adición a `User` (migración Prisma):
```prisma
passwordHash String?   // hash bcrypt; null = sin clave fijada aún
```
Nada más cambia. `status` (`PENDING_FIRST_LOGIN`/`ACTIVE`) ya existe y se reutiliza.

## 4. Backend (`nodes/backend-central`)

### 4.1 Núcleo de auth — `AuthService` (nuevo, `src/auth/auth.service.ts`)
Responsabilidad única: credenciales y tokens. Interfaz:
- `hashPassword(plain): Promise<string>` — bcrypt.
- `verifyPassword(plain, hash): Promise<boolean>`.
- `signToken(userId): string` — JWT HS256, `{ sub: userId }`, exp 7d, secreto `AUTH_JWT_SECRET`.
- `verifyToken(token): { sub: string } | null` — valida firma+exp.

Deps nuevas: `bcrypt` (+`@types/bcrypt`), `@nestjs/jwt` (o `jsonwebtoken`).

### 4.2 `POST /auth/login` (en `AuthController`)
Body `{ email, password }`. Busca `User` por email; si existe, tiene `passwordHash`, está `ACTIVE` (o `PENDING_FIRST_LOGIN` — ver primer login) y la clave verifica → responde `{ token }` (200). Si no → **401 genérico** (no filtrar si el email existe). DTO con validación (`class-validator`).

### 4.3 `SessionMiddleware` (reescrito)
Lee `Authorization: Bearer <jwt>`. `authService.verifyToken` → si válido, `req.authUser = { id: sub, email }` buscando el `User` por `id`. Token ausente/ inválido → sigue sin `authUser` (los guards responden 401). Se elimina la dependencia de `FirebaseService` aquí.

### 4.4 Flujos que hoy usan Firebase → hashing propio
- **Provisión (`POST /users`, `POST /users/import`)** (`users.service.ts`): ya genera clave provisoria (`provisional-password.ts`). Cambio: en vez de `firebase.createUser`, guarda `passwordHash = hash(provisional)`, `status = PENDING_FIRST_LOGIN`, y **devuelve la clave provisoria** (se muestra en la UI, §9-1.1). Se elimina la compensación Firebase.
- **Primer login (`POST /auth/first-login/complete`)**: setea `passwordHash = hash(newPassword)` y `status = ACTIVE` (en vez de `firebase.setPassword`). Requiere sesión (el usuario ya entró con la provisoria).
- **Cambio de clave (`/profile/change-password`)**: `passwordHash = hash(newPassword)` (en vez de Firebase).
- **Borrado de usuario / compensaciones**: quitar llamadas a `firebase.deleteUser`.

`FirebaseService` y `firebase-admin` quedan sin uso en auth → se eliminan del módulo de auth (la dep npm puede quedar, sin import).

### 4.5 SuperAdmin (nota)
Existe `SUPER_ADMIN_IDS` que cortocircuita toda decisión. **No lo usamos** (el `org_admin` por Membership ya basta y no exige conocer el id antes de sembrar).

## 5. Web (`nodes/web`)

- **`api.ts`** (`request`/`uploadRequest`): el token sale de `localStorage` (clave `gmt_token`) en vez de `auth.currentUser.getIdToken()`.
- **`auth-context.tsx`**:
  - `login(email, password)` → `POST /auth/login` → guarda `token` en `localStorage` → `getMe()` → set user. (Reemplaza `signInWithEmailAndPassword`.)
  - Al montar: si hay token en `localStorage` → `getMe()` (si 401, limpiar y quedar deslogueado). (Reemplaza `onAuthStateChanged`.)
  - `logout()` → borra `localStorage` + user. `completeFirstLogin(newPassword)` → llama el endpoint, re-login para token fresco.
- Se quita el uso del SDK de Firebase del flujo (`lib/firebase.ts` queda huérfano; la dep npm puede permanecer).
- Variables `VITE_FIREBASE_*` dejan de usarse (no se borran del deploy, simplemente ignoradas).

## 6. Seed (un admin) — `src/.../seed-admin-prod` (o adaptar el seed existente)

Idempotente, corre contra la Postgres de Railway:
1. **Catálogo del sistema** (permisos + roles + `RolePermission` grants) — reutiliza el seed de sistema existente (`prisma/seed.ts`). Necesario para que `org_admin` tenga grants.
2. **Un usuario admin**: `admin@gmt.cl`, `firstName "Admin"`, `lastName "GMT"`, `status ACTIVE`, `passwordHash = hash(<clave-demo>)`, sin `clientId` (ve todos los módulos). Clave demo: **`GmtAdmin2026`** (documentada; se puede cambiar).
3. **Membership** `org_admin` scope `ORGANIZATION` para ese usuario (sin tupla FGA — coherente con §9-1.1; y FGA no está desplegado).

⚠️ **Verificar en el plan:** que el rol `org_admin` del catálogo (`seed.ts`) tenga grant **GLOBAL** de `user:create` (y demás acciones que la demo ejerza: `user:read`, etc.). Si no los tuviera, el admin no podría crear usuarios → se agregan al catálogo. Es la base de que la demo funcione sin FGA.

El admin luego crea usuarios desde la UI (provisión §4.4).

## 7. Configuración y despliegue

- `AUTH_JWT_SECRET` — string aleatorio fuerte que **genero yo** y seteo como variable del servicio `backend-central` en Railway (no es secreto del usuario).
- Seteo, redeployo `backend-central` y `web`, y **corro el seed** contra la Postgres de Railway. Mecanismo (se decide en el plan; la DB interna `postgres.railway.internal` NO es alcanzable desde mi máquina con `railway run`): opción preferida = **URL pública** de la Postgres (proxy TCP de Railway, `DATABASE_PUBLIC_URL`) y correr el seed local contra esa URL; alternativa = comando one-off dentro del contenedor del backend.
- Entrego la **URL pública** (web) con login funcionando + la credencial admin.
- Quedan ignoradas (sin borrar) `VITE_FIREBASE_*` y `FIREBASE_*`.

## 8. Seguridad (consideraciones)

- bcrypt cost 10; `AUTH_JWT_SECRET` ≥ 32 bytes aleatorios.
- 401 genérico en login (no revelar si el email existe).
- Token en `localStorage`: expuesto a XSS (tradeoff aceptado para demo; alternativa httpOnly cookie queda fuera de alcance). Solo sobre HTTPS (Railway lo fuerza).
- El JWT solo lleva `sub`; la autoridad real (status, roles) se re-lee de Postgres en cada request (el token no carga permisos).

## 9. Tests

- Unit `AuthService`: hash/verify (match y no-match), sign/verify (válido, firma mala, expirado).
- `auth.controller` login: 200 con token, 401 credencial inválida, 401 email inexistente.
- Adaptar specs existentes que mockean Firebase (`auth.controller.spec.ts`, etc.) al nuevo mecanismo.
- `SessionMiddleware`: token válido → `authUser`; inválido/ausente → sin `authUser`.

## 10. Flujo demo (criterio de aceptación)

1. Abro la URL pública → pantalla de login.
2. Entro como `admin@gmt.cl` / `GmtAdmin2026` → dashboard (ve todos los módulos).
3. Voy a Usuarios → **creo un usuario** → el sistema muestra su clave provisoria.
4. (Opcional) Cierro sesión, entro con el usuario nuevo + clave provisoria → primer login (fija su clave) → ACTIVE.
5. Todo sin Firebase, sin OpenFGA, sin secretos cargados a mano.

## 11. Fuera de alcance

- Nodo `auth-service` separado (Fase 4) — esto vive en `backend-central` por ahora.
- Refresh tokens, "recordar sesión" avanzado, reset de clave por email.
- OpenFGA / permisos de proyecto finos (no se ejercen con un solo admin GLOBAL).
- Migrar datos de usuarios existentes de Firebase (la Postgres de Railway parte limpia; solo el admin sembrado).
