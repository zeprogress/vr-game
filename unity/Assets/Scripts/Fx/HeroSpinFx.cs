using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Эффекты ВОКРУГ ГЕРОЯ для умений, которые он делает телом: вихрь, клич, удар по кругу.
    ///
    /// Раньше такие умения рисовались кругом на земле с рунами — но герой-то кружится сам,
    /// и читаться должно «вокруг него», на уровне корпуса, а не «зона на полу». Кольца летят
    /// вокруг тела, вращаются в разные стороны и гаснут; за героем следуют.
    public class HeroSpinFx : MonoBehaviour
    {
        static HeroSpinFx inst;
        static HeroSpinFx I => inst ? inst : inst = new GameObject("HeroSpinFx").AddComponent<HeroSpinFx>();

        class Ring
        {
            public Transform tr;
            public Transform follow;
            public float born, life, radius, y, spin, alpha;
            public Material mat;
            public Color color;
        }

        readonly List<Ring> live = new();
        readonly List<Ring> pool = new();
        Mesh torus;
        Material template;

        void Awake() { inst = this; torus = Torus(); }

        /// Кольцо радиусом 1 в плоскости XZ, толщиной 0.06 — масштабируем по радиусу.
        static Mesh Torus()
        {
            const int seg = 48, sides = 6;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            const float tube = 0.035f;
            for (int i = 0; i <= seg; i++)
            {
                float a = i / (float)seg * Mathf.PI * 2f;
                var center = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                for (int j = 0; j <= sides; j++)
                {
                    float b = j / (float)sides * Mathf.PI * 2f;
                    verts.Add(center * (1f + Mathf.Cos(b) * tube) + Vector3.up * Mathf.Sin(b) * tube);
                }
            }
            for (int i = 0; i < seg; i++)
                for (int j = 0; j < sides; j++)
                {
                    int a0 = i * (sides + 1) + j, a1 = a0 + sides + 1;
                    tris.Add(a0); tris.Add(a1); tris.Add(a0 + 1);
                    tris.Add(a0 + 1); tris.Add(a1); tris.Add(a1 + 1);
                }
            var m = new Mesh { vertices = verts.ToArray(), triangles = tris.ToArray() };
            m.RecalculateNormals();
            return m;
        }

        Material Mat()
        {
            if (template) return template;
            var assets = ZoneNet.I ? ZoneNet.I.Assets : null;
            if (assets && assets.unlitAdd)
            {
                template = new Material(assets.unlitAdd) { name = "heroSpinRing" };
                return template;
            }
            // Запасной путь (редактор/снимки без сцены): тот же аддитивный URP Unlit.
            var sh = Shader.Find("Universal Render Pipeline/Unlit");
            if (!sh) return null;
            template = new Material(sh) { name = "heroSpinRing" };
            template.SetFloat("_Surface", 1);
            template.SetFloat("_Blend", 2);
            template.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            template.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.One);
            template.SetFloat("_ZWrite", 0);
            template.SetFloat("_Cull", 0);
            template.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            template.EnableKeyword("_BLENDMODE_ADD");
            template.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            return template;
        }

        Ring Take()
        {
            foreach (var r in pool) if (r.born + r.life < Time.time) return r;
            var self = I;
            var mt = self.Mat();
            if (!mt) return null;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder); // заготовка, меш заменим
            Object.Destroy(go.GetComponent<Collider>());
            go.GetComponent<MeshFilter>().sharedMesh = self.torus;
            var mr = go.GetComponent<MeshRenderer>();
            var m = new Material(mt) { name = "heroSpinRingInst" };
            mr.sharedMaterial = m;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var ring = new Ring { tr = go.transform, mat = m };
            pool.Add(ring);
            return ring;
        }

        /// Вихрь: три кольца вокруг корпуса, крутятся в разные стороны, слегка расходятся.
        public static void Spin(Transform follow, Vector3 fallback, float radius, float life, Color color)
        {
            var self = I;
            float[] heights = { 0.75f, 1.25f, 1.75f };
            float[] spins = { 7f, -9f, 11f };
            for (int i = 0; i < heights.Length; i++)
            {
                var r = self.Take();
                if (r == null) return;
                r.follow = follow;
                r.radius = radius * (0.8f + 0.12f * i);
                r.y = heights[i];
                r.spin = spins[i];
                r.born = Time.time;
                r.life = Mathf.Max(0.2f, life);
                r.color = color;
                r.alpha = 1f;
                r.tr.position = follow ? follow.position : fallback;
                r.tr.gameObject.SetActive(true);
            }
        }

        /// Клич/удар по кругу: одно кольцо разлетается от корпуса наружу.
        public static void Wave(Transform follow, Vector3 fallback, float radius, float life, Color color)
        {
            var r = I.Take();
            if (r == null) return;
            r.follow = follow;
            r.radius = Mathf.Max(0.6f, radius);
            r.y = 1.1f;
            r.spin = 1.5f;
            r.born = Time.time;
            r.life = Mathf.Max(0.2f, life);
            r.color = color;
            r.alpha = 1f;
            r.tr.position = follow ? follow.position : fallback;
            r.tr.gameObject.SetActive(true);
        }

        void LateUpdate()
        {
            float t = Time.time;
            foreach (var r in live)
            {
                // живые — те, что в пуле и активны; ниже общий проход по пулу
            }
            foreach (var r in pool)
            {
                if (!r.tr || !r.tr.gameObject.activeSelf) continue;
                float u = Mathf.Clamp01((t - r.born) / Mathf.Max(0.05f, r.life));
                if (u >= 1f) { r.tr.gameObject.SetActive(false); continue; }
                if (r.follow) r.tr.position = r.follow.position + Vector3.up * r.y;
                else r.tr.position += Vector3.up * (r.y - r.tr.position.y) * Time.deltaTime * 12f;
                float k = 1f + 0.18f * u; // слегка расходится
                r.tr.localScale = new Vector3(r.radius * k, 1f, r.radius * k);
                r.tr.Rotate(Vector3.up, r.spin * 12f * Time.deltaTime, Space.World);
                var c = r.color * (1.8f * (1f - u));
                c.a = 1f;
                r.mat.SetColor("_BaseColor", c);
            }
        }
    }
}
