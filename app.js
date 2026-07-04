// ============ CONFIG ============
const USGS_URL = "https://earthquake.usgs.gov/earthquake/feed/v1.0/summary/2.5_day.geojson";
const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const REFRESH_MS = 3 * 60 * 1000;
const NEARBY_RADIUS_KM = 1200;

const CATEGORY_META = {
  wildfires:  {label:"Incêndio Florestal", color:"#ff7a45"},
  severeStorms:{label:"Tempestade Severa", color:"#00d9c0"},
  volcanoes:  {label:"Vulcão", color:"#ffb454"},
  seaLakeIce: {label:"Gelo Marinho/Lacustre", color:"#8b8fd1"},
  floods:     {label:"Inundação", color:"#8b8fd1"},
  drought:    {label:"Seca", color:"#8b8fd1"},
  dustHaze:   {label:"Poeira e Neblina", color:"#8b8fd1"},
  default:    {label:"Evento Natural", color:"#8b8fd1"}
};

const WEATHER_CODES = {
  0:"céu limpo",1:"principalmente limpo",2:"parcialmente nublado",3:"nublado",
  45:"neblina",48:"neblina com geada",
  51:"garoa leve",53:"garoa moderada",55:"garoa forte",
  61:"chuva leve",63:"chuva moderada",65:"chuva forte",
  71:"neve leve",73:"neve moderada",75:"neve forte",
  80:"pancadas de chuva",81:"pancadas de chuva moderadas",82:"pancadas de chuva fortes",
  95:"trovoadas",96:"trovoadas com granizo",99:"trovoadas fortes com granizo"
};

// ============ STATE ============
let map;
let quakes = [];   // {lat, lon, mag, place, time, url}
let events = [];   // {lat, lon, title, category, color, date, link}
let allPoints = []; // unified for distance search
let searchMarker = null;
let debounceTimer = null;

// ============ MAP INIT ============
function initMap(){
  map = L.map('map', {worldCopyJump:true, zoomControl:false, minZoom:2}).setView([15,10], 2.3);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:'&copy; OpenStreetMap &copy; CARTO', maxZoom:18
  }).addTo(map);

  map.on('click', (e) => {
    // click on empty map: show a lightweight local briefing (weather only) for that point
    openBriefing({kind:'point', lat:e.latlng.lat, lon:e.latlng.lng});
  });
}

function pulseIcon(color, size=14){
  return L.divIcon({
    className:'pulse-icon',
    html:`<div class="ring" style="border:1px solid ${color};width:${size}px;height:${size}px;"></div>
          <div class="core" style="background:${color};width:${Math.round(size*0.4)}px;height:${Math.round(size*0.4)}px;box-shadow:0 0 6px ${color};"></div>`,
    iconSize:[size,size]
  });
}

// ============ HAVERSINE ============
function distKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ============ DATA FETCH ============
async function loadQuakes(){
  try{
    const res = await fetch(USGS_URL);
    const data = await res.json();
    quakes = data.features.map(f => ({
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      mag: f.properties.mag, place: f.properties.place,
      time: f.properties.time, url: f.properties.url
    }));
  }catch(e){ quakes = []; }
}

async function loadEvents(){
  try{
    const res = await fetch(EONET_URL);
    const data = await res.json();
    events = (data.events||[]).map(ev => {
      const g = ev.geometry && ev.geometry[ev.geometry.length-1];
      if(!g || g.type !== 'Point') return null;
      const catId = ev.categories && ev.categories[0] ? ev.categories[0].id : 'default';
      const meta = CATEGORY_META[catId] || CATEGORY_META.default;
      return {
        lat: g.coordinates[1], lon: g.coordinates[0],
        title: ev.title, category: meta.label, color: meta.color,
        date: g.date, link: ev.link, description: ev.description || ''
      };
    }).filter(Boolean);
  }catch(e){ events = []; }
}

function rebuildLayers(){
  window.__markers && window.__markers.forEach(m => map.removeLayer(m));
  window.__markers = [];

  quakes.forEach(q => {
    const size = 10 + Math.min(16, (q.mag||2.5) * 2.6);
    const m = L.marker([q.lat, q.lon], {icon: pulseIcon('#ff4d6d', size)}).addTo(map);
    m.on('click', () => openBriefing({kind:'quake', ...q}));
    window.__markers.push(m);
  });

  events.forEach(ev => {
    const m = L.marker([ev.lat, ev.lon], {icon: pulseIcon(ev.color, 14)}).addTo(map);
    m.on('click', () => openBriefing({kind:'event', ...ev}));
    window.__markers.push(m);
  });

  allPoints = [
    ...quakes.map(q => ({lat:q.lat, lon:q.lon, label:`Sismo M${q.mag} — ${q.place}`, kind:'quake', ref:q})),
    ...events.map(ev => ({lat:ev.lat, lon:ev.lon, label:`${ev.category}: ${ev.title}`, kind:'event', ref:ev}))
  ];

  document.getElementById('cQuake').textContent = quakes.length;
  document.getElementById('cEvent').textContent = events.length;
}

async function refreshAll(showToast){
  if(showToast) toast(true);
  await Promise.all([loadQuakes(), loadEvents()]);
  rebuildLayers();
  if(showToast) setTimeout(() => toast(false), 600);
}

function toast(show){
  document.getElementById('loadingToast').classList.toggle('show', show);
}

// ============ WAVEFORM ============
const waveValues = new Array(48).fill(20);
function stepWaveform(){
  const activity = Math.min(1, (quakes.length + events.length) / 60);
  const amp = 6 + activity * 20;
  waveValues.shift();
  waveValues.push(20 + (Math.random()-0.5) * amp);
  const step = 400/(waveValues.length-1);
  const pts = waveValues.map((v,i) => `${(i*step).toFixed(1)},${v.toFixed(1)}`).join(' ');
  document.getElementById('waveline').setAttribute('points', pts);
}

// ============ WEATHER ============
async function getWeather(lat, lon){
  try{
    const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // nunca trava a UI indefinidamente
    const res = await fetch(url, {signal: controller.signal});
    clearTimeout(timeout);
    if(!res.ok){
      const bodyText = await res.text().catch(() => '');
      return {__error: `HTTP ${res.status} ${bodyText.slice(0,120)}`};
    }
    const data = await res.json();
    if(!data.current) return {__error: 'resposta sem campo "current": ' + JSON.stringify(data).slice(0,150)};
    return {
      temperature: data.current.temperature_2m,
      windspeed: data.current.wind_speed_10m,
      weathercode: data.current.weather_code
    };
  }catch(e){
    return {__error: (e.name || 'Erro') + ': ' + (e.message || 'desconhecido')};
  }
}

// ============ NEWS (via função serverless com cache, ver /functions/api/news.js) ============
async function getNews(query){
  try{
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // a 1ª chamada pode ser lenta se ainda não estiver em cache
    const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`, {signal: controller.signal});
    clearTimeout(timeout);
    const data = await res.json();
    if(data.error && (!data.articles || data.articles.length === 0)){
      return {__error: data.error};
    }
    return {articles: data.articles || []};
  }catch(e){
    return {__error: (e.name || 'Erro') + ': ' + (e.message || 'desconhecido')};
  }
}

// ============ BRIEFING PANEL ============
function nearbyList(lat, lon, excludeRef){
  return allPoints
    .filter(p => p.ref !== excludeRef)
    .map(p => ({...p, dist: distKm(lat, lon, p.lat, p.lon)}))
    .filter(p => p.dist <= NEARBY_RADIUS_KM)
    .sort((a,b) => a.dist - b.dist)
    .slice(0,5);
}

function fmtTime(ts){
  return new Date(ts).toLocaleString('pt-BR', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
}

async function openBriefing(target){
  const panel = document.getElementById('briefing');
  const content = document.getElementById('briefingContent');
  panel.classList.add('open');

  let title, subtitle, lat, lon, excludeRef = null, newsQuery = null, detailHtml = '';

  if(target.kind === 'place'){
    title = target.name;
    subtitle = [target.admin1, target.country].filter(Boolean).join(' · ');
    lat = target.lat; lon = target.lon;
    newsQuery = target.name;
  } else if(target.kind === 'quake'){
    title = `Sismo M${target.mag}`;
    subtitle = target.place;
    lat = target.lat; lon = target.lon;
    excludeRef = target;
    detailHtml = `<div class="section"><h3><span class="ic" style="background:#ff4d6d"></span>Detalhes do sismo</h3>
      <div class="emeta">Magnitude ${target.mag} · ${fmtTime(target.time)}</div>
      <div style="margin-top:8px;"><a href="${target.url}" target="_blank" rel="noopener">Ver no USGS →</a></div></div>`;
  } else if(target.kind === 'event'){
    title = target.title;
    subtitle = `${target.category} · ${new Date(target.date).toLocaleDateString('pt-BR')}`;
    lat = target.lat; lon = target.lon;
    excludeRef = target;
    detailHtml = `<div class="section"><h3><span class="ic" style="background:${target.color}"></span>Detalhes do evento</h3>
      <div class="emeta" style="margin-bottom:8px;">${target.description ? target.description.slice(0,220) : 'Sem descrição disponível.'}</div>
      ${target.link ? `<a href="${target.link}" target="_blank" rel="noopener">Ver no EONET →</a>` : ''}</div>`;
  } else { // raw point click
    title = `${target.lat.toFixed(2)}, ${target.lon.toFixed(2)}`;
    subtitle = 'Ponto selecionado no mapa';
    lat = target.lat; lon = target.lon;
  }

  content.innerHTML = `
    <p class="eyebrow">Briefing ao vivo</p>
    <h1>${title}</h1>
    <div class="subtitle">${subtitle || ''}</div>
    <div class="section" id="weatherSection"><h3><span class="ic"></span>Agora</h3><div class="muted-note">Carregando clima…</div></div>
    <div class="section" id="nearbySection"><h3><span class="ic"></span>Atividade próxima (${NEARBY_RADIUS_KM} km)</h3><div class="muted-note">Verificando…</div></div>
    ${detailHtml}
    ${target.kind === 'place' ? `<div class="section" id="newsSection"><h3><span class="ic"></span>Sinal de mídia</h3><div class="muted-note">Consultando GDELT — pode levar até 25s (a fonte é instável)…</div></div>` : ''}
  `;

  // weather
  getWeather(lat, lon).then(w => {
    const el = document.getElementById('weatherSection');
    if(!el) return;
    if(w && !w.__error){
      const desc = WEATHER_CODES[w.weathercode] || 'condição indisponível';
      el.innerHTML = `<h3><span class="ic"></span>Agora</h3>
        <div class="weather-row"><span class="temp">${Math.round(w.temperature)}°C</span><span class="desc">${desc}</span></div>
        <div class="weather-meta"><span>vento ${Math.round(w.windspeed)} km/h</span></div>`;
    } else {
      el.innerHTML = `<h3><span class="ic"></span>Agora</h3><div class="muted-note">Clima indisponível no momento.</div>`;
    }
  });

  // nearby activity
  const nearby = nearbyList(lat, lon, excludeRef);
  const nearbyEl = document.getElementById('nearbySection');
  if(nearby.length){
    nearbyEl.innerHTML = `<h3><span class="ic"></span>Atividade próxima (${NEARBY_RADIUS_KM} km)</h3>` +
      nearby.map(n => `<div class="event-item"><div class="etitle">${n.label}</div>
        <div class="emeta">a <span class="edist">${Math.round(n.dist)} km</span></div></div>`).join('');
  } else {
    nearbyEl.innerHTML = `<h3><span class="ic"></span>Atividade próxima (${NEARBY_RADIUS_KM} km)</h3><div class="muted-note">Nenhum evento significativo registrado por perto agora.</div>`;
  }

  // news (place searches only)
  if(target.kind === 'place'){
    getNews(newsQuery).then(result => {
      const el = document.getElementById('newsSection');
      if(!el) return;
      if(result.__error){
        el.innerHTML = `<h3><span class="ic"></span>Sinal de mídia</h3><div class="muted-note">Sinal de notícias indisponível no momento. Tente novamente em instantes.</div>`;
      } else if(!result.articles || result.articles.length === 0){
        el.innerHTML = `<h3><span class="ic"></span>Sinal de mídia</h3><div class="muted-note">Nenhuma cobertura recente encontrada para este local.</div>`;
      } else {
        el.innerHTML = `<h3><span class="ic"></span>Sinal de mídia (últimos 3 dias)</h3>` +
          result.articles.map(a => `<div class="news-item"><a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
            <span class="nsrc">${a.domain || ''}${a.seendate ? ' · ' + a.seendate.slice(0,8) : ''}</span></div>`).join('');
      }
    });
  }
}

// ============ SEARCH ============
async function geocode(query){
  try{
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results || [];
  }catch(e){ return []; }
}

function renderSuggestions(results){
  const box = document.getElementById('searchSuggestions');
  if(!results.length){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = results.map((r,i) => `
    <div class="suggestion" data-idx="${i}">
      <span>${r.name}</span><span class="country">${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
    </div>`).join('');
  box.classList.add('show');
  [...box.children].forEach((child, i) => {
    child.addEventListener('click', () => selectPlace(results[i]));
  });
  box.__results = results;
}

function selectPlace(r){
  document.getElementById('searchSuggestions').classList.remove('show');
  document.getElementById('searchInput').value = r.name;
  if(searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([r.latitude, r.longitude], {icon: pulseIcon('#00d9c0', 16)}).addTo(map);
  map.flyTo([r.latitude, r.longitude], 6, {duration:1.1});
  openBriefing({kind:'place', name:r.name, admin1:r.admin1, country:r.country, lat:r.latitude, lon:r.longitude});
}

function setupSearch(){
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if(q.length < 2){ document.getElementById('searchSuggestions').classList.remove('show'); return; }
    debounceTimer = setTimeout(async () => {
      const results = await geocode(q);
      renderSuggestions(results);
    }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      const box = document.getElementById('searchSuggestions');
      if(box.__results && box.__results.length) selectPlace(box.__results[0]);
    }
  });
  document.getElementById('searchBtn').addEventListener('click', () => {
    const box = document.getElementById('searchSuggestions');
    if(box.__results && box.__results.length) selectPlace(box.__results[0]);
  });
}

// ============ MISC UI ============
function setupUI(){
  document.getElementById('closeBriefing').addEventListener('click', () => {
    document.getElementById('briefing').classList.remove('open');
  });
  document.getElementById('legendToggle').addEventListener('click', () => {
    document.getElementById('legend').classList.toggle('show');
  });
}

// ============ BOOTSTRAP ============
async function bootstrap(){
  initMap();
  setupSearch();
  setupUI();
  setInterval(stepWaveform, 150);
  await refreshAll(true);
  setInterval(() => refreshAll(true), REFRESH_MS);
}

bootstrap();
