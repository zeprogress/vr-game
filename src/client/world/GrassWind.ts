import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";

/** Ветер: сила наклона на метр высоты и скорость колыхания. */
export const WIND = {
  strength: 0.3, // во сколько от высоты травинка уходит вбок
  speed: 1.9, // скорость покачивания
  gust: 0.35, // добавка от медленных порывов
} as const;

/**
 * Колыхание травы в вершинном шейдере.
 *
 * Пучков тысячи, и это thin-инстансы: пересчитывать их матрицы на процессоре
 * каждый кадр слишком дорого. Поэтому наклон считает видеокарта — по высоте
 * вершины над основанием (низ не двигается, верхушка гуляет) и по фазе,
 * своей у каждого пучка (атрибут `windPhase`), чтобы поле не качалось разом.
 */
export class GrassWindPlugin extends MaterialPluginBase {
  /** Секунды с запуска — двигает волну. */
  time = 0;

  constructor(material: Material) {
    super(material, "GrassWind", 200, { GRASS_WIND: true });
    this._enable(true);
  }

  override getClassName(): string {
    return "GrassWindPlugin";
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.GRASS_WIND = true;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push("windPhase");
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    vertex: string;
  } {
    return {
      ubo: [
        { name: "windTime", size: 1, type: "float" },
        { name: "windStrength", size: 1, type: "float" },
        { name: "windGust", size: 1, type: "float" },
      ],
      vertex: `
        uniform float windTime;
        uniform float windStrength;
        uniform float windGust;
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("windTime", this.time);
    uniformBuffer.updateFloat("windStrength", WIND.strength);
    uniformBuffer.updateFloat("windGust", WIND.gust);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `
        attribute float windPhase;
      `,
      // positionUpdated ещё в локальных осях пучка: y = 0 у земли.
      CUSTOM_VERTEX_UPDATE_POSITION: `
        float bend = max(positionUpdated.y, 0.0);
        float ph = windPhase + windTime;
        float sway = sin(ph) + windGust * sin(ph * 0.37 + 1.3);
        positionUpdated.x += sway * bend * windStrength;
        positionUpdated.z += cos(ph * 0.8) * bend * windStrength * 0.45;
      `,
    };
  }
}
