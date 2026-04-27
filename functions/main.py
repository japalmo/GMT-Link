from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from typing import Any

from firebase_admin import firestore, initialize_app
from firebase_functions import firestore_fn, logger
from firebase_functions.core import Change
from firebase_functions.options import set_global_options
from google.cloud.firestore_v1 import DocumentSnapshot


set_global_options(max_instances=10)

initialize_app()
db = firestore.client()

MAIL_COLLECTION = "mail"


def _as_dict(snapshot: DocumentSnapshot | None) -> dict[str, Any]:
    if snapshot is None or not snapshot.exists:
        return {}
    data = snapshot.to_dict()
    return data if isinstance(data, dict) else {}


def _get_worker(worker_id: str | None) -> dict[str, Any]:
    if not worker_id:
        return {}
    return _as_dict(db.collection("workers").document(worker_id).get())


def _get_user(user_id: str | None) -> dict[str, Any]:
    if not user_id:
        return {}
    return _as_dict(db.collection("users").document(user_id).get())


def _normalize_recipients(*emails: str | None) -> list[str]:
    result: list[str] = []
    for email in emails:
        candidate = (email or "").strip()
        if candidate and candidate not in result:
            result.append(candidate)
    return result


def _worker_email(worker: dict[str, Any]) -> str | None:
    return worker.get("email") or worker.get("personalEmail")


def _supervisor_email(worker: dict[str, Any]) -> str | None:
    supervisor = _get_user(worker.get("supervisorId"))
    return supervisor.get("email")


def _format_currency(amount: Any) -> str:
    try:
        value = int(round(float(amount or 0)))
    except (TypeError, ValueError):
        value = 0
    return f"$ {value:,}".replace(",", ".")


def _to_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if hasattr(value, "to_datetime"):
        try:
            return value.to_datetime()
        except TypeError:
            return value.to_datetime(timezone.utc)
    return None


def _format_datetime(value: Any) -> str:
    dt = _to_datetime(value)
    if dt is None:
        return "Sin fecha"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local_dt = dt.astimezone()
    return local_dt.strftime("%d/%m/%Y %H:%M")


def _build_html_email(title: str, intro: str, details: list[tuple[str, str]]) -> str:
    detail_rows = "".join(
        (
            f"<tr>"
            f"<td style='padding:8px 12px;border-bottom:1px solid #e5e7eb;"
            f"font-weight:600;color:#0f172a;width:180px'>{escape(label)}</td>"
            f"<td style='padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#334155'>"
            f"{escape(value)}</td>"
            f"</tr>"
        )
        for label, value in details
        if value
    )
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;"
        "padding:24px;color:#0f172a'>"
        "<p style='margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;"
        "text-transform:uppercase;color:#475569'>GMT Link</p>"
        f"<h1 style='margin:0 0 16px;font-size:24px;line-height:1.3'>{escape(title)}</h1>"
        f"<p style='margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155'>{escape(intro)}</p>"
        "<table style='width:100%;border-collapse:collapse;border:1px solid #e5e7eb;"
        "border-radius:8px;overflow:hidden'>"
        f"{detail_rows}"
        "</table>"
        "<p style='margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b'>"
        "Este es un mensaje automático de GMT Link. No respondas a este correo."
        "</p>"
        "</div>"
    )


def _build_text_email(title: str, intro: str, details: list[tuple[str, str]]) -> str:
    lines = [title, "", intro, ""]
    lines.extend(f"{label}: {value}" for label, value in details if value)
    lines.extend(
        [
            "",
            "Este es un mensaje automático de GMT Link. No respondas a este correo.",
        ]
    )
    return "\n".join(lines)


def _queue_mail(
    recipients: list[str],
    subject: str,
    intro: str,
    details: list[tuple[str, str]],
) -> None:
    recipients = _normalize_recipients(*recipients)
    if not recipients:
        logger.warn("No recipients found for email", {"subject": subject})
        return

    payload = {
        "to": recipients,
        "message": {
            "subject": subject,
            "text": _build_text_email(subject, intro, details),
            "html": _build_html_email(subject, intro, details),
        },
    }

    try:
        db.collection(MAIL_COLLECTION).add(payload)
        logger.info("Queued email document", {"subject": subject, "to": recipients})
    except Exception as exc:  # pragma: no cover - best-effort path
        logger.error("Failed to queue email document", {"subject": subject, "error": str(exc)})


def _handle_reimbursement_created(data: dict[str, Any]) -> None:
    if data.get("status") != "pending_approval":
        return

    worker = _get_worker(data.get("workerId"))
    supervisor_email = _supervisor_email(worker)
    if not supervisor_email:
        return

    worker_name = data.get("workerName") or worker.get("fullName") or "Trabajador"
    details = [
        ("Trabajador", worker_name),
        ("Concepto", data.get("concept") or "Sin descripción"),
        ("Monto", _format_currency(data.get("amount"))),
        ("Centro de costo", data.get("centerCost") or ""),
        ("Fecha del gasto", _format_datetime(data.get("expenseDate"))),
        ("Solicitud", data.get("requestNumber") or ""),
        ("Estado", "Pendiente de aprobación"),
    ]
    _queue_mail(
        [supervisor_email],
        f"Solicitud pendiente de aprobación · {worker_name}",
        "Se registró una nueva solicitud de reembolso que requiere tu revisión.",
        details,
    )


def _handle_reimbursement_approved(before: dict[str, Any], after: dict[str, Any]) -> None:
    previous_status = before.get("status")
    next_status = after.get("status")
    if previous_status == next_status or next_status != "approved":
        return

    worker = _get_worker(after.get("workerId"))
    worker_email = _worker_email(worker)
    if not worker_email:
        return

    worker_name = after.get("workerName") or worker.get("fullName") or "Trabajador"
    common_details = [
        ("Solicitud", after.get("requestNumber") or ""),
        ("Concepto", after.get("concept") or "Sin descripción"),
        ("Monto", _format_currency(after.get("amount"))),
        ("Fecha del gasto", _format_datetime(after.get("expenseDate"))),
    ]

    details = common_details + [
        ("Estado", "Aprobada"),
        ("Aprobada por", after.get("approvedByName") or ""),
        ("Comentario", after.get("approvalComment") or "Sin comentario"),
    ]
    _queue_mail(
        [worker_email],
        f"Solicitud aprobada · {after.get('requestNumber') or 'GMT Link'}",
        f"Hola {worker_name}, tu solicitud fue aprobada.",
        details,
    )


def _handle_reimbursement_rejected(before: dict[str, Any], after: dict[str, Any]) -> None:
    previous_status = before.get("status")
    next_status = after.get("status")
    if previous_status == next_status or next_status != "rejected":
        return

    worker = _get_worker(after.get("workerId"))
    worker_email = _worker_email(worker)
    if not worker_email:
        return

    worker_name = after.get("workerName") or worker.get("fullName") or "Trabajador"
    details = [
        ("Solicitud", after.get("requestNumber") or ""),
        ("Concepto", after.get("concept") or "Sin descripción"),
        ("Monto", _format_currency(after.get("amount"))),
        ("Fecha del gasto", _format_datetime(after.get("expenseDate"))),
        ("Estado", "Rechazada"),
        ("Rechazada por", after.get("rejectedByName") or ""),
        ("Motivo", after.get("rejectionReason") or "Sin motivo informado"),
    ]
    _queue_mail(
        [worker_email],
        f"Solicitud rechazada · {after.get('requestNumber') or 'GMT Link'}",
        f"Hola {worker_name}, tu solicitud fue rechazada.",
        details,
    )


def _handle_payment_batch_created(data: dict[str, Any]) -> None:
    worker = _get_worker(data.get("workerId"))
    worker_email = _worker_email(worker)
    if not worker_email:
        return

    worker_name = data.get("workerName") or worker.get("fullName") or "Trabajador"
    details = [
        ("Lote", data.get("batchNumber") or ""),
        ("Total pagado", _format_currency(data.get("totalAmount"))),
        ("Solicitudes incluidas", str(data.get("requestCount") or 0)),
        ("Referencia bancaria", data.get("paymentReference") or "Sin referencia"),
        ("Fecha de pago", _format_datetime(data.get("paidAt"))),
        ("Registrado por", data.get("paidByName") or ""),
    ]
    _queue_mail(
        [worker_email],
        f"Pago registrado · {data.get('batchNumber') or 'GMT Link'}",
        f"Hola {worker_name}, se registró el pago de tu lote de reembolsos.",
        details,
    )


@firestore_fn.on_document_created(document="reimbursements/{id}")
def reimbursement_created(event: firestore_fn.Event[DocumentSnapshot | None]) -> None:
    data = _as_dict(event.data)
    if not data:
        return
    _handle_reimbursement_created(data)


@firestore_fn.on_document_updated(document="reimbursements/{id}")
def reimbursement_approved(
    event: firestore_fn.Event[Change[DocumentSnapshot | None]],
) -> None:
    before = _as_dict(event.data.before)
    after = _as_dict(event.data.after)
    if not after:
        return
    _handle_reimbursement_approved(before, after)


@firestore_fn.on_document_updated(document="reimbursements/{id}")
def reimbursement_rejected(
    event: firestore_fn.Event[Change[DocumentSnapshot | None]],
) -> None:
    before = _as_dict(event.data.before)
    after = _as_dict(event.data.after)
    if not after:
        return
    _handle_reimbursement_rejected(before, after)


@firestore_fn.on_document_created(document="paymentBatches/{id}")
def payment_batch_created(event: firestore_fn.Event[DocumentSnapshot | None]) -> None:
    data = _as_dict(event.data)
    if not data:
        return
    _handle_payment_batch_created(data)
