import requests
import h5py
import numpy as np
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pyproj import CRS, Transformer
from pathlib import Path

# ---------------------------------------------------------------------------
# CONFIGURACIÓ
# ---------------------------------------------------------------------------

API_KEY = os.environ.get("METEOFRANCE_API_KEY")

BASE_URL_CIRRUS = "https://partner-api.meteofrance.fr/partner/radar/opera/1.0/realtime/cirrus/composite/REFLECTIVITY/{date}?format=HDF5"

OUTPUT_DIR = Path("public/radar")

REGIO = {"lat_min": 38.5, "lat_max": 45.0, "lon_min": -2.0, "lon_max": 5.0}

INTERVAL_MIN = 5  # Cirrus publica cada 5 min
TOTAL_FRAMES = 5  # Instant actual + 4 anteriors

REINTENTOS = 3
ESPERA_ENTRE_REINTENTOS_SEG = 5

# Patró del nom de fitxer d'un frame:
# radar_frame_DD_MM_YYYY_HHMMz.js
FRAME_FILENAME_RE = re.compile(
    r"^radar_frame_(\d{2})_(\d{2})_(\d{4})_(\d{2})(\d{2})Z\.js$"
)

FALLBACK_RESOLUTION_M = 2000.0

# ---------------------------------------------------------------------------
# FUNCIONS
# ---------------------------------------------------------------------------

def round_down_interval(dt, interval_min):
    minute = (dt.minute // interval_min) * interval_min
    return dt.replace(minute=minute, second=0, microsecond=0)


def format_mida(b):
    if b < 1024:
        return f"{b} B"
    elif b < 1024 * 1024:
        return f"{b/1024:.1f} KB"
    else:
        return f"{b/(1024*1024):.2f} MB"


def frame_filename(dt_utc):
    """Nom de fitxer per un frame, a partir del seu timestamp UTC real."""
    return f"radar_frame_{dt_utc.strftime('%d_%m_%Y_%H%M')}Z.js"


def parse_frame_filename(nom_fitxer):
    """
    Extreu datetime UTC codificat al nom del fitxer, o None si no
    segueix el patró esperat.
    """
    m = FRAME_FILENAME_RE.match(nom_fitxer)
    if not m:
        return None
    dia, mes, any_, hora, minut = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    try:
        return datetime(int(any_), int(mes), int(dia), int(hora), int(minut), tzinfo=timezone.utc)
    except ValueError:
        return None


def esborrar_tota_la_carpeta(carpeta):
    """Esborra TOTS els fitxers de la carpeta i la recrea buida."""
    if carpeta.exists():
        for f in carpeta.glob("*"):
            if f.is_file():
                f.unlink()
        print(f"    Carpeta netejada: {carpeta}")
    carpeta.mkdir(parents=True, exist_ok=True)


def descarregar_amb_reintents(url, headers):
    """Fa la petició HTTP amb reintents."""
    for intent in range(1, REINTENTOS + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code == 200 and resp.content:
                return resp.content, resp.status_code
            if intent < REINTENTOS:
                print(f"      HTTP {resp.status_code}, reintent {intent}/{REINTENTOS}...")
        except Exception as e:
            print(f"      intent {intent}: error {e}")
        if intent < REINTENTOS:
            time.sleep(ESPERA_ENTRE_REINTENTOS_SEG)
    return None, resp.status_code if 'resp' in locals() else None


def obtenir_ultims_frames(base_url, api_key, interval_min, total_frames):
    """
    Demana els últims TOTAL_FRAMES instants (actual arrodonit cap avall
    + els anteriors). Retorna llista de (dt, content) per als que s'han
    pogut descarregar.
    """
    now = datetime.now(timezone.utc)
    latest = round_down_interval(now, interval_min)
    
    frames_descarregats = []
    
    for i in range(total_frames):
        candidate = latest - timedelta(minutes=interval_min * i)
        ts = candidate.strftime("%Y-%m-%dT%H%M%SZ")
        url = base_url.format(date=ts)
        headers = {"accept": "application/x-hdf", "apikey": api_key}
        
        content, status = descarregar_amb_reintents(url, headers)
        if content is not None:
            print(f"    OK {ts} ({format_mida(len(content))})")
            frames_descarregats.append((candidate, content))
        else:
            print(f"    HTTP {status} {ts} (no disponible)")
    
    return frames_descarregats


def is_point_in_region(lat, lon, regio):
    return regio["lat_min"] <= lat <= regio["lat_max"] and regio["lon_min"] <= lon <= regio["lon_max"]


def process_frame(h5data, regio):
    """
    Processa el frame HDF5 a màxima resolució nativa: es recorre
    l'array complet punt a punt, sense cap submostreig.
    """
    with tempfile.NamedTemporaryFile(suffix='.hdf', delete=False) as tmp:
        tmp.write(h5data)
        tmp_path = tmp.name
    try:
        with h5py.File(tmp_path, "r") as f:
            where = f["where"].attrs
            what = f["what"].attrs
            data_grp = f["dataset1"]["data1"]
            raw = data_grp["data"][:]
            dw = data_grp["what"].attrs
            gain = float(dw.get("gain", 1.0))
            offset = float(dw.get("offset", 0.0))
            nodata = dw.get("nodata", None)
            undetect = dw.get("undetect", None)

            xscale = float(where.get("xscale", 0.0) or 0.0)
            yscale = float(where.get("yscale", xscale) or xscale)
            resolution_m = xscale if xscale > 0 else FALLBACK_RESOLUTION_M

            valor = raw.astype(float) * gain + offset
            if nodata is not None:
                valor = np.where(raw == nodata, np.nan, valor)
            if undetect is not None:
                valor = np.where(raw == undetect, np.nan, valor)
            projdef = where["projdef"]
            if isinstance(projdef, bytes):
                projdef = projdef.decode()
            proj_crs = CRS.from_proj4(projdef)
            ll_lon, ll_lat = float(where["LL_lon"]), float(where["LL_lat"])
            ur_lon, ur_lat = float(where["UR_lon"]), float(where["UR_lat"])
            fwd = Transformer.from_crs("EPSG:4326", proj_crs, always_xy=True)
            x0, y0 = fwd.transform(ll_lon, ll_lat)
            x1, y1 = fwd.transform(ur_lon, ur_lat)
            ny, nx = valor.shape
            xs = np.linspace(x0, x1, nx)
            ys = np.linspace(y1, y0, ny)
            xx, yy = np.meshgrid(xs, ys)
            inv = Transformer.from_crs(proj_crs, "EPSG:4326", always_xy=True)
            lons, lats = inv.transform(xx, yy)
            points = []
            min_lat, max_lat = 90, -90
            min_lon, max_lon = 180, -180
            for i in range(valor.shape[0]):
                for j in range(valor.shape[1]):
                    if not np.isnan(valor[i, j]):
                        lat, lon = float(lats[i, j]), float(lons[i, j])
                        if is_point_in_region(lat, lon, regio):
                            points.append({"lat": lat, "lon": lon, "dbz": float(valor[i, j])})
                            if lat < min_lat:
                                min_lat = lat
                            if lat > max_lat:
                                max_lat = lat
                            if lon < min_lon:
                                min_lon = lon
                            if lon > max_lon:
                                max_lon = lon
            if len(points) == 0:
                min_lat, max_lat = regio["lat_min"], regio["lat_max"]
                min_lon, max_lon = regio["lon_min"], regio["lon_max"]
            else:
                m = 0.1
                min_lat -= m
                max_lat += m
                min_lon -= m
                max_lon += m
            date_str = what.get("date", b"")
            time_str = what.get("time", b"")
            if isinstance(date_str, bytes):
                date_str = date_str.decode()
            if isinstance(time_str, bytes):
                time_str = time_str.decode()
            ts = str(date_str) if date_str else ""
            if len(ts) == 8:
                ts = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
            ts += f"T{time_str}Z" if time_str else "T00:00:00Z"
            return {
                "bounds": {"north": float(max_lat), "south": float(min_lat), "east": float(max_lon), "west": float(min_lon)},
                "points": points,
                "timestamp": ts,
                "resolution_m": resolution_m,
            }
    finally:
        os.unlink(tmp_path)


def generate_web_files(frames_processats, output_dir, interval_min):
    """
    Desa TOTS els frames processats i genera els fitxers de metadata.
    Com que la carpeta s'ha netejat abans, només hi haurà aquests.
    """
    if not frames_processats:
        print("    Cap frame per desar.")
        return False

    frames_info = []
    for dt_frame, data in frames_processats:
        nom = frame_filename(dt_frame)
        frame_obj = {
            "timestamp": data["timestamp"],
            "bounds": data["bounds"],
            "points": data["points"],
            "resolution_m": data.get("resolution_m", FALLBACK_RESOLUTION_M),
        }
        js = "window.radarFrame = " + json.dumps(frame_obj, separators=(',', ':')) + ";"
        with open(output_dir / nom, 'w', encoding='utf-8') as f:
            f.write(js)
        frames_info.append((dt_frame, nom))
        print(f"    Desat: {nom} ({len(data['points']):,} punts)")

    frames_info.sort(key=lambda x: x[0])

    metadata = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "region": "NE_Espanya",
        "product": "CIRRUS (dBZ)",
        "resolution": "maxima (sense submostreig)",
        "interval": f"{interval_min} min",
        "total_frames": len(frames_info),
        "frames": [
            {"timestamp": dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "file": nom}
            for dt, nom in frames_info
        ],
    }
    metadata["latest_frame"] = frames_info[-1][1]
    
    with open(output_dir / "radar_metadata.js", 'w', encoding='utf-8') as f:
        f.write(f"window.radarMetadata = {json.dumps(metadata, indent=2)};")

    ara = datetime.now(timezone.utc)
    with open(output_dir / "status.js", 'w', encoding='utf-8') as f:
        f.write(
            "window.radarStatus = {\n"
            f"    executedAtUTC: \"{ara.strftime('%Y-%m-%dT%H:%M:%SZ')}\",\n"
            f"    executedAtEpochMs: {int(ara.timestamp() * 1000)},\n"
            f"    framesDescarregats: {len(frames_info)}\n"
            "};"
        )
    
    print(f"\n    Total: {len(frames_info)} frames desats")
    return True


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  RADAR OPERA - CIRRUS (dBZ)")
    print(f"  Descarrega {TOTAL_FRAMES} frames (actual + {TOTAL_FRAMES-1} anteriors)")
    print("  Neteja completa de la carpeta a cada execució")
    print("=" * 60)

    if not API_KEY:
        print("\n  ERROR: falta la variable d'entorn METEOFRANCE_API_KEY")
        sys.exit(1)

    # 1. Esborrar TOT i crear carpeta neta
    esborrar_tota_la_carpeta(OUTPUT_DIR)

    # 2. Descarregar els últims TOTAL_FRAMES instants
    print(f"\n  Descarregant fins a {TOTAL_FRAMES} frames...")
    frames_descarregats = obtenir_ultims_frames(
        BASE_URL_CIRRUS, API_KEY, INTERVAL_MIN, TOTAL_FRAMES
    )

    # 3. Processar cada frame descarregat
    frames_processats = []
    for dt_frame, content in frames_descarregats:
        try:
            data = process_frame(content, REGIO)
            frames_processats.append((dt_frame, data))
            punts = len(data["points"]) if data["points"] else 0
            print(f"    Processat {dt_frame.strftime('%H:%M')}Z: {punts:,} punts")
        except Exception as e:
            print(f"    Error processant {dt_frame.strftime('%H:%M')}Z: {e}")

    # 4. Generar fitxers web
    ok = generate_web_files(frames_processats, OUTPUT_DIR, INTERVAL_MIN)

    print(f"\n  RESULTAT: {'OK' if ok else 'CAP FRAME DESCARREGAT'}")
    sys.exit(0 if ok else 1)
