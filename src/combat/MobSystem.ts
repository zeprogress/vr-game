import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

import type { PlayerController } from "../player/PlayerController";
import type { Sfx } from "../audio/Sfx";
import type { Mob, MobContext } from "./Mob";

/** Крутит AI мобов каждый кадр. */
export class MobSystem {
  private readonly ctx: MobContext;

  constructor(
    private readonly mobs: Mob[],
    player: PlayerController,
    sfx: Sfx,
    groundHeight: (x: number, z: number) => number,
  ) {
    this.ctx = {
      playerPos: player.position,
      groundHeight,
      hurtPlayer: (amount: number, dir: Vector3) => player.damage(amount, dir),
      onHop: () => sfx.mobHop(),
      onHurt: () => sfx.mobHurt(),
      onDie: () => sfx.mobDie(),
    };
  }

  update(dt: number): void {
    for (const m of this.mobs) m.update(dt, this.ctx);
  }
}
