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
# CONFIGURACIO
# ---------------------------------------------------------------------------

API_KEY = os.environ.get("METEOFRANCE_API_KEY")
BASE_URL_CIRRUS = "https://partner-api.meteofrance.fr/partner/radar/opera/1.0/realtime/cirrus/composite/REFLECTIVITY/{date}?format=HDF5"

OUTPUT_DIR_CIRRUS = Path("public/radar")

REGIO = {"lat_min": 38.5, "lat_max": 45.0, "lon_min": -2.0, "lon_max": 5.0}

CONFIG = {
    "cirrus": {
        "output_dir": OUTPUT_DIR_CIRRUS,
        "base_url": BASE_URL_CIRRUS,
        "interval": 10,
        "frames_desitjats": 6,
        "clau_valor": "dbz",
        "label": "CIRRUS (dBZ)",
    }
}

# FIX: antes era 5 (< frames_desitjats), lo que dejaba casi ningun margen
# para absorber un solo instante fallido (p.ex. el mas recent, encara no
# publicat pel radar) sense deixar un forat definitiu. Ara hi ha marge
# de sobres per continuar cap enrere si algun instant falla.
MAX_FRAMES = 14

# FIX: reintents amb espera nomes per l'instant MES RECENT de cada
# execucio, que es el que sol fallar per retard de publicacio de l'API
# (el dat encara no existeix quan es demana "ara" en punt). Reintentar
# instants mes antics no te sentit: si no existien fa uns segons,
# tampoc existiran ara.
REINTENTOS_INSTANTE_MAS_RECIENTE = 3
ESPERA_ENTRE_REINTENTOS_SEG = 5

# Patro del nom de fitxer d'un frame: radar_frame_DD_MM_YYYY_HHMMz.js
FRAME_FILENAME_RE = re.compile(
    r"^radar_frame_(\d{2})_(\d{2})_(\d{4})_(\d{2})(\d{2})Z\.js$"
)

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
    Extreu el datetime UTC codificat al nom del fitxer, o None si el
    nom no segueix el patro esperat (p. ex. metadata.js, status.js).
    """
    m = FRAME_FILENAME_RE.match(nom_fitxer)
    if not m:
        return None
    dia, mes, any_, hora, minut = m.groups()
    try:
        return datetime(int(any_), int(mes), int(dia), int(hora), int(minut), tzinfo=timezone.utc)
    except ValueError:
        return None


def netejar_frames_dia_anterior(carpeta, avui_utc):
    """
    Esborra tots els frames (i qualsevol .js residual d'un format
    antic) la data dels quals sigui diferent del dia d'avui (UTC).
    """
    if not carpeta.exists():
        carpeta.mkdir(parents=True, exist_ok=True)
        return 0

    esborrats = 0
    for f in carpeta.glob("*.js"):
        if f.name in ("radar_metadata.js", "status.js"):
            continue
        dt_frame = parse_frame_filename(f.name)
        if dt_frame is None:
            f.unlink()
            esborrats += 1
            continue
        if dt_frame.date() != avui_utc:
            f.unlink()
            esborrats += 1

    if esborrats:
        print(f"    Esborrats {esborrats} frames d'un dia anterior")
    return esborrats


def frames_existents(carpeta):
    """
    Retorna el conjunt de datetimes UTC dels frames que ja existeixen
    en disc per avui, per evitar tornar a descarregar el mateix instant.
    """
    existents = set()
    if not carpeta.exists():
        return existents
    for f in carpeta.glob("radar_frame_*.js"):
        dt_frame = parse_frame_filename(f.name)
        if dt_frame is not None:
            existents.add(dt_frame)
    return existents


def descarregar_instant(url, headers, es_el_mes_recent):
    """
    Fa la peticio HTTP per un instant concret. Si es l'instant mes
    recent d'aquesta execucio, reintenta amb espera abans de donar-lo
    per fallit, ja que sol ser el que encara no ha publicat el radar.
    Retorna (content, status_code) - content es None si falla.
    """
    intents = REINTENTOS_INSTANTE_MAS_RECIENTE if es_el_mes_recent else 1
    ultim_status = None
    for intent in range(1, intents + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            ultim_status = resp.status_code
            if resp.status_code == 200 and resp.content:
                return resp.content, resp.status_code
        except Exception as e:
            print(f"      intent {intent}: error {e}")
        if intent < intents:
            time.sleep(ESPERA_ENTRE_REINTENTOS_SEG)
    return None, ultim_status


def find_latest_frames(base_url, api_key, interval_min, frames_desitjats, ja_existents, max_intents=MAX_FRAMES):
    """
    Cerca els darrers instants disponibles. Si un instant concret ja
    existeix en disc, se salta la descarrega pero es segueix comptant
    per completar frames_desitjats amb instants mes antics si cal.

    FIX respecte a la versio anterior: max_intents ara te marge de
    sobres per sobre de frames_desitjats, de manera que un unic
    instant fallit (p.ex. el mes recent, encara no publicat) no deixi
    un forat permanent - el bucle segueix cap enrere fins completar
    la quota real de frames, en lloc de rendir-se massa aviat.
    """
    now = datetime.now(timezone.utc)
    candidate = round_down_interval(now, interval_min)
    headers = {"accept": "application/x-hdf", "apikey": api_key}
    frames = []
    ja_tenim = 0
    for i in range(max_intents):
        es_el_mes_recent = (i == 0)
        if candidate in ja_existents:
            print(f"    ja existeix {candidate.strftime('%Y-%m-%dT%H%M%SZ')}, s'omet descarrega")
            ja_tenim += 1
            candidate -= timedelta(minutes=interval_min)
            if (len(frames) + ja_tenim) >= frames_desitjats:
                break
            continue

        ts = candidate.strftime("%Y-%m-%dT%H%M%SZ")
        url = base_url.format(date=ts)
        content, status = descarregar_instant(url, headers, es_el_mes_recent)
        if content is not None:
            frames.append((candidate, content))
            print(f"    OK {ts} ({format_mida(len(content))})")
            if (len(frames) + ja_tenim) >= frames_desitjats:
                break
        else:
            print(f"    HTTP {status} {ts} (descartat, es continua cap enrere)")

        candidate -= timedelta(minutes=interval_min)
    return frames


def is_point_in_region(lat, lon, regio):
    return regio["lat_min"] <= lat <= regio["lat_max"] and regio["lon_min"] <= lon <= regio["lon_max"]


def process_frame(h5data, regio, clau_valor):
    """
    Processa el frame HDF5 a maxima resolucio nativa: es recorre
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
            valor_reduced = valor
            xx, yy = np.meshgrid(xs, ys)
            inv = Transformer.from_crs(proj_crs, "EPSG:4326", always_xy=True)
            lons, lats = inv.transform(xx, yy)
            points = []
            min_lat, max_lat = 90, -90
            min_lon, max_lon = 180, -180
            for i in range(valor_reduced.shape[0]):
                for j in range(valor_reduced.shape[1]):
                    if not np.isnan(valor_reduced[i, j]):
                        lat, lon = float(lats[i, j]), float(lons[i, j])
                        if is_point_in_region(lat, lon, regio):
                            points.append({"lat": lat, "lon": lon, clau_valor: float(valor_reduced[i, j])})
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
            }
    finally:
        os.unlink(tmp_path)


def generate_web_files(frames_nous, output_dir, interval_min, product_label, avui_utc):
    """
    Desa cada frame nou amb el seu nom basat en timestamp real, i
    despres regenera radar_metadata.js llegint tots els frames vigents
    del dia actual, ordenats cronologicament.
    """
    for dt_frame, data in frames_nous:
        nom = frame_filename(dt_frame)
        # IMPORTANT: cal generar JSON valid (claus entre cometes), no
        # un literal JS informal, perque el frontend fa JSON.parse()
        # directament sobre aquest objecte (sense eval()).
        frame_obj = {
            "timestamp": data["timestamp"],
            "bounds": data["bounds"],
            "points": data["points"],
        }
        js = "window.radarFrame = " + json.dumps(frame_obj, separators=(',', ':')) + ";"
        with open(output_dir / nom, 'w', encoding='utf-8') as f:
            f.write(js)

    frames_vigents = []
    for f in output_dir.glob("radar_frame_*.js"):
        dt_frame = parse_frame_filename(f.name)
        if dt_frame is not None and dt_frame.date() == avui_utc:
            frames_vigents.append((dt_frame, f.name))
    frames_vigents.sort(key=lambda x: x[0])

    if not frames_vigents:
        return False

    metadata = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "region": "NE_Espanya",
        "product": product_label,
        "resolution": "maxima (sense submostreig)",
        "interval": f"{interval_min} min",
        "frames": [
            {"timestamp": dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "file": nom}
            for dt, nom in frames_vigents
        ],
    }
    metadata["latest_frame"] = frames_vigents[-1][1]
    with open(output_dir / "radar_metadata.js", 'w', encoding='utf-8') as f:
        f.write(f"window.radarMetadata = {json.dumps(metadata, indent=2)};")

    ara = datetime.now(timezone.utc)
    with open(output_dir / "status.js", 'w', encoding='utf-8') as f:
        f.write(
            "window.radarStatus = {\n"
            f"    executedAtUTC: \"{ara.strftime('%Y-%m-%dT%H:%M:%SZ')}\",\n"
            f"    executedAtEpochMs: {int(ara.timestamp() * 1000)},\n"
            f"    framesNousAquestaExecucio: {len(frames_nous)},\n"
            f"    framesVigentsAvui: {len(frames_vigents)}\n"
            "};"
        )
    print(f"    {len(frames_nous)} frames nous | {len(frames_vigents)} frames vigents avui")
    return True


def procesar_producte(config, api_key, regio):
    label = config["label"]
    output_dir = config["output_dir"]
    avui_utc = datetime.now(timezone.utc).date()

    print(f"\n  {label}")

    output_dir.mkdir(parents=True, exist_ok=True)
    netejar_frames_dia_anterior(output_dir, avui_utc)

    ja_existents = frames_existents(output_dir)
    frames_candidats = find_latest_frames(
        config["base_url"], api_key, config["interval"], config["frames_desitjats"],
        ja_existents, MAX_FRAMES
    )

    if not frames_candidats and not ja_existents:
        print("    Sense frames")
        return False

    frames_nous = []
    for dt, content in frames_candidats:
        try:
            data = process_frame(content, regio, config["clau_valor"])
            # Es guarda el frame sempre, encara que no hi hagi cap punt
            # de pluja dins la regio: un frame buit es una lectura
            # valida (no plou enlloc en aquell instant).
            frames_nous.append((dt, data))
            if data["points"]:
                print(f"    Processat: {len(data['points']):,} punts")
            else:
                print("    Buit a la regio (es guarda igualment, 0 punts)")
        except Exception as e:
            print(f"    Error: {e}")

    return generate_web_files(frames_nous, output_dir, config["interval"], label, avui_utc)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  RADAR OPERA - CICLE UNIC")
    print("  CIRRUS (dBZ) -> public/radar/")
    print("  Frames acumulatius per timestamp real (purga diaria)")
    print("=" * 60)

    ok_cirrus = procesar_producte(CONFIG["cirrus"], API_KEY, REGIO)

    print(f"\n  CIRRUS: {'OK' if ok_cirrus else 'ERROR'}")
    sys.exit(0 if ok_cirrus else 1)