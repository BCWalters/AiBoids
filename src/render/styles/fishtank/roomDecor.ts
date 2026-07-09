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

/** A handful of distinct "fish tank"-themed art canvas variants for wall-mounted picture frames — aquarium-life imagery befitting a public aquarium gallery, rather than generic abstract decor. `blueWhale` and `welcomeSign` are meant to be rendered as large wide-format murals (see createArtPiece's `aspect` param); the rest are small square pieces kept as a visual size reference against the tank/mural scale. */
export type ArtVariant =
  | 'schoolOfFish'
  | 'seahorseSilhouette'
  | 'coralReef'
  | 'jellyfish'
  | 'blueWhale'
  | 'welcomeSign'
  | 'giantSquid'
  | 'seaTurtle';

/** Draws a simple side-view fish silhouette (oval body + triangular tail + tiny fin) at the given position/size/rotation. */
function paintFish(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  // Body.
  ctx.beginPath();
  ctx.ellipse(0, 0, length * 0.5, length * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tail fin.
  ctx.beginPath();
  ctx.moveTo(-length * 0.48, 0);
  ctx.lineTo(-length * 0.78, -length * 0.22);
  ctx.lineTo(-length * 0.78, length * 0.22);
  ctx.closePath();
  ctx.fill();
  // Small dorsal fin.
  ctx.beginPath();
  ctx.moveTo(length * 0.02, -length * 0.26);
  ctx.lineTo(length * 0.18, -length * 0.44);
  ctx.lineTo(length * 0.28, -length * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The seahorse silhouette path (coiled tail + curved body + snout), traced at the current ctx origin/scale — factored out of the `seahorseSilhouette` art variant so `paintSeahorse` (used standalone on the welcome mural) can share the exact same shape. */
function traceSeahorsePath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(s * 0.05, s * 0.3);
  ctx.bezierCurveTo(s * 0.2, s * 0.32, s * 0.22, s * 0.15, s * 0.08, s * 0.08);
  ctx.bezierCurveTo(s * -0.05, s * 0.02, s * -0.02, s * -0.12, s * 0.08, s * -0.18);
  ctx.bezierCurveTo(s * 0.16, s * -0.22, s * 0.22, s * -0.3, s * 0.16, s * -0.36);
  ctx.lineTo(s * 0.24, s * -0.34);
  ctx.bezierCurveTo(s * 0.3, s * -0.26, s * 0.24, s * -0.16, s * 0.14, s * -0.1);
  ctx.bezierCurveTo(s * 0.05, s * -0.05, s * 0.02, s * 0.05, s * 0.1, s * 0.1);
  ctx.bezierCurveTo(s * 0.22, s * 0.16, s * 0.2, s * 0.28, s * 0.05, s * 0.3);
  ctx.closePath();
}

/** Draws a standalone seahorse silhouette at (x, y). Pass `mirror: true` to flip it horizontally (e.g. so a pair of seahorses can face inward toward each other, as on the welcome mural). */
function paintSeahorse(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, mirror: boolean = false): void {
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.fillStyle = color;
  traceSeahorsePath(ctx, size);
  ctx.fill();
  ctx.restore();
}

function paintArt(ctx: CanvasRenderingContext2D, width: number, height: number, variant: ArtVariant): void {
  // Most variants below were authored for a square canvas — `size` keeps
  // their existing proportional math unchanged for the (still-square)
  // small pieces, while the wide mural variants use width/height
  // directly for a proper widescreen composition.
  const size = Math.min(width, height);
  if (variant === 'schoolOfFish') {
    // Deep-water blue backdrop with a loose school of small fish, each a
    // slightly different size/color/angle so it reads as a candid school
    // shot rather than a repeated stamp.
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#0a3d5c');
    grad.addColorStop(1, '#062338');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const colors = ['#f4a340', '#f2d94e', '#7fd8e8', '#e8e8e8'];
    for (let i = 0; i < 14; i++) {
      const fx = size * (0.1 + 0.8 * ((i * 0.37) % 1));
      const fy = size * (0.15 + 0.7 * ((i * 0.61 + 0.2) % 1));
      const len = size * (0.1 + 0.05 * ((i * 0.29) % 1));
      const angle = (((i * 0.53) % 1) - 0.5) * 0.8;
      paintFish(ctx, fx, fy, len, angle, colors[i % colors.length]);
    }
  } else if (variant === 'seahorseSilhouette') {
    // A single large stylized seahorse silhouette against a pale
    // gradient, like a minimalist gallery print.
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#dff3f6');
    grad.addColorStop(1, '#aad8e0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    paintSeahorse(ctx, size * 0.5, size * 0.5, size, '#2a4d55');
  } else if (variant === 'jellyfish') {
    // Dark deep-water backdrop with a few translucent-looking jellyfish
    // bells and trailing tentacles.
    ctx.fillStyle = '#041324';
    ctx.fillRect(0, 0, size, size);
    const jellies = [
      { x: 0.3, y: 0.35, r: 0.16, color: '#e78fce' },
      { x: 0.68, y: 0.55, r: 0.12, color: '#8fd6e7' },
      { x: 0.5, y: 0.15, r: 0.09, color: '#c9a6f2' },
    ];
    jellies.forEach(({ x, y, r, color }) => {
      const cx = size * x;
      const cy = size * y;
      const rad = size * r;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, Math.PI, 0);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 0.006;
      for (let t = -2; t <= 2; t++) {
        ctx.beginPath();
        ctx.moveTo(cx + t * rad * 0.3, cy);
        ctx.quadraticCurveTo(cx + t * rad * 0.4, cy + rad * 1.6, cx + t * rad * 0.2, cy + rad * 2.4);
        ctx.stroke();
      }
    });
  } else if (variant === 'coralReef') {
    // A warm reef floor scene: coral blobs plus a couple of small fish
    // darting past, echoing the aquarium theme directly rather than
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
    paintFish(ctx, size * 0.72, size * 0.28, size * 0.22, -0.3, '#2a6f97');
    paintFish(ctx, size * 0.22, size * 0.75, size * 0.16, 0.4, '#f4d35e');
  } else if (variant === 'blueWhale') {
    // Large open-ocean landscape mural: sunlit gradient, a couple of
    // faint sunbeam shafts, a big blue whale silhouette spanning most
    // of the width, and a couple of small fish nearby for scale contrast
    // — meant to hang as a room-scale mural rather than a small framed
    // piece, echoing the tank's own giant scale on the walls around it.
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#3a8fb5');
    grad.addColorStop(0.6, '#0f4c6b');
    grad.addColorStop(1, '#052538');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(width * (0.12 + i * 0.24), 0);
      ctx.rotate(0.15);
      ctx.fillRect(-width * 0.03, 0, width * 0.05, height);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(width * 0.5, height * 0.55);
    ctx.scale(width * 0.9, height * 0.6);
    ctx.fillStyle = '#0a3350';
    ctx.beginPath();
    ctx.moveTo(-0.48, 0.05);
    ctx.bezierCurveTo(-0.4, -0.16, -0.1, -0.2, 0.15, -0.14);
    ctx.bezierCurveTo(0.32, -0.1, 0.42, -0.04, 0.48, 0.02);
    ctx.lineTo(0.56, -0.08);
    ctx.lineTo(0.5, 0.04);
    ctx.lineTo(0.56, 0.12);
    ctx.lineTo(0.44, 0.07);
    ctx.bezierCurveTo(0.3, 0.14, 0.05, 0.18, -0.2, 0.15);
    ctx.bezierCurveTo(-0.35, 0.13, -0.44, 0.1, -0.48, 0.05);
    ctx.closePath();
    ctx.fill();
    // Pectoral fin.
    ctx.beginPath();
    ctx.moveTo(-0.05, 0.02);
    ctx.lineTo(-0.16, 0.22);
    ctx.lineTo(-0.02, 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    paintFish(ctx, width * 0.14, height * 0.28, size * 0.07, 0.2, '#dfeff2');
    paintFish(ctx, width * 0.85, height * 0.78, size * 0.06, -0.3, '#dfeff2');
  } else if (variant === 'welcomeSign') {
    // A warm signboard mural reading "Lily and Mia's Aquarium", with a
    // pair of lavender seahorses flanking the text, facing inward
    // toward it.
    ctx.fillStyle = '#f6ecd9';
    ctx.fillRect(0, 0, width, height);
    const borderWidth = size * 0.025;
    ctx.strokeStyle = '#2a6f8f';
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(borderWidth, borderWidth, width - borderWidth * 2, height - borderWidth * 2);

    const lavender = '#b39ddb';
    const seahorseSize = height * 0.62;
    paintSeahorse(ctx, width * 0.14, height * 0.55, seahorseSize, lavender);
    paintSeahorse(ctx, width * 0.86, height * 0.55, seahorseSize, lavender, true);

    ctx.fillStyle = '#123c4d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${height * 0.14}px Georgia, serif`;
    ctx.fillText("Lily and Mia's", width * 0.5, height * 0.4);
    ctx.font = `bold ${height * 0.19}px Georgia, serif`;
    ctx.fillText('AQUARIUM', width * 0.5, height * 0.66);
  } else if (variant === 'giantSquid') {
    // 'giantSquid' — a sunlit open-water landscape mural to match
    // blueWhale's room scale: a light blue gradient backdrop (for
    // contrast against the dark squid silhouette), a couple of faint
    // sunbeam shafts, and a large giant-squid silhouette (bulbous
    // mantle, two long feeding tentacles, and a ring of shorter arms)
    // trailing across most of the width.
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#bfe6f5');
    grad.addColorStop(0.55, '#8fcbe6');
    grad.addColorStop(1, '#5aa8cf');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(width * (0.2 + i * 0.3), 0);
      ctx.rotate(-0.12);
      ctx.fillRect(-width * 0.025, 0, width * 0.04, height);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(width * 0.55, height * 0.42);
    ctx.rotate(0.08);
    const squidColor = '#20122b';
    // Mantle (the bulbous "head" body).
    ctx.fillStyle = squidColor;
    ctx.beginPath();
    ctx.ellipse(0, -height * 0.16, width * 0.09, height * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Two long feeding tentacles, trailing off toward the lower-left.
    ctx.strokeStyle = squidColor;
    ctx.lineCap = 'round';
    [-1, 1].forEach((side) => {
      ctx.lineWidth = width * 0.012;
      ctx.beginPath();
      ctx.moveTo(side * width * 0.015, height * 0.02);
      ctx.bezierCurveTo(
        side * width * 0.1,
        height * 0.22,
        -width * 0.28,
        height * 0.4,
        -width * 0.42,
        height * 0.5,
      );
      ctx.stroke();
    });
    // A ring of 8 shorter arms fanning out below the mantle.
    for (let i = 0; i < 8; i++) {
      const angle = Math.PI * 0.15 + (i / 7) * Math.PI * 0.7;
      const len = width * (0.1 + 0.02 * (i % 3));
      ctx.lineWidth = width * 0.006;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.02);
      ctx.quadraticCurveTo(
        Math.cos(angle) * len * 0.6,
        height * 0.02 + Math.sin(angle) * len * 0.6,
        Math.cos(angle) * len,
        height * 0.02 + Math.sin(angle) * len,
      );
      ctx.stroke();
    }
    // Large eye for silhouette readability.
    ctx.fillStyle = '#ffcf6b';
    ctx.beginPath();
    ctx.arc(-width * 0.035, -height * 0.2, width * 0.014, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    paintFish(ctx, width * 0.15, height * 0.75, size * 0.06, 0.1, '#8fd6e7');
    paintFish(ctx, width * 0.85, height * 0.2, size * 0.05, -0.4, '#8fd6e7');
  } else {
    // 'seaTurtle' — a bright warm-water landscape mural for the green
    // accent wall: a pink/orange sunset-reef gradient backdrop with a
    // large sea turtle silhouette (domed shell, four flippers, head and
    // short tail) gliding across the width, plus a couple of small fish
    // for scale.
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#ffd9a0');
    grad.addColorStop(0.5, '#ff9d6c');
    grad.addColorStop(1, '#e2634f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width * 0.52, height * 0.55);
    ctx.rotate(-0.05);
    const shellColor = '#2f5d4f';
    // Shell (domed body).
    ctx.fillStyle = shellColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, width * 0.22, height * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shell scute pattern (a few darker segments) for readability.
    ctx.strokeStyle = '#1e3f36';
    ctx.lineWidth = width * 0.006;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * width * 0.09, -height * 0.22);
      ctx.lineTo(i * width * 0.09, height * 0.22);
      ctx.stroke();
    }
    // Head, extended forward (toward +x).
    ctx.fillStyle = shellColor;
    ctx.beginPath();
    ctx.ellipse(width * 0.28, -height * 0.02, width * 0.07, height * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    // Front flippers (large, angled up/down like a swimming stroke).
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(width * 0.14, side * height * 0.12);
      ctx.quadraticCurveTo(width * 0.3, side * height * 0.42, width * 0.36, side * height * 0.5);
      ctx.quadraticCurveTo(width * 0.2, side * height * 0.32, width * 0.08, side * height * 0.16);
      ctx.closePath();
      ctx.fill();
    });
    // Back flippers, smaller.
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(-width * 0.16, side * height * 0.16);
      ctx.quadraticCurveTo(-width * 0.28, side * height * 0.32, -width * 0.32, side * height * 0.38);
      ctx.quadraticCurveTo(-width * 0.2, side * height * 0.24, -width * 0.1, side * height * 0.14);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    paintFish(ctx, width * 0.12, height * 0.2, size * 0.06, 0.2, '#2a6f8f');
    paintFish(ctx, width * 0.88, height * 0.82, size * 0.05, -0.2, '#2a6f8f');
  }
}

/** `aspect` is width/height (1 = square, >1 = wide mural format). */
export function createArtTexture(variant: ArtVariant, aspect: number = 1): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size * aspect;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paintArt(ctx, canvas.width, canvas.height, variant);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const FRAME_WOOD_COLOR = 0x3a2a1d;

/** A framed picture: a thin dark wood border plus the painted canvas inset, built to hang flush against a wall. Pass `aspect` (width/height, default 1) for a wide mural-format frame instead of the default square. */
export function createArtPiece(variant: ArtVariant, aspect: number = 1): THREE.Group {
  const group = new THREE.Group();
  const texture = createArtTexture(variant, aspect);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME_WOOD_COLOR, roughness: 0.6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.12 * aspect, 1.12, 0.06), frameMaterial);
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
  const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), canvasMaterial);
  canvasMesh.position.z = 0.09;
  group.add(canvasMesh);

  return group;
}

/** A simple hinged-look door: slab, frame trim, and a small metallic knob. Pass `withExitSign: true` to mount a small backlit "EXIT" sign directly above the frame (as a child, so it inherits the door group's own position/scale/rotation automatically). */
export function createDoor(withExitSign: boolean = false): THREE.Group {
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

  if (withExitSign) {
    group.add(createExitSign());
  }

  return group;
}

/** A small backlit red "EXIT" sign box, positioned to mount directly above a door's own frame (local space, relative to the door group's own 1x1x1 unit sizing). */
export function createExitSign(): THREE.Group {
  const group = new THREE.Group();

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3a0000';
  ctx.fillRect(0, 0, size, size / 2);
  ctx.fillStyle = '#ff2020';
  ctx.font = `bold ${size * 0.32}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', size / 2, size / 4 + size * 0.02);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x1a0000, roughness: 0.6 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.05), boxMaterial);
  group.add(box);

  const faceMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xff2020,
    emissiveMap: texture,
    emissiveIntensity: 1.1,
    roughness: 0.4,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.14), faceMaterial);
  face.position.z = 0.03;
  group.add(face);

  // Mounted just above the door frame's own top edge (frame spans
  // y in [-0.525, 0.525] at the door group's unit scale).
  group.position.set(0, 0.68, -0.01);

  return group;
}

/**
 * A simple backless wooden bench (seat slab + 4 square legs, no
 * backrest) — the plain museum/aquarium-hall gallery seating look,
 * deliberately unadorned so it doesn't compete with the tank or art.
 * Built already at roughly real-world proportions (seat ~1.6 long x 0.5
 * deep, standing 0.45 tall) rather than the door/art's abstract 1x1x1
 * unit convention, so callers can scale it uniformly with a single
 * factor instead of needing per-axis scale like the door/art props do.
 */
export function createBench(): THREE.Group {
  const group = new THREE.Group();

  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.65 });

  const seatHeight = 0.45;
  const seatThickness = 0.06;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, seatThickness, 0.5), woodMaterial);
  seat.position.y = seatHeight - seatThickness / 2;
  group.add(seat);

  // Twice the original bench length (3.2 vs 1.6), so a middle pair of
  // legs/rails is added for support — a real museum bench this long
  // wouldn't just span on its two end pairs of legs.
  const legHeight = seatHeight - seatThickness;
  const legGeometry = new THREE.BoxGeometry(0.08, legHeight, 0.08);
  const legOffsets: [number, number][] = [
    [-1.44, -0.19],
    [-1.44, 0.19],
    [0, -0.19],
    [0, 0.19],
    [1.44, -0.19],
    [1.44, 0.19],
  ];
  for (const [x, z] of legOffsets) {
    const leg = new THREE.Mesh(legGeometry, woodMaterial);
    leg.position.set(x, legHeight / 2, z);
    group.add(leg);
  }

  // A thin stretcher rail spanning the full length between the end legs
  // on each side, for a bit of visual structure (real benches aren't
  // just seat + floating legs).
  const railGeometry = new THREE.BoxGeometry(2.96, 0.04, 0.04);
  const railFront = new THREE.Mesh(railGeometry, woodMaterial);
  railFront.position.set(0, legHeight * 0.4, -0.19);
  group.add(railFront);
  const railBack = railFront.clone();
  railBack.position.z = 0.19;
  group.add(railBack);

  return group;
}

/**
 * A small "other tank" wall window — a static, non-animated porthole
 * suggesting a neighboring exhibit tank glimpsed through the wall: a
 * dark metal frame, a dim static canvas backdrop (murky blue-green
 * water with a handful of small colorful fish silhouettes, painted once
 * and never animated), and a glossy glass pane in front with a
 * low-roughness clearcoat so it picks up specular highlights from the
 * room's lamps — enough of a glassy sheen to read as "somewhat real"
 * without needing a full reflection/environment-map setup. Pass
 * `aspect` (width/height, default 1) for a wider window instead of the
 * default square porthole.
 */
export function createTankWindow(aspect: number = 1): THREE.Group {
  const group = new THREE.Group();
  buildTankWindowContents(group, aspect);
  return group;
}

/**
 * Rebuilds an existing tank-window group's contents at a new aspect
 * ratio, in place — used when the actual per-wall open-gap width (and
 * therefore the ideal window aspect) is only known once the room's
 * runtime dimensions are computed in placeFishtankEnvironment, after
 * the window groups already exist. Keeps the same THREE.Group identity
 * (already wired into the scene graph/lifecycle) rather than swapping
 * in a whole new object.
 */
export function rebuildTankWindow(group: THREE.Group, aspect: number): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  }
  buildTankWindowContents(group, aspect);
}

function buildTankWindowContents(group: THREE.Group, aspect: number): void {
  // Frame, backdrop, and glass are stacked along local z as three
  // separate coplanar-ish surfaces. Earlier revisions packed them within
  // ~0.02-0.04 units of each other (and even had the backdrop plane
  // sitting *inside* the frame box's own depth range), which caused
  // depth-buffer z-fighting — visible as flickering/glitching fish
  // patterns, worse the farther the camera zooms out (depth precision
  // degrades with distance). Spacing them well apart (frame recessed
  // deep in back, backdrop clearly in front of the frame's front face,
  // glass clearly in front of the backdrop) keeps each surface's depth
  // unambiguous at any zoom level.
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.5, metalness: 0.4 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1 * aspect, 1.1, 0.08), frameMaterial);
  frame.position.z = -0.09;
  group.add(frame);

  // Static "other tank" backdrop: a dim murky-water gradient with a
  // handful of small colorful fish (reusing paintFish, same as the
  // schoolOfFish art variant) — simulating a neighboring tank glimpsed
  // through the wall without any real animation.
  const height = 128;
  const width = Math.round(height * aspect);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#0f3a58');
  grad.addColorStop(1, '#041426');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // A scattering of small, muted multicolored dots behind the main fish
  // — suggesting a few more distant/blurry fish glimpsed deeper in the
  // neighboring tank, without competing with the painted fish shapes.
  const dotColors = ['#6f9aa8', '#a8895f', '#8a7a9e', '#7fa88f', '#a86f7f'];
  const dotCount = Math.max(6, Math.round(10 * aspect));
  for (let i = 0; i < dotCount; i++) {
    const dx = width * ((i * 0.337 + 0.05) % 1);
    const dy = height * ((i * 0.591 + 0.12) % 1);
    const r = height * (0.015 + 0.015 * ((i * 0.271) % 1));
    ctx.globalAlpha = 0.35 + 0.25 * ((i * 0.193) % 1);
    ctx.fillStyle = dotColors[i % dotColors.length];
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const fishColors = ['#f4a340', '#f2d94e', '#7fd8e8', '#ff6f61', '#8fd6e7'];
  const fishCount = Math.max(3, Math.round(4 * aspect));
  for (let i = 0; i < fishCount; i++) {
    const fx = width * (0.08 + 0.84 * ((i * 0.41 + 0.15) % 1));
    const fy = height * (0.2 + 0.6 * ((i * 0.67 + 0.3) % 1));
    const len = height * (0.14 + 0.06 * ((i * 0.31) % 1));
    const angle = (((i * 0.47) % 1) - 0.5) * 0.9;
    paintFish(ctx, fx, fy, len, angle, fishColors[i % fishColors.length]);
  }
  const backdropTexture = new THREE.CanvasTexture(canvas);
  backdropTexture.colorSpace = THREE.SRGBColorSpace;
  const backdropMaterial = new THREE.MeshStandardMaterial({ map: backdropTexture, roughness: 0.9 });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(0.92 * aspect, 0.92), backdropMaterial);
  // Clearly in front of the frame's front face (frame spans -0.13 to
  // -0.05) — a comfortable gap rather than the sliver that used to
  // cause z-fighting.
  backdrop.position.z = 0.0;
  group.add(backdrop);

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.22,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.96 * aspect, 0.96), glassMaterial);
  // Clearly in front of the backdrop, same reasoning as above.
  glass.position.z = 0.08;
  group.add(glass);
}

/**
 * A small museum-style exhibit placard: a brass-toned backing plate plus
 * a painted title + subtitle, meant to mount low on the wall next to a
 * tank window (see createTankWindow) to sell the "real aquarium/museum
 * exhibit hall" feel — the same kind of small placard real aquariums
 * mount beside every viewing window. Built at 1x1 unit-ish local scale
 * (roughly 0.6 wide x 0.35 tall) so callers can scale it uniformly.
 */
export function createExhibitLabel(title: string, subtitle: string): THREE.Group {
  const group = new THREE.Group();

  const backingMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7143, roughness: 0.4, metalness: 0.6 });
  const backing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.025), backingMaterial);
  group.add(backing);

  const width = 256;
  const height = 150;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c1712';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#c9a95c';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = '#e8d8a0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${height * 0.18}px Georgia, serif`;
  ctx.fillText(title.toUpperCase(), width / 2, height * 0.4);
  ctx.font = `${height * 0.12}px Georgia, serif`;
  ctx.fillStyle = '#b8ab86';
  ctx.fillText(subtitle, width / 2, height * 0.68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const faceMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.328), faceMaterial);
  face.position.z = 0.014;
  group.add(face);

  return group;
}

/** A thin decorative frieze strip for the upper wall line — simple molding plus a subtle aquarium-wave pattern. */
export function createUpperFrieze(aspect: number = 1): THREE.Group {
  const group = new THREE.Group();

  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x6c7d83, roughness: 0.75, metalness: 0.1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1 * aspect, 0.16, 0.03), baseMaterial);
  group.add(base);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#17394a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(192, 233, 244, 0.95)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const y = 18 + i * 13;
    ctx.beginPath();
    ctx.moveTo(-16, y);
    for (let x = 0; x <= canvas.width + 16; x += 32) {
      ctx.quadraticCurveTo(x - 8, y + (i % 2 === 0 ? -8 : 8), x + 8, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 221, 135, 0.85)';
  for (let i = 0; i < 10; i++) {
    const x = 34 + i * 48;
    ctx.beginPath();
    ctx.arc(x, 54 + ((i % 2) * 8 - 4), 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(aspect * 3.2, 1);
  texture.colorSpace = THREE.SRGBColorSpace;

  const faceMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1 * aspect, 0.12), faceMaterial);
  face.position.z = 0.018;
  group.add(face);

  return group;
}

/** A compact upper-wall service vent: slotted grille plus frame. */
export function createServiceVent(): THREE.Group {
  const group = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x5e666b, roughness: 0.7, metalness: 0.2 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.03), frameMaterial);
  group.add(frame);

  const slatMaterial = new THREE.MeshStandardMaterial({ color: 0x394449, roughness: 0.5, metalness: 0.35 });
  for (let i = -2; i <= 2; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.01), slatMaterial);
    slat.position.y = i * 0.04;
    group.add(slat);
  }

  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.012), new THREE.MeshStandardMaterial({ color: 0xb8c6ca, roughness: 0.45 }));
  accent.position.set(0.16, 0, 0.012);
  group.add(accent);
  return group;
}

/** A small upper-wall wayfinding sign with a label and arrow. */
export function createWayfindingSign(label: string, arrow: 'left' | 'right' | 'none' = 'none'): THREE.Group {
  const group = new THREE.Group();
  const backingMaterial = new THREE.MeshStandardMaterial({ color: 0x2a4d66, roughness: 0.55, metalness: 0.1 });
  const backing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.03), backingMaterial);
  group.add(backing);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3f0e7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#2a4d66';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.fillStyle = '#17394a';
  ctx.font = `bold 30px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 - 1);
  if (arrow !== 'none') {
    ctx.font = `bold 24px sans-serif`;
    ctx.fillText(arrow === 'left' ? '←' : '→', arrow === 'left' ? 26 : canvas.width - 26, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.18),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }),
  );
  face.position.z = 0.018;
  group.add(face);
  return group;
}

export interface OverheadLamp {
  group: THREE.Group;
  light: THREE.SpotLight;
}

/** A ceiling-mounted pendant lamp (rod + shade) with a broad spotlight aimed straight down, standing in for the room's overhead light source. */
export type CornerStatueKind = 'whale' | 'dolphin' | 'turtle' | 'shark';

/**
 * A weathered-bronze statue of a marine animal on a low stone pedestal,
 * for the room's four open diagonal corner floor squares — a museum
 * "gallery centerpiece" per corner, each a different species so the
 * four don't read as repeats of the same prop. All four share the same
 * pedestal and a single uniform bronze-statue material (no color
 * variation within a statue, unlike the murals/art), since real bronze
 * garden/museum statues are monochrome — only `kind` changes the body
 * shape built on top.
 */
export function createCornerStatue(kind: CornerStatueKind): THREE.Group {
  const group = new THREE.Group();

  const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x8f8f88, roughness: 0.85 });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 16), pedestalMaterial);
  pedestal.position.y = 0.09;
  group.add(pedestal);

  const bronze = new THREE.MeshStandardMaterial({ color: 0x5e6a5c, roughness: 0.45, metalness: 0.6 });
  const statue = new THREE.Group();
  statue.position.y = 0.18;

  if (kind === 'whale') {
    // A stubby, rounded body with small pectoral fins and a broad,
    // flattened tail fluke — reads as a breaching humpback silhouette.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), bronze);
    body.scale.set(1.5, 0.85, 0.95);
    body.position.set(0, 0.24, 0);
    statue.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 4), bronze);
    tail.scale.set(1, 0.25, 2.2);
    tail.rotation.z = -Math.PI / 2;
    tail.rotation.y = Math.PI / 4;
    tail.position.set(-0.42, 0.3, 0);
    statue.add(tail);
    [-1, 1].forEach((side) => {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), bronze);
      fin.scale.set(1, 0.3, 1.6);
      fin.rotation.z = side * 0.9;
      fin.position.set(0.05, 0.14, side * 0.22);
      statue.add(fin);
    });
  } else if (kind === 'dolphin') {
    // A sleek, arched body (leaping pose) with a curved dorsal fin,
    // a tapered beak-like snout, and an upswept tail fluke.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 10), bronze);
    body.rotation.z = Math.PI / 2 - 0.35;
    body.position.set(0, 0.3, 0);
    statue.add(body);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), bronze);
    snout.rotation.z = Math.PI / 2 - 0.35;
    snout.position.set(0.32, 0.45, 0);
    statue.add(snout);
    const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), bronze);
    dorsalFin.scale.set(1, 1, 0.3);
    dorsalFin.position.set(-0.02, 0.42, 0);
    statue.add(dorsalFin);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.05, 4), bronze);
    tail.scale.set(1, 0.25, 2.4);
    tail.rotation.x = Math.PI / 2;
    tail.rotation.z = 1.0;
    tail.position.set(-0.32, 0.14, 0);
    statue.add(tail);
  } else if (kind === 'turtle') {
    // A domed carapace, a small head craning forward, and four
    // paddle-like flippers splayed at the shell's corners.
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), bronze);
    shell.position.set(0, 0.16, 0);
    statue.add(shell);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), bronze);
    head.position.set(0.28, 0.15, 0);
    statue.add(head);
    [
      [0.16, 0.06, 0.22],
      [0.16, 0.06, -0.22],
      [-0.16, 0.06, 0.24],
      [-0.16, 0.06, -0.24],
    ].forEach(([fx, fy, fz]) => {
      const flipper = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), bronze);
      flipper.scale.set(1, 0.25, 1.6);
      flipper.rotation.z = Math.PI / 2;
      flipper.rotation.y = Math.atan2(fz, fx);
      flipper.position.set(fx, fy, fz);
      statue.add(flipper);
    });
  } else {
    // 'shark' — a torpedo-shaped body, a tall triangular dorsal fin,
    // twin pectoral fins, and an asymmetric heterocercal tail.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.46, 4, 10), bronze);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, 0.28, 0);
    statue.add(body);
    const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 4), bronze);
    dorsalFin.scale.set(1, 1, 0.25);
    dorsalFin.position.set(0, 0.44, 0);
    statue.add(dorsalFin);
    [-1, 1].forEach((side) => {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), bronze);
      fin.scale.set(1, 0.3, 1.4);
      fin.rotation.z = side * 1.1;
      fin.position.set(0.1, 0.2, side * 0.16);
      statue.add(fin);
    });
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 4), bronze);
    tail.scale.set(1, 1.4, 0.2);
    tail.rotation.z = -Math.PI / 2;
    tail.position.set(-0.32, 0.34, 0);
    statue.add(tail);
  }

  group.add(statue);
  return group;
}

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

  const light = new THREE.SpotLight(0xfff3d6, 0.95, 0, Math.PI / 3.4, 0.7, 1.2);
  light.position.set(0, -0.55, 0);
  const target = new THREE.Object3D();
  target.position.set(0, -1, 0);
  group.add(target);
  light.target = target;
  group.add(light);

  return { group, light };
}
