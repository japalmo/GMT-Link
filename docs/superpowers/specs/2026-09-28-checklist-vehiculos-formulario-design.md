# Checklist de vehículos: formulario por pasos, sin login y envío por correo

**Fecha:** 2026-09-28
**Rama:** `feat/fase1b-documental`
**Estado:** aprobado por el dueño (conversación del 2026-09-28)

## Objetivo

Que un conductor pueda llenar el checklist de un vehículo desde el QR de la
plaquita, tenga cuenta o no, en un formulario por pasos con el mismo lenguaje
visual del reporte de incidentes de HSE, y que al terminar reciba el PDF en su
correo además de poder descargarlo.

El PDF **no cambia**: el formato impreso ya está replicado y se mantiene igual.

---

## 1. Estado actual (verificado, no supuesto)

Antes de diseñar se revisó qué existe de verdad. Tres hallazgos cambian el
alcance respecto de lo que parecía al principio.

### 1.1 El checklist ya está migrado de Apps Script

`packages/contracts/src/vehicle-checklist.ts` tiene la plantilla canónica
completa (`CHECKLIST_VEHICULO_GMT`): 21 ítems de estado general, 11 de equipos
de emergencia, 4 condiciones del conductor, el diagrama de carrocería y las
observaciones generales, más las cinco secciones del formato impreso
(`SECCIONES_CHECKLIST_VEHICULO`). Los ids de los ítems son los nombres de
columna de la planilla, así que la importación es un mapeo directo.

`checklist-formato-pdf.util.ts` dibuja el PDF con el molde real, reconstruido
desde la pestaña `FORMATO CHECKLIST` del libro *CHECK LIST CAMIONETAS*.

**No hay trabajo de migración pendiente.**

### 1.2 El asistente por pasos existe pero está inerte en producción

`ChecklistFillBody` ya pagina: cuando la plantilla trae `sections`, dibuja una
página por sección con Anterior/Siguiente y barra de progreso. Cuando no las
trae, dibuja una sola página con todo.

En producción, **las 20 plantillas de vehículos tienen 73 ítems y cero
secciones**, y ningún ítem declara `section`. Resultado: el conductor ve los 73
ítems en una única página que no termina nunca. El motor de pasos funciona; le
faltan los datos.

Esto vuelve el trabajo principal un **relleno de datos**, no una reescritura de
la UI de ítems.

| | plantillas | ítems | secciones |
|---|---|---|---|
| Vehículos en producción | 20 | 73 | 0 |
| Definición canónica | 1 | 73 | 5 |

Hay 2.439 envíos registrados, de los cuales 2.425 vienen importados de la
planilla. Es decir: el formulario nuevo de GMT Link casi no se ha usado todavía,
y el costo de equivocarse en la migración de datos es bajo — pero el historial
importado no se puede romper.

### 1.3 Los datos del conductor tienen dónde vivir, y el PDF ya los espera

`ChecklistFormatoData` declara `datosConductor: readonly DatoCabecera[]`, y el
builder lo llena hoy con `[]`. El bloque existe en el dibujo y llega vacío.

RRHH ya modela todo lo que el dueño describió:

| Concepto | Modelo existente | Alcance |
|---|---|---|
| Licencia de conducir municipal | `PersonalDocument` | por persona |
| Exámenes ocupacionales | `MedicalExam` | por persona |
| Capacitaciones | `Induction` | por cliente y faenas |
| Licencia interna / acreditación | `WorkerAccreditation` | por cliente y faena |

No hay que inventar una sección "Trabajadores por cliente": está construida y se
gestiona desde RRHH.

**El hueco real:** `PersonalDocument.fileUrl` es `String` obligatorio. Hoy es
imposible registrar "tiene licencia clase B que vence el 14-08-2028" sin
adjuntar el archivo. El placeholder que pidió el dueño exige volverlo opcional.

---

## 2. Decisiones tomadas

| # | Decisión | Quién |
|---|---|---|
| D1 | Se permite llenar el checklist sin cuenta. Esos envíos quedan **marcados como "sin verificar"** en el historial; no se bloquean ni requieren aprobación. | dueño |
| D2 | El PDF se manda **solo a quien llenó el formulario**. Sin copia fija interna por ahora. | dueño |
| D3 | La licencia municipal sale de un **documento personal de RRHH**, que puede existir con solo la fecha de vencimiento y sin archivo, y genera un **recordatorio** para subirlo. | dueño |
| D4 | La licencia interna sale de la **acreditación por faena** que ya existe. La gestión completa (RRHH edita, Proyectos solo observa) es trabajo aparte, fuera de este alcance. | dueño |
| D5 | El PDF conserva exactamente el formato actual. | dueño |

---

## 3. Diseño

### 3.1 Los pasos

El asistente se arma sobre las secciones de la plantilla, más dos pasos propios
del contenedor:

```
[0] Identificación   ← solo si NO hay sesión
[1] Datos del conductor
[2] Datos del vehículo          ┐
[3] Estado general              │
[4] Equipos de emergencia       ├ secciones de la plantilla
[5] Condiciones del conductor   │
[6] Carrocería y observaciones  ┘
[7] Cierre: correo + firma + enviar
```

Con sesión iniciada el paso 0 no se dibuja y el asistente arranca en el 1.

Los pasos 2 a 6 los sigue renderizando `ChecklistFillBody`, que ya sabe hacerlo.
Lo que cambia es que ahora **recibirá plantillas que sí traen secciones**.

Una plantilla sin secciones (equipos, maquinaria) sigue funcionando: cae en la
página única de hoy. No se rompe nada existente.

### 3.2 Identificación (paso 0)

Dos caminos, presentados como dos tarjetas:

- **Entrar a GMT Link** — va al login y vuelve al checklist en el mismo punto.
  Es el camino recomendado y se muestra primero.
- **Continuar sin cuenta** — sigue al paso 1 con los campos vacíos.

### 3.3 Datos del conductor (paso 1)

Mismos campos en los dos caminos; cambia de dónde salen.

| Campo | Con sesión | Sin sesión |
|---|---|---|
| Nombre | perfil (`firstName` + `lastName`) | lo escribe |
| Clase de licencia municipal | documento personal tipo licencia | lo elige |
| Vencimiento licencia municipal | `expiresAt` de ese documento | lo escribe |
| Vencimiento licencia interna | acreditación vigente del cliente/faena | lo escribe |

Con sesión los campos se muestran **prellenados y editables**, con un aviso
explícito:

> Estos datos vienen de tu perfil. Si los editas acá, el cambio vale solo para
> este checklist. Si cambiaron de verdad, actualízalos en tu perfil.

Si el usuario con sesión no tiene el documento de licencia cargado, el campo
aparece vacío y se le ofrece dejar registrada la fecha de vencimiento ahí mismo.
Eso crea el `PersonalDocument` placeholder (sin archivo) y encola la
notificación de subir el PDF o la foto.

**Nunca** se crea ni modifica un documento de RRHH en silencio: el usuario marca
una casilla explícita para guardarlo en su perfil.

### 3.4 Cierre (paso 7)

- Campo de correo, prellenado con el del usuario si hay sesión, requerido.
- Firma, si el usuario la tiene obligatoria (comportamiento actual intacto).
- Botón de envío.
- Tras enviar: pantalla de éxito con descarga directa del PDF y la confirmación
  de a qué correo se mandó.

### 3.5 Envío sin cuenta

`submitChecklist` actual exige `userId` para tres cosas: permiso de ejecución,
permiso de lectura del activo y hash de contenido de la firma. No sirve para el
camino anónimo y **no se modifica**.

Se agrega un método hermano, `submitPublicChecklist`, con su propio endpoint
público:

```
POST /assets/public/:token/checklist     (Throttle 6/min por IP)
```

La credencial es el token opaco de la ficha, igual que el resto de endpoints
públicos del activo. El método:

1. Resuelve el token al activo (falla si no existe).
2. Exige que la plantilla sea del activo y esté `APROBADO` — misma regla que el
   camino autenticado.
3. Valida las respuestas con el mismo Zod.
4. Persiste con `userId = null` y los datos del invitado.
5. **No** acepta firma: sin identidad no hay firma que verificar.

#### Campos nuevos en `ChecklistSubmission`

```prisma
/// Datos de quien llenó el checklist SIN cuenta en GMT Link. Van juntos y
/// separados de `userId` a propósito: son declarados por quien llenó el
/// formulario y nadie los verificó. `externalAuthor` NO sirve para esto: ese
/// campo significa "vino importado de la planilla", que es otra cosa.
guestName            String?
guestLicenseClass    String?
guestLicenseExpiry   DateTime?
guestInternalExpiry  DateTime?
guestEmail           String?
```

Un envío queda "sin verificar" cuando `userId IS NULL AND externalSource IS
NULL`. No se agrega columna de estado: la condición ya es derivable y una
columna redundante se desincroniza.

### 3.6 El correo

Al terminar, el backend genera el PDF y lo manda adjunto por `EmailService`.
Brevo está activo en producción (`BREVO_API_KEY` configurada en el servicio
`api`), así que el envío es real.

El envío es **best-effort**: si el correo falla, el checklist ya quedó guardado y
la pantalla de éxito lo dice con todas sus letras, ofreciendo la descarga. Un
checklist que se perdió porque el servidor de correo estaba caído sería un
error mucho peor que un correo no entregado.

### 3.7 Componentes compartidos

Hoy el lenguaje visual del formulario de HSE vive dentro de
`pages/public/incidente.tsx`: `Pantalla`, `Campo`, `Aviso`, `Segmentado` y la
barra de pasos son funciones locales de ese archivo.

Se extraen a `nodes/web/src/components/form-wizard/`, sin cambiar su
comportamiento, y `incidente.tsx` pasa a importarlas. `SelectorFecha` y
`SelectorHora`, que ya viven en `incidente-campos.tsx`, se mueven al mismo lugar.

Esto es refactor puro: el formulario de HSE debe verse y comportarse
exactamente igual después.

### 3.8 Relleno de las plantillas de producción

Script idempotente que, para cada plantilla de vehículo:

1. Toma los ítems tal como están.
2. A cada ítem cuyo `id` exista en `CHECKLIST_VEHICULO_GMT`, le copia el
   `section` de la definición canónica.
3. Escribe `sections = SECCIONES_CHECKLIST_VEHICULO`.
4. Deja intacto cualquier ítem que no esté en la canónica (queda sin `section` y
   cae en la página "General" que `ChecklistFillBody` ya contempla).

No toca `items` en nada más: ni etiquetas, ni opciones, ni orden. No toca los
envíos históricos. Correrlo dos veces da el mismo resultado.

---

## 4. Fuera de alcance

Se anotan para que no se pierdan, pero **no** se construyen ahora:

- La gestión completa de trabajadores por cliente (RRHH edita, Proyectos solo
  observa) — D4.
- Reglas de obligatoriedad de requisitos por faena. El tablero de RRHH
  deliberadamente no calcula "faltantes" hoy, y agregarlos es una decisión
  aparte.
- Copia interna del PDF a una casilla de flota — D2.
- Aprobación de checklists sin verificar. Si aparece basura, esta es la salida.

---

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| El endpoint público permite que cualquiera con el QR genere registros | Throttle por IP, marca visible de "sin verificar", y la salida documentada de exigir aprobación si se ensucia |
| El relleno de secciones toca 20 plantillas vivas | Script idempotente, respaldo previo a CSV, y verificación de que el conteo de ítems no cambia |
| Extraer los componentes de HSE puede alterar ese formulario | El refactor no cambia comportamiento; se verifica el formulario de HSE en el navegador antes de seguir |
| El correo puede fallar en silencio | Envío best-effort, el checklist se guarda primero, la pantalla lo dice y ofrece descarga |

---

## 6. Criterios de aceptación

1. Un conductor **sin sesión** abre el link del QR, elige continuar sin cuenta,
   llena el checklist por pasos y recibe el PDF en su correo.
2. Ese envío aparece en el historial marcado como sin verificar.
3. Un conductor **con sesión** entra directo al paso 1, ve sus datos
   prellenados, puede editarlos con el aviso visible, y el correo viene con su
   dirección.
4. El PDF generado por los dos caminos es **idéntico en formato** al actual, con
   el bloque de datos del conductor ahora lleno.
5. Las plantillas de vehículos en producción muestran 5 pasos, no una página de
   73 ítems.
6. El formulario de reporte de incidentes de HSE funciona exactamente igual que
   antes del refactor.
7. Una plantilla sin secciones (equipo, maquinaria) sigue mostrándose en una
   sola página.
