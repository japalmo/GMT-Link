# Runbook: Railway staging aislado

## Regla de seguridad

Staging no puede compartir base de datos, store OpenFGA, bucket R2, credenciales
de correo ni usuarios reales con producción. El servicio histórico `web-dev` no
cumple esta condición porque consume la API productiva.

No se debe duplicar `production` con todos sus secretos. Se crea un environment
vacío y se provisionan valores de prueba deliberadamente.

## Topología mínima

En el proyecto Railway `tranquil-essence`, environment `staging`:

- `Postgres`: volumen independiente.
- `openfga`: datastore conectado al PostgreSQL de staging.
- `api`: `nodes/backend-central/Dockerfile`.
- `web`: `nodes/web/Dockerfile` y `VITE_API_URL` de la API staging.

Redis solo se agrega cuando la aplicación lo consuma. R2 debe usar un bucket
separado o permanecer deshabilitado. Correo debe quedar Noop/sandbox.

## Variables mínimas

API:

- `DATABASE_URL`: referencia al PostgreSQL de staging.
- `AUTH_JWT_SECRET`: valor exclusivo de staging.
- `FGA_API_URL`, `FGA_STORE_ID`, `FGA_MODEL_ID`: exclusivos de staging.
- `CORS_ORIGINS`: dominio de la web staging.
- `APP_WEB_URL`: dominio de la web staging.
- `NODE_ENV=production`: conserva el comportamiento técnico del build.
- `SEED_MOCKUPS=on`: solo para datos ficticios y bajo decisión explícita.

Web:

- `VITE_API_URL`: dominio público de la API staging.

Dejar vacíos `BREVO_API_KEY`, `SMTP_*`, `R2_*`, Google Sheets y proveedores de IA
hasta disponer de cuentas/buckets sandbox. Nunca copiar valores desde capturas,
chats o archivos `.env` productivos.

## Conexión con GitHub

1. Crear en GitHub el Environment `staging`.
2. Crear un token Railway restringido a staging y guardarlo como
   `RAILWAY_STAGING_TOKEN`.
3. Configurar `STAGING_API_URL` y `STAGING_WEB_URL` como variables del Environment.
4. Ejecutar **Actions → Deploy staging → Run workflow**, normalmente con
   `ref=develop` y `service=all`.
5. Confirmar que el workflow muestra el SHA, build verde y smoke tests verdes.

El workflow contiene un guard que consulta Railway y rechaza cualquier destino
que no se llame exactamente `staging`. No existe un workflow equivalente para
producción.

## Validación funcional

- Iniciar sesión solo con cuentas ficticias.
- Verificar permisos de al menos admin, supervisor y trabajador.
- Crear/editar/eliminar datos de prueba.
- Subir únicamente archivos ficticios.
- Confirmar que correos y automatizaciones externas no salen a destinatarios
  reales.
- Adjuntar el resultado y el SHA al Pull Request de release.

## Rollback

1. Identificar el último SHA staging saludable en Railway/GitHub Actions.
2. Ejecutar nuevamente `Deploy staging` con ese SHA.
3. Si hubo migración, aplicar el plan específico documentado en el PR; no usar
   `prisma migrate reset` sobre un ambiente compartido.
4. Registrar causa y evidencia en un issue.
