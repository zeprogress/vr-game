import type { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";

import type { PlayerMode, PlayerState, Xf } from "#shared/net/schema";
import type { WeaponClass, WeaponTier } from "#shared/items";
import { LOADOUT } from "../config/loadout";
import { NameTag } from "../ui/NameTag";

export type MakeWeapon = (cls: WeaponClass, tier: WeaponTier) => Mesh;

/** Рендерим на 100 мс в прошлом — между двумя пришедшими снапшотами. */
const INTERP_DELAY = 100;
/** Если свежий снапшот старше — держим позу (не экстраполируем). */
const HOLD_AFTER = 260;
const BUFFER_MS = 600;

interface Snap {
  t: number;
  mode: PlayerMode;
  head: readonly [number, number, number, number, number, number, number];
  handL: readonly [number, number, number, number, number, number, number];
  handR: readonly [number, number, number, number, number, number, number];
}

function snapXf(x: Xf): Snap["head"] {
  return [x.x, x.y, x.z, x.qx, x.qy, x.qz, x.qw];
}

/** Цвет игрока из его id — чтобы отличать аватары. */
function colorFor(id: string): Color3 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return Color3.FromHSV(h % 360, 0.55, 0.85);
}

/**
 * Чужой игрок. В VR — голова-куб + две кисти; в плоском — капсула + голова.
 * Транспорт сглаживается интерполяцией между снапшотами (4e).
 */
export class RemoteAvatar {
  private readonly root: TransformNode;
  private readonly mat: StandardMaterial;
  private readonly nameTag: NameTag;
  private head!: Mesh;
  private handL: Mesh | null = null;
  private handR: Mesh | null = null;
  private capsule: Mesh | null = null;
  private mode: PlayerMode | null = null;

  /** Оружие в руках — чтобы союзники видели, кто с чем. */
  private gearL: Mesh | null = null;
  private gearR: Mesh | null = null;
  private gearKeyL = "";
  private gearKeyR = "";
  private wantL: readonly [string, string] = ["", ""];
  private wantR: readonly [string, string] = ["", ""];

  private readonly buf: Snap[] = [];
  private readonly _qa = new Quaternion();
  private readonly _qb = new Quaternion();

  constructor(
    private readonly scene: Scene,
    id: string,
    nick: string,
    mode: PlayerMode,
    private readonly makeWeapon: MakeWeapon | null = null,
  ) {
    this.root = new TransformNode(`avatar_${id}`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();

    this.mat = new StandardMaterial(`avatarMat_${id}`, scene);
    this.mat.diffuseColor = colorFor(id);
    this.mat.specularColor = new Color3(0.1, 0.1, 0.1);

    this.nameTag = new NameTag(scene, this.root, new Vector3(0, 0.42, 0), nick, null);
    this.setMode(mode);
  }

  private setMode(mode: PlayerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.head?.dispose();
    this.handL?.dispose();
    this.handR?.dispose();
    this.capsule?.dispose();
    this.handL = this.handR = this.capsule = null;
    // Оружие висело на кистях/корпусе — пересоберём под новый режим.
    this.gearL?.dispose();
    this.gearR?.dispose();
    this.gearL = this.gearR = null;
    this.gearKeyL = this.gearKeyR = "";

    if (mode === "vr") {
      this.head = MeshBuilder.CreateBox("avatarHead", { size: 0.22 }, this.scene);
      this.handL = this.makeHand("avatarHandL");
      this.handR = this.makeHand("avatarHandR");
    } else {
      this.head = MeshBuilder.CreateSphere("avatarHead", { diameter: 0.24, segments: 8 }, this.scene);
      this.capsule = MeshBuilder.CreateCapsule(
        "avatarBody",
        { radius: 0.26, height: 1.5 },
        this.scene,
      );
      this.capsule.parent = this.root;
      this.capsule.position.set(0, -0.85, 0);
      this.capsule.material = this.mat;
      this.capsule.isPickable = false;
    }
    this.head.parent = this.root;
    this.head.rotationQuaternion = Quaternion.Identity();
    this.head.material = this.mat;
    this.head.isPickable = false;
  }

  private makeHand(name: string): Mesh {
    const h = MeshBuilder.CreateBox(name, { width: 0.09, height: 0.05, depth: 0.13 }, this.scene);
    h.parent = this.root;
    h.rotationQuaternion = Quaternion.Identity();
    h.material = this.mat;
    h.isPickable = false;
    return h;
  }

  /** Где сейчас голова — по ней голос звучит из нужного места. */
  get position(): Vector3 {
    return this.root.getAbsolutePosition();
  }

  /** Огонёк над головой, пока игрок говорит. */
  setSpeaking(on: boolean): void {
    if (on && !this.speakDot) {
      const dot = MeshBuilder.CreateSphere(`speak_${this.root.name}`, { diameter: 0.12, segments: 6 }, this.scene);
      const m = new StandardMaterial("speakMat", this.scene);
      m.emissiveColor = new Color3(0.4, 1, 0.5);
      m.diffuseColor = new Color3(0, 0, 0);
      m.specularColor = new Color3(0, 0, 0);
      m.disableLighting = true;
      dot.material = m;
      dot.parent = this.root;
      dot.position.set(0, 0.62, 0);
      dot.isPickable = false;
      this.speakDot = dot;
    }
    this.speakDot?.setEnabled(on);
  }
  private speakDot: Mesh | null = null;

  /** Пришло новое состояние от сервера — кладём снапшот с меткой времени. */
  push(now: number, p: PlayerState): void {
    this.wantL = [p.leftCls, p.leftTier];
    this.wantR = [p.rightCls, p.rightTier];
    const last = this.buf[this.buf.length - 1];
    const head = snapXf(p.head);
    // Дедуп: сервер шлёт ~18 Гц, кадров больше — не копим одинаковое.
    if (last && last.mode === p.mode && head.every((v, i) => Math.abs(v - last.head[i]) < 1e-4)) {
      return;
    }
    this.buf.push({ t: now, mode: p.mode, head, handL: snapXf(p.handL), handR: snapXf(p.handR) });
    while (this.buf.length > 2 && this.buf[0].t < now - BUFFER_MS) this.buf.shift();
  }

  /** Каждый кадр: ставим позу на INTERP_DELAY мс назад между снапшотами. */
  update(now: number): void {
    if (this.buf.length === 0) return;
    const target = now - INTERP_DELAY;

    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    if (target <= a.t) {
      b = a; // ещё нет истории — держим самый старый
    } else if (target >= b.t) {
      a = b; // отстали / игрок замер — держим самый свежий
    } else {
      for (let i = 1; i < this.buf.length; i++) {
        if (this.buf[i].t >= target) {
          a = this.buf[i - 1];
          b = this.buf[i];
          break;
        }
      }
    }

    const stale = now - b.t > HOLD_AFTER;
    const s = stale || b.t === a.t ? 1 : (target - a.t) / (b.t - a.t);

    this.setMode(b.mode);
    this.applyXf(this.root, this.head.rotationQuaternion!, a.head, b.head, s, true);
    if (this.mode === "vr") {
      this.applyXf(this.handL!, this.handL!.rotationQuaternion!, a.handL, b.handL, s, false);
      this.applyXf(this.handR!, this.handR!.rotationQuaternion!, a.handR, b.handR, s, false);
    }
    this.applyGear();
  }

  /** Показываем оружие в руках союзника — по данным сервера (leftCls/…). */
  private applyGear(): void {
    if (!this.makeWeapon) return;
    this.gearL = this.fitGear("left", this.wantL, this.gearL, () => (this.gearKeyL = keyOf(this.wantL)), this.gearKeyL);
    this.gearR = this.fitGear("right", this.wantR, this.gearR, () => (this.gearKeyR = keyOf(this.wantR)), this.gearKeyR);
  }

  private fitGear(
    side: "left" | "right",
    want: readonly [string, string],
    cur: Mesh | null,
    markKey: () => void,
    curKey: string,
  ): Mesh | null {
    const key = keyOf(want);
    if (key === curKey) return cur;
    cur?.dispose();
    markKey();
    const [cls, tier] = want;
    if (cls !== "sword" && cls !== "bow" && cls !== "shield") return null;
    if (!tier) return null;

    const mesh = this.makeWeapon!(cls as WeaponClass, tier as WeaponTier);
    mesh.isPickable = false;
    mesh.rotationQuaternion = null; // ставим углами Эйлера
    for (const c of mesh.getChildMeshes()) c.isPickable = false;

    if (this.mode === "vr") {
      const hand = side === "left" ? this.handL : this.handR;
      const slot = side === "left" ? "vrLeft" : "vrRight";
      const pl = LOADOUT.items[cls][slot];
      mesh.parent = hand ?? this.root;
      mesh.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
      mesh.rotation.set(pl.rot[0], pl.rot[1], pl.rot[2]);
      mesh.scaling.setAll(pl.scale);
    } else {
      // Плоский аватар: оружие просто держим сбоку от корпуса.
      mesh.parent = this.root;
      mesh.position.set(side === "left" ? -0.32 : 0.32, -0.35, 0.1);
      mesh.rotation.set(0, 0, side === "left" ? 0.5 : -0.5);
      mesh.scaling.setAll(0.7);
    }
    return mesh;
  }

  /** node.position (или root) + кватернион = интерполяция a->b. `isRoot` — позиция мировая. */
  private applyXf(
    node: TransformNode,
    q: Quaternion,
    a: Snap["head"],
    b: Snap["head"],
    s: number,
    isRoot: boolean,
  ): void {
    const x = a[0] + (b[0] - a[0]) * s;
    const y = a[1] + (b[1] - a[1]) * s;
    const z = a[2] + (b[2] - a[2]) * s;
    if (isRoot) {
      node.position.set(x, y, z);
    } else {
      const r = this.root.position;
      node.position.set(x - r.x, y - r.y, z - r.z);
    }
    this._qa.set(a[3], a[4], a[5], a[6]);
    this._qb.set(b[3], b[4], b[5], b[6]);
    Quaternion.SlerpToRef(this._qa, this._qb, s, q);
  }

  dispose(): void {
    this.speakDot?.dispose();
    this.gearL?.dispose();
    this.gearR?.dispose();
    this.nameTag.dispose();
    this.root.dispose(false, true);
  }
}

/** Ключ «класс:уровень» — по нему решаем, надо ли пересобирать меш оружия. */
function keyOf(w: readonly [string, string]): string {
  return `${w[0]}:${w[1]}`;
}
