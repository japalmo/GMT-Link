# GMT Link — Firestore Schema Definitivo

> Versión: 1.1 | Fecha: 2026-04-21
> Este documento congela el modelo de datos. Ningún agente debe modificar la estructura de colecciones sin actualizar este archivo primero.

---

## Colecciones principales

### `workers`
Un documento por trabajador. Contiene datos operativos (visibles en tabla) y datos sensibles (visibles solo en overlay con rol suficiente).

```
workers/{workerId}
  fullName:               string        — nombre completo
  rut:                    string        — RUT formateado "XX.XXX.XXX-X"
  email:                  string        — correo corporativo
  personalEmail:          string        — correo personal (sensible)
  phone:                  string        — teléfono (sensible)
  address:                string        — dirección (sensible)
  employeeCode:           string        — código interno
  department:             string        — área/departamento
  centerCost:             string        — centro de costo asignado
  location:               string        — ubicación/sucursal
  supervisorId:           string        — ref a users/{userId}
  supervisorName:         string        — desnormalizado para lectura rápida
  joinedAt:               Timestamp
  active:                 boolean
  bankName:               string        — (sensible)
  bankAccountType:        string        — "Cuenta corriente" | "Cuenta vista" | "Cuenta RUT"
  bankAccountNumber:      string        — (sensible)
  emergencyContactName:   string        — (sensible)
  emergencyContactPhone:  string        — (sensible)
  createdAt:              Timestamp
  createdBy:              string        — ref uid del usuario que lo creó
```

**Campos sensibles** (solo visibles con rol `admin` o `supervisor` del centro de costo del trabajador):
`personalEmail`, `phone`, `address`, `bankName`, `bankAccountType`, `bankAccountNumber`, `emergencyContactName`, `emergencyContactPhone`

---

### `reimbursements`
Un documento por solicitud de reembolso. Modelo plano (una solicitud = un gasto).

> **Decisión de modelo MVP:** se mantiene el modelo flat (un doc por solicitud/gasto) porque simplifica la UI de aprobación y pagos. Se reserva `groupId` para futuras solicitudes multi-ítem sin romper el schema.

```
reimbursements/{requestId}
  requestNumber:      string        — "R-YYYYMMDD-NNN", generado al crear
  workerId:           string        — ref a workers/{workerId}
  workerName:         string        — desnormalizado
  workerRut:          string        — desnormalizado
  centerCost:         string        — desnormalizado desde worker al momento de crear
  category:           string        — "Bencina" | "Peajes" | "Alimentación" | "Alojamiento" | "Otros"
  concept:            string        — descripción libre del gasto
  amount:             number        — en CLP, sin decimales
  expenseDate:        Timestamp     — fecha del gasto (no de envío)
  receiptNumber:      string        — número de boleta/factura
  merchantName:       string        — nombre del comercio
  notes:              string        — observaciones adicionales
  attachmentUrls:     string[]      — URLs de Storage (comprobantes/fotos de boleta)

  status:             string        — ver enum abajo
  paymentStatus:      string        — "unpaid" | "paid"
  paymentBatchId:     string | null — ref a paymentBatches/{batchId} cuando status=paid

  submittedAt:        Timestamp
  submittedByName:    string        — nombre del trabajador al momento de enviar

  approvedAt:         Timestamp | null
  approvedBy:         string | null — uid del usuario que aprobó
  approvedByName:     string | null
  approvalComment:    string | null

  rejectedAt:         Timestamp | null
  rejectedBy:         string | null — uid del usuario que rechazó
  rejectedByName:     string | null
  rejectionReason:    string        — obligatorio si status=rejected

  paidAt:             Timestamp | null
  paidBy:             string | null — uid del finance_clerk que registró el pago

  groupId:            string | null — ID de solicitud multi-boleta: "SOL-YYYYMMDD-NNN"
                                     Todas las boletas de una misma entrega comparten groupId.
                                     null = solicitud de boleta única.
```

**Enum `status`:**
- `draft`            — borrador guardado por el trabajador, no enviado aún
- `pending_approval` — enviada, esperando aprobación
- `approved`         — aprobada, no pagada aún
- `paid`             — pagada
- `rejected`         — rechazada

**Regla de negocio:**
- `paymentStatus` solo es relevante cuando `status = approved`. Cuando `status = paid`, se puede ignorar `paymentStatus`.
- El campo `paymentBatchId` se llena al crear el `paymentBatch` y marcar como `paid`.

---

### `paymentBatches`
Un documento por lote de pago. Un lote agrupa una o más solicitudes aprobadas del **mismo trabajador**.

```
paymentBatches/{batchId}
  batchNumber:          string      — "BATCH-YYYYMMDD-NNN"
  workerId:             string      — ref a workers/{workerId}
  workerName:           string      — desnormalizado
  workerRut:            string      — desnormalizado
  centerCost:           string      — desnormalizado
  requestIds:           string[]    — lista de reimbursements/{requestId} incluidos
  totalAmount:          number      — suma de amount de los requests incluidos
  requestCount:         number      — len(requestIds)

  bankName:             string      — snapshot de datos bancarios al momento del pago
  bankAccountType:      string
  bankAccountNumber:    string

  paymentReference:     string      — referencia del banco / número de transferencia
  voucherUrl:           string      — URL de Storage del comprobante bancario subido

  paidAt:               Timestamp
  paidBy:               string      — uid del usuario que registró el pago
  paidByName:           string

  emailSentTo:          string[]    — destinatarios que recibieron el correo de confirmación
  emailSentAt:          Timestamp | null
```

**Regla de negocio crítica:**
- Todos los `requestIds` deben pertenecer al mismo `workerId`. Validar en Firestore Rules y en la UI.

---

### `users`
Todos los usuarios del sistema — internos y trabajadores — comparten esta colección y el mismo login. El `role` determina qué ven y qué pueden hacer.

```
users/{userId}
  uid:            string    — Firebase Auth UID (igual al doc id)
  email:          string    — correo de login
  displayName:    string
  rut:            string    — identificador tributario visible en UI
  role:           string    — "admin" | "supervisor" | "finance_clerk" | "worker"
  centerCosts:    string[]  — centros de costo con permiso (supervisor); o [centerCost] del trabajador
  active:         boolean
  bankName:       string
  bankAccountType:string
  bankAccountNumber:string
  workerId:       string | null  — campo técnico interno; solo para role="worker": ref a workers/{workerId}
  createdAt:      Timestamp
  createdBy:      string    — uid del admin que lo creó (o "self" si auto-registro futuro)
  lastLoginAt:    Timestamp | null
```

**Regla de negocio por rol:**
- `admin` — acceso total a todas las vistas y datos.
- `supervisor` — aprueba/rechaza solicitudes donde `centerCost ∈ centerCosts`. Ve intranet.
- `finance_clerk` — ve solicitudes `approved`/`paid`, registra pagos. Ve intranet.
- `worker` — solo ve y crea sus propias solicitudes (`workerId` debe coincidir). Ve portal `/mis-solicitudes`. No ve intranet admin.

**Routing por rol:**
- `admin` / `supervisor` / `finance_clerk` → aterrizan en `/` (Dashboard intranet)
- `worker` → aterriza en `/mis-solicitudes` (portal personal)

---

### `costCenters`
Catálogo de centros de costo. Referencia usada en `workers`, `users` (supervisores) y filtros de `reimbursements`.

```
costCenters/{costCenterId}
  name:       string    — nombre del CC (ej. "Mantos Blancos")
  active:     boolean
  createdAt:  Timestamp
```

Centros de costo activos: Mantos Blancos, Salar Albemarle, Albemarle La Negra, Ingeniería, Compras, Finanzas, Proyectos, RH, Gerencia.

---

### `dashboardRollups/current`
Documento único de métricas pre-calculadas para el dashboard. Se actualiza al aprobar, rechazar o pagar.

```
dashboardRollups/current
  pendingCount:       number    — solicitudes en status=pending_approval
  approvedUnpaidCount: number   — status=approved AND paymentStatus=unpaid
  approvedUnpaidAmount: number  — suma de montos de las anteriores
  paidThisMonthAmount: number   — suma de montos pagados en el mes actual
  paidThisMonthCount:  number
  totalWorkersActive:  number
  lastUpdated:         Timestamp
```

> En MVP este doc se puede actualizar desde el cliente al ejecutar acciones. En producción debe actualizarse desde Cloud Functions para consistencia.

---

## Índices requeridos

```
reimbursements
  workerId ASC + submittedAt DESC         — para Pagos (solicitudes de un trabajador)
  status ASC + paymentStatus ASC          — para filtro aprobadas+no pagadas
  centerCost ASC + status ASC             — para supervisores por área
  submittedAt DESC                        — para listado general y dashboard

workers
  centerCost ASC + active ASC             — para filtrar por área
  active ASC + fullName ASC              — para listado general

paymentBatches
  workerId ASC + paidAt DESC              — historial de pagos por trabajador
  paidAt DESC                             — último lote general
```

---

## Reglas de seguridad (resumen lógico)

```
workers:
  read:  autenticado (datos no sensibles siempre; sensibles solo si admin o supervisor del centerCost)
  write: solo admin

reimbursements:
  read:  admin (todo) | supervisor (solo su centerCost) | finance_clerk (solo approved/paid)
         worker (solo donde workerId == auth.uid's workerId)
  create: worker autenticado (sus propias solicitudes y borradores)
  update: worker (solo si status=draft y workerId propio) | admin | supervisor (status/aprobación)
          finance_clerk (paidAt, paymentBatchId)

costCenters:
  read:  cualquier usuario autenticado
  write: solo admin

paymentBatches:
  read:  admin + finance_clerk
  write: admin + finance_clerk (solo crear, no borrar)

users:
  read:  propio doc siempre; admin puede leer todos
  write: solo admin

dashboardRollups:
  read:  cualquier usuario autenticado
  write: solo desde Cloud Functions (en MVP: admin + finance_clerk)
```

---

## Campos desnormalizados (intencional)

Los siguientes campos se desnormalizan para evitar joins y soportar la regla de Firestore de no poder hacer queries multi-colección:

| Campo desnormalizado | En colección | Fuente |
|---|---|---|
| `workerName`, `workerRut`, `centerCost` | `reimbursements` | `workers` al crear solicitud |
| `supervisorName` | `workers` | `users` al asignar supervisor |
| `workerName`, `workerRut`, `centerCost` | `paymentBatches` | `workers` al crear batch |
| `bankName`, `bankAccountType`, `bankAccountNumber` | `paymentBatches` | `workers` snapshot al pagar |

---

## Migraciones requeridas desde el estado actual

El seed actual (`scripts/seed-firestore.mjs`) usa un schema parcial. Al actualizar el seed:

1. Agregar campos faltantes en `reimbursements`: `attachmentUrls`, `submittedByName`, `groupId`, `paymentBatchId`
2. Agregar campos faltantes en `workers`: `createdAt`, `createdBy`, `employeeCode`, `location`, `joinedAt`
3. Agregar campos faltantes en `paymentBatches`: `requestIds`, `requestCount`, `bankName`, `bankAccountType`, `bankAccountNumber`, `voucherUrl`, `emailSentTo`, `emailSentAt`, `paidByName`
4. Agregar campos faltantes en `users`: `uid`, `centerCosts`, `active`, `createdAt`, `createdBy`, `lastLoginAt`
5. Actualizar `dashboardRollups/current` con campos nuevos
