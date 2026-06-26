/**
 * Thalassa Digital Twin Interface Controller
 * Manages canvas visualization, user interactions, telemetry bindings, and API sync.
 */

import { KERALA_COASTLINE, FISHING_HARBORS, CONSERVATION_ZONES } from './data/kerala_spatial.js';
import { generateDigitalTwinGrid, calculateOptimizedRoute } from './lib/data_engine.js';
import { fetchIncoisErddapData, fetchOpenMeteoForecast } from './lib/api_client.js';

// Open-Meteo Cache & Debounce Globals
const openMeteoCache = new Map();
let mouseMoveDebounceTimer = null;

// Global state
let currentMode = 'fisherman'; // 'fisherman' or 'conservationist'
let selectedPort = 'munambam';
let dayOfYear = 175; // Defaults to late June (Monsoon season)
let liveData = null;
let gridData = [];
let selectedCell = null;
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
    updateTelemetryCard(defaultCell);
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
      updateTelemetryCard(selectedCell);
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

  // Leaflet Map events
  map.on('mousemove', handleMapMouseMove);
  map.on('click', handleMapClick);

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
            fetchAndCacheForecast(cell.lat, cell.lng, cacheKey);
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
  const badge = document.getElementById('perspective-badge');
  const heading = document.getElementById('main-perspective-heading');
  const desc = document.getElementById('main-perspective-desc');
  const listTitle = document.getElementById('dynamic-list-title');

  if (mode === 'fisherman') {
    btnFish.classList.add('active');
    btnCons.classList.remove('active');
    badge.textContent = "FISHERMAN VIEW";
    badge.style.background = 'var(--pale-blue)';
    badge.style.color = 'var(--action-blue)';
    heading.textContent = "Optimized Fishing & Catch Advisories";
    desc.textContent = "Real-time oceanographic routing system prioritizing harvest yields based on sea surface temperature and primary productivity chlorophyll values.";
    listTitle.textContent = "HIGH YIELD FISHING ZONES";
  } else {
    btnFish.classList.remove('active');
    btnCons.classList.add('active');
    badge.textContent = "CONSERVATION VIEW";
    badge.style.background = 'var(--pale-green)';
    badge.style.color = 'var(--deep-green)';
    heading.textContent = "Marine Reserves & Spawning Warnings";
    desc.textContent = "Monitoring ecological stressors, spawning calendar bans, and historical overfishing indicators to preserve habitats and restrict sensitive zones.";
    listTitle.textContent = "CRITICAL HABITATS & ACTIVE RESTRICTIONS";
  }

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
function updateTelemetryCard(cell) {
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
    displayForecastData(forecast);
  } else {
    document.getElementById('telemetry-wind').textContent = 'Fetching...';
    document.getElementById('telemetry-wave').textContent = 'Fetching...';
  }

  // Update scores
  document.getElementById('score-favorability-label').textContent = `${cell.fishingScore}%`;
  document.getElementById('score-favorability-bar').style.width = `${cell.fishingScore}%`;
  
  document.getElementById('score-sensitivity-label').textContent = `${cell.conservationScore}%`;
  document.getElementById('score-sensitivity-bar').style.width = `${cell.conservationScore}%`;

  // Draw mini historical line graph
  drawMiniTrendChart(cell);
}

function displayForecastData(forecast) {
  if (forecast && forecast.windSpeed !== null) {
    document.getElementById('telemetry-wind').textContent = `${forecast.windSpeed} ${forecast.windUnit} @ ${forecast.windDir}°`;
    document.getElementById('telemetry-wave').textContent = `${forecast.waveHeight} ${forecast.waveUnit} @ ${forecast.wavePeriod}s`;
  } else {
    document.getElementById('telemetry-wind').textContent = '--';
    document.getElementById('telemetry-wave').textContent = '--';
  }
}

async function fetchAndCacheForecast(lat, lng, cacheKey) {
  try {
    const data = await fetchOpenMeteoForecast(lat, lng);
    if (data) {
      openMeteoCache.set(cacheKey, data);
      if (lastHoveredCell && `${lastHoveredCell.lat.toFixed(1)}_${lastHoveredCell.lng.toFixed(1)}` === cacheKey) {
        displayForecastData(data);
      }
    } else {
      if (lastHoveredCell && `${lastHoveredCell.lat.toFixed(1)}_${lastHoveredCell.lng.toFixed(1)}` === cacheKey) {
        document.getElementById('telemetry-wind').textContent = 'Error';
        document.getElementById('telemetry-wave').textContent = 'Error';
      }
    }
  } catch (err) {
    if (lastHoveredCell && `${lastHoveredCell.lat.toFixed(1)}_${lastHoveredCell.lng.toFixed(1)}` === cacheKey) {
      document.getElementById('telemetry-wind').textContent = 'Error';
      document.getElementById('telemetry-wave').textContent = 'Error';
    }
  }
}

// Draw mini historical sparkline for hovered grid coordinate
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
  for (let m = 0; m < 12; m++) {
    const day = Math.round((m / 12) * 365) + 15;
    const seasonalSstDiff = 2.0 * Math.sin((day - 100) * (2 * Math.PI / 365));
    const coastalCooling = 0.5 * Math.sin(cell.minDistanceToCoast / 10);
    const sst = 27.5 + seasonalSstDiff - coastalCooling;
    sstValues.push(sst);
  }

  // Draw chart grids
  mctx.strokeStyle = '#eaece7';
  mctx.lineWidth = 1;
  mctx.beginPath();
  mctx.moveTo(0, h / 2);
  mctx.lineTo(w, h / 2);
  mctx.stroke();

  // Project points
  const minVal = 24.0;
  const maxVal = 32.0;
  const points = sstValues.map((val, idx) => {
    const x = (idx / 11) * w;
    const y = h - ((val - minVal) / (maxVal - minVal)) * h;
    return { x, y };
  });

  // Draw curve
  mctx.beginPath();
  mctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    mctx.lineTo(points[i].x, points[i].y);
  }
  mctx.strokeStyle = 'var(--action-blue)';
  mctx.lineWidth = 1.5;
  mctx.stroke();

  // Draw current active month marker
  const currentMonthIdx = Math.max(0, Math.min(11, Math.floor((dayOfYear / 365) * 12)));
  const activePt = points[currentMonthIdx];
  if (activePt) {
    mctx.beginPath();
    mctx.arc(activePt.x, activePt.y, 4, 0, 2 * Math.PI);
    mctx.fillStyle = 'var(--coral)';
    mctx.strokeStyle = 'white';
    mctx.lineWidth = 1.5;
    mctx.fill();
    mctx.stroke();

    // Text details
    mctx.fillStyle = 'var(--cohere-black)';
    mctx.font = '9px var(--font-mono)';
    mctx.fillText(`${sstValues[currentMonthIdx].toFixed(1)}°C`, activePt.x - 12, activePt.y - 8);
  }
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
        updateTelemetryCard(zone);
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
        updateTelemetryCard(zone);
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
