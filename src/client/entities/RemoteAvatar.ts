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
import { NameTag } from "../ui/NameTag";

/** Цвет игрока из его id — чтобы отличать аватары. */
function colorFor(id: string): Color3 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return Color3.FromHSV((h % 360), 0.55, 0.85);
}

/**
 * Чужой игрок. В VR — голова-куб + две кисти; в плоском — капсула + голова.
 * Этап 4d: транспорт присваивается напрямую (интерполяция — 4e).
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

  constructor(
    private readonly scene: Scene,
    id: string,
    nick: string,
    mode: PlayerMode,
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

  /** Присвоить транспорт из состояния (без сглаживания — 4d). */
  applyState(p: PlayerState): void {
    this.setMode(p.mode);

    this.root.position.set(p.head.x, p.head.y, p.head.z);
    setQuat(this.head.rotationQuaternion!, p.head);

    if (this.mode === "vr") {
      this.local(this.handL!, p.handL);
      this.local(this.handR!, p.handR);
    }
  }

  private local(mesh: Mesh, xf: Xf): void {
    mesh.position.set(xf.x - this.root.position.x, xf.y - this.root.position.y, xf.z - this.root.position.z);
    setQuat(mesh.rotationQuaternion!, xf);
  }

  dispose(): void {
    this.nameTag.dispose();
    this.root.dispose(false, true);
  }
}

function setQuat(q: Quaternion, xf: Xf): void {
  q.set(xf.qx, xf.qy, xf.qz, xf.qw);
}
