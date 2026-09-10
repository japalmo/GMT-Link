# Contexto para presentación a Gerencia de GMT SpA

> **Uso de este documento.** Es un paquete de contexto para que otra IA construya una presentación ejecutiva. NO es la presentación. Presentan **Juan Apalmo** junto a **Nicolás Vargas** (ingeniero informático, equipo de Juan) a la Gerencia de GMT SpA.
>
> **Etiquetas de confianza:**
> `[CONFIRMADO]` evidencia en código/documentos/memoria del proyecto ·
> `[DECISIÓN DE JUAN]` decisión ya tomada, registrada ·
> `[PENDIENTE]` abierto, sin cerrar ·
> `[RECOMENDACIÓN]` propuesta, no un hecho ·
> `[APORTADO POR JUAN]` dato entregado por Juan en la preparación (no verificable en código).
>
> **Alcance de la fuente:** el contexto técnico y de desarrollo proviene del código y los documentos de los proyectos. El contexto comercial/contractual, actas y relación con proveedores fue aportado por Juan. Donde no hay evidencia, se indica.

---

## RESUMEN EJECUTIVO (10 puntos)

1. **GMT Link ya es una realidad en producción**, no un prototipo: corre en línea y el módulo de **Finanzas está en uso real con 11 usuarios**. Es el activo digital más maduro de GMT. `[CONFIRMADO]`
2. **GMT Link creció por módulos técnicos, no por procesos levantados con las áreas.** Esa es la tensión central de la reunión. `[CONFIRMADO/RECOMENDACIÓN]`
3. **V-Metric cambió de naturaleza:** de "cubicador de pozas" a **workspace geoespacial general** integrado a GMT Link. El cambio de rumbo **no está formalizado** y **solo existen acuerdos verbales, nada por escrito**. `[DECISIÓN DE JUAN + APORTADO POR JUAN]`
4. **V-Metric tiene el motor construido y probado, pero no una versión estable entregada.** Falta interfaz final, importador de formatos de terreno, tu validación en terreno, y consolidar/desplegar las ramas. `[CONFIRMADO]`
5. **Riesgo central de V-Metric:** seguir desarrollando funciones avanzadas sin fijar un MVP ni un marco formal. `[RECOMENDACIÓN]`
6. **Oportunidad comercial:** si **Albemarle compra el software**, se abre la necesidad de arquitectura física en terreno. Hoy todo corre en la nube. `[APORTADO POR JUAN]`
7. **Recursos Humanos aún no existe como módulo.** El gap concreto es **gestión de acreditaciones en faena y alertas de vencimiento**, que reutiliza un motor de alertas que ya construimos para la flota de vehículos. `[CONFIRMADO estado + APORTADO POR JUAN]`
8. **Nexbu (web GMT) está en desarrollo, presentó carta Gantt y reporta avance.** Nuestra postura: esperar su presentación formal para revisar y devolver correcciones. `[APORTADO POR JUAN]`
9. **Costo de operar lo digital es bajo:** infraestructura entre **USD 5 y USD 15 al mes**; la única herramienta relevante es la suscripción de IA, escalable según etapa. `[APORTADO POR JUAN]`
10. **La reunión debe salir con decisiones**, no solo información: nuevo alcance de V-Metric, validación de GMT Link, autorización de levantamiento de procesos por área con contrapartes, y postura sobre web e IA. `[RECOMENDACIÓN]`

---

## 1. V-METRIC

### Origen y alcance original
- `[CONFIRMADO]` Nació como **fork de un "cubicador de pozas"**. App de **escritorio** (Python + Qt, geoespacial), para **calcular volúmenes** (salmuera/sal/ocluido/total) a partir de modelos de elevación (DEM) en operaciones de salar (Salar de Atacama, UTM 19S). Contexto operacional: **Albemarle**.
- `[CONFIRMADO]` Stack de datos original (Firebase/Firestore + Google Sheets + base local): **descartado** por el cambio de rumbo.
- `[APORTADO POR JUAN]` **No hay contrato ni alcance por escrito. Solo acuerdos verbales hasta ahora.** El alcance disponible es el técnico del producto, no un compromiso comercial documentado.

### Estado real actual `[CONFIRMADO]`
- El proyecto venía detenido y se reactivó con un **cambio de rumbo definido por Juan el 2026-07-22**.
- Existe un **paquete de cálculo headless reutilizable** con **554 pruebas automatizadas** (al 2026-08-04).
- Se verificó **una vez en vivo** el circuito documental completo (emitir PDF desde el escritorio, subir, aprobar/firmar en la web).
- **Ramas apiladas sin fusionar**, esperando tu revisión y prueba manual. **No hay versión estable desplegada** a usuarios finales.

### Componentes terminados `[CONFIRMADO]`
- Cálculo de volúmenes (cubicación de poza) y **comparación superficie contra superficie** (avance de excavación).
- **Circuito documental:** emisión de PDF con motor propio, aprobación y firma desde la web (firma electrónica simple, con firma biométrica lista para activar por flag).
- Motores adicionales: comparación con plano, tabla de elevación, desviación/asentamiento por puntos, desviación 3D (nube/malla).
- Mapa GIS con capa satelital y soporte de ortofoto.

### Componentes parcialmente desarrollados `[CONFIRMADO]`
- **Editor de planos tipo Fusion** (elevar/desplazar/inclinar): núcleo hecho, falta la interfaz con manijas por eje en el canvas (hoy edición numérica).
- **Desviación 3D multidireccional:** núcleo y parte de interfaz listos, faltan definiciones de formatos.
- **Empaquetado (.exe):** requiere reconstrucción y confirmar que todas las secciones cargan.

### Componentes no iniciados `[CONFIRMADO]`
- **Constructor de superficies multiformato** (LAS/LAZ, DXF, estación total). Hoy solo entra CSV/Excel.
- **Creador de plantillas de protocolos** y **ventana de Productos**.
- **Modo de coberturas 2D** (una familia de protocolos que no encaja en el modelo A contra B).

### Cambios de alcance incorporados `[DECISIÓN DE JUAN]`
- De **cubicador de pozas** a **workspace geoespacial general** ("comparar A contra B, acotado por polígonos, y emitir un producto con plantilla").
- **Unificación con GMT Link:** misma base de datos, mismo backend, misma identidad de usuario, mismo lenguaje visual.
- Nuevos operandos (nube de puntos, malla) y nuevas operaciones (elevación, desviación 3D, planos editables).
- Absorción de herramientas de terreno maduras (análisis volumétrico, mapa de asentamiento, medición de prismas).
- Análisis de **11 protocolos reales** (Albemarle y Capstone/Mantos Blancos) para definir el formato de los entregables.

### Principales causas del atraso `[CONFIRMADO/RECOMENDACIÓN]`
- Cambio de naturaleza del proyecto a mitad de camino.
- Integración con GMT Link (reescribir datos e identidad).
- Alcance amplio y aún abierto (6 fases), sin límite de MVP fijado.
- **Validación dependiente de Juan:** varias fases están cerradas con QA automático pero esperan prueba manual con datos reales de terreno; ese es el cuello de botella.
- `[APORTADO POR JUAN]` No hay cronograma con fechas comprometidas (acuerdos verbales), por lo que el "atraso" no es medible contra un plazo formal.

### Dependencias externas/técnicas/operacionales `[CONFIRMADO/PENDIENTE]`
- Datos de terreno reales (DEM, ortofotos, protocolos) para validar el cálculo.
- Dependencia de GMT Link (modelo de datos y API).
- **Escenario futuro:** si Albemarle compra el software, habría que diseñar arquitectura física en terreno. Hoy todo corre en la nube. `[APORTADO POR JUAN]`
- Riesgo técnico registrado: correctitud silenciosa en la comparación superficie contra superficie si no se alinean los orígenes de las mallas (mitigado con pruebas).

### MVP, segunda etapa y qué postergar `[RECOMENDACIÓN]`
- **Indispensable (MVP):** cubicación de poza + avance de excavación + circuito documental completo + importación CSV/Excel. Todo esto ya funciona.
- **Segunda etapa:** comparación con plano, tabla de elevación, desviación 3D con interfaz pulida, y creador de plantillas.
- **Postergar o eliminar:** editor de planos tipo Fusion con manijas en canvas (grande, valor incierto), importador multiformato avanzado (hasta que un cliente lo exija), coberturas 2D.

### Decisiones que necesitamos de Gerencia `[RECOMENDACIÓN]`
1. Aprobar el **nuevo alcance** (workspace) y el **límite del MVP**.
2. Definir el **marco comercial**: dado que hoy son acuerdos verbales, decidir si se formaliza con el cliente (Albemarle) y con qué plazo.
3. Definir la postura ante una **eventual compra por Albemarle** (implica arquitectura física).
4. Priorizar V-Metric frente a nuevos módulos de GMT Link.

### Propuesta de nuevo alcance `[RECOMENDACIÓN]`
- **Congelar el MVP** (dos operaciones que ya funcionan + circuito documental + Excel), **validarlo en terreno**, fusionar y desplegar una **versión estable**.
- El resto pasa a fases posteriores priorizadas por demanda real de cliente.

### Riesgos si seguimos sin redefinir `[RECOMENDACIÓN]`
- Esfuerzo en funciones que quizá no se usen (scope creep), sin un "terminado" claro.
- Ramas apiladas mucho tiempo sin fusionar (deuda técnica y divergencia).
- Sin marco formal ni cliente comprometido por escrito, es difícil justificar el tiempo invertido.

### Cierre
- **ESTADO:** Reactivado, con avance técnico real (motor y varias operaciones, circuito documental probado una vez en vivo), pero sin versión estable desplegada ni alcance formalizado. Solo acuerdos verbales.
- **RIESGO PRINCIPAL:** Seguir desarrollando funciones avanzadas sin MVP aprobado ni marco formal, con el cliente en acuerdos de palabra.
- **DECISIÓN QUE NECESITAMOS DE GERENCIA:** Aprobar el nuevo alcance y el límite del MVP, y decidir si se formaliza el marco comercial con Albemarle.
- **PROPUESTA:** Congelar MVP, validar en terreno, desplegar versión estable, y mover el resto a fases posteriores por demanda de cliente.

---

## 2. GMT LINK

### Propósito y descripción `[CONFIRMADO/RECOMENDACIÓN]`
Plataforma **interna de operaciones de GMT** donde conviven **colaboradores y clientes (ITO)** con acceso finamente segmentado.

> **Dos frases para Gerencia:** "GMT Link es la plataforma interna que centraliza las operaciones de GMT: finanzas, proyectos, tareas, documentos, personas y recursos, con permisos por rol y trazabilidad. Reemplaza planillas y flujos informales por un sistema único donde cada dato tiene dueño, estado y respaldo."

### Problema empresarial `[CONFIRMADO/RECOMENDACIÓN]`
Información dispersa en planillas y canales informales, sin trazabilidad ni control de acceso, con procesos que dependen de personas. GMT Link centraliza, da trazabilidad y controla quién ve y hace qué.

### Módulos/secciones `[CONFIRMADO]`
Existen como secciones reales: Inicio/Dashboard, Usuarios, Directorio, Finanzas, Operaciones, Proyectos, Recursos, Roles, V-Metric, Herramientas/GIS, Documentos, Notificaciones, Perfil/Hoja de vida, Configuración.

- **Operativos:** Finanzas (producción, 11 usuarios reales), Usuarios, Directorio, Roles, Proyectos, Operaciones, Recursos, Perfil, Configuración, Notificaciones.
- **En desarrollo/evolución:** V-Metric (integración escritorio con web), Proyectos (dashboard de producción reciente), Recursos (flota de vehículos y checklist).
- **Solo planteados:** Recursos Humanos (no construido) y etapas finales del plan.

### Funcionalidades en Proyectos `[CONFIRMADO]`
- Jerarquía Proyecto, Servicio, Fase, Actividad.
- Documentos de proyecto con flujo Borrador, QA, Cliente, y firma.
- Dashboard de producción (avance por servicio, curvas real contra proyectada, término estimado).
- Edición y borrado de fases y actividades.
- Reciente: documentos **desacoplados del servicio** (cuelgan del proyecto; borrar un servicio ya no borra ni bloquea documentos), desplegado 2026-08-24.

### Funcionalidades en Operaciones `[CONFIRMADO]`
- Backlog tipo Kanban de actividades (por defecto "mis tareas").
- Documentos operacionales con aprobación y firma.

### Recursos Humanos (nuevo) `[CONFIRMADO estado + APORTADO POR JUAN]`
- **No existe módulo RH.** Piezas latentes: roles de RH, hojas de vida, liquidaciones, horas extra, reembolsos, directorio, horarios.
- **Gap principal definido por Juan:** gestión de **acreditaciones en faena**, apoyo a **auditorías**, y **alertas de vencimiento de documentación/acreditaciones**.
- **Sinergia clave:** ese motor de alertas de vencimiento **ya existe** para la flota de vehículos (avisos automáticos 30/10/diario por app y correo). El módulo RH puede **reutilizar ese motor** aplicado a personas, no partir de cero. `[CONFIRMADO existencia del motor]`

### Otros frentes abiertos `[CONFIRMADO]`
- **Recursos / Flota de vehículos:** rol conductor, checklist de vehículos con SVG interactivo, ficha pública de activos, rol admin de flota con **avisos automáticos de vencimiento**, mini-GIS. Frente grande y activo.
- **Motor de tablas** interno (rendimiento de listados grandes).
- **Login y seguridad:** recuperación de clave, bloqueo por intentos, firma verificada (WebAuthn).
- Nota: el módulo de **Inventario/Insumos/Bodegas/Proveedores fue eliminado por completo** (2026-07-20); solo sobrevive el mini-GIS. Esto deja al área de **Compras sin soporte** en la plataforma.

### Integraciones `[CONFIRMADO/PENDIENTE]`
- **NVIDIA (OCR)** para lectura de documentos en Finanzas (en uso).
- **Cloudflare R2** (almacenamiento), **OpenFGA** (autorización).
- **V-Metric escritorio con la API** (ingesta de cálculos).
- Pendientes: correo saliente real (hoy la clave provisoria se muestra en pantalla); arquitectura física en terreno solo si Albemarle compra.

### Roles `[CONFIRMADO]`
Cerca de 20 roles: org_admin, operator, qa, finance, viewer, client_ito (cliente ITO), conductor, y roles de sistema (admin_contrato, admin_finanzas, analista_rh, analista_finanzas, asesor_hse, gerencia_proyectos, gerencia_rh, gerencia_general, admin_ti, trabajador), más roles personalizados. Mínimo privilegio: cada cliente solo ve lo suyo.

### Información que centraliza hoy `[CONFIRMADO]`
Finanzas (reembolsos, horas extra), personas (directorio, hojas de vida), proyectos y su avance, documentos con firma, activos/vehículos y sus vencimientos, tareas operacionales.

### Limitaciones y decisiones abiertas `[CONFIRMADO/PENDIENTE]`
- Se construyó por módulos técnicos, no por procesos levantados con las áreas.
- Sin envío de correo real todavía.
- Dependencia fuerte de una sola persona para construir y mantener.
- Abierto: alcance de RH, dónde viven los datos si Albemarle compra, y si GMT Link es solo interno o también producto para clientes.

### Riesgo de seguir agregando módulos sin levantar procesos `[RECOMENDACIÓN]`
Sí, es real y es el tema de fondo. Agregar módulos sobre procesos no levantados genera funciones que no calzan con el área, retrabajo y datos sin dueño. Recomendación: pausar la expansión por módulos y pasar a levantamiento por área.

### Avances recientes (a mostrar como "nuevo") `[CONFIRMADO]`
Desacople de documentos del proyecto, edición y borrado de fases y actividades, dashboard de producción, checklist de vehículos con SVG interactivo, item de checklist "documentos físicos", rol admin de flota con avisos de vencimiento, recuperación de clave y bloqueo por intentos, firma verificada. *(Estos son los avances que Juan compartió recientemente con Nicolás Vargas, su compañero de equipo y co-presentador.)*

### Cierre
- **ESTADO:** Plataforma en producción y en uso real (Finanzas con 11 usuarios), con múltiples módulos operativos; sigue creciendo por módulos.
- **AVANCES RECIENTES:** Desacople de documentos, dashboard de producción, edición de fases/actividades, flota de vehículos (checklist SVG y avisos de vencimiento), seguridad de login y firma.
- **FRENTES ABIERTOS:** Proyectos, Operaciones, Recursos/Flota, V-Metric, y RH (nuevo, no construido, enfocado en acreditaciones).
- **RIESGO PRINCIPAL:** Crecer en módulos más rápido de lo que se levantan procesos, responsables y estándares.
- **DECISIÓN QUE NECESITAMOS DE GERENCIA:** Validar formalmente GMT Link como plataforma oficial y autorizar el cambio de enfoque hacia levantamiento de procesos por área antes de seguir sumando módulos.

---

## 3. ROADMAP Y LEVANTAMIENTO DE PROCESOS

`[RECOMENDACIÓN]` en toda la sección.

### Áreas de GMT que deben participar `[APORTADO POR JUAN]`
Principalmente: **Recursos Humanos, Finanzas, Operaciones, Obras Civiles, Compras.** *(La estructura formal no está del todo clara; confirmar con Gerencia.)*

### Qué procesos levantar por área (ejemplos) `[RECOMENDACIÓN]`
- **RH:** acreditaciones en faena, ficha del trabajador, documentación y vencimientos, apoyo a auditorías, asistencia/turnos.
- **Finanzas:** reembolsos, horas extra, liquidaciones, rendiciones (varios ya en la plataforma).
- **Operaciones:** planificación de faenas, ejecución de mediciones, generación de protocolos, reporte de avances.
- **Obras Civiles:** control de avance de obra, protocolos y entregables, calidad.
- **Compras:** requerimientos, órdenes de compra, proveedores (hoy sin soporte tras eliminar Inventario).

### Qué recopilar en las entrevistas `[RECOMENDACIÓN]`
Por proceso: quién lo ejecuta y quién es responsable, con qué herramienta lo hace hoy, qué datos entran y salen, dónde se guardan, con qué frecuencia, qué duele/se repite/se pierde, y qué indicadores necesitan y no tienen.

### Herramientas actuales a inventariar `[RECOMENDACIÓN]`
WhatsApp, correo, Excel/Google Sheets, formularios, sistemas contables externos, y GMT Link (lo ya digitalizado).

### Problemas ya conocidos `[CONFIRMADO parcial]`
- Datos operacionales en planillas heterogéneas (ejemplo real: un Excel de volúmenes con 47 hojas de estructuras distintas).
- Procesos dependientes de canales informales y de personas.
- Poca trazabilidad y duplicidad de información entre planillas.
- **Compras quedó sin soporte** al eliminar el módulo de Inventario/Proveedores.

### Clasificación de procesos (a confirmar en el levantamiento) `[RECOMENDACIÓN]`
- **Dependientes de WhatsApp/correo/Excel:** coordinación de terreno, envío de mediciones, rendiciones.
- **Automatizables:** consolidación de mediciones, alertas de vencimiento (ya iniciado en flota, extensible a RH), lectura de documentos (OCR, ya iniciado en Finanzas).
- **A integrar en GMT Link:** operaciones, proyectos, RH (acreditaciones), obras civiles, compras.
- **A mantener externo:** contabilidad/remuneraciones formales y software técnico especializado.

### Etapas propuestas `[RECOMENDACIÓN]`
0. **Preparación y gobierno:** designar contrapartes por área, definir método y cronograma.
1. **Levantamiento:** entrevistas y mapa de procesos/herramientas por área.
2. **Diagnóstico:** medir madurez, detectar dolores, duplicidades y riesgos.
3. **Priorización:** matriz impacto contra esfuerzo; qué se digitaliza, qué se integra, qué se deja externo.
4. **Diseño:** definir procesos "al día siguiente" y especificar antes de construir.
5. **Desarrollo e implementación:** construir en GMT Link por proceso priorizado.
6. **Seguimiento y mejora continua:** indicadores, revisión periódica, gobierno tecnológico.

---

## 4. MADUREZ TECNOLÓGICA Y COBIT

`[RECOMENDACIÓN]` en toda la sección.

### Metodología de madurez (escala 1 a 5)
Dimensiones a evaluar por área/proceso: digitalización, estandarización, automatización, integración entre sistemas, calidad y disponibilidad de datos, trazabilidad, seguridad y control de acceso, responsables definidos, dependencia de procesos manuales, capacidad de generar indicadores.

- **Nivel 1, Inicial:** manual/informal (WhatsApp, papel, Excel personal). Sin dueño ni trazabilidad.
- **Nivel 2, Repetible:** hay una forma de hacerlo, pero depende de la persona; poca estandarización.
- **Nivel 3, Definido:** proceso documentado y estandarizado; digitalizado parcialmente; responsable identificado.
- **Nivel 4, Gestionado:** digitalizado en un sistema, con datos confiables, control de acceso e indicadores básicos.
- **Nivel 5, Optimizado:** integrado con otros sistemas, automatizado, con trazabilidad total, indicadores en tiempo real y mejora continua.

**Presentación sugerida:** tabla área por dimensión con el número 1 a 5 y color (rojo/amarillo/verde). Da un mapa visual de dónde invertir.

### COBIT de forma gradual
- **Qué es (una frase para Gerencia):** "COBIT es un marco de buenas prácticas para gobernar la tecnología: asegura que TI esté alineada con los objetivos del negocio, con responsables, controles y gestión de riesgos claros."
- **Partes útiles ahora:** responsables por proceso, gestión de riesgos, gestión de la información, priorización de inversiones y seguimiento con indicadores.
- **Qué evitar presentar muy técnico:** numeración de objetivos, dominios formales, matrices exhaustivas. Usar el espíritu, no la jerga.
- **Beneficio concreto:** pasar de "hacemos software cuando surge" a "invertimos en tecnología con criterio, con dueños y con control".
- **Evitar que sea burocracia:** usarlo como checklist de sentido común (esto tiene dueño, tiene control, reduce un riesgo, genera un dato útil), aplicado a lo que ya existe, sin comités ni papeles que nadie lea.

---

## 5. WEB GMT / NEXBU

`[APORTADO POR JUAN]` salvo donde se indique. Presentación objetiva, sin afirmar incumplimientos.

- **Qué se contrató / alcance / entregables:** la nueva web de GMT, desarrollada por **Nexbu**, hoy **en etapa de desarrollo**.
- **Avance:** Nexbu **presentó su carta Gantt** y **va actualizando su avance**.
- **Postura de GMT:** esperar la **presentación formal de avance** de Nexbu para **revisar y devolver correcciones**.
- **Depende de GMT:** revisar los avances cuando los presenten, y definir contenidos/diseño que dependan de GMT.
- **Depende de Nexbu:** ejecutar y presentar su avance conforme a su carta Gantt.

> Nota de encuadre: **no incluir referencias a la última comunicación ni a plazos** en la presentación (decisión de Juan). Mantener el tono objetivo: hay carta Gantt y reportes de avance; nuestra postura es revisar el entregable formal y devolver correcciones.

- **Estructura sugerida para la lámina:**
  - HECHOS CONFIRMADOS: contrato en desarrollo, existe carta Gantt, hay reportes de avance.
  - PENDIENTES DE NEXBU: presentación formal del avance.
  - PENDIENTES DE GMT: revisar y devolver correcciones; definir contenidos/diseño de nuestro lado.
  - RIESGOS: dependencia de un tercero; posibles pendientes de contenido/diseño de nuestro lado que también incidan.

---

## 6. CLAUDE MAX (herramienta de IA) y COSTOS

### Uso actual `[CONFIRMADO]`
Claude se usa **intensivamente como motor de construcción** de GMT Link y V-Metric: escribir y revisar código, QA automatizado (cientos de pruebas), diagnóstico de errores, despliegue a producción, análisis de datos (ejemplo: normalizar el Excel de 47 hojas) y documentación. Buena parte del desarrollo real se apoya en esta herramienta.

### Argumento empresarial `[RECOMENDACIÓN + APORTADO POR JUAN]`
- Con una cuenta limitada se llega al **tope de uso** en jornadas intensas y el desarrollo **se detiene** hasta que el límite se restablece: tiempo muerto en pleno avance.
- **Claude Max** entrega un límite mucho mayor para uso profesional continuo: no frena el trabajo a media jornada.
- **Como licencia de software:** es defendible presentarlo como una **herramienta de trabajo profesional**, equivalente a una licencia de desarrollo (IDE, CAD, ERP). Costo habilitante, no gasto discrecional.

### Costos `[APORTADO POR JUAN]`
- **Claude Max: $299.990 mensuales.** Se justifica **solo durante sprints de desarrollo**.
- **Fuera de sprint:** se puede mantener el plan **Pro a $23.000 mensuales** para mantención, tickets de arreglos chicos y actividades paralelas.
- **Infraestructura:** entre **USD 5 y USD 15 mensuales** según uso. El costo recurrente de operar lo digital es bajo.
- **Estrategia de costo a presentar:** Max en sprints (cuando hay que construir rápido), Pro en mantención. El gasto se **modula según la etapa**, no es fijo alto.

### Riesgos de depender de una IA y buenas prácticas `[RECOMENDACIÓN]`
- **Continuidad (bus factor):** el conocimiento no debe vivir solo en la herramienta y en una persona; mitigar con documentación y buenas prácticas de repositorio.
- **Calidad:** la IA acelera pero requiere revisión humana; no reemplaza el criterio de ingeniería.
- **Confidencialidad:** no pegar credenciales ni datos sensibles de clientes; usar gestores de secretos (ya se hace con las claves de infraestructura); definir una política simple de uso de IA.

### Respuesta breve a "¿por qué pagar esta suscripción?"
> "Porque construimos nuestros sistemas con esta herramienta y con una cuenta limitada el trabajo se frena a media jornada al llegar al tope. Max es una licencia de trabajo profesional que elimina ese tiempo muerto y acorta los plazos. Además el gasto se modula: Max solo en sprints ($299.990) y Pro en mantención ($23.000). La infraestructura cuesta entre USD 5 y 15 al mes. El beneficio es más avance por día y menos días por entregable."

---

## 7. RIESGOS GENERALES (visión de conjunto)

- **Patrón central `[CONFIRMADO]`:** sí, **estamos creciendo en soluciones digitales más rápido de lo que definimos procesos, responsabilidades y estándares.**
- **Dependencias entre proyectos `[CONFIRMADO]`:** V-Metric depende de GMT Link (datos, backend, identidad, firma). La arquitectura física solo aparece si Albemarle compra.
- **Decisiones informales a formalizar `[CONFIRMADO/APORTADO POR JUAN]`:** alcance de V-Metric (hoy verbal), qué entra a RH, prioridad entre proyectos, y si GMT Link es producto vendible.
- **Alcance:** V-Metric (MVP sin fijar) y RH (por definir).
- **Responsables:** no hay contrapartes formales por área; el desarrollo recae en una persona.
- **Tecnológicos `[CONFIRMADO]`:** repositorios en la cuenta personal de GitHub de Juan (riesgo de propiedad intelectual y continuidad); ramas de V-Metric sin fusionar; sin correo saliente real; correctitud silenciosa en cálculos (mitigada, requiere validación en terreno).
- **Operacionales:** módulos que no calcen con el proceso real; datos sin dueño; Compras sin soporte tras eliminar Inventario.
- **De gestión:** falta de roadmap validado y de gobierno tecnológico (priorización, responsables, seguimiento).

---

## 8. DECISIONES A SOLICITAR A GERENCIA

`[RECOMENDACIÓN]`

1. **V-Metric:** aprobar nuevo alcance y límite de MVP; decidir si se formaliza por escrito el acuerdo con Albemarle.
2. **GMT Link:** validación formal como plataforma oficial de GMT.
3. **Levantamiento de procesos:** autorización para hacerlo por área, con cronograma.
4. **Contrapartes:** designar una contraparte por área (RH, Finanzas, Operaciones, Obras Civiles, Compras).
5. **Roadmap:** validar las etapas 0 a 6 y el enfoque "procesos antes que módulos".
6. **COBIT:** aprobar su uso como marco de referencia ligero.
7. **Web/Nexbu:** definir postura (revisar el avance formal y devolver correcciones) y quién es la contraparte de GMT.
8. **Claude Max:** aprobar la suscripción como herramienta de trabajo, con la estrategia Max en sprints y Pro en mantención.
9. **Priorización:** definir el orden entre V-Metric, nuevos módulos y levantamiento.
10. **Gobierno de datos y repos:** decidir mover los repositorios a una cuenta/organización de GMT y definir dónde viven los datos si Albemarle compra.

---

## 9. INFORMACIÓN QUE TODAVÍA FALTA CONFIRMAR

- **Formalización del acuerdo de V-Metric** (hoy verbal): si se pasa a escrito, con quién y con qué plazo.
- **Alcance detallado del módulo RH** (más allá del gap de acreditaciones).
- **Estructura formal de áreas y responsables de GMT** (hay una lista base, falta claridad).
- **Definición estratégica:** si GMT Link es solo interno o también producto para clientes (Albemarle).

---

## 10. TEMAS ADICIONALES RECOMENDADOS

1. **Gobierno y propiedad de repositorios/datos `[CONFIRMADO como hallazgo]`:** los repos están en una cuenta personal de GitHub. Recomendable migrarlos a una organización de GMT (continuidad y propiedad intelectual).
2. **Continuidad / bus factor `[RECOMENDACIÓN]`:** el desarrollo depende de una persona más IA. Plantear documentación, respaldo y soporte a futuro (Nicolás Vargas sumándose al equipo ayuda a mitigar esto).
3. **GMT Link como posible producto `[RECOMENDACIÓN]`:** la eventual compra por Albemarle abre la pregunta de si esto se ofrece como producto, lo que cambia prioridad e inversión.
4. **Seguridad y protección de datos `[RECOMENDACIÓN]`:** hay datos de personas (RH) y de clientes (ITO). Una línea sobre control de acceso, firma electrónica y resguardo de datos.
5. **Compras sin soporte `[CONFIRMADO]`:** tras eliminar Inventario, el área de Compras quedó fuera de la plataforma; considerar si se re-incorpora en el levantamiento.

---

## Tabla 1 — Resumen por tema

| Tema | Estado actual | Problema / riesgo | Próximo paso | Decisión de Gerencia necesaria |
|---|---|---|---|---|
| V-Metric | Motor y varias operaciones construidas y probadas; sin versión estable; acuerdo solo verbal | Scope creep; esfuerzo sin cierre; sin marco escrito | Congelar MVP, validar en terreno, fusionar y desplegar | Aprobar nuevo alcance y MVP; decidir si se formaliza con Albemarle |
| GMT Link | En producción; Finanzas con 11 usuarios reales | Crece por módulos, no por procesos levantados | Validarlo y pasar a levantamiento por área | Validación formal como plataforma oficial |
| RH (nuevo) | No existe módulo; gap = acreditaciones y alertas de vencimiento | Construir sin levantar el proceso | Reutilizar el motor de alertas de flota para personas | Autorizar levantamiento; designar contraparte de RH |
| Roadmap / procesos | Propuesta lista (etapas 0 a 6); áreas: RH, Finanzas, Operaciones, Obras Civiles, Compras | Desarrollo aislado sin priorización | Iniciar Etapa 0 (gobierno y contrapartes) | Autorizar levantamiento y validar roadmap |
| Madurez / COBIT | Metodología y escala 1 a 5 propuestas | Sin diagnóstico objetivo hoy | Medir madurez por área en el levantamiento | Aprobar COBIT como referencia ligera |
| Web / Nexbu | En desarrollo; hay carta Gantt y reportes de avance | Dependencia de tercero; pendientes de contenido de GMT | Esperar presentación formal y devolver correcciones | Respaldar postura; definir contraparte de GMT |
| Claude Max / costos | Uso intensivo; Max $299.990, Pro $23.000, infra USD 5 a 15 | Tope de uso frena el trabajo | Aprobar Max en sprints, Pro en mantención | Aprobar la suscripción como licencia de trabajo |
| Datos / repos | Repos en cuenta personal; todo en la nube hoy | Propiedad intelectual y continuidad | Migrar repos a organización de GMT | Decidir propiedad de repos y sede de datos futura |

## Tabla 2 — Datos aún por confirmar

| Dato faltante | Por qué es importante | Quién puede responderlo |
|---|---|---|
| Si se formaliza por escrito el acuerdo de V-Metric | Da marco, plazo y respaldo a la inversión | Juan / Gerencia / Albemarle |
| Alcance detallado del módulo RH | Para no construir sin proceso levantado | Jefatura de RH / Gerencia |
| Estructura formal de áreas y responsables | Base del levantamiento y de designar contrapartes | Gerencia |
| Si GMT Link se ofrece como producto | Cambia prioridad e inversión | Gerencia |
| Escenario de compra por Albemarle | Define si se diseña arquitectura física en terreno | Gerencia / Albemarle |

---

## Datos confirmados por Juan en la preparación (referencia rápida)

- V-Metric: acuerdos verbales, nada por escrito.
- Nexbu: en desarrollo, presentó carta Gantt, reporta avance. No mencionar última comunicación ni plazos.
- Nicolás Vargas: ingeniero informático, compañero de equipo de Juan, co-presentador.
- Claude Max: $299.990 mensuales (solo en sprints). Pro: $23.000 mensuales (mantención).
- Albemarle: hoy todo en la nube; arquitectura física en terreno solo si compran el software.
- RH: sin definir; gap principal = acreditaciones en faena, apoyo a auditorías, alertas de vencimiento.
- Áreas de GMT: RH, Finanzas, Operaciones, Obras Civiles, Compras (estructura no del todo clara).
- Infraestructura: USD 5 a 15 mensuales según uso.
