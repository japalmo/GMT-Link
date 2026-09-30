# Control de avance de obra editable en GMT Link

**Fecha:** 2026-09-29
**Rama:** `feat/fase1b-documental`
**Proyecto piloto:** CP-A-1 · Cierre Perimetral (CW2224748)

## Objetivo

Que Felipe Díaz actualice el control de avance por HH desde GMT Link, en una
tabla tipo planilla, en vez de que alguien cargue los números a mano en la base
cada semana.

Reemplaza el enfoque anterior (asignar tareas a personas y derivar el avance de
los registros de progreso), que nunca se usó.

---

## 1. Estado actual (verificado el 2026-09-29)

### 1.1 El control por HH ya existe y funciona

`control-semanal.util.ts` calcula el informe completo —encabezado, semanas,
curva y desglose por fases— como función pura, probada contra los números de un
informe real. El tablero público (`/public/proyecto/:token`) lo muestra y se
proyecta en la TV de faena.

Al corte S-3 el tablero coincide exactamente con el informe firmado
`GMT-MB-OOCC-CP-CS-S-3`: 2.312 HH totales, 23,7% real contra 20,7% plan, +3,0 pp.

### 1.2 Hay DOS fuentes para el mismo número, y hoy están desincronizadas

| Fuente                            | Alimenta               | Estado al 29-09  |
| --------------------------------- | ---------------------- | ---------------- |
| `ProjectWeek.parReal` / `acmReal` | encabezado y curva S   | al día (S-3)     |
| `ProjectActivity.realByWeek`      | **desglose por fases** | congelado en S-1 |

En el tablero que hoy se proyecta, el encabezado dice 23,7% y el bloque de fases
muestra Gestión 7,1% y Construcción 0%. Nadie lo notó porque nada cruza las dos
fuentes.

**Esto es el problema que el diseño tiene que cerrar**, no un detalle a
arrastrar.

### 1.3 Los porcentajes no se derivan del PDF

El informe semanal trae los porcentajes por semana pero **no** el detalle por
actividad. Esos porcentajes salen de ponderar el avance de cada actividad por
sus HH, en la planilla de Felipe. Por eso cargar el PDF no puede reconstruir el
desglose por fases: la información no viaja ahí.

### 1.4 Datos del piloto

38 actividades en 5 fases (Hitos, Gestión, Suministros, Construcción, Cierre),
12 semanas (S-0 a S-11), 2.312 HH.

---

## 2. Decisiones tomadas

| #   | Decisión                                                                                                                                          | Quién |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| D1  | Se editan **las dos cosas**: el avance por actividad como fuente, y el porcentaje semanal se puede sobreescribir cuando no cuadre con el informe. | dueño |
| D2  | **Permiso nuevo** de avance de obra, que el dueño asigna. Proyectos sigue viendo sin poder editar.                                                | dueño |
| D3  | El plan **es editable, con aviso** de que mueve la referencia de todo el informe.                                                                 | dueño |

### 2.1 Cómo se cierra el riesgo de D1

Tener dos fuentes para el mismo número es exactamente lo que causó §1.2. Se
acepta porque el dueño lo pidió con el riesgo sobre la mesa, pero la duplicación
tiene que ser **explícita y visible**, nunca silenciosa:

- El porcentaje semanal se **calcula** por defecto desde las actividades.
- Sobreescribirlo es un acto deliberado: el valor queda marcado como
  "sobreescrito" y **se muestra al lado el valor calculado**, con la diferencia.
- Se puede quitar la sobreescritura y volver al calculado, en un clic.
- Un valor sobreescrito que coincide con el calculado deja de marcarse: la marca
  señala discrepancia real, no historia.

Así, un desajuste entre fases y encabezado es visible en la misma pantalla en
vez de descubrirse meses después.

---

## 3. Diseño

### 3.1 Modelo de datos

`ProjectWeek` suma dos columnas:

```prisma
/// Avance parcial informado a mano, 0-1. `null` = se usa el calculado desde
/// las actividades. Se guarda aparte del calculado a propósito: así se puede
/// mostrar la diferencia y volver atrás.
parRealOverride Float?
acmRealOverride Float?
```

Los campos actuales `parReal` / `acmReal` pasan a ser **el valor efectivo**
(calculado, o el override si existe), que es lo que ya consume el tablero. Se
recalculan al guardar. Nada del front del tablero cambia.

`ProjectActivity.realByWeek` se mantiene como está: un arreglo de acumulados
0-1 desde S-1, sin huecos.

### 3.2 Cómo se calcula el porcentaje semanal desde las actividades

```
acmReal(semana) = Σ (actividad.hh × actividad.realByWeek[semana]) / Σ actividad.hh
parReal(semana) = acmReal(semana) − acmReal(semana − 1)
```

Ponderado por HH, que es como lo calcula el informe. Las actividades con `hh = 0`
(los hitos) no pesan.

### 3.3 La tabla

Una pestaña nueva en la vista del proyecto: **Avance**. Dos tablas.

**Tabla de actividades** (la fuente). Una fila por actividad, agrupadas por fase,
con una columna por semana hasta el corte. La celda es el % acumulado de esa
actividad en esa semana. Edición por celda, con navegación de teclado tipo
planilla (Tab / Enter / flechas) y pegado desde Excel.

Al pie de cada fase, su avance ponderado. Al pie de la tabla, el total: el número
que alimenta el informe.

**Tabla de semanas** (el informe). Una fila por semana, con las columnas del
documento: cierre, HH plan, PAR plan, PAR real, ACM plan, ACM real, variación.
El real llega calculado; se puede sobreescribir por celda.

### 3.4 Guardado

Autoguardado por celda al salir del campo, con indicador de estado. En una tabla
de esta densidad, un botón "Guardar" al final es una invitación a perder media
hora de trabajo por cerrar la pestaña.

El endpoint recibe el cambio de UNA celda, no la tabla entera: dos personas
editando semanas distintas no se pisan.

### 3.5 Permiso

```
project:progress:manage — "Gestionar avance de obra"
```

STRUCTURAL sobre el proyecto (misma jerarquía depto→proyecto que el resto).
Ver el avance sigue con `project:read`.

### 3.6 Tabla de cercos, con foto de terreno

**La foto ya está construida y nunca se usó.** El tablero busca fotos colgadas
de la tarea (`ProjectDocument` con `taskId`), las asocia al CERCO —la clave es
`parentId ?? id`— y prefiere la foto por sobre la vista satelital. Incluso elige
la que corresponde a la semana que se esté mirando. En producción hay **cero**
fotos cargadas.

Lo que falta no es dónde guardarlas: es una forma cómoda de subirlas. Hoy habría
que ir al flujo de documentos del proyecto y acertarle a la tarea correcta.

Tercera tabla en la pestaña: **Cercos**. Una fila por cerco (55 ubicados de los
~63 del programa), con nombre, ubicación, avance y foto.

- Subir una foto crea un `ProjectDocument` con `taskId` = el cerco. El tablero
  la muestra en lugar de la satelital sin ningún cambio en su código.
- Sin foto, el tablero sigue mostrando la satelital exactamente como hoy.
- Se puede reemplazar (sube una nueva, que por fecha gana) o quitar.

**No se agrega ninguna columna nueva.** Un `Task.photoKey` habría sido una
segunda fuente para el mismo dato, que es justo lo que este diseño existe para
evitar (§1.2). Se llegó a agregar en la tarea 2 del plan y se revirtió al
descubrirlo.

La foto se achica en el navegador antes de subir, como en el reporte de
incidentes: una foto de celular pesa varios MB y en faena la señal es mala.

---

## 4. Fuera de alcance

- Importar el programa base desde MS Project. Hoy se carga por script.
- Historial de quién cambió qué celda. Vale la pena, pero es otra tarea.
- Aplicar esto a otros proyectos: el modelo ya es por proyecto, pero el piloto
  es Cierre Perimetral.

---

## 5. Riesgos

| Riesgo                                                       | Mitigación                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Las dos fuentes vuelven a desincronizarse                    | El override es visible y muestra el calculado al lado (§2.1)                              |
| Un error de tipeo en el plan mueve la referencia del informe | Aviso explícito al editar el plan (D3)                                                    |
| Autoguardado escribiendo basura por una celda a medias       | Se valida rango 0-100 antes de mandar; una celda inválida no se guarda y se marca         |
| El acumulado por actividad puede retroceder                  | Se avisa, pero se permite: una corrección legítima de un informe anterior es un retroceso |
| Fotos de celular de varios MB en un tablero que se proyecta  | Se achican en el navegador antes de subir, como en el reporte de incidentes               |

---

## 6. Criterios de aceptación

1. Felipe entra a la pestaña Avance y edita el % de una actividad; el total de
   la fase, el acumulado del proyecto y la curva S se actualizan.
2. El desglose por fases del tablero público deja de estar congelado.
3. Sobreescribir el ACM real de una semana lo marca y muestra el calculado al
   lado, con la diferencia.
4. Quitar la sobreescritura devuelve el valor calculado.
5. Quien tiene `project:read` pero no `project:progress:manage` ve la tabla sin
   poder editar.
6. Editar el plan pide confirmación explicando que mueve la referencia.
7. Con los datos de hoy cargados por actividad, el encabezado sigue dando
   23,7% / 20,7% / +3,0 al corte S-3.
8. Subir la foto de un cerco la muestra en el tablero en lugar de la satelital.
9. Un cerco sin foto sigue mostrando la satelital, igual que hoy.
10. Quitar la foto devuelve la vista satelital.
