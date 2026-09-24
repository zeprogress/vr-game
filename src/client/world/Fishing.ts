import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import type { PlayerController } from "../player/PlayerController";
import type { CombatSystem } from "../combat/CombatSystem";
import type { NetClient } from "../net/NetClient";
import { LAKE } from "#shared/constants";
import { lakeEllipseDist, LAKE_R_AVG } from "#shared/terrain";

/**
 * Рыбалка v1 (см. план «озеро+рыбалка»): подойти к воде, E — заброс,
 * случайная пауза, E в окне поклёвки — поймал. Полностью визуальный таймер
 * тут, на клиенте — факт поимки подтверждает сервер (см. ZoneRoom.ts,
 * MSG.fish): сервер держит свой независимый таймер и просто не начислит
 * рыбу, если подсечка пришла не вовремя. Обратная связь — общий тост по
 * MSG.picked (Game.ts, net.onPicked), отдельного UI не заводим.
 */
export interface Fishing {
  update(dt: number): void;
}

type Phase = "idle" | "waiting" | "bite";

export function createFishing(
  scene: Scene,
  player: PlayerController,
  combat: CombatSystem,
  net: NetClient,
  onPrompt: (text: string) => void,
): Fishing {
  let phase: Phase = "idle";
  let timer = 0;
  let biteWindow = 0;
  let prevInteract = false;
  let rod: Mesh | null = null;

  // Зона заброса — прибрежная полоса вокруг эллипса озера (не посреди воды,
  // не далеко в поле).
  const isNearShore = (x: number, z: number): boolean => {
    const ld = lakeEllipseDist(x, z);
    const shoreOuter = LAKE_R_AVG + LAKE.shoreFade;
    return ld > shoreOuter - 6 && ld < shoreOuter + 9;
  };

  // Удочка — не настоящее оружие (fitGear/handAnchor целят на sword/bow/
  // shield/staff), поэтому отдельный лёгкий меш прямо в руке игрока, без
  // системы держания предметов.
  const showRod = (): void => {
    if (!rod) {
      rod = MeshBuilder.CreateCylinder(
        "fishRodLocal",
        { diameterTop: 0.015, diameterBottom: 0.03, height: 1.3, tessellation: 6 },
        scene,
      );
      const mat = new StandardMaterial("fishRodLocalMat", scene);
      mat.diffuseColor = new Color3(0.35, 0.24, 0.12);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      mat.maxSimultaneousLights = 1;
      rod.material = mat;
      rod.isPickable = false;
      rod.parent = combat.getHandAnchor("right");
      rod.position.set(0.05, -0.05, 0.15);
      rod.rotation.set(0.9, 0, 0);
    }
    rod.setEnabled(true);
  };
  const hideRod = (): void => rod?.setEnabled(false);

  return {
    update(dt: number): void {
      const inp = player.lastInput;
      const edge = inp.interact && !prevInteract;
      prevInteract = inp.interact;

      if (phase === "idle") {
        combat.fishing = false;
        if (edge && isNearShore(player.position.x, player.position.z)) {
          phase = "waiting";
          timer = 2 + Math.random() * 4; // 2-6с до поклёвки
          combat.fishing = true;
          showRod();
          // Замах "удара" — переиспользуем как анимацию заброса (звук+клип
          // у остальных клиентов идёт по тому же MSG.act, что и меч).
          const pos = player.position;
          net.sendAct("swing", pos.x, pos.y, pos.z);
          net.sendFish("cast");
          onPrompt("Заброс…");
        }
        return;
      }

      combat.fishing = true;
      if (phase === "waiting") {
        timer -= dt;
        if (timer <= 0) {
          phase = "bite";
          biteWindow = 1.1;
          onPrompt("Клюёт! Жми E");
        }
        return;
      }

      // phase === "bite"
      biteWindow -= dt;
      if (edge) {
        net.sendFish("reel");
        phase = "idle";
        combat.fishing = false;
        hideRod();
        return;
      }
      if (biteWindow <= 0) {
        phase = "idle";
        combat.fishing = false;
        hideRod();
        onPrompt("Сорвалась…");
      }
    },
  };
}
