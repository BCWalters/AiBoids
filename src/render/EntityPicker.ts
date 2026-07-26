import * as THREE from 'three';

export interface EntityForPicking {
  id: number;
  /** Render-space world position (may differ from sim-space in fishtank style). */
  position: { x: number; y: number; z: number };
  isPredator: boolean;
}

export interface PickedEntity {
  id: number;
  isPredator: boolean;
}

/** Default pixel radius within which a click is considered a "hit". */
const DEFAULT_THRESHOLD_PX = 50;

/**
 * Projects each entity's render-space position to CSS screen coordinates
 * and returns the entity nearest the given mouse position (within
 * `thresholdPx`), or null if none is close enough.
 *
 * Coordinates must be in the same CSS-pixel space:
 *   mouseX/mouseY — pointer offset relative to the canvas top-left corner.
 *   canvasWidthCss/canvasHeightCss — canvas layout CSS dimensions (not
 *   device-pixel-ratio-scaled internal dimensions).
 *
 * Entities located behind the camera (NDC z > 1) are automatically skipped.
 */
export function pickEntity(
  mouseX: number,
  mouseY: number,
  canvasWidthCss: number,
  canvasHeightCss: number,
  camera: THREE.PerspectiveCamera,
  entities: readonly EntityForPicking[],
  thresholdPx = DEFAULT_THRESHOLD_PX,
): PickedEntity | null {
  const tmp = new THREE.Vector3();
  let bestDist2 = thresholdPx * thresholdPx;
  let bestId: number | null = null;
  let bestIsPredator = false;

  for (const entity of entities) {
    const { x, y, z } = entity.position;
    tmp.set(x, y, z).project(camera);
    // Entities behind the camera have NDC z > 1.
    if (tmp.z > 1) continue;
    const screenX = (tmp.x + 1) * 0.5 * canvasWidthCss;
    const screenY = (1 - tmp.y) * 0.5 * canvasHeightCss;
    const dx = screenX - mouseX;
    const dy = screenY - mouseY;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < bestDist2) {
      bestDist2 = dist2;
      bestId = entity.id;
      bestIsPredator = entity.isPredator;
    }
  }

  return bestId !== null ? { id: bestId, isPredator: bestIsPredator } : null;
}
