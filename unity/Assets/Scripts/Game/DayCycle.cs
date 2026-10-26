using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Свет как в вебе. Поверхность — dayState(hour) из world/DayTime.ts (таблица light.json по часам):
    /// солнце, линейный туман, небо, заливка; ночью — костёр лагеря (HubCampfire). Подземелье — DungeonFx:
    /// солнце гаснет, холодная заливка, синий туман 8–150 м, огни у ближайших жаровен и кристаллов.
    /// Катакомбы — без солнца и неба, только факелы и люстры залов (выгружены из веба).
    public class DayCycle : MonoBehaviour
    {
        public Light sun;
        public TextAsset lightJson, catLightsJson;
        public SliceAssets assets;
        /// Часы, пока нет сервера (и для снимков из редактора).
        public float fallbackHour = 12f;
        /// Принудительный час (демо света); NaN — как обычно, с сервера.
        [NonSerialized] public float overrideHour = float.NaN;

        [Serializable] public class DayRow
        {
            public float[] sunDir, sun, zenith, horizon, fog, disc;
            public float sunI, fogNear, fogFar, daylight;
        }
        [Serializable] public class DunLight { public float[] p, color; public float range, power, flame; }
        [Serializable] class LightData { public DayRow[] day; public DunLight[] dun; }
        [Serializable] public class CatLight { public string name; public float[] p, color; public float range, intensity; }
        [Serializable] class CatData { public CatLight[] lights; }

        // Подземелье: корень DungeonFx стоит в (DUN_X, DUN_Y0, DUN_Z), огни — в его координатах.
        static readonly Vector3 DunOrigin = new(-440f, -500f, 0f);
        static readonly Color DunAmbient = new Color(0.42f, 0.52f, 0.78f) * 0.95f;
        static readonly Color DunFog = new(0.025f, 0.045f, 0.085f);
        static readonly Vector3 HubFire = new(-55f, 0f, -55f);

        /// Сила света Unity на единицу силы Babylon (подобрано по эталонным кадрам веба).
        public float sunScale = 1.15f;
        /// Точечные огни: в Babylon сила падает к краю дальности линейно (1 − d/R), в URP — как 1/d².
        /// Чтобы на половине дальности света было столько же, сила URP = сила веба × (R/2)² × pointMatch.
        public float pointMatch = 0.5f;

        float PointI(float webI, float range) => webI * range * range * 0.25f * pointMatch;
        /// Заливка неба на поверхности: в вебе её почти нет, объём держат солнце и подсветка материалов.
        public float skyFill = 0.38f, nightFill = 0.18f;

        DayRow[] day;
        DunLight[] dun;
        CatLight[] cat;
        float shownHour = float.NaN;
        string region = "";
        Light campfire;
        readonly List<Light> catLights = new();
        /// Каждый огонь — настоящий источник (Forward+ держит сотни): все жаровни и кристаллы подземелья,
        /// каждая свеча и факел катакомб. Тёплые мерцают.
        readonly List<(Light l, float full)> dunAll = new();
        readonly List<(Light l, float full)> catFlameLights = new();
        float time;

        void Awake() => Load();

        void Load()
        {
            if (day != null) return;
            var d = JsonUtility.FromJson<LightData>(lightJson.text);
            day = d.day;
            dun = d.dun;
            cat = catLightsJson ? JsonUtility.FromJson<CatData>(catLightsJson.text).lights : new CatLight[0];
        }

        static Color C(float[] a, float k = 1f) => new(a[0] * k, a[1] * k, a[2] * k);

        /// Строка таблицы на час (линейно между соседними с шагом 0.1 ч).
        DayRow Row(float hour, out DayRow b, out float t)
        {
            float h = ((hour % 24f) + 24f) % 24f * 10f;
            int i = Mathf.FloorToInt(h);
            t = h - i;
            b = day[Mathf.Min(i + 1, day.Length - 1)];
            return day[Mathf.Clamp(i, 0, day.Length - 1)];
        }

        static Color L(float[] a, float[] b, float t, float k = 1f) => Color.Lerp(C(a), C(b), t) * k;

        void Update()
        {
            time += Time.deltaTime;
            var room = ZoneNet.I ? ZoneNet.I.Room : null;
            float target = !float.IsNaN(overrideHour) ? overrideHour : room != null ? room.State.hour : fallbackHour;
            if (!float.IsNaN(overrideHour)) shownHour = overrideHour;
            // Часы идут сами, сервер лишь сверяет — сглаживаем, чтобы свет не прыгал (как shown в Zone.ts).
            if (float.IsNaN(shownHour) || Mathf.Abs(Mathf.DeltaAngle(shownHour * 15f, target * 15f)) > 30f) shownHour = target;
            else shownHour = Mathf.LerpAngle(shownHour * 15f, target * 15f, 1f - Mathf.Exp(-Time.deltaTime * 2f)) / 15f;
            var cam = Camera.main;
            Apply(shownHour, cam ? cam.transform.position : Vector3.zero);
        }

        /// Применить свет на час и место камеры. Вызывается и из редактора (снимки).
        public void Apply(float hour, Vector3 camPos)
        {
            Load();
            string r = camPos.z > 240 && Mathf.Abs(camPos.x) < 100 ? "cat"
                : Mathf.Abs(camPos.x - DunOrigin.x) < 220 && Mathf.Abs(camPos.z - DunOrigin.z) < 220 ? "dun" : "world";
            if (r != region) { region = r; OnRegion(); }
            if (r == "dun") { Underground(DunAmbient, DunFog, 8f, 150f); SetAmbient(DunAmbient * 1.1f, DunAmbient * 0.8f, new Color(0.02f, 0.025f, 0.04f)); CaveFill(true); Flicker(dunAll); ShadowNearest(dunAll, 6); return; }
            CaveFill(false);
            // Катакомбы: в вебе пол ровно-оранжевый от факелов (линейное затухание Babylon) — даём тёплую
            // заливку, а факелам — пятна у стен.
            // Заливка ослаблена и почти нейтральна (была 0.22, 0.11, 0.05 — пол целиком оранжевый); тепло дают огни.
            if (r == "cat") { Underground(new Color(0.095f, 0.09f, 0.085f), Color.black, 30f, 140f); Flicker(catFlameLights); return; }

            var a = Row(hour, out var b, out float t);
            var dir = Vector3.Lerp(new Vector3(a.sunDir[0], a.sunDir[1], a.sunDir[2]), new Vector3(b.sunDir[0], b.sunDir[1], b.sunDir[2]), t);
            float daylight = Mathf.Lerp(a.daylight, b.daylight, t);
            float night = 1f - daylight;
            if (sun)
            {
                sun.enabled = true;
                if (dir.sqrMagnitude > 1e-6f) sun.transform.rotation = Quaternion.LookRotation(dir.normalized);
                // Днём солнце белее веба: тёплый тон (1, 0.82, 0.48) в URP с Neutral-тонмаппингом читался жёлтым.
                // Чем выше солнце, тем ближе к тёпло-белому; у горизонта цвет из таблицы.
                float high = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.25f, 0.85f, -dir.normalized.y));
                sun.color = Color.Lerp(L(a.sun, b.sun, t), new Color(1f, 0.96f, 0.9f), 0.75f * high);
                sun.intensity = Mathf.Lerp(a.sunI, b.sunI, t) * sunScale;
                sun.shadowStrength = Mathf.Lerp(0.35f, 0.85f, daylight);
            }
            RenderSettings.sun = sun;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = Mathf.Lerp(a.fogNear, b.fogNear, t);
            RenderSettings.fogEndDistance = Mathf.Lerp(a.fogFar, b.fogFar, t);
            RenderSettings.fogColor = L(a.fog, b.fog, t);
            // Небо: зенит и горизонт веба; ночью — гаснет почти в ноль.
            var zen = L(a.zenith, b.zenith, t);
            var hor = L(a.horizon, b.horizon, t);
            var sky = RenderSettings.skybox;
            if (sky)
            {
                sky.SetColor("_Zenith", zen);
                sky.SetColor("_Horizon", hor);
                sky.SetColor("_Ground", RenderSettings.fogColor);
                sky.SetVector("_SunDir", -dir.normalized);
                sky.SetColor("_SunColor", L(a.disc, b.disc, t) * Mathf.Lerp(0.25f, 1f, daylight));
                sky.SetFloat("_Exposure", 1f);
                // Сколько тумана на куполе неба: купол веба — на ~400 м, туман там уже почти сплошной.
                sky.SetColor("_Fog", RenderSettings.fogColor);
                sky.SetFloat("_FogMix", Mathf.Clamp01(Mathf.InverseLerp(RenderSettings.fogStartDistance, RenderSettings.fogEndDistance, 400f)) * 0.85f);
            }
            // Отражения неба в материалах: днём слабые, ночью почти нет (в вебе всё матовое).
            RenderSettings.reflectionIntensity = Mathf.Lerp(0.03f, 0.35f, daylight);
            // Заливка — трёхцветная от неба (днём слабая, ночью лунно-синяя).
            float k = Mathf.Lerp(nightFill * 0.25f, skyFill, daylight);
            SetAmbient(
                Color.Lerp(new Color(0.38f, 0.45f, 0.66f) * 0.4f, zen, daylight) * k,
                Color.Lerp(new Color(0.2f, 0.24f, 0.36f) * 0.4f, hor, daylight) * k,
                Color.Lerp(Color.black, new Color(0.35f, 0.3f, 0.22f), daylight) * k * 0.6f);
            // Костёр лагеря — только ночью, мерцает.
            if (!campfire) campfire = MakePoint("hubCampfire", new Color(1f, 0.54f, 0.2f), 15f);
            var ground = Terrain.activeTerrain ? Terrain.activeTerrain.SampleHeight(HubFire) + Terrain.activeTerrain.transform.position.y : 0f;
            campfire.transform.position = HubFire + Vector3.up * (ground + 1.2f);
            float flick = 0.9f + 0.07f * Mathf.Sin(time * 13f) + 0.03f * Mathf.Sin(time * 31f);
            campfire.intensity = PointI(2.1f, 15f) * night * flick;
            campfire.enabled = night > 0.01f;
        }

        void Underground(Color ambient, Color fog, float near, float far)
        {
            if (sun) sun.enabled = false;
            SetAmbient(ambient, ambient, ambient * 0.05f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = near;
            RenderSettings.fogEndDistance = far;
            RenderSettings.fogColor = fog;
            if (RenderSettings.skybox) RenderSettings.skybox.SetFloat("_Exposure", 0f);
            RenderSettings.reflectionIntensity = 0f; // под землёй неба нет — и отражать нечего
            if (campfire) campfire.enabled = false;
        }

        /// Заливка: шейдеры читают её из ambientProbe, а смена RenderSettings.ambient* из кода пробу не обновляет
        /// (подземелье без огней было чёрным). Строим пробу сами: небо сверху, горизонт по кругу, земля снизу.
        static void SetAmbient(Color sky, Color equator, Color ground)
        {
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Custom;
            var sh = new UnityEngine.Rendering.SphericalHarmonicsL2();
            sh.AddAmbientLight(equator);
            sh.AddDirectionalLight(Vector3.up, (sky - equator) * 0.5f, 1f);
            sh.AddDirectionalLight(Vector3.down, (ground - equator) * 0.5f, 1f);
            RenderSettings.ambientProbe = sh;
            RenderSettings.ambientSkyColor = sky;
            RenderSettings.ambientEquatorColor = equator;
            RenderSettings.ambientGroundColor = ground;
        }

        Light MakePoint(string name, Color c, float range)
        {
            var l = new GameObject(name).AddComponent<Light>();
            l.transform.SetParent(transform, false);
            l.type = LightType.Point;
            l.color = c;
            l.range = range;
            l.shadows = LightShadows.None;
            return l;
        }

        /// Вход/выход из подземелья и катакомб: свои огни включаем только там, где камера.
        void OnRegion()
        {
            bool inDun = region == "dun", inCat = region == "cat";
            if (inCat && catLights.Count == 0)
                foreach (var c in cat)
                {
                    // catTorchN_ — заполняющие огни зала веба (дальность 26 м, густо-оранжевые): в URP они красили
                    // рыжим весь зал, стены и модели. Короче и слабее — свет дают сами факелы и свечи (catFlames).
                    bool fill = !c.name.Contains("_ch") && c.range > 20;
                    float range = fill ? 11f : c.range;
                    var l = MakePoint(c.name, fill ? new Color(1f, 0.62f, 0.34f) : C(c.color), range);
                    l.transform.position = new Vector3(c.p[0], c.p[1], c.p[2]);
                    l.intensity = PointI(c.intensity, range) * (fill ? 0.55f : 0.9f);
                    catLights.Add(l);
                }
            foreach (var l in catLights) l.enabled = inCat;
            if (inCat && catFlameLights.Count == 0 && assets && assets.catFlames != null)
                foreach (var f in assets.catFlames)
                {
                    // Свеча — маленькое тёплое пятно; факел и огонь в нише — больше и сильнее.
                    bool big = f.vent || !f.candle && f.size > 0.25f;
                    float range = f.vent ? 8f : big ? 9f : 4f, webI = big ? 1.3f : 0.8f;
                    var l = MakePoint("catFlame", big ? new Color(1f, 0.6f, 0.3f) : new Color(1f, 0.74f, 0.45f), range);
                    l.transform.position = f.p + Vector3.up * 0.1f;
                    // Группа свечей — сильнее и дальше, но не линейно (как несколько свечей рядом).
                    float k = Mathf.Sqrt(Mathf.Max(1, f.count));
                    l.range = range * Mathf.Min(2f, 0.8f + 0.2f * k);
                    float full = PointI(webI * k, l.range) * 1.15f;
                    l.intensity = full;
                    catFlameLights.Add((l, full));
                }
            foreach (var (l, _) in catFlameLights) l.enabled = inCat;
            if (inDun && dunAll.Count == 0)
            {
                foreach (var d in dun)
                {
                    bool warm = d.color[0] > d.color[2];
                    var l = MakePoint("dunLight", C(d.color), d.range);
                    l.transform.position = DunOrigin + new Vector3(d.p[0], d.p[1], d.p[2]);
                    float full = PointI(warm ? 2.2f : 1.6f, d.range) * d.power;
                    l.intensity = full;
                    dunAll.Add((l, warm ? full : -full)); // минус — кристалл, ровный свет
                }
                BuildFlames();
            }
            foreach (var (l, _) in dunAll) l.enabled = inDun;
            Flames.SetActive("dun", inDun);
            // Свечи и факелы катакомб — пламя у каждого язычка.
            if (inCat && !Flames.Has("cat") && assets && assets.catFlameSpots != null)
                foreach (var f in assets.catFlameSpots)
                {
                    // Свеча — огонёк на верхушке; огни веба (в нишах, у факелов) — точка центра, пламя вокруг неё.
                    float h = f.candle ? 0.28f : 0.6f;
                    Flames.Add("cat", f.candle ? f.p : f.p - Vector3.up * h * 0.35f, h * 0.5f, h, assets);
                }
            Flames.SetActive("cat", inCat);
            // Костёр лагеря горит всегда (свет от него — только ночью): три языка, как скрещённые плоскости веба.
            if (region == "world" && !Flames.Has("hub") && assets && Terrain.activeTerrain)
            {
                var b = HubFire + Vector3.up * (Terrain.activeTerrain.SampleHeight(HubFire) + Terrain.activeTerrain.transform.position.y);
                Flames.Add("hub", b, 2.0f, 1.8f, assets);
                Flames.Add("hub", b + new Vector3(0.15f, 0, 0.1f), 1.5f, 1.4f, assets);
                Flames.Add("hub", b + new Vector3(-0.15f, 0, -0.1f), 1.2f, 1.1f, assets);
            }
            Flames.SetActive("hub", region == "world");
        }

        /// Пламя жаровен (у кристаллов пламени нет): основание чуть ниже источника света — в чаше.
        void BuildFlames()
        {
            foreach (var s in dun)
                if (s.flame > 0)
                    Flames.Add("dun", DunOrigin + new Vector3(s.p[0], s.p[1] - 0.55f * s.flame, s.p[2]), 0.6f * s.flame, 1.1f * s.flame, assets);
        }

        /// Мерцание огня (как flick в вебе); кристаллы (отрицательная сила в списке) светят ровно.
        float shadowPick;
        Light caveFill;

        /// Холодный свет самой пещеры (HemisphericLight 0.42/0.52/0.78 в вебе светит сверху, а не ровно со всех
        /// сторон): направленный заполняющий свет почти отвесно, без теней — свод его не перекрывает.
        void CaveFill(bool on)
        {
            if (!on) { if (caveFill) caveFill.enabled = false; return; }
            if (!caveFill)
            {
                caveFill = new GameObject("caveFill").AddComponent<Light>();
                caveFill.transform.SetParent(transform, false);
                caveFill.type = LightType.Directional;
                caveFill.shadows = LightShadows.None;
                caveFill.color = new Color(0.42f, 0.55f, 0.85f);
                caveFill.transform.rotation = Quaternion.Euler(72, 35, 0);
            }
            caveFill.enabled = true;
            caveFill.intensity = 0.7f;
        }

        /// Тени от точечных огней дороги (6 граней на огонь) — отбрасывают только ближайшие к камере n.
        void ShadowNearest(List<(Light l, float full)> list, int n)
        {
            if (time < shadowPick || QualitySettings.GetQualityLevel() == 0) return;
            shadowPick = time + 0.5f;
            var cam = Camera.main;
            if (!cam) return;
            var cp = cam.transform.position;
            var order = new List<(float d, Light l)>();
            foreach (var (l, full) in list) order.Add(((l.transform.position - cp).sqrMagnitude / Mathf.Max(0.1f, Mathf.Abs(full)), l));
            order.Sort((a, b) => a.d.CompareTo(b.d));
            for (int i = 0; i < order.Count; i++)
            {
                var want = i < n ? LightShadows.Soft : LightShadows.None;
                if (order[i].l.shadows != want) order[i].l.shadows = want;
                if (i < n) { order[i].l.shadowStrength = 0.85f; order[i].l.shadowNearPlane = 0.2f; }
            }
        }

        void Flicker(List<(Light l, float full)> list)
        {
            foreach (var (l, full) in list)
            {
                if (full < 0) continue;
                var p = l.transform.position;
                l.intensity = full * (0.9f + 0.07f * Mathf.Sin(time * 13f + p.x * 3.1f + p.z) + 0.03f * Mathf.Sin(time * 31f + p.z));
            }
        }
    }

    /// Плоскость всегда лицом к камере (пламя).
    public class Billboard : MonoBehaviour
    {
        void LateUpdate()
        {
            var cam = Camera.main;
            if (!cam) return;
            var d = transform.position - cam.transform.position;
            d.y = 0;
            if (d.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(d);
        }
    }
}
