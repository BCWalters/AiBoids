import * as THREE from 'three';

// Dark aquarium-silicone/frame color for the glass box's edges — same
// visual role as arcade's world-bounds wireframe (src/render/Renderer3D's
// boundsHelper), just drawn independently here rather than reusing that
// debug helper, per the "duplicate, don't share" approach for this style.
const FRAME_COLOR = 0x14181c;

export interface GlassResult {
  glassPanels: THREE.Mesh;
  frame: THREE.Group;
  baseTrim: THREE.Mesh;
}

/** Creates the glass box, metal frame, and base trim — placeholder 1×1×1 boxes
 *  until `placeGlass` sizes and positions them. */
export function createGlass(reducedGraphics: boolean): GlassResult {
  // Placeholder 1x1x1 boxes — placeGlass resizes/positions everything
  // once the sim's actual world dimensions are known.
  const glassGeometry = new THREE.BoxGeometry(1, 1, 1);
  const glassMaterial: THREE.Material = reducedGraphics
    ? new THREE.MeshBasicMaterial({
        color: 0xdff6ff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    : new THREE.MeshPhysicalMaterial({
        color: 0xdff6ff,
        transparent: true,
        opacity: 0.18,
        roughness: 0.05,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
  const glassPanels = new THREE.Mesh(glassGeometry, glassMaterial);
  glassPanels.visible = false;
  glassPanels.receiveShadow = true;

  // A dark plastic/rubber base plinth just under the glass, hiding the
  // seam where the tank meets the table — a detail seen on virtually
  // every real aquarium.
  const baseTrimMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.7, metalness: 0.1 });
  const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), baseTrimMaterial);
  baseTrim.visible = false;
  baseTrim.castShadow = true;
  baseTrim.receiveShadow = true;

  // Metal frame: thin brushed-aluminum bars along all 12 edges of the
  // glass box (4 vertical corner posts + 4 top edges + 4 bottom edges),
  // replacing the old flat LineSegments wireframe with an actual 3D
  // frame — narrower than the previous line-drawn "border" reads, and
  // one that actually catches light/specular highlights like real
  // aquarium framing.
  const frameBarMaterial = new THREE.MeshStandardMaterial({ color: 0xb7bdc4, roughness: 0.35, metalness: 0.9 });
  const frame = new THREE.Group();
  const barGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 12; i++) {
    const bar = new THREE.Mesh(barGeometry, frameBarMaterial);
    bar.name = `frameBar${i}`;
    frame.add(bar);
  }
  frame.visible = false;

  return { glassPanels, frame, baseTrim };
}

/**
 * Sizes and positions the glass panels, metal frame bars, and base trim
 * to match the world dimensions.  Must be called after `createGlass`.
 */
export function placeGlass(
  glassPanels: THREE.Mesh,
  frame: THREE.Group,
  baseTrim: THREE.Mesh,
  center: THREE.Vector3,
  worldWidth: number,
  glassHeight: number,
  worldDepth: number,
  maxDim: number,
  glassThickness: number,
): void {
  glassPanels.scale.set(worldWidth + glassThickness * 2, glassHeight + glassThickness * 2, worldDepth + glassThickness * 2);
  glassPanels.position.copy(center);

  // Metal frame: 12 thin bars tracing the outer glass box's edges,
  // narrower than the old line-drawn border and built with an actual
  // brushed-metal material so it catches specular highlights like real
  // aquarium framing.
  const frameBarThickness = maxDim * 0.016;
  const halfW = (worldWidth + glassThickness * 2) / 2;
  const halfH = (glassHeight + glassThickness * 2) / 2;
  const halfD = (worldDepth + glassThickness * 2) / 2;
  const edgeSpecs: { axis: 'x' | 'y' | 'z'; oy: number; oz: number; ox: number }[] = [
    // 4 edges running along X, at each Y/Z corner.
    { axis: 'x', oy: -halfH, oz: -halfD, ox: 0 },
    { axis: 'x', oy: -halfH, oz: halfD, ox: 0 },
    { axis: 'x', oy: halfH, oz: -halfD, ox: 0 },
    { axis: 'x', oy: halfH, oz: halfD, ox: 0 },
    // 4 edges running along Y, at each X/Z corner.
    { axis: 'y', ox: -halfW, oz: -halfD, oy: 0 },
    { axis: 'y', ox: -halfW, oz: halfD, oy: 0 },
    { axis: 'y', ox: halfW, oz: -halfD, oy: 0 },
    { axis: 'y', ox: halfW, oz: halfD, oy: 0 },
    // 4 edges running along Z, at each X/Y corner.
    { axis: 'z', ox: -halfW, oy: -halfH, oz: 0 },
    { axis: 'z', ox: -halfW, oy: halfH, oz: 0 },
    { axis: 'z', ox: halfW, oy: -halfH, oz: 0 },
    { axis: 'z', ox: halfW, oy: halfH, oz: 0 },
  ];
  edgeSpecs.forEach((spec, i) => {
    const bar = frame.getObjectByName(`frameBar${i}`) as THREE.Mesh;
    const length =
      spec.axis === 'x'
        ? worldWidth + glassThickness * 2
        : spec.axis === 'y'
          ? glassHeight + glassThickness * 2
          : worldDepth + glassThickness * 2;
    if (spec.axis === 'x') bar.scale.set(length, frameBarThickness, frameBarThickness);
    else if (spec.axis === 'y') bar.scale.set(frameBarThickness, length, frameBarThickness);
    else bar.scale.set(frameBarThickness, frameBarThickness, length);
    bar.position.set(center.x + spec.ox, center.y + spec.oy, center.z + spec.oz);
  });

  // Base trim: a dark plinth just under the glass box's bottom edge
  // and the room floor beneath it, hiding that seam.
  const trimFootprintX = worldWidth + glassThickness * 6;
  const trimFootprintZ = worldDepth + glassThickness * 6;
  // Extra gap below glassThickness so the floor never sits exactly
  // coplanar with the glass box's bottom face — an exact coincidence
  // there previously caused visible z-fighting stripes between the
  // (transparent) glass and the (opaque) floor where they'd otherwise
  // perfectly overlap.
  const floorGap = glassThickness * 1.5;
  baseTrim.scale.set(trimFootprintX, floorGap * 1.8, trimFootprintZ);
  baseTrim.position.set(center.x, -floorGap * 0.9, center.z);
}
