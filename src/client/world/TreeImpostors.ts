import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Scene as SceneCls } from "@babylonjs/core/scene";
import "@babylonjs/core/Meshes/thinInstanceMesh";

/**
 * Дальние деревья — плоские «снимки» вместо моделей.
 *
 * Для каждого вида дерева при загрузке делаем снимок (ортографическая камера, дневной
 * свет, прозрачный фон) в текстуру, а дальше рисуем по одному билборду на дерево:
 * thin-инстансы одного меша на вид (5 draw call'ов на весь лес), квад поворачивается
 * к зрителю вокруг вертикали прямо в вершинном шейдере. Освещённость берём от
 * времени суток (uLit), туман — как у сцены.
 */

const MASK = 0x10000000; // слой снимка: обычные камеры его не видят

export interface ImpostorTree {
  kind: number;
  x: number;
  y: number;
  z: number;
  /** Масштаб корня дерева (root.scaling) — относительно эталона вида. */
  scale: number;
  /** Реальные меши дерева (кора + листва) — из них снимаем эталон вида. */
  meshes: Mesh[];
}

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
uniform mat4 view;
varying vec2 vUv;
varying float vDist;
void main() {
  vec3 base = world3.xyz;
  float sx = world0.x;
  float sy = world1.y;
  // Билборд смотрит НА ПОЗИЦИЮ камеры (цилиндрический: вокруг вертикали), а не по её
  // направлению взгляда — иначе при повороте головы деревья «крутятся» вместе с ней.
  vec3 t = view[3].xyz;
  vec3 cam = -vec3(dot(view[0].xyz, t), dot(view[1].xyz, t), dot(view[2].xyz, t));
  vec3 toCam = cam - base;
  vec3 d = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(-d.z, 0.0, d.x);
  vec3 p = base + right * (position.x * sx) + vec3(0.0, position.y * sy, 0.0);
  vDist = length(p - cam);
  vUv = uv;
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(p, 1.0); } else { gl_Position = viewProjectionR * vec4(p, 1.0); }
#else
  gl_Position = viewProjection * vec4(p, 1.0);
#endif
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vDist;
uniform sampler2D tex;
uniform float uLit;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
void main() {
  vec4 c = texture2D(tex, vUv);
  if (c.a < 0.4) discard;
  vec3 col = c.rgb * uLit;
  float f = clamp((vDist - uFogStart) / max(1.0, uFogEnd - uFogStart), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
}
`;

interface Kind {
  mesh: Mesh;
  mat: ShaderMaterial;
  /** Размеры эталона в метрах при scale=1 эталона и сдвиг низа. */
  w: number;
  h: number;
  yOff: number;
  refScale: number;
  buf: Float32Array;
  ids: number[]; // индексы деревьев этого вида
  shown: Uint8Array;
}

let current: TreeImpostors | null = null;
export function impostorsReady(): boolean {
  return !!current && current.ready;
}
export function impostorsUpdate(cam: Vector3, fx: number, fz: number, farR: number, nearR: number): void {
  current?.update(cam, fx, fz, farR, nearR);
}
export function impostorsDaylight(daylight: number): void {
  current?.setDaylight(daylight);
}

export class TreeImpostors {
  ready = false;
  private readonly kinds = new Map<number, Kind>();
  private lit = 1;

  constructor(
    private readonly scene: Scene,
    private readonly trees: ImpostorTree[],
  ) {
    current = this;
    void this.capture();
  }

  /** Снимаем эталон каждого вида: клоны мешей в отдельном слое + ортокамера + дневной свет. */
  private async capture(): Promise<void> {
    const byKind = new Map<number, ImpostorTree[]>();
    for (const t of this.trees) {
      const l = byKind.get(t.kind);
      if (l) l.push(t);
      else byKind.set(t.kind, [t]);
    }
    for (const [kind, list] of byKind) {
      try {
        await this.captureKind(kind, list);
      } catch (e) {
        console.warn("[impostor] снимок дерева не получился", kind, e);
      }
    }
    this.ready = this.kinds.size > 0;
  }

  private captureKind(kind: number, list: ImpostorTree[]): Promise<void> {
    const scene = this.scene;
    const ref = list[0];
    // Клоны реальных мешей эталонного дерева (у инстансов свой sourceMesh — берём только настоящие).
    const clones: Mesh[] = [];
    const capMats: StandardMaterial[] = [];
    for (const m of ref.meshes) {
      const src = (m.isAnInstance ? (m as unknown as { sourceMesh: Mesh }).sourceMesh : m) as Mesh;
      const c = src.clone(`impCap_${kind}_${clones.length}`, null, true);
      if (!c) continue;
      c.unfreezeWorldMatrix();
      c.doNotSyncBoundingInfo = false;
      // Мировой трансформ дерева: позиция/поворот/масштаб корня + собственный scaling меша.
      const w = m.computeWorldMatrix(true);
      const scl = new Vector3();
      const pos = new Vector3();
      const rq = new Quaternion();
      w.decompose(scl, rq, pos);
      c.rotationQuaternion = rq;
      c.scaling.copyFrom(scl);
      c.position.copyFrom(pos);
      // Своя эмиссивная копия материала: снимок не зависит от света сцены и не
      // трогает общие (замороженные) материалы деревьев.
      const om = m.material as (StandardMaterial & { diffuseTexture?: unknown }) | null;
      const cm = new StandardMaterial(`impCapMat_${kind}_${clones.length}`, scene);
      cm.disableLighting = true;
      const tex = (om?.diffuseTexture ?? null) as StandardMaterial["diffuseTexture"];
      if (tex) {
        cm.diffuseTexture = tex;
        cm.emissiveTexture = tex;
        cm.useAlphaFromDiffuseTexture = true;
        cm.transparencyMode = 1; // ALPHATEST
        cm.alphaCutOff = 0.28;
        cm.emissiveColor = new Color3(0.78, 0.86, 0.66); // листва: как днём на свету
      } else {
        const d = om?.diffuseColor ?? new Color3(0.3, 0.2, 0.13);
        cm.emissiveColor = new Color3(d.r * 1.5, d.g * 1.5, d.b * 1.5);
      }
      cm.diffuseColor = new Color3(0, 0, 0);
      cm.specularColor = new Color3(0, 0, 0);
      cm.backFaceCulling = false;
      c.material = cm;
      capMats.push(cm);
      c.layerMask = MASK;
      c.isPickable = false;
      c.setEnabled(true);
      c.isVisible = true;
      c.alwaysSelectAsActiveMesh = true;
      clones.push(c);
    }
    if (!clones.length) return Promise.resolve();

    // Габариты дерева в мире.
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of clones) {
      c.computeWorldMatrix(true);
      c.refreshBoundingInfo();
      const b = c.getBoundingInfo().boundingBox;
      minX = Math.min(minX, b.minimumWorld.x);
      maxX = Math.max(maxX, b.maximumWorld.x);
      minY = Math.min(minY, b.minimumWorld.y);
      maxY = Math.max(maxY, b.maximumWorld.y);
      minZ = Math.min(minZ, b.minimumWorld.z);
      maxZ = Math.max(maxZ, b.maximumWorld.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const height = maxY - minY;
    const width = Math.max(maxX - minX, maxZ - minZ);
    const halfW = (width / 2) * 1.06;
    const cy = (minY + maxY) / 2;
    const halfH = (height / 2) * 1.04;

    const cam = new FreeCamera(`impCam_${kind}`, new Vector3(cx, cy, cz - 30), scene);
    cam.setTarget(new Vector3(cx, cy, cz));
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.orthoLeft = -halfW;
    cam.orthoRight = halfW;
    cam.orthoTop = halfH;
    cam.orthoBottom = -halfH;
    cam.minZ = 1;
    cam.maxZ = 80;
    cam.layerMask = MASK;

    const texW = 256;
    const texH = Math.min(512, Math.max(128, Math.round((texW * halfH) / halfW)));
    const rtt = new RenderTargetTexture(`impTex_${kind}`, { width: texW, height: texH }, scene, true);
    rtt.renderList = clones;
    rtt.activeCamera = cam;
    rtt.clearColor = new Color4(0, 0, 0, 0);
    rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    rtt.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    rtt.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;

    // Свет не используем вовсе: у клонов свои материалы с эмиссивной заливкой (см. выше).

    // Туман в снимок не пишем.
    let fog = scene.fogMode;
    rtt.onBeforeRenderObservable.add(() => {
      fog = scene.fogMode;
      scene.fogMode = SceneCls.FOGMODE_NONE;
    });
    rtt.onAfterRenderObservable.add(() => {
      scene.fogMode = fog;
    });
    scene.customRenderTargets.push(rtt);

    return new Promise<void>((resolve) => {
      rtt.onAfterRenderObservable.addOnce(() => {
        // Снимок готов: строим билборды вида и убираем временное.
        this.buildKind(kind, list, rtt, {
          w: halfW * 2,
          h: halfH * 2,
          yOff: cy - halfH - ref.y, // низ снимка относительно корня дерева
          refScale: ref.scale,
        });
        const idx = scene.customRenderTargets.indexOf(rtt);
        if (idx >= 0) scene.customRenderTargets.splice(idx, 1);
        rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        setTimeout(() => {
          cam.dispose();
          for (const c of clones) c.dispose();
          for (const mt of capMats) mt.dispose();
        }, 100);
        resolve();
      });
    });
  }

  private buildKind(
    kind: number,
    list: ImpostorTree[],
    rtt: RenderTargetTexture,
    d: { w: number; h: number; yOff: number; refScale: number },
  ): void {
    const scene = this.scene;
    const mesh = new Mesh(`treeImp_${kind}`, scene);
    const vd = new VertexData();
    // Квад: x ∈ [-0.5, 0.5] (масштаб — ширина), y ∈ [0, 1] (масштаб — высота).
    vd.positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vd.applyToMesh(mesh);

    const mat = new ShaderMaterial(
      `treeImpMat_${kind}`,
      scene,
      { vertexSource: VERT, fragmentSource: FRAG },
      {
        attributes: ["position", "uv"], // world0..3 добавит Babylon для thin-инстансов
        uniforms: ["viewProjection", "view", "uLit", "uFogColor", "uFogStart", "uFogEnd"],
        samplers: ["tex"],
      },
    );
    mat.setTexture("tex", rtt);
    mat.setFloat("uLit", 1);
    mat.setColor3("uFogColor", scene.fogColor);
    mat.setFloat("uFogStart", scene.fogStart);
    mat.setFloat("uFogEnd", scene.fogEnd);
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;

    const buf = new Float32Array(list.length * 16);
    mesh.thinInstanceSetBuffer("matrix", buf, 16, false);
    this.kinds.set(kind, {
      mesh,
      mat,
      w: d.w,
      h: d.h,
      yOff: d.yOff,
      refScale: d.refScale,
      buf,
      ids: list.map((t) => this.trees.indexOf(t)),
      shown: new Uint8Array(list.length),
    });
    // Всё скрыто, пока update() не решит иначе.
    this.writeAll(kind, () => false, new Vector3());
  }

  private writeAll(kind: number, visible: (t: ImpostorTree) => boolean, _cam: Vector3): void {
    const k = this.kinds.get(kind);
    if (!k) return;
    let count = 0;
    for (let n = 0; n < k.ids.length; n++) {
      const t = this.trees[k.ids[n]];
      const vis = visible(t);
      k.shown[n] = vis ? 1 : 0;
      if (!vis) continue;
      const r = t.scale / k.refScale;
      // Compose: масштаб (w*r, h*r, 1), позиция (x, y + yOff*r, z).
      const o = count * 16;
      k.buf.fill(0, o, o + 16);
      k.buf[o] = k.w * r;
      k.buf[o + 5] = k.h * r;
      k.buf[o + 10] = 1;
      k.buf[o + 12] = t.x;
      k.buf[o + 13] = t.y + k.yOff * r;
      k.buf[o + 14] = t.z;
      k.buf[o + 15] = 1;
      count++;
    }
    k.mesh.thinInstanceCount = count;
    k.mesh.thinInstanceBufferUpdated("matrix");
    k.mesh.setEnabled(count > 0);
  }

  /** Дневная освещённость 0..1 → яркость снимков. */
  setDaylight(daylight: number): void {
    this.lit = 0.2 + 0.8 * Math.max(0, Math.min(1, daylight));
    const sc = this.scene;
    for (const k of this.kinds.values()) {
      k.mat.setFloat("uLit", this.lit);
      k.mat.setColor3("uFogColor", sc.fogColor);
      k.mat.setFloat("uFogStart", sc.fogStart);
      k.mat.setFloat("uFogEnd", sc.fogEnd);
    }
  }

  /**
   * Раз в ~0.2 с: какие деревья показывать снимком. Между `nearR` (там ещё настоящая
   * модель) и `farR`; в VR (fx/fz ≠ 0) — по секторам: ±30° — farR, до ±60° — 3/4 farR.
   */
  update(cam: Vector3, fx: number, fz: number, farR: number, nearR: number): void {
    if (!this.ready) return;
    const sector = fx !== 0 || fz !== 0;
    for (const kind of this.kinds.keys()) {
      this.writeAll(
        kind,
        (t) => {
          const dx = t.x - cam.x;
          const dz = t.z - cam.z;
          const d = Math.hypot(dx, dz);
          if (d <= nearR - 2) return false; // тут настоящая модель
          let lim = farR;
          if (sector) {
            const cosA = (dx * fx + dz * fz) / Math.max(1e-3, d);
            lim = cosA > 0.83 ? farR : cosA > 0.47 ? farR * 0.75 : 0;
          }
          return d <= lim;
        },
        cam,
      );
    }
  }

  dispose(): void {
    for (const k of this.kinds.values()) {
      k.mesh.dispose(false, true);
      k.mat.dispose();
    }
    this.kinds.clear();
    if (current === this) current = null;
    this.ready = false;
  }
}
