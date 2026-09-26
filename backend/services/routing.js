const { 
  ROUTING_CONSTANTS, 
  getSafetyLevelInfo 
} = require('../config/hazard-config');

const { 
  calculateDistanceKm, 
  calculateSegmentHazardScore, 
  evaluatePathSafety 
} = require('./hazard-scoring');

/**
 * Min-Heap Priority Queue for Dijkstra algorithm
 */
class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  push(val, priority) {
    this.heap.push({ val, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._sinkDown(0);
    }
    return top.val;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.heap[i].priority < this.heap[p].priority) {
        [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
        i = p;
      } else break;
    }
  }

  _sinkDown(i) {
    const len = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }
}

/**
 * Snap arbitrary coordinate to nearest real road on OpenStreetMap using OSRM
 */
async function snapToNearestRoad(lat, lon) {
  try {
    const url = `https://router.project-osrm.org/nearest/v1/driving/${lon},${lat}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [lat, lon];

    const data = await response.json();
    if (data.waypoints && data.waypoints.length > 0) {
      const loc = data.waypoints[0].location; // [lon, lat]
      return [loc[1], loc[0]];
    }
  } catch (err) {
    console.warn('OSRM nearest road snap failed:', err.message);
  }
  return [lat, lon];
}

/**
 * Fetch real driving route polylines from OSRM
 */
async function fetchOSRMRoute(startLat, startLon, endLat, endLon, viaLat = null, viaLon = null) {
  try {
    let url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};`;
    if (viaLat !== null && viaLon !== null) {
      url += `${viaLon},${viaLat};`;
    }
    url += `${endLon},${endLat}?overview=full&geometries=geojson&alternatives=3&steps=true`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    if (!data.routes || data.routes.length === 0) return [];

    return data.routes.map(r => {
      // Convert OSRM [lon, lat] coordinates to [lat, lon]
      return r.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    });
  } catch (err) {
    console.warn('OSRM route fetch failed:', err.message);
    return [];
  }
}

/**
 * Builds a graph from real street route polylines
 */
function buildGraphFromPaths(paths, hazards) {
  const nodes = [];
  const nodeMap = new Map();
  const adjacency = [];

  function getOrCreateNodeId(lat, lon) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (nodeMap.has(key)) return nodeMap.get(key);

    const id = nodes.length;
    nodes.push({ id, lat, lon });
    nodeMap.set(key, id);
    adjacency.push([]);
    return id;
  }

  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const uId = getOrCreateNodeId(path[i][0], path[i][1]);
      const vId = getOrCreateNodeId(path[i + 1][0], path[i + 1][1]);

      if (uId === vId) continue;

      const seg = calculateSegmentHazardScore(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], hazards);

      // Add bidirectional street edges
      adjacency[uId].push({ to: vId, distKm: seg.lengthKm, hazardScore: seg.score });
      adjacency[vId].push({ to: uId, distKm: seg.lengthKm, hazardScore: seg.score });
    }
  }

  return { nodes, adjacency };
}

/**
 * Dijkstra Shortest Path Search on Graph
 */
function runDijkstra(graph, startId, endId, costFn) {
  const { nodes, adjacency } = graph;
  const numNodes = nodes.length;

  if (numNodes === 0) return null;

  const dist = new Array(numNodes).fill(Infinity);
  const parent = new Array(numNodes).fill(-1);
  const pq = new PriorityQueue();

  dist[startId] = 0;
  pq.push(startId, 0);

  while (!pq.isEmpty()) {
    const u = pq.pop();

    if (u === endId) break;

    for (const edge of adjacency[u]) {
      const edgeCost = costFn(edge.distKm, edge.hazardScore);
      const newCost = dist[u] + edgeCost;

      if (newCost < dist[edge.to]) {
        dist[edge.to] = newCost;
        parent[edge.to] = u;
        pq.push(edge.to, newCost);
      }
    }
  }

  if (dist[endId] === Infinity) return null;

  // Reconstruct path along real street nodes
  const path = [];
  let curr = endId;
  while (curr !== -1) {
    path.unshift([nodes[curr].lat, nodes[curr].lon]);
    curr = parent[curr];
  }

  return path;
}

/**
 * Helper to check if two coordinate paths represent substantially the same route
 */
function isSameRoute(c1, c2) {
  if (!c1 || !c2) return false;
  if (c1.length === 0 || c2.length === 0) return false;

  const startDiff = calculateDistanceKm(c1[0][0], c1[0][1], c2[0][0], c2[0][1]);
  const endDiff = calculateDistanceKm(c1[c1.length - 1][0], c1[c1.length - 1][1], c2[c2.length - 1][0], c2[c2.length - 1][1]);
  
  const mid1 = c1[Math.floor(c1.length / 2)];
  const mid2 = c2[Math.floor(c2.length / 2)];
  const midDiff = calculateDistanceKm(mid1[0], mid1[1], mid2[0], mid2[1]);

  return startDiff < 0.05 && endDiff < 0.05 && midDiff < 0.05;
}

/**
 * Main function to generate Fastest, Safest, and Optimal routes on REAL streets
 */
async function generateRoutes(startLat, startLon, endLat, endLon, hazards = []) {
  // Snap start and end to real streets
  const snappedStart = await snapToNearestRoad(startLat, startLon);
  const snappedEnd = await snapToNearestRoad(endLat, endLon);

  const realStartLat = snappedStart[0];
  const realStartLon = snappedStart[1];
  const realEndLat = snappedEnd[0];
  const realEndLon = snappedEnd[1];

  const candidatePaths = [];

  // 1. Fetch direct OSRM real street routes
  const directRoutes = await fetchOSRMRoute(realStartLat, realStartLon, realEndLat, realEndLon);
  candidatePaths.push(...directRoutes);

  // 2. Generate lateral detour waypoints on real streets around hazard areas
  const dLat = realEndLat - realStartLat;
  const dLon = realEndLon - realStartLon;
  const perpLat = -dLon;
  const perpLon = dLat;

  const offsetScales = [0.15, -0.15, 0.35, -0.35, 0.6, -0.6];

  const detourViaPoints = [];
  for (const scale of offsetScales) {
    // Check 1/3, 1/2, and 2/3 waypoints along the route
    for (const t of [0.33, 0.5, 0.67]) {
      const rawLat = realStartLat + t * dLat + scale * perpLat;
      const rawLon = realStartLon + t * dLon + scale * perpLon;

      detourViaPoints.push([rawLat, rawLon]);
    }
  }

  // Snap detour waypoints to real streets and fetch detour routes concurrently
  const detourPromises = detourViaPoints.slice(0, 8).map(async (rawVp) => {
    const snappedVp = await snapToNearestRoad(rawVp[0], rawVp[1]);
    return fetchOSRMRoute(
      realStartLat, realStartLon, 
      realEndLat, realEndLon, 
      snappedVp[0], snappedVp[1]
    );
  });

  const detourResults = await Promise.all(detourPromises);
  detourResults.forEach(routes => candidatePaths.push(...routes));

  // If no OSRM routes were returned, retry direct OSRM fetch once more
  if (candidatePaths.length === 0) {
    const retryDirect = await fetchOSRMRoute(realStartLat, realStartLon, realEndLat, realEndLon);
    candidatePaths.push(...retryDirect);
  }

  // 3. Build street graph from all OSRM real street polylines
  const graph = buildGraphFromPaths(candidatePaths, hazards);

  let startId = 0;
  let endId = graph.nodes.length - 1;

  // Find graph node closest to start and end
  let minStartDist = Infinity;
  let minEndDist = Infinity;

  for (let i = 0; i < graph.nodes.length; i++) {
    const dS = calculateDistanceKm(realStartLat, realStartLon, graph.nodes[i].lat, graph.nodes[i].lon);
    if (dS < minStartDist) {
      minStartDist = dS;
      startId = i;
    }

    const dE = calculateDistanceKm(realEndLat, realEndLon, graph.nodes[i].lat, graph.nodes[i].lon);
    if (dE < minEndDist) {
      minEndDist = dE;
      endId = i;
    }
  }

  // 4. Run Dijkstra on real street graph for each strategy

  // Strategy A: Fastest Route (Minimizes distance / travel time)
  const fastestPathCoords = runDijkstra(graph, startId, endId, (dist, hazard) => dist) || candidatePaths[0] || [[realStartLat, realStartLon], [realEndLat, realEndLon]];

  // Strategy B: Safest Route (Strictly minimizes hazard score)
  const safestPathCoords = runDijkstra(graph, startId, endId, (dist, hazard) => hazard * 1000 + dist) || candidatePaths[1] || fastestPathCoords;

  // Strategy C: Optimal Route (Balances distance and safety score)
  const alpha = ROUTING_CONSTANTS.ALPHA;
  let beta = ROUTING_CONSTANTS.BETA;
  let optimalPathCoords = runDijkstra(graph, startId, endId, (dist, hazard) => alpha * dist + beta * hazard) || candidatePaths[2] || fastestPathCoords;

  // 5. Pareto frontier verification: Ensure Optimal is a genuine intermediate trade-off if distinct paths exist
  const isOptimalSameAsFastest = isSameRoute(optimalPathCoords, fastestPathCoords);
  const isOptimalSameAsSafest = isSameRoute(optimalPathCoords, safestPathCoords);

  if ((isOptimalSameAsFastest || isOptimalSameAsSafest) && !isSameRoute(fastestPathCoords, safestPathCoords)) {
    const testBetas = [0.0002, 0.0005, 0.001, 0.002, 0.004, 0.008, 0.015, 0.03];
    const fastestEvalTest = evaluatePathSafety(fastestPathCoords, hazards);
    const safestEvalTest = evaluatePathSafety(safestPathCoords, hazards);

    let bestIntermediatePath = null;
    let bestTradeoffScore = Infinity;

    for (const testB of testBetas) {
      const testPath = runDijkstra(graph, startId, endId, (dist, hazard) => dist + testB * hazard);
      if (!testPath) continue;

      const evalTest = evaluatePathSafety(testPath, hazards);

      // Check if this route is a true trade-off between Fastest and Safest
      const isIntermediate = 
        evalTest.totalDistanceKm >= fastestEvalTest.totalDistanceKm &&
        evalTest.totalDistanceKm <= safestEvalTest.totalDistanceKm + 0.1 &&
        evalTest.totalHazardScore <= fastestEvalTest.totalHazardScore &&
        evalTest.totalHazardScore >= safestEvalTest.totalHazardScore - 0.1 &&
        !isSameRoute(testPath, fastestPathCoords) &&
        !isSameRoute(testPath, safestPathCoords);

      if (isIntermediate) {
        // Efficiency score: distance + normalized hazard impact
        const tradeoffScore = evalTest.totalDistanceKm + 0.003 * evalTest.totalHazardScore;
        if (tradeoffScore < bestTradeoffScore) {
          bestTradeoffScore = tradeoffScore;
          bestIntermediatePath = testPath;
        }
      }
    }

    if (bestIntermediatePath) {
      optimalPathCoords = bestIntermediatePath;
    }
  }

  // 6. Evaluate safety scores and segment safety colors for each route
  const fastestEval = evaluatePathSafety(fastestPathCoords, hazards);
  const safestEval = evaluatePathSafety(safestPathCoords, hazards);
  const optimalEval = evaluatePathSafety(optimalPathCoords, hazards);

  return {
    fastestRoute: {
      name: 'Fastest Route',
      type: 'fastest',
      coordinates: fastestPathCoords,
      distanceKm: fastestEval.totalDistanceKm,
      hazardScore: fastestEval.totalHazardScore,
      safetyLevel: fastestEval.safetyLevelInfo.level,
      color: '#007bff', // Blue for Fastest
      safetyColor: fastestEval.safetyLevelInfo.color,
      segments: fastestEval.segments
    },
    safestRoute: {
      name: 'Safest Route',
      type: 'safest',
      coordinates: safestPathCoords,
      distanceKm: safestEval.totalDistanceKm,
      hazardScore: safestEval.totalHazardScore,
      safetyLevel: safestEval.safetyLevelInfo.level,
      color: '#28a745', // Green for Safest
      safetyColor: safestEval.safetyLevelInfo.color,
      segments: safestEval.segments
    },
    optimalRoute: {
      name: 'Optimal Route',
      type: 'optimal',
      coordinates: optimalPathCoords,
      distanceKm: optimalEval.totalDistanceKm,
      hazardScore: optimalEval.totalHazardScore,
      safetyLevel: optimalEval.safetyLevelInfo.level,
      color: '#6f42c1', // Purple for Optimal
      safetyColor: optimalEval.safetyLevelInfo.color,
      segments: optimalEval.segments
    },
    constants: {
      alpha: ROUTING_CONSTANTS.ALPHA,
      beta: ROUTING_CONSTANTS.BETA
    }
  };
}

module.exports = {
  generateRoutes,
  fetchOSRMRoute,
  snapToNearestRoad
};
