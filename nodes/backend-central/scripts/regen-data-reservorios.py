"""
regen-data-reservorios.py
─────────────────────────
Regenera nodes/backend-central/prisma/data-reservorios.json para R1..R10 con la SERIE COMPLETA
limpia (sin submuestreo), reusando el parser validado normalize_reservorios_v2.py.

- Preserva code/name/polygon/metadata existentes (polígonos de KML); reemplaza measurements.
- Incluye cota_sal (la BD lo modela aunque el xlsx entregable use 12 columnas).
- Forward-fill de cota_espejo y cota_sal por fecha; dedup por fecha (fila más completa).
"""
import json
import sys
import datetime as dt
from pathlib import Path

sys.path.insert(0, r"C:\Users\juana\V-metric")
import normalize_reservorios_v2 as N  # noqa: E402

JSON_PATH = Path(r"C:\Users\juana\GMT Link\nodes\backend-central\prisma\data-reservorios.json")
R_CODES = [f"R{i}" for i in range(1, 11)]

# Reverse: elemento -> hojas
EL_TO_SHEETS = {}
for sh, el in N.SHEET_TO_ELEMENT.items():
    EL_TO_SHEETS.setdefault(el, []).append(sh)


def extract_element(wb, code):
    rows = []
    for sheet in EL_TO_SHEETS[code]:
        ws = wb[sheet]
        headers = N.merged_headers(ws)
        cm = N.build_colmap(headers)
        cm["cotasal"] = _cota_sal_idx(headers)
        for raw in ws.iter_rows(min_row=3, values_only=True):
            vals = list(raw)
            date = N.parse_date(N.cell(vals, cm["fecha"]))
            if date is None:
                continue

            def num(key):
                return N.clean_num(N.cell(vals, cm[key]))

            cota = num("cota")
            if cota is not None and not (2000 < cota < 2400):
                cota = None
            cota_sal = num("cotasal")
            if cota_sal is not None and not (2000 < cota_sal < 2400):
                cota_sal = None

            borde = num("borde")
            salm = num("salm")
            sal = num("sal")
            area = num("area")
            perim = num("perim")
            vollib = num("vollib")
            volsal = num("volsal")
            volocl = num("volocl")
            borde = borde / 100.0 if borde is not None else None
            salm = salm / 100.0 if salm is not None else None
            sal = sal / 100.0 if sal is not None else None
            if volocl is None and volsal is not None:
                volocl = volsal * 0.20
            voltot = (vollib + (volocl or 0.0)) if vollib is not None else None

            fields = {
                "borde_libre": borde, "altura_salmuera": salm, "altura_sal": sal,
                "cota_espejo": cota, "cota_sal": cota_sal, "area_espejo": area,
                "perimetro": perim, "vol_salmuera_libre": vollib, "vol_sal": volsal,
                "vol_salmuera_ocluida": volocl, "vol_total_salmuera": voltot,
            }
            if all(v is None for v in fields.values()):
                continue
            rows.append((date, fields))

    # dedup por fecha: conservar la fila con más campos no nulos
    best = {}
    for date, f in rows:
        score = sum(1 for v in f.values() if v is not None)
        if date not in best or score > best[date][0]:
            best[date] = (score, f)
    series = sorted(((d, f) for d, (s, f) in best.items()), key=lambda x: x[0])

    # forward-fill cotas
    last = {"cota_espejo": None, "cota_sal": None}
    out = []
    for date, f in series:
        for ck in ("cota_espejo", "cota_sal"):
            if f[ck] is not None:
                last[ck] = f[ck]
            elif last[ck] is not None:
                f[ck] = last[ck]
        rec = {"date": date.strftime("%Y-%m-%d"),
               "timestamp": dt.datetime(date.year, date.month, date.day).timestamp()}
        for k, v in f.items():
            rec[k] = round(v, 4) if isinstance(v, float) else v
        out.append(rec)
    return out


def _cota_sal_idx(headers):
    for idx, name in headers:
        if name and "cota sal" in name:
            return idx
    return None


def main():
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    wb = N.openpyxl.load_workbook(str(N.SRC), data_only=True, read_only=True)
    for code in R_CODES:
        series = extract_element(wb, code)
        data[code]["measurements"] = series
        print(f"{code}: {len(series)} mediciones (serie completa)")
    JSON_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(len(data[c]["measurements"]) for c in R_CODES)
    print(f"\nTotal mediciones R1-R10: {total}")
    print(f"Escrito: {JSON_PATH}")


if __name__ == "__main__":
    main()
