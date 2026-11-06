using System.Text.RegularExpressions;
using UnityEngine;

namespace Zep
{
    /// Свечение заточенного оружия — как attachLegendaryGlow/applySharpGlow в items/weaponModels.ts:
    /// оболочка legGlow (уникальное — фиолетовое, рубиновое — алое, мастерское — оранжевое с переливом в золото),
    /// мягкий круг лицом к камере, пульсирует. Видна только при заточке; сила ∝ прибавке, размер ∝ √прибавки.
    public class WeaponGlow : MonoBehaviour
    {
        // Те же цветовые диапазоны, что SHARP_GLOW_TIERS в shared/items.ts:
        // +1…5 — голубой, +6…9 — зелёный, +10…12 — золотой, +13…15 — алый.
        static readonly Color Blue = new(0.35f, 0.8f, 1f), Green = new(0.35f, 1f, 0.45f);
        static readonly Color Gold = new(1f, 0.72f, 0.15f), Red = new(1f, 0.2f, 0.18f);
        static readonly Color Legendary = new(0.6f, 0.22f, 1f), Ruby = new(1f, 0.1f, 0.22f), Craft = new(1f, 0.38f, 0.02f);
        /// Порог процента для уровней +1…+15 (attackPointBonus в shared/items.ts).
        static readonly float[] LevelPct = { 0f, 5f, 10f, 15f, 20f, 25f, 40f, 55f, 70f, 85f, 105f, 125f, 145f, 170f, 195f, 245f };
        static int LevelOfPct(float pct)
        {
            if (pct <= 0f) return 0;
            int best = 0; float diff = float.MaxValue;
            for (int i = 1; i <= 15; i++)
            {
                float d = Mathf.Abs(LevelPct[i] - pct);
                if (d < diff) { diff = d; best = i; }
            }
            return best;
        }
        static Color TierColor(int level) => level <= 5 ? Blue : level <= 9 ? Green : level <= 12 ? Gold : Red;
        static float Brightness(int level) => 0.45f + Mathf.Max(0, level - 1) / 14f * 1.9f;
        static float GlowSize(int level) => 0.45f + Mathf.Max(0, level - 1) / 14f * 0.9f;
        static Material mat;
        static Mesh quad;
        Light light;

        static Mesh Quad()
        {
            var m = new Mesh
            {
                vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) },
                triangles = new[] { 0, 2, 1, 0, 3, 2 },
            };
            m.RecalculateBounds();
            return m;
        }
        static readonly Regex SharpRx = new(@"Точка атаки \+([\d.]+)%");

        Renderer rend;
        MaterialPropertyBlock mpb;
        Color col;
        float amp, baseScale, pct = -1;
        int level;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        /// Прибавка заточки из строки роллов оружия (sharpPctOfText).
        public static float PctOf(string affix)
        {
            var m = affix != null ? SharpRx.Match(affix) : null;
            return m != null && m.Success && float.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 0f;
        }

        /// Оболочки свечения в модели оружия из Gear.glb: свой материал вместо плоского квадрата.
        public static void Attach(Transform weapon, string tier, Material unlitAdd)
        {
            if (!unlitAdd) return;
            if (!mat)
            {
                const int N = 64;
                var tex = new Texture2D(N, N, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
                for (int y = 0; y < N; y++)
                    for (int x = 0; x < N; x++)
                    {
                        float u = (x + 0.5f) / N * 2 - 1, v = (y + 0.5f) / N * 2 - 1;
                        float a = Mathf.Clamp01(1 - Mathf.Sqrt(u * u + v * v));
                        tex.SetPixel(x, y, new Color(1, 1, 1, a * a));
                    }
                tex.Apply();
                mat = new Material(unlitAdd) { name = "weaponGlow" };
                mat.SetTexture("_BaseMap", tex);
            }
            var col = tier == "ruby" ? Ruby : tier == "craft" ? Craft : Legendary;
            float amp = tier == "ruby" ? 1.4f : tier == "craft" ? 1.2f : 1f;
            quad ??= Quad();
            foreach (var src in weapon.GetComponentsInChildren<Renderer>(true))
            {
                if (!src.name.StartsWith("legGlow")) continue;
                // Плоскость из glTF не рисуется (вершины без нужных данных) — своя плоскость того же размера в той же точке.
                float size = Mathf.Max(src.localBounds.size.x, src.localBounds.size.y);
                src.enabled = false;
                var go = new GameObject("weaponGlow", typeof(MeshFilter), typeof(MeshRenderer));
                go.transform.SetParent(src.transform, false);
                go.transform.localPosition = src.localBounds.center;
                go.transform.localScale = Vector3.one * size;
                go.GetComponent<MeshFilter>().sharedMesh = quad;
                var r = go.GetComponent<MeshRenderer>();
                r.sharedMaterial = mat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
                var g = go.AddComponent<WeaponGlow>();
                g.rend = r;
                var l = go.AddComponent<Light>();
                l.type = LightType.Point;
                l.shadows = LightShadows.None;
                l.range = 2.2f;
                l.color = col;
                l.enabled = false;
                g.light = l;
                g.col = col;
                g.amp = amp;
                g.baseScale = r.transform.localScale.x;
                g.SetPct(0);
            }
        }

        /// Прибавка заточки, %: 0 — свечения нет.
        public void SetPct(float p)
        {
            if (Mathf.Approximately(p, pct)) return;
            pct = p;
            level = LevelOfPct(p);
            rend.enabled = level > 0;
            if (light) light.enabled = level > 0;
            if (level > 0) transform.localScale = Vector3.one * baseScale * GlowSize(level);
        }

        void LateUpdate()
        {
            if (pct <= 0) return;
            var cam = Camera.main;
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
            float t = Time.time;
            float p = 0.5f + 0.5f * Mathf.Sin(t * 3.1f + transform.position.x);
            float b = Brightness(level);
            // Цвет зависит от диапазона заточки, яркость плавно растёт от +1 к +15.
            var c = TierColor(level) * (0.75f + b * 0.75f) * (1f + 0.3f * p);
            c.a = Mathf.Clamp01(0.24f + b * 0.26f);
            if (light)
            {
                light.color = TierColor(level);
                light.intensity = 0.35f * b * (0.8f + 0.4f * p);
            }
            mpb ??= new MaterialPropertyBlock();
            mpb.SetColor(BaseColor, c);
            rend.SetPropertyBlock(mpb);
        }
    }
}
