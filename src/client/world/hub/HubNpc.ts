import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { terrainHeight } from "#shared/terrain";
import { NameTag } from "../../ui/NameTag";
import type { ModelName } from "../models";

/** Масштаб рига персонажа — как у аватаров игроков (LocalAvatar.RIG_SCALE). */
const RIG_SCALE = 0.52;

/**
 * NPC лагеря (трактирщик и т.п.): модель персонажа из пака, стоит на месте
 * и крутит Idle, над головой — плашка с именем. Без логики — взаимодействие
 * (E у NPC) ведёт Game по расстоянию.
 */
export function spawnHubNpc(
  scene: Scene,
  model: ModelName,
  x: number,
  z: number,
  /** Куда смотрит: точка в мире. */
  faceX: number,
  faceZ: number,
  title: string,
  accent: Color3 = new Color3(1, 0.8, 0.35),
): TransformNode {
  const root = new TransformNode(`npc_${title}`, scene);
  root.position.set(x, terrainHeight(x, z), z);
  root.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.atan2(faceX - x, faceZ - z), 0, 0);
  const tag = new NameTag(scene, root, new Vector3(0, 2.5, 0), title, null, accent);
  tag.setNameColor("#c79bff");
  tag.setScale(2.6);
  void (async () => {
    try {
      const { loadRig, recolorCharacter } = await import("../models");
      const make = await loadRig(scene, model);
      if (root.isDisposed()) return;
      const rig = make();
      const holder = new TransformNode(`npcModel_${title}`, scene);
      holder.parent = root;
      holder.scaling.setAll(RIG_SCALE);
      rig.root.parent = holder;
      rig.root.position.setAll(0);
      recolorCharacter(rig.root);
      for (const m of rig.meshes) m.isPickable = false;
      for (const g of rig.anims.values()) g.stop();
      const idle = rig.anims.get("idle");
      idle?.start(true, 1, idle.from, idle.to, false);
    } catch (e) {
      console.warn("[npc] модель не загрузилась:", (e as Error).message);
    }
  })();
  return root;
}

/**
 * Жёлтый «!» над NPC/доской — есть что взять или сдать. Светится сам,
 * покачивается и крутится; включает Game по данным заданий.
 */
export class QuestBang {
  private readonly node: TransformNode;
  private t = Math.random() * 6;
  private baseY: number;
  private on = false;

  constructor(scene: Scene, x: number, z: number, height: number) {
    this.node = new TransformNode("questBang", scene);
    this.baseY = terrainHeight(x, z) + height;
    this.node.position.set(x, this.baseY, z);
    const mat = new StandardMaterial("questBangMat", scene);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(1, 0.8, 0.15);
    mat.disableLighting = true;
    const bar = MeshBuilder.CreateBox("questBangBar", { width: 0.18, height: 0.6, depth: 0.18 }, scene);
    bar.position.y = 0.45;
    const dot = MeshBuilder.CreateBox("questBangDot", { width: 0.18, height: 0.18, depth: 0.18 }, scene);
    for (const m of [bar, dot]) {
      m.material = mat;
      m.parent = this.node;
      m.isPickable = false;
    }
    this.node.setEnabled(false);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.node.setEnabled(on);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    this.node.position.y = this.baseY + Math.sin(this.t * 2.2) * 0.12;
    this.node.rotation.y += dt * 1.5;
  }
}
