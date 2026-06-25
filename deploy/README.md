# deploy/ — plantillas de entorno por nodo (multicloud)

En producción cada nodo vive en un servidor distinto. Esta carpeta agrupa
las **plantillas** de variables de entorno por nodo y por tenant. Son
ejemplos versionables (`.env.example`): **nunca** commitear `.env` reales.

- `auth/`     → auth-service (identidad/JWT)
- `backend/`  → backend-central (orquestador)
- `web/`      → frontend
- `tenants/<cliente>/` → un tenant-gateway + su PostgreSQL (BD soberana del cliente)

Tenants previstos: `gmt`, `albemarle`, `mantos-blancos`.
