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

# IMPORTANT: la clau NO ha d'anar mai escrita literalment al codi.
# Passa-la sempre com a variable d'entorn / secret de GitHub Actions.
API_KEY = os.environ.get("METEOFRANCE_API_KEY")

BASE_URL_CIRRUS = "https://partner-api.meteofrance.fr/partner/radar/opera/1.0/realtime/cirrus/composite/REFLECTIVITY/{date}?format=HDF5"
BASE_URL_NIMBUS = "https://partner-api.meteofrance.fr/partner/radar/opera/1.0/realtime/nimbus/composite/RAINFALL_ACCUMULATION/{date}?format=HDF5"

OUTPUT_DIR = Path("public/radar")

REGIO = {"lat_min": 38.5, "lat_max": 45.0, "lon_min": -2.0, "lon_max": 5.0}

CONFIG = {
    "cirrus": {
        "output_dir": OUTPUT_DIR,
        "base_url": BASE_URL_CIRRUS,
        "interval": 5,            # Cirrus publica cada 5 min
        "clau_valor": "dbz",
        "label": "CIRRUS (dBZ)",
        "filename_prefix": "",    # sense prefix, com fins ara
    },
    "nimbus": {
        "output_dir": OUTPUT_DIR,
        "base_url": BASE_URL_NIMBUS,
        "interval": 15,           # Nimbus publica cada 15 min (NO 5!)
        "clau_valor": "rain_mm",
        "label": "NIMBUS (Rainfall accumulation)",
        "filename_prefix": "nimbus",  # evita xocar amb els fitxers de Cirrus
        "acumulacio_diaria": True,    # nomes Nimbus genera acumulat diari
    },
}

# Nomes es demana UN instant per producte: l'actual, arrodonit cap
# avall al seu interval. No es busca cap frame historic ni es
# completa cap quota cap enrere; els frames s'acumulen sols execucio
# rere execucio (p.ex. via cron), i la purga diaria neteja tot quan
# canvia la data UTC.
REINTENTOS_INSTANTE_ACTUAL = 3
ESPERA_ENTRE_REINTENTOS_SEG = 5

# Patro del nom de fitxer d'un frame, amb o sense prefix de producte:
# radar_frame_DD_MM_YYYY_HHMMz.js
# radar_frame_nimbus_DD_MM_YYYY_HHMMz.js
FRAME_FILENAME_RE = re.compile(
    r"^radar_frame_(?:(?P<prefix>[a-zA-Z0-9]+)_)?(\d{2})_(\d{2})_(\d{4})_(\d{2})(\d{2})Z\.js$"
)

# Resolucio de rejilla per defecte (metres), nomes s'usa com a fallback
# al frontend si el HDF5 no porta xscale/yscale (no hauria de passar
# amb el format ODIM_H5 habitual de MeteoFrance/OPERA).
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


def frame_filename(dt_utc, prefix=""):
    """Nom de fitxer per un frame, a partir del seu timestamp UTC real."""
    if prefix:
        return f"radar_frame_{prefix}_{dt_utc.strftime('%d_%m_%Y_%H%M')}Z.js"
    return f"radar_frame_{dt_utc.strftime('%d_%m_%Y_%H%M')}Z.js"


def parse_frame_filename(nom_fitxer):
    """
    Extreu (datetime UTC, prefix) codificats al nom del fitxer, o
    (None, None) si el nom no segueix el patro esperat (p. ex.
    metadata.js, status.js). prefix es "" per Cirrus (sense prefix) o
    el text del prefix (p.ex. "nimbus") per als altres productes.
    """
    m = FRAME_FILENAME_RE.match(nom_fitxer)
    if not m:
        return None, None
    prefix = m.group("prefix") or ""
    dia, mes, any_, hora, minut = m.group(2), m.group(3), m.group(4), m.group(5), m.group(6)
    try:
        dt = datetime(int(any_), int(mes), int(dia), int(hora), int(minut), tzinfo=timezone.utc)
        return dt, prefix
    except ValueError:
        return None, None


def netejar_frames_dia_anterior(carpeta, avui_utc, filename_prefix=""):
    """
    Esborra nomes els frames DEL MATEIX PRODUCTE (mateix prefix) la
    data dels quals sigui diferent del dia d'avui (UTC). Aixi Cirrus i
    Nimbus, que comparteixen carpeta, no s'esborren l'un a l'altre.
    """
    if not carpeta.exists():
        carpeta.mkdir(parents=True, exist_ok=True)
        return 0

    esborrats = 0
    for f in carpeta.glob("radar_frame_*.js"):
        dt_frame, prefix = parse_frame_filename(f.name)
        if dt_frame is None:
            continue
        if prefix != filename_prefix:
            continue
        if dt_frame.date() != avui_utc:
            f.unlink()
            esborrats += 1

    if esborrats:
        print(f"    Esborrats {esborrats} frames d'un dia anterior")
    return esborrats


def frame_existeix(carpeta, dt_candidat, filename_prefix=""):
    """Comprova si ja existeix en disc el frame per aquest instant exacte."""
    nom = frame_filename(dt_candidat, filename_prefix)
    return (carpeta / nom).exists()


def descarregar_instant_actual(url, headers):
    """
    Fa la peticio HTTP per l'instant actual (unic instant que es
    demana). Reintenta amb espera abans de donar-lo per fallit, ja que
    sol ser el que encara no ha publicat el radar en aquell moment
    exacte. Retorna (content, status_code) - content es None si falla.
    """
    ultim_status = None
    for intent in range(1, REINTENTOS_INSTANTE_ACTUAL + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            ultim_status = resp.status_code
            if resp.status_code == 200 and resp.content:
                return resp.content, resp.status_code
        except Exception as e:
            print(f"      intent {intent}: error {e}")
        if intent < REINTENTOS_INSTANTE_ACTUAL:
            time.sleep(ESPERA_ENTRE_REINTENTOS_SEG)
    return None, ultim_status


def obtenir_frame_actual(base_url, api_key, interval_min, output_dir, filename_prefix=""):
    """
    Demana l'instant actual (arrodonit a l'interval propi del
    producte) i, si no esta disponible, prova UN unic pas enrere
    (un interval) abans de rendir-se.

    Per que aquest unic pas enrere? Si el retard tipic de publicacio
    del radar es mes gran que l'interval del producte (molt habitual
    amb Cirrus, que publica cada 5 min), demanar sempre "l'instant mes
    nou possible en aquest moment" fa que cada execucio persegueixi un
    dat que encara no ha sortit, i mai s'arriba a demanar l'instant
    immediatament anterior, que quasi sempre ja esta publicat. Amb
    aquest fallback d'un sol pas, es trenca aquest "sempre un pas per
    darrere". No es continua mes enrere: si tampoc hi es, s'espera a
    la propera execucio (aixi es manté el comportament de no fer
    backfill llarg).

    Si el frame trobat (actual o l'anterior) ja existeix en disc, no
    es torna a descarregar.

    Retorna (dt_candidat, content): content es None si ja existia o si
    ha fallat la descarrega dels dos instants provats.
    """
    now = datetime.now(timezone.utc)
    candidate = round_down_interval(now, interval_min)

    for intent in range(2):  # 0 = instant actual, 1 = un pas enrere
        if frame_existeix(output_dir, candidate, filename_prefix):
            print(f"    ja existeix {candidate.strftime('%Y-%m-%dT%H%M%SZ')}, s'omet descarrega")
            return candidate, None

        ts = candidate.strftime("%Y-%m-%dT%H%M%SZ")
        url = base_url.format(date=ts)
        headers = {"accept": "application/x-hdf", "apikey": api_key}
        content, status = descarregar_instant_actual(url, headers)
        if content is not None:
            print(f"    OK {ts} ({format_mida(len(content))})")
            return candidate, content

        if intent == 0:
            print(f"    HTTP {status} {ts}, provant l'instant anterior")
            candidate -= timedelta(minutes=interval_min)
        else:
            print(f"    HTTP {status} {ts} (sense frame nou en aquesta execucio)")

    return candidate, None


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
                "resolution_m": resolution_m,
            }
    finally:
        os.unlink(tmp_path)


def _clau_punt(lat, lon):
    """
    Clau estable per identificar un punt de la rejilla entre frames.
    Es fa servir 4 decimals (~11m de precisio) perque la rejilla es
    fixa (mateixa projeccio radar cada vegada), aixi el mateix punt
    fisic cau sempre a la mateixa clau encara que hi hagi petitissimes
    diferencies d'arrodoniment en la conversio de projeccio.
    """
    return f"{lat:.4f},{lon:.4f}"


def actualitzar_acumulacio_diaria(output_dir, avui_utc, dt_frame, data, filename_prefix):
    """
    Manté un acumulat diari de pluja PER PUNT, sumant nomes les
    lectures que cauen en punt d'hora exacta (minut == 0).

    Per que nomes en punt d'hora? Cada frame Nimbus es una finestra
    mobil D'1 HORA que es publica cada 15 min. Dos frames consecutius
    (15 min de diferencia) comparteixen un 75% de la mateixa pluja.
    Sumar-los tots duplicaria/quadruplicaria la pluja real. Nomes les
    lectures ":00" de cada hora corresponen a finestres consecutives
    NO solapades (00:00-01:00, 01:00-02:00, ...), aixi que nomes
    aquestes es sumen a l'acumulat.

    L'estat es persisteix en un JSON al mateix output_dir (per tant
    es versiona/sincronitza igual que la resta de fitxers de dades),
    i es reinicia automaticament quan canvia la data UTC.
    """
    state_path = output_dir / f"{filename_prefix}_daily_state.json"

    state = None
    if state_path.exists():
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            state = None

    if not state or state.get("date") != avui_utc.isoformat():
        state = {
            "date": avui_utc.isoformat(),
            "counted_timestamps": [],
            "totals": {},
            "bounds": None,
            "resolution_m": None,
        }

    # Bounds/resolucio es refresquen sempre amb el darrer frame rebut,
    # encara que aquest instant concret no compti per l'acumulat
    # (aixi el mapa diari es dibuixa amb l'extensio mes recent).
    state["bounds"] = data["bounds"]
    state["resolution_m"] = data.get("resolution_m", FALLBACK_RESOLUTION_M)

    ts_key = dt_frame.strftime("%Y-%m-%dT%H%M%SZ")
    es_hora_en_punt = (dt_frame.minute == 0)
    ja_comptat = ts_key in state["counted_timestamps"]

    if es_hora_en_punt and not ja_comptat:
        for p in data["points"]:
            key = _clau_punt(p["lat"], p["lon"])
            state["totals"][key] = state["totals"].get(key, 0.0) + p["rain_mm"]
        state["counted_timestamps"].append(ts_key)
        print(f"    + sumat a l'acumulat diari ({ts_key}, hora en punt)")
    elif not es_hora_en_punt:
        print(f"    (no es hora en punt, no compta per l'acumulat diari)")

    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f)

    return state


def generate_daily_file(output_dir, state, filename_prefix, product_label):
    """
    Regenera el fitxer JS d'acumulat diari a partir de l'estat
    persistit, en el mateix format {lat, lon, rain_mm, ...} que un
    frame normal perque el frontend el pugui pintar amb la mateixa
    capa Canvas sense codi especial.
    """
    if not state["bounds"]:
        return  # encara no hi ha cap dada per avui

    points = []
    for key, total in state["totals"].items():
        lat_str, lon_str = key.split(",")
        points.append({"lat": float(lat_str), "lon": float(lon_str), "rain_mm": round(total, 2)})

    obj = {
        "date": state["date"],
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hores_comptades": len(state["counted_timestamps"]),
        "bounds": state["bounds"],
        "points": points,
        "resolution_m": state["resolution_m"],
        "product": product_label + " - Acumulat diari",
    }
    nom = f"radar_daily_{filename_prefix}.js" if filename_prefix else "radar_daily.js"
    with open(output_dir / nom, "w", encoding="utf-8") as f:
        f.write("window.radarDaily = " + json.dumps(obj, separators=(',', ':')) + ";")
    print(f"    Acumulat diari: {len(points):,} punts, {len(state['counted_timestamps'])} hores comptades")


def generate_web_files(frame_nou, output_dir, interval_min, product_label, avui_utc, filename_prefix=""):
    """
    Desa el frame nou (si n'hi ha) amb el seu nom basat en timestamp
    real, i despres regenera els fitxers de metadata NOMES amb els
    frames vigents d'aquest producte (mateix prefix) i d'avui, perque
    Cirrus i Nimbus tinguin cadascun la seva propia metadata/status.
    Els frames de execucions anteriors (encara vigents avui) es
    mantenen tal qual: aixi es com s'acumulen sols amb el temps.
    """
    if frame_nou is not None:
        dt_frame, data = frame_nou
        nom = frame_filename(dt_frame, filename_prefix)
        frame_obj = {
            "timestamp": data["timestamp"],
            "bounds": data["bounds"],
            "points": data["points"],
            "resolution_m": data.get("resolution_m", FALLBACK_RESOLUTION_M),
        }
        js = "window.radarFrame = " + json.dumps(frame_obj, separators=(',', ':')) + ";"
        with open(output_dir / nom, 'w', encoding='utf-8') as f:
            f.write(js)

    frames_vigents = []
    for f in output_dir.glob("radar_frame_*.js"):
        dt_frame, prefix = parse_frame_filename(f.name)
        if dt_frame is not None and prefix == filename_prefix and dt_frame.date() == avui_utc:
            frames_vigents.append((dt_frame, f.name))
    frames_vigents.sort(key=lambda x: x[0])

    if not frames_vigents:
        return False

    metadata_filename = f"radar_metadata_{filename_prefix}.js" if filename_prefix else "radar_metadata.js"
    status_filename = f"status_{filename_prefix}.js" if filename_prefix else "status.js"

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
    with open(output_dir / metadata_filename, 'w', encoding='utf-8') as f:
        f.write(f"window.radarMetadata = {json.dumps(metadata, indent=2)};")

    ara = datetime.now(timezone.utc)
    with open(output_dir / status_filename, 'w', encoding='utf-8') as f:
        f.write(
            "window.radarStatus = {\n"
            f"    executedAtUTC: \"{ara.strftime('%Y-%m-%dT%H:%M:%SZ')}\",\n"
            f"    executedAtEpochMs: {int(ara.timestamp() * 1000)},\n"
            f"    frameNouAquestaExecucio: {1 if frame_nou is not None else 0},\n"
            f"    framesVigentsAvui: {len(frames_vigents)}\n"
            "};"
        )
    print(f"    {'1 frame nou' if frame_nou is not None else '0 frames nous'} | {len(frames_vigents)} frames vigents avui")
    return True


def procesar_producte(nom_producte, config, api_key, regio):
    label = config["label"]
    output_dir = config["output_dir"]
    filename_prefix = config.get("filename_prefix", "")
    avui_utc = datetime.now(timezone.utc).date()

    print(f"\n  {label}")

    output_dir.mkdir(parents=True, exist_ok=True)
    netejar_frames_dia_anterior(output_dir, avui_utc, filename_prefix)

    dt_candidat, content = obtenir_frame_actual(
        config["base_url"], api_key, config["interval"], output_dir, filename_prefix
    )

    frame_nou = None
    if content is not None:
        try:
            data = process_frame(content, regio, config["clau_valor"])
            frame_nou = (dt_candidat, data)
            if data["points"]:
                print(f"    Processat: {len(data['points']):,} punts")
            else:
                print("    Buit a la regio (es guarda igualment, 0 punts)")
        except Exception as e:
            print(f"    Error: {e}")
            frame_nou = None

    if config.get("acumulacio_diaria") and frame_nou is not None:
        dt_frame, data = frame_nou
        state = actualitzar_acumulacio_diaria(output_dir, avui_utc, dt_frame, data, filename_prefix)
        generate_daily_file(output_dir, state, filename_prefix, label)

    # Encara que aquesta execucio no hagi generat cap frame nou (ja
    # existia o ha fallat), regenerem la metadata amb el que ja hi ha
    # en disc perque status.js reflecteixi que s'ha executat.
    return generate_web_files(frame_nou, output_dir, config["interval"], label, avui_utc, filename_prefix)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  RADAR OPERA - CICLE UNIC")
    print("  CIRRUS (dBZ) + NIMBUS (rainfall) -> public/radar/")
    print("  Frames acumulatius per timestamp real (purga diaria)")
    print("=" * 60)

    if not API_KEY:
        print("\n  ERROR: falta la variable d'entorn METEOFRANCE_API_KEY")
        sys.exit(1)

    ok_cirrus = procesar_producte("cirrus", CONFIG["cirrus"], API_KEY, REGIO)
    ok_nimbus = procesar_producte("nimbus", CONFIG["nimbus"], API_KEY, REGIO)

    print(f"\n  CIRRUS: {'OK' if ok_cirrus else 'ERROR'}")
    print(f"  NIMBUS: {'OK' if ok_nimbus else 'ERROR'}")

    # Si vols que el job falli nomes quan FALLEN ELS DOS productes
    # (i no bloquejar Cirrus per un fallo puntual de Nimbus o
    # viceversa), fes servir la linia de sota en lloc de l'actual:
    # sys.exit(0 if (ok_cirrus or ok_nimbus) else 1)

    sys.exit(0 if (ok_cirrus and ok_nimbus) else 1)
