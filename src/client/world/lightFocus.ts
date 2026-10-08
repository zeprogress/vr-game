import { lightOn } from "../engine/webgpu";
import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Light } from "@babylonjs/core/Lights/light";

/**
 * Какие огни достаются шейдерам земли/травы/деревьев. У материала лимит
 * maxSimultaneousLights, и Babylon берёт ПЕРВЫЕ включённые огни в порядке
 * scene.lights (порядок создания) — без учёта расстояния. Большая земля — один
 * меш, поэтому свет «гулял» по карте: огни светлячков/лагеря, созданные раньше,
 * забирали лимит, а факелы героев в кадре не попадали в шейдер.
 *
 * Раз в ~0.5 с сортируем точечные огни по близости к точке, куда смотрит
 * камера (renderPriority), солнце/небо — всегда первыми. Меши пересобирают
 * список огней только когда меняется набор ближайших; число огней в шейдере
 * то же — перекомпиляции нет, меняются лишь униформы.
 */
export class LightFocus {
  private t = 0;
  private sig = "";

  constructor(
    private readonly scene: Scene,
    /** Сколько ближайших огней следим (с запасом к лимиту материалов). */
    private readonly topN = 8,
  ) {}

  update(dt: number, focus: Vector3): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const pts: { l: Light; d: number }[] = [];
    for (const l of this.scene.lights) {
      if (l.getClassName() !== "PointLight") {
        setPrio(l, 1000); // солнце/небо — всегда первыми
        continue;
      }
      if (!lightOn(l)) {
        setPrio(l, 0);
        continue;
      }
      const p = (l as unknown as { position: Vector3 }).position;
      pts.push({ l, d: (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2 });
    }
    pts.sort((a, b) => a.d - b.d);
    pts.forEach((e, i) => setPrio(e.l, Math.max(1, 500 - i)));
    const sig = pts
      .slice(0, this.topN)
      .map((e) => e.l.uniqueId)
      .join(",");
    this.scene.requireLightSorting = true;
    this.scene.sortLightsByPriority();
    if (sig === this.sig) return;
    this.sig = sig;
    for (const m of this.scene.meshes) {
      if (!m.material || !m.isEnabled()) continue;
      (m as unknown as { _resyncLightSources(): void })._resyncLightSources();
    }
  }
}

function setPrio(l: Light, v: number): void {
  // Напрямую в поле: сеттер renderPriority на каждый огонь пересортировывал бы сцену целиком.
  (l as unknown as { _renderPriority: number })._renderPriority = v;
}
