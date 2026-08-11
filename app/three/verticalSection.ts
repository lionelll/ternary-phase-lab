import * as THREE from "three";

const INTERSECTION_EPSILON = 1e-5;

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
};

/**
 * 遍历相区三角网格，计算其与空间平面的所有交线段。
 *
 * 对完全落在切面内的三角形，只保留共面片的外边界，避免显示内部三角剖分线；
 * 相邻网格产生的重复线段会按世界坐标去重。
 */
export function makePlaneIntersectionGeometry(
  meshes: readonly THREE.Mesh<THREE.BufferGeometry>[],
  plane: THREE.Plane,
  epsilon = INTERSECTION_EPSILON,
  applyWorldTransforms = true,
) {
  const segments = new Map<string, StoredSegment>();
  const triangleVertices = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];

  const storeSegment = (start: THREE.Vector3, end: THREE.Vector3) => {
    if (start.distanceToSquared(end) <= epsilon * epsilon) return;
    const key = segmentKey(start, end, epsilon);
    if (!segments.has(key)) {
      segments.set(key, { start: start.clone(), end: end.clone() });
    }
  };

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) continue;
    const index = geometry.getIndex();
    const indexCount = index?.count ?? positions.count;
    const coplanarEdges = new Map<
      string,
      StoredSegment & { count: number }
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
        storeSegment(start, end);
      }
    }

    for (const edge of coplanarEdges.values()) {
      if (edge.count === 1) storeSegment(edge.start, edge.end);
    }
  }

  const linePositions: number[] = [];
  for (const segment of segments.values()) {
    linePositions.push(...segment.start.toArray(), ...segment.end.toArray());
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(linePositions, 3),
  );
  if (linePositions.length > 0) {
    result.computeBoundingSphere();
  }
  return result;
}
