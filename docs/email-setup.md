# GMT Link - Configuracion de Emails Automaticos

Este proyecto usa la extension oficial de Firebase `firestore-send-email` para enviar correos a partir de documentos escritos en la coleccion `mail`.

## Arquitectura elegida

- Proveedor SMTP: Resend
- Extension Firebase: Trigger Email from Firestore
- Runtime de integracion: Cloud Functions Python
- Coleccion que dispara envios: `mail`

## Que hace cada parte

- `functions/main.py`
  - Escucha cambios en `reimbursements` y `paymentBatches`
  - Escribe documentos en `mail/`
- Firebase Extension `firestore-send-email`
  - Detecta nuevos docs en `mail/`
  - Envia los correos usando Resend SMTP

## Configuracion en Firebase Console

1. Abrir Firebase Console.
2. Ir a `Extensions`.
3. Instalar la extension `Trigger Email from Firestore`.
4. Configurar estos parametros:

- SMTP connection URI:

```text
smtps://resend:[API_KEY]@smtp.resend.com:465
```

- Mail collection:

```text
mail
```

- Default FROM address:

```text
GMT Link <no-reply@tu-dominio-verificado-en-resend>
```

- Default REPLY-TO address:

```text
no-reply@tu-dominio-verificado-en-resend
```

## Requisito previo en Resend

Antes de usar SMTP con Resend, Juan debe:

1. Crear la API key en Resend.
2. Verificar el dominio remitente en Resend.
3. Usar esa API key como password en `SMTP_CONNECTION_URI`.

## Esquema esperado de los documentos en `mail`

Las Cloud Functions escriben documentos con esta forma:

```json
{
  "to": ["destinatario@example.com"],
  "message": {
    "subject": "Asunto del correo",
    "text": "Version texto plano",
    "html": "<div>Version HTML inline</div>"
  }
}
```

## Triggers implementados

- `reimbursements/{id}` `onCreate`
  - Si el documento nace con `status = pending_approval`
  - Envia email al supervisor

- `reimbursements/{id}` `onUpdate`
  - Si `status` cambia a `approved`
  - Envia email al trabajador

- `reimbursements/{id}` `onUpdate`
  - Si `status` cambia a `rejected`
  - Envia email al trabajador con `rejectionReason`

- `paymentBatches/{id}` `onCreate`
  - Envia email al trabajador con resumen de pago

## Comportamiento ante fallos

- Si falta destinatario, la Function no rompe el flujo.
- Si falla la escritura en `mail/`, la Function registra el error y sigue.
- El envio de email es best-effort: nunca bloquea aprobacion, rechazo ni pago.

## Despliegue

Cuando la configuracion SMTP ya este cargada:

```bash
firebase deploy --only functions
```

Si tambien se instala la extension en el mismo paso, hacerlo desde Console o con CLI por separado.

## Fuera de scope de este prompt

- Adjuntar PDFs en emails
- Templates Handlebars
- Retries manuales sobre `mail.delivery`
- Envio de emails desde cliente
