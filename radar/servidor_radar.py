"""
Servidor HTTP de radar amb actualització automàtica cada 10 min.
Sense deploys, sense Cloudflare, sense git.
Executa: python servidor_radar.py
Obre: http://localhost:8888
"""

import http.server
import socketserver
import threading
import time
import subprocess
import sys
from pathlib import Path
from datetime import datetime

PORT = 8888  # Port alternatiu (8080 pot estar ocupat)
DIRECTORI = Path(__file__).parent

class RadarHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORI), **kwargs)
    
    def log_message(self, format, *args):
        print(f"  [acces] {args[0]}")

def iniciar_servidor():
    while True:
        try:
            with socketserver.TCPServer(("", PORT), RadarHandler) as httpd:
                print(f"\n  Servidor radar: http://localhost:{PORT}")
                print(f"  Servint: {DIRECTORI}")
                print(f"  Dades s'actualitzen cada 10 min")
                print(f"  Ctrl+C per aturar\n")
                httpd.serve_forever()
        except OSError as e:
            if "10048" in str(e) or "Address already in use" in str(e):
                print(f"\n  ERROR: Port {PORT} ocupat. Tancant...")
                print(f"  Prova un altre port o tanca el programa que usa el port {PORT}")
                sys.exit(1)
            raise
def regenerar_dades():
    print(f"\n  [{datetime.now().strftime('%H:%M:%S')}] Regenerant dades...")
    try:
        result = subprocess.run(
            ["python", "-X", "utf8", "radar.py", "--una-vegada"],
            capture_output=True, text=True, timeout=120,
            cwd=DIRECTORI,
            encoding='utf-8', errors='replace'
        )
        if result.stdout:
            lines = result.stdout.split('\n')
            for line in lines[-10:]:
                if line.strip():
                    print(f"  {line.strip()}")
        if result.returncode != 0:
            error = result.stderr[-200:] if result.stderr else 'Desconegut'
            print(f"  ERROR: {error}")
    except Exception as e:
        print(f"  ERROR: {str(e)[:150]}")

def bucle_regeneracio():
    """Cada 10 minuts regenera dades"""
    while True:
        time.sleep(600)  # 10 minuts
        regenerar_dades()

if __name__ == "__main__":
    print("=" * 60)
    print("  SERVIDOR RADAR AUTONOM")
    print(f"  http://localhost:{PORT}")
    print("  Actualitzacio cada 10 min")
    print("=" * 60)
    
    # Regenerar dades al iniciar
    print("\n  Primera carrega de dades...")
    regenerar_dades()
    
    # Iniciar bucle de regeneracio en un thread separat
    thread_reg = threading.Thread(target=bucle_regeneracio, daemon=True)
    thread_reg.start()
    
    # Iniciar servidor HTTP
    iniciar_servidor()