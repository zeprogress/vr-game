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
  player: PlayerController,
  combat: CombatSystem,
  net: NetClient,
  onPrompt: (text: string) => void,
): Fishing {
  let phase: Phase = "idle";
  let timer = 0;
  let biteWindow = 0;
  let prevInteract = false;

  // Зона заброса — прибрежная полоса вокруг эллипса озера (не посреди воды,
  // не далеко в поле).
  const isNearShore = (x: number, z: number): boolean => {
    const ld = lakeEllipseDist(x, z);
    const shoreOuter = LAKE_R_AVG + LAKE.shoreFade;
    return ld > shoreOuter - 6 && ld < shoreOuter + 9;
  };

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
        return;
      }
      if (biteWindow <= 0) {
        phase = "idle";
        combat.fishing = false;
        onPrompt("Сорвалась…");
      }
    },
  };
}
