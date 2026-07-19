/**
 * Thalassa Data Simulation and Analysis Engine
 * Calculates Fishing Favorability and Conservation Sensitivity grid matrices.
 */

import { 
  KERALA_COASTLINE, 
  FISHING_HARBORS, 
  CONSERVATION_ZONES, 
  DISTRICT_CATCH_DATA, 
  SPECIES_SPAWNING_CALENDAR 
} from '../data/kerala_spatial.js';

// Coordinates bounding box for Kerala coast grid
const LAT_MIN = 8.0;
const LAT_MAX = 12.8;
const LNG_MIN = 74.5;
const LNG_MAX = 77.5;

// Grid size configuration
const GRID_ROWS = 48;
const GRID_COLS = 36;

/**
 * Determine if a point is inside a polygon using ray-casting algorithm
 */
export function isPointInPolygon(point, polygon) {
  let x = point.lng, y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].lng, yi = polygon[i].lat;
    let xj = polygon[j].lng, yj = polygon[j].lat;
    
    let intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Find distance in kilometers between two lat/lon coordinates
 */
export function getDistanceKM(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Main Grid Generator
 * Generates the unified spatial grid for a specific date (day of year)
 * Optionally incorporates live API data if available.
 */
export function generateDigitalTwinGrid(dayOfYear, liveData = null, forecastHours = 0) {
  const grid = [];
  const latStep = (LAT_MAX - LAT_MIN) / GRID_ROWS;
  const lngStep = (LNG_MAX - LNG_MIN) / GRID_COLS;
  
  // Current month (approximate based on day of year 1-365)
  const currentMonth = Math.floor((dayOfYear / 365) * 12) + 1;

  // Forecast drift parameters
  const forecastDays = forecastHours / 24;
  const sstDrift = forecastDays * 0.3; // °C per day warming/cooling trend
  const chlLatDrift = forecastDays * 0.08; // degrees south-east bloom drift
  const chlLngDrift = forecastDays * 0.05;

  for (let r = 0; r < GRID_ROWS; r++) {
    const lat = LAT_MAX - (r * latStep) - (latStep / 2);
    
    for (let c = 0; c < GRID_COLS; c++) {
      const lng = LNG_MIN + (c * lngStep) + (lngStep / 2);
      const point = { lat, lng };

      // 1. Calculate distance to coastline (to simulate shelf vs deep water)
      let minDistanceToCoast = Infinity;
      let nearestCoastPoint = null;
      for (const cpt of KERALA_COASTLINE) {
        const dist = getDistanceKM(lat, lng, cpt.lat, cpt.lng);
        if (dist < minDistanceToCoast) {
          minDistanceToCoast = dist;
          nearestCoastPoint = cpt;
        }
      }

      // Check if point is on land or too far out in the deep ocean (off shelf)
      // Kerala continental shelf extends roughly 40-80 km out
      const isLand = lng > (nearestCoastPoint ? nearestCoastPoint.lng : 76.5) + 0.05;
      const isDeepOcean = minDistanceToCoast > 120;

      // 2. Synthesize/Simulate Oceanographic Parameters (SST, Chlorophyll, Currents)
      let sst = 28.0;
      let chlorophyll = 1.2;
      let currentSpeed = 0.4;
      let currentDir = 180; // Degrees

      if (liveData && liveData.sst && liveData.sst.points) {
        // Interpolate from live data if present
        const matched = findNearestLivePoint(point, liveData.sst.points);
        if (matched) sst = matched.value;
      } else {
        // SST seasonal simulation (peaks in April-May, drops in monsoon July-August)
        const seasonalSstDiff = 2.5 * Math.sin((dayOfYear - 100) * (2 * Math.PI / 365));
        // Add spatial gradient (warmer near coast, cooler offshore)
        const coastalCooling = 0.5 * Math.sin(minDistanceToCoast / 10);
        sst = 27.5 + seasonalSstDiff - coastalCooling + (Math.sin(lat * 5) * 0.3);
        // Apply forecast drift
        if (forecastHours > 0) {
          sst += sstDrift * Math.sin((lat - 10) * 2);
        }
      }

      if (liveData && liveData.chlorophyll && liveData.chlorophyll.points) {
        const matched = findNearestLivePoint(point, liveData.chlorophyll.points);
        if (matched) chlorophyll = matched.value;
      } else {
        // Chlorophyll-a simulation (spikes during monsoon upwelling in July-September)
        const seasonalChlDiff = 2.0 * Math.max(0, Math.sin((dayOfYear - 170) * (2 * Math.PI / 365)));
        // Much higher concentration closer to the coast (nutrient runoff)
        const coastalChlFactor = Math.max(0.2, 5.0 / (minDistanceToCoast + 1));
        chlorophyll = 0.3 + seasonalChlDiff * coastalChlFactor + (Math.cos(lng * 8) * 0.1);
        // Apply forecast chlorophyll bloom drift (migrates south-east with currents)
        if (forecastHours > 0) {
          const driftedLat = lat - chlLatDrift;
          const driftedLng = lng + chlLngDrift;
          chlorophyll *= (1 + 0.15 * Math.sin(driftedLat * 6) * forecastDays);
          chlorophyll = Math.max(0.1, chlorophyll);
        }
      }

      // Current vectors (simulating typical monsoon currents flowing south, and winter flowing north)
      const currentSeasonalAngle = dayOfYear > 150 && dayOfYear < 270 ? 170 : 350; // South during monsoon, north during post-monsoon
      currentSpeed = 0.2 + 0.6 * Math.max(0, Math.sin((dayOfYear - 160) * (2 * Math.PI / 365))) + (Math.sin(lat * 3) * 0.1);
      currentDir = (currentSeasonalAngle + Math.sin(lng * 10) * 15) % 360;

      // 3. Evaluate Conservation Sensitivity
      let conservationScore = 0;
      let isRestrictedZone = false;
      let activeMPA = null;
      let sensitivityReasons = [];

      // Check if grid cell overlaps any defined conservation zone
      for (const zone of CONSERVATION_ZONES) {
        if (isPointInPolygon(point, zone.polygon)) {
          activeMPA = zone;
          // Check if seasonal restrictions apply this month
          if (zone.restrictedMonths.includes(currentMonth)) {
            isRestrictedZone = true;
            sensitivityReasons.push(`${zone.name}: Spawning Ban Period`);
            conservationScore += zone.severityLevel === 'high' ? 60 : 40;
          } else {
            conservationScore += zone.severityLevel === 'high' ? 30 : 15;
            sensitivityReasons.push(`${zone.name}: Protected Habitat Buffer`);
          }
        }
      }

      // Check for spawning schedules of key commercial species
      for (const species of SPECIES_SPAWNING_CALENDAR) {
        if (species.months.includes(currentMonth)) {
          // If SST is optimal for spawning, elevate vulnerability
          if (sst >= species.minSST && sst <= species.maxSST) {
            conservationScore += 10;
            if (sensitivityReasons.length < 3) {
              sensitivityReasons.push(`Active Spawning: ${species.name.split(' (')[0]}`);
            }
          }
        }
      }

      // Overlay historical fishing catch pressure (higher pressure increases sensitivity to collapse)
      let nearestDistrict = null;
      let minDistrictDist = Infinity;
      for (const dist of DISTRICT_CATCH_DATA) {
        // Approximate district coordinates by matching closest coastline points
        const cpt = KERALA_COASTLINE.find(c => c.lat.toFixed(1) === (lat).toFixed(1));
        if (cpt) nearestDistrict = dist;
      }
      if (nearestDistrict) {
        const pressureWeight = nearestDistrict.historicalOverfishingIndex * 20;
        conservationScore += pressureWeight;
        if (nearestDistrict.historicalOverfishingIndex > 0.75) {
          sensitivityReasons.push(`High Historical Catch Pressure (${nearestDistrict.district})`);
        }
      }

      // Normalize conservation sensitivity score to 0-100
      conservationScore = Math.min(100, Math.max(0, isLand ? 0 : Math.round(conservationScore)));

      // 4. Evaluate Fishing Favorability Score
      let fishingScore = 0;
      let favorabilityReasons = [];

      if (!isLand && !isDeepOcean) {
        // Optimal SST ranges for pelagic fish (Sardines, Mackerel) is 26.5°C to 29.5°C
        const sstDiff = Math.abs(sst - 28.0);
        let sstFactor = Math.max(0, 1 - (sstDiff / 2.0)); // 1.0 at 28C, drops to 0 at 26C or 30C
        
        // Chlorophyll factor (primary production indicator)
        // Optimal range is 1.0 - 4.0 mg/m3. Too low = no food; too high = eutrophic / low oxygen
        let chlFactor = 0;
        if (chlorophyll >= 0.8 && chlorophyll <= 4.5) {
          chlFactor = 1.0;
        } else if (chlorophyll > 4.5) {
          chlFactor = 0.5; // Algal bloom / hypoxia potential
        } else {
          chlFactor = chlorophyll / 0.8;
        }

        // Currents speed factor (fish group in milder currents, avoid strong shear currents)
        let currentFactor = Math.max(0, 1 - (currentSpeed / 1.5));

        // Combined Formula
        fishingScore = (sstFactor * 0.4 + chlFactor * 0.4 + currentFactor * 0.2) * 100;
        
        // Contextual reasons
        if (sstFactor > 0.8) favorabilityReasons.push("Optimal Sea Surface Temperature");
        if (chlFactor > 0.8) favorabilityReasons.push("High Primary Food Availability (Chlorophyll)");
        if (currentSpeed < 0.5) favorabilityReasons.push("Mild Current Conditions");
        
        // If it's a restricted conservation zone during spawning ban, crash its favorability
        if (isRestrictedZone) {
          fishingScore = fishingScore * 0.15; // Reduce by 85%
        }
      }

      fishingScore = Math.min(100, Math.max(0, isLand ? 0 : Math.round(fishingScore)));

      // Calculate Matsya AI Risk & Advisory parameters
      const matsyaAI = calculateMatsyaAIParams({
        sst,
        minDistanceToCoast,
        isRestrictedZone,
        activeMPA,
        conservationScore,
        fishingScore,
        isDeepOcean
      }, dayOfYear);

      grid.push({
        row: r,
        col: c,
        lat,
        lng,
        isLand,
        isDeepOcean,
        sst: isLand ? 0 : parseFloat(sst.toFixed(2)),
        chlorophyll: isLand ? 0 : parseFloat(chlorophyll.toFixed(2)),
        currentSpeed: isLand ? 0 : parseFloat(currentSpeed.toFixed(2)),
        currentDir: isLand ? 0 : Math.round(currentDir),
        fishingScore,
        conservationScore,
        isRestrictedZone,
        activeMPA,
        sensitivityReasons,
        favorabilityReasons,
        minDistanceToCoast: parseFloat(minDistanceToCoast.toFixed(1)),
        // Matsya AI core fields
        rEco: matsyaAI.rEco,
        riskLevel: matsyaAI.riskLevel,
        advisoryLevel: matsyaAI.advisoryLevel,
        eRisk: matsyaAI.eRisk,
        bRisk: matsyaAI.bRisk,
        oRisk: matsyaAI.oRisk,
        aRisk: matsyaAI.aRisk,
        vRisk: matsyaAI.vRisk,
        waveHeight: parseFloat(matsyaAI.waveHeight.toFixed(2)),
        windSpeed: parseFloat(matsyaAI.windSpeed.toFixed(1))
      });
    }
  }

  return grid;
}

/**
 * Matsya Engine AI Core parameter calculator
 * Synthesizes the Weighted Ecological Risk Score (R_eco) and Fishing Advisory Level.
 */
export function calculateMatsyaAIParams(cell, dayOfYear) {
  if (!cell || cell.isLand) {
    return {
      rEco: 0,
      riskLevel: 'Low',
      advisoryLevel: 'Recommended',
      eRisk: 0,
      bRisk: 0,
      oRisk: 0,
      aRisk: 0,
      vRisk: 0,
      waveHeight: 0,
      windSpeed: 0
    };
  }

  // 1. Ecosystem Stability Risk (E_risk) = 100 - H_health_score
  const healthScore = Math.max(0, Math.min(100, Math.round(
    85 - (cell.minDistanceToCoast < 30 ? (30 - cell.minDistanceToCoast) * 0.8 : 0) - (cell.isRestrictedZone ? 5 : 0)
  )));
  const eRisk = 100 - healthScore;

  // 2. Biodiversity Risk (B_risk) = 100 - BHI
  const BHI = Math.max(0, Math.min(100, Math.round(
    80 + (cell.activeMPA ? 12 : 0) - (cell.conservationScore > 50 ? 10 : 0)
  )));
  const bRisk = 100 - BHI;

  // 3. Oceanographic Condition Risk (O_risk)
  // O_risk = clip(0, 100, delta_T_sst * 10 + delta_H_wave * 15)
  const seasonalWave = 1.2 + 2.0 * Math.max(0, Math.sin((dayOfYear - 150) * (2 * Math.PI / 365)));
  const waveHeight = cell.isDeepOcean ? seasonalWave + 0.8 : seasonalWave;

  const deltaT = Math.max(0, cell.sst - 28.0);
  const deltaH = Math.max(0, waveHeight - 2.0);
  const oRisk = Math.max(0, Math.min(100, Math.round(deltaT * 10 + deltaH * 15)));

  // 4. Alert Incident Density Risk (A_risk) = min(100, N_critical_alerts * 25)
  let nCriticalAlerts = 0;
  if (waveHeight > 3.0) nCriticalAlerts += 2;
  else if (waveHeight > 2.0) nCriticalAlerts += 1;
  if (cell.isRestrictedZone) nCriticalAlerts += 1;
  const aRisk = Math.min(100, nCriticalAlerts * 25);

  // 5. Vessel Compliance Risk (V_risk) = min(100, N_non_compliant / N_total * 100)
  const totalVessels = cell.isRestrictedZone ? 6 : (cell.minDistanceToCoast < 40 ? 10 : 3);
  const nonCompliant = cell.isRestrictedZone ? 2 : 1;
  const vRisk = totalVessels > 0 ? Math.min(100, Math.round((nonCompliant / totalVessels) * 100)) : 0;

  // R_eco Weighted Calculation
  const rEco = Math.round(0.30 * eRisk + 0.25 * bRisk + 0.20 * oRisk + 0.15 * aRisk + 0.10 * vRisk);

  // Risk Classification
  let riskLevel = 'Low';
  if (rEco > 75) riskLevel = 'Critical';
  else if (rEco > 50) riskLevel = 'High';
  else if (rEco > 25) riskLevel = 'Moderate';

  // Fishing Advisory Engine
  // Wind Speed simulation (knots)
  const baseWind = 12 + 15 * Math.max(0, Math.sin((dayOfYear - 140) * (2 * Math.PI / 365)));
  const windSpeed = cell.isDeepOcean ? baseWind + 6 : baseWind;

  let advisoryLevel = 'Recommended';
  if (waveHeight > 4.0 || windSpeed > 30 || aRisk > 50) {
    advisoryLevel = 'Avoid';
  } else if (waveHeight > 2.5 || windSpeed > 20 || cell.fishingScore < 40) {
    advisoryLevel = 'Caution';
  }

  return {
    rEco,
    riskLevel,
    advisoryLevel,
    eRisk,
    bRisk,
    oRisk,
    aRisk,
    vRisk,
    waveHeight,
    windSpeed
  };
}

/**
 * Mathematical spatial projection formula from global telemetry (Lat/Lng)
 * to 2D canvas coordinates using linear spatial normalization.
 * Western Longitude (lambda_min) = 72.0E, Eastern Longitude (lambda_max) = 76.0E
 * Southern Latitude (phi_min) = 14.0N, Northern Latitude (phi_max) = 20.0N
 */
export function projectTelemetryToPercent(lat, lng) {
  const lambdaMin = LNG_MIN;
  const lambdaMax = LNG_MAX;
  const phiMin = LAT_MIN;
  const phiMax = LAT_MAX;

  const xPercent = ((lng - lambdaMin) / (lambdaMax - lambdaMin)) * 100;
  const yPercent = 100 - (((lat - phiMin) / (phiMax - phiMin)) * 100);

  return {
    xPercent: parseFloat(xPercent.toFixed(2)),
    yPercent: parseFloat(yPercent.toFixed(2))
  };
}

/**
 * Route Optimization Engine
 * Calculates the best fishing path from a port to high-scoring fishing zones,
 * avoiding restricted conservation zones.
 */
export function calculateOptimizedRoute(portId, targetCell, grid, dayOfYear = 175) {
  const port = FISHING_HARBORS.find(h => h.id === portId);
  if (!port || !targetCell) return null;

  const currentMonth = Math.floor((dayOfYear / 365) * 12) + 1;
  const steps = 12;
  const startLat = port.lat;
  const startLng = port.lng;
  const endLat = targetCell.lat;
  const endLng = targetCell.lng;

  // 1. Calculate Standard Route (Straight Path & Ban Violations)
  const stdPath = [];
  let cutsSpawningBan = false;

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const pt = {
      lat: startLat + (endLat - startLat) * ratio,
      lng: startLng + (endLng - startLng) * ratio
    };
    stdPath.push(pt);

    // Check if this point crosses any active conservation ban
    for (const zone of CONSERVATION_ZONES) {
      if (zone.restrictedMonths.includes(currentMonth) && isPointInPolygon(pt, zone.polygon)) {
        cutsSpawningBan = true;
      }
    }
  }

  let stdDist = 0;
  for (let i = 0; i < stdPath.length - 1; i++) {
    stdDist += getDistanceKM(stdPath[i].lat, stdPath[i].lng, stdPath[i+1].lat, stdPath[i+1].lng);
  }

  // 2. Find the closest grid cell to the starting port
  let startCell = null;
  let minStartDist = Infinity;
  for (const cell of grid) {
    if (cell.isLand) continue;
    const dist = getDistanceKM(startLat, startLng, cell.lat, cell.lng);
    if (dist < minStartDist) {
      minStartDist = dist;
      startCell = cell;
    }
  }

  let path = null;
  if (startCell) {
    path = findAStarPath(startCell, targetCell, grid);
  }

  if (path && path.length > 1) {
    // Snap exact start and end coordinates
    path[0] = { lat: startLat, lng: startLng };
    path[path.length - 1] = { lat: endLat, lng: endLng };
    // Resample path to exactly 15 points for smooth vessel animation
    path = resamplePath(path, 15);
  } else {
    // Fallback: simple deflection-based path
    path = [];
    path.push({ lat: startLat, lng: startLng });
    for (let i = 1; i < steps; i++) {
      const ratio = i / steps;
      let intermediateLat = startLat + (endLat - startLat) * ratio;
      let intermediateLng = startLng + (endLng - startLng) * ratio;
      for (const zone of CONSERVATION_ZONES) {
        if (isPointInPolygon({ lat: intermediateLat, lng: intermediateLng }, zone.polygon)) {
          intermediateLng -= 0.18; // Deflect seaward
        }
      }
      path.push({ lat: intermediateLat, lng: intermediateLng });
    }
    path.push({ lat: endLat, lng: endLng });
  }

  // Calculate total path distance
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDist += getDistanceKM(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
  }

  return {
    portName: port.name,
    targetCell: { lat: endLat, lng: endLng },
    path: path,
    distanceKM: Math.round(totalDist),
    estTimeHours: parseFloat((totalDist / 18).toFixed(1)), // Estimating 18 km/h vessel speed
    stdDistanceKM: Math.round(stdDist),
    stdTimeHours: parseFloat((stdDist / 18).toFixed(1)),
    cutsSpawningBan: cutsSpawningBan
  };
}

/**
 * Standard A* Pathfinding Algorithm on 2D grid
 */
function findAStarPath(startCell, targetCell, grid) {
  // Build a 2D lookup map by [row][col]
  const gridMap = {};
  for (const cell of grid) {
    if (!gridMap[cell.row]) gridMap[cell.row] = {};
    gridMap[cell.row][cell.col] = cell;
  }

  const openSet = [startCell];
  const closedSet = new Set();
  const cameFrom = new Map();

  const gScore = new Map();
  const fScore = new Map();

  const cellKey = (cell) => `${cell.row}_${cell.col}`;

  gScore.set(cellKey(startCell), 0);
  fScore.set(cellKey(startCell), getDistanceKM(startCell.lat, startCell.lng, targetCell.lat, targetCell.lng));

  while (openSet.length > 0) {
    // Find node with lowest fScore
    let current = openSet[0];
    let currentF = fScore.get(cellKey(current)) ?? Infinity;
    let currentIdx = 0;

    for (let i = 1; i < openSet.length; i++) {
      const f = fScore.get(cellKey(openSet[i])) ?? Infinity;
      if (f < currentF) {
        current = openSet[i];
        currentF = f;
        currentIdx = i;
      }
    }

    // Check if reached destination cell
    if (current.row === targetCell.row && current.col === targetCell.col) {
      const path = [];
      let curr = current;
      while (curr) {
        path.push({ lat: curr.lat, lng: curr.lng });
        curr = cameFrom.get(cellKey(curr));
      }
      return path.reverse();
    }

    openSet.splice(currentIdx, 1);
    closedSet.add(cellKey(current));

    // Get 8-directional neighbors
    const neighbors = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = current.row + dr;
        const nc = current.col + dc;
        if (gridMap[nr] && gridMap[nr][nc]) {
          neighbors.push(gridMap[nr][nc]);
        }
      }
    }

    for (const neighbor of neighbors) {
      const neighborKey = cellKey(neighbor);
      if (closedSet.has(neighborKey)) continue;
      if (neighbor.isLand) continue; // Walled off by land

      // Traversal cost factors (highly penalize restricted / sensitive zones)
      let costMultiplier = 1.0;
      if (neighbor.isRestrictedZone) {
        costMultiplier = 15.0; // Strictly avoid spawning bans
      } else if (neighbor.conservationScore > 30) {
        costMultiplier = 1.5 + (neighbor.conservationScore / 50.0);
      }

      // Add small penalty for diagonal movement to keep routes cleaner
      const isDiagonal = (neighbor.row !== current.row) && (neighbor.col !== current.col);
      const moveCost = getDistanceKM(current.lat, current.lng, neighbor.lat, neighbor.lng) * (isDiagonal ? 1.414 : 1.0);
      
      const tentativeG = (gScore.get(cellKey(current)) ?? Infinity) + moveCost * costMultiplier;

      if (!openSet.some(n => cellKey(n) === neighborKey)) {
        openSet.push(neighbor);
      } else if (tentativeG >= (gScore.get(neighborKey) ?? Infinity)) {
        continue;
      }

      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentativeG);
      fScore.set(neighborKey, tentativeG + getDistanceKM(neighbor.lat, neighbor.lng, targetCell.lat, targetCell.lng));
    }
  }

  return null; // Path not found
}

/**
 * Resamples a path of coordinate points to exactly N evenly spaced coordinates
 */
function resamplePath(points, numPoints = 15) {
  if (!points || points.length === 0) return [];
  if (points.length === 1) return Array(numPoints).fill(points[0]);

  const distances = [0];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = getDistanceKM(points[i].lat, points[i].lng, points[i+1].lat, points[i+1].lng);
    totalLength += dist;
    distances.push(totalLength);
  }

  const resampled = [];
  for (let i = 0; i < numPoints; i++) {
    const targetDist = (i / (numPoints - 1)) * totalLength;
    let segIdx = 0;
    while (segIdx < distances.length - 1 && distances[segIdx + 1] < targetDist) {
      segIdx++;
    }
    const d1 = distances[segIdx];
    const d2 = distances[segIdx + 1];
    const p1 = points[segIdx];
    const p2 = points[segIdx + 1];
    const t = d2 === d1 ? 0 : (targetDist - d1) / (d2 - d1);
    resampled.push({
      lat: p1.lat + (p2.lat - p1.lat) * t,
      lng: p1.lng + (p2.lng - p1.lng) * t
    });
  }
  return resampled;
}

/**
 * Helper to find nearest coordinate in live API datasets
 */
function findNearestLivePoint(point, points) {
  let nearest = null;
  let minDistance = Infinity;
  for (const pt of points) {
    const dist = getDistanceKM(point.lat, point.lng, pt.lat, pt.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = pt;
    }
  }
  return minDistance < 50 ? nearest : null;
}
