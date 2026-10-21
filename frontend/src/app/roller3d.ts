// Petit modèle 3D d'un roller (roll conteneur) qui montre où photographier la casse.
// La partie concernée (paroi, roulettes ou plateaux) s'affiche en rouge, une flèche la pointe et la caméra
// se place sous le bon angle. Le modèle oscille doucement ; on peut aussi le tourner du doigt ou à la souris.
// three.js est chargé à la demande (uniquement quand la fenêtre de maintenance en a besoin).

import type * as THREE_NS from 'three';

export type RollerPart = 'paroi' | 'roulettes' | 'plateaux';

export interface IRoller3D {
  setFocus(part: RollerPart): void;
  dispose(): void;
}

// Dimensions (mètres) d'un roll conteneur de blanchisserie.
const W = 0.72; // largeur
const D = 0.62; // profondeur
const H = 1.55; // hauteur hors tout
const BASE_Y = 0.15; // dessus du socle ≈ 0,17
const SHELVES_Y = [0.62, 1.08];
const WHEEL_R = 0.055;

// Angle de vue pour chaque partie : le roller entier reste visible, la partie concernée au premier plan.
const VIEWS: Record<RollerPart, { camera: [number, number, number]; target: [number, number, number] }> = {
  roulettes: { camera: [2.05, 0.55, 2.6], target: [0, 0.62, 0] },
  paroi: { camera: [3.0, 1.55, 1.45], target: [0, 0.78, 0] },
  plateaux: { camera: [1.25, 1.75, 3.0], target: [0, 0.8, 0] },
};

// Point visé par la flèche et direction d'où elle arrive (dans le repère du roller).
const POINTERS: Record<RollerPart, { at: [number, number, number]; from: [number, number, number] }> = {
  roulettes: { at: [W / 2 - 0.06 + 0.03, WHEEL_R + 0.02, D / 2 - 0.06 + 0.03], from: [0.75, 0.55, 0.35] },
  paroi: { at: [W / 2 + 0.02, 0.95, 0.05], from: [1, 0.2, 0.15] },
  plateaux: { at: [0.05, SHELVES_Y[1] + 0.03, D / 2 - 0.04], from: [0.35, 0.75, 1] },
};

export async function mountRoller3D(host: HTMLElement, initial: RollerPart): Promise<IRoller3D> {
  const THREE: typeof THREE_NS = await import(/* chargé à la demande */ 'three');

  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    throw new Error('webgl');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'mrt-3d-canvas';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 4 / 3, 0.05, 20);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2.5, 4, 3);
  scene.add(sun);

  // ---------- Matériaux ----------
  const metal = new THREE.MeshStandardMaterial({ color: 0xc4c9d0, metalness: 0.55, roughness: 0.42 });
  const wire = new THREE.MeshStandardMaterial({ color: 0xaeb4bc, metalness: 0.5, roughness: 0.5 });
  const plate = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.3, roughness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.85 });
  const highlight = new THREE.MeshStandardMaterial({
    color: 0xe60021,
    emissive: 0xe60021,
    emissiveIntensity: 0.35,
    metalness: 0.2,
    roughness: 0.5,
  });

  const roller = new THREE.Group();
  scene.add(roller);
  const parts: Record<RollerPart, THREE_NS.Mesh[]> = { paroi: [], roulettes: [], plateaux: [] };
  const baseMaterial = new Map<THREE_NS.Mesh, THREE_NS.Material>();

  const add = (mesh: THREE_NS.Mesh, material: THREE_NS.Material, part?: RollerPart): THREE_NS.Mesh => {
    mesh.material = material;
    roller.add(mesh);
    if (part) {
      parts[part].push(mesh);
      baseMaterial.set(mesh, material);
    }
    return mesh;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE_NS.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    m.position.set(x, y, z);
    return m;
  };
  // Barreau entre deux points (tubes du cadre et fils des grilles).
  const bar = (a: THREE_NS.Vector3, b: THREE_NS.Vector3, radius: number): THREE_NS.Mesh => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const v = (x: number, y: number, z: number): THREE_NS.Vector3 => new THREE.Vector3(x, y, z);

  // ---------- Socle ----------
  add(box(W, 0.04, D, 0, BASE_Y, 0), metal);

  // ---------- Roulettes (4 roulettes pivotantes) ----------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - 0.06);
      const z = sz * (D / 2 - 0.06);
      add(box(0.07, 0.012, 0.07, x, BASE_Y - 0.026, z), metal, 'roulettes');
      for (const side of [-1, 1]) add(box(0.008, 0.07, 0.05, x + side * 0.024, BASE_Y - 0.065, z), metal, 'roulettes');
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.034, 24));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, WHEEL_R, z);
      add(wheel, rubber, 'roulettes');
    }
  }

  // ---------- Parois : gauche, droite et fond (l'avant est ouvert) ----------
  const top = H;
  const bottom = BASE_Y + 0.02;
  const walls: [THREE_NS.Vector3, THREE_NS.Vector3][] = [
    [v(-W / 2, 0, D / 2), v(-W / 2, 0, -D / 2)], // gauche
    [v(W / 2, 0, D / 2), v(W / 2, 0, -D / 2)], // droite
    [v(-W / 2, 0, -D / 2), v(W / 2, 0, -D / 2)], // fond
  ];
  for (const [a, b] of walls) {
    // Cadre
    for (const p of [a, b]) add(bar(v(p.x, bottom, p.z), v(p.x, top, p.z), 0.013), metal, 'paroi');
    add(bar(v(a.x, top, a.z), v(b.x, top, b.z), 0.013), metal, 'paroi');
    // Grille : fils verticaux et horizontaux
    const len = a.distanceTo(b);
    const nv = Math.round(len / 0.1);
    for (let i = 1; i < nv; i++) {
      const t = i / nv;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      add(bar(v(x, bottom, z), v(x, top, z), 0.0045), wire, 'paroi');
    }
    for (let y = bottom + 0.12; y < top - 0.05; y += 0.12) add(bar(v(a.x, y, a.z), v(b.x, y, b.z), 0.0045), wire, 'paroi');
  }

  // ---------- Plateaux ----------
  for (const y of SHELVES_Y) add(box(W - 0.03, 0.022, D - 0.03, 0, y, 0), plate, 'plateaux');

  // ---------- Sol (ombre douce) ----------
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.07 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  scene.add(floor);

  // ---------- Flèche « photographiez ici » ----------
  const arrow = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 20), highlight);
  cone.position.y = 0.07;
  cone.rotation.x = Math.PI; // pointe vers le bas (−y local)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 12), highlight);
  shaft.position.y = 0.27;
  arrow.add(cone, shaft);
  roller.add(arrow);

  // ---------- Mise au point sur une partie ----------
  let focus: RollerPart = initial;
  const camFrom = new THREE.Vector3();
  const camTo = new THREE.Vector3();
  const lookFrom = new THREE.Vector3();
  const lookTo = new THREE.Vector3();
  const look = new THREE.Vector3();
  let travel = 1; // 0 → 1 pendant le déplacement de caméra
  const arrowAt = new THREE.Vector3();
  const arrowDir = new THREE.Vector3();

  function applyFocus(part: RollerPart, animate: boolean): void {
    focus = part;
    (Object.keys(parts) as RollerPart[]).forEach((p) =>
      parts[p].forEach((mesh) => {
        mesh.material = p === part ? highlight : (baseMaterial.get(mesh) as THREE_NS.Material);
      }),
    );
    const view = VIEWS[part];
    camFrom.copy(camera.position);
    lookFrom.copy(look);
    camTo.set(...view.camera);
    lookTo.set(...view.target);
    if (!animate) {
      camera.position.copy(camTo);
      look.copy(lookTo);
      travel = 1;
    } else {
      travel = 0;
    }
    const pointer = POINTERS[part];
    arrowAt.set(...pointer.at);
    arrowDir.set(...pointer.from).normalize();
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDir);
  }
  applyFocus(initial, false);

  // ---------- Taille ----------
  const resize = (): void => {
    const width = host.clientWidth || 320;
    const height = host.clientHeight || Math.round(width * 0.75);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // ---------- Rotation au doigt / à la souris ----------
  let dragOffset = 0;
  let dragX: number | null = null;
  const onDown = (e: PointerEvent): void => {
    dragX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (dragX === null) return;
    dragOffset += (e.clientX - dragX) * 0.012;
    dragX = e.clientX;
  };
  const onUp = (): void => {
    dragX = null;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ---------- Animation ----------
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const start = performance.now();
  let frame = 0;
  const ease = (t: number): number => 1 - Math.pow(1 - t, 3);
  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick);
    if (document.hidden) return;
    const t = (now - start) / 1000;
    if (travel < 1) {
      travel = Math.min(1, travel + 1 / 40);
      const k = ease(travel);
      camera.position.lerpVectors(camFrom, camTo, k);
      look.lerpVectors(lookFrom, lookTo, k);
    }
    roller.rotation.y = (calm ? 0 : Math.sin(t * 0.6) * 0.32) + dragOffset;
    highlight.emissiveIntensity = calm ? 0.4 : 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3.2));
    const bob = calm ? 0 : 0.03 * (0.5 + 0.5 * Math.sin(t * 3.2));
    arrow.position.copy(arrowAt).addScaledVector(arrowDir, 0.03 + bob);
    camera.lookAt(look);
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  return {
    setFocus: (part: RollerPart) => {
      if (part !== focus) applyFocus(part, true);
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((obj) => {
        const mesh = obj as THREE_NS.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      [metal, wire, plate, rubber, highlight, floor.material as THREE_NS.Material].forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
