# Requerimiento al área técnica — Cierre Perimetral Mantos Blancos

**Proyecto:** CP-A-1 · Cierre Perimetral · Faena Mantos Blancos · Capstone Copper
**Contrato:** CW2224748
**Origen:** carga del avance de obra en GMT Link (dashboard de faena y enlace al cliente)
**Fecha:** 10-09-2026

## Por qué se levanta

Para medir avance físico por cerco hubo que cruzar tres fuentes y no cuadran entre sí.
El dashboard ya quedó cargado con el criterio que se indica en cada punto, pero los
puntos 1 y 2 cambian cubicación y conviene que queden confirmados por escrito.

---

## 1. La carta Gantt cubica menos de la mitad de los dados que exigen los planos

Los planos REV-B dan 6, 7 y 9 dados por cerco según el tipo. La carta Gantt asume 3.

| Partida                         | Carta Gantt | Planos REV-B | Diferencia |
| ------------------------------- | ----------: | -----------: | ---------: |
| Excavación dados cercos Tipo A  |          33 |  66 (11 × 6) |        +33 |
| Excavación dados cercos Tipo B  |         135 | 315 (45 × 7) |       +180 |
| Excavación dados cercos Tipo C  |          21 |   63 (7 × 9) |        +42 |
| **Total a excavar y montar**    |     **189** |      **444** |   **+255** |
| Suministro de dados de hormigón |         378 |          444 |        +66 |

**Criterio aplicado:** mandan los planos. El dashboard mide contra 444 dados.

**Se solicita confirmar:**

- ¿Se ratifica la cubicación de 444 dados como la oficial del contrato?
- La carta Gantt vigente quedó corta en excavación y montaje de dados. ¿Se reprograma
  el plazo, se refuerza cuadrilla, o la diferencia ya estaba considerada en otra partida?
- El suministro de dados prefabricados quedó en 444. ¿Se emite orden de compra
  complementaria por los 66 adicionales?

## 2. Faltan las ubicaciones de 8 cercos

La lista de poyos entregada trae 55 cercos con código Mantos y coordenadas. Los planos
exigen 63. Los 8 que faltan son, por diferencia de tipo, **7 del tipo B y 1 del tipo C**.

| Tipo      | En la lista de poyos | En los planos | Faltan |
| --------- | -------------------: | ------------: | -----: |
| A         |                   11 |            11 |      0 |
| B         |                   38 |            45 |      7 |
| C         |                    6 |             7 |      1 |
| **Total** |               **55** |        **63** |  **8** |

**Criterio aplicado:** los 8 están cargados como `B-XXXIX` a `B-XLV` y `C-VII`, agrupados
en el dashboard bajo el sector «Por definir».

**Se solicita:** la lista definitiva de los 63 cercos con código GMT, código Mantos, tipo
y coordenadas Norte/Este, para asignarlos a su sector y poder secuenciar la obra por zona.

## 3. El plano de puerta indica 66 unidades y los cercos son 63

`GMT-PL-CP-PT-01` (plano típico de puerta) dice «66 UNIDADES». Cada cerco lleva una
puerta, y son 63 cercos. La carta Gantt también cubica 63 puertas.

**Se solicita confirmar** si las 3 puertas de diferencia son repuestos, corresponden a
accesos adicionales, o es un error de rotulación del plano.

## 4. Dos errores de rotulación en los planos REV-B

Ninguno afecta la obra, pero conviene corregirlos en la próxima revisión:

- `GMT-PL-CP-TIP-A-01` rotula su vista isométrica como **«CIERRE PERIMETRAL TIPO B»**,
  siendo el plano del tipo A.
- La lámina 1/5 del tipo C lleva el número de plano **`GMT-PL-CP-TIP-C-05`** en vez
  de `-C-01`. El `-C-05` queda así duplicado con la lámina 5/5.

## 5. Confirmar a qué cercos corresponde el replanteo ya ejecutado

El avance registrado traía 14 de 63 puntos de replanteo topográfico, sin decir de qué
cercos. Al pasar el replanteo a etapa por cerco hubo que repartirlos.

**Criterio aplicado:** se asignaron a los 14 primeros cercos en orden de programa, con
nota «el cerco exacto lo confirma terreno».

**Se solicita** el listado de los cercos efectivamente replanteados. La corrección es
directa en la plataforma: cada cerco tiene su propia etapa de replanteo.

---

## Cómo quedó cargada la obra

63 cercos, cada uno con 7 etapas de montaje tomadas de la lista de materiales de su
plano. Las cantidades cambian según el tipo:

| Etapa                           | Unidad | Tipo A | Tipo B | Tipo C | Total obra |
| ------------------------------- | ------ | -----: | -----: | -----: | ---------: |
| Replanteo topográfico           | pto    |      1 |      1 |      1 |         63 |
| Excavación de dados             | un     |      6 |      7 |      9 |        444 |
| Colocación de dados de hormigón | un     |      6 |      7 |      9 |        444 |
| Montaje de pilares galvanizados | un     |      6 |      7 |      9 |        444 |
| Montaje de mallas ACMAFOR       | paño   |      5 |      6 |      8 |        381 |
| Montaje de puerta               | un     |      1 |      1 |      1 |         63 |
| Remachado y fijaciones          | un     |     40 |     44 |     36 |      2.672 |

El replanteo se mantiene en 1 punto por cerco porque así lo cubica la carta Gantt
(«Replanteo topográfico general, 63 puntos»); los planos no cubican replanteo.

Los cercos se reparten en el tiempo dentro de la ventana de su partida en la Gantt, uno
detrás de otro, que es como avanza la cuadrilla en terreno. Por eso la curva del programa
tiene forma de S en vez de subir de golpe.

**Fuentes usadas:** planos REV-B del 09-07-2026 (`GMT-PL-CP-TIP-A/B/C-01`, aprobados por
Felipe Díaz, creados por Fredy Martí) para cantidades; `Lista_poyos_expandida_GMT` para
ubicaciones; `GMT-MB-OOCC-CG-CP-01` (carta Gantt) para fechas, holguras y el resto de las
partidas.
