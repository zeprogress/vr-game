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
        static readonly Color Legendary = new(0.6f, 0.22f, 1f), Ruby = new(1f, 0.1f, 0.22f), Craft = new(1f, 0.38f, 0.02f);
        static readonly Color Shimmer = new(1f, 0.82f, 0.36f);
        static Material mat;
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
            foreach (var r in weapon.GetComponentsInChildren<Renderer>(true))
            {
                if (!r.name.StartsWith("legGlow")) continue;
                r.sharedMaterial = mat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                var g = r.gameObject.AddComponent<WeaponGlow>();
                g.rend = r;
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
            if (p > 0) transform.localScale = Vector3.one * baseScale * Mathf.Sqrt(p / RefPct);
        }

        void LateUpdate()
        {
            if (pct <= 0) return;
            var cam = Camera.main;
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
            float t = Time.time;
            float p = 0.5f + 0.5f * Mathf.Sin(t * 3.1f + transform.position.x);
            var c = shim ? Color.Lerp(col, Shimmer, 0.5f + 0.5f * Mathf.Sin(t * 1.7f)) : col;
            c.a = Mathf.Clamp01((0.36f + p * 0.36f) * amp * (pct / RefPct));
            mpb ??= new MaterialPropertyBlock();
            mpb.SetColor(BaseColor, c);
            rend.SetPropertyBlock(mpb);
        }
    }
}
