# Prompts para nuevas sesiones — GMT Link + V-metric

> Cada bloque es **autónomo**: pégalo tal cual al iniciar una sesión nueva de Claude Code.
> Redactados a partir del estado real de los proyectos (jun 2026).

## ⚠️ Nota transversal sobre GitHub (leer antes de los prompts #1, #2, #3, #5)

Repos de destino (**ambos son del usuario `japalmo`**):

- **GMT Link** → `https://github.com/japalmo/GMT-Link`
  El repo local (`C:\Users\juana\GMT Link`) **NO tiene remote configurado** (`git remote -v` vacío).
  Hay que `git remote add origin https://github.com/japalmo/GMT-Link.git`. Rama local por defecto: `master`.
- **V-metric** → `https://github.com/japalmo/V-metric`
  El clon local (`C:\Users\juana\V-metric`) hoy apunta a `NicolasvargasV/cubicador-de-poza` (origen del fork).
  Hay que **reapuntar el remote** al repo del usuario: `git remote set-url origin https://github.com/japalmo/V-metric.git`.
  (Existe un segundo clon `C:\Users\juana\V-metric-dev`, atrasado — trabaja sobre `C:\Users\juana\V-metric`.)
- **`gh` CLI no está instalado.** Usa `git` directo o instala `gh` si lo necesitas.
- "Borrar todo y subir la versión actualizada" = **reemplazo destructivo de historial** (force-push / repo reset).
  Ambos repos son del usuario, así que puede sobrescribirlos; aun así, **crea un tag/branch de respaldo del estado remoto actual antes de forzar** (`git fetch origin` + `git tag backup-pre-reemplazo origin/main` o `origin/master`), por si hay que volver atrás.

---

## PROMPT 1 — Integrar V-metric desktop con el backend, BD y lenguaje visual de GMT Link

```
Contexto. Trabajo con dos proyectos en esta máquina (Windows):
- GMT Link (web/servidor): monorepo pnpm en "C:\Users\juana\GMT Link".
  NestJS api (apps/api, puerto 3001), React+Vite web (apps/web, 5173), Prisma + PostgreSQL,
  OpenFGA para autorización, Firebase Auth (emulador en dev). Su autoridad de diseño es
  docs/GMT_LINK_PLAN_MAESTRO.md y las reglas en CLAUDE.md. Ya tiene: módulo web "v-metric"
  con visor 3D de DEM (Three.js, lee apps/web/public/dem/*.json), generación de OTP en
  MetricsService (flujo de no-repudio), y visibilidad de módulos por cliente.
- V-metric (escritorio): "C:\Users\juana\V-metric". Python 3.14 + PySide6 (Qt),
  rasterio/numpy/PyMuPDF (geoespacial), reportlab (PDF), openpyxl, SQLAlchemy (BD local).
  Repo del usuario: https://github.com/japalmo/V-metric (el clon local apunta hoy a
  NicolasvargasV/cubicador-de-poza → reapunta el remote a japalmo/V-metric). HOY persiste en
  Firebase/Firestore + Google Sheets (poza/firebase_*.py, poza/firebase_sync.py) — ESTE STACK
  DE DATOS/BACKEND SE DESCARTA (ver objetivo). UI en poza/views/ (dashboard_view, elements_view,
  workspace_view, config_view, map_widget, layers_panel) y temas en poza/themes.py.

Lee primero, sin tocar código:
1. "C:\Users\juana\Downloads\Especificación Técnica y Arquitectura de Integración_ GMT Link y V_metric.md"
   (modelo jerárquico Proyecto→Servicio→Fase→Variable→Dato, flujo ProjectDocument
   Borrador→QA→Cliente, storage asíncrono S3, OTP de no-repudio antes de subir).
2. En GMT Link: apps/api/prisma/schema.prisma, el módulo metrics (OTP) y el módulo v-metric web.
3. En V-metric: poza/db/models.py, poza/db/repository.py, poza/firebase_sync.py,
   poza/firebase_http.py, poza/themes.py, poza/vmetric.py (cálculo de volúmenes).

Objetivo. V-metric desktop debe ser el motor donde se hace el cálculo PESADO de volúmenes
(salmuera/sal/ocluido/total a partir de DEMs) y luego SUBE los resultados al servidor de
GMT Link. Quiero: misma BD (PostgreSQL de GMT Link, no Firestore), misma estructura de datos,
mismo backend (la API NestJS), y el mismo lenguaje visual (tokens de diseño) en ambos.
**Olvida por completo el stack de datos/backend actual de V-metric** (Firestore, Google Sheets,
la BD SQLAlchemy como fuente de verdad): se DESCARTA y se adapta TODO al esquema y stack
actualizados de GMT Link. De V-metric se conserva solo lo valioso: el motor de cálculo
(poza/vmetric.py, rasterio/numpy), la UI Qt (poza/views/) y el procesamiento geoespacial.

Tareas:
1. Diseña/extiende el contrato de API en GMT Link para ingestar una cubicación:
   identificador de elemento (reservorio/poza), fecha, operador, cotas, áreas, perímetros,
   volúmenes (libre/sal/ocluido/total) y referencia al archivo DEM/ortofoto. Respeta el
   modelo dinámico del spec y el esquema Prisma existente; agrega migración por cada modelo
   nuevo (regla de CLAUDE.md) y permiso OpenFGA por cada permiso nuevo.
2. En V-metric, reemplaza/complementa el backend Firebase por un cliente HTTP hacia la API
   de GMT Link (mismo patrón que poza/firebase_http.py → nuevo cliente gmt_api). Implementa
   autenticación y, antes de confirmar la subida en el Workspace, el modal de OTP contra el
   endpoint de GMT Link (no-repudio del spec §5).
3. Unifica el lenguaje visual: que poza/themes.py consuma los MISMOS tokens que la web
   (paleta/tipografía/espaciados de Tailwind+shadcn). Define una fuente única de tokens y
   reskinea la UI Qt para que sea coherente con GMT Link.
4. Mapea los modelos SQLAlchemy locales de V-metric ↔ esquema Prisma de GMT Link, dejando
   la BD local solo como staging/caché offline.

Identidad/auth (decisión ya tomada): V-metric adopta el MISMO mecanismo de auth que GMT Link
(no se conservan los proyectos Firebase propios de V-metric). El operador inicia sesión con su
cuenta de GMT Link y V-metric obtiene un token válido contra la API de GMT Link; el OTP de
no-repudio se valida contra el endpoint de GMT Link. Si hay un detalle de configuración que
realmente bloquee (p. ej. credenciales del proyecto Firebase de GMT Link), pregúntame; pero el
rumbo es claro: una sola identidad, la de GMT Link.

Criterio de aceptación: desde el Workspace de V-metric calculo un volumen, paso el OTP, y el
registro queda en PostgreSQL de GMT Link y es visible en el módulo v-metric de la web; las dos
apps se ven con la misma identidad visual.

Al terminar: commitea los cambios de V-metric en https://github.com/japalmo/V-metric (reapunta
el remote desde cubicador-de-poza) y los de GMT Link en https://github.com/japalmo/GMT-Link
(agrega el origin; el repo local no tiene remote). Ambos repos son tuyos. ⚠️ Crea un tag de
respaldo del estado remoto antes de cualquier reemplazo destructivo. gh no está instalado.
```

---

## PROMPT 2 — Dejar GMT Link funcionando en línea en Railway con deploy continuo desde GitHub

```
Contexto. GMT Link es un monorepo pnpm (Node ≥22) en "C:\Users\juana\GMT Link":
- apps/api: NestJS (puerto 3001), Prisma + PostgreSQL, OpenFGA, Firebase Admin. Migraciones
  en apps/api/prisma/migrations (15). Seeds y fga:bootstrap existentes.
- apps/web: React + Vite (build estático, dev en 5173). Llama a la API vía apps/web/src/lib/api.ts.
- packages/shared-types: tipos compartidos.
Autoridad del proyecto: docs/GMT_LINK_PLAN_MAESTRO.md y CLAUDE.md.

Estado actual REAL detectado (verifícalo tú también):
- Repo de GitHub del usuario: https://github.com/japalmo/GMT-Link. El repo local NO tiene remote
  configurado → `git remote add origin https://github.com/japalmo/GMT-Link.git`. Rama local "master".
- NO existe configuración de Railway ni de deploy en el repo: solo docker-compose.yml para
  infra local. La infra local hoy corre en WSL (PostgreSQL 16 + Redis 7), ver CLAUDE.md.
  → Railway se construye DESDE CERO, no se "ajusta" algo existente.
- gh CLI no está instalado.
- Hay credenciales sensibles fuera del repo (claves Firebase Admin SDK en C:\Users\juana\Downloads\
  v-metric-*.json, credenciales R2, etc.): deben ir como SECRETS de Railway, nunca commiteadas.

Arquitectura objetivo (ver también el PROMPT #5 — diagrama): la LÓGICA (api NestJS, web, OpenFGA,
Redis, workers) va en Railway; la BASE DE DATOS vive en servidores de Albemarle (ellos controlan
los datos) y se consulta en TIEMPO REAL desde Railway a través de un gateway/túnel seguro. Diseña
la config de Railway anticipando esto (DATABASE_URL apuntando al servidor de Albemarle vía túnel
seguro; NO persistir datos sensibles en Railway). Si los servidores de Albemarle aún no están
disponibles, pregúntame si arrancamos con un Postgres administrado de Railway como interino y
luego repuntamos el DATABASE_URL — no lo asumas.

Objetivo. Analiza la versión actual del proyecto y el estado actual de mi estructura en Railway,
y déjalo funcionando en línea con despliegue continuo: que al hacer push al repo de GitHub,
Railway despliegue automáticamente y los cambios se vean "en tiempo real".

Tareas:
1. Como NO hay nada en Railway todavía, ofréceme las DOS vías y deja que yo elija:
   (a) **Yo lo creo, tú me guías**: dame un paso a paso claro y conciso para crear el proyecto en
       Railway (crear proyecto, agregar servicios, conectar el repo de GitHub para auto-deploy,
       cargar variables/secrets), con exactamente qué clickear/pegar.
   (b) **Tú lo haces, yo te doy permisos**: explícame cómo darte acceso — instalar la Railway CLI
       y `railway login`, o generarte un **token de proyecto/cuenta de Railway** y dónde pegarlo —
       para que tú crees y configures todo. Indícame qué token necesitas y los mínimos permisos.
2. Define la topología de despliegue: plugin PostgreSQL, plugin/servicio Redis, servicio
   OpenFGA, servicio api (NestJS) y servicio/estático web (Vite). Decide build con
   Nixpacks o Dockerfile por servicio.
3. Crea la configuración de Railway (railway.json / nixpacks.toml o Dockerfiles), variables
   de entorno (DATABASE_URL, REDIS_URL, OpenFGA store/API, credenciales Firebase Admin y R2
   como secrets), y el paso de release que corre `prisma migrate deploy`.
4. Conecta el repo de GitHub a Railway para auto-deploy en cada push a la rama elegida.
   Configura el build de la web para apuntar a la URL pública de la API desplegada (CORS incluido).
5. Verifica end-to-end: deploy verde, api + web accesibles online, migraciones aplicadas,
   login funcionando contra el stack desplegado.

Antes de tocar GitHub: agrega el origin → https://github.com/japalmo/GMT-Link.git (el repo es tuyo;
el local no tiene remote). ⚠️ "Borrar todo y subir la versión actualizada" es un reemplazo
destructivo de historial: crea un tag de respaldo del estado remoto antes de forzar. gh no está
instalado (usa git o instálalo).

Criterio de aceptación: hago push a la rama conectada y Railway despliega solo; api y web quedan
online; migraciones corren en el deploy; el login funciona en producción.
```

---

## PROMPT 3 — Agregar la ortofoto como capa del mapa GIS de V-metric

```
Contexto. En V-metric desktop ("C:\Users\juana\V-metric", Python + PySide6) el mapa GIS está en
poza/views/map_widget.py: es un Leaflet 1.9.4 dentro de un QWebEngineView (puente QWebChannel).
Hoy tiene como capa base la imagen satelital de Esri (World_Imagery) con fallback a OSM y a un
estado "offline", y una capa state.elementsLayer (L.layerGroup) que dibuja marcadores y polígonos
GeoJSON ENCIMA del satélite. El panel de capas está en poza/views/layers_panel.py.

Objetivo. Agregar una ortofoto como capa intermedia del mapa, con este orden exacto:
  1) capa inferior: imagen satelital (la actual de Esri),
  2) en medio: la ortofoto,
  3) capa superior: los polígonos (elementsLayer).

Ortofoto: "C:\Users\juana\Downloads\IMAGEN AEREA PLANTA SALAR.tif" (GeoTIFF georreferenciado,
~253 MB). Las coordenadas del proyecto están en UTM 19S (EPSG:32719) — los puntos NPT del Salar
de Atacama rondan E≈568.834, N≈7.385.430 (~ -23.65, -68.20). Hay que reproyectar la ortofoto a
Web Mercator (EPSG:3857) / WGS84 para Leaflet.

Tareas:
1. Procesa el GeoTIFF con rasterio/GDAL (V-metric ya depende de rasterio). Elige una estrategia
   que mantenga la app fluida con un archivo de 253 MB: o (a) genera una pirámide de tiles XYZ
   (gdal2tiles) servida localmente/empaquetada, o (b) warp + remuestreo a un raster web-friendly
   con sus bounds y úsalo como L.imageOverlay. Guarda lo procesado en assets/ o DEMs/.
2. En map_widget.py crea un L.pane dedicado para la ortofoto con z-index ENTRE la tile base y
   elementsLayer, y agrégala respetando el orden satelital → ortofoto → polígonos.
3. En layers_panel.py agrega el control de la nueva capa: toggle de visibilidad + slider de
   opacidad para la ortofoto.
4. Maneja correctamente la georreferenciación (bounds/proyección) para que la ortofoto caiga
   sobre los reservorios; agrega manejo de error si el raster no carga.

Criterio de aceptación: el mapa muestra satélite (abajo) → ortofoto (con opacidad ajustable) →
polígonos (arriba), bien georreferenciado y sin trabar la UI.

Al terminar, commitea en https://github.com/japalmo/V-metric (reapunta el remote local desde
cubicador-de-poza con `git remote set-url origin`). El repo es tuyo. ⚠️ Crea un tag de respaldo
del estado remoto antes de cualquier reemplazo destructivo.
```

---

## PROMPT 4 — Normalizar el Excel de volúmenes y recargar los datos limpios

```
Contexto. Archivo: "C:\Users\juana\Downloads\VOLUMEN 3D DE RESERVORIOS DIA 18-06-2026.xlsx".
Tiene 47 hojas con estructuras DISTINTAS entre sí. Tipos de hoja detectados:
- Series por reservorio (R1, R2, R3, R4, "R4 New", R5, R6, "R6 NEW", R7, R8, R9, "R9 NEW",
  R10, "R10 New", ...): filas por fecha con columnas tipo Fecha, Op, "Lectura fierro"
  (Borde libre/Salmuera/Sal), "Medicion" (Cota Espejo/Cota Sal), Espejo (m²), Perimetro (m),
  "Volumenes (m³)" (Vol Talud, Vol salmuera L, 3D Salmuera...). OJO: los encabezados ocupan
  2 filas (fila 1 = grupo, fila 2 = subcolumna).
- Pozas y acopios (P1, P1A, P1B, "P1B new", "P1B-26", "P1C New", P1D, "P1D new", P2, P2D, P3,
  1C, 1E, 1F, 2B): estructuras propias.
- Hojas NPT R* = nubes de puntos (id, X, Y, Z) → NO se mezclan en la tabla normalizada.
- Meta-hojas: "RESERVORIOS GENERAL" (snapshot consolidado 2026-06-18 por reservorio),
  "TOTAL" (resumen), "Protocolo", "Operadores" (mapa código→nombre→cargo), "Recuperación de
  formulas", Hoja1/Hoja2/Hoja3.

Mapa de operadores (del usuario y de la hoja "Operadores"):
  NR = Nelson Romero, BA = Bastián Abrigo, VO = Víctor Orellana, JE = José España,
  PO = Patricio Olate, MT = Mario Tapia.

Objetivo. Juntar los datos REALES de todas las hojas en UNA tabla normalizada con estas columnas:
  Fecha · Operador · Cota Esp. (m) · Borde Lib. (m) · Alt. Salm. (m) · Alt. Sal (m) ·
  Área Esp. (m²) · Perím. (m) · Vol. Lib. (m³) · Vol. Sal (m³) · Vol. Ocl. (m³) · Vol. Total (m³)
Además agrega una columna de identificador de elemento (qué reservorio/poza es cada fila): sin
ella no se sabe a qué reservorio pertenece la medición — confírmame el nombre exacto de esa
columna si dudas, pero inclúyela.

Reglas de normalización:
- Expande los códigos de operador a nombre completo (tabla de arriba).
- TODAS las cotas deben ser > 2000. Revisa bien la estructura y descarta/repara filas con
  cota ≤ 2000 (suelen ser celdas vacías, encabezados arrastrados o errores de unidad).
- Parsea el layout heterogéneo de cada hoja (encabezados de 2 filas, columnas en distinto orden)
  y mapéalo al esquema canónico. Excluye del detalle fila-a-fila las hojas NPT (nubes de puntos)
  y las hojas puramente de resumen (TOTAL, Protocolo, Recuperación de formulas); las de
  resumen úsalas solo para cuadrar/validar.
- Usa como referencia de mapeo y de formato de salida lo que YA existe:
  "C:\Users\juana\V-metric\normalize_excel.py" y
  "C:\Users\juana\Downloads\Volumen 3D reservorios normalizado.xlsx".

Entregable y recarga:
1. Genera el dataset normalizado limpio (xlsx + CSV) con las 12 columnas + identificador.
2. "Borrar los que estaban y hacer input de nuevo": el destino es la BD de GMT Link (PostgreSQL,
   vía su API / capa de ingesta). Purga los registros de volúmenes existentes y carga los limpios.
   ⚠️ Antes de borrar, haz un respaldo/export previo y muéstrame el conteo a eliminar para que lo
   confirme.

Criterio de aceptación: una sola tabla con las 12 columnas + identificador, operadores con nombre
completo, todas las cotas > 2000, conteo de filas validado por reservorio, datos viejos purgados
y datos limpios cargados.
```

---

## PROMPT 5 — Generar con nano banana la topología física de la arquitectura

```
Objetivo. Generar con NANO BANANA (modelo de imágenes de Google: Gemini Flash Image / "Nano
Banana" o "Nano Banana Pro") un diagrama de TOPOLOGÍA FÍSICA, claro y profesional, de la
arquitectura planteada para GMT Link + V-metric.

Arquitectura a representar (esta es la fuente de verdad del diagrama):
- DOS ZONAS claramente delimitadas:
  1) "NUBE GMT — Railway": aquí vive SOLO la LÓGICA. Componentes: API (NestJS), App Web (React/Vite),
     Autorización (OpenFGA), Caché/Colas (Redis), Workers en segundo plano (procesamiento asíncrono
     de archivos pesados: DEM/ortofotos), y un Gateway de Ingreso público (HTTPS).
  2) "DATA CENTER ALBEMARLE": aquí vive la BASE DE DATOS (PostgreSQL) — fuente de verdad,
     PROPIEDAD y bajo control de Albemarle. Detrás de su firewall corporativo. Opcional: pooler
     de conexiones (PgBouncer) y almacenamiento de objetos/archivos pesados del lado de Albemarle.
- IDEA CENTRAL: nosotros (GMT) alojamos solo lógica en Railway y CONSULTAMOS los datos EN TIEMPO
  REAL a los servidores de BD de Albemarle. Los datos no se quedan en Railway.
- GATEWAYS Y SEGURIDAD (mostrar explícitos, "security in mind"):
  * Gateway de Ingreso (borde Railway): TLS/HTTPS, WAF, rate-limiting, autenticación (token
    Firebase) + autorización (OpenFGA), y el OTP de no-repudio para subidas desde V-metric.
  * Enlace de Datos seguro Railway→Albemarle: túnel cifrado / VPN site-to-site o private link con
    mTLS, IP allowlist (solo la IP de egreso estática de Railway), usuario de BD de mínimo
    privilegio. El firewall de Albemarle solo acepta esa conexión.
  * Sin datos sensibles persistidos en Railway; secrets en gestor de secretos; auditoría/logging.
- ACTORES/CLIENTES (a la izquierda, entrando por el Gateway de Ingreso vía HTTPS):
  * Operadores/clientes en la App Web (navegador).
  * V-metric Desktop (app de escritorio que calcula volúmenes y SUBE resultados).
- FLECHAS DIRECCIONALES: usuarios → HTTPS → Gateway Ingreso → API (Railway); API → (túnel seguro
  mTLS) → PostgreSQL en Albemarle (lectura/escritura en tiempo real); V-metric Desktop → HTTPS
  (subida + OTP) → API.

Antes de generar, lee para no inventar nada: docs/GMT_LINK_PLAN_MAESTRO.md,
docs/prompts-nuevas-sesiones.md (este archivo) y
"C:\Users\juana\Downloads\Especificación Técnica y Arquitectura de Integración_ GMT Link y V_metric.md".

Tareas:
1. Redacta un prompt de imagen OPTIMIZADO para nano banana a partir de la arquitectura de arriba
   (usa como base el bloque "PROMPT DE IMAGEN" de abajo y mejóralo).
2. Genera la imagen con nano banana usando el acceso que esté configurado en esta sesión (API de
   Gemini / MCP / skill de imagen). Si no hay acceso a nano banana, ENTRÉGAME el prompt de imagen
   final listo para pegar en la interfaz de nano banana, más un fallback (diagrama mermaid o SVG)
   por si el render de texto sale ilegible.
3. Guarda la imagen en docs/diagramas/ (p. ej. docs/diagramas/topologia-fisica.png) y muéstramela.
4. Itera conmigo si el texto sale borroso o el orden de capas/flechas no calza.

PROMPT DE IMAGEN (base para pegar/afinar en nano banana):
"Diagrama profesional de topología de red e infraestructura física, vista isométrica limpia,
fondo claro, estilo técnico corporativo moderno, alta legibilidad. DOS zonas con marcos
etiquetados: a la izquierda 'NUBE GMT — Railway' conteniendo iconos de servidores rotulados
'API NestJS', 'Web React', 'OpenFGA', 'Redis', 'Workers' y un escudo 'Gateway de Ingreso
HTTPS/WAF'; a la derecha 'DATA CENTER ALBEMARLE' con un icono de base de datos rotulado
'PostgreSQL (fuente de verdad)' detrás de un 'Firewall corporativo'. Entre ambas zonas, un túnel
cifrado etiquetado 'VPN/mTLS — consulta en tiempo real' con candado. A la izquierda del todo, un
navegador 'App Web' y una laptop 'V-metric Desktop' conectados por flechas 'HTTPS' al Gateway de
Ingreso. Flechas direccionales que muestren: usuarios→Gateway→API, y API→túnel seguro→PostgreSQL.
Leyenda de seguridad: 'TLS, mTLS, IP allowlist, mínimo privilegio, OTP de no-repudio, sin datos
en la nube GMT'. Etiquetas cortas y nítidas en español, paleta azul/teal corporativa, 16:9."

⚠️ Notas para nano banana: mantené las etiquetas CORTAS (los modelos de imagen renderizan mal
textos largos); si algún rótulo sale ilegible, regéneralo simplificando o pídeme afinar. Este
diagrama va a docs/diagramas/ del repo de GMT Link (https://github.com/japalmo/GMT-Link).
```
