import { BLINK, BOT, SKILL, SPORE } from "#shared/constants";
import { SkillFx } from "../ui/SkillFx";
import type { LabCtx } from "./main";

/** Эффекты умений из SkillFx — по кнопке в центре площадки, по кругу. */
export function build(ctx: LabCtx): void {
  const fx = new SkillFx(ctx.scene);
  ctx.onFrame((dt) => fx.update(dt));
  const { ui } = ctx;
  ui.note("Каждая кнопка запускает эффект в центре площадки — так, как его видят игроки и спектатор.");
  ui.button("🍄 Облако спор колосса", () => fx.sporeZone(0, 0, 0, SPORE.radius, SPORE.windup, SPORE.duration));
  ui.button("💀 Призрак: растворяется", () => fx.wraithPuff(0, 0, 0, BLINK.fade, false));
  ui.button("💀 Призрак: возникает", () => fx.wraithPuff(0, 0, 0, 0.6, true));
  ui.button("🔴 Оглушающий удар", () => fx.stunBash(0, 0, 0, BOT.stunRadius, BOT.stunCastTime));
  ui.button("🏹 Град стрел", () => fx.arrowRain(0, 0, 0, BOT.rainRadius, BOT.rainCastTime, SKILL.arrowRain.duration));
}
