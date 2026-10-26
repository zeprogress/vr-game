using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Живое пламя: язык огня основанием в точке, всегда лицом к камере, колышется по высоте и ширине и мерцает.
    /// Костёр лагеря (HubCampfire), свечи и факелы катакомб, жаровни подземелья. Группы включаются по месту камеры.
    public class Flames : MonoBehaviour
    {
        static Flames inst;
        static Flames I => inst ? inst : inst = new GameObject("Flames").AddComponent<Flames>();

        class Group { public GameObject root; public readonly List<(Transform t, float w, float h, float seed)> items = new(); }

        readonly Dictionary<string, Group> groups = new();
        Mesh quad;
        Material mat;
        MaterialPropertyBlock mpb;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        void Awake()
        {
            inst = this;
            mpb = new MaterialPropertyBlock();
            // Плоскость основанием в нуле: растёт вверх.
            quad = new Mesh
            {
                vertices = new[] { new Vector3(-0.5f, 0, 0), new Vector3(0.5f, 0, 0), new Vector3(0.5f, 1, 0), new Vector3(-0.5f, 1, 0) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) },
                triangles = new[] { 0, 2, 1, 0, 3, 2 },
            };
            quad.RecalculateBounds();
        }

        Material Mat(SliceAssets assets)
        {
            if (mat) return mat;
            // Язык огня: белое ядро внизу → жёлтый → оранжевый, к верху сужается и тает.
            const int W = 32, H = 64;
            var tex = new Texture2D(W, H, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    float u = (x + 0.5f) / W * 2 - 1, v = (y + 0.5f) / H;
                    float width = Mathf.Lerp(0.9f, 0.04f, Mathf.Pow(v, 0.75f));
                    float a = Mathf.Clamp01(1 - Mathf.Abs(u) / width) * Mathf.Clamp01((1 - v) * 1.4f) * Mathf.Clamp01(v * 8);
                    var c = Color.Lerp(new Color(1f, 0.95f, 0.75f), new Color(1f, 0.45f, 0.1f), Mathf.Clamp01(v * 1.3f + Mathf.Abs(u) * 0.5f));
                    c.a = Mathf.Sqrt(a); // плотный язык, мягкий только край
                    tex.SetPixel(x, y, c);
                }
            tex.Apply();
            mat = new Material(assets.unlitAdd) { name = "flame" };
            mat.SetTexture("_BaseMap", tex);
            mat.SetColor("_BaseColor", new Color(1.6f, 1.45f, 1.3f, 1f)); // ярче единицы — огонь «горит», ловит свечение bloom
            return mat;
        }

        /// Язык пламени в точке (основание), ширина и высота в метрах; group — для включения по месту камеры.
        public static void Add(string group, Vector3 at, float width, float height, SliceAssets assets)
        {
            if (!assets || !assets.unlitAdd) return;
            var self = I;
            if (!self.groups.TryGetValue(group, out var g))
            {
                g = new Group { root = new GameObject("flames_" + group) };
                g.root.transform.SetParent(self.transform, false);
                self.groups[group] = g;
            }
            var go = new GameObject("flame", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(g.root.transform, false);
            go.transform.position = at;
            go.GetComponent<MeshFilter>().sharedMesh = self.quad;
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = self.Mat(assets);
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            g.items.Add((go.transform, width, height, Random.value * 100f));
        }

        public static void SetActive(string group, bool on)
        {
            if (inst && inst.groups.TryGetValue(group, out var g) && g.root.activeSelf != on) g.root.SetActive(on);
        }

        public static bool Has(string group) => inst && inst.groups.ContainsKey(group);

        void LateUpdate()
        {
            var cam = Camera.main;
            if (!cam) return;
            var cp = cam.transform.position;
            float t = Time.time;
            foreach (var g in groups.Values)
            {
                if (!g.root.activeSelf) continue;
                foreach (var (tr, w, h, seed) in g.items)
                {
                    var d = tr.position - cp;
                    if (d.sqrMagnitude > 90f * 90f) continue; // далеко — не трогаем
                    d.y = 0;
                    if (d.sqrMagnitude > 1e-4f) tr.rotation = Quaternion.LookRotation(d);
                    float fh = 1f + 0.12f * Mathf.Sin(t * 9f + seed) + 0.06f * Mathf.Sin(t * 23f + seed * 2f);
                    float fw = 1f + 0.08f * Mathf.Sin(t * 7f + seed * 3f);
                    tr.localScale = new Vector3(w * fw, h * fh, 1f);
                }
            }
        }
    }
}
