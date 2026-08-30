import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { PROGRESSION } from "../shared/constants";
import type { PlayerController } from "../player/PlayerController";
import type { Progression } from "../player/Progression";
import type { Sfx } from "../audio/Sfx";
import type { CombatSystem } from "./CombatSystem";
import type { Mob, MobContext } from "./Mob";

/** Крутит AI мобов каждый кадр. */
export class MobSystem {
  private readonly ctx: MobContext;

  constructor(
    private readonly mobs: Mob[],
    player: PlayerController,
    sfx: Sfx,
    prog: Progression,
    combat: () => CombatSystem,
    groundHeight: (x: number, z: number) => number,
  ) {
    this.ctx = {
      playerPos: player.position,
      groundHeight,
      hurtPlayer: (amount: number, dir: Vector3, from: Vector3) => {
        // Щит/меч могут погасить удар целиком или частично.
        const mult = combat().absorbAttack(from);
        if (mult <= 0) return;
        player.damage(amount * mult, dir);
      },
      onHop: () => sfx.mobHop(),
      onHurt: () => sfx.mobHurt(),
      onDie: () => {
        sfx.mobDie();
        prog.addXp(PROGRESSION.xpPerMob);
      },
    };
  }

  update(dt: number): void {
    for (const m of this.mobs) m.update(dt, this.ctx);
  }
}
