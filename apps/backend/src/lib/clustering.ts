// Generic DBSCAN over embedding vectors, using cosine SIMILARITY (not
// distance) as the neighborhood metric - lib/commentClustering.ts's own
// domain logic (reaction filtering, cluster labeling) builds on top of this.
// O(n^2) - fine for the few thousand points this codebase clusters at once,
// not meant for vector-DB-scale datasets.

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Returns one cluster id per input vector, same order/index as `vectors` -
// -1 means "noise" (didn't belong to any dense-enough group), otherwise a
// 0-based cluster id. `minSimilarity` is a cosine similarity THRESHOLD
// (0-1, higher = stricter/tighter clusters) and `minPoints` is the minimum
// neighborhood size (including the point itself) for a point to seed/extend
// a cluster - the same two knobs as classic DBSCAN's eps/minPts, just
// expressed as a similarity floor instead of a distance ceiling.
export function dbscanCluster(vectors: number[][], minSimilarity: number, minPoints: number): number[] {
  const n = vectors.length;
  const labels: number[] = new Array(n).fill(-2); // -2 = unvisited, -1 = noise, >=0 = cluster id
  const neighborCache = new Map<number, number[]>();

  function neighborsOf(i: number): number[] {
    const cached = neighborCache.get(i);
    if (cached) return cached;
    const neighbors: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j !== i && cosineSimilarity(vectors[i], vectors[j]) >= minSimilarity) neighbors.push(j);
    }
    neighborCache.set(i, neighbors);
    return neighbors;
  }

  let nextClusterId = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;

    const seedNeighbors = neighborsOf(i);
    if (seedNeighbors.length + 1 < minPoints) {
      labels[i] = -1;
      continue;
    }

    const clusterId = nextClusterId++;
    labels[i] = clusterId;
    const queue = [...seedNeighbors];
    while (queue.length > 0) {
      const j = queue.shift()!;
      if (labels[j] === -1) labels[j] = clusterId;
      if (labels[j] !== -2) continue;
      labels[j] = clusterId;
      const jNeighbors = neighborsOf(j);
      if (jNeighbors.length + 1 >= minPoints) queue.push(...jNeighbors);
    }
  }

  return labels;
}
