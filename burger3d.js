// 3D mode for Burger Builder. Loaded lazily by index.html the first time the 3D tab is opened.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const INGREDIENTS = {
    b: { label: 'Bun',     color: '#d9922f' },
    p: { label: 'Patty',   color: '#4a2c1a' },
    c: { label: 'Cheese',  color: '#ffc21a' },
    l: { label: 'Lettuce', color: '#7cc43f' },
    t: { label: 'Tomato',  color: '#e8412d' },
    o: { label: 'Onion',   color: '#efe0ee' },
    s: { label: 'Sauce',   color: '#c62828' },
    a: { label: 'Bacon',    color: '#a8322a' },
    k: { label: 'Pickles',  color: '#7fa831' },
    e: { label: 'Fried Egg', color: '#ffb81c' },
    m: { label: 'Mushroom', color: '#c9a77c' },
    j: { label: 'Jalapeño', color: '#3f8f2a' },
    v: { label: 'Avocado',  color: '#b5d56a' }
};

const PLATE_TOP = 0.12;
const DROP_HEIGHT = 5;
const GRAVITY = 30;

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
let viewport, renderer, scene, camera, controls, stage, assets;
let bokeh = [];
let confetti = [];

// ---------------------------------------------------------------- game state
const state = {
    playing: false,
    busy: false,
    sliding: false,
    score: 0,
    lives: 3,
    orders: 0,
    order: [],
    placed: [],      // keys placed so far
    items: [],       // falling / settled ingredient objects
    stackTop: 0,     // world y of the top of the stack (target heights)
    shake: 0
};

let active = false;
let inited = false;
let rafId = null;
let lastTime = 0;
let tweens = [];
let timers = [];
const gameTimer = new window.GameTimer('g3-time-left', () => gameOver("Time's up!"));

// ---------------------------------------------------------------- procedural textures
function canvasTexture(size, draw, { repeat, srgb = true } = {}) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(c);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    if (repeat) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat[0], repeat[1]);
    }
    return tex;
}

function blotches(ctx, size, colors, count, rMin, rMax, alpha) {
    for (let i = 0; i < count; i++) {
        const x = Math.random() * size, y = Math.random() * size;
        const r = rMin + Math.random() * (rMax - rMin);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const col = colors[Math.floor(Math.random() * colors.length)];
        g.addColorStop(0, col + Math.round(alpha * 255).toString(16).padStart(2, '0'));
        g.addColorStop(1, col + '00');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
}

function makeBunTexture() {
    return canvasTexture(512, (ctx, s) => {
        // Golden base, darker toward the bottom (v = 0), like a baked dome.
        const g = ctx.createLinearGradient(0, s, 0, 0);
        g.addColorStop(0, '#f0b45a');
        g.addColorStop(0.35, '#d98f2c');
        g.addColorStop(1, '#c47a1c');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        blotches(ctx, s, ['#8a4a10', '#a35c14', '#f6c777'], 260, 8, 40, 0.28);
        blotches(ctx, s, ['#6b3508'], 60, 4, 14, 0.25);
    });
}

function makePattyTexture() {
    return canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = '#4b2b19';
        ctx.fillRect(0, 0, s, s);
        blotches(ctx, s, ['#2a150a', '#6b3e22', '#1c0e06'], 700, 4, 22, 0.55);
        blotches(ctx, s, ['#8a5a36'], 120, 2, 7, 0.45);
    }, { repeat: [3, 1] });
}

function makePattyBump() {
    return canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, s, s);
        blotches(ctx, s, ['#000000', '#ffffff', '#303030', '#d0d0d0'], 900, 3, 14, 0.7);
    }, { repeat: [3, 1], srgb: false });
}

function makeTomatoTexture() {
    return canvasTexture(256, (ctx, s) => {
        const c = s / 2;
        ctx.fillStyle = '#d6301f';
        ctx.fillRect(0, 0, s, s);
        // Pale flesh and darker skin ring
        ctx.beginPath(); ctx.arc(c, c, c * 0.93, 0, Math.PI * 2);
        ctx.fillStyle = '#e8503a'; ctx.fill();
        // Seed chambers
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            ctx.save();
            ctx.translate(c + Math.cos(a) * c * 0.45, c + Math.sin(a) * c * 0.45);
            ctx.rotate(a);
            ctx.beginPath(); ctx.ellipse(0, 0, c * 0.3, c * 0.2, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#f48a62'; ctx.fill();
            for (let k = 0; k < 4; k++) {
                ctx.beginPath();
                ctx.ellipse((k - 1.5) * 9, (k % 2 ? 5 : -5), 4, 2.5, k, 0, Math.PI * 2);
                ctx.fillStyle = '#f8e7b0'; ctx.fill();
            }
            ctx.restore();
        }
        ctx.beginPath(); ctx.arc(c, c, c * 0.14, 0, Math.PI * 2);
        ctx.fillStyle = '#f7b99a'; ctx.fill();
    });
}

function makeBaconTexture() {
    return canvasTexture(256, (ctx, s) => {
        // Stripes run along u (the strip's length): lean meat, fat, lean meat...
        const bands = [['#a82b24', 0.3], ['#f1cdae', 0.12], ['#8f211b', 0.3], ['#eec3a0', 0.1], ['#a82b24', 0.18]];
        let y = 0;
        for (const [col, h] of bands) {
            ctx.fillStyle = col;
            ctx.fillRect(0, y * s, s, h * s + 1);
            y += h;
        }
        blotches(ctx, s, ['#5a130e', '#d86a4a'], 90, 3, 12, 0.35);
    });
}

function makePickleTexture() {
    return canvasTexture(256, (ctx, s) => {
        const c = s / 2;
        ctx.fillStyle = '#4f7d1f';
        ctx.fillRect(0, 0, s, s);
        let g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.9);
        g.addColorStop(0, '#d3e58a');
        g.addColorStop(0.55, '#a8c957');
        g.addColorStop(1, '#6f9a2c');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c, c, c * 0.9, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            ctx.beginPath();
            ctx.ellipse(c + Math.cos(a) * c * 0.38, c + Math.sin(a) * c * 0.38, 7, 4, a, 0, Math.PI * 2);
            ctx.fillStyle = '#f0f3c4'; ctx.fill();
        }
    });
}

function makeFloorTextures() {
    const tiles = 24;
    const map = canvasTexture(1024, (ctx, s) => {
        const t = s / tiles;
        for (let y = 0; y < tiles; y++) {
            for (let x = 0; x < tiles; x++) {
                ctx.fillStyle = (x + y) % 2 ? '#8f1a12' : '#c7281b';
                ctx.fillRect(x * t, y * t, t, t);
            }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 3;
        for (let i = 0; i <= tiles; i++) {
            ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke();
        }
    });
    const alpha = canvasTexture(256, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.55, '#a0a0a0');
        g.addColorStop(1, '#000000');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    }, { srgb: false });
    return { map, alpha };
}

function makeBackground() {
    return canvasTexture(512, (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, '#1a0403');
        g.addColorStop(0.55, '#4d0f0a');
        g.addColorStop(1, '#8a1d12');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    });
}

function makeGlowTexture() {
    return canvasTexture(128, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    });
}

// ---------------------------------------------------------------- geometry helpers
// Polar grid disc whose shape is defined by fn(r01, theta) -> [radiusScale, y].
function discGeometry(R, rings, segs, fn) {
    const pos = [0, fn(0, 0)[1], 0];
    const uv = [0.5, 0.5];
    for (let i = 1; i <= rings; i++) {
        const r01 = i / rings;
        for (let j = 0; j < segs; j++) {
            const th = (j / segs) * Math.PI * 2;
            const [rs, y] = fn(r01, th);
            const r = R * r01 * rs;
            pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
            uv.push(0.5 + Math.cos(th) * r01 * 0.5, 0.5 + Math.sin(th) * r01 * 0.5);
        }
    }
    const idx = [];
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
        const a = 1 + (i - 1) * segs, b = 1 + i * segs;
        for (let j = 0; j < segs; j++) {
            const j2 = (j + 1) % segs;
            idx.push(a + j, a + j2, b + j, a + j2, b + j2, b + j);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
}

function lathe(points, segs = 64) {
    return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

// ---------------------------------------------------------------- assets (built once, shared by every ingredient)
function buildAssets() {
    const A = { geo: {}, mat: {}, seeds: [] };

    const bunTex = makeBunTexture();
    A.mat.bun = new THREE.MeshPhysicalMaterial({
        map: bunTex, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.35
    });
    A.mat.seed = new THREE.MeshStandardMaterial({ color: '#f3e2b6', roughness: 0.45 });
    A.mat.patty = new THREE.MeshStandardMaterial({
        map: makePattyTexture(), bumpMap: makePattyBump(), bumpScale: 4, roughness: 0.82
    });
    A.mat.cheese = new THREE.MeshPhysicalMaterial({
        color: '#ffbf14', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide
    });
    A.mat.lettuce = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.55, side: THREE.DoubleSide
    });
    const tomatoTex = makeTomatoTexture();
    A.mat.tomatoSide = new THREE.MeshPhysicalMaterial({
        color: '#d3301f', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15
    });
    A.mat.tomatoFace = new THREE.MeshPhysicalMaterial({
        map: tomatoTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2
    });
    A.mat.onion = new THREE.MeshPhysicalMaterial({
        color: '#f2e2f0', roughness: 0.3, clearcoat: 0.7, transparent: true, opacity: 0.9,
        emissive: '#a07090', emissiveIntensity: 0.12
    });
    A.mat.sauce = new THREE.MeshPhysicalMaterial({
        color: '#c41e1e', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05
    });
    A.mat.plate = new THREE.MeshPhysicalMaterial({
        color: '#fbfbf7', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1
    });

    // Bottom bun: flat base, rounded edges
    A.geo.bunBottom = lathe([
        [0, 0], [1.05, 0], [1.2, 0.04], [1.27, 0.14], [1.27, 0.26], [1.2, 0.36], [1.05, 0.4], [0, 0.42]
    ]);

    // Top bun: superellipse dome
    const R = 1.28, H = 0.95;
    const dome = [[0, 0], [R * 0.97, 0], [R, 0.04]];
    for (let i = 1; i <= 24; i++) {
        const a = (i / 24) * Math.PI / 2;
        dome.push([R * Math.pow(Math.cos(a), 0.8), 0.04 + (H - 0.04) * Math.pow(Math.sin(a), 0.9)]);
    }
    A.geo.bunTop = lathe(dome, 72);
    A.geo.seed = new THREE.SphereGeometry(0.05, 10, 8);
    for (let i = 0; i < 38; i++) {
        const a = 0.12 + Math.random() * 1.0;
        const th = Math.random() * Math.PI * 2;
        const r = R * Math.pow(Math.cos(a), 0.8);
        const y = 0.04 + (H - 0.04) * Math.pow(Math.sin(a), 0.9);
        const p = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
        const n = new THREE.Vector3(p.x / (R * R), (p.y - 0.04) / (H * H), p.z / (R * R)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI));
        p.addScaledVector(n, 0.012);
        A.seeds.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 0.55, 1.7)));
    }

    // Patty: slightly domed puck with rounded edge
    A.geo.patty = lathe([
        [0, 0], [1.0, 0], [1.12, 0.03], [1.2, 0.12], [1.21, 0.22], [1.15, 0.3], [1.0, 0.33], [0, 0.34]
    ]);

    // Cheese: square slice with drooping corners
    const cheese = new THREE.BoxGeometry(2.3, 0.06, 2.3, 40, 1, 40);
    const cp = cheese.attributes.position;
    for (let i = 0; i < cp.count; i++) {
        const d = Math.hypot(cp.getX(i), cp.getZ(i));
        const over = Math.max(0, d - 0.95);
        cp.setY(i, cp.getY(i) + 0.03 - over * over * 0.85);
    }
    cheese.computeVertexNormals();
    A.geo.cheese = cheese;

    // Lettuce: ruffled leaf
    A.geo.lettuce = discGeometry(1.42, 18, 96, (r, th) => {
        const rs = 1 + 0.07 * Math.sin(7 * th + 1.3) + 0.04 * Math.sin(13 * th);
        const amp = 0.025 + 0.13 * r * r;
        const y = 0.06 + amp * Math.sin(th * 11 + r * 4) + 0.04 * Math.sin(th * 5 - r * 6) * r;
        return [rs, y];
    });
    const lp = A.geo.lettuce.attributes.position;
    const lc = [];
    const dark = new THREE.Color('#4f9a2a'), light = new THREE.Color('#a6dc52');
    for (let i = 0; i < lp.count; i++) {
        const t = Math.min(1, Math.hypot(lp.getX(i), lp.getZ(i)) / 1.4);
        const col = dark.clone().lerp(light, t * t);
        lc.push(col.r, col.g, col.b);
    }
    A.geo.lettuce.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));

    // Tomato slice
    A.geo.tomato = new THREE.CylinderGeometry(1.02, 1.02, 0.15, 56);

    // Onion rings
    A.geo.onion = [1.0, 0.74, 0.48].map((r) => new THREE.TorusGeometry(r, 0.05, 10, 64));

    // Sauce: spiral drizzle
    const pts = [];
    const N = 220;
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        const ang = t * 3.4 * Math.PI * 2;
        const r = 0.08 + t * 1.0;
        pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.056 + 0.012 * Math.sin(i * 0.7), Math.sin(ang) * r));
    }
    A.geo.sauce = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 480, 0.056, 10);

    // Bacon: wavy strips
    const bacon = new THREE.BoxGeometry(2.2, 0.05, 0.5, 70, 1, 4);
    const bp = bacon.attributes.position;
    for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i);
        bp.setY(i, bp.getY(i) + 0.045 + 0.045 * Math.sin(x * 6.5));
        bp.setZ(i, bp.getZ(i) + 0.05 * Math.sin(x * 9 + 1));
    }
    bacon.computeVertexNormals();
    A.geo.bacon = bacon;
    A.mat.bacon = new THREE.MeshPhysicalMaterial({
        map: makeBaconTexture(), roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4
    });

    // Pickle chips
    A.geo.pickle = new THREE.CylinderGeometry(0.38, 0.38, 0.08, 40);
    const pickleFace = new THREE.MeshPhysicalMaterial({
        map: makePickleTexture(), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2
    });
    const pickleSide = new THREE.MeshPhysicalMaterial({ color: '#5a8a22', roughness: 0.35, clearcoat: 0.8 });
    A.mat.pickle = [pickleSide, pickleFace, pickleFace];

    // Fried egg
    A.geo.eggWhite = discGeometry(1.1, 16, 72, (r, th) => {
        const rs = 1 + 0.12 * Math.sin(3 * th + 0.5) + 0.07 * Math.sin(5 * th + 2);
        return [rs, 0.025 + 0.07 * Math.pow(1 - r, 0.7) + 0.03 * Math.pow(Math.max(0, 1 - r * 2.2), 1)];
    });
    A.geo.eggYolk = new THREE.SphereGeometry(0.34, 32, 16);
    A.mat.eggWhite = new THREE.MeshPhysicalMaterial({
        color: '#fffcf2', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide
    });
    A.mat.eggYolk = new THREE.MeshPhysicalMaterial({
        color: '#ffa90d', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03,
        emissive: '#ff8a00', emissiveIntensity: 0.25
    });

    // Mushroom slices (cap + stem silhouette)
    const cap = new THREE.Shape();
    cap.moveTo(-0.45, -0.1);
    cap.absellipse(0, -0.1, 0.45, 0.42, Math.PI, 0, true);
    cap.lineTo(0.15, -0.1);
    cap.lineTo(0.15, -0.5);
    cap.lineTo(-0.15, -0.5);
    cap.lineTo(-0.15, -0.1);
    cap.closePath();
    A.geo.mushroom = new THREE.ExtrudeGeometry(cap, {
        depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 20
    });
    A.geo.mushroom.rotateX(-Math.PI / 2);
    A.geo.mushroom.translate(0, 0.015, 0);
    A.mat.mushroom = [
        new THREE.MeshStandardMaterial({ color: '#e6d3b0', roughness: 0.55 }),
        new THREE.MeshStandardMaterial({ color: '#8f6038', roughness: 0.6 })
    ];

    // Jalapeño rings
    A.geo.jalapenoRing = new THREE.TorusGeometry(0.27, 0.085, 14, 36);
    A.geo.jalapenoFill = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 28);
    A.mat.jalapeno = new THREE.MeshPhysicalMaterial({
        color: '#3f9a2c', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12
    });
    A.mat.jalapenoFill = new THREE.MeshStandardMaterial({ color: '#d4e48e', roughness: 0.6 });

    // Avocado slices (lens-shaped)
    const lens = new THREE.Shape();
    lens.moveTo(-0.55, 0);
    lens.absellipse(0, 0, 0.55, 0.4, Math.PI, 0, false);
    lens.absellipse(0, 0.05, 0.55, 0.22, 0, Math.PI, false);
    lens.closePath();
    A.geo.avocado = new THREE.ExtrudeGeometry(lens, {
        depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 3, curveSegments: 24
    });
    A.geo.avocado.rotateX(-Math.PI / 2);
    A.geo.avocado.translate(0, 0.015, 0);
    A.mat.avocado = [
        new THREE.MeshPhysicalMaterial({ color: '#c3da72', roughness: 0.35, clearcoat: 0.3 }),
        new THREE.MeshStandardMaterial({ color: '#3f5f18', roughness: 0.5 })
    ];

    // Plate
    A.geo.plate = lathe([
        [0, 0], [1.2, 0], [1.25, 0.03], [1.8, 0.1], [2.3, 0.22], [2.4, 0.27], [2.42, 0.31], [2.35, 0.33],
        [2.2, 0.29], [1.7, 0.18], [1.4, PLATE_TOP + 0.01], [0, PLATE_TOP]
    ], 96);

    return A;
}

// ---------------------------------------------------------------- ingredient meshes
// Each factory returns { group, h } where the group's origin is the bottom of the ingredient
// and h is how much vertical space it takes up in the stack.
function mesh(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

const FACTORIES = {
    bunBottom() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.bunBottom, assets.mat.bun));
        return { group: g, h: 0.4 };
    },
    bunTop() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.bunTop, assets.mat.bun));
        const seeds = new THREE.InstancedMesh(assets.geo.seed, assets.mat.seed, assets.seeds.length);
        assets.seeds.forEach((m, i) => seeds.setMatrixAt(i, m));
        seeds.castShadow = true;
        g.add(seeds);
        return { group: g, h: 0.95 };
    },
    p() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.patty, assets.mat.patty));
        return { group: g, h: 0.32 };
    },
    c() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.cheese, assets.mat.cheese));
        g.children[0].position.y = 0.03;
        g.rotation.y = Math.PI / 4 + (Math.random() - 0.5) * 0.3;
        return { group: g, h: 0.07, rotates: false };
    },
    l() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.lettuce, assets.mat.lettuce));
        const s = 0.95 + Math.random() * 0.1;
        g.scale.set(s, 1, s);
        return { group: g, h: 0.11 };
    },
    t() {
        const g = new THREE.Group();
        const m = mesh(assets.geo.tomato, [assets.mat.tomatoSide, assets.mat.tomatoFace, assets.mat.tomatoFace]);
        m.position.y = 0.075;
        g.add(m);
        return { group: g, h: 0.15 };
    },
    o() {
        const g = new THREE.Group();
        assets.geo.onion.forEach((geo) => {
            const ring = mesh(geo, assets.mat.onion);
            ring.rotation.x = Math.PI / 2;
            ring.scale.set(1, 1, 1.8);
            ring.position.y = 0.09;
            g.add(ring);
        });
        g.scale.set(1, 1, 1);
        return { group: g, h: 0.14 };
    },
    s() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.sauce, assets.mat.sauce));
        return { group: g, h: 0.11 };
    },
    a() {
        const g = new THREE.Group();
        [-0.58, 0, 0.58].forEach((z, i) => {
            const strip = mesh(assets.geo.bacon, assets.mat.bacon);
            strip.position.set((Math.random() - 0.5) * 0.1, 0.02, z);
            strip.rotation.y = (Math.random() - 0.5) * 0.12;
            strip.scale.x = i === 1 ? 1 : 0.88;
            g.add(strip);
        });
        return { group: g, h: 0.12 };
    },
    k() {
        const g = new THREE.Group();
        [[0, 0], [0.74, 0.22], [-0.74, 0.22], [0.4, -0.7], [-0.4, -0.7]].forEach(([x, z]) => {
            const chip = mesh(assets.geo.pickle, assets.mat.pickle);
            chip.position.set(x, 0.04, z);
            chip.scale.set(1 + Math.random() * 0.1, 1, 1 + Math.random() * 0.1);
            g.add(chip);
        });
        return { group: g, h: 0.09 };
    },
    e() {
        const g = new THREE.Group();
        g.add(mesh(assets.geo.eggWhite, assets.mat.eggWhite));
        const yolk = mesh(assets.geo.eggYolk, assets.mat.eggYolk);
        yolk.scale.y = 0.5;
        yolk.position.set(0.1, 0.07, 0.04);
        g.add(yolk);
        return { group: g, h: 0.25 };
    },
    m() {
        const g = new THREE.Group();
        [[-0.5, -0.38], [0.5, -0.34], [-0.46, 0.5], [0.5, 0.48]].forEach(([x, z]) => {
            const slice = mesh(assets.geo.mushroom, assets.mat.mushroom);
            slice.position.set(x, 0, z);
            slice.rotation.y = Math.random() * Math.PI * 2;
            slice.scale.setScalar(0.85);
            g.add(slice);
        });
        return { group: g, h: 0.1 };
    },
    j() {
        const g = new THREE.Group();
        [[0, 0], [0.72, 0.25], [-0.72, 0.25], [0.4, -0.72], [-0.4, -0.72]].forEach(([x, z]) => {
            const ring = mesh(assets.geo.jalapenoRing, assets.mat.jalapeno);
            ring.rotation.x = Math.PI / 2;
            ring.scale.z = 0.65;
            ring.position.set(x, 0.06, z);
            g.add(ring);
            const fill = mesh(assets.geo.jalapenoFill, assets.mat.jalapenoFill);
            fill.position.set(x, 0.055, z);
            g.add(fill);
        });
        return { group: g, h: 0.12 };
    },
    v() {
        const g = new THREE.Group();
        [-0.7, 0, 0.7].forEach((z) => {
            const slice = mesh(assets.geo.avocado, assets.mat.avocado);
            slice.position.set((Math.random() - 0.5) * 0.15, 0, z);
            slice.rotation.y = (Math.random() - 0.5) * 0.3;
            g.add(slice);
        });
        return { group: g, h: 0.1 };
    }
};

function makeIngredient(key, indexInOrder, orderLength) {
    if (key === 'b') {
        const isTop = indexInOrder > 0 && indexInOrder === orderLength - 1;
        return isTop ? FACTORIES.bunTop() : FACTORIES.bunBottom();
    }
    return FACTORIES[key]();
}

// ---------------------------------------------------------------- scene
function buildScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    viewport.insertBefore(renderer.domElement, viewport.firstChild);

    scene = new THREE.Scene();
    scene.background = makeBackground();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    scene.fog = new THREE.Fog('#3a0a07', 18, 40);

    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 3.2, 8.5);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.5;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.target.set(0, 0.8, 0);
    controls.addEventListener('start', () => { $('g3-hint').style.opacity = 0; });

    // Lights: warm key with shadows, golden rim from behind, soft fill
    const key = new THREE.DirectionalLight('#fff0d8', 3.2);
    key.position.set(5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6; key.shadow.camera.right = 6;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -4;
    key.shadow.camera.near = 1; key.shadow.camera.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    scene.add(key);

    const rim = new THREE.DirectionalLight('#ffc72c', 2.2);
    rim.position.set(-6, 5, -7);
    scene.add(rim);

    scene.add(new THREE.HemisphereLight('#ffe9cf', '#6b1810', 0.5));

    // Floor
    const { map, alpha } = makeFloorTextures();
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(16, 64),
        new THREE.MeshStandardMaterial({ map, alphaMap: alpha, transparent: true, roughness: 0.3, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.rotation.z = Math.PI / 8;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    // Stage = plate + ingredients (moves as one when an order finishes)
    stage = new THREE.Group();
    const plate = mesh(assets.geo.plate, assets.mat.plate);
    stage.add(plate);
    scene.add(stage);

    // Background bokeh
    const glow = makeGlowTexture();
    const colors = ['#ffc72c', '#ff9a3c', '#ff5a3c', '#ffe08a'];
    for (let i = 0; i < 22; i++) {
        const mat = new THREE.SpriteMaterial({
            map: glow, color: colors[i % colors.length], transparent: true,
            opacity: 0.18 + Math.random() * 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
        });
        const s = new THREE.Sprite(mat);
        const sc = 1.5 + Math.random() * 3.5;
        s.scale.set(sc, sc, 1);
        s.position.set((Math.random() - 0.5) * 30, Math.random() * 9 - 0.5, -8 - Math.random() * 8);
        s.userData = { baseY: s.position.y, phase: Math.random() * 6.28, speed: 0.2 + Math.random() * 0.4 };
        scene.add(s);
        bokeh.push(s);
    }
}

function resize() {
    if (!renderer) return;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- tweens / timers
function tween(dur, fn, done) {
    tweens.push({ t: 0, dur, fn, done });
}
function later(ms, fn) {
    timers.push({ t: ms / 1000, fn });
}
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

// ---------------------------------------------------------------- building the burger
function dropIngredient(key, index, order, instant = false) {
    const { group, h, rotates } = makeIngredient(key, index, order.length);
    const target = PLATE_TOP + state.stackTop;
    const finalRot = group.rotation.y + (rotates === false ? 0 : (Math.random() - 0.5) * 1.2);
    group.rotation.y = finalRot;
    group.position.set(0, instant ? target : target + DROP_HEIGHT, 0);
    stage.add(group);
    const item = {
        group, target, finalRot,
        vy: 0, landed: instant, squash: instant ? 1 : 0,
        spin: instant ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.8)
    };
    state.items.push(item);
    state.stackTop += h;
    return item;
}

function clearStage() {
    state.items.forEach((it) => stage.remove(it.group));
    state.items = [];
    state.stackTop = 0;
    state.placed = [];
}

function showDemo() {
    clearStage();
    const demo = ['b', 'p', 'c', 'a', 'e', 'l', 't', 'k', 's', 'b'];
    demo.forEach((k, i) => dropIngredient(k, i, demo, true));
}

function updateItems(dt) {
    for (const it of state.items) {
        if (!it.landed) {
            it.vy -= GRAVITY * dt;
            it.group.position.y += it.vy * dt;
            it.spin *= Math.pow(0.02, dt);
            it.group.rotation.y = it.finalRot + it.spin;
            if (it.group.position.y <= it.target) {
                it.group.position.y = it.target;
                if (Math.abs(it.vy) > 4) {
                    it.vy = -it.vy * 0.22;
                    it.squash = 0.001;
                } else {
                    it.vy = 0;
                    it.landed = true;
                    it.group.rotation.y = it.finalRot;
                }
            }
        }
        // Squash & stretch on impact
        if (it.squash > 0 && it.squash < 1) {
            it.squash = Math.min(1, it.squash + dt * 3);
            const k = Math.exp(-it.squash * 5) * Math.cos(it.squash * 18);
            const sy = 1 - 0.22 * k, sxz = 1 + 0.1 * k;
            const base = it.group.userData.baseScale || (it.group.userData.baseScale = it.group.scale.clone());
            it.group.scale.set(base.x * sxz, base.y * sy, base.z * sxz);
            if (it.squash >= 1) it.group.scale.copy(base);
        }
    }
}

// ---------------------------------------------------------------- confetti
function burstConfetti() {
    const palette = ['#ffc72c', '#da291c', '#ffffff', '#27ae60', '#ff8a3c'];
    const geo = new THREE.BoxGeometry(0.14, 0.02, 0.22);
    for (let i = 0; i < 80; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            color: palette[i % palette.length], roughness: 0.5, side: THREE.DoubleSide
        }));
        m.position.set((Math.random() - 0.5) * 1.5, stage.position.y + state.stackTop + 0.6, (Math.random() - 0.5) * 1.5);
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
        m.userData = {
            v: new THREE.Vector3(Math.cos(a) * sp, 5 + Math.random() * 5, Math.sin(a) * sp),
            spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
            life: 1.6 + Math.random() * 0.6
        };
        m.castShadow = true;
        scene.add(m);
        confetti.push(m);
    }
}

function updateConfetti(dt) {
    for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i], d = c.userData;
        d.life -= dt;
        d.v.y -= 14 * dt;
        d.v.multiplyScalar(1 - 0.6 * dt);
        c.position.addScaledVector(d.v, dt);
        c.rotation.x += d.spin.x * dt; c.rotation.y += d.spin.y * dt; c.rotation.z += d.spin.z * dt;
        if (c.position.y < 0.03) { c.position.y = 0.03; d.v.set(0, 0, 0); d.spin.multiplyScalar(0.8); }
        if (d.life < 0.4) c.scale.setScalar(Math.max(0.001, d.life / 0.4));
        if (d.life <= 0) {
            scene.remove(c);
            c.material.dispose();
            confetti.splice(i, 1);
        }
    }
}

// ---------------------------------------------------------------- HUD
function updateStats() {
    $('g3-score').textContent = state.score;
    $('g3-orders').textContent = state.orders;
    $('g3-lives').textContent = '❤️'.repeat(state.lives) + '🖤'.repeat(3 - state.lives);
}

let toastTimer = null;
function toast(text, kind) {
    const el = $('g3-toast');
    el.textContent = text;
    el.className = 'g3-toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'g3-toast'; }, 1400);
}

function renderOrder() {
    const list = $('g3-order-items');
    list.innerHTML = '';
    window.layoutOrderColumns(list, state.order.length);
    state.order.forEach((k, i) => {
        const info = INGREDIENTS[k];
        const row = document.createElement('div');
        row.className = 'order-item';
        row.innerHTML = `<span class="dot" style="background:${info.color}"></span>${info.label}<span class="step">${k.toUpperCase()} </span>`;
        list.appendChild(row);
    });
    updateOrderProgress();
}

function updateOrderProgress() {
    const rows = $('g3-order-items').children;
    for (let i = 0; i < rows.length; i++) {
        rows[i].classList.toggle('done', i < state.placed.length);
        rows[i].classList.toggle('next', i === state.placed.length);
    }
}

// ---------------------------------------------------------------- game flow
function newOrder() {
    state.order = window.makeOrder(state.orders);
    state.placed = [];
    renderOrder();
}

export function start() {
    if (!inited) return;
    timers = [];
    tweens = [];
    state.shake = 0;
    clearTimeout(toastTimer);
    $('g3-toast').className = 'g3-toast';
    state.score = 0;
    state.lives = 3;
    state.orders = 0;
    state.busy = false;
    state.sliding = false;
    state.playing = true;
    updateStats();
    clearStage();
    stage.position.x = 0;
    controls.autoRotate = false;
    $('g3-start').classList.add('hidden');
    newOrder();
    gameTimer.start(active);
}

function press(key) {
    if (!active || !state.playing || !gameTimer.tick() || state.busy) return;
    if (!INGREDIENTS[key]) return;

    const idx = state.placed.length;
    if (key !== state.order[idx]) return mistake(key);

    state.placed.push(key);
    dropIngredient(key, idx, state.order);
    updateOrderProgress();

    if (state.placed.length === state.order.length) completeOrder();
}

function mistake(key) {
    state.lives--;
    updateStats();
    state.shake = 0.45;
    const fl = $('g3-flash');
    fl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove('on')));
    const need = INGREDIENTS[state.order[state.placed.length]].label;
    toast(`Wrong! ${INGREDIENTS[key].label} ≠ ${need} 💔`, 'bad');
    if (state.lives <= 0) gameOver();
}

function completeOrder() {
    state.busy = true;
    state.score += 100;
    state.orders++;
    later(750, () => {
        updateStats();
        toast('Order up! +100 🎉', 'good');
        burstConfetti();
    });
    later(1700, () => {
        state.sliding = true;
        const x0 = stage.position.x;
        tween(0.55, (p) => { stage.position.x = x0 + 12 * easeInOut(p); }, () => {
            clearStage();
            confetti.forEach((c) => c.scale.setScalar(0.001));
            newOrder();
            state.busy = false;
            tween(0.55, (p) => { stage.position.x = -12 * (1 - easeInOut(p)); }, () => {
                stage.position.x = 0;
                state.sliding = false;
            });
        });
    });
}

function gameOver(title = 'Game Over!') {
    state.playing = false;
    state.busy = true;
    gameTimer.stop();
    timers = [];
    tweens = [];
    updateStats();
    later(900, () => {
        $('g3-start-title').textContent = title;
        $('g3-start-text').innerHTML = `Final Score: <b>${state.score}</b><br>Orders Completed: <b>${state.orders}</b>`;
        $('g3-start-btn').textContent = 'Play Again';
        $('g3-start').classList.remove('hidden');
        controls.autoRotate = true;
    });
}

// ---------------------------------------------------------------- main loop
function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
    lastTime = now;

    updateItems(dt);
    updateConfetti(dt);

    for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i];
        tw.t += dt;
        const p = Math.min(1, tw.t / tw.dur);
        tw.fn(p);
        if (p >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); }
    }
    for (let i = timers.length - 1; i >= 0; i--) {
        timers[i].t -= dt;
        if (timers[i].t <= 0) { const fn = timers[i].fn; timers.splice(i, 1); fn(); }
    }

    // Shake on mistakes (only when the stage isn't mid-slide)
    if (state.shake > 0 && !state.busy && !state.sliding) {
        state.shake = Math.max(0, state.shake - dt);
        stage.position.x = Math.sin(state.shake * 60) * state.shake * 0.5;
    } else if (state.shake > 0) {
        state.shake = 0;
    }

    // Camera framing: follow the top of the stack and back off as it grows.
    const goalY = Math.max(0.7, state.stackTop * 0.5 + 0.2);
    const goalDist = 8 + state.stackTop * 0.85;
    const offset = camera.position.clone().sub(controls.target);
    controls.target.y += (goalY - controls.target.y) * Math.min(1, dt * 3);
    offset.setLength(offset.length() + (goalDist - offset.length()) * Math.min(1, dt * 3));
    camera.position.copy(controls.target).add(offset);
    controls.update();

    const t = now / 1000;
    for (const s of bokeh) {
        s.position.y = s.userData.baseY + Math.sin(t * s.userData.speed + s.userData.phase) * 0.6;
    }

    renderer.render(scene, camera);
}

export function setActive(on) {
    active = on;
    if (on) gameTimer.resume();
    else gameTimer.pause();
    if (!inited) return;
    if (on) {
        resize();
        if (!rafId) { lastTime = performance.now(); rafId = requestAnimationFrame(frame); }
    } else if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

export async function init() {
    if (inited) return;
    viewport = $('g3-viewport');
    assets = buildAssets();
    buildScene();

    // On-screen ingredient pad (also works for touch)
    const pad = $('g3-pad');
    for (const [k, info] of Object.entries(INGREDIENTS)) {
        const btn = document.createElement('button');
        btn.innerHTML = `<span class="key">${k.toUpperCase()}</span> ${info.label}`;
        btn.addEventListener('click', () => press(k));
        pad.appendChild(btn);
    }

    document.addEventListener('keydown', (e) => {
        if (!active || !state.playing || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        const key = e.key.toLowerCase();
        if (INGREDIENTS[key]) {
            e.preventDefault();
            press(key);
        }
    });

    new ResizeObserver(resize).observe(viewport);
    inited = true;
    showDemo();

    const btn = $('g3-start-btn');
    btn.disabled = false;
    btn.textContent = 'Start Game';
    resize();
    setActive(active);
}
