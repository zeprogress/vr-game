import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { buildFishRod } from "../entities/RemoteAvatar";

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
      // Якорь руки игрока: +Y — вдоль предплечья к пальцам, поэтому
      // рукоять кладём в ладонь и наклоняем хлыст вперёд-вверх.
      rod = buildFishRod(scene, "fishRodLocal", combat.getHandAnchor("right"), {
        pos: [0, 0, 0.02],
        rot: [-0.6, 0, 0],
      });
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
          timer = 60 + Math.random() * 60; // 1-2 мин до поклёвки (см. FISH_WAIT_* в ZoneRoom.ts)
          combat.fishing = true;
          combat.setFishingGearHidden(true);
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
          biteWindow = 1.4; // сервер принимает подсечку до 1.5с после поклёвки
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
        combat.setFishingGearHidden(false);
        hideRod();
        return;
      }
      if (biteWindow <= 0) {
        phase = "idle";
        combat.fishing = false;
        combat.setFishingGearHidden(false);
        hideRod();
        onPrompt("Сорвалась…");
      }
    },
  };
}
