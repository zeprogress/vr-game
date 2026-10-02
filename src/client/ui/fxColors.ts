import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FX_RGB, type FxColor } from "#shared/look";

/**
 * Цвета эффектов как Color3 — из общей палитры shared/look.ts (FX_RGB).
 * Один экземпляр на цвет: не менять на месте — для правок брать .clone().
 */
export const FXC = Object.fromEntries(
  Object.entries(FX_RGB).map(([k, [r, g, b]]) => [k, new Color3(r, g, b)]),
) as Record<FxColor, Color3>;
