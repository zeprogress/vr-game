using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Перекраска моделей как в вебе (world/models.ts, combat/Mob.ts). Материалы общие на сочетание
    /// «исходный материал × цвет» — как sharedMobMaterial, без копии на каждого моба.
    public static class Recolor
    {
        static readonly Dictionary<string, Material> cache = new();
        static readonly Color DefaultSkin = new(0.82f, 0.62f, 0.49f); // тёплый бежевый
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        static readonly int GltfBase = Shader.PropertyToID("baseColorFactor");

        static Color BaseOf(Material m) =>
            m.HasProperty(GltfBase) ? m.GetColor(GltfBase) : m.HasProperty(BaseColor) ? m.GetColor(BaseColor) : Color.white;

        static void SetBase(Material m, Color c)
        {
            if (m.HasProperty(GltfBase)) m.SetColor(GltfBase, c);
            if (m.HasProperty(BaseColor)) m.SetColor(BaseColor, c);
        }

        static Material Shared(string key, System.Func<Material> make)
        {
            if (!cache.TryGetValue(key, out var m) || !m) cache[key] = m = make();
            return m;
        }

        static void Each(GameObject go, System.Func<Material, Material> map)
        {
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++) if (mats[i]) mats[i] = map(mats[i]);
                r.sharedMaterials = mats;
            }
        }

        /// Моб без своей модели (слизень, плевун, Багровый, осколок — recolorRig): тело цвета вида,
        /// полупрозрачное одним слоем, «secondary» светлее, глаза тёмные.
        public static void Kind(GameObject go, SliceAssets.KindEntry k, Material litTemplate, Material litTransparent)
        {
            if (k == null || !litTemplate) return;
            var tint = new Color(k.tint[0], k.tint[1], k.tint[2]);
            Each(go, src => Shared($"kind|{k.kind}|{src.name}", () =>
            {
                var m = new Material(litTemplate) { name = $"{k.kind}_{src.name}" };
                if (src.name.ToLowerInvariant().Contains("eye"))
                {
                    m.SetColor(BaseColor, new Color(0.02f, 0.02f, 0.02f));
                    m.SetFloat("_Smoothness", 0.7f);
                    return m;
                }
                if (k.alpha < 1 && litTransparent) m = new Material(litTransparent) { name = m.name };
                float mul = src.name.ToLowerInvariant().Contains("secondary") ? 1.4f : 1f;
                var c = new Color(Mathf.Clamp01(tint.r * mul), Mathf.Clamp01(tint.g * mul), Mathf.Clamp01(tint.b * mul), k.alpha);
                m.SetColor(BaseColor, c);
                m.SetFloat("_Smoothness", 0.65f); // мокрый блеск слизи
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", new Color(tint.r * 0.2f, tint.g * 0.15f, tint.b * 0.23f));
                if (k.alpha < 1) MakeTransparent(m);
                return m;
            }));
        }

        /// Оттенок элитного моба (ELITE_MOBS.tint, recolorMonster): цвет умножается на текстуру, без текстуры — заменяет цвет.
        public static void Tint(GameObject go, float[] t)
        {
            if (t == null || t.Length < 3) return;
            var tint = new Color(t[0], t[1], t[2]);
            Each(go, src => Shared($"tint|{src.GetInstanceID()}|{tint}", () =>
            {
                var m = new Material(src) { name = src.name + "_tint" };
                var a = BaseOf(src).a;
                SetBase(m, new Color(tint.r, tint.g, tint.b, a));
                return m;
            }));
        }

        /// Герой (recolorCharacter): у пака почти чёрные «Skin»/«Face» — в тон кожи этого персонажа
        /// (явно окрашенная кожа, например зелёный гоблин) или в бежевый.
        public static void Character(GameObject go)
        {
            static bool IsSkin(Material m) => m.name.StartsWith("Skin", System.StringComparison.OrdinalIgnoreCase) || m.name.StartsWith("Face", System.StringComparison.OrdinalIgnoreCase);
            static float Lum(Color c) => c.r * 0.3f + c.g * 0.6f + c.b * 0.1f;
            static float Chroma(Color c) => Mathf.Max(c.r, Mathf.Max(c.g, c.b)) - Mathf.Min(c.r, Mathf.Min(c.g, c.b));

            var skinTone = DefaultSkin;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                foreach (var m in r.sharedMaterials)
                {
                    if (!m || !IsSkin(m)) continue;
                    var c = BaseOf(m); // glTFast кладёт цвет уже в гамме — как toGammaSpace в вебе
                    if (Lum(c) > 0.35f || Chroma(c) > 0.1f) { skinTone = c; goto found; }
                }
            found:
            Each(go, src =>
            {
                if (!IsSkin(src)) return src;
                var c = BaseOf(src);
                if (Chroma(c) >= 0.06f || Lum(c) >= 0.3f) return src;
                return Shared($"skin|{src.GetInstanceID()}|{skinTone}", () =>
                {
                    var m = new Material(src) { name = src.name + "_skin" };
                    SetBase(m, skinTone);
                    return m;
                });
            });
        }

        static void MakeTransparent(Material m)
        {
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 0);
            m.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        }
    }
}
