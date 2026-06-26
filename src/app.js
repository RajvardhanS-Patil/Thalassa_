/**
 * Thalassa Digital Twin Interface Controller
 * Manages canvas visualization, user interactions, telemetry bindings, and API sync.
 */

import { KERALA_COASTLINE, FISHING_HARBORS, CONSERVATION_ZONES } from './data/kerala_spatial.js';
import { generateDigitalTwinGrid, calculateOptimizedRoute, projectTelemetryToPercent } from './lib/data_engine.js';
import { fetchIncoisErddapData, fetchOpenMeteoForecast } from './lib/api_client.js';

// Open-Meteo Cache & Debounce Globals
const openMeteoCache = new Map();
let mouseMoveDebounceTimer = null;

// Global state
let currentMode = 'fisherman'; // 'fisherman' or 'conservationist'
let currentLang = 'en'; // 'en', 'ml', or 'ta'
let selectedPort = 'munambam';
let dayOfYear = 175; // Defaults to late June (Monsoon season)

// Matsya Drishti Multilingual Translation Engine
const TRANSLATIONS = {
  en: {
    titleFisherman: "Optimized Fishing & Catch Advisories",
    descFisherman: "Real-time oceanographic routing system prioritizing harvest yields based on sea surface temperature and primary productivity chlorophyll values.",
    titleConservationist: "Marine Ecosystem Protection & Spawning Bans",
    descConservationist: "Protected marine conservation reserves and seasonal species spawning calendar monitoring for sustainable ocean ecology management.",
    badgeFisherman: "FISHERMAN VIEW",
    badgeConservationist: "CONSERVATION VIEW",
    listTitleFisherman: "HIGH YIELD FISHING ZONES",
    listTitleConservationist: "CRITICAL HABITATS & ACTIVE RESTRICTIONS",
    btnLive: "Live INCOIS Fetch",
    advisoryHeader: "⚠️ INCOIS ADVISORY",
    advisoryText: [
      "🌊 HIGH WAVE WARNING: Wave heights of 2.5m - 3.2m forecast off Kerala coast (Vizhinjam to Kasaragod). Fishermen advised to be cautious.",
      "💨 MET ALERT: Southwest winds reaching 45-55 km/h expected. Strong wind warning active.",
      "🐟 PFZ INSIGHT: Optimal Sea Surface Temperature (27.8°C) and high Chlorophyll density detected 45km west of Neendakara."
    ]
  },
  ml: {
    titleFisherman: "മെച്ചപ്പെടുത്തിയ മത്സ്യബന്ധന വിവരങ്ങൾ",
    descFisherman: "കടൽ താപനിലയും ക്ലോറോഫിൽ സാന്ദ്രതയും അടിസ്ഥാനമാക്കി കൂടുതൽ മീൻ ലഭിക്കുന്നതിനുള്ള തത്സമയ റൂട്ടിംഗ് സംവിധാനം.",
    titleConservationist: "കടൽ സംരക്ഷണവും നിരോധന കാലയളവും",
    descConservationist: "സുസ്ഥിരമായ മത്സ്യബന്ധനത്തിനും കടൽ ആവാസവ്യവസ്ഥയുടെ സംരക്ഷണത്തിനുമായി വിവിധ സംരക്ഷിത മേഖലകളും പ്രജനന നിരോധന കാലയളവ് പരിശോധനയും.",
    badgeFisherman: "മത്സ്യബന്ധന സഹായി",
    badgeConservationist: "സംരക്ഷണ സഹായി",
    listTitleFisherman: "കൂടിയ വിളവുള്ള മത്സ്യബന്ധന മേഖലകൾ",
    listTitleConservationist: "പ്രധാന കടൽ സംരക്ഷിത പ്രദേശങ്ങൾ",
    btnLive: "തത്സമയ വിവരങ്ങൾ",
    advisoryHeader: "⚠️ മുന്നറിയിപ്പ്",
    advisoryText: [
      "🌊 ഉയർന്ന തിരമാല ജാഗ്രത: കേരള തീരങ്ങളിൽ (വിഴിഞ്ഞം മുതൽ കാസർഗോഡ് വരെ) 2.5 മുതൽ 3.2 മീറ്റർ വരെ ഉയരമുള്ള തിരമാലകൾക്ക് സാധ്യത. ജാഗ്രത പാലിക്കുക.",
      "💨 കാറ്റ് മുന്നറിയിപ്പ്: മണിക്കൂറിൽ 45-55 കി.മീ വേഗതയുള്ള ശക്തമായ കാറ്റിന് സാധ്യതയുണ്ട്.",
      "🐟 ഉപദേശം: നീണ്ടകരയ്ക്ക് പടിഞ്ഞാറ് 45 കി.മീ മാറി അനുകൂല താപനിലയും കൂടുതൽ പ്ലവങ്ങളും കണ്ടെത്തി."
    ]
  },
  ta: {
    titleFisherman: "மீன்பிடி வழிகாட்டி மற்றும் ஆலோசனைகள்",
    descFisherman: "கடல் வெப்பநிலை மற்றும் குளோரோபில் அடர்த்தியின் அடிப்படையில் அதிக மகசூல் தரும் பகுதிகளுக்கான நிகழ்நேர கடல் வழிகாட்டி.",
    titleConservationist: "கடல் சுற்றுச்சூழல் பாதுகாப்பு",
    descConservationist: "நிலையான மீன்பிடிப்பு மற்றும் கடல் வளங்களைப் பாதுகாப்பதற்கான தடைசெய்யப்பட்ட பகுதிகள் மற்றும் இனப்பெருக்க கால அவகாசம் கண்காணிப்பு.",
    badgeFisherman: "மீனவர் பார்வை",
    badgeConservationist: "கடல் பாதுகாப்பு",
    listTitleFisherman: "அதிக மகசூல் தரும் மீன்பிடி மண்டலங்கள்",
    listTitleConservationist: "முக்கிய பாதுகாக்கப்பட்ட கடல் பகுதிகள்",
    btnLive: "லைவ் தகவல்",
    advisoryHeader: "⚠️ அறிவிப்பு",
    advisoryText: [
      "🌊 அலை எச்சரிக்கை: கேரளா கடற்பகுதியில் (விழிஞ்ஞம் முதல் காசர்கோடு வரை) 2.5 முதல் 3.2 மீட்டர் வரை உயரமான அலைகள் வீசக்கூடும். மீனவர்கள் எச்சரிக்கையுடன் இருக்கவும்.",
      "💨 காற்றின் எச்சரிக்கை: மணிக்கு 45-55 கிமீ வேகத்தில் காற்று வீசக்கூடும் என்பதால் கூடுதல் கவனம் தேவை.",
      "🐟 மீன்பிடி வாய்ப்பு: நீண்டகரைக்கு மேற்கே 45 கிமீ தொலைவில் சாதகமான வெப்பநிலையும் அதிக குளோரோபில் செறிவும் கண்டறியப்பட்டுள்ளது."
    ]
  }
};

function translateUI(lang) {
  currentLang = lang;
  const trans = TRANSLATIONS[lang] || TRANSLATIONS['en'];
  
  const heading = document.getElementById('main-perspective-heading');
  const desc = document.getElementById('main-perspective-desc');
  const badge = document.getElementById('perspective-badge');
  const listTitle = document.getElementById('dynamic-list-title');
  const btnLive = document.getElementById('btn-fetch-live');
  const tickerLabel = document.querySelector('.ticker-label');
  const tickerTextDiv = document.querySelector('.ticker-text');

  if (currentMode === 'fisherman') {
    if (heading) heading.textContent = trans.titleFisherman;
    if (desc) desc.textContent = trans.descFisherman;
    if (listTitle) listTitle.textContent = trans.listTitleFisherman;
    if (badge) {
      badge.textContent = trans.badgeFisherman;
      badge.style.background = 'var(--pale-green)';
      badge.style.color = 'var(--deep-green)';
    }
  } else {
    if (heading) heading.textContent = trans.titleConservationist;
    if (desc) desc.textContent = trans.descConservationist;
    if (listTitle) listTitle.textContent = trans.listTitleConservationist;
    if (badge) {
      badge.textContent = trans.badgeConservationist;
      badge.style.background = 'var(--pale-blue)';
      badge.style.color = 'var(--primary-color)';
    }
  }

  if (btnLive) btnLive.textContent = trans.btnLive;
  if (tickerLabel) tickerLabel.textContent = trans.advisoryHeader;
  
  if (tickerTextDiv) {
    tickerTextDiv.innerHTML = trans.advisoryText.map(t => `<span>${t}</span>`).join('');
  }

  updateSidebarLists();
}
let liveData = null;
let gridData = [];
let selectedCell = null;
let displayedTelemetryCell = null;
let optimizedRoute = null;
let isPlaying = false;
let playInterval = null;
let map = null; // Leaflet map instance

// Animation helpers
let pulseState = 0;
let vesselProgress = 0;

// Active Overlay Layers
const activeOverlays = {
  sst: true,
  chl: true,
  currents: false,
  mpa: true
};

// Canvas references
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');

// Bounding box limits matching data_engine.js
const LAT_MIN = 8.0;
const LAT_MAX = 12.8;
const LNG_MIN = 74.5;
const LNG_MAX = 77.5;

// Coordinate projection helper functions utilizing Leaflet Map API
function projectX(lng) {
  if (!map) return 0;
  return map.latLngToContainerPoint([10.4, lng]).x;
}

function projectY(lat) {
  if (!map) return 0;
  return map.latLngToContainerPoint([lat, 76.0]).y;
}

function unprojectX(x) {
  if (!map) return LNG_MIN;
  return map.containerPointToLatLng(L.point(x, 0)).lng;
}

function unprojectY(y) {
  if (!map) return LAT_MAX;
  return map.containerPointToLatLng(L.point(0, y)).lat;
}

// Initialize Application
function init() {
  // Initialize Leaflet Map
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([10.4, 76.0], 8);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    minZoom: 6
  }).addTo(map);

  // Constrain the map bounds to the Kerala region
  map.setMaxBounds([
    [LAT_MIN - 1.0, LNG_MIN - 1.0],
    [LAT_MAX + 1.0, LNG_MAX + 1.0]
  ]);

  setupEventListeners();
  updateGrid();
  handleResize();

  // Redraw canvas whenever Leaflet pans or zooms
  map.on('zoom move', draw);
  
  // Set default telemetry selection (Munambam harbor)
  const munambamPort = FISHING_HARBORS.find(h => h.id === 'munambam');
  if (munambamPort) {
    const defaultCell = {
      lat: munambamPort.lat,
      lng: munambamPort.lng,
      isLand: false,
      isDeepOcean: false,
      sst: 28.1,
      chlorophyll: 1.8,
      currentSpeed: 0.5,
      currentDir: 180,
      fishingScore: 82,
      conservationScore: 35,
      minDistanceToCoast: 12,
      sensitivityReasons: ['Estuary nutrient zone'],
      favorabilityReasons: ['Optimal temperature', 'Strong food index']
    };
    updateTelemetryCard(defaultCell, true);
  }

  showToast("Thalassa workspace initialized. Leaflet background loaded.");
  
  // Start the render loop
  requestAnimationFrame(tick);
}

// Tick loop for real-time visual pulses and vessel transit animation
function tick() {
  pulseState = (pulseState + 0.05) % (2 * Math.PI);
  if (optimizedRoute) {
    vesselProgress = (vesselProgress + 0.002) % 1.0;
  }
  draw();
  requestAnimationFrame(tick);
}

// Regenerate grid matrices based on state
function updateGrid() {
  gridData = generateDigitalTwinGrid(dayOfYear, liveData);
  
  // Recalculate route if destination exists
  if (selectedCell) {
    const newCell = gridData.find(c => c.row === selectedCell.row && c.col === selectedCell.col);
    if (newCell) {
      selectedCell = newCell;
      optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData);
      updateTelemetryCard(selectedCell, true);
    }
  }

  updateSidebarLists();
}

// Setup Interaction Listeners
function setupEventListeners() {
  // Mode toggles
  document.getElementById('mode-fisherman').addEventListener('click', (e) => {
    switchPerspective('fisherman');
  });
  document.getElementById('mode-conservationist').addEventListener('click', (e) => {
    switchPerspective('conservationist');
  });

  // Layer badges
  setupLayerToggle('layer-sst', 'sst');
  setupLayerToggle('layer-chl', 'chl');
  setupLayerToggle('layer-currents', 'currents');
  setupLayerToggle('layer-mpa', 'mpa');

  // Port selector
  const portSelect = document.getElementById('port-selector');
  portSelect.addEventListener('change', (e) => {
    selectedPort = e.target.value;
    if (selectedCell) {
      optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData);
    }
    updateSidebarLists();
  });

  // Timeline slider
  const slider = document.getElementById('timeline-slider');
  slider.addEventListener('input', (e) => {
    dayOfYear = parseInt(e.target.value);
    updateTimelineLabel();
    updateGrid();
  });

  // Play Pause animation control
  document.getElementById('btn-play-pause').addEventListener('click', togglePlay);

  // Live API Fetch trigger
  document.getElementById('btn-fetch-live').addEventListener('click', triggerLiveApiFetch);

  // Language button listeners
  const langBtns = document.querySelectorAll('.lang-btn');
  langBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      langBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const lang = e.target.getAttribute('data-lang');
      translateUI(lang);
    });
  });

  // Leaflet Map events
  map.on('mousemove', handleMapMouseMove);
  map.on('click', handleMapClick);
  map.on('mouseout', () => {
    lastHoveredCell = null;
    if (selectedCell) {
      updateTelemetryCard(selectedCell, true);
    } else {
      const munambamPort = FISHING_HARBORS.find(h => h.id === 'munambam');
      if (munambamPort) {
        const defaultCell = gridData.find(c => c.lat === munambamPort.lat && c.lng === munambamPort.lng) || {
          lat: munambamPort.lat,
          lng: munambamPort.lng,
          isLand: false,
          isDeepOcean: false,
          sst: 28.1,
          chlorophyll: 1.8,
          currentSpeed: 0.5,
          currentDir: 180,
          fishingScore: 82,
          conservationScore: 35,
          minDistanceToCoast: 12,
          sensitivityReasons: ['Estuary nutrient zone'],
          favorabilityReasons: ['Optimal temperature', 'Strong food index']
        };
        updateTelemetryCard(defaultCell, true);
      }
    }
  });

  // Hover glow coordinate updates for info-cards
  document.addEventListener('mousemove', (e) => {
    const cards = document.querySelectorAll('.info-card');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });

  window.addEventListener('resize', handleResize);
}

// Toggle play timeline animation
function togglePlay() {
  const btn = document.getElementById('btn-play-pause');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const slider = document.getElementById('timeline-slider');

  if (isPlaying) {
    clearInterval(playInterval);
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    isPlaying = false;
    showToast("Animation paused.");
  } else {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    isPlaying = true;
    showToast("Animating timeline simulation...");
    
    playInterval = setInterval(() => {
      dayOfYear = (dayOfYear % 365) + 1;
      slider.value = dayOfYear;
      updateTimelineLabel();
      updateGrid();
    }, 100);
  }
}

// Update date label format
function updateTimelineLabel() {
  const label = document.getElementById('timeline-date-label');
  const date = dayOfYearToDate(dayOfYear);
  label.textContent = `${date} (Day ${dayOfYear})`;
}

// Approximate day of year to calendar date
function dayOfYearToDate(day) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  
  let temp = day;
  let mIndex = 0;
  
  while (temp > daysInMonth[mIndex]) {
    temp -= daysInMonth[mIndex];
    mIndex++;
    if (mIndex >= 12) break;
  }
  
  return `${months[mIndex]} ${Math.max(1, temp)}`;
}

// Helper to configure button visual states for map overlays
function setupLayerToggle(elementId, key) {
  const btn = document.getElementById(elementId);
  btn.addEventListener('click', () => {
    activeOverlays[key] = !activeOverlays[key];
    if (activeOverlays[key]) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Handle Canvas Resize
function handleResize() {
  if (map) {
    map.invalidateSize();
  }
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
}

// Retrieve grid cell coordinates based on mouse position
function getCellFromCoords(x, y) {
  const lng = unprojectX(x, canvas.width);
  const lat = unprojectY(y, canvas.height);

  return gridData.find(cell => {
    const latStep = (LAT_MAX - LAT_MIN) / 24; // Grid rows
    const lngStep = (LNG_MAX - LNG_MIN) / 18; // Grid cols
    return Math.abs(cell.lat - lat) <= (latStep / 2) && Math.abs(cell.lng - lng) <= (lngStep / 2);
  });
}

// Map Hover interaction
let lastHoveredCell = null;
function handleMapMouseMove(e) {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;
  
  const cell = gridData.find(cell => {
    const latStep = (LAT_MAX - LAT_MIN) / 24;
    const lngStep = (LNG_MAX - LNG_MIN) / 18;
    return Math.abs(cell.lat - lat) <= (latStep / 2) && Math.abs(cell.lng - lng) <= (lngStep / 2);
  });
  
  if (cell !== lastHoveredCell) {
    lastHoveredCell = cell;
    if (cell) {
      updateTelemetryCard(cell);
      
      if (mouseMoveDebounceTimer) {
        clearTimeout(mouseMoveDebounceTimer);
      }
      
      if (!cell.isLand) {
        const cacheKey = `${cell.lat.toFixed(1)}_${cell.lng.toFixed(1)}`;
        if (!openMeteoCache.has(cacheKey)) {
          mouseMoveDebounceTimer = setTimeout(() => {
            fetchAndCacheForecast(cell);
          }, 350);
        }
      }
    }
  }
}

// Map Selection interaction
function handleMapClick(e) {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;
  
  const cell = gridData.find(cell => {
    const latStep = (LAT_MAX - LAT_MIN) / 24;
    const lngStep = (LNG_MAX - LNG_MIN) / 18;
    return Math.abs(cell.lat - lat) <= (latStep / 2) && Math.abs(cell.lng - lng) <= (lngStep / 2);
  });

  if (cell) {
    if (cell.isLand) return; // Skip land clicks
    
    selectedCell = cell;
    optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData);
    vesselProgress = 0; // Reset transit animation
    
    document.getElementById('route-section').style.display = 'block';
    updateRouteTelemetry();
    
    updateGrid();
    showToast(`Target coordinate locked at: ${cell.lat.toFixed(3)}°N, ${cell.lng.toFixed(3)}°E`);
  }
}

// Trigger real-time Live data fetch from INCOIS ERDDAP
async function triggerLiveApiFetch() {
  const btn = document.getElementById('btn-fetch-live');
  btn.disabled = true;
  btn.textContent = "Querying APIs...";
  showToast("Accessing INCOIS ERDDAP servers. Requesting latest chlorophyll and SST indices...");

  try {
    const [sstApiData, chlApiData] = await Promise.all([
      fetchIncoisErddapData('sst').catch(() => null),
      fetchIncoisErddapData('chl').catch(() => null)
    ]);
    
    if (sstApiData || chlApiData) {
      liveData = {};
      if (sstApiData) {
        liveData.sst = sstApiData;
        showToast("Live ERDDAP SST dataset ingested successfully.", 'green');
        activeOverlays.sst = true;
        document.getElementById('layer-sst').classList.add('active');
      }
      if (chlApiData) {
        liveData.chlorophyll = chlApiData;
        showToast("Live ERDDAP Chlorophyll dataset ingested successfully.", 'green');
        activeOverlays.chl = true;
        document.getElementById('layer-chl').classList.add('active');
      }
    } else {
      showToast("Live servers uncontactable or blocked by CORS. Running local simulation.", 'orange');
    }
    
    updateGrid();
  } catch (err) {
    showToast("API synchronization error. Loaded offline simulator.", 'red');
  } finally {
    btn.disabled = false;
    btn.textContent = "Trigger Live API Fetch";
  }
}

// Handle switching Fisherman vs Conservation perspectives
function switchPerspective(mode) {
  currentMode = mode;
  
  const btnFish = document.getElementById('mode-fisherman');
  const btnCons = document.getElementById('mode-conservationist');

  if (mode === 'fisherman') {
    btnFish.classList.add('active');
    btnCons.classList.remove('active');
  } else {
    btnFish.classList.remove('active');
    btnCons.classList.add('active');
  }

  translateUI(currentLang);

  selectedCell = null;
  optimizedRoute = null;
  document.getElementById('route-section').style.display = 'none';

  updateGrid();
  showToast(`Switched perspective: ${mode.toUpperCase()} mode.`);
}

// Draw cell selection highlight box
function drawCellHighlight(cell, strokeStyle = 'var(--primary-color)', lineWidth = 3) {
  const latStep = (LAT_MAX - LAT_MIN) / 24;
  const lngStep = (LNG_MAX - LNG_MIN) / 18;

  const topLeft = map.latLngToContainerPoint([cell.lat + latStep / 2, cell.lng - lngStep / 2]);
  const bottomRight = map.latLngToContainerPoint([cell.lat - latStep / 2, cell.lng + lngStep / 2]);

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
}

// Update telemetry details panel
function updateTelemetryCard(cell, forceImmediateFetch = false) {
  displayedTelemetryCell = cell;
  document.getElementById('telemetry-coords').textContent = `${cell.lat.toFixed(3)}°N, ${cell.lng.toFixed(3)}°E`;
  document.getElementById('cell-type-badge').textContent = cell.isLand ? 'LAND' : (cell.isDeepOcean ? 'DEEP SEA' : 'SHELF');
  
  if (cell.isLand) {
    document.getElementById('telemetry-sst').textContent = '--';
    document.getElementById('telemetry-chl').textContent = '--';
    document.getElementById('telemetry-currents').textContent = '--';
    document.getElementById('telemetry-coast').textContent = '--';
    document.getElementById('telemetry-wind').textContent = '--';
    document.getElementById('telemetry-wave').textContent = '--';
    document.getElementById('score-favorability-label').textContent = '0%';
    document.getElementById('score-favorability-bar').style.width = '0%';
    document.getElementById('score-sensitivity-label').textContent = '0%';
    document.getElementById('score-sensitivity-bar').style.width = '0%';
    updateMatsyaAISec(cell);
    return;
  }

  document.getElementById('telemetry-sst').textContent = `${cell.sst.toFixed(1)} °C`;
  document.getElementById('telemetry-chl').textContent = `${cell.chlorophyll.toFixed(2)} mg/m³`;
  document.getElementById('telemetry-currents').textContent = `${cell.currentSpeed.toFixed(1)} m/s @ ${cell.currentDir}°`;
  document.getElementById('telemetry-coast').textContent = `${cell.minDistanceToCoast} km`;
  
  // Set wind and wave from cache if available, else show loading or fetch it
  const cacheKey = `${cell.lat.toFixed(1)}_${cell.lng.toFixed(1)}`;
  if (openMeteoCache.has(cacheKey)) {
    const forecast = openMeteoCache.get(cacheKey);
    displayForecastData(cell, forecast);
  } else {
    document.getElementById('telemetry-wind').textContent = 'Fetching...';
    document.getElementById('telemetry-wave').textContent = 'Fetching...';
    updateMatsyaAISec(cell);
    if (forceImmediateFetch) {
      fetchAndCacheForecast(cell);
    }
  }

  // Update scores
  document.getElementById('score-favorability-label').textContent = `${cell.fishingScore}%`;
  document.getElementById('score-favorability-bar').style.width = `${cell.fishingScore}%`;
  
  document.getElementById('score-sensitivity-label').textContent = `${cell.conservationScore}%`;
  document.getElementById('score-sensitivity-bar').style.width = `${cell.conservationScore}%`;

  // Draw mini historical line graph
  drawMiniTrendChart(cell);
}

function displayForecastData(cell, forecast) {
  if (forecast && forecast.windSpeed !== null) {
    document.getElementById('telemetry-wind').textContent = `${forecast.windSpeed} ${forecast.windUnit} @ ${forecast.windDir}°`;
    document.getElementById('telemetry-wave').textContent = `${forecast.waveHeight} ${forecast.waveUnit} @ ${forecast.wavePeriod}s`;
    updateMatsyaAISec(cell, forecast);
  } else {
    document.getElementById('telemetry-wind').textContent = '--';
    document.getElementById('telemetry-wave').textContent = '--';
    updateMatsyaAISec(cell);
  }
}

// Update Matsya AI Inference Core Section in UI
function updateMatsyaAISec(cell, liveForecast = null) {
  if (!cell || cell.isLand) {
    document.getElementById('telemetry-twin-x').textContent = '--';
    document.getElementById('telemetry-twin-y').textContent = '--';
    document.getElementById('eco-risk-label').textContent = '--';
    document.getElementById('eco-risk-bar').style.width = '0%';
    document.getElementById('eco-risk-badge').textContent = '--';
    document.getElementById('eco-risk-badge').style.background = 'rgba(0,0,0,0.05)';
    document.getElementById('eco-risk-badge').style.color = '#555';
    document.getElementById('breakdown-e').textContent = '--';
    document.getElementById('breakdown-b').textContent = '--';
    document.getElementById('breakdown-o').textContent = '--';
    document.getElementById('breakdown-a').textContent = '--';
    document.getElementById('breakdown-v').textContent = '--';
    document.getElementById('advisory-badge').textContent = '--';
    document.getElementById('advisory-badge').style.background = 'rgba(0,0,0,0.05)';
    document.getElementById('advisory-badge').style.color = '#555';
    document.getElementById('advisory-reason').textContent = 'Select a location to synthesize advisory.';
    document.getElementById('advisory-wave').textContent = '--';
    document.getElementById('advisory-wind').textContent = '--';
    return;
  }

  // 1. Digital Twin Coordinate Projection (X%, Y%) using projectTelemetryToPercent
  const proj = projectTelemetryToPercent(cell.lat, cell.lng);
  document.getElementById('telemetry-twin-x').textContent = `${proj.xPercent}%`;
  document.getElementById('telemetry-twin-y').textContent = `${proj.yPercent}%`;

  // Fetch values from cell or override with live forecast
  let waveHeightVal = cell.waveHeight || 0;
  let windSpeedVal = cell.windSpeed || 0;

  if (liveForecast) {
    if (liveForecast.waveHeight !== undefined && liveForecast.waveHeight !== null) {
      waveHeightVal = liveForecast.waveHeight;
    }
    if (liveForecast.windSpeed !== undefined && liveForecast.windSpeed !== null) {
      const unit = liveForecast.windUnit || '';
      if (unit.includes('km/h')) {
        windSpeedVal = liveForecast.windSpeed * 0.539957;
      } else if (unit.includes('m/s')) {
        windSpeedVal = liveForecast.windSpeed * 1.94384;
      } else {
        windSpeedVal = liveForecast.windSpeed;
      }
    }
  }

  // Recalculate O_risk and A_risk based on the potentially live values
  const deltaT = Math.max(0, cell.sst - 28.0);
  const deltaH = Math.max(0, waveHeightVal - 2.0);
  const oRisk = Math.max(0, Math.min(100, Math.round(deltaT * 10 + deltaH * 15)));

  let nCriticalAlerts = 0;
  if (waveHeightVal > 3.0) nCriticalAlerts += 2;
  else if (waveHeightVal > 2.0) nCriticalAlerts += 1;
  if (cell.isRestrictedZone) nCriticalAlerts += 1;
  const aRisk = Math.min(100, nCriticalAlerts * 25);

  const eRisk = cell.eRisk !== undefined ? cell.eRisk : 0;
  const bRisk = cell.bRisk !== undefined ? cell.bRisk : 0;
  const vRisk = cell.vRisk !== undefined ? cell.vRisk : 0;

  // Synthesize R_eco Weighted Calculation
  const rEco = Math.round(0.30 * eRisk + 0.25 * bRisk + 0.20 * oRisk + 0.15 * aRisk + 0.10 * vRisk);

  // Risk Classification
  let riskLevel = 'Low';
  if (rEco > 75) riskLevel = 'Critical';
  else if (rEco > 50) riskLevel = 'High';
  else if (rEco > 25) riskLevel = 'Moderate';

  // Fishing Advisory Engine
  let advisoryLevel = 'Recommended';
  if (waveHeightVal > 4.0 || windSpeedVal > 30 || aRisk > 50) {
    advisoryLevel = 'Avoid';
  } else if (waveHeightVal > 2.5 || windSpeedVal > 20 || cell.fishingScore < 40) {
    advisoryLevel = 'Caution';
  }

  // Update R_eco gauge and badge
  document.getElementById('eco-risk-label').textContent = `${rEco}%`;
  document.getElementById('eco-risk-bar').style.width = `${rEco}%`;
  
  const ecoBadge = document.getElementById('eco-risk-badge');
  ecoBadge.textContent = riskLevel;
  if (riskLevel === 'Critical') {
    ecoBadge.style.background = 'rgba(220, 38, 38, 0.15)';
    ecoBadge.style.color = '#b91c1c';
  } else if (riskLevel === 'High') {
    ecoBadge.style.background = 'rgba(249, 115, 22, 0.15)';
    ecoBadge.style.color = '#c2410c';
  } else if (riskLevel === 'Moderate') {
    ecoBadge.style.background = 'rgba(234, 179, 8, 0.15)';
    ecoBadge.style.color = '#854d0e';
  } else {
    ecoBadge.style.background = 'rgba(34, 197, 94, 0.15)';
    ecoBadge.style.color = '#15803d';
  }

  // Update breakdowns
  document.getElementById('breakdown-e').textContent = `${eRisk}%`;
  document.getElementById('breakdown-b').textContent = `${bRisk}%`;
  document.getElementById('breakdown-o').textContent = `${oRisk}%`;
  document.getElementById('breakdown-a').textContent = `${aRisk}%`;
  document.getElementById('breakdown-v').textContent = `${vRisk}%`;

  // Update advisory
  const advBadge = document.getElementById('advisory-badge');
  advBadge.textContent = advisoryLevel;
  if (advisoryLevel === 'Avoid') {
    advBadge.style.background = 'rgba(220, 38, 38, 0.15)';
    advBadge.style.color = '#b91c1c';
  } else if (advisoryLevel === 'Caution') {
    advBadge.style.background = 'rgba(234, 179, 8, 0.15)';
    advBadge.style.color = '#854d0e';
  } else {
    advBadge.style.background = 'rgba(34, 197, 94, 0.15)';
    advBadge.style.color = '#15803d';
  }

  // Reason texts matching the Fishing Advisory Engine rules
  let reason = 'Oceanic metrics are stable. Safe navigation recommended.';
  if (waveHeightVal > 4.0 || windSpeedVal > 30 || aRisk > 50) {
    reason = 'Avoid: ';
    const reasons = [];
    if (waveHeightVal > 4.0) reasons.push(`severe waves (${waveHeightVal.toFixed(1)}m)`);
    if (windSpeedVal > 30) reasons.push(`gale winds (${windSpeedVal.toFixed(0)}kts)`);
    if (aRisk > 50) reasons.push(`ecological hazards`);
    reason += reasons.join(' & ');
  } else if (waveHeightVal > 2.5 || windSpeedVal > 20 || cell.fishingScore < 40) {
    reason = 'Caution: ';
    const reasons = [];
    if (waveHeightVal > 2.5) reasons.push(`waves (${waveHeightVal.toFixed(1)}m)`);
    if (windSpeedVal > 20) reasons.push(`winds (${windSpeedVal.toFixed(0)}kts)`);
    if (cell.fishingScore < 40) reasons.push(`low catch yield`);
    reason += reasons.join(' & ');
  }
  document.getElementById('advisory-reason').textContent = reason;
  document.getElementById('advisory-wave').textContent = `${waveHeightVal.toFixed(1)}m`;
  document.getElementById('advisory-wind').textContent = `${windSpeedVal.toFixed(0)}kts`;
}

async function fetchAndCacheForecast(cell) {
  const cacheKey = `${cell.lat.toFixed(1)}_${cell.lng.toFixed(1)}`;
  try {
    const data = await fetchOpenMeteoForecast(cell.lat, cell.lng);
    if (data) {
      openMeteoCache.set(cacheKey, data);
      if (displayedTelemetryCell && `${displayedTelemetryCell.lat.toFixed(1)}_${displayedTelemetryCell.lng.toFixed(1)}` === cacheKey) {
        displayForecastData(displayedTelemetryCell, data);
      }
    } else {
      if (displayedTelemetryCell && `${displayedTelemetryCell.lat.toFixed(1)}_${displayedTelemetryCell.lng.toFixed(1)}` === cacheKey) {
        document.getElementById('telemetry-wind').textContent = 'Error';
        document.getElementById('telemetry-wave').textContent = 'Error';
      }
    }
  } catch (err) {
    if (displayedTelemetryCell && `${displayedTelemetryCell.lat.toFixed(1)}_${displayedTelemetryCell.lng.toFixed(1)}` === cacheKey) {
      document.getElementById('telemetry-wind').textContent = 'Error';
      document.getElementById('telemetry-wave').textContent = 'Error';
    }
  }
}

// Draw mini historical sparkline for hovered grid coordinate (dual parameter trends)
function drawMiniTrendChart(cell) {
  const chartCanvas = document.getElementById('mini-trend-chart');
  if (!chartCanvas) return;
  const w = chartCanvas.width = chartCanvas.clientWidth;
  const h = chartCanvas.height = chartCanvas.clientHeight;
  const mctx = chartCanvas.getContext('2d');
  
  mctx.clearRect(0, 0, w, h);
  if (cell.isLand) return;

  // Generate 12 monthly points
  const sstValues = [];
  const chlValues = [];
  for (let m = 0; m < 12; m++) {
    const day = Math.round((m / 12) * 365) + 15;
    
    // SST seasonal simulation (peaks in April-May, drops in monsoon July-August)
    const seasonalSstDiff = 2.0 * Math.sin((day - 100) * (2 * Math.PI / 365));
    const coastalCooling = 0.5 * Math.sin(cell.minDistanceToCoast / 10);
    const sst = 27.5 + seasonalSstDiff - coastalCooling;
    sstValues.push(sst);

    // Chlorophyll-a simulation (spikes during monsoon upwelling in July-September)
    const seasonalChlDiff = 2.0 * Math.max(0, Math.sin((day - 170) * (2 * Math.PI / 365)));
    const coastalChlFactor = Math.max(0.2, 5.0 / (cell.minDistanceToCoast + 1));
    const chlorophyll = 0.3 + seasonalChlDiff * coastalChlFactor;
    chlValues.push(chlorophyll);
  }

  // Draw chart grids
  mctx.strokeStyle = '#eaece7';
  mctx.lineWidth = 1;
  mctx.beginPath();
  mctx.moveTo(0, h / 2);
  mctx.lineTo(w, h / 2);
  mctx.stroke();

  // 1. Plot SST Line (Min: 24C, Max: 32C)
  const sstMin = 24.0;
  const sstMax = 32.0;
  const sstPoints = sstValues.map((val, idx) => {
    const x = (idx / 11) * w;
    const y = h - ((val - sstMin) / (sstMax - sstMin)) * h;
    return { x, y };
  });

  mctx.beginPath();
  mctx.moveTo(sstPoints[0].x, sstPoints[0].y);
  for (let i = 1; i < sstPoints.length; i++) {
    mctx.lineTo(sstPoints[i].x, sstPoints[i].y);
  }
  mctx.strokeStyle = 'var(--action-blue)';
  mctx.lineWidth = 1.5;
  mctx.stroke();

  // 2. Plot Chlorophyll Line (Min: 0.0, Max: 5.0)
  const chlMin = 0.0;
  const chlMax = 5.0;
  const chlPoints = chlValues.map((val, idx) => {
    const x = (idx / 11) * w;
    const y = h - ((val - chlMin) / (chlMax - chlMin)) * h;
    return { x, y };
  });

  mctx.beginPath();
  mctx.moveTo(chlPoints[0].x, chlPoints[0].y);
  for (let i = 1; i < chlPoints.length; i++) {
    mctx.lineTo(chlPoints[i].x, chlPoints[i].y);
  }
  mctx.strokeStyle = '#2e7d32'; // Deep Green
  mctx.lineWidth = 1.5;
  mctx.stroke();

  // Draw current active month markers
  const currentMonthIdx = Math.max(0, Math.min(11, Math.floor((dayOfYear / 365) * 12)));
  
  // SST Marker
  const activeSstPt = sstPoints[currentMonthIdx];
  if (activeSstPt) {
    mctx.beginPath();
    mctx.arc(activeSstPt.x, activeSstPt.y, 4, 0, 2 * Math.PI);
    mctx.fillStyle = 'var(--coral)';
    mctx.strokeStyle = 'white';
    mctx.lineWidth = 1.5;
    mctx.fill();
    mctx.stroke();
  }

  // Chlorophyll Marker
  const activeChlPt = chlPoints[currentMonthIdx];
  if (activeChlPt) {
    mctx.beginPath();
    mctx.arc(activeChlPt.x, activeChlPt.y, 4, 0, 2 * Math.PI);
    mctx.fillStyle = 'var(--deep-green)';
    mctx.strokeStyle = 'white';
    mctx.lineWidth = 1.5;
    mctx.fill();
    mctx.stroke();
  }

  // Draw Text Overlays / Legends in the corners
  mctx.fillStyle = 'var(--cohere-black)';
  mctx.font = 'bold 9px var(--font-mono)';
  mctx.textAlign = 'left';
  mctx.fillText(`SST: ${sstValues[currentMonthIdx].toFixed(1)}°C`, 6, 12);
  
  mctx.textAlign = 'right';
  mctx.fillText(`Chl: ${chlValues[currentMonthIdx].toFixed(2)} mg/m³`, w - 6, 12);
}

// Update route text details
function updateRouteTelemetry() {
  if (!optimizedRoute) return;
  const title = document.getElementById('route-title');
  const dist = document.getElementById('route-distance');
  const time = document.getElementById('route-time');

  const activePort = FISHING_HARBORS.find(h => h.id === selectedPort);
  title.textContent = `${activePort.name.split(' ')[0]} to Target Grid`;
  dist.textContent = `${optimizedRoute.distanceKM} km`;
  time.textContent = `${optimizedRoute.estTimeHours} hrs`;
}

// Populate the sidebar list items dynamically
function updateSidebarLists() {
  const container = document.getElementById('dynamic-cards-list');
  container.innerHTML = '';

  if (currentMode === 'fisherman') {
    const topZones = gridData
      .filter(cell => !cell.isLand && !cell.isRestrictedZone)
      .sort((a, b) => b.fishingScore - a.fishingScore)
      .slice(0, 5);

    topZones.forEach((zone, idx) => {
      const card = document.createElement('div');
      card.className = 'info-card';
      card.style.cursor = 'pointer';
      
      const reasons = zone.favorabilityReasons.slice(0, 2).join(', ');
      
      card.innerHTML = `
        <div class="info-card-header">
          <span class="info-card-title">Zone #${idx + 1} (${zone.lat.toFixed(2)}°N, ${zone.lng.toFixed(2)}°E)</span>
          <span style="font-family: var(--font-mono); color: var(--action-blue); font-weight: 700;">${zone.fishingScore}% Yield</span>
        </div>
        <p class="caption" style="margin-top: 4px;">${reasons || 'Optimal biological conditions.'}</p>
      `;

      card.addEventListener('click', () => {
        selectedCell = zone;
        optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData);
        vesselProgress = 0;
        document.getElementById('route-section').style.display = 'block';
        updateRouteTelemetry();
        updateTelemetryCard(zone, true);
        showToast(`Navigating to Zone #${idx + 1}`);
      });

      container.appendChild(card);
    });
  } else {
    const topSanctuaries = gridData
      .filter(cell => !cell.isLand && cell.conservationScore > 35)
      .sort((a, b) => b.conservationScore - a.conservationScore)
      .slice(0, 5);

    topSanctuaries.forEach((zone, idx) => {
      const card = document.createElement('div');
      card.className = 'info-card';
      card.style.cursor = 'pointer';
      
      const activeReason = zone.isRestrictedZone ? 'ACTIVE SPAWNING BAN' : 'Habitat Buffer';
      const detailText = zone.sensitivityReasons[0] || 'High risk ecological pressure.';

      card.innerHTML = `
        <div class="info-card-header">
          <span class="info-card-title">${zone.activeMPA ? zone.activeMPA.name : 'Sensitive Area'}</span>
          <span class="mono-label" style="color: ${zone.isRestrictedZone ? 'var(--coral)' : 'var(--slate)'}; font-weight: 600;">
            ${activeReason}
          </span>
        </div>
        <p class="caption" style="margin-top: 4px;">${detailText} | Sensitivity: <strong>${zone.conservationScore}%</strong></p>
      `;

      card.addEventListener('click', () => {
        selectedCell = zone;
        optimizedRoute = null;
        document.getElementById('route-section').style.display = 'none';
        updateTelemetryCard(zone, true);
        showToast(`Inspecting ecosystem bounds of: ${zone.activeMPA ? zone.activeMPA.name : 'Sensitive Cell'}`);
      });

      container.appendChild(card);
    });
  }
}

// Master Canvas Rendering Call
function draw() {
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;
  
  ctx.clearRect(0, 0, w, h);

  // 1. Draw Grid Cells
  const latStep = (LAT_MAX - LAT_MIN) / 24;
  const lngStep = (LNG_MAX - LNG_MIN) / 18;

  gridData.forEach(cell => {
    const topLeft = map.latLngToContainerPoint([cell.lat + latStep / 2, cell.lng - lngStep / 2]);
    const bottomRight = map.latLngToContainerPoint([cell.lat - latStep / 2, cell.lng + lngStep / 2]);
    const x = topLeft.x;
    const y = topLeft.y;
    const cellW = bottomRight.x - topLeft.x;
    const cellH = bottomRight.y - topLeft.y;

    if (cell.isLand) {
      // Draw land cells in a premium soft stone color for coastline contrast and offline backup
      ctx.fillStyle = 'rgba(238, 236, 231, 0.85)';
      ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);
      return;
    }

    let colorString = 'rgba(255, 255, 255, 1)';
    
    if (currentMode === 'fisherman') {
      if (activeOverlays.sst && !activeOverlays.chl) {
        const alpha = Math.max(0.1, (cell.sst - 25) / 6.0);
        colorString = `rgba(239, 108, 0, ${alpha})`;
      } else if (activeOverlays.chl && !activeOverlays.sst) {
        const alpha = Math.min(1.0, Math.max(0.1, cell.chlorophyll / 5.0));
        colorString = `rgba(46, 125, 50, ${alpha})`;
      } else if (activeOverlays.sst && activeOverlays.chl) {
        const alpha = Math.max(0.1, cell.fishingScore / 100);
        colorString = `rgba(24, 99, 220, ${alpha})`;
      } else {
        colorString = '#f5f7f9';
      }
    } else {
      if (activeOverlays.mpa && cell.conservationScore > 30) {
        const alpha = Math.max(0.15, cell.conservationScore / 100);
        colorString = cell.isRestrictedZone
          ? `rgba(179, 0, 0, ${alpha})`
          : `rgba(255, 119, 89, ${alpha})`;
      } else {
        colorString = '#f5f7f9';
      }
    }

    ctx.fillStyle = colorString;
    ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);

    if (activeOverlays.currents && !cell.isLand) {
      drawCurrentVector(cell, cellW, cellH, w, h);
    }
  });

  // 2. Draw Latitude / Longitude grid lines and axis tags
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(23, 23, 28, 0.4)';
  ctx.font = '8px var(--font-mono)';

  // Draw Latitude Grid Lines
  for (let lat = 8.5; lat < 12.8; lat += 1.0) {
    const y = projectY(lat, h);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${lat.toFixed(1)}°N`, 8, y - 4);
  }

  // Draw Longitude Grid Lines
  for (let lng = 75.0; lng < 77.5; lng += 1.0) {
    const x = projectX(lng, w);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(`${lng.toFixed(1)}°E`, x + 4, h - 8);
  }

  // 3. Draw Dotted Conservation Zones
  if (activeOverlays.mpa) {
    CONSERVATION_ZONES.forEach(zone => {
      ctx.beginPath();
      zone.polygon.forEach((pt, idx) => {
        const x = projectX(pt.lng, w);
        const y = projectY(pt.lat, h);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      
      const pulseColor = zone.severityLevel === 'high' 
        ? `rgba(179, 0, 0, ${0.6 + 0.2 * Math.sin(pulseState)})`
        : `rgba(255, 119, 89, ${0.6 + 0.2 * Math.sin(pulseState)})`;

      ctx.strokeStyle = pulseColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // 4. Draw Coastline Path (Thick Editorial Black Line)
  ctx.beginPath();
  KERALA_COASTLINE.forEach((pt, idx) => {
    const x = projectX(pt.lng, w);
    const y = projectY(pt.lat, h);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'var(--primary-color)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Draw anchors nodes along coastline
  KERALA_COASTLINE.forEach(pt => {
    const x = projectX(pt.lng, w);
    const y = projectY(pt.lat, h);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = 'var(--canvas)';
    ctx.strokeStyle = 'var(--primary-color)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  });

  // 5. Draw Anchor Ports/Harbors
  FISHING_HARBORS.forEach(port => {
    const x = projectX(port.lng, w);
    const y = projectY(port.lat, h);

    // Glowing active ports pulses
    if (port.id === selectedPort) {
      ctx.beginPath();
      ctx.arc(x, y, 7 + 4 * Math.sin(pulseState), 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(24, 99, 220, 0.15)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = port.id === selectedPort ? 'var(--action-blue)' : 'var(--deep-green)';
    ctx.strokeStyle = 'var(--canvas)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'var(--cohere-black)';
    ctx.font = 'bold 9px var(--font-mono)';
    ctx.fillText(port.name.split(' ')[0], x + 9, y + 3);
  });

  // 6. Draw Selected Cell hover highlight
  if (selectedCell) {
    drawCellHighlight(selectedCell, 'var(--primary-color)', 2.5);
  }

  // 7. Draw Route and Animated Transit Vessel
  if (currentMode === 'fisherman' && optimizedRoute) {
    ctx.beginPath();
    optimizedRoute.path.forEach((pt, idx) => {
      const x = projectX(pt.lng, w);
      const y = projectY(pt.lat, h);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'var(--action-blue)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Interpolate vessel location along path
    const vPos = getPositionAlongPath(optimizedRoute.path, vesselProgress);
    if (vPos) {
      const vx = projectX(vPos.lng, w);
      const vy = projectY(vPos.lat, h);

      // Pulse ring
      ctx.beginPath();
      ctx.arc(vx, vy, 6 + 3 * Math.sin(pulseState * 2), 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(24, 99, 220, 0.2)';
      ctx.fill();

      // Main dot
      ctx.beginPath();
      ctx.arc(vx, vy, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = 'var(--action-blue)';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  }

  // Draw Legend and Scale overlay
  drawMapLegendAndScale();
}

// Calculate position along path at fraction p (0-1)
function getPositionAlongPath(path, p) {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];
  
  const totalSegments = path.length - 1;
  const rawIdx = p * totalSegments;
  const idx = Math.min(totalSegments - 1, Math.floor(rawIdx));
  const t = rawIdx - idx;
  
  const p1 = path[idx];
  const p2 = path[idx + 1];
  
  return {
    lat: p1.lat + (p2.lat - p1.lat) * t,
    lng: p1.lng + (p2.lng - p1.lng) * t
  };
}

// Draw current vectors
function drawCurrentVector(cell, cellW, cellH, w, h) {
  const x = projectX(cell.lng, w);
  const y = projectY(cell.lat, h);
  
  const length = Math.max(3.5, cell.currentSpeed * 10);
  const angleRad = (cell.currentDir * Math.PI) / 180;

  const dx = Math.sin(angleRad) * length;
  const dy = -Math.cos(angleRad) * length;

  ctx.beginPath();
  ctx.moveTo(x - dx / 2, y - dy / 2);
  ctx.lineTo(x + dx / 2, y + dy / 2);
  ctx.strokeStyle = 'rgba(24, 99, 220, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const headlen = 2.5;
  ctx.beginPath();
  ctx.moveTo(x + dx / 2, y + dy / 2);
  ctx.lineTo(x + dx / 2 - headlen * Math.sin(angleRad - Math.PI / 6), y + dy / 2 + headlen * Math.cos(angleRad - Math.PI / 6));
  ctx.lineTo(x + dx / 2 - headlen * Math.sin(angleRad + Math.PI / 6), y + dy / 2 + headlen * Math.cos(angleRad + Math.PI / 6));
  ctx.fillStyle = 'rgba(24, 99, 220, 0.45)';
  ctx.fill();
}

// Toast alerts message manager
function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  
  let accentColor = 'white';
  if (type === 'green') accentColor = '#2e7d32';
  if (type === 'orange') accentColor = '#ef6c00';
  if (type === 'red') accentColor = '#c62828';

  toast.innerHTML = `
    <span class="status-dot" style="background: ${accentColor};"></span>
    <span style="font-family: var(--font-mono); font-size: 11px;">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(100%) scale(0.9)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// Trigger initial build setup on window load
window.addEventListener('load', init);

// Map Legend & Scale Bar Drawing helper functions
function drawMapLegendAndScale() {
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;
  
  // 1. Draw Distance Scale Bar
  const scaleBarKm = 50;
  const scaleBarWidthPx = (scaleBarKm / 327) * w;
  const startX = 20;
  const startY = h - 35;
  
  ctx.strokeStyle = 'var(--primary-color)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(startX + scaleBarWidthPx, startY);
  ctx.moveTo(startX, startY - 4);
  ctx.lineTo(startX, startY + 4);
  ctx.moveTo(startX + scaleBarWidthPx, startY - 4);
  ctx.lineTo(startX + scaleBarWidthPx, startY + 4);
  ctx.stroke();
  
  ctx.fillStyle = 'var(--primary-color)';
  ctx.font = 'bold 9px var(--font-mono)';
  ctx.fillText(`${scaleBarKm} km`, startX + scaleBarWidthPx + 8, startY + 3);
  
  // 2. Draw Map Legend Card
  const legendX = 20;
  const legendY = h - 175;
  const legendW = 180;
  const legendH = 120;
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeStyle = 'var(--hairline)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, legendX, legendY, legendW, legendH, 6);
  ctx.fill();
  ctx.stroke();
  
  ctx.fillStyle = 'var(--primary-color)';
  ctx.font = 'bold 9px var(--font-mono)';
  ctx.fillText(currentMode === 'fisherman' ? 'YIELD ANALYSIS LEGEND' : 'CONSERVATION LEGEND', legendX + 12, legendY + 20);
  
  ctx.strokeStyle = 'var(--hairline)';
  ctx.beginPath();
  ctx.moveTo(legendX + 12, legendY + 28);
  ctx.lineTo(legendX + legendW - 12, legendY + 28);
  ctx.stroke();
  
  ctx.font = '9px var(--font-body)';
  if (currentMode === 'fisherman') {
    if (activeOverlays.sst && !activeOverlays.chl) {
      drawColorBox(legendX + 12, legendY + 38, 'rgba(239, 108, 0, 0.8)', 'Sea Temp (Warm/High)');
      drawColorBox(legendX + 12, legendY + 54, 'rgba(239, 108, 0, 0.2)', 'Sea Temp (Cool/Low)');
    } else if (activeOverlays.chl && !activeOverlays.sst) {
      drawColorBox(legendX + 12, legendY + 38, 'rgba(46, 125, 50, 0.8)', 'Chlorophyll (High Food)');
      drawColorBox(legendX + 12, legendY + 54, 'rgba(46, 125, 50, 0.2)', 'Chlorophyll (Low Food)');
    } else {
      drawColorBox(legendX + 12, legendY + 38, 'rgba(24, 99, 220, 0.8)', 'Optimal Yield (High)');
      drawColorBox(legendX + 12, legendY + 54, 'rgba(24, 99, 220, 0.2)', 'Optimal Yield (Low)');
    }
    drawColorBox(legendX + 12, legendY + 74, 'rgba(24, 99, 220, 0.45)', 'Ocean Currents Vector', true);
    drawColorCircle(legendX + 12, legendY + 94, 'var(--action-blue)', 'Anchor Fishing Harbors');
  } else {
    drawColorBox(legendX + 12, legendY + 38, 'rgba(179, 0, 0, 0.7)', 'Active Spawning Ban');
    drawColorBox(legendX + 12, legendY + 54, 'rgba(255, 119, 89, 0.7)', 'Marine Reserve Buffer');
    drawColorBox(legendX + 12, legendY + 74, 'rgba(179, 0, 0, 0.6)', 'Seasonal Spawning Line', false, true);
    drawColorCircle(legendX + 12, legendY + 94, 'var(--deep-green)', 'Protected Harbors');
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawColorBox(x, y, color, text, isArrow = false, isDottedLine = false) {
  if (isArrow) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + 12, y + 4);
    ctx.moveTo(x + 9, y + 2);
    ctx.lineTo(x + 12, y + 4);
    ctx.lineTo(x + 9, y + 6);
    ctx.stroke();
  } else if (isDottedLine) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + 12, y + 4);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 12, 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.strokeRect(x, y, 12, 8);
  }
  
  ctx.fillStyle = 'var(--ink)';
  ctx.fillText(text, x + 20, y + 7);
}

function drawColorCircle(x, y, color, text) {
  ctx.beginPath();
  ctx.arc(x + 6, y + 4, 4, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  
  ctx.fillStyle = 'var(--ink)';
  ctx.fillText(text, x + 20, y + 7);
}
