"""
GMT Link — Script de limpieza de datos de prueba
================================================
Conserva SOLO al usuario Juan Apalmo (admin).
Elimina: reimbursements, paymentBatches, dashboardRollups,
         todos los workers y users excepto Juan Apalmo.

Uso:
    1. Asegúrate de tener las credenciales de servicio:
       Descarga la clave de servicio desde Firebase Console →
       Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada
       Guárdala como scripts/serviceAccountKey.json

    2. Desde la raíz del proyecto:
       cd scripts
       pip install firebase-admin
       python cleanup_data.py

    3. Revisa el output — el script pregunta confirmación antes de borrar.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, auth

# ── Configuración ─────────────────────────────────────────────────────────────
PROJECT_ID = "gmt-hub-6d8f7"
KEEP_EMAIL = "juanapalmo@gmail.com"   # Cambia si el email es distinto
KEEP_DISPLAY_NAME_FRAGMENT = "apalmo"  # Fallback si el email no coincide

COLLECTIONS_TO_WIPE = [
    "reimbursements",
    "paymentBatches",
    "dashboardRollups",
    "meta",
]

SA_KEY_PATH = Path(__file__).parent / "serviceAccountKey.json"

# ── Init ──────────────────────────────────────────────────────────────────────
def init_app():
    if SA_KEY_PATH.exists():
        cred = credentials.Certificate(str(SA_KEY_PATH))
    else:
        print(f"⚠️  No se encontró {SA_KEY_PATH}")
        print("   Usando Application Default Credentials...")
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": PROJECT_ID})


def delete_collection(db, col_name: str, batch_size: int = 400):
    col_ref = db.collection(col_name)
    deleted = 0
    while True:
        docs = list(col_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        deleted += len(docs)
        print(f"   Eliminados {deleted} documentos de '{col_name}'...")
    print(f"   ✅ '{col_name}' limpiada ({deleted} docs)")
    return deleted


def find_juan(db) -> tuple[str | None, dict | None]:
    """Busca el doc de Juan Apalmo en la colección users."""
    users_ref = db.collection("users")

    # Intento 1: por email exacto
    results = list(users_ref.where("email", "==", KEEP_EMAIL).limit(1).stream())
    if results:
        doc = results[0]
        return doc.id, doc.to_dict()

    # Intento 2: por displayName que contenga el fragmento
    all_users = list(users_ref.stream())
    for doc in all_users:
        data = doc.to_dict() or {}
        name = (data.get("displayName") or data.get("email") or "").lower()
        if KEEP_DISPLAY_NAME_FRAGMENT in name:
            return doc.id, data

    return None, None


def main():
    init_app()
    db = firestore.client()

    print("\n🔍 Buscando usuario Juan Apalmo...")
    juan_uid, juan_data = find_juan(db)

    if not juan_uid:
        print("❌ No se encontró a Juan Apalmo en Firestore.")
        print(f"   Verifica el email en KEEP_EMAIL = '{KEEP_EMAIL}'")
        sys.exit(1)

    print(f"✅ Encontrado: {juan_data.get('displayName') or juan_data.get('email')} (UID: {juan_uid})")
    print(f"   Rol: {juan_data.get('rol', 'desconocido')}")

    print("\n⚠️  ATENCIÓN — Esta operación es IRREVERSIBLE.")
    print("   Se eliminarán:")
    for col in COLLECTIONS_TO_WIPE:
        print(f"   • Colección completa: {col}")
    print("   • Todos los workers excepto el de Juan Apalmo")
    print("   • Todos los users excepto Juan Apalmo")
    print()
    confirm = input("   Escribe 'CONFIRMAR' para continuar: ").strip()
    if confirm != "CONFIRMAR":
        print("Operación cancelada.")
        sys.exit(0)

    print("\n🗑️  Limpiando colecciones...")
    for col in COLLECTIONS_TO_WIPE:
        delete_collection(db, col)

    # Eliminar workers excepto el de Juan
    print("\n🗑️  Limpiando workers...")
    workers_ref = db.collection("workers")
    all_workers = list(workers_ref.stream())
    batch = db.batch()
    deleted_workers = 0
    for doc in all_workers:
        data = doc.to_dict() or {}
        uid = data.get("uid") or data.get("userId") or doc.id
        email = (data.get("email") or "").lower()
        name = (data.get("displayName") or data.get("fullName") or "").lower()
        if uid == juan_uid or KEEP_EMAIL in email or KEEP_DISPLAY_NAME_FRAGMENT in name:
            print(f"   ⏭  Conservando worker: {data.get('displayName') or doc.id}")
            continue
        batch.delete(doc.reference)
        deleted_workers += 1
    batch.commit()
    print(f"   ✅ {deleted_workers} workers eliminados")

    # Eliminar users excepto Juan
    print("\n🗑️  Limpiando users...")
    users_ref = db.collection("users")
    all_users = list(users_ref.stream())
    batch = db.batch()
    deleted_users = 0
    for doc in all_users:
        if doc.id == juan_uid:
            print(f"   ⏭  Conservando user: {juan_uid}")
            continue
        batch.delete(doc.reference)
        deleted_users += 1
    batch.commit()
    print(f"   ✅ {deleted_users} users eliminados")

    # Asegurar que Juan tiene rol admin
    print("\n🔧 Verificando rol de Juan Apalmo...")
    juan_ref = db.collection("users").document(juan_uid)
    juan_ref.update({"rol": "admin", "active": True})
    print("   ✅ Rol admin confirmado")

    print("\n✅ Limpieza completada.")
    print(f"   Solo queda: {juan_data.get('displayName') or KEEP_EMAIL} (admin)")


if __name__ == "__main__":
    main()
