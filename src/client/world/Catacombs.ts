import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Particles/particleSystemComponent";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";

import {
  CAT_CEIL,
  CAT_CORRIDOR_HALF,
  CAT_FLOOR_Y,
  CAT_HALLS,
  CAT_PHASE,
  CAT_PORTAL,
  CAT_SHRINES,
  CAT_THEMES,
  catCorridor,
  inCatRegion,
} from "#shared/catacombs";
import { terrainHeight } from "#shared/terrain";
import { makeFireMaterial } from "./FireShader";

/** Что о катакомбах знает клиент (из RoomState). */
export interface CatView {
  phase: number;
  lo: number;
  hi: number;
  left: number;
  party: number;
  final: boolean;
  /** Темы залов на заход («0,2,1,3» — индексы CAT_THEMES по залам). */
  themes: string;
  /** Святилище: индекс CAT_SHRINES (−1 — нет) и место. */
  shrine: number;
  shrineX: number;
  shrineZ: number;
}

/** CatView из RoomState — одинаково у игрока и зрителя. */
export function catViewOf(st: {
  catPhase: number; catLo: number; catHi: number; catLeft: number; catParty: number; catFinal: number;
  catThemes: string; catShrine: number; catShrineX: number; catShrineZ: number;
}): CatView {
  return {
    phase: st.catPhase, lo: st.catLo, hi: st.catHi, left: st.catLeft, party: st.catParty, final: st.catFinal === 1,
    themes: st.catThemes, shrine: st.catShrine, shrineX: st.catShrineX, shrineZ: st.catShrineZ,
  };
}

/** Огонь по темам зала: склеп — обычный, костница — болотный зелёный, яма — багровый, лунный — призрачно-синий. */
const THEME_FIRE: Record<string, [string, string, string]> = {
  crypt: ["#ffdf9c", "#ff560c", "#5c0a00"],
  ossuary: ["#f0ffb8", "#7fd41a", "#123d00"],
  pit: ["#ffd27a", "#ff2a04", "#3d0000"],
  moon: ["#e6f2ff", "#4f86ff", "#0a1450"],
};
/** Пылинки по темам: пыль, споры, угли, лунная пыль. */
const THEME_MOTES: Record<string, { c1: [number, number, number, number]; c2: [number, number, number, number]; up: number }> = {
  crypt: { c1: [1, 0.7, 0.4, 0.5], c2: [1, 0.5, 0.2, 0.35], up: 0.25 },
  ossuary: { c1: [0.6, 1, 0.4, 0.5], c2: [0.4, 0.9, 0.3, 0.3], up: 0.15 },
  pit: { c1: [1, 0.55, 0.15, 0.85], c2: [1, 0.25, 0.05, 0.6], up: 1.1 },
  moon: { c1: [0.7, 0.85, 1, 0.55], c2: [0.55, 0.6, 1, 0.35], up: 0.12 },
};

/** Каменная плитка: тёмные плиты с швами (процедурно, без файлов). */
function stoneTexture(scene: Scene, name: string, base: [number, number, number], tiles: number): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const c = (k: number): string => `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
  g.fillStyle = c(0.55);
  g.fillRect(0, 0, S, S);
  const n = tiles;
  const step = S / n;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < n; y++) {
    const off = y % 2 ? step / 2 : 0;
    for (let x = -1; x < n; x++) {
      g.fillStyle = c(0.8 + rnd() * 0.45);
      g.fillRect(x * step + off + 2, y * step + 2, step - 4, step - 4);
      // трещинки и пятна
      g.fillStyle = c(0.5 + rnd() * 0.2);
      for (let k = 0; k < 3; k++) g.fillRect(x * step + off + rnd() * step, y * step + rnd() * step, 2 + rnd() * 6, 1 + rnd() * 3);
    }
  }
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

/** Радиальное свечение (ореол факела/портала). */
function glowTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("catGlow", { width: 128, height: 128 }, scene, false);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Тёплое свечение огня (оранжевый радиальный градиент) — для ореолов и пятен света. */
function warmGlowTexture(scene: Scene, name: string, core: number): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, false);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, `rgba(255,${Math.round(200 * core)},${Math.round(120 * core)},1)`);
  grd.addColorStop(0.3, "rgba(255,130,40,0.55)");
  grd.addColorStop(0.65, "rgba(160,50,10,0.18)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Мягкое цветное свечение (ниши, отблески): плавный спад без резкого края. */
function tintGlowTexture(scene: Scene, name: string, r: number, g: number, b: number): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, false);
  const c = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grd = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = (a: number): string => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  grd.addColorStop(0, col(0.75));
  grd.addColorStop(0.35, col(0.4));
  grd.addColorStop(0.7, col(0.12));
  grd.addColorStop(1, col(0));
  c.fillStyle = grd;
  c.fillRect(0, 0, 128, 128);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Бронзовая печать на полу: кольца, лучи, руны — инкрустация в камне (как печать в центре зала у референсов). */
function sealTexture(scene: Scene): DynamicTexture {
  const S = 512;
  const tex = new DynamicTexture("catSealTex", { width: S, height: S }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, S, S);
  const c = S / 2;
  g.strokeStyle = "rgba(200,150,70,0.95)";
  g.lineWidth = 10;
  for (const r of [246, 214, 130, 70]) {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 5;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * 130, c + Math.sin(a) * 130);
    g.lineTo(c + Math.cos(a) * 214, c + Math.sin(a) * 214);
    g.stroke();
  }
  // Руны между кольцами.
  g.fillStyle = "rgba(220,170,80,0.95)";
  g.font = "bold 30px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ";
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * Math.PI * 2;
    g.save();
    g.translate(c + Math.cos(a) * 172, c + Math.sin(a) * 172);
    g.rotate(a + Math.PI / 2);
    g.fillText(runes[i], 0, 0);
    g.restore();
  }
  // Звезда в центре.
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 26 : 66;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Дорожка-инкрустация на полу (от входа к стражу): тёмно-красная середина, бронзовая кайма. */
function runnerTexture(scene: Scene): DynamicTexture {
  const W = 128;
  const H = 512;
  const tex = new DynamicTexture("catRunnerTex", { width: W, height: H }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.fillStyle = "rgba(70,14,12,0.85)";
  g.fillRect(14, 0, W - 28, H);
  g.fillStyle = "rgba(190,140,60,0.9)";
  g.fillRect(6, 0, 8, H);
  g.fillRect(W - 14, 0, 8, H);
  g.strokeStyle = "rgba(190,140,60,0.55)";
  g.lineWidth = 3;
  for (let y = 32; y < H; y += 64) {
    g.beginPath();
    g.moveTo(W / 2, y - 22);
    g.lineTo(W / 2 + 26, y);
    g.lineTo(W / 2, y + 22);
    g.lineTo(W / 2 - 26, y);
    g.closePath();
    g.stroke();
  }
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Пятно крови/копоти на полу. */
function stainTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("catStainTex", { width: 128, height: 128 }, scene, false);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  let seed = 3;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (rnd() - 0.5) * 70;
    const y = 64 + (rnd() - 0.5) * 70;
    const r = 6 + rnd() * 22;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(70,4,4,0.85)");
    grd.addColorStop(1, "rgba(40,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Стена черепов (костница): ряды ниш, в каждой — череп. */
function skullWallTexture(scene: Scene): DynamicTexture {
  const W = 256;
  const H = 320;
  const tex = new DynamicTexture("catSkullWallTex", { width: W, height: H }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.fillStyle = "rgb(52,46,40)";
  g.fillRect(0, 0, W, H);
  let seed = 5;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cw = W / 5;
  const ch = H / 6;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const x = c * cw + (r % 2 ? cw / 2 : 0);
      const y = r * ch;
      g.fillStyle = "rgb(18,15,13)";
      g.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      const k = 0.75 + rnd() * 0.25;
      const bone = `rgb(${Math.round(215 * k)},${Math.round(200 * k)},${Math.round(160 * k)})`;
      const cx = x + cw / 2;
      const cy = y + ch * 0.48;
      g.fillStyle = bone;
      g.beginPath();
      g.ellipse(cx, cy, cw * 0.3, ch * 0.32, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(cx - cw * 0.16, cy + ch * 0.12, cw * 0.32, ch * 0.22);
      g.fillStyle = "rgb(20,16,14)";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + s * cw * 0.12, cy - ch * 0.02, cw * 0.08, ch * 0.09, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillRect(cx - 2, cy + ch * 0.1, 4, ch * 0.08);
    }
  }
  tex.update();
  return tex;
}

/** Трещины с лавой (огненная яма): светящиеся изломанные линии от центра к стенам, середина пустая (печать). */
function lavaCrackTexture(scene: Scene): DynamicTexture {
  const S = 512;
  const tex = new DynamicTexture("catLavaTex", { width: S, height: S }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, S, S);
  let seed = 17;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let i = 0; i < 14; i++) {
    let a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
    let r = S * (0.14 + rnd() * 0.06);
    const pts: [number, number][] = [];
    while (r < S * 0.48) {
      pts.push([S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r]);
      r += 10 + rnd() * 18;
      a += (rnd() - 0.5) * 0.22;
    }
    for (const [w, col] of [[9, "rgba(255,70,10,0.35)"], [4, "rgba(255,140,30,0.85)"], [1.5, "rgba(255,230,140,1)"]] as [number, string][]) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  }
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Кольцо святилища: светлый обод и руны (цвет — emissiveColor материала). */
function ringTexture(scene: Scene): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture("catShrineRingTex", { width: S, height: S }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, S, S);
  const c = S / 2;
  const grd = g.createRadialGradient(c, c, 0, c, c, c);
  grd.addColorStop(0, "rgba(255,255,255,0.5)");
  grd.addColorStop(0.5, "rgba(255,255,255,0.12)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(c, c, c * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c, c, c * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.font = "bold 22px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(c + Math.cos(a) * c * 0.74, c + Math.sin(a) * c * 0.74);
    g.rotate(a + Math.PI / 2);
    g.fillText(runes[i], 0, 0);
    g.restore();
  }
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Вертикальный градиент столба света (снизу ярко, кверху гаснет). */
function beamTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("catShrineBeamTex", { width: 16, height: 128 }, scene, false);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, "rgba(255,255,255,0.8)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.3)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 128);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/**
 * Катакомбы на клиенте: цепочка подземных залов (пол, стены с проёмами,
 * своды, колонны, факелы, руны, решётки, алтарь) и портал сбора в лагере.
 * Строится лениво — при первом сборе/забеге или когда камера рядом; свет
 * залов включается, только когда камера внутри (на поляне — ни одного
 * лишнего источника, бюджет Quest).
 */
export class CatacombsFx {
  private built = false;
  private root: TransformNode | null = null;
  /** Свет факелов по залам: включён только у зала(ов), где отряд, и только когда камера внизу. */
  private readonly hallLights: PointLight[][] = [];
  private readonly fireMats: ShaderMaterial[] = [];
  private readonly glowSprites: { mesh: Mesh; phase: number }[] = [];
  private readonly gates: { mesh: Mesh; i: number; y: number }[] = [];
  private sealMat: StandardMaterial | null = null;
  private time = 0;
  /** Пылинки и искры в воздухе текущего зала (одна система, переезжает за отрядом). */
  private motes: ParticleSystem | null = null;
  private motesHall = -1;
  /** Пятна света от огня по залам (свой материал — своё мерцание) и базовые позиции ламп. */
  private readonly poolMats: StandardMaterial[] = [];
  private readonly lightBase = new Map<PointLight, Vector3>();
  private litHalls = "";
  /** Темы залов (индексы CAT_THEMES): до первого забега — по порядку, дальше — с сервера на каждый заход. */
  private readonly hallTheme: number[] = CAT_HALLS.map((_, i) => i % CAT_THEMES.length);
  private themeSig = "";
  /** Что перекрашивается темой: пол/стены, ниши (2 цвета), ореолы огня, огонь, декор темы. */
  private readonly hallFloorMats: StandardMaterial[] = [];
  private readonly hallWallMats: StandardMaterial[] = [];
  private readonly hallNicheMats: StandardMaterial[][] = [];
  private readonly hallGlowMats: StandardMaterial[] = [];
  private readonly fireHall: number[] = [];
  private readonly themeDecor: Mesh[][][] = [];
  private lavaMats: StandardMaterial[] = [];
  private readonly mists: Mesh[] = [];
  // святилище
  private shrine: TransformNode | null = null;
  private shrineMats: StandardMaterial[] = [];
  private shrineOrb: Mesh | null = null;
  private shrineRing: Mesh | null = null;
  private shrineKind = -2;
  // портал в лагере
  private portal: TransformNode | null = null;
  private portalMat: StandardMaterial | null = null;
  private portalLabel: DynamicTexture | null = null;
  private portalSig = "";

  constructor(private readonly scene: Scene) {}

  /** Камера внутри подземелья (для музыки/света снаружи). */
  static inside(x: number, z: number): boolean {
    return inCatRegion(x, z);
  }

  update(dt: number, v: CatView | null, cam: { x: number; z: number }): void {
    this.time += dt;
    const inside = inCatRegion(cam.x, cam.z);
    const active = !!v && v.phase >= CAT_PHASE.run;
    if (!this.built && (inside || active)) this.build();
    if (this.root) this.root.setEnabled(inside || active);
    if (this.motes && !(inside || active) && this.motesHall >= 0) {
      this.motes.stop();
      this.motesHall = -1;
    }
    if (this.built) {
      // Свет — только залов отряда (lo..hi) и только если камера внизу: на поляне ни одного лишнего источника.
      const lo = v?.lo ?? 0;
      const hi = v?.hi ?? 0;
      const sig = inside ? `${lo}-${hi}` : "";
      if (sig !== this.litHalls) {
        this.litHalls = sig;
        this.hallLights.forEach((ls, i) => {
          const on = inside && i >= lo && i <= hi;
          for (const l of ls) if (l.isEnabled() !== on) l.setEnabled(on);
        });
      }
      if (v && v.themes && v.themes !== this.themeSig) this.applyThemes(v.themes);
      if (inside || active) this.animate(dt, v);
      this.updateShrine(v);
    }
    this.updatePortal(dt, v);
  }

  private animate(dt: number, v: CatView | null): void {
    const t = this.time;
    // Пылинки — в зале, где сейчас отряд.
    if (this.motes) {
      const hall = v && v.phase >= CAT_PHASE.run ? Math.min(CAT_HALLS.length - 1, v.hi) : -1;
      if (hall !== this.motesHall) {
        this.motesHall = hall;
        if (hall < 0) this.motes.stop();
        else {
          const h = CAT_HALLS[hall];
          (this.motes.emitter as Vector3).set(h.x, CAT_FLOOR_Y + 3, h.z);
          this.motes.minEmitBox.set(-h.r * 0.8, -2.5, -h.r * 0.8);
          this.motes.maxEmitBox.set(h.r * 0.8, 7, h.r * 0.8);
          this.themeMotes(hall);
          this.motes.start();
        }
      }
    }
    for (const m of this.fireMats) m.setFloat("uTime", t);
    // Решётки: открыт путь lo..hi — коридоры с lo по hi−1 подняты (к своду коридора, не в небо).
    const lo = v?.lo ?? 0;
    const hi = v?.hi ?? 0;
    for (const g of this.gates) {
      const open = g.i >= lo && g.i < hi;
      const want = open ? g.y + CAT_CEIL * 0.62 : g.y;
      const y = g.mesh.position.y;
      g.mesh.position.y = y + (want - y) * Math.min(1, dt * (open ? 0.9 : 3));
    }
    // Печать на полу: у Владыки — разгорается багровым.
    if (this.sealMat) {
      const k = 0.55 + 0.45 * Math.sin(t * 1.7);
      if (v?.final) this.sealMat.emissiveColor.set(0.5 * k + 0.2, 0.08 * k, 0.03);
      else this.sealMat.emissiveColor.set(0.16, 0.1, 0.04);
    }
    // Свет от огня: неровное мерцание (сумма «шумных» синусов), цвет гуляет от оранжевого
    // к красноватому, источник чуть дрожит — как живое пламя, а не лампа.
    const flick = (ph: number): number => 0.5 * Math.sin(t * 9.1 + ph) + 0.3 * Math.sin(t * 17.3 + ph * 1.7) + 0.2 * Math.sin(t * 31.7 + ph * 2.9);
    for (let h = 0; h < this.hallLights.length; h++) {
      const ls = this.hallLights[h];
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i];
        if (!l.isEnabled()) continue;
        const f = flick(i * 2.3 + h * 5.1);
        l.intensity = 1.45 + 0.35 * f;
        const tc = CAT_THEMES[this.hallTheme[h]].light;
        l.diffuse.set(tc[0], tc[1] * (1 + 0.18 * f), tc[2] * (1 + 0.3 * f));
        let b = this.lightBase.get(l);
        if (!b) {
          b = l.position.clone();
          this.lightBase.set(l, b);
        }
        l.position.set(b.x + 0.12 * Math.sin(t * 7 + i), b.y + 0.15 * flick(i + 9), b.z + 0.12 * Math.cos(t * 6 + i));
      }
    }
    for (let i = 0; i < this.poolMats.length; i++) {
      const f = flick(i * 3.7 + 1.3);
      this.poolMats[i].alpha = 0.62 + 0.16 * f;
    }
    // Лава в трещинах «дышит», туман лунного склепа медленно плывёт.
    for (let i = 0; i < this.lavaMats.length; i++) this.lavaMats[i].alpha = 0.7 + 0.25 * Math.sin(t * 1.3 + i * 2);
    for (let i = 0; i < this.mists.length; i++) this.mists[i].rotation.y = t * (i % 2 ? 0.03 : -0.04) + i;
    for (const g of this.glowSprites) {
      const k = 0.85 + 0.12 * Math.sin(t * 13 + g.phase) + 0.06 * Math.sin(t * 31 + g.phase * 2);
      g.mesh.scaling.setAll(k);
    }
  }

  private build(): void {
    this.built = true;
    const scene = this.scene;
    const root = new TransformNode("catacombs", scene);
    this.root = root;
    // Своя текстура на каждый материал: clone() у DynamicTexture так и не становится
    // «готовой» — меши с ней движок не рисовал (не было пола и стен).
    const FLOOR: [number, number, number] = [120, 112, 104];
    const WALL: [number, number, number] = [96, 90, 86];
    const mat = (name: string, tex: [number, number, number] | null, dif: [number, number, number], emi: [number, number, number], u = 1, vv = 1): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      if (tex) {
        const t = stoneTexture(scene, `${name}Tex`, tex, tex === FLOOR ? 6 : 5);
        t.uScale = u;
        t.vScale = vv;
        m.diffuseTexture = t;
      }
      m.diffuseColor = new Color3(...dif);
      m.emissiveColor = new Color3(...emi);
      m.specularColor = new Color3(0.05, 0.04, 0.03);
      // До 6 факелов зала на материал (по умолчанию 4; больше — дорого для Quest).
      m.maxSimultaneousLights = 6;
      return m;
    };
    // Темно: собственного свечения чуть-чуть, остальное — факелы.
    const floorMat = mat("catFloor", FLOOR, [0.95, 0.88, 0.8], [0.06, 0.05, 0.055], 6, 6);
    const wallMat = mat("catWall", WALL, [0.85, 0.78, 0.72], [0.045, 0.04, 0.045], 10, 2);
    const ceilMat = mat("catCeil", WALL, [0.4, 0.36, 0.36], [0.02, 0.018, 0.024], 6, 6);
    const pillarMat = mat("catPillar", WALL, [0.9, 0.84, 0.78], [0.05, 0.045, 0.045], 1, 3);
    const ironMat = mat("catIron", null, [0.16, 0.14, 0.12], [0.015, 0.012, 0.01]);
    const boneMat = mat("catBone", null, [0.85, 0.8, 0.66], [0.04, 0.035, 0.03]);
    // Знамёна разных цветов (багровое, синее, зелёное, золотое) — краски на стенах.
    const BANNERS: [string, [number, number, number]][] = [
      ["Red", [0.48, 0.05, 0.06]], ["Blue", [0.08, 0.16, 0.48]], ["Green", [0.06, 0.32, 0.14]], ["Gold", [0.55, 0.38, 0.08]],
    ];
    const bannerMats = BANNERS.map(([n, c]) => {
      const m = mat(`catCloth${n}`, null, c, [c[0] * 0.08, c[1] * 0.08, c[2] * 0.08]);
      m.backFaceCulling = false;
      return m;
    });
    let bannerLists: Mesh[][] = BANNERS.map(() => []);
    const urnMat = mat("catUrn", null, [0.45, 0.3, 0.18], [0.02, 0.015, 0.01]);
    const glowTex = glowTexture(scene);
    // Цвет — из самой текстуры (emissiveColor складывается с ней и выбелил бы огонь).
    const warmTex = warmGlowTexture(scene, "catWarmGlow", 1);
    // Пятна от огня — мягкие (без резкого края), тёплые.
    const poolTex = tintGlowTexture(scene, "catPoolGlow", 1, 1, 1);
    const glowMat = new StandardMaterial("catTorchGlow", scene);
    glowMat.emissiveTexture = warmTex;
    glowMat.opacityTexture = warmTex;
    glowMat.emissiveColor = new Color3(0, 0, 0);
    glowMat.alpha = 0.55;
    glowMat.diffuseColor = new Color3(0, 0, 0);
    glowMat.disableLighting = true;
    glowMat.alphaMode = Constants.ALPHA_ADD;
    glowMat.disableDepthWrite = true;
    // Своё у каждого зала — тема захода перекрашивает (applyThemes). Текстуры общие (без clone).
    const nicheTex = tintGlowTexture(scene, "catNicheWhite", 1, 1, 1);
    const addMat = (name: string, opacity: DynamicTexture, alpha: number): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.opacityTexture = opacity;
      m.emissiveColor = new Color3(1, 0.5, 0.16);
      m.diffuseColor = new Color3(0, 0, 0);
      m.disableLighting = true;
      m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true;
      m.backFaceCulling = false;
      m.alpha = alpha;
      return m;
    };
    const hallStone = (base: StandardMaterial, name: string): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseTexture = base.diffuseTexture;
      m.diffuseColor = base.diffuseColor.clone();
      m.emissiveColor = base.emissiveColor.clone();
      m.specularColor = base.specularColor.clone();
      m.maxSimultaneousLights = 6;
      return m;
    };
    CAT_HALLS.forEach((_, hi) => {
      this.hallFloorMats.push(hallStone(floorMat, `catFloorH${hi}`));
      this.hallWallMats.push(hallStone(wallMat, `catWallH${hi}`));
      this.hallGlowMats.push(addMat(`catTorchGlowH${hi}`, warmTex, 0.55));
      this.hallNicheMats.push([addMat(`catNicheA${hi}`, nicheTex, 0.85), addMat(`catNicheB${hi}`, nicheTex, 0.85)]);
    });
    // Декор тем: статуи (склеп), стены черепов (костница), обсидиан (яма).
    const statueMat = mat("catStatue", WALL, [0.8, 0.78, 0.74], [0.05, 0.05, 0.05], 1, 2);
    const obsidMat = mat("catObsidian", null, [0.08, 0.06, 0.07], [0.03, 0.008, 0.004]);
    obsidMat.specularColor = new Color3(0.35, 0.25, 0.25);
    const skullMat = new StandardMaterial("catSkullWall", scene);
    skullMat.diffuseTexture = skullWallTexture(scene);
    skullMat.emissiveColor = new Color3(0.05, 0.045, 0.04);
    skullMat.specularColor = new Color3(0.03, 0.03, 0.02);
    skullMat.maxSimultaneousLights = 6;
    skullMat.backFaceCulling = false;
    const lavaTex = lavaCrackTexture(scene);

    // «Запечённый» свет: тёплые пятна на полу и отблески на стенах у каждого огня — видно всегда.
    // Материал пятен — новый на каждый зал (НЕ clone: clone копирует и DynamicTexture, а копия не «готова»).
    const makePoolMat = (name: string): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      // Цвет — emissiveColor (тема зала), форма пятна — opacityTexture.
      m.opacityTexture = poolTex;
      m.emissiveColor = new Color3(1, 0.5, 0.16);
      m.diffuseColor = new Color3(0, 0, 0);
      m.disableLighting = true;
      m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true;
      m.alpha = 0.7;
      return m;
    };
    const pools: Mesh[][] = CAT_HALLS.map(() => []);
    // Свечи и люстры — жёлтое сияние (мельче и светлее факельного).
    const candleTex = tintGlowTexture(scene, "catCandleTex", 1, 0.82, 0.4);
    const candleMat = new StandardMaterial("catCandleGlowMat", scene);
    candleMat.emissiveTexture = candleTex;
    candleMat.opacityTexture = candleTex;
    candleMat.emissiveColor = new Color3(0, 0, 0);
    candleMat.disableLighting = true;
    candleMat.alphaMode = Constants.ALPHA_ADD;
    candleMat.disableDepthWrite = true;
    // Цветные ниши: свечения по залам, два цвета темы чередуются.
    const nicheGlow: Mesh[][][] = CAT_HALLS.map(() => [[], []]);
    // Пол: печать, дорожка, пятна (обычное смешивание — не светятся).
    const seals: Mesh[] = [];
    const runners: Mesh[] = [];
    const stains: Mesh[] = [];
    const H = CAT_CEIL;
    const y0 = CAT_FLOOR_Y;
    // Свои меши у каждого зала — чтобы его факелы светили только на него (includedOnlyMeshes).
    const hallMeshes: Mesh[][] = CAT_HALLS.map(() => []);
    const lists = (): { floor: Mesh[]; wall: Mesh[]; ceil: Mesh[]; pillar: Mesh[]; iron: Mesh[]; bone: Mesh[]; cloth: Mesh[]; urn: Mesh[] } => ({
      floor: [], wall: [], ceil: [], pillar: [], iron: [], bone: [], cloth: [], urn: [],
    });
    let seed = 11;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    /** Факел: кронштейн, огонь, ореол и свет (в зал hall). */
    const torchAt = (L: ReturnType<typeof lists>, hall: number, x: number, z: number, faceX: number, faceZ: number, big = false): void => {
      // Жаровня (big) — огонь прямо в чаше на стойке; настенный факел — на кронштейне.
      const base = big ? 1.1 : 3.2;
      if (!big) {
        const b = MeshBuilder.CreateBox("catSconce", { width: 0.28, height: 0.6, depth: 0.28 }, scene);
        b.position.set(x, y0 + base, z);
        L.iron.push(b);
        const cup = MeshBuilder.CreateCylinder("catCup", { height: 0.3, diameterTop: 0.55, diameterBottom: 0.25, tessellation: 8 }, scene);
        cup.position.set(x + faceX * 0.25, y0 + base + 0.35, z + faceZ * 0.25);
        L.iron.push(cup);
      }
      const fx = x + faceX * 0.25;
      const fz = z + faceZ * 0.25;
      const fl = new TransformNode("catTorch", scene);
      fl.parent = root;
      fl.position.set(fx, y0 + base + 0.5, fz);
      for (let i = 0; i < 2; i++) {
        const pl = MeshBuilder.CreatePlane("catFlame", { width: big ? 0.9 : 0.6, height: big ? 1.4 : 1 }, scene);
        pl.rotation.y = i * Math.PI * 0.5;
        pl.position.y = big ? 0.55 : 0.4;
        const fm = makeFireMaterial(scene, `catFire${this.fireMats.length}`, false);
        this.fireMats.push(fm);
        this.fireHall.push(hall);
        pl.material = fm;
        pl.parent = fl;
        pl.isPickable = false;
      }
      const glow = MeshBuilder.CreatePlane("catGlowSprite", { size: big ? 4.2 : 3 }, scene);
      glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
      glow.material = this.hallGlowMats[hall];
      glow.position.set(fx, y0 + base + 0.9, fz);
      glow.parent = root;
      glow.isPickable = false;
      this.glowSprites.push({ mesh: glow, phase: rnd() * 10 });
      // Пятно света на полу (смещено в зал) и отблеск на стене за огнём.
      const pool = MeshBuilder.CreateGround("catPool", { width: big ? 14 : 12, height: big ? 14 : 12 }, scene);
      pool.position.set(fx + faceX * (big ? 0 : 2.2), y0 + 0.06, fz + faceZ * (big ? 0 : 2.2));
      pools[hall].push(pool);
      if (!big) {
        const splash = MeshBuilder.CreatePlane("catSplash", { width: 6.5, height: 7.5 }, scene);
        splash.position.set(x + faceX * 0.12, y0 + base + 1.4, z + faceZ * 0.12);
        splash.rotation.y = Math.atan2(-faceX, -faceZ);
        pools[hall].push(splash);
      }
      // Настоящий свет — только у жаровен (меньше источников — дешевле для Quest).
      if (!big) return;
      const light = new PointLight(`catTorch${hall}_${this.hallLights[hall].length}`, new Vector3(fx + faceX * 0.6, y0 + base + 1, fz + faceZ * 0.6), scene);
      light.diffuse = new Color3(1, 0.42, 0.12);
      light.specular = new Color3(0.15, 0.08, 0.03);
      light.range = 26;
      light.intensity = 1.4;
      light.setEnabled(false);
      this.hallLights[hall].push(light);
    };

    /** Декор у стены: урны, груды костей, свечи, обломки, знамёна, цепи — между колоннами. */
    const decorAt = (L: ReturnType<typeof lists>, x: number, z: number, a: number): void => {
      const kind = Math.floor(rnd() * 6);
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      if (kind === 0) {
        for (let i = 0; i < 3; i++) {
          const u = MeshBuilder.CreateCylinder("catUrn", { height: 0.9 + rnd() * 0.5, diameterTop: 0.35, diameterBottom: 0.45, tessellation: 10 }, scene);
          u.position.set(x + (rnd() - 0.5) * 1.6, y0 + 0.5, z + (rnd() - 0.5) * 1.6);
          L.urn.push(u);
        }
      } else if (kind === 1) {
        for (let i = 0; i < 7; i++) {
          const bn = MeshBuilder.CreateCylinder("catBoneBit", { height: 0.5 + rnd() * 0.5, diameter: 0.09, tessellation: 5 }, scene);
          bn.position.set(x + (rnd() - 0.5) * 1.4, y0 + 0.15 + rnd() * 0.25, z + (rnd() - 0.5) * 1.4);
          bn.rotation.set(Math.PI / 2, rnd() * 3, rnd());
          L.bone.push(bn);
        }
        for (let i = 0; i < 2; i++) {
          const sk = MeshBuilder.CreateSphere("catSkull", { diameter: 0.38, segments: 6 }, scene);
          sk.position.set(x + (rnd() - 0.5) * 1.2, y0 + 0.2, z + (rnd() - 0.5) * 1.2);
          sk.scaling.y = 0.85;
          L.bone.push(sk);
        }
      } else if (kind === 2) {
        // Обломок колонны и щебень.
        const st = MeshBuilder.CreateCylinder("catStump", { height: 1.3 + rnd() * 1.2, diameter: 1.1, tessellation: 9 }, scene);
        st.position.set(x, y0 + 0.7, z);
        st.rotation.z = (rnd() - 0.5) * 0.25;
        L.pillar.push(st);
        for (let i = 0; i < 4; i++) {
          const rb = MeshBuilder.CreatePolyhedron("catRubble", { type: 1, size: 0.2 + rnd() * 0.25 }, scene);
          rb.position.set(x + (rnd() - 0.5) * 2.2, y0 + 0.15, z + (rnd() - 0.5) * 2.2);
          rb.rotation.set(rnd() * 3, rnd() * 3, 0);
          L.pillar.push(rb);
        }
      } else if (kind === 3) {
        // Знамя на стене.
        const bnr = MeshBuilder.CreatePlane("catBanner", { width: 1.4, height: 3.6 }, scene);
        bnr.position.set(x + sx * 0.55, y0 + 5.2, z + sz * 0.55);
        bnr.rotation.y = a + Math.PI;
        bannerLists[Math.floor(rnd() * bannerLists.length)].push(bnr);
        const rod = MeshBuilder.CreateBox("catBannerRod", { width: 1.8, height: 0.1, depth: 0.1 }, scene);
        rod.position.set(x + sx * 0.5, y0 + 7.05, z + sz * 0.5);
        rod.rotation.y = a;
        L.iron.push(rod);
      } else if (kind === 4) {
        // Свечи кучкой — огонёчки (без света, только сияние).
        for (let i = 0; i < 4; i++) {
          const c = MeshBuilder.CreateCylinder("catCandle", { height: 0.25 + rnd() * 0.35, diameter: 0.12, tessellation: 6 }, scene);
          const cx = x + (rnd() - 0.5) * 1.1;
          const cz = z + (rnd() - 0.5) * 1.1;
          c.position.set(cx, y0 + 0.2, cz);
          L.bone.push(c);
          const g = MeshBuilder.CreatePlane("catCandleGlow", { size: 0.7 }, scene);
          g.billboardMode = Mesh.BILLBOARDMODE_ALL;
          g.material = glowMat;
          g.position.set(cx, y0 + 0.55, cz);
          g.parent = root;
          g.isPickable = false;
          this.glowSprites.push({ mesh: g, phase: rnd() * 10 });
        }
      } else {
        // Цепи со свода.
        for (let i = 0; i < 2; i++) {
          const ch = MeshBuilder.CreateCylinder("catChain", { height: 4 + rnd() * 3, diameter: 0.08, tessellation: 4 }, scene);
          ch.position.set(x + (rnd() - 0.5) * 1.2, y0 + H - 2.5, z + (rnd() - 0.5) * 1.2);
          L.iron.push(ch);
        }
      }
    };

    CAT_HALLS.forEach((h, hi) => {
      this.hallLights.push([]);
      const L = lists();
      // Пол и свод.
      const f = MeshBuilder.CreateDisc("catHallFloor", { radius: h.r + 0.6, tessellation: 64 }, scene);
      f.rotation.x = Math.PI / 2;
      f.position.set(h.x, y0 + 0.02, h.z);
      L.floor.push(f);
      const c = MeshBuilder.CreateDisc("catHallCeil", { radius: h.r + 1.5, tessellation: 48 }, scene);
      c.rotation.x = -Math.PI / 2;
      c.position.set(h.x, y0 + H, h.z);
      L.ceil.push(c);
      // Стена — кольцо блоков, с проёмами под коридоры; над проёмом — перемычка до свода (не видно неба).
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const a = ((i + 0.5) / segs) * Math.PI * 2;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        const wx = h.x + sx * (h.r + 0.6);
        const wz = h.z + sz * (h.r + 0.6);
        const gapN = hi < CAT_HALLS.length - 1 && Math.abs(wx - h.x) < CAT_CORRIDOR_HALF + 0.3 && sz > 0;
        const gapS = hi > 0 && Math.abs(wx - h.x) < CAT_CORRIDOR_HALF + 0.3 && sz < 0;
        const w0 = ((h.r + 0.6) * Math.PI * 2) / segs + 0.35;
        if (gapN || gapS) {
          const lin = MeshBuilder.CreateBox("catLintel", { width: w0, height: H * 0.32, depth: 1.4 }, scene);
          lin.position.set(wx, y0 + H * 0.84, wz);
          lin.rotation.y = a;
          L.wall.push(lin);
          continue;
        }
        const w = MeshBuilder.CreateBox("catWallSeg", { width: w0, height: H, depth: 1.4 }, scene);
        w.position.set(wx, y0 + H / 2, wz);
        w.rotation.y = a;
        L.wall.push(w);
      }
      // Колонны по кругу, с капителями.
      const nCol = 10;
      for (let i = 0; i < nCol; i++) {
        const a = (i / nCol) * Math.PI * 2 + Math.PI / nCol;
        const pr = h.r - 2.6;
        const px = h.x + Math.sin(a) * pr;
        const pz = h.z + Math.cos(a) * pr;
        const col = MeshBuilder.CreateCylinder("catPillar", { height: H, diameter: 1.3, tessellation: 12 }, scene);
        col.position.set(px, y0 + H / 2, pz);
        L.pillar.push(col);
        const base = MeshBuilder.CreateBox("catPillarBase", { width: 1.8, height: 0.6, depth: 1.8 }, scene);
        base.position.set(px, y0 + 0.3, pz);
        L.pillar.push(base);
        const cap = MeshBuilder.CreateBox("catPillarCap", { width: 1.8, height: 0.5, depth: 1.8 }, scene);
        cap.position.set(px, y0 + H - 0.25, pz);
        L.pillar.push(cap);
      }
      // Факелы на стенах (их свет — освещение зала) и декор между колоннами.
      const nT = 8;
      for (let i = 0; i < nT; i++) {
        const a = (i / nT) * Math.PI * 2 + Math.PI / nT;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        if (Math.abs(sx * h.r) < CAT_CORRIDOR_HALF + 1.5) continue; // не в проёме
        torchAt(L, hi, h.x + sx * (h.r - 0.05), h.z + sz * (h.r - 0.05), -sx, -sz);
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.11;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        if (Math.abs(sx * h.r) < CAT_CORRIDOR_HALF + 2) continue;
        decorAt(L, h.x + sx * (h.r - 1.4), h.z + sz * (h.r - 1.4), a);
      }
      // Две большие жаровни в клетках у входа — главный тёплый свет зала.
      for (const side of [-1, 1]) {
        const bx = h.x + side * h.r * 0.42;
        const bz = h.z - h.r * 0.45;
        const stand = MeshBuilder.CreateCylinder("catBrazier", { height: 1.4, diameterTop: 1.6, diameterBottom: 0.6, tessellation: 10 }, scene);
        stand.position.set(bx, y0 + 0.7, bz);
        L.iron.push(stand);
        // Клетка: прутья вокруг огня и обод сверху.
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const bar = MeshBuilder.CreateCylinder("catCageBar", { height: 1.6, diameter: 0.07, tessellation: 4 }, scene);
          bar.position.set(bx + Math.cos(a) * 0.78, y0 + 2.1, bz + Math.sin(a) * 0.78);
          bar.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
          L.iron.push(bar);
        }
        const rim = MeshBuilder.CreateTorus("catCageRim", { diameter: 1.9, thickness: 0.08, tessellation: 16 }, scene);
        rim.position.set(bx, y0 + 2.9, bz);
        L.iron.push(rim);
        torchAt(L, hi, bx, bz, 0, 0, true);
      }
      // Свет над серединой (без самой люстры): мягкое тёплое пятно и источник.
      {
        const pool = MeshBuilder.CreateGround("catPool", { width: h.r * 1.4, height: h.r * 1.4 }, scene);
        pool.position.set(h.x, y0 + 0.05, h.z);
        pools[hi].push(pool);
        const lamp = new PointLight(`catTorch${hi}_lamp`, new Vector3(h.x, y0 + H - 5, h.z), scene);
        lamp.diffuse = new Color3(1, 0.45, 0.14);
        lamp.specular = new Color3(0.12, 0.07, 0.03);
        lamp.range = h.r * 1.9;
        lamp.intensity = 1.3;
        lamp.setEnabled(false);
        this.hallLights[hi].push(lamp);
      }
      // Три люстры поменьше по периметру: кольцо со свечами на цепях, жёлтое сияние, пятно и свет.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.PI / 6 + hi * 0.4;
        const cx = h.x + Math.cos(a) * h.r * 0.6;
        const cz = h.z + Math.sin(a) * h.r * 0.6;
        // Ниже — ближе к бою (7.5 м над полом), цепи до свода.
        const drop = H - 7.5;
        const cy = y0 + H - drop;
        const ring = MeshBuilder.CreateTorus("catChandRing", { diameter: 2.2, thickness: 0.12, tessellation: 20 }, scene);
        ring.position.set(cx, cy, cz);
        L.iron.push(ring);
        for (const ca of [0, 2.1, 4.2]) {
          const ch = MeshBuilder.CreateCylinder("catChandChain", { height: drop, diameter: 0.05, tessellation: 4 }, scene);
          ch.position.set(cx + Math.cos(ca) * 0.95, cy + drop / 2, cz + Math.sin(ca) * 0.95);
          ch.rotation.set(Math.sin(ca) * 0.12, 0, -Math.cos(ca) * 0.12);
          L.iron.push(ch);
        }
        for (let c = 0; c < 6; c++) {
          const ca = (c / 6) * Math.PI * 2;
          const px = cx + Math.cos(ca) * 1.1;
          const pz = cz + Math.sin(ca) * 1.1;
          const candle = MeshBuilder.CreateCylinder("catChandCandle", { height: 0.35, diameter: 0.12, tessellation: 6 }, scene);
          candle.position.set(px, cy + 0.22, pz);
          L.bone.push(candle);
          const g = MeshBuilder.CreatePlane("catCandleGlow", { size: 0.8 }, scene);
          g.billboardMode = Mesh.BILLBOARDMODE_ALL;
          g.material = candleMat;
          g.position.set(px, cy + 0.55, pz);
          g.parent = root;
          g.isPickable = false;
          this.glowSprites.push({ mesh: g, phase: rnd() * 10 });
        }
        const halo = MeshBuilder.CreatePlane("catGlowSprite", { size: 4 }, scene);
        halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
        halo.material = candleMat;
        halo.position.set(cx, cy + 0.5, cz);
        halo.parent = root;
        halo.isPickable = false;
        this.glowSprites.push({ mesh: halo, phase: rnd() * 10 });
        const pool = MeshBuilder.CreateGround("catPool", { width: 11, height: 11 }, scene);
        pool.position.set(cx, y0 + 0.055, cz);
        pools[hi].push(pool);
        const cl = new PointLight(`catTorch${hi}_ch${k}`, new Vector3(cx, cy - 0.3, cz), scene);
        cl.diffuse = new Color3(1, 0.7, 0.3);
        cl.specular = new Color3(0.1, 0.07, 0.03);
        cl.range = 15;
        cl.intensity = 1;
        cl.setEnabled(false);
        this.hallLights[hi].push(cl);
      }
      // Цветные ниши в стенах: арка, свечи внутри и цветное свечение (зелёное/бирюзовое/синее/фиолетовое/багровое).
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4 + 0.35;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        if (Math.abs(sx * h.r) < CAT_CORRIDOR_HALF + 2.5) continue;
        const slot = nicheGlow[hi][k % 2];
        const wx = h.x + sx * (h.r - 0.05);
        const wz = h.z + sz * (h.r - 0.05);
        for (const side of [-1, 1]) {
          const pil = MeshBuilder.CreateBox("catNichePil", { width: 0.5, height: 4.2, depth: 0.6 }, scene);
          pil.position.set(wx + Math.cos(a) * side * 1.35, y0 + 2.1, wz - Math.sin(a) * side * 1.35);
          pil.rotation.y = a;
          L.pillar.push(pil);
        }
        const arch = MeshBuilder.CreateBox("catNicheArch", { width: 3.2, height: 0.6, depth: 0.7 }, scene);
        arch.position.set(wx, y0 + 4.4, wz);
        arch.rotation.y = a;
        L.pillar.push(arch);
        const back = MeshBuilder.CreatePlane("catNicheGlow", { width: 2.4, height: 4 }, scene);
        back.position.set(wx - sx * 0.05, y0 + 2.1, wz - sz * 0.05);
        back.rotation.y = a + Math.PI;
        slot.push(back);
        const floorGlow = MeshBuilder.CreateGround("catNichePool", { width: 7, height: 7 }, scene);
        floorGlow.position.set(wx - sx * 2.2, y0 + 0.06, wz - sz * 2.2);
        slot.push(floorGlow);
        for (let c = 0; c < 3; c++) {
          const px = wx - sx * 0.5 + Math.cos(a) * (c - 1) * 0.6;
          const pz = wz - sz * 0.5 - Math.sin(a) * (c - 1) * 0.6;
          const candle = MeshBuilder.CreateCylinder("catCandle", { height: 0.3 + c * 0.12, diameter: 0.12, tessellation: 6 }, scene);
          candle.position.set(px, y0 + 0.2, pz);
          L.bone.push(candle);
          const g = MeshBuilder.CreatePlane("catCandleGlow", { size: 0.7 }, scene);
          g.billboardMode = Mesh.BILLBOARDMODE_ALL;
          g.material = candleMat;
          g.position.set(px, y0 + 0.55 + c * 0.12, pz);
          g.parent = root;
          g.isPickable = false;
          this.glowSprites.push({ mesh: g, phase: rnd() * 10 });
        }
      }
      // Пол: бронзовая печать в центре, дорожка от входа к стражу, пятна крови.
      {
        const seal = MeshBuilder.CreateGround("catSeal", { width: 13, height: 13 }, scene);
        seal.position.set(h.x, y0 + 0.07, h.z);
        seals.push(seal);
        const len = h.r * 1.55;
        const run = MeshBuilder.CreateGround("catRunner", { width: 4.2, height: len }, scene);
        run.position.set(h.x, y0 + 0.065, h.z - h.r + len / 2 + 0.6);
        runners.push(run);
        for (let k = 0; k < 5; k++) {
          const a = rnd() * Math.PI * 2;
          const rr = h.r * (0.25 + rnd() * 0.6);
          const st = MeshBuilder.CreateGround("catStain", { width: 2 + rnd() * 2.5, height: 2 + rnd() * 2.5 }, scene);
          st.position.set(h.x + Math.cos(a) * rr, y0 + 0.068, h.z + Math.sin(a) * rr);
          st.rotation.y = rnd() * 6;
          stains.push(st);
        }
      }
      // Саркофаги у северной стены (оттуда встают стражи).
      if (hi > 0 && hi < CAT_HALLS.length - 1) {
        for (const dx of [-3.4, 3.4]) {
          const sarc = MeshBuilder.CreateBox("catSarc", { width: 1.4, height: 1, depth: 2.8 }, scene);
          sarc.position.set(h.x + dx, y0 + 0.5, h.z + h.r * 0.62);
          L.pillar.push(sarc);
          const lid = MeshBuilder.CreateBox("catSarcLid", { width: 1.6, height: 0.2, depth: 3 }, scene);
          lid.position.set(h.x + dx, y0 + 1.1, h.z + h.r * 0.62);
          L.pillar.push(lid);
        }
      }
      // Собираем меши зала по материалам.
      const merge = (list: Mesh[], name: string, m: StandardMaterial): Mesh | null => {
        if (!list.length) return null;
        const mm = Mesh.MergeMeshes(list, true, true) as Mesh | null;
        if (!mm) return null;
        mm.name = `${name}${hi}`;
        mm.material = m;
        mm.parent = root;
        mm.isPickable = false;
        mm.freezeWorldMatrix();
        hallMeshes[hi].push(mm);
        return mm;
      };
      merge(L.floor, "catFloor", this.hallFloorMats[hi]);
      merge(L.wall, "catWalls", this.hallWallMats[hi]);
      merge(L.ceil, "catCeil", ceilMat);
      merge(L.pillar, "catPillars", pillarMat);
      merge(L.iron, "catIron", ironMat);
      merge(L.bone, "catBones", boneMat);
      bannerLists.forEach((list, bi) => merge(list, `catCloth${BANNERS[bi][0]}`, bannerMats[bi]));
      bannerLists = BANNERS.map(() => []);
      merge(L.urn, "catUrns", urnMat);
      // Декор тем: строим все варианты, включён тот, что выпал залу на этот заход (applyThemes).
      const td = this.buildThemeDecor(hi, { statueMat, obsidMat, skullMat, boneMat, ironMat, pillarMat, candleMat, lavaTex, nicheTex }, rnd);
      this.themeDecor.push(td.groups);
      for (const [list, name, m] of td.lit) {
        const mm = merge(list, name, m);
        if (mm) td.groups[td.owner.get(list)!].push(mm);
      }
    });

    // Коридоры: пол, стены, свод, решётка на выходе из зала — меши к залу-источнику.
    for (let i = 0; i < CAT_HALLS.length - 1; i++) {
      const c = catCorridor(i);
      const len = c.z1 - c.z0;
      const cz = (c.z0 + c.z1) / 2;
      const L = lists();
      const f = MeshBuilder.CreateBox("catCorFloor", { width: CAT_CORRIDOR_HALF * 2 + 0.4, height: 0.1, depth: len }, scene);
      f.position.set(0, y0 - 0.03, cz);
      L.floor.push(f);
      for (const side of [-1, 1]) {
        const w = MeshBuilder.CreateBox("catCorWall", { width: 1.2, height: H, depth: len }, scene);
        w.position.set(side * (CAT_CORRIDOR_HALF + 0.6), y0 + H / 2, cz);
        L.wall.push(w);
      }
      // Свод коридора — на высоте зала (без щели к небу); плоскость лицом вниз.
      const top = MeshBuilder.CreatePlane("catCorTop", { width: CAT_CORRIDOR_HALF * 2 + 2.4, height: len + 2 }, scene);
      top.rotation.x = -Math.PI / 2;
      top.position.set(0, y0 + H * 0.68, cz);
      L.ceil.push(top);
      // Стенка над сводом коридора до свода зала — закрывает «окно».
      const cap = MeshBuilder.CreateBox("catCorCap", { width: CAT_CORRIDOR_HALF * 2 + 2.4, height: H * 0.34, depth: len }, scene);
      cap.position.set(0, y0 + H * 0.85, cz);
      L.wall.push(cap);
      torchAt(L, i, -CAT_CORRIDOR_HALF + 0.05, cz, 1, 0);
      torchAt(L, i + 1, CAT_CORRIDOR_HALF - 0.05, cz, -1, 0);
      const bars: Mesh[] = [];
      for (let b = -5; b <= 5; b++) {
        const bar = MeshBuilder.CreateBox("catBar", { width: 0.16, height: H * 0.66, depth: 0.16 }, scene);
        bar.position.set(b * (CAT_CORRIDOR_HALF / 5.2), 0, 0);
        bars.push(bar);
      }
      for (const hy of [-0.25, 0.1, 0.4]) {
        const cross = MeshBuilder.CreateBox("catBarX", { width: CAT_CORRIDOR_HALF * 2, height: 0.18, depth: 0.18 }, scene);
        cross.position.set(0, hy * H * 0.66, 0);
        bars.push(cross);
      }
      const gate = Mesh.MergeMeshes(bars, true, true) as Mesh;
      gate.name = `catGate${i}`;
      gate.material = ironMat;
      const gy = y0 + H * 0.33;
      gate.position.set(0, gy, c.z0 + 2.2);
      gate.parent = root;
      gate.isPickable = false;
      this.gates.push({ mesh: gate, i, y: gy });
      for (const [list, m] of [[L.floor, floorMat], [L.wall, wallMat], [L.ceil, ceilMat], [L.iron, ironMat]] as [Mesh[], StandardMaterial][]) {
        if (!list.length) continue;
        const mm = Mesh.MergeMeshes(list, true, true) as Mesh | null;
        if (!mm) continue;
        mm.name = `catCor${i}`;
        mm.material = m;
        mm.parent = root;
        mm.isPickable = false;
        mm.freezeWorldMatrix();
        hallMeshes[i].push(mm);
        hallMeshes[i + 1].push(mm);
      }
      hallMeshes[i].push(gate);
    }

    const flatMat = (name: string, tex: DynamicTexture, emi: Color3, add: boolean, alpha: number): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseTexture = tex;
      m.opacityTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      m.emissiveColor = emi;
      m.disableLighting = add;
      m.specularColor = new Color3(0, 0, 0);
      m.disableDepthWrite = true;
      if (add) m.alphaMode = Constants.ALPHA_ADD;
      m.alpha = alpha;
      return m;
    };
    const mergeFlat = (list: Mesh[], name: string, m: StandardMaterial): Mesh | null => {
      if (!list.length) return null;
      const mm = Mesh.MergeMeshes(list, true, true) as Mesh | null;
      if (!mm) return null;
      mm.name = name;
      mm.material = m;
      mm.parent = root;
      mm.isPickable = false;
      mm.freezeWorldMatrix();
      return mm;
    };
    nicheGlow.forEach((slots, hi) => slots.forEach((list, k) => mergeFlat(list, `catNiche${hi}_${k}`, this.hallNicheMats[hi][k])));
    const sealMesh = mergeFlat(seals, "catSeals", flatMat("catSealMat", sealTexture(scene), new Color3(0.16, 0.1, 0.04), false, 0.5));
    if (sealMesh) this.sealMat = sealMesh.material as StandardMaterial;
    mergeFlat(runners, "catRunners", flatMat("catRunnerMat", runnerTexture(scene), new Color3(0.05, 0.02, 0.01), false, 0.9));
    mergeFlat(stains, "catStains", flatMat("catStainMat", stainTexture(scene), new Color3(0, 0, 0), false, 0.85));

    // Факелы светят только на свой зал (и его коридоры) — иначе свет лез бы во все материалы сцены.
    this.hallLights.forEach((ls, i) => {
      for (const l of ls) l.includedOnlyMeshes = hallMeshes[i];
    });
    // Под землёй солнца и неба нет: камень освещают только факелы (и огни ботов).
    const stone = root.getChildMeshes();
    for (const l of scene.lights) {
      if (l.getClassName() === "PointLight") continue;
      l.excludedMeshes.push(...stone);
    }

    pools.forEach((list, hi) => {
      if (!list.length) return;
      const pm = Mesh.MergeMeshes(list, true, true) as Mesh | null;
      if (!pm) return;
      pm.name = `catLightPools${hi}`;
      // Свой материал у зала — мерцает в своём ритме (огонь, а не ровная лампа).
      const m = makePoolMat(`catLightPool${hi}`);
      pm.material = m;
      this.poolMats[hi] = m;
      pm.parent = root;
      pm.isPickable = false;
      pm.freezeWorldMatrix();
    });

    // Тёмная оболочка вокруг всего подземелья: в любые щели видно тьму, а не небо.
    const shell = MeshBuilder.CreateBox("catShell", { width: 90, height: 60, depth: CAT_HALLS[CAT_HALLS.length - 1].z + 50 - CAT_HALLS[0].z + 40 }, scene);
    shell.position.set(0, y0 + 10, (CAT_HALLS[0].z - 40 + CAT_HALLS[CAT_HALLS.length - 1].z + 50) / 2);
    const shellMat = new StandardMaterial("catShellMat", scene);
    shellMat.diffuseColor = new Color3(0, 0, 0);
    shellMat.emissiveColor = new Color3(0.01, 0.008, 0.012);
    shellMat.disableLighting = true;
    shellMat.backFaceCulling = false;
    shellMat.fogEnabled = false;
    shell.material = shellMat;
    shell.parent = root;
    shell.isPickable = false;
    shell.flipFaces(true);

    // Пылинки: медленно кружат в свете факелов, редкие тлеющие искры.
    const ps = new ParticleSystem("catMotes", 260, scene);
    ps.particleTexture = glowTex;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitter = new Vector3(0, y0 + 3, 0);
    ps.minEmitBox = new Vector3(-18, -2.5, -18);
    ps.maxEmitBox = new Vector3(18, 7, 18);
    ps.color1 = new Color4(1, 0.7, 0.4, 0.5);
    ps.color2 = new Color4(1, 0.5, 0.2, 0.35);
    ps.colorDead = new Color4(0, 0, 0, 0);
    ps.minSize = 0.04;
    ps.maxSize = 0.14;
    ps.minLifeTime = 5;
    ps.maxLifeTime = 9;
    ps.emitRate = 40;
    ps.direction1 = new Vector3(-0.15, 0.08, -0.15);
    ps.direction2 = new Vector3(0.15, 0.25, 0.15);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.5;
    ps.gravity = new Vector3(0, 0.02, 0);
    this.motes = ps;

    root.setEnabled(false);
    this.paintThemes();
  }

  /**
   * Декор тем зала hi — все 4 варианта (выключены; включает applyThemes):
   * склеп — статуи стражей с мечами и каменные гробы; костница — стены черепов, груды костей, пирамиды черепов;
   * огненная яма — лава в трещинах пола, обсидиан, огненные расщелины; лунный склеп — туман, поля свечей, канделябры.
   * lit — списки под слияние с освещаемыми материалами (свет зала), groups — уже готовые меши по темам.
   */
  private buildThemeDecor(
    hi: number,
    M: {
      statueMat: StandardMaterial; obsidMat: StandardMaterial; skullMat: StandardMaterial; boneMat: StandardMaterial;
      ironMat: StandardMaterial; pillarMat: StandardMaterial; candleMat: StandardMaterial; lavaTex: DynamicTexture; nicheTex: DynamicTexture;
    },
    rnd: () => number,
  ): { groups: Mesh[][]; lit: [Mesh[], string, StandardMaterial][]; owner: Map<Mesh[], number> } {
    const scene = this.scene;
    const root = this.root!;
    const h = CAT_HALLS[hi];
    const y0 = CAT_FLOOR_Y;
    const groups: Mesh[][] = CAT_THEMES.map(() => []);
    const lit: [Mesh[], string, StandardMaterial][] = [];
    const owner = new Map<Mesh[], number>();
    const list = (t: number, name: string, m: StandardMaterial): Mesh[] => {
      const l: Mesh[] = [];
      lit.push([l, `catTheme${t}${name}`, m]);
      owner.set(l, t);
      return l;
    };
    const at = (deg: number, rr: number): { x: number; z: number; a: number } => {
      const a = (deg * Math.PI) / 180;
      return { x: h.x + Math.sin(a) * rr, z: h.z + Math.cos(a) * rr, a };
    };
    const extra = (t: number, m: Mesh): void => {
      m.parent = root;
      m.isPickable = false;
      groups[t].push(m);
    };
    const sprite = (t: number, x: number, y: number, z: number, size: number): void => {
      const g = MeshBuilder.CreatePlane("catCandleGlow", { size }, scene);
      g.billboardMode = Mesh.BILLBOARDMODE_ALL;
      g.material = M.candleMat;
      g.position.set(x, y, z);
      extra(t, g);
      this.glowSprites.push({ mesh: g, phase: rnd() * 10 });
    };

    // 0 · Склеп: статуи стражей (меч остриём в пол) и каменные гробы.
    {
      const stone = list(0, "Stone", M.pillarMat);
      const statue = list(0, "Statue", M.statueMat);
      for (const deg of [36, 108, 252, 324]) {
        const p = at(deg, h.r - 3.6);
        const fx = -Math.sin(p.a);
        const fz = -Math.cos(p.a);
        const ped = MeshBuilder.CreateBox("catStatuePed", { width: 1.9, height: 1.1, depth: 1.9 }, scene);
        ped.position.set(p.x, y0 + 0.55, p.z);
        ped.rotation.y = p.a;
        stone.push(ped);
        const b = y0 + 1.1;
        const robe = MeshBuilder.CreateCylinder("catStatueRobe", { height: 3, diameterTop: 0.85, diameterBottom: 1.35, tessellation: 10 }, scene);
        robe.position.set(p.x, b + 1.5, p.z);
        statue.push(robe);
        const chest = MeshBuilder.CreateBox("catStatueChest", { width: 1.55, height: 0.9, depth: 0.8 }, scene);
        chest.position.set(p.x, b + 3.25, p.z);
        chest.rotation.y = p.a;
        statue.push(chest);
        const head = MeshBuilder.CreateSphere("catStatueHead", { diameter: 0.72, segments: 8 }, scene);
        head.position.set(p.x, b + 4, p.z);
        statue.push(head);
        const helm = MeshBuilder.CreateCylinder("catStatueHelm", { height: 0.55, diameterTop: 0.15, diameterBottom: 0.86, tessellation: 8 }, scene);
        helm.position.set(p.x, b + 4.35, p.z);
        statue.push(helm);
        const blade = MeshBuilder.CreateBox("catStatueBlade", { width: 0.24, height: 3.1, depth: 0.09 }, scene);
        blade.position.set(p.x + fx * 0.8, b + 1.6, p.z + fz * 0.8);
        blade.rotation.y = p.a;
        statue.push(blade);
        const guard = MeshBuilder.CreateBox("catStatueGuard", { width: 1.1, height: 0.16, depth: 0.16 }, scene);
        guard.position.set(p.x + fx * 0.8, b + 3.2, p.z + fz * 0.8);
        guard.rotation.y = p.a;
        statue.push(guard);
      }
      for (const deg of [72, 288]) {
        const p = at(deg, h.r - 5);
        for (const off of [-1.2, 1.2]) {
          const ox = Math.cos(p.a) * off;
          const oz = -Math.sin(p.a) * off;
          const cof = MeshBuilder.CreateBox("catCoffin", { width: 1.2, height: 0.8, depth: 2.7 }, scene);
          cof.position.set(p.x + ox, y0 + 0.4, p.z + oz);
          cof.rotation.y = p.a;
          stone.push(cof);
          const lid = MeshBuilder.CreateBox("catCoffinLid", { width: 1.35, height: 0.18, depth: 2.9 }, scene);
          lid.position.set(p.x + ox, y0 + 0.88, p.z + oz);
          lid.rotation.y = p.a + (rnd() - 0.5) * 0.25;
          stone.push(lid);
        }
      }
    }

    // 1 · Костница: стены черепов, груды костей, пирамиды черепов.
    {
      const skull = list(1, "Skulls", M.skullMat);
      const bone = list(1, "Bones", M.boneMat);
      for (const deg of [45, 90, 135, 225, 270, 315]) {
        const p = at(deg, h.r - 0.3);
        const pl = MeshBuilder.CreatePlane("catSkullWall", { width: 5, height: 6.4 }, scene);
        pl.position.set(p.x, y0 + 3.5, p.z);
        pl.rotation.y = p.a;
        skull.push(pl);
      }
      for (const deg of [30, 150, 210, 330]) {
        const p = at(deg, h.r - 4);
        const mound = MeshBuilder.CreateSphere("catBoneMound", { diameter: 3.2, segments: 8 }, scene);
        mound.scaling.y = 0.32;
        mound.position.set(p.x, y0 + 0.15, p.z);
        bone.push(mound);
        for (let i = 0; i < 10; i++) {
          const bn = MeshBuilder.CreateCylinder("catBoneBit", { height: 0.6 + rnd() * 0.5, diameter: 0.1, tessellation: 5 }, scene);
          bn.position.set(p.x + (rnd() - 0.5) * 2.4, y0 + 0.35 + rnd() * 0.3, p.z + (rnd() - 0.5) * 2.4);
          bn.rotation.set(Math.PI / 2 + (rnd() - 0.5), rnd() * 3, rnd());
          bone.push(bn);
        }
        for (let i = 0; i < 4; i++) {
          const sk = MeshBuilder.CreateSphere("catSkull", { diameter: 0.42, segments: 6 }, scene);
          sk.position.set(p.x + (rnd() - 0.5) * 1.8, y0 + 0.5 + rnd() * 0.15, p.z + (rnd() - 0.5) * 1.8);
          sk.scaling.y = 0.85;
          bone.push(sk);
        }
      }
      for (const deg of [90, 270]) {
        const p = at(deg, h.r - 3);
        const tx = Math.cos(p.a);
        const tz = -Math.sin(p.a);
        let y = y0 + 0.22;
        for (const n of [4, 3, 2, 1]) {
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              const u = (i - (n - 1) / 2) * 0.44;
              const w = (j - (n - 1) / 2) * 0.44;
              const sk = MeshBuilder.CreateSphere("catSkull", { diameter: 0.44, segments: 6 }, scene);
              sk.position.set(p.x + tx * u + Math.sin(p.a) * w, y, p.z + tz * u + Math.cos(p.a) * w);
              bone.push(sk);
            }
          }
          y += 0.36;
        }
      }
    }

    // 2 · Огненная яма: лава в трещинах (дышит), обсидиановые шипы, огненные расщелины.
    {
      const obs = list(2, "Obsidian", M.obsidMat);
      const lavaMat = new StandardMaterial(`catLava${hi}`, scene);
      lavaMat.emissiveTexture = M.lavaTex;
      lavaMat.opacityTexture = M.lavaTex;
      lavaMat.emissiveColor = new Color3(0, 0, 0);
      lavaMat.diffuseColor = new Color3(0, 0, 0);
      lavaMat.disableLighting = true;
      lavaMat.alphaMode = Constants.ALPHA_ADD;
      lavaMat.disableDepthWrite = true;
      this.lavaMats.push(lavaMat);
      const lava = MeshBuilder.CreateGround("catLavaCracks", { width: h.r * 2, height: h.r * 2 }, scene);
      lava.position.set(h.x, y0 + 0.072, h.z);
      lava.rotation.y = rnd() * 6;
      lava.material = lavaMat;
      extra(2, lava);
      for (const deg of [20, 75, 110, 160, 200, 250, 285, 340]) {
        const p = at(deg + (rnd() - 0.5) * 10, h.r - 2.2);
        for (let i = 0; i < 3; i++) {
          const sp = MeshBuilder.CreateCylinder("catObsidian", { height: 1.4 + rnd() * 2.4, diameterTop: 0, diameterBottom: 0.6 + rnd() * 0.8, tessellation: 5 }, scene);
          sp.position.set(p.x + (rnd() - 0.5) * 1.6, y0 + 0.6, p.z + (rnd() - 0.5) * 1.6);
          sp.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5);
          obs.push(sp);
        }
      }
      for (const deg of [60, 300, 120 + rnd() * 120]) {
        const p = at(deg, h.r * 0.62);
        const rim = MeshBuilder.CreateTorus("catVentRim", { diameter: 1.6, thickness: 0.45, tessellation: 10 }, scene);
        rim.position.set(p.x, y0 + 0.1, p.z);
        rim.scaling.y = 0.5;
        obs.push(rim);
        const fl = new TransformNode("catVent", scene);
        fl.parent = root;
        fl.position.set(p.x, y0 + 0.75, p.z);
        for (let i = 0; i < 2; i++) {
          const pl = MeshBuilder.CreatePlane("catVentFlame", { width: 1.1, height: 1.6 }, scene);
          pl.rotation.y = i * Math.PI * 0.5;
          const fm = makeFireMaterial(scene, `catFire${this.fireMats.length}`, false);
          this.fireMats.push(fm);
          this.fireHall.push(hi);
          pl.material = fm;
          pl.parent = fl;
          pl.isPickable = false;
          groups[2].push(pl);
        }
      }
    }

    // 3 · Лунный склеп: стелющийся туман, поля свечей, высокие канделябры.
    {
      const iron = list(3, "Iron", M.ironMat);
      const wax = list(3, "Wax", M.boneMat);
      const mistMat = new StandardMaterial(`catMist${hi}`, scene);
      mistMat.opacityTexture = M.nicheTex;
      mistMat.emissiveColor = new Color3(0.3, 0.4, 0.7);
      mistMat.diffuseColor = new Color3(0, 0, 0);
      mistMat.disableLighting = true;
      mistMat.alphaMode = Constants.ALPHA_ADD;
      mistMat.disableDepthWrite = true;
      mistMat.alpha = 0.32;
      for (let i = 0; i < 4; i++) {
        const p = at(i * 90 + 45 + rnd() * 30, h.r * (0.35 + rnd() * 0.2));
        const mist = MeshBuilder.CreateGround("catMist", { width: h.r * 1.1, height: h.r * 0.8 }, scene);
        mist.position.set(p.x, y0 + 0.3 + i * 0.12, p.z);
        mist.material = mistMat;
        extra(3, mist);
        this.mists.push(mist);
      }
      for (const deg of [50, 130, 230, 310]) {
        const p = at(deg, h.r - 3);
        for (let i = 0; i < 7; i++) {
          const cx = p.x + (rnd() - 0.5) * 2.2;
          const cz = p.z + (rnd() - 0.5) * 2.2;
          const ch = 0.2 + rnd() * 0.5;
          const c = MeshBuilder.CreateCylinder("catCandle", { height: ch, diameter: 0.13, tessellation: 6 }, scene);
          c.position.set(cx, y0 + ch / 2, cz);
          wax.push(c);
          sprite(3, cx, y0 + ch + 0.2, cz, 0.75);
        }
      }
      for (const deg of [90, 270]) {
        const p = at(deg, h.r - 4.5);
        const foot = MeshBuilder.CreateCylinder("catCandelabraFoot", { height: 0.2, diameter: 1, tessellation: 8 }, scene);
        foot.position.set(p.x, y0 + 0.1, p.z);
        iron.push(foot);
        const pole = MeshBuilder.CreateCylinder("catCandelabraPole", { height: 3, diameter: 0.16, tessellation: 6 }, scene);
        pole.position.set(p.x, y0 + 1.6, p.z);
        iron.push(pole);
        const tx = Math.cos(p.a);
        const tz = -Math.sin(p.a);
        const arm = MeshBuilder.CreateBox("catCandelabraArm", { width: 1.6, height: 0.1, depth: 0.1 }, scene);
        arm.position.set(p.x, y0 + 3, p.z);
        arm.rotation.y = p.a;
        iron.push(arm);
        for (const o of [-0.75, 0, 0.75]) {
          const cx = p.x + tx * o;
          const cz = p.z + tz * o;
          const top = o === 0 ? 0.25 : 0;
          const c = MeshBuilder.CreateCylinder("catCandle", { height: 0.4, diameter: 0.14, tessellation: 6 }, scene);
          c.position.set(cx, y0 + 3.25 + top, cz);
          wax.push(c);
          sprite(3, cx, y0 + 3.65 + top, cz, 0.9);
        }
      }
    }
    for (const g of groups) for (const m of g) m.setEnabled(false);
    return { groups, lit, owner };
  }

  /** Темы залов пришли с сервера (новый заход) — перекрашиваем. */
  private applyThemes(sig: string): void {
    this.themeSig = sig;
    const ids = sig.split(",").map(Number);
    for (let h = 0; h < CAT_HALLS.length; h++) {
      const t = ids[h];
      if (Number.isInteger(t) && t >= 0 && t < CAT_THEMES.length) this.hallTheme[h] = t;
    }
    this.paintThemes();
  }

  /** Цвета и декор залов по их темам: свет (в animate), пятна, ореолы, огонь, ниши, пол и стены. */
  private paintThemes(): void {
    for (let h = 0; h < CAT_HALLS.length; h++) {
      const t = this.hallTheme[h];
      const th = CAT_THEMES[t];
      const [r, g, b] = th.light;
      this.hallFloorMats[h]?.diffuseColor.set(th.floor[0], th.floor[1], th.floor[2]);
      this.hallWallMats[h]?.diffuseColor.set(th.floor[0] * 0.9, th.floor[1] * 0.88, th.floor[2] * 0.9);
      this.poolMats[h]?.emissiveColor.set(r, g, b);
      this.hallGlowMats[h]?.emissiveColor.set(Math.min(1, r * 0.85 + 0.2), Math.min(1, g * 0.85 + 0.18), Math.min(1, b * 0.85 + 0.12));
      const nm = this.hallNicheMats[h];
      if (nm) {
        nm[0].emissiveColor.set(...th.niches[0]);
        nm[1].emissiveColor.set(...th.niches[1]);
      }
      this.themeDecor[h]?.forEach((list, k) => {
        for (const m of list) m.setEnabled(k === t);
      });
    }
    this.fireMats.forEach((fm, i) => {
      const c = THEME_FIRE[CAT_THEMES[this.hallTheme[this.fireHall[i]] ?? 0].key];
      fm.setColor3("uColorA", Color3.FromHexString(c[0]));
      fm.setColor3("uColorB", Color3.FromHexString(c[1]));
      fm.setColor3("uColorC", Color3.FromHexString(c[2]));
    });
    if (this.motesHall >= 0) this.themeMotes(this.motesHall);
  }

  /** Пылинки зала по теме: пыль, споры, угли (летят вверх), лунная пыль. */
  private themeMotes(hall: number): void {
    const ps = this.motes;
    if (!ps) return;
    const m = THEME_MOTES[CAT_THEMES[this.hallTheme[hall]].key];
    ps.color1.copyFromFloats(...m.c1);
    ps.color2.copyFromFloats(...m.c2);
    ps.direction1.set(-0.15, m.up * 0.3, -0.15);
    ps.direction2.set(0.15, m.up, 0.15);
  }

  /** Святилище в зале (из RoomState): алтарь, кольцо рун, столб света и парящая сфера цвета святилища. */
  private updateShrine(v: CatView | null): void {
    const k = v && v.phase === CAT_PHASE.run ? v.shrine : -1;
    if (k < 0 && !this.shrine) return;
    if (!this.shrine) this.buildShrine();
    const node = this.shrine!;
    if (k !== this.shrineKind) {
      this.shrineKind = k;
      node.setEnabled(k >= 0);
      const c = CAT_SHRINES[k]?.color;
      if (c) for (const m of this.shrineMats) m.emissiveColor.set(c[0], c[1], c[2]);
    }
    if (k < 0 || !v) return;
    node.position.set(v.shrineX, CAT_FLOOR_Y, v.shrineZ);
    const t = this.time;
    if (this.shrineOrb) this.shrineOrb.position.y = 2.2 + 0.18 * Math.sin(t * 2.2);
    if (this.shrineRing) this.shrineRing.rotation.y = t * 0.5;
  }

  private buildShrine(): void {
    const scene = this.scene;
    const node = new TransformNode("catShrine", scene);
    node.parent = this.root;
    this.shrine = node;
    const stone = new StandardMaterial("catShrineStone", scene);
    stone.diffuseColor = new Color3(0, 0, 0);
    stone.emissiveColor = new Color3(0.16, 0.15, 0.14);
    stone.disableLighting = true;
    const glow = (name: string, tex: DynamicTexture | null, alpha: number): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      if (tex) m.opacityTexture = tex;
      m.diffuseColor = new Color3(0, 0, 0);
      m.emissiveColor = new Color3(1, 1, 1);
      m.disableLighting = true;
      if (tex) {
        m.alphaMode = Constants.ALPHA_ADD;
        m.disableDepthWrite = true;
        m.backFaceCulling = false;
        m.alpha = alpha;
      }
      this.shrineMats.push(m);
      return m;
    };
    const add = (m: Mesh, mat: StandardMaterial): Mesh => {
      m.material = mat;
      m.parent = node;
      m.isPickable = false;
      return m;
    };
    const base = add(MeshBuilder.CreateCylinder("catShrineAltar", { height: 1.2, diameterTop: 0.9, diameterBottom: 1.4, tessellation: 8 }, scene), stone);
    base.position.y = 0.6;
    const slab = add(MeshBuilder.CreateBox("catShrineSlab", { width: 1.5, height: 0.2, depth: 1.5 }, scene), stone);
    slab.position.y = 1.3;
    const ring = add(MeshBuilder.CreateGround("catShrineRing", { width: 7, height: 7 }, scene), glow("catShrineRingMat", ringTexture(scene), 0.95));
    ring.position.y = 0.09;
    this.shrineRing = ring;
    const beam = add(
      MeshBuilder.CreateCylinder("catShrineBeam", { height: 11, diameter: 1.5, tessellation: 16, cap: Mesh.NO_CAP }, scene),
      glow("catShrineBeamMat", beamTexture(scene), 0.55),
    );
    beam.position.y = 5.5 + 1.3;
    this.shrineOrb = add(MeshBuilder.CreateSphere("catShrineOrb", { diameter: 0.6, segments: 12 }, scene), glow("catShrineOrbMat", null, 1));
    const halo = add(MeshBuilder.CreatePlane("catShrineHalo", { size: 3 }, scene), glow("catShrineHaloMat", tintGlowTexture(scene, "catShrineHaloTex", 1, 1, 1), 0.9));
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.parent = this.shrineOrb;
  }

  /** Портал сбора в лагере: светящийся круг, столб и табличка «отряд N · m:ss» — только во время сбора. */
  private updatePortal(dt: number, v: CatView | null): void {
    const on = !!v && v.phase === CAT_PHASE.gather;
    if (!on && !this.portal) return;
    if (!this.portal) this.buildPortal();
    const root = this.portal!;
    root.setEnabled(on);
    if (!on) return;
    if (this.portalSpin) this.portalSpin.rotation.y += dt * 0.6;
    if (this.portalMat) {
      const k = 0.7 + 0.3 * Math.sin(this.time * 3);
      this.portalMat.emissiveColor.set(0.55 * k, 0.15 * k, 0.95 * k);
    }
    const left = v!.left;
    const sig = `${v!.party}|${left}`;
    if (sig !== this.portalSig && this.portalLabel) {
      this.portalSig = sig;
      const g = this.portalLabel.getContext() as unknown as CanvasRenderingContext2D;
      g.clearRect(0, 0, 512, 160);
      g.fillStyle = "rgba(20,8,30,0.75)";
      g.fillRect(0, 0, 512, 160);
      g.fillStyle = "#e6c8ff";
      g.font = "bold 46px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("☠ КАТАКОМБЫ", 256, 58);
      g.font = "34px system-ui, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText(`отряд ${v!.party} · спуск ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, 256, 112);
      g.font = "24px system-ui, sans-serif";
      g.fillStyle = "#bfa9d6";
      g.fillText("встань в круг — войти", 256, 148);
      this.portalLabel.update();
    }
  }

  private buildPortal(): void {
    const scene = this.scene;
    const root = new TransformNode("catPortal", scene);
    const y = terrainHeight(CAT_PORTAL.x, CAT_PORTAL.z);
    root.position.set(CAT_PORTAL.x, y, CAT_PORTAL.z);
    const m = new StandardMaterial("catPortalMat", scene);
    m.diffuseColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(0.55, 0.15, 0.95);
    m.disableLighting = true;
    this.portalMat = m;
    const ring = MeshBuilder.CreateTorus("catPortalRing", { diameter: 4.4, thickness: 0.22, tessellation: 48 }, scene);
    ring.position.y = 0.12;
    ring.material = m;
    ring.parent = root;
    const glow = new StandardMaterial("catPortalGlow", scene);
    const gt = glowTexture(scene);
    glow.emissiveTexture = gt;
    glow.opacityTexture = gt;
    glow.emissiveColor = new Color3(0.6, 0.2, 1);
    glow.diffuseColor = new Color3(0, 0, 0);
    glow.disableLighting = true;
    glow.alphaMode = Constants.ALPHA_ADD;
    glow.disableDepthWrite = true;
    const disc = MeshBuilder.CreateDisc("catPortalDisc", { radius: 2.3, tessellation: 40 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.06;
    disc.material = glow;
    disc.parent = root;
    const pillar = MeshBuilder.CreateCylinder("catPortalBeam", { height: 7, diameterTop: 0.5, diameterBottom: 3.6, tessellation: 24 }, scene);
    pillar.position.y = 3.5;
    // Не clone (копия DynamicTexture не «готова» — столб не рисовался): свой материал с той же текстурой.
    const pm = new StandardMaterial("catPortalBeamMat", scene);
    pm.emissiveTexture = gt;
    pm.opacityTexture = gt;
    pm.emissiveColor = new Color3(0.6, 0.2, 1);
    pm.diffuseColor = new Color3(0, 0, 0);
    pm.disableLighting = true;
    pm.alphaMode = Constants.ALPHA_ADD;
    pm.disableDepthWrite = true;
    pm.alpha = 0.35;
    pillar.material = pm;
    pillar.parent = root;
    // Табличка — отдельно от вращения круга.
    const lab = new DynamicTexture("catPortalLabel", { width: 512, height: 160 }, scene, false);
    lab.hasAlpha = true;
    this.portalLabel = lab;
    const lm = new StandardMaterial("catPortalLabelMat", scene);
    lm.diffuseTexture = lab;
    lm.emissiveColor = new Color3(1, 1, 1);
    lm.disableLighting = true;
    lm.useAlphaFromDiffuseTexture = true;
    lm.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane("catPortalLabelPlane", { width: 3.2, height: 1 }, scene);
    plane.material = lm;
    plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    plane.position.set(CAT_PORTAL.x, y + 3.6, CAT_PORTAL.z);
    const holder = new TransformNode("catPortalHolder", scene);
    plane.parent = holder;
    root.parent = holder;
    root.position.set(CAT_PORTAL.x, y, CAT_PORTAL.z);
    for (const mm of [ring, disc, pillar, plane]) mm.isPickable = false;
    this.portal = holder as unknown as TransformNode;
    // Вращаем только круг (root), табличка стоит.
    this.portalSpin = root;
  }
  private portalSpin: TransformNode | null = null;
}
