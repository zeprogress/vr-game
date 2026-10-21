import { BOT, SKILL } from "#shared/constants";
import { BLINK, SPORE } from "#shared/mobs";
import { SkillFx } from "../ui/SkillFx";
import type { LabCtx } from "./main";
import { iceGiantLab } from "./sceneFxIce";
import { playSteelAct } from "../ui/SteelAct";
import { Sfx } from "../audio/Sfx";
import { FireFx } from "../ui/FireFx";
import { playDrawAct } from "../ui/DrawAct";
import { DRAW_IN, drawInPlan } from "#shared/drawIn";
import { dragonLab } from "./sceneFxDragon";

/** Эффекты умений из SkillFx — по кнопке в центре площадки, по кругу. */
export async function build(ctx: LabCtx): Promise<void> {
  const fx = new SkillFx(ctx.scene);
  ctx.onFrame((dt) => fx.update(dt));
  const { ui } = ctx;
  ui.note("Каждая кнопка запускает эффект в центре площадки — так, как его видят игроки и спектатор.");
  ui.button("🍄 Облако спор колосса", () => fx.sporeZone(0, 0, 0, SPORE.radius, SPORE.windup, SPORE.duration));
  ui.button("💀 Призрак: растворяется", () => fx.wraithPuff(0, 0, 0, BLINK.fade, false));
  ui.button("💀 Призрак: возникает", () => fx.wraithPuff(0, 0, 0, 0.6, true));
  ui.button("🔴 Оглушающий удар", () => fx.stunBash(0, 0, 0, BOT.stunRadius, BOT.stunCastTime));
  ui.button("🐉 Дыхание дракона: предупреждение", () => fx.breathCone(0, 0, 0, 0, 15, 1.1, false));
  ui.button("🐉 Дыхание дракона: огонь", () => fx.breathCone(0, 0, 0, 0, 15, 0.6, true));
  ui.button("🦑 Щупальце спрута: предупреждение", () => fx.tentacle(0, 1.6, 0, 6, 1.1, 8, 0.9, false));
  ui.button("🦑 Щупальце спрута: хват", () => fx.tentacle(0, 1.6, 0, 6, 1.1, 8, 0.35, true));
  ui.button("🏹 Град стрел", () => fx.arrowRain(0, 0, 0, BOT.rainRadius, BOT.rainCastTime, SKILL.arrowRain.duration));
  // 🔥 Аура раскалённой стали: воин в центре, три горящих врага; режим — по оружию (щит / меч / дуалы).
  const sfx = new Sfx();
  const hero = { x: 0, y: 0, z: 0 };
  const actx = { scene: ctx.scene, sfx, follow: () => ({ ...hero }), bone: () => null, ground: () => 0 };
  const burners = [[4, 2], [-3, 4], [1, -5]];
  const steel = (label: string, mode: number): void =>
    ui.button(label, () => {
      sfx.resume();
      ctx.frame(0, 2, 0, 14);
      playSteelAct(actx, "steelAura", hero.x, hero.y, hero.z, "hero", 6, undefined, undefined, 6, undefined, mode);
      const fire = FireFx.of(ctx.scene);
      for (let t = 0; t < 6; t++) {
        fire.after(t, () => {
          for (const [x, z] of burners) playSteelAct(actx, "steelBurn", x, 0, z, "hero", undefined, undefined, undefined, undefined, undefined, mode);
        });
      }
    });
  steel("🔥 Аура стали: щит (огонь, лечение)", 0);
  steel("🔥 Аура стали: один меч (иней, замедление)", 1);
  steel("🔥 Аура стали: дуалы (багрянец)", 2);
  // 🧲 Стягивание: восемь мобов по кругу 8 м вокруг воина; режим — по оружию (щит / один меч / дуалы).
  const drawMobs = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i * 0.785) * 8, z: Math.sin(i * 0.785) * 8 }));
  const draw = (label: string, mode: number): void =>
    ui.button(label, () => {
      sfx.resume();
      const plan = drawInPlan(mode as 0 | 1 | 2, 0, 1, 0, 0, drawMobs);
      playDrawAct(actx, "drawIn", 0, 0, 0, "hero", DRAW_IN.sec, undefined, undefined, DRAW_IN.radius, undefined, mode);
      drawMobs.forEach((m, i) =>
        playDrawAct(actx, "drawPull", m.x, 0, m.z, "hero", DRAW_IN.sec, plan[i].x, plan[i].z, undefined, `lab${i}`, mode));
      FireFx.of(ctx.scene).after(DRAW_IN.sec, () => {
        for (const q of plan.slice(0, 6)) playDrawAct(actx, "drawImpact", q.x, 0, q.z, "hero", undefined, undefined, undefined, undefined, undefined, mode);
      });
    });
  draw("🧲 Стягивание: щит (перед собой)", 0);
  draw("🧲 Стягивание: один меч (по бокам)", 1);
  draw("🧲 Стягивание: два меча (вокруг)", 2);
  await iceGiantLab(ctx);
  await dragonLab(ctx);
}
