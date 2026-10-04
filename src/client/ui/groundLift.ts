import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Круги эффектов на земле (умения, баффы, метки атак мобов) — «подтянуты» к камере на GROUND_LIFT
 * метров вдоль луча взгляда: на экране круг на том же месте, но по глубине ближе, и бугры земли его
 * не срезают (zOffset в «единицах глубины» на неровной земле не спасал). Герои в круге по-прежнему
 * его перекрывают — кроме самых ступней. Ближе к камере сдвиг меньше (не больше 40% расстояния).
 */
export const GROUND_LIFT = 1.2;

/** GLSL для своих шейдеров: сдвигает мировую точку `wp` к камере. Нужен `uniform vec3 cameraPosition;`. */
export const GROUND_LIFT_GLSL = `{
  vec3 glTo = cameraPosition - wp.xyz;
  float glD = length(glTo);
  wp.xyz += glTo / max(glD, 0.001) * min(${GROUND_LIFT.toFixed(2)}, glD * 0.4);
}`;

/** То же для StandardMaterial — через плагин материала (точка вставки CUSTOM_VERTEX_UPDATE_WORLDPOS). */
class GroundLiftPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "GroundLift", 200, { GROUND_LIFT: false });
    this._enable(true);
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines["GROUND_LIFT"] = true;
  }

  override getClassName(): string {
    return "GroundLiftPlugin";
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [{ name: "liftEye", size: 3, type: "vec3" }],
      vertex: "#ifdef GROUND_LIFT\nuniform vec3 liftEye;\n#endif",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const cam = scene.activeCamera;
    if (cam) ubo.updateVector3("liftEye", cam.globalPosition);
  }

  override getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef GROUND_LIFT
{
  vec3 glTo = liftEye - worldPos.xyz;
  float glD = length(glTo);
  worldPos.xyz += glTo / max(glD, 0.001) * min(${GROUND_LIFT.toFixed(2)}, glD * 0.4);
}
#endif`,
    };
  }
}

/** Круг эффекта на земле на StandardMaterial: подтянуть к камере (см. GROUND_LIFT). */
export function liftOnGround(mat: Material): void {
  new GroundLiftPlugin(mat);
}
