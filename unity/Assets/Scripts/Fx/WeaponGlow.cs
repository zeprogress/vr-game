using System.Text.RegularExpressions;
using UnityEngine;

namespace Zep
{
    /// Свечение заточенного оружия — как attachLegendaryGlow/applySharpGlow в items/weaponModels.ts:
    /// оболочка legGlow (уникальное — фиолетовое, рубиновое — алое, мастерское — оранжевое с переливом в золото),
    /// мягкий круг лицом к камере, пульсирует. Видна только при заточке; сила ∝ прибавке, размер ∝ √прибавки.
    public class WeaponGlow : MonoBehaviour
    {
        /// Точка отсчёта: +10 удачных точек заточки (SHARP_GLOW_REF_PCT).
        const float RefPct = 25.41f;
        /// С +20 до +25 точек свечение выцветает к белому (sharpWhiten в shared/items.ts):
        /// +20 точек — 42.75%, +25 — 49.23% прибавки (ATTACK_POINT: 3% × 0.9625^n).
        const float WhiteFrom = 42.75f, WhiteTo = 49.23f;
        static readonly Color Legendary = new(0.6f, 0.22f, 1f), Ruby = new(1f, 0.1f, 0.22f), Craft = new(1f, 0.38f, 0.02f);
        static readonly Color Shimmer = new(1f, 0.82f, 0.36f);
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
        bool shim;
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
                g.shim = tier == "craft";
                g.baseScale = r.transform.localScale.x;
                g.SetPct(0);
            }
        }

        /// Прибавка заточки, %: 0 — свечения нет.
        public void SetPct(float p)
        {
            if (Mathf.Approximately(p, pct)) return;
            pct = p;
            rend.enabled = p > 0;
            if (light) light.enabled = p > 0;
            // Радиус линейно от прибавки (как web radius=1): +5 мельче, +20 шире.
            if (p > 0) transform.localScale = Vector3.one * baseScale * (p / RefPct);
        }

        void LateUpdate()
        {
            if (pct <= 0) return;
            var cam = Camera.main;
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
            float t = Time.time;
            float p = 0.5f + 0.5f * Mathf.Sin(t * 3.1f + transform.position.x);
            // +20…+30 точек: сначала выцветаем к белому, и только потом (если осталось) играем переливом.
            float w = Mathf.Clamp01((pct - WhiteFrom) / (WhiteTo - WhiteFrom));
            var baseCol = w > 0 ? Color.Lerp(col, Color.white, w) : col;
            var c = shim && w < 1 ? Color.Lerp(baseCol, Shimmer, (0.5f + 0.5f * Mathf.Sin(t * 1.7f)) * (1f - w)) : baseCol;
            float k = (0.36f + p * 0.36f) * amp * (pct / RefPct);
            // HDR под bloom: ядро ярче единицы — ореол вокруг клинка; прозрачность по силе заточки.
            c = c * (1.6f + 1.4f * p);
            c.a = Mathf.Clamp01(k);
            if (light) light.intensity = 0.6f * k * (0.8f + 0.4f * p);
            mpb ??= new MaterialPropertyBlock();
            mpb.SetColor(BaseColor, c);
            rend.SetPropertyBlock(mpb);
        }
    }
}
