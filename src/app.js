/**
 * Thalassa Digital Twin Interface Controller
 * Manages native Leaflet map layers, telemetry sidebar, seasonal timeline, live API sync, scenario presets, and guided tours.
 */

import { KERALA_COASTLINE, FISHING_HARBORS, CONSERVATION_ZONES } from './data/kerala_spatial.js';
import { generateDigitalTwinGrid, calculateOptimizedRoute, projectTelemetryToPercent } from './lib/data_engine.js';
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
let hoveredCell = null; // Currently hovered grid coordinate
let displayedTelemetryCell = null;
let optimizedRoute = null;
let isPlaying = false;
let playInterval = null;
let map = null; // Leaflet map instance

// Animation helpers
let pulseState = 0;
let vesselProgress = 0;
let isSimulatingVessel = true;
let vesselSpeedMultiplier = 1.0;
let simFuelBurned = 0;

// Active Overlay Layers
const activeOverlays = {
  sst: true,
  chl: true,
  currents: false,
  mpa: true
};

// Bounding box limits matching data_engine.js
const LAT_MIN = 8.0;
const LAT_MAX = 12.8;
const LNG_MIN = 74.5;
const LNG_MAX = 77.5;

// Leaflet Layer Groups
let gridLayerGroup = null;
let conservationLayerGroup = null;
let portsLayerGroup = null;
let currentsLayerGroup = null;
let gridLinesLayerGroup = null;

// Interactive Highlights & Vessel Layers
let hoverOutline = null;
let selectedOutline = null;
let routePolyline = null;
let vesselMarker = null;

// Guided Tour state
let tourActive = false;
let tourStep = 0;

const tourSteps = [
  {
    title: "Welcome to Thalassa 🌊",
    desc: "This digital twin maps the Kerala coastline to balance sustainable fishing yields with marine reserve spawning bans. Let's take a 1-minute guided tour of its core capabilities.",
    highlightId: "btn-start-tour",
    position: "bottom"
  },
  {
    title: "Dual Perspective Dashboards 🔀",
    desc: "Switch between 'Fisherman Dashboard' (optimizing catches using sea surface temperature and chlorophyll indexes) and 'Conservation Dashboard' (restricting sensitive spawning zones). Try toggling this later!",
    highlightId: "mode-fisherman",
    position: "bottom"
  },
  {
    title: "Debounced Hover Telemetry 📊",
    desc: "Hovering over map grid cells queries Open-Meteo APIs for real-time wind and wave forecasts. Coordinate-rounded caching prevents API rate-limiting. Try hovering over cells!",
    highlightId: "telemetry-card",
    position: "left"
  },
  {
    title: "Dynamic Seasonal Timeline 🗓️",
    desc: "Scrub the calendar day slider or hit Play to animate monsoon seasonal variations, including chlorophyll upwellings and shifting conservation boundaries.",
    highlightId: "timeline-panel",
    position: "top"
  },
  {
    title: "INCOIS ERDDAP Live-Sync 🛰️",
    desc: "Click 'Trigger Live API Fetch' to request real-time satellite daily readings directly from federal servers via a CORS-bypassing Vite proxy.",
    highlightId: "btn-fetch-live",
    position: "bottom"
  }
];

// 2D Array to store 432 cell layer references
const cellLayers = Array(24).fill(null).map(() => Array(18).fill(null));

// Initialize Application
function init() {
  // Initialize Leaflet Map
  map = L.map('map', {
    zoomControl: true, // Enable zoom buttons
    attributionControl: false
  }).setView([10.4, 76.0], 8);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    minZoom: 6
  }).addTo(map);

  // Add Leaflet's built-in scale bar in the bottom-left
  L.control.scale({
    position: 'bottomleft',
    metric: true,
    imperial: false
  }).addTo(map);

  // Constrain the map bounds to the Kerala region
  map.setMaxBounds([
    [LAT_MIN - 1.0, LNG_MIN - 1.0],
    [LAT_MAX + 1.0, LNG_MAX + 1.0]
  ]);

  // Instantiate Leaflet layer groups
  gridLayerGroup = L.layerGroup().addTo(map);
  conservationLayerGroup = L.layerGroup().addTo(map);
  portsLayerGroup = L.layerGroup().addTo(map);
  currentsLayerGroup = L.layerGroup().addTo(map);
  gridLinesLayerGroup = L.layerGroup().addTo(map);

  // Set up hover highlight layer
  hoverOutline = L.rectangle([[0, 0], [0, 0]], {
    color: 'rgba(24, 99, 220, 0.6)',
    weight: 1.5,
    fillColor: 'rgba(24, 99, 220, 0.05)',
    fillOpacity: 0.1,
    interactive: false
  });

  // Set up selection highlight layer
  selectedOutline = L.rectangle([[0, 0], [0, 0]], {
    color: 'var(--primary-color)',
    weight: 2.5,
    fillColor: 'rgba(0, 0, 0, 0)',
    fillOpacity: 0,
    interactive: false
  });

  // Set up vessel route path layer
  routePolyline = L.polyline([], {
    color: 'var(--action-blue)',
    weight: 3.5,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false
  });

  // Set up animated vessel marker
  vesselMarker = L.circleMarker([0, 0], {
    radius: 4.5,
    color: 'white',
    weight: 1.5,
    fillColor: 'var(--action-blue)',
    fillOpacity: 1,
    interactive: false
  });

  // Create grid cell rectangles (24x18 = 432 cells)
  const latStep = (LAT_MAX - LAT_MIN) / 24;
  const lngStep = (LNG_MAX - LNG_MIN) / 18;
  const canvasRenderer = L.canvas(); // High-performance canvas vector renderer

  for (let r = 0; r < 24; r++) {
    const lat = LAT_MAX - (r * latStep) - (latStep / 2);
    for (let c = 0; c < 18; c++) {
      const lng = LNG_MIN + (c * lngStep) + (lngStep / 2);
      
      const bounds = [
        [lat - latStep / 2, lng - lngStep / 2],
        [lat + latStep / 2, lng + lngStep / 2]
      ];
      
      const rect = L.rectangle(bounds, {
        renderer: canvasRenderer,
        fillColor: 'rgba(0, 0, 0, 0)',
        fillOpacity: 0,
        color: 'rgba(255, 255, 255, 0.08)',
        weight: 0.5,
        interactive: false // Mousemove is handled at map level for fast spatial lookups
      }).addTo(gridLayerGroup);
      
      cellLayers[r][c] = rect;
    }
  }

  // Draw grid lines and axis ticks
  initGridLines();

  setupEventListeners();
  updateGrid();

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

  // Populate floating HTML legend
  updateMapLegend();

  // Expose global variables to window for easy debugging and evaluation
  window.map = map;
  window.gridData = gridData;
  window.selectedCell = selectedCell;
  window.liveData = liveData;

  showToast("Thalassa workspace initialized. Native Leaflet layers active.");
  
  // Start the animation frame loop
  requestAnimationFrame(tick);
}

// Tick loop for real-time visual pulses and vessel transit animation
function tick() {
  pulseState = (pulseState + 0.05) % (2 * Math.PI);
  
  if (optimizedRoute && vesselMarker && map.hasLayer(vesselMarker)) {
    if (isSimulatingVessel) {
      const step = 0.001 * vesselSpeedMultiplier;
      vesselProgress += step;
      if (vesselProgress >= 1.0) {
        vesselProgress = 0;
        simFuelBurned = 0;
      }
    }
    
    // Animate vessel coordinates along route path
    const vPos = getPositionAlongPath(optimizedRoute.path, vesselProgress);
    if (vPos) {
      vesselMarker.setLatLng([vPos.lat, vPos.lng]);
      
      // Calculate dynamic simulation metrics
      const totalSegments = optimizedRoute.path.length - 1;
      const rawIdx = vesselProgress * totalSegments;
      const idx = Math.min(totalSegments - 1, Math.floor(rawIdx));
      
      let headingDeg = 0;
      if (optimizedRoute.path.length > 1) {
        const p1 = optimizedRoute.path[idx];
        const p2 = optimizedRoute.path[idx + 1];
        const angleRad = Math.atan2(p2.lat - p1.lat, p2.lng - p1.lng);
        headingDeg = (angleRad * 180 / Math.PI + 360) % 360;
      }
      
      // Look up current cell
      const latStep = (LAT_MAX - LAT_MIN) / 24;
      const lngStep = (LNG_MAX - LNG_MIN) / 18;
      const cell = gridData.find(c => Math.abs(c.lat - vPos.lat) <= (latStep / 2) && Math.abs(c.lng - vPos.lng) <= (lngStep / 2)) || {
        currentSpeed: 0.2,
        currentDir: 90,
        waveHeight: 0.8,
        windSpeed: 10,
        isRestrictedZone: false
      };
      
      // Drag calculation (current heading vs flow direction)
      const diffAngle = Math.abs((headingDeg - cell.currentDir + 180) % 360 - 180);
      const cosDiff = Math.cos(diffAngle * Math.PI / 180);
      const dragPercent = cosDiff * cell.currentSpeed * 15; // range: -15% to +15%
      
      // Fuel burn rate
      let fuelRate = 12.0 * (1 + dragPercent / 100);
      if (!cell.isLand) {
        fuelRate += Math.max(0, (cell.waveHeight || 0.8) - 1.0) * 5.0;
        fuelRate += Math.max(0, (cell.windSpeed || 10.0) - 15.0) * 0.2;
      }
      
      // Accumulate fuel (represented hours: step * duration)
      if (isSimulatingVessel) {
        const dh = (0.001 * vesselSpeedMultiplier) * (optimizedRoute.duration || 5);
        simFuelBurned += fuelRate * dh;
      }
      
      // Standard route comparison fuel
      const stdDuration = (optimizedRoute.distance / 12); // Standard slower vessel speed in knots
      const stdTotalFuel = 15.5 * stdDuration;
      const stdFuelCurrent = stdTotalFuel * vesselProgress;
      const co2Saved = 2.62 * (stdFuelCurrent - simFuelBurned);
      
      // Update DOM
      const progressPct = Math.round(vesselProgress * 100);
      const pctEl = document.getElementById('sim-progress-pct');
      const barEl = document.getElementById('sim-progress-bar');
      const posEl = document.getElementById('sim-pos-val');
      const dragEl = document.getElementById('sim-drag-val');
      const fuelEl = document.getElementById('sim-fuel-val');
      const co2El = document.getElementById('sim-co2-val');
      const safetyEl = document.getElementById('sim-safety-banner');
      
      if (pctEl) pctEl.textContent = `${progressPct}%`;
      if (barEl) barEl.style.width = `${progressPct}%`;
      if (posEl) posEl.textContent = `${vPos.lat.toFixed(3)}°N, ${vPos.lng.toFixed(3)}°E`;
      if (dragEl) {
        dragEl.textContent = `${dragPercent > 0 ? '+' : ''}${dragPercent.toFixed(1)}%`;
        dragEl.style.color = dragPercent > 0 ? 'var(--coral)' : 'var(--deep-green)';
      }
      if (fuelEl) fuelEl.textContent = `${simFuelBurned.toFixed(1)} L`;
      if (co2El) co2El.textContent = `${Math.max(0, co2Saved).toFixed(1)} kg`;
      
      if (safetyEl) {
        if (cell.waveHeight > 2.0 || cell.windSpeed > 25) {
          safetyEl.className = 'sim-alert-banner warning';
          safetyEl.innerHTML = `<span>⚠️ Alert: Rough seas (Waves: ${cell.waveHeight.toFixed(1)}m, Wind: ${cell.windSpeed.toFixed(0)}kts)</span>`;
        } else if (cell.isRestrictedZone) {
          safetyEl.className = 'sim-alert-banner warning';
          safetyEl.innerHTML = `<span>⚠️ Warning: Entering Protected Spawning Area!</span>`;
        } else {
          safetyEl.className = 'sim-alert-banner';
          safetyEl.innerHTML = `<span>🟢 Safe Sailing: All route segments below warning thresholds.</span>`;
        }
      }
    }
  }
  
  // Pulse selected port marker size
  if (map && portsLayerGroup) {
    portsLayerGroup.eachLayer(layer => {
      const latlng = layer.getLatLng();
      const port = FISHING_HARBORS.find(h => h.lat === latlng.lat && h.lng === latlng.lng);
      if (port && port.id === selectedPort) {
        layer.setRadius(5 + 3 * Math.sin(pulseState));
      }
    });
  }

  // Pulse conservation zones opacity
  if (map && conservationLayerGroup && activeOverlays.mpa) {
    const opacityScale = 0.5 + 0.2 * Math.sin(pulseState);
    conservationLayerGroup.eachLayer(layer => {
      layer.setStyle({
        opacity: opacityScale
      });
    });
  }

  requestAnimationFrame(tick);
}

// Initialize lat/lng coordinate lines and ticks in Leaflet
function initGridLines() {
  gridLinesLayerGroup.clearLayers();
  
  // Latitude grid lines
  for (let lat = 8.5; lat < 12.8; lat += 1.0) {
    const line = L.polyline([[lat, LNG_MIN], [lat, LNG_MAX]], {
      color: 'rgba(0, 0, 0, 0.04)',
      weight: 1,
      interactive: false
    });
    line.addTo(gridLinesLayerGroup);
    
    // Add grid axis label
    const labelMarker = L.marker([lat, LNG_MIN + 0.05], {
      icon: L.divIcon({
        className: 'grid-axis-label',
        html: `<span style="font-family: var(--font-mono); font-size: 8px; color: rgba(23, 23, 28, 0.4);">${lat.toFixed(1)}°N</span>`,
        iconSize: [40, 10],
        iconAnchor: [0, 5]
      }),
      interactive: false
    });
    labelMarker.addTo(gridLinesLayerGroup);
  }

  // Longitude grid lines
  for (let lng = 75.0; lng < 77.5; lng += 1.0) {
    const line = L.polyline([[LAT_MIN, lng], [LAT_MAX, lng]], {
      color: 'rgba(0, 0, 0, 0.04)',
      weight: 1,
      interactive: false
    });
    line.addTo(gridLinesLayerGroup);
    
    const labelMarker = L.marker([LAT_MIN + 0.05, lng], {
      icon: L.divIcon({
        className: 'grid-axis-label',
        html: `<span style="font-family: var(--font-mono); font-size: 8px; color: rgba(23, 23, 28, 0.4);">${lng.toFixed(1)}°E</span>`,
        iconSize: [40, 10],
        iconAnchor: [20, 0]
      }),
      interactive: false
    });
    labelMarker.addTo(gridLinesLayerGroup);
  }
}

// Regenerate grid matrices based on state
function updateGrid() {
  gridData = generateDigitalTwinGrid(dayOfYear, liveData);
  
  // Link gridData cell items to their respective layer shapes
  gridData.forEach(cell => {
    cell.rectLayer = cellLayers[cell.row][cell.col];
  });

  // Re-style grid cells and vector layers on Leaflet
  updateMapLayers();

  // Recalculate route if destination exists
  if (selectedCell) {
    const newCell = gridData.find(c => c.row === selectedCell.row && c.col === selectedCell.col);
    if (newCell) {
      selectedCell = newCell;
      optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData, dayOfYear);
      updateTelemetryCard(selectedCell, true);

      const pathCoords = optimizedRoute.path.map(pt => [pt.lat, pt.lng]);
      routePolyline.setLatLngs(pathCoords);
      if (!map.hasLayer(routePolyline)) {
        routePolyline.addTo(map);
      }
      if (!map.hasLayer(vesselMarker)) {
        vesselMarker.addTo(map);
      }
    }
  } else {
    if (map.hasLayer(routePolyline)) map.removeLayer(routePolyline);
    if (map.hasLayer(vesselMarker)) map.removeLayer(vesselMarker);
  }

  updateSidebarLists();
}

// Redraw styles of native Leaflet vectors
function updateMapLayers() {
  const currentMonth = Math.floor((dayOfYear / 365) * 12) + 1;

  // 1. Update Grid Cells
  gridData.forEach(cell => {
    const rect = cell.rectLayer;
    if (!rect) return;

    if (cell.isLand) {
      rect.setStyle({
        fillColor: 'rgba(0, 0, 0, 0)',
        fillOpacity: 0,
        color: 'rgba(0,0,0,0)',
        weight: 0
      });
      return;
    }

    let fillColor = 'rgba(0, 0, 0, 0)';
    let fillOpacity = 0;

    if (currentMode === 'fisherman') {
      if (activeOverlays.sst && !activeOverlays.chl) {
        const alpha = Math.max(0.1, (cell.sst - 25) / 6.0);
        fillColor = 'rgb(239, 108, 0)';
        fillOpacity = alpha * 0.35;
      } else if (activeOverlays.chl && !activeOverlays.sst) {
        const alpha = Math.min(1.0, Math.max(0.1, cell.chlorophyll / 5.0));
        fillColor = 'rgb(46, 125, 50)';
        fillOpacity = alpha * 0.35;
      } else if (activeOverlays.sst && activeOverlays.chl) {
        const alpha = Math.max(0.1, cell.fishingScore / 100);
        fillColor = 'rgb(24, 99, 220)';
        fillOpacity = alpha * 0.35;
      }
    } else {
      if (activeOverlays.mpa && cell.conservationScore > 30) {
        const alpha = Math.max(0.15, cell.conservationScore / 100);
        fillColor = cell.isRestrictedZone ? 'rgb(179, 0, 0)' : 'rgb(255, 119, 89)';
        fillOpacity = cell.isRestrictedZone ? alpha * 0.45 : alpha * 0.35;
      }
    }

    rect.setStyle({
      fillColor: fillColor,
      fillOpacity: fillOpacity,
      color: fillColor !== 'rgba(0,0,0,0)' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0,0,0,0)',
      weight: fillColor !== 'rgba(0,0,0,0)' ? 0.5 : 0
    });
  });

  // 2. Update Conservation Zones
  conservationLayerGroup.clearLayers();
  if (activeOverlays.mpa) {
    CONSERVATION_ZONES.forEach(zone => {
      const latLngs = zone.polygon.map(pt => [pt.lat, pt.lng]);
      const isActiveBan = zone.restrictedMonths.includes(currentMonth);
      const color = zone.severityLevel === 'high' ? 'rgb(179, 0, 0)' : 'rgb(255, 119, 89)';
      
      const poly = L.polygon(latLngs, {
        color: color,
        weight: 1.5,
        dashArray: '4, 4',
        fillColor: color,
        fillOpacity: isActiveBan ? 0.15 : 0.05,
        interactive: true
      });
      
      poly.bindTooltip(`<strong>${zone.name}</strong><br>${zone.description}`, { sticky: true });
      poly.on('mousemove', handleMapMouseMove);
      poly.on('click', handleMapClick);
      poly.addTo(conservationLayerGroup);
    });
  }

  // 3. Update Harbors/Ports
  portsLayerGroup.clearLayers();
  FISHING_HARBORS.forEach(port => {
    const isSelected = port.id === selectedPort;
    const color = isSelected ? 'var(--action-blue)' : 'var(--deep-green)';
    
    const marker = L.circleMarker([port.lat, port.lng], {
      radius: isSelected ? 8 : 5,
      color: 'var(--canvas)',
      weight: 1.5,
      fillColor: color,
      fillOpacity: 1,
      interactive: true
    });

    marker.bindTooltip(`<strong>${port.name}</strong><br>District: ${port.district}<br>Active Vessels: ${port.activeVessels}`, { sticky: true });
    
    marker.on('click', () => {
      const selectEl = document.getElementById('port-selector');
      selectEl.value = port.id;
      selectedPort = port.id;
      if (selectedCell) {
        optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData, dayOfYear);
        updateRouteTelemetry();
      }
      updateGrid();
    });

    marker.addTo(portsLayerGroup);
  });

  // 4. Update Currents Vectors
  currentsLayerGroup.clearLayers();
  if (activeOverlays.currents) {
    gridData.forEach(cell => {
      if (cell.isLand) return;
      
      const start = [cell.lat, cell.lng];
      
      // Calculate end point of current vector based on speed and dir
      const scale = 0.05 * cell.currentSpeed;
      const angleRad = (cell.currentDir * Math.PI) / 180;
      const end = [
        cell.lat - Math.cos(angleRad) * scale,
        cell.lng + Math.sin(angleRad) * scale
      ];
      
      const line = L.polyline([start, end], {
        color: 'rgba(24, 99, 220, 0.45)',
        weight: 1.2,
        interactive: false
      });
      line.addTo(currentsLayerGroup);
      
      // Draw arrowhead by adding short lines
      const headlen = scale * 0.25;
      const leftArrow = [
        end[0] + Math.cos(angleRad - Math.PI / 6) * headlen,
        end[1] - Math.sin(angleRad - Math.PI / 6) * headlen
      ];
      const rightArrow = [
        end[0] + Math.cos(angleRad + Math.PI / 6) * headlen,
        end[1] - Math.sin(angleRad + Math.PI / 6) * headlen
      ];
      
      L.polyline([end, leftArrow], { color: 'rgba(24, 99, 220, 0.45)', weight: 1.2 }).addTo(currentsLayerGroup);
      L.polyline([end, rightArrow], { color: 'rgba(24, 99, 220, 0.45)', weight: 1.2 }).addTo(currentsLayerGroup);
    });
  }
}

// Setup Interaction Listeners
function setupEventListeners() {
  // Mode toggles
  document.getElementById('mode-fisherman').addEventListener('click', () => {
    switchPerspective('fisherman');
  });
  document.getElementById('mode-conservationist').addEventListener('click', () => {
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
      optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData, dayOfYear);
    }
    updateGrid();
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

  // Preset Scenario selectors
  document.getElementById('preset-monsoon').addEventListener('click', () => {
    applyPresetScenario('monsoon');
  });
  document.getElementById('preset-winter').addEventListener('click', () => {
    applyPresetScenario('winter');
  });
  document.getElementById('preset-live').addEventListener('click', () => {
    applyPresetScenario('live');
  });

  // Guided Map Tour buttons
  document.getElementById('btn-start-tour').addEventListener('click', startTour);
  document.getElementById('tour-close-btn').addEventListener('click', endTour);
  document.getElementById('tour-next-btn').addEventListener('click', nextTourStep);
  document.getElementById('tour-prev-btn').addEventListener('click', prevTourStep);

  // Leaflet Map events
  map.on('mousemove', handleMapMouseMove);
  map.on('click', handleMapClick);

  map.on('mouseout', () => {
    hoveredCell = null;
    lastHoveredCell = null;
    if (map.hasLayer(hoverOutline)) {
      map.removeLayer(hoverOutline);
    }
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

  window.addEventListener('resize', () => {
    if (map) {
      map.invalidateSize();
    }
  });

  // Live Transit Simulator controls setup
  const simPlayPauseBtn = document.getElementById('sim-play-pause-btn');
  if (simPlayPauseBtn) {
    simPlayPauseBtn.addEventListener('click', () => {
      isSimulatingVessel = !isSimulatingVessel;
      simPlayPauseBtn.textContent = isSimulatingVessel ? 'Pause Sim' : 'Start Sim';
      if (isSimulatingVessel) {
        simPlayPauseBtn.classList.add('active');
      } else {
        simPlayPauseBtn.classList.remove('active');
      }
    });
  }

  const speedBtns = ['1x', '2x', '5x', '10x'];
  speedBtns.forEach(speed => {
    const btn = document.getElementById(`sim-speed-${speed}`);
    if (btn) {
      btn.addEventListener('click', () => {
        vesselSpeedMultiplier = parseFloat(speed);
        speedBtns.forEach(s => {
          const b = document.getElementById(`sim-speed-${s}`);
          if (b) b.classList.remove('active');
        });
        btn.classList.add('active');
        showToast(`Simulation speed set to ${speed}`);
      });
    }
  });
}

// Apply Scenario Preset configurations
function applyPresetScenario(type) {
  document.getElementById('preset-monsoon').classList.remove('active');
  document.getElementById('preset-winter').classList.remove('active');
  document.getElementById('preset-live').classList.remove('active');
  
  if (type === 'monsoon') {
    document.getElementById('preset-monsoon').classList.add('active');
    dayOfYear = 200; // July
    document.getElementById('timeline-slider').value = dayOfYear;
    updateTimelineLabel();
    
    // Switch to Fisherman Dashboard
    switchPerspective('fisherman');
    
    // Enable SST + Chlorophyll Overlays
    activeOverlays.sst = true;
    activeOverlays.chl = true;
    activeOverlays.currents = false;
    activeOverlays.mpa = true;
    
    document.getElementById('layer-sst').classList.add('active');
    document.getElementById('layer-chl').classList.add('active');
    document.getElementById('layer-currents').classList.remove('active');
    document.getElementById('layer-mpa').classList.add('active');

    // Pan map to Kochi region
    map.setView([10.0, 76.0], 9);
    
    showToast("Scenario: July Monsoon Upwelling. Plankton blooms visible.", "green");
  } else if (type === 'winter') {
    document.getElementById('preset-winter').classList.add('active');
    dayOfYear = 350; // December
    document.getElementById('timeline-slider').value = dayOfYear;
    updateTimelineLabel();
    
    // Switch to Conservation Dashboard
    switchPerspective('conservationist');
    
    // Enable MPA only
    activeOverlays.sst = false;
    activeOverlays.chl = false;
    activeOverlays.currents = false;
    activeOverlays.mpa = true;
    
    document.getElementById('layer-sst').classList.remove('active');
    document.getElementById('layer-chl').classList.remove('active');
    document.getElementById('layer-currents').classList.remove('active');
    document.getElementById('layer-mpa').classList.add('active');

    // Pan map to Kadalundi turtle nesting zone (Kozhikode region)
    map.setView([11.15, 75.8], 9);
    
    showToast("Scenario: December Winter Spawning. Olive Ridley nesting protection active.", "green");
  } else if (type === 'live') {
    document.getElementById('preset-live').classList.add('active');
    triggerLiveApiFetch();
  }
}

// Guided Map Tour State Machine
function startTour() {
  tourActive = true;
  tourStep = 0;
  document.getElementById('tour-card').style.display = 'flex';
  showTourStep();
  showToast("Guided tour started. Follow the highlighted panels.");
}

function endTour() {
  tourActive = false;
  document.getElementById('tour-card').style.display = 'none';
  
  // Clear highlights
  tourSteps.forEach(step => {
    const el = document.getElementById(step.highlightId);
    if (el) el.classList.remove('tour-highlight');
  });
  
  showToast("Guided tour completed.");
}

function showTourStep() {
  if (tourStep < 0 || tourStep >= tourSteps.length) {
    endTour();
    return;
  }
  
  const step = tourSteps[tourStep];
  
  // Update Tour Card text content
  document.getElementById('tour-step-label').textContent = `GUIDED TOUR: STEP ${tourStep + 1}/${tourSteps.length}`;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-description').textContent = step.desc;
  
  // Set button text states
  document.getElementById('tour-prev-btn').disabled = (tourStep === 0);
  document.getElementById('tour-next-btn').textContent = (tourStep === tourSteps.length - 1) ? "Finish" : "Next";
  
  // Manage CSS highlight classes
  tourSteps.forEach((s, idx) => {
    const el = document.getElementById(s.highlightId);
    if (el) {
      if (idx === tourStep) {
        el.classList.add('tour-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        el.classList.remove('tour-highlight');
      }
    }
  });

  // Reposition Tour Overlay relative to target panel
  const targetEl = document.getElementById(step.highlightId);
  const tourCard = document.getElementById('tour-card');
  if (targetEl && tourCard) {
    const rect = targetEl.getBoundingClientRect();
    
    if (step.position === 'bottom') {
      tourCard.style.top = `${rect.bottom + window.scrollY + 12}px`;
      tourCard.style.left = `${rect.left + window.scrollX}px`;
      tourCard.style.bottom = 'auto';
      tourCard.style.right = 'auto';
    } else if (step.position === 'top') {
      tourCard.style.top = 'auto';
      tourCard.style.bottom = `${window.innerHeight - rect.top + 12}px`;
      tourCard.style.left = `${rect.left + window.scrollX}px`;
      tourCard.style.right = 'auto';
    } else if (step.position === 'left') {
      tourCard.style.top = `${rect.top + window.scrollY}px`;
      tourCard.style.left = 'auto';
      tourCard.style.right = `${window.innerWidth - rect.left + 12}px`;
      tourCard.style.bottom = 'auto';
    } else {
      tourCard.style.bottom = '80px';
      tourCard.style.left = '40px';
      tourCard.style.top = 'auto';
      tourCard.style.right = 'auto';
    }
  }
}

function nextTourStep() {
  tourStep++;
  if (tourStep >= tourSteps.length) {
    endTour();
  } else {
    showTourStep();
  }
}

function prevTourStep() {
  tourStep--;
  showTourStep();
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
    updateGrid();
    updateMapLegend();
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
    hoveredCell = cell;
    if (cell) {
      updateTelemetryCard(cell);
      
      // Update hover outline rectangle bounds
      const latStep = (LAT_MAX - LAT_MIN) / 24;
      const lngStep = (LNG_MAX - LNG_MIN) / 18;
      const bounds = [
        [cell.lat - latStep/2, cell.lng - lngStep/2],
        [cell.lat + latStep/2, cell.lng + lngStep/2]
      ];
      hoverOutline.setBounds(bounds);
      if (!map.hasLayer(hoverOutline)) {
        hoverOutline.addTo(map);
      }
      
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
    } else {
      if (map.hasLayer(hoverOutline)) {
        map.removeLayer(hoverOutline);
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
    optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData, dayOfYear);
    vesselProgress = 0; // Reset transit animation
    simFuelBurned = 0;
    
    document.getElementById('route-section').style.display = 'block';
    updateRouteTelemetry();
    
    // Update selected outline bounds
    const latStep = (LAT_MAX - LAT_MIN) / 24;
    const lngStep = (LNG_MAX - LNG_MIN) / 18;
    const bounds = [
      [cell.lat - latStep/2, cell.lng - lngStep/2],
      [cell.lat + latStep/2, cell.lng + lngStep/2]
    ];
    selectedOutline.setBounds(bounds);
    if (!map.hasLayer(selectedOutline)) {
      selectedOutline.addTo(map);
    }

    // Set route coordinates
    const pathCoords = optimizedRoute.path.map(pt => [pt.lat, pt.lng]);
    routePolyline.setLatLngs(pathCoords);
    if (!map.hasLayer(routePolyline)) {
      routePolyline.addTo(map);
    }
    
    if (!map.hasLayer(vesselMarker)) {
      vesselMarker.addTo(map);
    }

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

  // Update timeline to today's date
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const todayDayOfYear = Math.floor(diff / oneDay);
  dayOfYear = todayDayOfYear;
  
  document.getElementById('timeline-slider').value = dayOfYear;
  updateTimelineLabel();

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
      showToast("Live servers uncontactable or blocked by CORS. Running local simulation for today.", 'orange');
    }
    
    updateGrid();
    
    // Update route calculation if a target cell is locked
    if (selectedCell) {
      optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData, dayOfYear);
      updateRouteTelemetry();
    }
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

  if (map.hasLayer(selectedOutline)) map.removeLayer(selectedOutline);
  if (map.hasLayer(routePolyline)) map.removeLayer(routePolyline);
  if (map.hasLayer(vesselMarker)) map.removeLayer(vesselMarker);

  updateGrid();
  updateMapLegend();
  showToast(`Switched perspective: ${mode.toUpperCase()} mode.`);
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

function updateMatsyaAISec(cell, liveForecast = null) {
  if (!cell || cell.isLand) {
    const twinX = document.getElementById('telemetry-twin-x');
    const twinY = document.getElementById('telemetry-twin-y');
    if (twinX) twinX.textContent = '--';
    if (twinY) twinY.textContent = '--';
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
  const twinX = document.getElementById('telemetry-twin-x');
  const twinY = document.getElementById('telemetry-twin-y');
  if (twinX) twinX.textContent = `${proj.xPercent.toFixed(1)}%`;
  if (twinY) twinY.textContent = `${proj.yPercent.toFixed(1)}%`;

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

// Draw mini historical sparkline for hovered grid coordinate (sidebar canvas)
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

// Update route text details with Standard vs Deflected Comparison
function updateRouteTelemetry() {
  if (!optimizedRoute) return;
  const title = document.getElementById('route-title');
  const activePort = FISHING_HARBORS.find(h => h.id === selectedPort);
  title.textContent = `${activePort.name.split(' ')[0]} to Target Grid`;

  // Standard Route (Non-Compliant) Metrics
  document.getElementById('route-std-distance').textContent = `${optimizedRoute.stdDistanceKM} km`;
  document.getElementById('route-std-time').textContent = `${optimizedRoute.stdTimeHours} hrs`;
  const stdStatus = document.getElementById('route-std-status');
  if (optimizedRoute.cutsSpawningBan) {
    stdStatus.textContent = "❌ Cuts Spawning Ban";
    stdStatus.className = "comparison-status status-error";
  } else {
    stdStatus.textContent = "✅ Eco-Compliant";
    stdStatus.className = "comparison-status status-success";
  }

  // Thalassa Route (Optimized Compliant) Metrics
  document.getElementById('route-opt-distance').textContent = `${optimizedRoute.distanceKM} km`;
  document.getElementById('route-opt-time').textContent = `${optimizedRoute.estTimeHours} hrs`;
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
        optimizedRoute = calculateOptimizedRoute(selectedPort, selectedCell, gridData, dayOfYear);
        vesselProgress = 0;
        simFuelBurned = 0;
        document.getElementById('route-section').style.display = 'block';
        updateRouteTelemetry();
        updateTelemetryCard(zone, true);
        
        // Update selected outline bounds
        const latStep = (LAT_MAX - LAT_MIN) / 24;
        const lngStep = (LNG_MAX - LNG_MIN) / 18;
        const bounds = [
          [zone.lat - latStep/2, zone.lng - lngStep/2],
          [zone.lat + latStep/2, zone.lng + lngStep/2]
        ];
        selectedOutline.setBounds(bounds);
        if (!map.hasLayer(selectedOutline)) {
          selectedOutline.addTo(map);
        }

        // Set route coordinates
        const pathCoords = optimizedRoute.path.map(pt => [pt.lat, pt.lng]);
        routePolyline.setLatLngs(pathCoords);
        if (!map.hasLayer(routePolyline)) {
          routePolyline.addTo(map);
        }
        if (!map.hasLayer(vesselMarker)) {
          vesselMarker.addTo(map);
        }

        updateGrid();
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
        
        // Remove selection outlines and routes since it's a sanctuary inspection
        if (map.hasLayer(selectedOutline)) map.removeLayer(selectedOutline);
        if (map.hasLayer(routePolyline)) map.removeLayer(routePolyline);
        if (map.hasLayer(vesselMarker)) map.removeLayer(vesselMarker);
        
        showToast(`Inspecting ecosystem bounds of: ${zone.activeMPA ? zone.activeMPA.name : 'Sensitive Cell'}`);
      });

      container.appendChild(card);
    });
  }
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

// Floating HTML Map Legend Population functions
function updateMapLegend() {
  const title = document.getElementById('legend-title');
  const itemsContainer = document.getElementById('legend-items');
  if (!title || !itemsContainer) return;

  itemsContainer.innerHTML = '';

  if (currentMode === 'fisherman') {
    title.textContent = 'YIELD ANALYSIS LEGEND';

    if (activeOverlays.sst && !activeOverlays.chl) {
      addLegendItem('rgba(239, 108, 0, 0.35)', 'Sea Temp (Warm/High)');
      addLegendItem('rgba(239, 108, 0, 0.1)', 'Sea Temp (Cool/Low)');
    } else if (activeOverlays.chl && !activeOverlays.sst) {
      addLegendItem('rgba(46, 125, 50, 0.35)', 'Chlorophyll (High Food)');
      addLegendItem('rgba(46, 125, 50, 0.1)', 'Chlorophyll (Low Food)');
    } else if (activeOverlays.sst && activeOverlays.chl) {
      addLegendItem('rgba(24, 99, 220, 0.35)', 'Optimal Yield (High)');
      addLegendItem('rgba(24, 99, 220, 0.1)', 'Optimal Yield (Low)');
    } else {
      addLegendItem('rgba(0,0,0,0)', 'No Overlay Active (Map View)');
    }

    if (activeOverlays.currents) {
      addLegendItem('rgba(24, 99, 220, 0.55)', 'Currents Vector Arrow', 'arrow');
    }
    addLegendItem('var(--action-blue)', 'Anchor Fishing Harbors', 'circle');
  } else {
    title.textContent = 'CONSERVATION LEGEND';
    addLegendItem('rgba(179, 0, 0, 0.45)', 'Active Spawning Ban');
    addLegendItem('rgba(255, 119, 89, 0.35)', 'Marine Reserve Buffer');
    addLegendItem('rgba(179, 0, 0, 0.6)', 'Seasonal Spawning Line', 'dotted-line');
    addLegendItem('var(--deep-green)', 'Protected Harbors', 'circle');
  }
}

function addLegendItem(color, text, type = 'box') {
  const container = document.getElementById('legend-items');
  const item = document.createElement('div');
  item.style.display = 'flex';
  item.style.alignItems = 'center';
  item.style.gap = '8px';
  item.style.fontSize = '11px';

  let visualHTML = '';
  if (type === 'circle') {
    visualHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; border: 1px solid white;"></div>`;
  } else if (type === 'arrow') {
    visualHTML = `
      <div style="width: 12px; height: 8px; display: flex; align-items: center; justify-content: center;">
        <svg width="12" height="6" viewBox="0 0 12 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 3H10M10 3L8 1M10 3L8 5" stroke="${color}" stroke-width="1.2"/>
        </svg>
      </div>`;
  } else if (type === 'dotted-line') {
    visualHTML = `<div style="width: 12px; height: 0px; border-top: 1.5px dashed ${color};"></div>`;
  } else {
    visualHTML = `<div style="width: 12px; height: 8px; background: ${color}; border: 1px solid rgba(0,0,0,0.1); border-radius: var(--radius-xs);"></div>`;
  }

  item.innerHTML = `
    ${visualHTML}
    <span style="color: var(--ink);">${text}</span>
  `;
  container.appendChild(item);
}
