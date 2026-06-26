/**
 * Thalassa API Fetch Client
 * Handles real-time queries to INCOIS ERDDAP and Copernicus (CMEMS) API endpoints,
 * with automatic simulated fallbacks for offline testing and zero-friction execution.
 */

import { NetCDFReader } from 'netcdfjs';

// Target bounding box coordinates for Kerala
const LAT_MIN = 8.0;
const LAT_MAX = 12.8;
const LNG_MIN = 74.5;
const LNG_MAX = 77.5;

/**
 * Fetch real-time oceanographic parameters from INCOIS ERDDAP Server
 * Endpoint: https://erddap.incois.gov.in/erddap
 * Dataset: Satellite-derived Daily SST or Chlorophyll
 */
export async function fetchIncoisErddapData(parameter = 'sst', date = null) {
  // Use correct dataset IDs on the INCOIS ERDDAP server:
  // - SST: NOAA_AVHRR_datasets
  // - Chlorophyll: incois_oceansat2_datasets
  const datasetId = parameter === 'sst' 
    ? 'NOAA_AVHRR_datasets' 
    : 'incois_oceansat2_datasets';

  const timeQuery = date ? `(${date})` : `(last)`;
  
  // Construct the coordinate subset dimensions query string
  // Note: NOAA_AVHRR_datasets has depth (0.0) as the second dimension.
  const dimensions = datasetId === 'NOAA_AVHRR_datasets'
    ? `[${timeQuery}][(0.0)][(${LAT_MIN}):(${LAT_MAX})][(${LNG_MIN}):(${LNG_MAX})]`
    : `[${timeQuery}][(${LAT_MIN}):(${LAT_MAX})][(${LNG_MIN}):(${LNG_MAX})]`;

  // Map parameter name to the real column in the dataset
  const realParam = parameter === 'sst' ? 'SST' : 'CHL';

  // URL encode the brackets to prevent strict Tomcat 400 Bad Request exceptions
  const queryStr = `${realParam}${dimensions}`
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/:/g, '%3A');

  // Try the relative proxy URL first (Vite dev proxy)
  const relativeUrl = `/erddap/griddap/${datasetId}.json?${queryStr}`;
  // Fallback to absolute URL if proxy is not configured (will likely hit CORS in browser, but good for raw fetch/node)
  const absoluteUrl = `https://erddap.incois.gov.in/erddap/griddap/${datasetId}.json?${queryStr}`;

  console.log(`[Thalassa API Client] Querying INCOIS ERDDAP (Proxy): ${relativeUrl}`);

  try {
    const response = await fetch(relativeUrl, { 
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const json = await response.json();
    return parseErddapResponse(json, parameter);
  } catch (error) {
    console.warn(`[Thalassa API Client] Proxy request failed, trying absolute URL direct fallback...`);
    try {
      const response = await fetch(absoluteUrl, { 
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const json = await response.json();
      return parseErddapResponse(json, parameter);
    } catch (fallbackError) {
      console.warn(`[Thalassa API Client] Live INCOIS ERDDAP request failed. Falling back to local model. Reason: ${fallbackError.message}`);
      return null; // Signals data_engine to use simulated fallback
    }
  }
}

/**
 * Fetch real-time oceanographic data from Copernicus Marine Service (CMEMS)
 * Note: CMEMS requires authentication and generally runs via Copernicus Marine Toolbox (python).
 * This HTTP client demonstrates the direct Web REST API (CAS/OIDC authenticated).
 */
export async function fetchCopernicusMarineData(parameter = 'currents', token = null) {
  if (!token) {
    console.log(`[Thalassa API Client] No Copernicus authorization token provided. Using simulated model.`);
    return null;
  }

  // Copernicus Marine Geoprocessing REST Endpoint
  const datasetId = parameter === 'currents'
    ? 'GLOBAL_ANALYSISFORECAST_PHY_001_024'
    : 'OCEANCOLOUR_GLO_BGC_L4_NRT';
  
  const queryUrl = `https://marine-api.copernicus.eu/subset/${datasetId}?latMin=${LAT_MIN}&latMax=${LAT_MAX}&lonMin=${LNG_MIN}&lonMax=${LNG_MAX}&param=${parameter}`;

  console.log(`[Thalassa API Client] Querying Copernicus Marine Service API: ${queryUrl}`);

  try {
    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/x-netcdf'
      }
    });

    if (!response.ok) {
      throw new Error(`CMEMS API error: ${response.statusText}`);
    }

    // Since NetCDF binaries are parsed client-side using custom libraries (e.g. netcdfjs),
    // we would return the arrayBuffer here.
    const arrayBuffer = await response.arrayBuffer();
    return arrayBuffer;
  } catch (error) {
    console.warn(`[Thalassa API Client] Copernicus API request failed: ${error.message}`);
    return null;
  }
}

/**
 * Parser for standard ERDDAP JSON response matrices
 */
function parseErddapResponse(json, parameter) {
  try {
    const colNames = json.table.columnNames;
    
    // Find the 0-based indices dynamically based on columnNames
    const latIdx = colNames.findIndex(name => name.toLowerCase() === 'latitude' || name.toLowerCase() === 'lat');
    const lngIdx = colNames.findIndex(name => name.toLowerCase() === 'longitude' || name.toLowerCase() === 'lon' || name.toLowerCase() === 'lng');
    const valIdx = colNames.findIndex(name => name.toLowerCase() === parameter.toLowerCase() || name === 'SST' || name === 'CHL' || name === 'sst' || name === 'chl');

    if (latIdx === -1 || lngIdx === -1 || valIdx === -1) {
      throw new Error(`Could not find required columns in ERDDAP response. Found: ${colNames.join(', ')}`);
    }

    const rows = json.table.rows;
    const gridPoints = [];

    for (const row of rows) {
      const val = parseFloat(row[valIdx]);
      // Skip null/NaN/0 placeholder values (e.g. land grid cells)
      if (row[valIdx] !== null && !isNaN(val)) {
        gridPoints.push({
          lat: parseFloat(row[latIdx]),
          lng: parseFloat(row[lngIdx]),
          value: val
        });
      }
    }
    
    return {
      source: 'INCOIS ERDDAP',
      parameter: parameter,
      timestamp: new Date().toISOString(),
      points: gridPoints
    };
  } catch (err) {
    console.error(`[Thalassa API Client] Failed to parse ERDDAP response format:`, err);
    return null;
  }
}

/**
 * Fetch real-time weather and marine forecasts from Open-Meteo API
 * for a specific latitude and longitude coordinate.
 */
export async function fetchOpenMeteoForecast(lat, lng) {
  // Construct endpoints
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height,wave_period`;

  console.log(`[Thalassa API Client] Querying Open-Meteo at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);

  try {
    const [weatherRes, marineRes] = await Promise.all([
      fetch(weatherUrl).then(res => res.ok ? res.json() : null).catch(() => null),
      fetch(marineUrl).then(res => res.ok ? res.json() : null).catch(() => null)
    ]);

    const windSpeed = weatherRes?.current?.wind_speed_10m ?? null;
    const windDir = weatherRes?.current?.wind_direction_10m ?? null;
    const windUnit = weatherRes?.current_units?.wind_speed_10m ?? 'km/h';

    const waveHeight = marineRes?.current?.wave_height ?? null;
    const wavePeriod = marineRes?.current?.wave_period ?? null;
    const waveUnit = marineRes?.current_units?.wave_height ?? 'm';

    return {
      windSpeed,
      windDir,
      windUnit,
      waveHeight,
      wavePeriod,
      waveUnit
    };
  } catch (error) {
    console.warn(`[Thalassa API Client] Open-Meteo query failed: ${error.message}`);
    return null;
  }
}

/**
 * Parse Copernicus NetCDF ArrayBuffer binary payload client-side
 */
export function parseNetCdfBuffer(arrayBuffer) {
  try {
    const reader = new NetCDFReader(arrayBuffer);
    
    // Attempt to locate latitude and longitude
    const latVarName = reader.variables.find(v => v.name === 'latitude' || v.name === 'lat')?.name;
    const lonVarName = reader.variables.find(v => v.name === 'longitude' || v.name === 'lon')?.name;
    
    if (!latVarName || !lonVarName) {
      throw new Error("Could not find latitude or longitude variables in NetCDF binary.");
    }
    
    const lats = reader.getDataVariable(latVarName);
    const lons = reader.getDataVariable(lonVarName);
    
    // Find target data variable (SST or Chlorophyll or Current components)
    const sstVarName = reader.variables.find(v => v.name === 'thetao' || v.name === 'sst')?.name;
    const chlVarName = reader.variables.find(v => v.name === 'chlor_a' || v.name === 'chl')?.name;
    const uoVarName = reader.variables.find(v => v.name === 'uo')?.name;
    const voVarName = reader.variables.find(v => v.name === 'vo')?.name;
    
    const points = [];
    
    // Check if we have uo/vo currents or scalar values
    if (uoVarName && voVarName) {
      const uoData = reader.getDataVariable(uoVarName);
      const voData = reader.getDataVariable(voVarName);
      
      for (let i = 0; i < lats.length; i++) {
        for (let j = 0; j < lons.length; j++) {
          const flatIdx = (i * lons.length + j) % uoData.length;
          const u = uoData[flatIdx] ?? 0;
          const v = voData[flatIdx] ?? 0;
          const speed = Math.sqrt(u * u + v * v);
          const dir = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
          
          points.push({
            lat: lats[i],
            lng: lons[j],
            speed: parseFloat(speed.toFixed(2)),
            dir: Math.round(dir)
          });
        }
      }
      return { source: 'Copernicus CMEMS currents', type: 'vector', points };
    }
    
    const scalarVarName = sstVarName || chlVarName;
    if (scalarVarName) {
      const data = reader.getDataVariable(scalarVarName);
      
      for (let i = 0; i < lats.length; i++) {
        for (let j = 0; j < lons.length; j++) {
          const flatIdx = (i * lons.length + j) % data.length;
          const val = data[flatIdx];
          
          if (val !== undefined && !isNaN(val)) {
            points.push({
              lat: lats[i],
              lng: lons[j],
              value: parseFloat(val.toFixed(2))
            });
          }
        }
      }
      return { 
        source: sstVarName ? 'Copernicus CMEMS SST' : 'Copernicus CMEMS Chlorophyll', 
        parameter: sstVarName ? 'sst' : 'chlorophyll', 
        points 
      };
    }
    
    return null;
  } catch (error) {
    console.error(`[Thalassa NetCDF Parser] Error parsing NetCDF arrayBuffer:`, error);
    return null;
  }
}
