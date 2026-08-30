import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";

/** Ветер: сила наклона, скорость волны и её длина. */
export const WIND = {
  strength: 0.32, // во сколько от высоты травинка уходит вбок
  speed: 1.15, // скорость бега волны
  gust: 0.3, // вторая, более длинная волна — порывы
  /** Куда дует (единичный вектор в плоскости земли). */
  dirX: 0.82,
  dirZ: 0.57,
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
        { name: "windDir", size: 2, type: "vec2" },
      ],
      vertex: `
        uniform float windTime;
        uniform float windStrength;
        uniform float windGust;
        uniform vec2 windDir;
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("windTime", this.time);
    uniformBuffer.updateFloat("windStrength", WIND.strength);
    uniformBuffer.updateFloat("windGust", WIND.gust);
    uniformBuffer.updateFloat2("windDir", WIND.dirX, WIND.dirZ);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `
        attribute float windPhase;
      `,
      /*
       * positionUpdated ещё в локальных осях пучка: y = 0 у земли.
       * windPhase — расстояние пучка вдоль ветра, поэтому соседние травинки
       * гнутся почти одинаково, а по полю бежит волна, а не рябь.
       * Гнём строго ПО ветру: пригибание, а не болтанка из стороны в сторону.
       */
      CUSTOM_VERTEX_UPDATE_POSITION: `
        float bend = max(positionUpdated.y, 0.0);
        float ph = windPhase - windTime;
        // Основная волна плюс вдвое более длинная — получаются порывы.
        float wave = sin(ph) * 0.5 + 0.5;
        float gust = sin(ph * 0.35 - 0.7) * 0.5 + 0.5;
        float lean = (wave + windGust * gust) * bend * windStrength;
        positionUpdated.x += windDir.x * lean;
        positionUpdated.z += windDir.y * lean;
      `,
    };
  }
}
