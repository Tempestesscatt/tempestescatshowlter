// ═══════════════════════════════════════════════════════════════════════
//  meteofelix.js — PUNT EN DIRECTE DE L'ESTACIÓ METEOFELIX (Arbúcies)
//  Llegeix js/dades_estacions_manuals.js (generat per Python).
//  Mateix estil visual que les estacions AEMET.
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    const DADES_URL = 'js/dades_estacions_manuals.js';
    const REFRESH_MS = 5 * 60 * 1000;
    const METEOFELIX_ID = 'meteofelix';

    let marcador = null;

    // ═══ ESTILS ═══
    function injectarEstils() {
        if (document.getElementById('meteofelix-styles')) return;
        const style = document.createElement('style');
        style.id = 'meteofelix-styles';
        style.textContent = `
            .estacio-marker{display:flex;align-items:center;gap:4px;font-family:sans-serif;pointer-events:auto;cursor:pointer}
            .estacio-marker .eb-punt{width:8px;height:8px;border-radius:50%;flex:0 0 auto;border:1.5px solid rgba(13,17,23,0.9);box-shadow:0 0 3px rgba(0,0,0,0.6)}
            .estacio-marker .eb-etiqueta{font-size:12px;font-weight:700;white-space:nowrap;line-height:1;text-shadow:-1px -1px 0 rgba(13,17,23,0.9),1px -1px 0 rgba(13,17,23,0.9),-1px 1px 0 rgba(13,17,23,0.9),1px 1px 0 rgba(13,17,23,0.9),0 0 4px rgba(13,17,23,0.9)}
            .estacio-marker .eb-vent{display:flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:2px;cursor:pointer;filter:drop-shadow(0 0 2px rgba(13,17,23,0.9))}
            .popup-estacio{background:rgba(13,17,23,0.97);color:#c9d1d9;padding:12px 16px;border-radius:10px;font-family:sans-serif;min-width:150px;border:1px solid rgba(255,255,255,0.1)}
            .popup-estacio .pe-nom{font-size:12px;font-weight:700;color:#fff;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px}
            .popup-estacio .pe-fila{display:flex;justify-content:space-between;gap:14px;font-size:13px;padding:2px 0}
            .popup-estacio .pe-fila span:first-child{color:#8b949e}
            .popup-estacio .pe-fila span:last-child{font-weight:600;color:#fff}
            .popup-estacio .pe-hora{font-size:10px;color:#484f58;margin-top:8px}
        `;
        document.head.appendChild(style);
    }

    // ═══ PALETA DE TEMPERATURA ═══
    const TEMP_STOPS = [
        {v:-24,r:45,g:0,b:75},{v:-20,r:130,g:0,b:160},{v:-15,r:65,g:0,b:115},{v:-10,r:0,g:0,b:255},
        {v:-5,r:0,g:135,b:255},{v:0,r:0,g:235,b:255},{v:2,r:0,g:255,b:150},{v:5,r:0,g:200,b:0},
        {v:8,r:120,g:255,b:0},{v:11,r:255,g:255,b:0},{v:14,r:255,g:255,b:170},{v:17,r:255,g:235,b:100},
        {v:20,r:255,g:200,b:0},{v:23,r:255,g:140,b:0},{v:26,r:255,g:70,b:0},{v:29,r:255,g:0,b:0},
        {v:32,r:180,g:0,b:0},{v:35,r:90,g:0,b:0},{v:38,r:150,g:0,b:150},{v:42,r:255,g:0,b:255},{v:46,r:255,g:185,b:255}
    ];

    function rgbHex(c){const h=n=>n.toString(16).padStart(2,'0');return '#'+h(c.r)+h(c.g)+h(c.b)}
    function colorTemp(t){
        if(t===null||t===undefined||isNaN(t))return '#8b949e';
        const S=TEMP_STOPS;
        if(t<=S[0].v)return rgbHex(S[0]);
        if(t>=S[S.length-1].v)return rgbHex(S[S.length-1]);
        for(let i=0;i<S.length-1;i++){
            if(t>=S[i].v&&t<=S[i+1].v){
                const rang=S[i+1].v-S[i].v||1,p=(t-S[i].v)/rang;
                return rgbHex({r:Math.round(S[i].r+(S[i+1].r-S[i].r)*p),g:Math.round(S[i].g+(S[i+1].g-S[i].g)*p),b:Math.round(S[i].b+(S[i+1].b-S[i].b)*p)});
            }
        }
        return rgbHex(S[S.length-1]);
    }

    // ═══ BARBA DE VENT ═══
    function svgBarbaVent(kmh){
        const astilLlarg=20;let restant=Math.round(kmh/5)*5;
        const stroke='#000000b6',strokeVora='#46464694';
        let parts='<line x1="2" y1="22" x2="2" y2="'+(22-astilLlarg)+'" stroke="'+strokeVora+'" stroke-width="2.4"/><line x1="2" y1="22" x2="2" y2="'+(22-astilLlarg)+'" stroke="'+stroke+'" stroke-width="1.2"/>';
        let posY=22-astilLlarg;const pasBanderola=4.5,pasRatlla=3;
        while(restant>=50){parts+='<polygon points="2,'+posY+' 2,'+(posY+pasBanderola)+' 11,'+(posY+pasBanderola/2)+'" fill="'+stroke+'" stroke="'+strokeVora+'" stroke-width="0.8"/>';posY+=pasBanderola;restant-=50}
        while(restant>=10){parts+='<line x1="2" y1="'+posY+'" x2="11" y2="'+(posY-3)+'" stroke="'+strokeVora+'" stroke-width="2.4"/><line x1="2" y1="'+posY+'" x2="11" y2="'+(posY-3)+'" stroke="'+stroke+'" stroke-width="1.2"/>';posY+=pasRatlla;restant-=10}
        if(restant>=5){parts+='<line x1="2" y1="'+posY+'" x2="7" y2="'+(posY-2)+'" stroke="'+strokeVora+'" stroke-width="2.4"/><line x1="2" y1="'+posY+'" x2="7" y2="'+(posY-2)+'" stroke="'+stroke+'" stroke-width="1.2"/>'}
        return parts;
    }

    function iconaBarbaVent(dv,kmh){
        if(dv===null||dv===undefined||isNaN(dv))return '';
        const kmhTxt=kmh.toFixed(0),rot=dv%360;
        return '<div class="eb-vent" title="Vent '+kmhTxt+' km/h" data-kmh="'+kmhTxt+'" data-dv="'+Math.round(dv)+'"><svg viewBox="0 0 24 24" style="transform:rotate('+rot+'deg)" width="20" height="20">'+svgBarbaVent(kmh)+'</svg></div>';
    }

    // ═══ ICONA MARCADOR ═══
    function crearIcona(dades){
        const ta=dades.ta,tpr=dades.tpr,cTa=colorTemp(ta),cTpr=colorTemp(tpr);
        const taTxt=(ta!==null&&ta!==undefined)?Math.round(ta):'—',tprTxt=(tpr!==null&&tpr!==undefined)?Math.round(tpr):'—';
        const html='<div class="estacio-marker"><div class="eb-punt" style="background:'+cTa+';"></div><div class="eb-etiqueta"><span style="color:'+cTa+';">'+taTxt+'</span><span style="color:#8b949e;">/</span><span style="color:'+cTpr+';">'+tprTxt+'</span></div>'+iconaBarbaVent(dades.dv,dades.vv_kmh)+'</div>';
        return L.divIcon({className:'',html:html,iconSize:[70,24],iconAnchor:[4,10]});
    }

    function direccioCardinal(graus){
        const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
        return dirs[Math.round(graus/22.5)%16];
    }

    function horaMadridDesde(fechaStr){
        if(!fechaStr)return '--:--';
        try{const parts=fechaStr.split(' ');return parts[1]?parts[1].slice(0,5):'--:--'}catch(e){return '--:--'}
    }

    function contingutPopup(dades){
        const nom=dades.nombre||'Arbúcies (Meteofelix)';const files=[];
        if(dades.ta!==null&&dades.ta!==undefined)files.push('<div class="pe-fila"><span>Temperatura</span><span>'+dades.ta.toFixed(1)+' °C</span></div>');
        if(dades.tpr!==null&&dades.tpr!==undefined)files.push('<div class="pe-fila"><span>Punt de rosada</span><span>'+dades.tpr.toFixed(1)+' °C</span></div>');
        if(dades.hr!==null&&dades.hr!==undefined)files.push('<div class="pe-fila"><span>Humitat relativa</span><span>'+dades.hr.toFixed(0)+' %</span></div>');
        if(dades.pres!==null&&dades.pres!==undefined)files.push('<div class="pe-fila"><span>Pressió</span><span>'+dades.pres.toFixed(1)+' hPa</span></div>');
        if(dades.vv_kmh!==null&&dades.vv_kmh!==undefined){const cardinal=(dades.dv!==null&&dades.dv!==undefined)?' '+direccioCardinal(dades.dv):'';files.push('<div class="pe-fila"><span>Vent</span><span>'+dades.vv_kmh.toFixed(0)+' km/h'+cardinal+'</span></div>')}
        if(dades.racha_kmh!==null&&dades.racha_kmh!==undefined)files.push('<div class="pe-fila"><span>Ratxa</span><span>'+dades.racha_kmh.toFixed(0)+' km/h</span></div>');
        if(dades.uvi!==null&&dades.uvi!==undefined)files.push('<div class="pe-fila"><span>Índex UV</span><span>'+dades.uvi.toFixed(0)+'</span></div>');
        if(dades.solar!==null&&dades.solar!==undefined)files.push('<div class="pe-fila"><span>Radiació solar</span><span>'+dades.solar.toFixed(0)+' W/m²</span></div>');
        if(dades.rain_daily!==null&&dades.rain_daily!==undefined)files.push('<div class="pe-fila"><span>Pluja avui</span><span>'+dades.rain_daily.toFixed(1)+' mm</span></div>');
        if(dades.rain_rate!==null&&dades.rain_rate!==undefined)files.push('<div class="pe-fila"><span>Intensitat pluja</span><span>'+dades.rain_rate.toFixed(1)+' mm/h</span></div>');
        return '<div class="popup-estacio"><div class="pe-nom">'+nom+'</div>'+files.join('')+'<div class="pe-hora">Actualitzat '+horaMadridDesde(dades.fecha)+'</div></div>';
    }

    // ═══ LECTURA DEL FITXER ═══
    async function carregarDesDeFitxer(){
        try{
            const r=await fetch(DADES_URL+'?t='+Date.now(),{cache:'no-store'});
            if(!r.ok){console.log('[Meteofelix] Error HTTP:',r.status);return null}
            const text=await r.text();
            const match=text.match(/window\.dadesEstacionsManuals\s*=\s*({[\s\S]*?});/);
            if(!match){console.log('[Meteofelix] Format no reconegut');return null}
            const data=JSON.parse(match[1]);
            if(!data.estaciones||!Array.isArray(data.estaciones)){console.log('[Meteofelix] No hi ha array estaciones');return null}
            const estacio=data.estaciones.find(e=>e.id===METEOFELIX_ID);
            if(!estacio){console.log('[Meteofelix] Estació "'+METEOFELIX_ID+'" no trobada');return null}
            return estacio;
        }catch(e){console.log('[Meteofelix] Error:',e.message);return null}
    }

    // ═══ RENDERITZAT ═══
    function renderitzar(dades){
        if(!window.map){console.log('[Meteofelix] window.map no existeix');return}
        const ll=[dades.lat,dades.lon],icona=crearIcona(dades);
        if(!marcador){
            marcador=L.marker(ll,{icon:icona,pane:'paneGeojson'});
            marcador.bindPopup(contingutPopup(dades),{className:'',closeButton:true});
            marcador.addTo(window.map);
            console.log('[Meteofelix] Marcador creat ✅');
        }else{
            marcador.setIcon(icona);
            marcador.setPopupContent(contingutPopup(dades));
        }
    }

    async function actualitzar(){
        const dades=await carregarDesDeFitxer();
        if(dades){renderitzar(dades);console.log('[Meteofelix] OK ·',dades.fecha,'· Ta='+dades.ta+'°C')}
    }

    // ═══ INICI ═══
    function esperarMapaIIniciar(){
        if(window.map){injectarEstils();actualitzar();setInterval(actualitzar,REFRESH_MS)}
        else{setTimeout(esperarMapaIIniciar,300)}
    }
    document.addEventListener('auth:autoritzat',esperarMapaIIniciar);
})();