import * as THREE from 'three';

/**
 * Procedural texture + furnishing builders for the fish tank room shell
 * (see environment.ts). Kept in its own module since this is purely
 * decorative "set dressing" around the tank/table — none of it touches
 * the tank/water/table objects themselves, so a future pass reskinning
 * the tank can ignore this file entirely.
 */

/** Draws an NxN black/white checkerboard onto a canvas and returns it as a repeating texture. */
export function createCheckerTexture(colorA: string, colorB: string, tilesPerSide: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cell = size / tilesPerSide;
  for (let row = 0; row < tilesPerSide; row++) {
    for (let col = 0; col < tilesPerSide; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  // Faint grout lines between tiles so the checker pattern doesn't look
  // like a single flat texture from a distance.
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tilesPerSide; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A handful of distinct "abstract art" canvas variants for wall-mounted picture frames. */
export type ArtVariant = 'sunsetBands' | 'orbits' | 'coral';

function paintArt(ctx: CanvasRenderingContext2D, size: number, variant: ArtVariant): void {
  if (variant === 'sunsetBands') {
    const bands = ['#f4a261', '#e76f51', '#e9c46a', '#2a9d8f'];
    const bandHeight = size / bands.length;
    bands.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * bandHeight, size, bandHeight);
    });
  } else if (variant === 'orbits') {
    ctx.fillStyle = '#22223b';
    ctx.fillRect(0, 0, size, size);
    const rings = ['#4a4e69', '#9a8c98', '#c9ada7', '#f2e9e4'];
    rings.forEach((color, i) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 0.03;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * (0.15 + i * 0.1), 0, Math.PI * 2);
      ctx.stroke();
    });
  } else {
    // 'coral' — loose organic blobs, echoing the aquarium theme without
    // depicting the tank itself.
    ctx.fillStyle = '#e0fbfc';
    ctx.fillRect(0, 0, size, size);
    const blobs = ['#ff6b6b', '#ffa62b', '#ff9f9f'];
    blobs.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      const cx = size * (0.3 + i * 0.2);
      const cy = size * (0.4 + (i % 2) * 0.2);
      ctx.ellipse(cx, cy, size * 0.18, size * 0.28, i, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

export function createArtTexture(variant: ArtVariant): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paintArt(ctx, size, variant);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const FRAME_WOOD_COLOR = 0x3a2a1d;

/** A framed picture: a thin dark wood border plus the painted canvas inset, built to hang flush against a wall. */
export function createArtPiece(variant: ArtVariant): THREE.Group {
  const group = new THREE.Group();
  const texture = createArtTexture(variant);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME_WOOD_COLOR, roughness: 0.6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.12, 0.06), frameMaterial);
  group.add(frame);

  const canvasMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    // A larger gap than before plus polygonOffset both help avoid
    // z-fighting flicker ("wobbly" edges) against the frame's front face
    // while orbiting the camera, especially once this group is scaled up
    // to room-sized world units.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), canvasMaterial);
  canvasMesh.position.z = 0.09;
  group.add(canvasMesh);

  return group;
}

/** A simple hinged-look door: slab, frame trim, and a small metallic knob. */
export function createDoor(): THREE.Group {
  const group = new THREE.Group();

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.85 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.05, 0.05), frameMaterial);
  frame.position.z = -0.02;
  group.add(frame);

  const slabMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.5, metalness: 0.05 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.94, 1, 0.06), slabMaterial);
  group.add(slab);

  // Two shallow raised recessed panels, a classic door detail, faked with
  // slightly inset thin boxes rather than real recessed geometry.
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x7a4c2a, roughness: 0.55 });
  const panelTop = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.36, 0.02), panelMaterial);
  panelTop.position.set(0, 0.24, 0.04);
  group.add(panelTop);
  const panelBottom = panelTop.clone();
  panelBottom.position.y = -0.28;
  group.add(panelBottom);

  const knobMaterial = new THREE.MeshStandardMaterial({ color: 0xd8b34a, roughness: 0.3, metalness: 0.8 });
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), knobMaterial);
  knob.position.set(0.38, 0, 0.06);
  group.add(knob);

  return group;
}

/** A paned window: white frame trim, mullion cross bars, glass, and a plain sky backdrop for a sense of daylight outside. */
export function createWindow(): THREE.Group {
  const group = new THREE.Group();

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.8 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.06), frameMaterial);
  group.add(frame);

  // Nighttime outside — a plain dark backdrop rather than a daylight sky,
  // so there's nothing bright/interesting to render "through" the glass.
  const nightMaterial = new THREE.MeshBasicMaterial({ color: 0x05070d });
  const night = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), nightMaterial);
  night.position.z = -0.01;
  group.add(night);

  // With nothing lit outside, the pane should read as reflective rather
  // than transparent — low roughness + high metalness picks up bright
  // specular highlights from the room's lights (the overhead lamp, key
  // light) the way a dark window looks like a mirror at night. A very
  // dark base color keeps it reading as "dark outside" even under the
  // fishtank style's fairly bright ambient light.
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x040609,
    roughness: 0.12,
    metalness: 0.95,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), glassMaterial);
  glass.position.z = 0.025;
  group.add(glass);

  const mullionMaterial = frameMaterial;
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.94, 0.05), mullionMaterial);
  vertical.position.z = 0.02;
  group.add(vertical);
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.04, 0.05), mullionMaterial);
  horizontal.position.z = 0.02;
  group.add(horizontal);

  // Sill: a thin ledge along the bottom edge, standing slightly proud of
  // the wall so it reads as a physical shelf rather than a flat decal.
  const sillMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.7 });
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.16), sillMaterial);
  sill.position.set(0, -0.58, 0.08);
  group.add(sill);

  return group;
}

export interface OverheadLamp {
  group: THREE.Group;
  light: THREE.SpotLight;
}

/** A ceiling-mounted pendant lamp (rod + shade) with a spotlight aimed straight down, standing in for the room's overhead light source. */
export function createOverheadLamp(): OverheadLamp {
  const group = new THREE.Group();

  // Rod spans from the ceiling attach point (group origin, y=0) down to
  // the shade (y=-0.55) so there's no visible gap between rod and shade.
  const rodLength = 0.55;
  const rodMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.6 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, rodLength, 8), rodMaterial);
  rod.position.y = -rodLength / 2;
  group.add(rod);

  const shadeMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff6e0,
    roughness: 0.4,
    emissive: 0xffedb8,
    emissiveIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.28, 24, 1, true), shadeMaterial);
  shade.position.y = -0.55;
  group.add(shade);

  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfffbe6,
    emissive: 0xfff2b0,
    emissiveIntensity: 1.4,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), bulbMaterial);
  bulb.position.y = -0.58;
  group.add(bulb);

  const light = new THREE.SpotLight(0xfff3d6, 1.4, 0, Math.PI / 5, 0.5, 1.2);
  light.position.set(0, -0.55, 0);
  const target = new THREE.Object3D();
  target.position.set(0, -1, 0);
  group.add(target);
  light.target = target;
  group.add(light);

  return { group, light };
}
