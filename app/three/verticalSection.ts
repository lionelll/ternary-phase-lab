import * as THREE from "three";

const INTERSECTION_EPSILON = 1e-5;
const SMOOTH_SAMPLES_PER_SEGMENT = 4;
const CURVE_COMPARE_SAMPLES = 32;
const SHARP_TURN_COSINE = Math.cos(THREE.MathUtils.degToRad(45));

function pointKey(point: THREE.Vector3, epsilon: number) {
  const scale = 1 / epsilon;
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value * scale))
    .join(":");
}

function segmentKey(
  start: THREE.Vector3,
  end: THREE.Vector3,
  epsilon: number,
) {
  const startKey = pointKey(start, epsilon);
  const endKey = pointKey(end, epsilon);
  return startKey < endKey
    ? `${startKey}|${endKey}`
    : `${endKey}|${startKey}`;
}

function addUniquePoint(
  points: THREE.Vector3[],
  candidate: THREE.Vector3,
  epsilon: number,
) {
  const epsilonSquared = epsilon * epsilon;
  if (points.some((point) => point.distanceToSquared(candidate) <= epsilonSquared)) {
    return;
  }
  points.push(candidate.clone());
}

function farthestPair(points: readonly THREE.Vector3[]) {
  let first = points[0];
  let second = points[1];
  let maxDistance = first.distanceToSquared(second);
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const distance = points[i].distanceToSquared(points[j]);
      if (distance > maxDistance) {
        first = points[i];
        second = points[j];
        maxDistance = distance;
      }
    }
  }
  return [first, second] as const;
}

function crossXZ(first: THREE.Vector3, second: THREE.Vector3) {
  return first.x * second.z - first.z * second.x;
}

/**
 * 将由两个成分点定义的底面直线延伸到成分三角形的两侧边界。
 *
 * P1/P2 负责确定截面方向；激光墙与无限裁剪平面都应覆盖该方向在整个
 * 成分三角形内的有效弦段，否则内部点会只生成一块局部着色墙。
 */
export function extendSectionLineToTriangle(
  first: THREE.Vector3,
  second: THREE.Vector3,
  triangle: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  epsilon = INTERSECTION_EPSILON,
) {
  const direction = second.clone().sub(first).setY(0);
  if (direction.lengthSq() <= epsilon * epsilon) {
    throw new Error("垂直截面的两个成分点不能重合");
  }

  const intersections: THREE.Vector3[] = [];
  const addIntersection = (point: THREE.Vector3) => {
    point.y = 0;
    addUniquePoint(intersections, point, epsilon);
  };

  for (let index = 0; index < triangle.length; index += 1) {
    const edgeStart = triangle[index].clone().setY(0);
    const edgeEnd = triangle[(index + 1) % triangle.length].clone().setY(0);
    const edgeDirection = edgeEnd.clone().sub(edgeStart);
    const startOffset = edgeStart.clone().sub(first).setY(0);
    const denominator = crossXZ(direction, edgeDirection);

    if (Math.abs(denominator) <= epsilon) {
      // 截面线与三角形边共线时，整条边就是有效截面范围。
      if (Math.abs(crossXZ(startOffset, direction)) <= epsilon) {
        addIntersection(edgeStart);
        addIntersection(edgeEnd);
      }
      continue;
    }

    const lineProgress = crossXZ(startOffset, edgeDirection) / denominator;
    const edgeProgress = crossXZ(startOffset, direction) / denominator;
    if (edgeProgress < -epsilon || edgeProgress > 1 + epsilon) continue;
    addIntersection(first.clone().addScaledVector(direction, lineProgress));
  }

  if (intersections.length < 2) {
    throw new Error("垂直截面直线未能与成分三角形形成完整交线");
  }
  return farthestPair(intersections);
}

/** 由两个底面成分点构造沿 Y 轴竖直延伸的空间平面。 */
export function makeVerticalSectionPlane(
  first: THREE.Vector3,
  second: THREE.Vector3,
) {
  const direction = second.clone().sub(first).setY(0);
  if (direction.lengthSq() <= INTERSECTION_EPSILON ** 2) {
    throw new Error("垂直截面的两个成分点不能重合");
  }
  const normal = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, first);
}

/** P1-P2 为底边、Y=0~height 的垂直矩形激光切面。 */
export function makeVerticalSectionWallGeometry(
  first: THREE.Vector3,
  second: THREE.Vector3,
  height: number,
) {
  const firstTop = first.clone().setY(height);
  const secondTop = second.clone().setY(height);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        ...first.toArray(),
        ...second.toArray(),
        ...secondTop.toArray(),
        ...firstTop.toArray(),
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type StoredSegment = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  sourceId: number;
};

type GraphEdge = {
  startNode: number;
  endNode: number;
  sourceId: number;
  used: boolean;
};

type GraphNode = {
  point: THREE.Vector3;
  sampleCount: number;
  edgeIndices: number[];
};

type IntersectionGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type IntersectionChain = {
  points: THREE.Vector3[];
  sourceIds: Set<number>;
};

function spatialCellKey(point: THREE.Vector3, cellSize: number) {
  return [point.x, point.y, point.z]
    .map((value) => Math.floor(value / cellSize))
    .join(":");
}

/**
 * 将所有相区的求交端点放入同一空间拓扑图。
 *
 * 端点会在相邻空间桶中查找并吸附到同一个公共节点；边则按公共节点编号去重。
 * 这比逐相区用字符串坐标去重更稳健，也能处理浮点误差落入相邻量化桶的情况。
 */
function buildWeldedIntersectionGraph(
  segments: readonly StoredSegment[],
  snapTolerance: number,
): IntersectionGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const spatialBuckets = new Map<string, number[]>();
  const snapToleranceSquared = snapTolerance * snapTolerance;

  const nodeFor = (point: THREE.Vector3) => {
    const baseX = Math.floor(point.x / snapTolerance);
    const baseY = Math.floor(point.y / snapTolerance);
    const baseZ = Math.floor(point.z / snapTolerance);
    let nearestNodeIndex = -1;
    let nearestDistance = snapToleranceSquared;

    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          const bucket = spatialBuckets.get(
            `${baseX + xOffset}:${baseY + yOffset}:${baseZ + zOffset}`,
          );
          if (!bucket) continue;
          for (const nodeIndex of bucket) {
            const distance = nodes[nodeIndex].point.distanceToSquared(point);
            if (distance <= nearestDistance) {
              nearestDistance = distance;
              nearestNodeIndex = nodeIndex;
            }
          }
        }
      }
    }

    if (nearestNodeIndex >= 0) {
      const node = nodes[nearestNodeIndex];
      node.point
        .multiplyScalar(node.sampleCount)
        .add(point)
        .divideScalar(node.sampleCount + 1);
      node.sampleCount += 1;
      return nearestNodeIndex;
    }

    const nodeIndex = nodes.length;
    nodes.push({ point: point.clone(), sampleCount: 1, edgeIndices: [] });
    const bucketKey = spatialCellKey(point, snapTolerance);
    const bucket = spatialBuckets.get(bucketKey);
    if (bucket) bucket.push(nodeIndex);
    else spatialBuckets.set(bucketKey, [nodeIndex]);
    return nodeIndex;
  };

  for (const segment of segments) {
    const startNode = nodeFor(segment.start);
    const endNode = nodeFor(segment.end);
    if (startNode === endNode) continue;
    const edgeKey =
      startNode < endNode
        ? `${segment.sourceId}:${startNode}:${endNode}`
        : `${segment.sourceId}:${endNode}:${startNode}`;
    if (edgeKeys.has(edgeKey)) continue;
    edgeKeys.add(edgeKey);
    const edgeIndex = edges.length;
    edges.push({
      startNode,
      endNode,
      sourceId: segment.sourceId,
      used: false,
    });
    nodes[startNode].edgeIndices.push(edgeIndex);
    nodes[endNode].edgeIndices.push(edgeIndex);
  }

  return { nodes, edges };
}

/** 将无序短线段按共享端点恢复成端点到端点、分叉点到分叉点的连续曲线链。 */
function buildSegmentChains(graph: IntersectionGraph) {
  const { nodes, edges } = graph;

  const trace = (startNode: number, firstEdgeIndex: number) => {
    const chain = [nodes[startNode].point.clone()];
    let currentNode = startNode;
    let edgeIndex: number | undefined = firstEdgeIndex;
    const sourceId = edges[firstEdgeIndex].sourceId;

    while (edgeIndex !== undefined) {
      const edge: GraphEdge = edges[edgeIndex];
      if (edge.used) break;
      edge.used = true;
      const nextNodeIndex =
        edge.startNode === currentNode ? edge.endNode : edge.startNode;
      const nextNode = nodes[nextNodeIndex];
      chain.push(nextNode.point.clone());
      currentNode = nextNodeIndex;
      const sourceEdges = nextNode.edgeIndices.filter(
        (candidate: number) => edges[candidate].sourceId === sourceId,
      );
      if (sourceEdges.length !== 2) break;
      edgeIndex = sourceEdges.find((candidate: number) => !edges[candidate].used);
    }
    return { points: chain, sourceIds: new Set([sourceId]) };
  };

  const chains: IntersectionChain[] = [];
  // 先从端点和分叉点出发，确保三相交汇等关键拓扑不会被样条跨越。
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    const sourceIds = new Set(
      node.edgeIndices.map((edgeIndex) => edges[edgeIndex].sourceId),
    );
    for (const sourceId of sourceIds) {
      const sourceEdges = node.edgeIndices.filter(
        (edgeIndex) => edges[edgeIndex].sourceId === sourceId,
      );
      if (sourceEdges.length === 2) continue;
      for (const edgeIndex of sourceEdges) {
        if (!edges[edgeIndex].used) chains.push(trace(nodeIndex, edgeIndex));
      }
    }
  }
  // 剩余边只可能属于没有端点的闭合曲线。
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    if (!edges[edgeIndex].used) {
      chains.push(trace(edges[edgeIndex].startNode, edgeIndex));
    }
  }
  return chains;
}

function polylineLength(points: readonly THREE.Vector3[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += points[index - 1].distanceTo(points[index]);
  }
  return length;
}

function resamplePolyline(points: readonly THREE.Vector3[], sampleCount: number) {
  if (points.length <= 1) return points.map((point) => point.clone());
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + points[index - 1].distanceTo(points[index]),
    );
  }
  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength <= INTERSECTION_EPSILON) {
    return Array.from({ length: sampleCount }, () => points[0].clone());
  }

  const samples: THREE.Vector3[] = [];
  let segmentIndex = 1;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const distance = (totalLength * sampleIndex) / (sampleCount - 1);
    while (
      segmentIndex < cumulative.length - 1 &&
      cumulative[segmentIndex] < distance
    ) {
      segmentIndex += 1;
    }
    const startDistance = cumulative[segmentIndex - 1];
    const endDistance = cumulative[segmentIndex];
    const progress =
      endDistance > startDistance
        ? (distance - startDistance) / (endDistance - startDistance)
        : 0;
    samples.push(
      points[segmentIndex - 1].clone().lerp(points[segmentIndex], progress),
    );
  }
  return samples;
}

function alignedCoincidentSamples(
  candidate: readonly THREE.Vector3[],
  existing: readonly THREE.Vector3[],
  tolerance: number,
) {
  const candidateStart = candidate[0];
  const candidateEnd = candidate[candidate.length - 1];
  const existingStart = existing[0];
  const existingEnd = existing[existing.length - 1];
  const forwardEndpoints = Math.max(
    candidateStart.distanceTo(existingStart),
    candidateEnd.distanceTo(existingEnd),
  );
  const reverseEndpoints = Math.max(
    candidateStart.distanceTo(existingEnd),
    candidateEnd.distanceTo(existingStart),
  );
  const reversed = reverseEndpoints < forwardEndpoints;
  if (Math.min(forwardEndpoints, reverseEndpoints) > tolerance * 0.75) {
    return null;
  }

  const candidateSamples = resamplePolyline(candidate, CURVE_COMPARE_SAMPLES);
  if (reversed) candidateSamples.reverse();
  const existingSamples = resamplePolyline(existing, CURVE_COMPARE_SAMPLES);
  let totalDistance = 0;
  let maxDistance = 0;
  for (let index = 0; index < CURVE_COMPARE_SAMPLES; index += 1) {
    const distance = candidateSamples[index].distanceTo(existingSamples[index]);
    totalDistance += distance;
    maxDistance = Math.max(maxDistance, distance);
  }
  const meanDistance = totalDistance / CURVE_COMPARE_SAMPLES;
  const lengthRatio =
    polylineLength(candidate) /
    Math.max(polylineLength(existing), INTERSECTION_EPSILON);
  if (
    meanDistance > tolerance ||
    maxDistance > tolerance * 2.5 ||
    lengthRatio < 0.75 ||
    lengthRatio > 1.33
  ) {
    return null;
  }
  return candidateSamples;
}

/**
 * 合并由相邻相区重复提交的同一条相界线。
 *
 * 各曲线先按弧长统一采样；只有端点、整体走向和全程距离均相近时才焊接，
 * 因而不会误合并液相线/固相线等端点相同但中部明显分离的教学边界。
 */
function mergeCoincidentChains(
  chains: readonly IntersectionChain[],
  tolerance: number,
) {
  const merged: {
    points: THREE.Vector3[];
    sourceCount: number;
    sourceIds: Set<number>;
  }[] = [];
  for (const chain of chains) {
    let target: (typeof merged)[number] | undefined;
    let alignedSamples: THREE.Vector3[] | null = null;
    for (const existing of merged) {
      if (
        [...chain.sourceIds].some((sourceId) =>
          existing.sourceIds.has(sourceId),
        )
      ) {
        continue;
      }
      alignedSamples = alignedCoincidentSamples(
        chain.points,
        existing.points,
        tolerance,
      );
      if (alignedSamples) {
        target = existing;
        break;
      }
    }
    if (!target || !alignedSamples) {
      merged.push({
        points: chain.points.map((point) => point.clone()),
        sourceCount: 1,
        sourceIds: new Set(chain.sourceIds),
      });
      continue;
    }

    const mergeSampleCount = Math.max(
      target.points.length,
      chain.points.length,
    );
    const existingSamples = resamplePolyline(target.points, mergeSampleCount);
    const candidateSamples = resamplePolyline(
      alignedSamples,
      mergeSampleCount,
    );
    target.points = existingSamples.map((point, index) =>
      point
        .multiplyScalar(target.sourceCount)
        .add(candidateSamples[index])
        .divideScalar(target.sourceCount + 1),
    );
    target.sourceCount += 1;
    chain.sourceIds.forEach((sourceId) => target.sourceIds.add(sourceId));
  }
  return merged.map(({ points }) => points);
}

/** 在真实锐角处分段，避免样条把棱柱角、封口线或三角形顶点错误圆滑。 */
function splitChainAtSharpTurns(points: readonly THREE.Vector3[]) {
  if (points.length < 3) return [points.map((point) => point.clone())];
  const pieces: THREE.Vector3[][] = [];
  let pieceStart = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const incoming = points[index].clone().sub(points[index - 1]).normalize();
    const outgoing = points[index + 1].clone().sub(points[index]).normalize();
    if (incoming.dot(outgoing) < SHARP_TURN_COSINE) {
      pieces.push(points.slice(pieceStart, index + 1).map((point) => point.clone()));
      pieceStart = index;
    }
  }
  pieces.push(points.slice(pieceStart).map((point) => point.clone()));
  return pieces.filter((piece) => piece.length >= 2);
}

/** 对连续曲线链做向心三次样条重采样，向心参数化可抑制尖点和回环过冲。 */
function smoothChain(points: readonly THREE.Vector3[], epsilon: number) {
  if (points.length < 4) return points.map((point) => point.clone());
  const closed = points[0].distanceToSquared(points[points.length - 1]) <= epsilon ** 2;
  const controls = (closed ? points.slice(0, -1) : points).map((point) => point.clone());
  if (controls.length < 3) return points.map((point) => point.clone());
  const curve = new THREE.CatmullRomCurve3(controls, closed, "centripetal");
  const sourceSegments = closed ? controls.length : controls.length - 1;
  return curve.getPoints(
    Math.max(sourceSegments * SMOOTH_SAMPLES_PER_SEGMENT, 8),
  );
}

/**
 * 遍历相区三角网格，计算其与空间平面的所有交线段。
 *
 * 对完全落在切面内的三角形，只保留共面片的外边界，避免显示内部三角剖分线；
 * 所有相区共用一张焊接拓扑图，公共节点吸附后再合并走向相同的共享曲线。
 */
export function makePlaneIntersectionGeometry(
  meshes: readonly THREE.Mesh<THREE.BufferGeometry>[],
  plane: THREE.Plane,
  epsilon = INTERSECTION_EPSILON,
  applyWorldTransforms = true,
) {
  const segments: StoredSegment[] = [];
  const triangleVertices = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];

  const storeSegment = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    sourceId: number,
  ) => {
    if (start.distanceToSquared(end) <= epsilon * epsilon) return;
    segments.push({ start: start.clone(), end: end.clone(), sourceId });
  };

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex];
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) continue;
    const index = geometry.getIndex();
    const indexCount = index?.count ?? positions.count;
    const coplanarEdges = new Map<
      string,
      { start: THREE.Vector3; end: THREE.Vector3; count: number }
    >();

    const vertexIndexAt = (offset: number) =>
      index ? index.getX(offset) : offset;
    const worldVertexAt = (triangleOffset: number, target: THREE.Vector3) =>
      target.fromBufferAttribute(positions, vertexIndexAt(triangleOffset));

    const countCoplanarEdge = (start: THREE.Vector3, end: THREE.Vector3) => {
      const key = segmentKey(start, end, epsilon);
      const existing = coplanarEdges.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        coplanarEdges.set(key, {
          start: start.clone(),
          end: end.clone(),
          count: 1,
        });
      }
    };

    for (let offset = 0; offset + 2 < indexCount; offset += 3) {
      worldVertexAt(offset, triangleVertices[0]);
      worldVertexAt(offset + 1, triangleVertices[1]);
      worldVertexAt(offset + 2, triangleVertices[2]);
      if (applyWorldTransforms) {
        triangleVertices.forEach((vertex) => vertex.applyMatrix4(mesh.matrixWorld));
      }
      const distances = triangleVertices.map((point) =>
        plane.distanceToPoint(point),
      );
      const onPlane = distances.map((distance) => Math.abs(distance) <= epsilon);

      if (onPlane.every(Boolean)) {
        countCoplanarEdge(triangleVertices[0], triangleVertices[1]);
        countCoplanarEdge(triangleVertices[1], triangleVertices[2]);
        countCoplanarEdge(triangleVertices[2], triangleVertices[0]);
        continue;
      }

      const intersections: THREE.Vector3[] = [];
      const edges = [
        [0, 1],
        [1, 2],
        [2, 0],
      ] as const;

      for (const [startIndex, endIndex] of edges) {
        const start = triangleVertices[startIndex];
        const end = triangleVertices[endIndex];
        const startDistance = distances[startIndex];
        const endDistance = distances[endIndex];
        const startOnPlane = onPlane[startIndex];
        const endOnPlane = onPlane[endIndex];

        if (startOnPlane) addUniquePoint(intersections, start, epsilon);
        if (endOnPlane) addUniquePoint(intersections, end, epsilon);
        if (startOnPlane || endOnPlane || startDistance * endDistance >= 0) {
          continue;
        }

        const progress = startDistance / (startDistance - endDistance);
        addUniquePoint(
          intersections,
          start.clone().lerp(end, progress),
          epsilon,
        );
      }

      if (intersections.length >= 2) {
        const [start, end] = farthestPair(intersections);
        storeSegment(start, end, meshIndex);
      }
    }

    for (const edge of coplanarEdges.values()) {
      if (edge.count === 1) storeSegment(edge.start, edge.end, meshIndex);
    }
  }

  const linePositions: number[] = [];
  const bounds = new THREE.Box3();
  const segmentLengths = segments
    .map(({ start, end }) => {
      bounds.expandByPoint(start);
      bounds.expandByPoint(end);
      return start.distanceTo(end);
    })
    .sort((first, second) => first - second);
  const spatialScale = bounds.isEmpty()
    ? 1
    : Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
  const medianSegmentLength = segmentLengths.length
    ? segmentLengths[Math.floor(segmentLengths.length * 0.5)]
    : spatialScale;
  const snapTolerance = Math.max(
    epsilon * 8,
    Math.min(spatialScale * 0.001, medianSegmentLength * 0.08),
  );
  const curveMergeTolerance = Math.max(
    snapTolerance * 4,
    spatialScale * 0.015,
  );
  const graph = buildWeldedIntersectionGraph(segments, snapTolerance);
  const chains = buildSegmentChains(graph);
  const pieces = chains.flatMap((chain) =>
    splitChainAtSharpTurns(chain.points).map((points) => ({
      points,
      sourceIds: new Set(chain.sourceIds),
    })),
  );
  const uniquePieces = mergeCoincidentChains(pieces, curveMergeTolerance);
  for (const piece of uniquePieces) {
    const smoothed = smoothChain(piece, epsilon);
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      linePositions.push(
        ...smoothed[index].toArray(),
        ...smoothed[index + 1].toArray(),
      );
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(linePositions, 3),
  );
  result.userData.intersectionTopology = {
    rawSegmentCount: segments.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    chainCount: chains.length,
    pieceCount: pieces.length,
    uniquePieceCount: uniquePieces.length,
    snapTolerance,
    curveMergeTolerance,
  };
  if (linePositions.length > 0) {
    result.computeBoundingSphere();
  }
  return result;
}
