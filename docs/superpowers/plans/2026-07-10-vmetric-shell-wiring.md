# Plan — V-Metric Shell Wiring (track paralelo, mini-plan)

> **Para workers agénticos:** ejecutar con superpowers:subagent-driven-development. Track INDEPENDIENTE del deploy Finanzas/Roles. Casi todo el código vive en el repo **`C:/Users/juana/GMT/proyectos/v-metric`** (Python/PySide6); una única dependencia de backend vive en **`gmt-link/nodes/backend-central`** (Tarea B0, hand-off). Tareas con checkbox `- [ ]`.
>
> **Spec autoridad:** `gmt-link/docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md` §8 (V-Metric). Este mini-plan es el spec propio que §8 delega.

## Goal

Cablear el **shell NUEVO** de V-Metric (`poza/ui/`, hoy local-only SQLite) para que **lea/escriba cubicaciones y DEMs contra Railway `/metrics`** usando el JWT propio (`GmtSession`), sin reescribir el motor de cálculo. Se introduce un `MetricsClient` **inyectable** en `AppContext`, se cablea en el login, y `WorkspacePage` lo consume para persistir cubicaciones y subir/bajar DEMs — con **fallback local** para no perder mediciones en terreno.

## Arquitectura (estado real + decisión)

**Dos shells conviven en `v-metric`:**
- **Shell legacy** (`poza/gui_qt.py` + `poza/views/workspace_view.py`): YA habla con `/metrics`. En login llama `firebase_sync.set_session(session)` (`gui_qt.py:207,408`) y usa `firebase_sync.save_cubicacion_async` / `upload_dem_async` / `download_dem_by_blob_async` / `fetch_cubicaciones_async` / `fetch_dem_history_async` / `generate_otp` / `verify_otp`. **`firebase_sync` (`poza/firebase_sync.py`) ES el cliente que ya funciona contra `/metrics`** (vía `firebase_http.call_function`, que arma el header `Bearer` desde `session.token`/`.id_token`).
- **Shell nuevo** (`poza/ui/`): `main.py` arma `AppContext(session, repo, bus)` en `Application._build_shell` (`poza/ui/main.py`), pero **NUNCA llama `firebase_sync.set_session`** ni consume `/metrics`. `WorkspacePage` (`poza/ui/pages/workspace_page.py`) lee reservorios de `ctx.repo` (SQLite) y **calcula volúmenes localmente pero no persiste la cubicación en ningún lado remoto**, ni sube/baja DEMs. **Ese es el hueco a cerrar.**

**Decisión de estrategia: online-first contra Railway con persistencia/fallback local (write-through + outbox), NO sync bidireccional.**
Justificación: app de escritorio en terreno con red inestable → una medición nunca se debe perder. Cada guardado escribe **primero local** (instantáneo, ya funciona: `Repository.save_cubicacion`) y **luego** empuja a Railway en background; si el push falla, se **encola en el modelo `Outbox`** (ya existe: `poza/db/models.py` + `Repository.enqueue_outbox`) y un *drenaje* reintenta al próximo login. Las lecturas de historial son online-first con caída a cache local. Sync bidireccional con reconciliación es YAGNI para la demo y riesgoso dado el gap de modelo (abajo).

**Reuso, no reescritura:** el `MetricsClient` de Railway es una **fachada delgada sobre el `firebase_sync` existente** (async + callbacks, ya probado con la R2 signed-URL dance). El valor de inyectarlo en `AppContext` (vs. usar el singleton global) es: testabilidad, dependencia explícita, y un único lugar para la política online/fallback.

### GAP DE MODELO (crítico — aclaración + propuesta)

Hay **dos mundos** en Railway que hoy NO se tocan entre sí:

1. **Path vivo** (`MetricsController` en `nodes/backend-central/src/modules/metrics/metrics.controller.ts` + `.service.ts`): los endpoints `saveCubicacion` / `registerDemMetadata` / `getLatestDem` / `listDems` / `saveReservorioMetadata` escriben sobre el modelo canónico **`Element`/`Phase`/`Variable`/`DataPoint`** (`schema.prisma:837-935`). `saveCubicacion` exige:
   - un `Element` con `code == reservorio_codigo` en un `Project` sobre el que el usuario tenga la relación FGA **`can_submit_measurements`**;
   - una `Phase` activa cuyas `Variable.code` coincidan con las **claves del dict `datos`** (las demás se descartan);
   - `registerDemMetadata` además exige una variable con `code == 'dem_file'` en la fase activa.
2. **Data histórica migrada** (tablas standalone **`vmetric_*`**: `VmetricReservorio` / `VmetricCubicacion` / `VmetricDem` / `VmetricCotaReferencia`, `schema.prisma:964-1052`): tiene TODO el histórico real de V-Metric, pero **NO tiene controllers/endpoints** y **NO se relaciona** con `Element/Phase/Variable`. Leer/escribir vía `/metrics` hoy **no toca** estas tablas: son un archivo desconectado.

**Consecuencia:** el shell legacy (y este wiring, si usa los mismos endpoints) opera sobre el path vivo `Element/Phase/Variable`, que requiere aprovisionar cada reservorio como `Element` + una `Phase` con las `Variable` correctas + tuplas FGA. El histórico `vmetric_*` queda como archivo read-only inaccesible por API.

**Propuesta (2 tiempos):**
- **Ahora (este mini-plan, demo Fase 1):** usar el **path vivo** existente (endpoints ya listos + R2 ya cableado). Prerrequisito de backend **B0**: seed de un `Project` demo + `Element`s (uno por reservorio, `code` == código) + una `Phase` con las `Variable`s que consume la cubicación (`cota_espejo`, `cota_sal`, `vol_salmuera_total`, `vol_salmuera_libre`, `vol_sal`, `dem_file`) + tuplas FGA `can_submit_measurements`/`can_view` para los usuarios demo. Sin B0, `saveCubicacion` responde `404 Elemento no encontrado` o `403`.
- **Follow-up recomendado (se FLAGGEA, no se construye aquí):** agregar endpoints `/metrics` CRUD delgados sobre las tablas `vmetric_*` (por `reservorio_codigo`), para que V-Metric lea su histórico real migrado y agregue cubicaciones ahí sin el andamiaje `Element/Phase/Variable`. Es el hogar natural de la data V-Metric y elimina la impedancia. Ver **Riesgos R1** + tarea de spawn.

**Nota de contrato compartido:** el acceso de este track es **FGA a nivel de proyecto** (`can_submit_measurements` / `can_view`), NO los bundles de permisos de finanzas del spec §2 ni el hook `useHasPermission`. Son planos de autorización distintos: no confundir.

## Tech Stack

Cliente: Python 3.11+ · PySide6/Qt · SQLAlchemy (SQLite local) · `requests`. Backend consumido: NestJS + Prisma + OpenFGA + R2 (Railway `/metrics`). Auth: JWT propio (`GmtSession`, `poza/gmt_auth.py`). Tests: `pytest` (con `QT_QPA_PLATFORM=offscreen` para los que tocan Qt).

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `poza/metrics_client.py` | **crear** | Protocol `MetricsClient` + `RailwayMetricsClient` (fachada sobre `firebase_sync` + política write-through/outbox) + `NullMetricsClient` (offline). |
| `poza/ui/app_context.py` | modificar | Agregar campo `metrics: MetricsClient` al dataclass. |
| `poza/ui/main.py` | modificar | Construir el `MetricsClient`, cablear `set_session` en login/restore, inyectarlo en `AppContext`, drenar `Outbox`. |
| `poza/ui/pages/workspace_page.py` | modificar | Botón "Guardar cubicación" → `ctx.metrics.save_cubicacion` (write-through local); DEM: subir con `ctx.metrics.upload_dem`, historial/descarga con `fetch_dem_history`/`download_dem_by_blob`. |
| `poza/db/repository.py` | modificar | `list_pending_outbox()` + `mark_outbox_sent()` (drenaje). |
| `tests/test_metrics_client.py` | **crear** | TDD del `RailwayMetricsClient` (mock `firebase_sync`, verifica write-through y encolado en fallo). |
| `tests/test_appcontext_wiring.py` | **crear** | Verifica que `main._build_shell` inyecta `metrics` con la sesión seteada. |
| `nodes/backend-central/prisma/seed-vmetric-demo.ts` | **crear (B0, hand-off)** | Seed demo: Project + Elements + Phase + Variables + tuplas FGA. |

---

## Bloque B0 — Prerrequisito de backend (HAND-OFF a gmt-link, bloqueante del path vivo)

> Este bloque toca **`gmt-link/nodes/backend-central`**, no `v-metric`. El worker de V-Metric NO lo implementa: lo consume. Si no está, las tareas 3+ fallan con 404/403. Coordinar con el controlador antes de arrancar el Bloque 3, o correr contra un backend local ya sembrado.

### Tarea B0.1: Seed demo de la jerarquía Element/Phase/Variable + FGA para V-Metric

**Files:** `gmt-link/nodes/backend-central/prisma/seed-vmetric-demo.ts` (crear).

- [ ] Crear (o reutilizar) un `Project` demo y, por cada reservorio de prueba (p.ej. `R2`), un `Element`:
  ```ts
  await prisma.element.upsert({
    where: { code: 'R2' },
    update: {},
    create: { code: 'R2', name: 'Reservorio R2', type: 'RESERVORIO', projectId: demoProject.id },
  });
  ```
- [ ] Crear un `Service` en el proyecto y una `Phase` con las `Variable`s que consume la cubicación (los `code` DEBEN coincidir con las claves de `datos`, ver Tarea 3.2) + `dem_file`:
  ```ts
  const phase = await prisma.phase.create({ data: { code: 'demo-2026', name: 'Demo 2026', serviceId: service.id } });
  const vars = [
    { code: 'cota_espejo', name: 'Cota espejo', type: 'METROS', unit: 'm' },
    { code: 'cota_sal', name: 'Cota sal', type: 'METROS', unit: 'm' },
    { code: 'vol_salmuera_total', name: 'Vol. salmuera total', type: 'M3', unit: 'm³' },
    { code: 'vol_salmuera_libre', name: 'Vol. salmuera libre', type: 'M3', unit: 'm³' },
    { code: 'vol_sal', name: 'Vol. sal', type: 'M3', unit: 'm³' },
    { code: 'dem_file', name: 'Archivo DEM', type: 'FILE' },
  ];
  for (const v of vars) await prisma.variable.upsert({ where: { phaseId_code: { phaseId: phase.id, code: v.code } }, update: {}, create: { ...v, phaseId: phase.id } });
  ```
- [ ] Escribir las tuplas FGA para los usuarios demo (patrón de `FgaService`): `user:<id>` con `can_submit_measurements` y `can_view` sobre `project:<demoProject.id>`.
- [ ] Comando: `pnpm --filter backend-central exec ts-node prisma/seed-vmetric-demo.ts` → **Output esperado:** `Seed V-Metric demo OK: 1 project, N elements, 6 variables`.
- [ ] **Commit:** `feat(metrics): seed demo Element/Phase/Variable + FGA para V-Metric`.

---

## Bloque 1 — MetricsClient inyectable (repo v-metric, TDD)

### Tarea 1.1: Test del `RailwayMetricsClient` (RED)

**Files:** `tests/test_metrics_client.py` (crear).

- [ ] Escribir tests que mockeen el singleton `firebase_sync` y un `Repository` en memoria:
  ```python
  from unittest.mock import MagicMock
  from poza.metrics_client import RailwayMetricsClient

  def test_set_session_forwards_to_firebase_sync():
      fb = MagicMock()
      c = RailwayMetricsClient(fb_sync=fb, repo_factory=MagicMock())
      sess = object()
      c.set_session(sess)
      fb.set_session.assert_called_once_with(sess)

  def test_save_cubicacion_writes_local_then_pushes():
      fb = MagicMock(); fb.available = True
      repo = MagicMock()
      c = RailwayMetricsClient(fb_sync=fb, repo_factory=lambda: repo)
      c.save_cubicacion("R2", {"cota_sal": 1.0}, uid="u1")
      # write-through local primero:
      repo.save_cubicacion_from_datos.assert_called_once()
      # push async a Railway:
      fb.save_cubicacion_async.assert_called_once()

  def test_push_failure_enqueues_outbox():
      fb = MagicMock(); fb.available = True
      # save_cubicacion_async invoca on_error → debe encolar
      def fake_push(*, reservorio_codigo, datos, uid, on_success, on_error):
          on_error(RuntimeError("boom"))
      fb.save_cubicacion_async.side_effect = fake_push
      repo = MagicMock()
      c = RailwayMetricsClient(fb_sync=fb, repo_factory=lambda: repo)
      c.save_cubicacion("R2", {"cota_sal": 1.0}, uid="u1")
      repo.enqueue_outbox.assert_called_once()
  ```
- [ ] Comando: `pytest tests/test_metrics_client.py -q` → **Output esperado:** falla con `ModuleNotFoundError: poza.metrics_client` (RED).

### Tarea 1.2: Implementar `MetricsClient` + `RailwayMetricsClient` + `NullMetricsClient` (GREEN)

**Files:** `poza/metrics_client.py` (crear).

- [ ] Definir el Protocol y las implementaciones. La fachada **delega en `firebase_sync`** (async+callbacks ya probados) y aplica la política write-through/outbox:
  ```python
  from __future__ import annotations
  import logging
  from typing import Any, Callable, Optional, Protocol, runtime_checkable

  logger = logging.getLogger(__name__)

  @runtime_checkable
  class MetricsClient(Protocol):
      def set_session(self, session: Any | None) -> None: ...
      @property
      def available(self) -> bool: ...
      def save_cubicacion(self, reservorio_codigo: str, datos: dict, uid: str = "local",
                          on_success: Optional[Callable[[str], None]] = None,
                          on_error: Optional[Callable[[Exception], None]] = None) -> None: ...
      def upload_dem(self, reservorio_codigo: str, local_path: str,
                     on_success: Optional[Callable[[str], None]] = None,
                     on_error: Optional[Callable[[Exception], None]] = None) -> None: ...
      def download_dem_by_blob(self, blob_path: str, dest_path: str,
                               on_success: Optional[Callable[[str], None]] = None,
                               on_error: Optional[Callable[[Exception], None]] = None) -> None: ...
      def fetch_cubicaciones(self, reservorio_codigo: str, on_result: Callable[[list], None],
                             on_error: Optional[Callable[[Exception], None]] = None) -> None: ...
      def fetch_dem_history(self, reservorio_codigo: str, on_result: Callable[[list], None],
                            on_error: Optional[Callable[[Exception], None]] = None) -> None: ...
      def save_reservorio_metadata(self, reservorio_codigo: str, nombre: str, extra: dict | None = None,
                                   on_success: Optional[Callable[[], None]] = None,
                                   on_error: Optional[Callable[[Exception], None]] = None) -> None: ...
      def generate_otp(self, email: str) -> dict: ...
      def verify_otp(self, email: str, otp: str) -> dict: ...


  class RailwayMetricsClient:
      """Fachada online-first sobre `firebase_sync`, con write-through local + Outbox.

      `repo_factory` devuelve un Repository sobre una SESIÓN NUEVA (los callbacks de
      firebase_sync corren en threads; se usa SessionLocal(), patrón de
      firebase_sync.upload_asset). NO se comparte la sesión viva del AppContext.
      """
      def __init__(self, fb_sync: Any, repo_factory: Callable[[], Any]) -> None:
          self._fb = fb_sync
          self._repo_factory = repo_factory

      def set_session(self, session: Any | None) -> None:
          self._fb.set_session(session)

      @property
      def available(self) -> bool:
          return bool(self._fb.available)

      def save_cubicacion(self, reservorio_codigo, datos, uid="local", on_success=None, on_error=None) -> None:
          # 1) write-through local (fuente de verdad de la sesión del operador)
          try:
              repo = self._repo_factory()
              repo.save_cubicacion_from_datos(reservorio_codigo, uid, datos)
          except Exception as exc:  # noqa: BLE001
              logger.warning("write-through local de cubicación falló: %s", exc)
          # 2) push online; en fallo → Outbox
          def _err(exc: Exception) -> None:
              try:
                  self._repo_factory().enqueue_outbox(
                      "cubicacion", reservorio_codigo, "save",
                      {"reservorio_codigo": reservorio_codigo, "datos": datos, "uid": uid},
                  )
              except Exception:  # noqa: BLE001
                  logger.exception("no se pudo encolar cubicación en Outbox")
              if on_error:
                  on_error(exc)
          if not self._fb.available:
              _err(RuntimeError("sin sesión/red"))
              return
          self._fb.save_cubicacion_async(
              reservorio_codigo=reservorio_codigo, datos=datos, uid=uid,
              on_success=on_success, on_error=_err,
          )

      def upload_dem(self, reservorio_codigo, local_path, on_success=None, on_error=None) -> None:
          self._fb.upload_dem_async(reservorio_codigo, local_path, on_success=on_success, on_error=on_error)

      def download_dem_by_blob(self, blob_path, dest_path, on_success=None, on_error=None) -> None:
          self._fb.download_dem_by_blob_async(blob_path, dest_path, on_success=on_success, on_error=on_error)

      def fetch_cubicaciones(self, reservorio_codigo, on_result, on_error=None) -> None:
          self._fb.fetch_cubicaciones_async(reservorio_codigo, on_result=on_result, on_error=on_error)

      def fetch_dem_history(self, reservorio_codigo, on_result, on_error=None) -> None:
          self._fb.fetch_dem_history_async(reservorio_codigo, on_result=on_result, on_error=on_error)

      def save_reservorio_metadata(self, reservorio_codigo, nombre, extra=None, on_success=None, on_error=None) -> None:
          self._fb.save_reservorio_metadata_async(reservorio_codigo, nombre, extra=extra, on_success=on_success, on_error=on_error)

      def generate_otp(self, email: str) -> dict:
          return self._fb.generate_otp(email)

      def verify_otp(self, email: str, otp: str) -> dict:
          return self._fb.verify_otp(email, otp)


  class NullMetricsClient:
      """Sin backend: todo queda local. `available` = False; los push encolan/omiten."""
      def set_session(self, session): pass
      @property
      def available(self) -> bool: return False
      def save_cubicacion(self, reservorio_codigo, datos, uid="local", on_success=None, on_error=None):
          if on_error: on_error(RuntimeError("MetricsClient no disponible"))
      def upload_dem(self, *a, **k):
          cb = k.get("on_error");  cb and cb(RuntimeError("offline"))
      def download_dem_by_blob(self, *a, **k):
          cb = k.get("on_error");  cb and cb(RuntimeError("offline"))
      def fetch_cubicaciones(self, reservorio_codigo, on_result, on_error=None): on_result([])
      def fetch_dem_history(self, reservorio_codigo, on_result, on_error=None): on_result([])
      def save_reservorio_metadata(self, *a, **k):
          cb = k.get("on_success");  cb and cb()
      def generate_otp(self, email): return {"success": False, "message": "offline"}
      def verify_otp(self, email, otp): return {"success": False}
  ```
- [ ] Comando: `pytest tests/test_metrics_client.py -q` → **Output esperado:** 3 passed (GREEN).
- [ ] **Commit:** `feat(vmetric): MetricsClient inyectable sobre firebase_sync con write-through + Outbox`.

### Tarea 1.3: `Repository.save_cubicacion_from_datos` + helpers de Outbox

**Files:** `poza/db/repository.py` (modificar), `tests/test_repository_cubicacion_from_datos.py` (crear).

- [ ] RED: test que verifica el mapeo `datos` → `Cubicacion` local resolviendo el reservorio por código:
  ```python
  def test_save_cubicacion_from_datos_maps_keys(repo, seeded_reservorio):  # fixtures existentes
      c = repo.save_cubicacion_from_datos("R2", "u1", {
          "cota_sal": 2.5, "cota_espejo": 3.0,
          "vol_salmuera_total": 100.0, "vol_salmuera_libre": 80.0, "vol_sal": 20.0,
      })
      assert c.cota_sal == 2.5 and c.vol_salmuera_total_m3 == 100.0
  ```
- [ ] GREEN: agregar el método (reutiliza `get_reservorio_by_codigo`, `list_users`/`usuario_id` opcional). El mapeo de claves refleja el payload legacy (`workspace_view.py:1740-1746`):
  ```python
  def save_cubicacion_from_datos(self, reservorio_codigo: str, uid: str, datos: dict) -> "Cubicacion":
      res = self.get_reservorio_by_codigo(reservorio_codigo)
      if res is None:
          raise RepoError(f"Reservorio '{reservorio_codigo}' no existe localmente.")
      from ..core import PondVolumes
      vols = PondVolumes(
          salt_level=datos.get("cota_sal", 0.0),
          water_level=datos.get("cota_espejo", datos.get("cota_agua", 0.0)),
          occluded_fraction=datos.get("fraccion_ocluida", 0.0),
          salt_total_m3=datos.get("vol_sal", datos.get("vol_sal_m3")),
          brine_free_m3=datos.get("vol_salmuera_libre", datos.get("vol_salmuera_libre_m3")),
          brine_occluded_m3=datos.get("vol_salmuera_ocluida", datos.get("vol_salmuera_ocluida_m3")),
          brine_total_m3=datos.get("vol_salmuera_total", datos.get("vol_salmuera_total_m3")),
      )
      # usuario_id: shadow user por uid si existe; None si no se resuelve
      usuario_id = getattr(res, "id", None) and None  # placeholder: usar 1 (admin local) si no hay mapeo
      return self.save_cubicacion(res.id, usuario_id or 1, vols, origen=datos.get("origen", "medicion"))
  ```
  > NOTA: confirmar los nombres reales de campos de `PondVolumes` en `poza/core.py` antes de construirlo (el mapeo de arriba refleja `Repository.save_cubicacion` líneas 286-294). Ajustar si difieren.
- [ ] Agregar helpers de drenaje:
  ```python
  def list_pending_outbox(self, entity_type: str | None = None, limit: int = 200) -> list["Outbox"]:
      from .models import Outbox
      q = select(Outbox).where(Outbox.sent_at.is_(None)).order_by(Outbox.id).limit(limit)
      if entity_type is not None:
          q = q.where(Outbox.entity_type == entity_type)
      return list(self.session.scalars(q))

  def mark_outbox_sent(self, outbox_id: int) -> None:
      from .models import Outbox
      row = self.session.get(Outbox, outbox_id)
      if row is not None:
          row.sent_at = datetime.utcnow()
          self.session.commit()
  ```
  > NOTA: confirmar que `Outbox` tiene columna `sent_at` (o equivalente `processed_at`) en `poza/db/models.py:379`; si no, agregar la columna + init_db la crea (SQLite dev). Ajustar el nombre en los helpers.
- [ ] Comando: `pytest tests/test_repository_cubicacion_from_datos.py -q` → **Output esperado:** passed.
- [ ] **Commit:** `feat(vmetric): mapeo datos→Cubicacion local + helpers de drenaje Outbox`.

---

## Bloque 2 — Inyección en AppContext + cableado en el login

### Tarea 2.1: Agregar `metrics` a `AppContext`

**Files:** `poza/ui/app_context.py` (modificar).

- [ ] Agregar el campo (después de `bus`), con import bajo `TYPE_CHECKING`:
  ```python
  if TYPE_CHECKING:
      from ..gmt_auth import GmtSession
      from ..db.repository import Repository
      from .session import DataBus
      from ..metrics_client import MetricsClient

  @dataclass
  class AppContext:
      session: "GmtSession"
      repo: "Repository"
      bus: "DataBus"
      metrics: "MetricsClient"
      extra: dict[str, Any] | None = None
  ```
- [ ] Comando: `python -c "import poza.ui.app_context"` → **Output esperado:** sin error.
- [ ] **Commit:** `feat(vmetric): AppContext expone MetricsClient`.

### Tarea 2.2: Test de wiring del shell (RED→GREEN)

**Files:** `tests/test_appcontext_wiring.py` (crear).

- [ ] Test (con `QT_QPA_PLATFORM=offscreen`) que verifica que al construir el shell se inyecta `metrics` y se setea la sesión:
  ```python
  import os; os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
  from poza.ui.main import Application
  from poza.ui.session import DataBus
  from poza.metrics_client import RailwayMetricsClient

  def test_build_shell_injects_metrics_with_session(monkeypatch):
      called = {}
      import poza.metrics_client as mc
      class Spy(RailwayMetricsClient):
          def set_session(self, s): called["session"] = s
      # forzar el factory a devolver el Spy (ver Tarea 2.3 para el punto de construcción)
      app = Application(DataBus())
      fake_session = type("S", (), {"nombre_completo": "T", "rol": "operador", "email": "t@t.cl"})()
      app.show_shell(fake_session)
      assert isinstance(app.ctx.metrics, RailwayMetricsClient)
      assert called.get("session") is fake_session
  ```
- [ ] Comando: `QT_QPA_PLATFORM=offscreen pytest tests/test_appcontext_wiring.py -q` → **Output esperado:** falla (RED, aún no inyecta).

### Tarea 2.3: Construir e inyectar el `MetricsClient` en `main.py`

**Files:** `poza/ui/main.py` (modificar).

- [ ] En `_build_shell`, construir el client, setear la sesión e inyectarlo:
  ```python
  def _build_shell(self, session) -> AppShell:
      from ..db import Repository, get_session, SessionLocal
      from ..firebase_sync import firebase_sync
      from ..metrics_client import RailwayMetricsClient

      self._db_session = get_session()
      repo = Repository(self._db_session)

      metrics = RailwayMetricsClient(
          fb_sync=firebase_sync,
          repo_factory=lambda: Repository(SessionLocal()),  # sesión nueva por callback/thread
      )
      metrics.set_session(session)                          # ← cablea el Bearer en /metrics
      self.ctx = AppContext(session=session, repo=repo, bus=self.bus, metrics=metrics)
      self._drain_outbox(metrics, repo)                     # reintenta pushes pendientes
      ...
  ```
  > `SessionLocal` ya se importa así en `firebase_sync.upload_asset` (`from .db import SessionLocal, Asset`). Confirmar que `poza/db/__init__.py` lo re-exporta.
- [ ] En `_on_logout`, limpiar la sesión del client: `if self.ctx: self.ctx.metrics.set_session(None)`.
- [ ] Agregar el drenaje de Outbox (best-effort, no bloquea el arranque):
  ```python
  def _drain_outbox(self, metrics, repo) -> None:
      try:
          pending = repo.list_pending_outbox(entity_type="cubicacion")
      except Exception:
          return
      for row in pending:
          import json
          payload = json.loads(row.payload_json) if row.payload_json else {}
          rid = row.id
          metrics.save_cubicacion(
              payload.get("reservorio_codigo", ""), payload.get("datos", {}),
              uid=payload.get("uid", "local"),
              on_success=lambda _doc, _rid=rid: repo.mark_outbox_sent(_rid),
          )
  ```
- [ ] Comando: `QT_QPA_PLATFORM=offscreen pytest tests/test_appcontext_wiring.py -q` → **Output esperado:** passed (GREEN).
- [ ] **Commit:** `feat(vmetric): cablear MetricsClient en login/restore + drenaje de Outbox`.

---

## Bloque 3 — WorkspacePage consume `/metrics` (requiere B0)

### Tarea 3.1: Botón "Guardar cubicación" → `ctx.metrics.save_cubicacion`

**Files:** `poza/ui/pages/workspace_page.py` (modificar), `poza/ui/pages/workspace/control_panel.py` (modificar: agregar señal/botón).

- [ ] En `ControlPanel`, agregar botón "Guardar cubicación" (habilitado sólo con `latest_result`) y señal `save_requested = Signal()`. Conectar en `_connect_signals` de `WorkspacePage`:
  ```python
  self.control.save_requested.connect(self._save_cubicacion)
  ```
- [ ] Agregar la señal-puente y el handler (mismo patrón de marshaling que el resto de la página, líneas 69-72):
  ```python
  _sig_save_status = Signal(str)   # declarar junto a las otras señales-puente
  # en _connect_signals:
  self._sig_save_status.connect(self.status.setText)

  def _save_cubicacion(self) -> None:
      if not self.latest_result or not self.current_reservorio_codigo:
          self.status.setText("Calcula una cubicación y selecciona un reservorio primero.")
          return
      r = self.latest_result
      datos = {   # claves == Variable.code sembradas en B0.1 y payload legacy (workspace_view.py:1740)
          "cota_espejo": getattr(r, "cota_espejo", None),
          "cota_sal": getattr(r, "cota_sal", None),
          "vol_salmuera_total": r.brine_total_m3,
          "vol_salmuera_libre": r.brine_free_m3,
          "vol_sal": getattr(r, "salt_m3", getattr(r, "salt_total_m3", None)),
      }
      uid = str(getattr(self.ctx.session, "uid", "") or "local")
      self.status.setText("Guardando cubicación…")
      self.ctx.metrics.save_cubicacion(
          self.current_reservorio_codigo, datos, uid=uid,
          on_success=lambda doc_id: self._sig_save_status.emit(f"Cubicación registrada (ID: {doc_id})."),
          on_error=lambda err: self._sig_save_status.emit(f"Guardado local; pendiente de subir ({err})."),
      )
  ```
  > `getattr` defensivo: los nombres exactos de `PondVolumes` se confirman en `poza/core.py`. El fallback ya deja la cubicación local aunque el push falle (Bloque 1).
- [ ] Comando (smoke): `QT_QPA_PLATFORM=offscreen python -c "from poza.ui.pages.workspace_page import WorkspacePage"` → sin error de import.
- [ ] **Commit:** `feat(vmetric): Workspace guarda cubicación en Railway con fallback local`.

### Tarea 3.2: DEM — subir a R2 vía `/metrics` tras cargar

**Files:** `poza/ui/pages/workspace_page.py` (modificar).

- [ ] Tras aplicar un DEM cargado desde disco (`_on_dem_loaded`, líneas 247-265), ofrecer subirlo a Railway (R2). Reusa `ctx.metrics.upload_dem` (que internamente hace `createDemUploadUrl` → PUT R2 → habría que registrar metadata; ver nota):
  ```python
  def _on_dem_loaded(self, path: str, renderer) -> None:
      ...  # (código existente)
      finally:
          self._set_dem_loading(False)
      if self.current_reservorio_codigo and self.ctx.metrics.available:
          self.status.setText("Subiendo DEM a la nube…")
          self.ctx.metrics.upload_dem(
              self.current_reservorio_codigo, self.dem_path,
              on_success=lambda blob: self._sig_save_status.emit(f"DEM sincronizado ({blob})."),
              on_error=lambda err: self._sig_save_status.emit(f"DEM local; no se subió ({err})."),
          )
  ```
  > **Gap a cubrir:** `firebase_sync.upload_dem_async` sube el .tif a R2 pero **no** llama `registerDemMetadata` (crea el DataPoint `dem_file`). El shell legacy lo hacía aparte. **Sub-paso:** extender `RailwayMetricsClient.upload_dem` para, en el `on_success` del upload, encadenar `firebase_sync.upload_dem_metadata_async(reservorio_codigo, dem_id=0, archivo=Path(local_path).name, uid=..., blob_path=blob)` → así queda registrado y `getLatestDem`/`listDems` lo devuelven. Agregar test en `tests/test_metrics_client.py` (encadenamiento upload→register).
- [ ] Comando: `pytest tests/test_metrics_client.py -q` → passed (incluye el test de encadenamiento).
- [ ] **Commit:** `feat(vmetric): subir DEM a R2 + registrar metadata al cargarlo en Workspace`.

### Tarea 3.3: DEM — historial + descarga desde Railway

**Files:** `poza/ui/pages/workspace_page.py` (modificar), `poza/ui/pages/workspace/layers_area.py` o `control_panel.py` (agregar acción "DEM de la nube").

- [ ] Al cambiar de reservorio (`_on_reservorio_changed`, línea 191), pedir el historial de DEMs remoto y exponer el último para descarga:
  ```python
  def _on_reservorio_changed(self, codigo) -> None:
      ...  # (código existente de máscara)
      if codigo and self.ctx.metrics.available:
          self.ctx.metrics.fetch_dem_history(
              codigo,
              on_result=lambda rows: self._sig_dem_history.emit(rows),
              on_error=lambda _e: None,
          )
  ```
- [ ] Agregar `_sig_dem_history = Signal(object)` y un handler que, ante un DEM remoto, permita descargarlo a un temp y cargarlo con el flujo existente `_load_dem_from_path`:
  ```python
  def _on_dem_history(self, rows: list) -> None:
      if not rows:
          return
      latest = rows[0]  # listDems ya ordena desc por createdAt
      blob = latest.get("blob_path")
      if not blob:
          return
      from pathlib import Path
      dest = Path.home() / ".cache" / "cubicador" / "dems" / (latest.get("archivo") or "dem.tif")
      self.status.setText("Descargando último DEM de la nube…")
      self.ctx.metrics.download_dem_by_blob(
          blob, str(dest),
          on_success=lambda p: self._sig_dem_loaded_remote.emit(p),
          on_error=lambda err: self._sig_save_status.emit(f"No se pudo bajar DEM: {err}"),
      )
  # _sig_dem_loaded_remote → self._load_dem_from_path (marshalado a UI thread)
  ```
  > Reusa `LocalDemCache` (`poza/firebase_sync.py:701`, ya instanciado como `dem_cache`) para el directorio de cache en vez de recomputar la ruta. Preferir `dem_cache.cache_dir`.
- [ ] Comando (smoke con backend local sembrado B0): correr la app, seleccionar `R2`, verificar en status "Descargando último DEM…" → DEM se carga en el canvas.
- [ ] **Commit:** `feat(vmetric): historial y descarga de DEM desde Railway en Workspace`.

---

## Bloque 4 — Verificación e2e (requiere B0 + backend Railway/local corriendo)

### Tarea 4.1: Smoke e2e contra backend local

**Files:** (sin cambios; verificación).

- [ ] Levantar backend: en `gmt-link` → `pnpm dev` (api en 3001), correr seed **B0.1**.
- [ ] Setear en el entorno de V-Metric: `VMETRIC_GMT_LINK_API_URL=http://localhost:3001/metrics` (ya es el default, `poza/firebase_config.py:22`).
- [ ] Correr V-Metric shell nuevo: `python -m poza.ui.main` (o el entrypoint real). Login con un usuario demo sembrado con FGA.
- [ ] Verificar el ciclo: seleccionar `R2` → cargar DEM local → se sube a R2 (status confirma) → calcular volumen → "Guardar cubicación" → status "Cubicación registrada (ID: …)".
- [ ] Verificar en la BD: `psql` → `SELECT * FROM data_points ORDER BY "createdAt" DESC LIMIT 5;` muestra los DataPoints nuevos (cota_sal, vol_*), y el `dem_file` con `fileUrl` apuntando a la key R2 `dems/R2/...`.
- [ ] Verificar fallback: apagar la api, "Guardar cubicación" → status "Guardado local; pendiente de subir"; `SELECT * FROM outbox WHERE sent_at IS NULL` (SQLite local) tiene la fila. Reencender api + relogin → drenaje sube y marca `sent_at`.
- [ ] **Commit:** `test(vmetric): verificación e2e wiring /metrics documentada` (si se agregan fixtures/notas).

### Tarea 4.2: Correr toda la suite + lint

- [ ] Comando: `QT_QPA_PLATFORM=offscreen pytest -q` → **Output esperado:** toda la suite verde (incluidos los tests nuevos).
- [ ] **Commit final del track** (lo hace el controlador).

---

## Riesgos / Decisiones abiertas

- **R1 — Gap `vmetric_*` ↔ `Element/Phase/Variable` (el más importante).** Este wiring escribe en el path vivo `Element/Phase/Variable/DataPoint`, NO en las tablas `vmetric_*` con el histórico migrado. Para la demo alcanza (B0 siembra el andamiaje), pero el histórico real queda inaccesible por API y la cubicación nueva NO aterriza junto a la data migrada. **Propuesta de follow-up:** endpoints `/metrics` CRUD delgados sobre `vmetric_*` por `reservorio_codigo` (leer histórico real + append), evitando el andamiaje. Decisión de producto pendiente: ¿la demo muestra data migrada real (requiere el follow-up) o data de juguete sembrada en B0 (alcanza este plan)? **Se recomienda spawnear la tarea de follow-up de backend.**
- **R2 — Aprovisionamiento por reservorio.** `saveCubicacion` falla con 404 si no existe el `Element` con `code == reservorio_codigo`, y con 403 si el usuario no tiene FGA `can_submit_measurements`. B0 debe cubrir TODOS los reservorios demo y TODOS los usuarios de prueba. Alternativa a evaluar: que `saveReservorioMetadata` (que ya hace `element.upsert`) autocree el Element en el primer uso — pero necesita `proyecto_id` o membership PROJECT del usuario (`metrics.service.ts:680-698`).
- **R3 — Claves de `datos` ↔ `Variable.code`.** `saveCubicacion` descarta silenciosamente las claves de `datos` sin `Variable` homónima (`metrics.service.ts:494-506`, devuelve `doc_id: null` si ninguna matchea). Los `code` sembrados en B0.1 DEBEN ser exactamente los emitidos en Tarea 3.1. Un mismatch = cubicación "guardada" sin datos y sin error visible. Cubrir con el test e2e (4.1) verificando `data_points`.
- **R4 — `PondVolumes` field names.** El mapeo en 1.3/3.1 asume atributos (`cota_espejo`, `cota_sal`, `salt_m3`, `brine_*_m3`). Confirmar contra `poza/core.py` antes de codear; hay dos convenciones en el repo (`Repository.save_cubicacion` usa `salt_level`/`salt_total_m3`; el view legacy usa `cota_sal`/`salt_m3`). Usar `getattr` defensivo y un test unitario del mapeo.
- **R5 — Sesión de BD en threads.** Los callbacks de `firebase_sync` corren en threads daemon; escribir en la sesión viva del `AppContext` (main thread) es inseguro. Por eso `RailwayMetricsClient` usa `repo_factory` con `SessionLocal()` nuevo por operación (patrón `firebase_sync.upload_asset`). No compartir `ctx.repo.session` con los callbacks.
- **R6 — `upload_dem_async` no registra metadata.** Cubierto en 3.2 (encadenar `upload_dem_metadata_async`). Si se omite, el DEM sube a R2 pero `getLatestDem`/`listDems` no lo ven (no hay DataPoint `dem_file`).
- **R7 — Columna `Outbox.sent_at`.** Verificar que existe en `poza/db/models.py`; si no, agregarla (SQLite dev la crea vía `init_db`). Sin ella, el drenaje no puede marcar procesados y reintentaría en loop.
- **R8 — OTP en el flujo nuevo.** El shell legacy exige OTP (`generate_otp`/`verify_otp`) antes de guardar cubicación. Este plan NO lo incluye en el shell nuevo (simplificación demo). Decisión abierta: ¿se exige OTP en el shell nuevo? Si sí, agregar un `OtpVerificationDialog` (reusar `poza/protocol_creation.py`) antes de 3.1.
