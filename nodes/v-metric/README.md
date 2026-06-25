# nodes/v-metric — placeholder (submódulo pendiente)

El desktop **V-metric** (Python + PySide6) vivirá aquí como **git submodule**
de `japalmo/V-metric`. Todavía no se añadió como submódulo porque el repo
remoto no tiene contenido utilizable.

## Estado real (verificado el 2026-06-25)

- `git ls-remote https://github.com/japalmo/V-metric.git` devuelve **0 refs**:
  el repo existe pero está **vacío** (nunca se hizo push de ninguna rama).
- El contenido real de V-metric vive en el **clon local** `C:\Users\juana\V-metric`
  (rama `feature/ortho-map`), con commits aún **sin pushear** (el push estaba
  bloqueado por un *ruleset* de protección del repo).

Añadir el submódulo apuntando a un repo vacío produciría un checkout vacío, así
que se difiere hasta que `japalmo/V-metric` tenga contenido.

## Reactivación (cuando el repo remoto tenga contenido)

1. Desbloquear/ajustar el *ruleset* de `japalmo/V-metric` y **pushear** la rama
   de trabajo desde el clon local:
   ```bash
   git -C "C:/Users/juana/V-metric" push origin feature/ortho-map
   ```
2. Reemplazar este placeholder por el submódulo real (desde la raíz del monorepo):
   ```bash
   git rm -r nodes/v-metric
   git submodule add https://github.com/japalmo/V-metric.git nodes/v-metric
   git submodule update --init nodes/v-metric
   ```

El submódulo queda **excluido** del workspace pnpm (`!nodes/v-metric` en
`pnpm-workspace.yaml`) porque V-metric es Python, no un paquete JS.

> Nota aparte (no es de esta fase): el commit local `523a745` de V-metric repintó
> su paleta al azul de GMT Link. Según la decisión vigente, la identidad gráfica
> se hereda **desde** V-metric; ese commit debe revertirse en el trabajo de V-metric,
> no aquí.
