using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Ссылки на импортированные модели — заполняет Editor/SliceSetup по Assets/Terrain/models.json
    /// (MODELS из client/world/models.ts, ELITE_MOBS и SKIN_MODELS из shared).
    [CreateAssetMenu(menuName = "Zep/Slice Assets")]
    public class SliceAssets : ScriptableObject
    {
        [Serializable]
        public class ModelEntry
        {
            public string key;
            public GameObject prefab;
            /// Высота модели в файле (по мешам) — для подгонки под рост моба, как nativeHeight в вебе.
            public float height = 1;
        }

        [Serializable]
        public class EliteEntry
        {
            public string model;
            public float drop;
            public string attackClip;
            public bool noSquash;
            public float scaleMul = 1;
            public float[] tint;
        }

        /// Цвет вида для мобов без своей модели (SLIME_CFG и т.п. в shared/mobs.ts).
        [Serializable]
        public class KindEntry
        {
            public string kind;
            public string name;
            public float[] tint;
            public float alpha = 1;
        }

        public KindEntry[] kinds;
        /// Шаблон URP Lit для перекраски: Shader.Find в сборке не находит шейдер, на который нет ссылок.
        public Material litTemplate;
        /// Тот же Lit, но прозрачный и со свечением — чтобы эти варианты шейдера попали в сборку.
        public Material litTransparent;
        /// Неосвещённые прозрачный и аддитивный — эффекты умений, снаряды, следы.
        public Material unlitAlpha, unlitAdd;
        /// spectator.json — константы эффектов умений (EffectsRouter) и режиссёра.
        public TextAsset spectatorJson;

        public KindEntry Kind(string kind)
        {
            foreach (var k in kinds ?? new KindEntry[0]) if (k.kind == kind) return k;
            foreach (var k in kinds ?? new KindEntry[0]) if (k.kind == "slime") return k;
            return null;
        }

        public GameObject hero;
        public GameObject slime;
        public GameObject[] trees;
        public TextAsset treesJson;
        public ModelEntry[] models;
        public EliteEntry[] elites;
        /// skin 1..N → ключ модели (shared/skins.ts); skin 0 — обычный рыцарь.
        public string[] skins;
        public float bodyRadius = 0.55f;
        /// Оружие в руках из Gear.glb: узлы gear_<класс>_<тир> под кулаками рыцаря (src/client/dev/unityExport.ts).
        public GameObject[] gear;
        Dictionary<string, GameObject> gearByName;

        public GameObject Gear(string cls, string tier)
        {
            if (gearByName == null)
            {
                gearByName = new Dictionary<string, GameObject>();
                foreach (var g in gear ?? new GameObject[0]) if (g) gearByName[g.name] = g;
            }
            return gearByName.TryGetValue($"gear_{cls}_{tier}", out var x) ? x
                : gearByName.TryGetValue($"gear_{cls}_base", out x) ? x : null;
        }

        /// Клипы классов (копьё, молот, кинжалы, лук) — собраны в вебе IK (world/classPoses.ts), Assets/Locations/ClassClips.glb.
        public AnimationClip[] classClips;
        /// По уровню (индекс = уровень − 1): темп замаха героя (meleeAnimRate) и опыт до следующего уровня (−1 — максимум).
        public float[] meleeRate;
        public double[] xpNext;

        public float MeleeRate(int level) => meleeRate != null && meleeRate.Length > 0 ? meleeRate[Mathf.Clamp(level - 1, 0, meleeRate.Length - 1)] : 1.5f;

        /// Доля полоски опыта (−1 — на максимальном уровне полоски нет).
        public float XpFrac(int level, double xp)
        {
            if (xpNext == null || level < 1 || level > xpNext.Length) return -1;
            double need = xpNext[level - 1];
            return need <= 0 ? -1 : Mathf.Clamp01((float)(xp / need));
        }

        /// Локации, выгруженные из веб-клиента (scripts/unity-export-locations), — ставятся в мир как есть.
        public GameObject[] locations;
        /// Пугало и манекен (Editor/PropsBuilder: как Mob.buildScarecrow и combat/Dummy.ts).
        public GameObject scarecrow, dummy;
        /// props.json — NPC лагеря и мелочь подземелья.
        public TextAsset propsJson;

        /// Свеча или факел катакомб: центр язычка пламени и его высота (по ней сила и дальность света).
        [Serializable]
        public struct FlameLight
        {
            public Vector3 p;
            public float size;
            public bool vent;
            /// Свеча (найдена по форме цилиндрика) — огонёк стоит на верхушке.
            public bool candle;
            /// Сколько язычков пламени в группе (свечи люстры — один источник).
            public int count;
        }

        public FlameLight[] catFlames;
        /// Каждый язычок пламени катакомб по отдельности — для живого пламени.
        public FlameLight[] catFlameSpots;

        Dictionary<string, ModelEntry> byKey;
        Dictionary<string, EliteEntry> eliteByModel;

        public ModelEntry Model(string key)
        {
            if (byKey == null)
            {
                byKey = new Dictionary<string, ModelEntry>();
                foreach (var m in models) if (m.prefab) byKey[m.key] = m;
            }
            return key != null && byKey.TryGetValue(key, out var e) ? e : null;
        }

        public EliteEntry Elite(string model)
        {
            if (eliteByModel == null)
            {
                eliteByModel = new Dictionary<string, EliteEntry>();
                foreach (var e in elites) if (!string.IsNullOrEmpty(e.model)) eliteByModel[e.model] = e;
            }
            return model != null && eliteByModel.TryGetValue(model, out var x) ? x : null;
        }

        public GameObject Skin(int skin)
        {
            var key = skin >= 1 && skin <= skins.Length ? skins[skin - 1] : "charKnight";
            return Model(key)?.prefab ?? hero;
        }
    }
}
