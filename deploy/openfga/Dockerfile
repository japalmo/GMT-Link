# OpenFGA para GMT Link (§7 del diseño de auth propia).
#
# La imagen oficial `openfga/openfga` es distroless (sin /bin/sh), por lo que no se
# puede encadenar `migrate && run` en su ENTRYPOINT. Copiamos el binario estático (Go)
# a una base Alpine con shell para correr la migración (idempotente) antes de arrancar.
#
# El datastore (engine + URI de Postgres) se inyecta por variables de entorno en Railway:
#   OPENFGA_DATASTORE_ENGINE=postgres
#   OPENFGA_DATASTORE_URI=postgres://...@postgres.railway.internal:5432/railway?sslmode=disable
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=openfga/openfga:latest /openfga /usr/local/bin/openfga
# HTTP (8080), gRPC (8081). Railway enruta el dominio público al puerto HTTP.
EXPOSE 8080 8081
# migrate es idempotente: corre en cada arranque (no-op si el esquema ya existe) y
# luego levanta el servidor. Así el esquema queda listo sin un paso manual aparte.
ENTRYPOINT ["/bin/sh", "-c", "openfga migrate && openfga run"]
