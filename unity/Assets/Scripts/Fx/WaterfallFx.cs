using UnityEngine;

namespace Zep
{
    /// Водопады подземелья: струя течёт вниз (текстура свечения и основы сдвигается), у подножья брызги пены.
    /// Меши — dunFall* (струя), dunFallEdge* (кромка), dunFoam* (пена у низа) из dungeon.glb.
    public class WaterfallFx : MonoBehaviour
    {
        static readonly int EmissionMap = Shader.PropertyToID("_EmissionMap"), BaseMap = Shader.PropertyToID("_BaseMap");
        float foamT;

        /// Вешается на корень подземелья при сборке.
        public static void Attach(GameObject dungeon)
        {
            if (!dungeon) return;
            dungeon.AddComponent<WaterfallFx>();
        }

        void Update()
        {
            float t = Time.time;
            // Струя: текстура ползёт вниз. Сдвиг по V — один на всю струю, без рывков.
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (!r.name.StartsWith("dunFall") || r.name.StartsWith("dunFoam")) continue;
                var m = r.sharedMaterial;
                if (!m) continue;
                float v = -t * 0.9f;
                if (m.HasProperty(EmissionMap)) m.SetTextureOffset(EmissionMap, new Vector2(0, v));
                if (m.HasProperty(BaseMap)) m.SetTextureOffset(BaseMap, new Vector2(0, v * 0.6f));
            }
            // Пена у подножья: брызги вверх и в стороны, пачками.
            foamT -= Time.deltaTime;
            if (foamT > 0) return;
            foamT = 0.12f;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (!r.name.StartsWith("dunFoam")) continue;
                var b = r.bounds;
                var p = new Vector3(Random.Range(b.min.x, b.max.x), b.max.y, Random.Range(b.min.z, b.max.z));
                Vfx.I?.Burst(p, new Color(0.75f, 0.9f, 1f), count: 3, speed: 2.2f, life: 0.9f, grav: 6, size: 0.35f, dir: Vector3.up, spread: 0.6f);
                Vfx.I?.Burst(p, new Color(0.9f, 0.97f, 1f), count: 1, speed: 0.6f, life: 1.4f, grav: -0.8f, size: 1.2f, smoke: true);
            }
        }
    }
}
