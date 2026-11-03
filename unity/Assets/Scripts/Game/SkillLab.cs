using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Полигон умений героя: все классы, все умения, их настоящий визуал.
    ///
    /// Данные — `Resources/skillLab.json`, сгенерированный `npm run lab:unity` из
    /// shared/classes2.ts + shared/skillShow.ts (тот же сценарий, что играет веб-лаборатория).
    /// Эффекты — общий на игру обработчик ClassActs/BossActs, а не копия в лаборатории.
    /// Сеть не нужна: герой и манекены живут локально.
    public class SkillLab : MonoBehaviour
    {
        [Serializable]
        public class ActRow
        {
            public float at;
            public string k;
            public float x, y, z;
            public float d, x2, z2, r;
            public int v;
            public string mobId;
            public bool hx2, hz2, hd, hr, hv;
        }

        [Serializable]
        public class SkillRow
        {
            public string id, name, desc, damage;
            public float cooldown;
            public ActRow[] acts;
        }

        [Serializable]
        public class ClassRow
        {
            public string id, name, role;
            public SkillRow[] skills;
        }

        [Serializable]
        public class LabData
        {
            public int level;
            public string note;
            public ClassRow[] classes;
        }

        public SliceAssets assets;
        public TextAsset data;
        public Camera cam;

        LabData d;
        int clsIdx;
        HeroRig rig;
        GameObject hero;
        readonly List<GameObject> dummies = new();
        readonly List<(float at, ActRow a)> queue = new();
        readonly Dictionary<string, float> readyAt = new();
        LabOrbit orbit;
        GUIStyle wrap;
        Vector2 scroll;
        string status = "";
        bool showAll;
        int allIdx;
        float nextAll;

        void Start()
        {
            if (!data) data = Resources.Load<TextAsset>("skillLab");
            if (!data)
            {
                Debug.LogError("[lab] нет Assets/Resources/skillLab.json — запусти npm run lab:unity");
                enabled = false;
                return;
            }
            d = JsonUtility.FromJson<LabData>(data.text);
            if (d == null || d.classes == null || d.classes.Length == 0)
            {
                Debug.LogError("[lab] skillLab.json пуст или битый");
                enabled = false;
                return;
            }
#if UNITY_EDITOR
            if (!assets) assets = UnityEditor.AssetDatabase.LoadAssetAtPath<SliceAssets>("Assets/Slice/SliceAssets.asset");
#endif
            if (!assets)
            {
                Debug.LogError("[lab] не задан SliceAssets (Assets/Slice/SliceAssets.asset)");
                enabled = false;
                return;
            }
            SetupWorld();
            ApplyClass(0);
        }

        // ---------------------------------------------------------------- сцена

        void SetupWorld()
        {
            if (!ZoneNet.I)
            {
                var net = new GameObject("Net");
                var zn = net.AddComponent<ZoneNet>();
                zn.offline = true;
                net.AddComponent<SoundBank>();
            }
            ZoneNet.I.offline = true;
            ZoneNet.I.Assets = assets;

            if (RenderSettings.sun == null)
            {
                var sun = new GameObject("Sun").AddComponent<Light>();
                sun.type = LightType.Directional;
                sun.color = new Color(1f, 0.94f, 0.84f);
                sun.intensity = 1.6f;
                sun.shadows = LightShadows.Soft;
                sun.transform.rotation = Quaternion.Euler(38, -35, 0);
                RenderSettings.sun = sun;
            }
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.42f, 0.46f, 0.52f);
            RenderSettings.fog = false;

            if (!GameObject.Find("LabGround"))
            {
                var plane = GameObject.CreatePrimitive(PrimitiveType.Plane);
                plane.name = "LabGround";
                plane.transform.localScale = new Vector3(8, 1, 8);
                var sh = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                var mat = new Material(sh);
                mat.color = new Color(0.28f, 0.42f, 0.22f);
                if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(0.28f, 0.42f, 0.22f));
                plane.GetComponent<Renderer>().sharedMaterial = mat;
            }

            if (!cam) cam = Camera.main;
            if (!cam)
            {
                var go = new GameObject("LabCamera");
                cam = go.AddComponent<Camera>();
                cam.tag = "MainCamera";
            }
            cam.clearFlags = RenderSettings.skybox ? CameraClearFlags.Skybox : CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.55f, 0.72f, 0.9f);
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 300f;
            if (!cam.GetComponent<AudioListener>() && !FindObjectOfType<AudioListener>()) cam.gameObject.AddComponent<AudioListener>();

            SpawnDummies();
            orbit = cam.GetComponent<LabOrbit>() ?? cam.gameObject.AddComponent<LabOrbit>();
        }

        void SpawnDummies()
        {
            foreach (var go in dummies) if (go) Destroy(go);
            dummies.Clear();
            var spots = new[]
            {
                new Vector3(0, 0, 4.5f),
                new Vector3(-3.5f, 0, 3.2f),
                new Vector3(3.5f, 0, 3.2f),
                new Vector3(0, 0, 8.5f),
            };
            foreach (var p in spots)
            {
                GameObject go;
                if (assets.dummy)
                {
                    go = Instantiate(assets.dummy, p, Quaternion.Euler(0, 180, 0));
                }
                else
                {
                    go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                    go.transform.position = p + Vector3.up;
                    go.transform.localScale = new Vector3(0.7f, 0.9f, 0.7f);
                    var sh = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                    var mat = new Material(sh) { color = new Color(0.62f, 0.58f, 0.5f) };
                    if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(0.62f, 0.58f, 0.5f));
                    go.GetComponent<Renderer>().sharedMaterial = mat;
                }
                go.name = "LabDummy";
                dummies.Add(go);
            }
        }

        static void Gear(string cls, out string left, out string right)
        {
            left = right = "";
            switch (cls)
            {
                case "warrior": left = "shield"; right = "sword"; break;
                case "archer": left = "bow"; break;
                case "support": right = "staff"; break;
                case "assassin": left = "dagger"; right = "dagger"; break;
                case "spearman": right = "spear"; break;
                case "battlemage": right = "hammer"; break;
            }
        }

        void ApplyClass(int i)
        {
            clsIdx = Mathf.Clamp(i, 0, d.classes.Length - 1);
            queue.Clear();
            readyAt.Clear();
            showAll = false;
            if (hero) Destroy(hero);
            var c = d.classes[clsIdx];
            Gear(c.id, out var l, out var r);
            hero = new GameObject("LabHero");
            hero.transform.position = Vector3.zero;
            rig = hero.AddComponent<HeroRig>();
            rig.Init(assets);
            rig.Apply(0, l, string.IsNullOrEmpty(l) ? "" : "gold", r, string.IsNullOrEmpty(r) ? "" : "gold");
            // Для эффектов, которые держатся за героя (аура, вихрь, лечение): тело
            // в общей таблице, но без сети и без собственного Update.
            var pv = hero.AddComponent<PlayerView>();
            pv.enabled = false;
            WorldSync.Players["hero"] = pv;
            if (orbit) orbit.target = hero.transform;
            status = $"{c.name} — выбери умение";
        }

        // ---------------------------------------------------------------- показ

        /// Проба play-режима (Editor/LabSmoke): показать первое умение класса.
        public void SmokePlay()
        {
            if (d != null && d.classes != null && d.classes.Length > 0) Play(d.classes[clsIdx].skills[0], true);
        }

        void Play(SkillRow s, bool force)
        {
            if (!rig) return;
            if (!force && readyAt.TryGetValue(s.id, out var until) && Time.time < until) return;
            readyAt[s.id] = Time.time + s.cooldown;
            var c = d.classes[clsIdx];
            if (rig.Own) rig.PlaySkill(s.id, c.id);
            else rig.PlaySwing(d.level);
            if (s.acts != null)
                foreach (var a in s.acts) queue.Add((Time.time + a.at, a));
            status = $"▶ {s.name} · {c.name}";
        }

        void PlayAct(ActRow a)
        {
            float? D(float v, bool has) => has ? v : (float?)null;
            int? V = a.hv ? a.v : (int?)null;
            string mob = string.IsNullOrEmpty(a.mobId) ? null : a.mobId;
            if (ClassActs.Play(a.k, "hero", a.x, a.y, a.z, D(a.d, a.hd), D(a.x2, a.hx2), D(a.z2, a.hz2), V, D(a.r, a.hr), mob)) return;
            if (BossActs.Play(a.k, "hero", a.x, a.y, a.z, D(a.d, a.hd), D(a.x2, a.hx2), D(a.z2, a.hz2), V, D(a.r, a.hr), mob)) return;
            switch (a.k)
            {
                case "arrowRain":
                    // Старый обработчик града: древки и зона (ClassActs уже нарисовал телеграф).
                    GroundFx.ArrowRain(new Vector3(a.x, a.y, a.z), a.hr ? a.r : 6.5f, a.hd ? a.d : 0.9f, 3f);
                    return;
                case "rainTick":
                case "healHit":
                case "crit":
                    return; // рисуются внутри своих обработчиков
            }
            Debug.LogWarning($"[lab] нет обработчика эффекта «{a.k}»");
        }

        void Update()
        {
            for (int i = queue.Count - 1; i >= 0; i--)
            {
                if (Time.time < queue[i].at) continue;
                var a = queue[i].a;
                queue.RemoveAt(i);
                PlayAct(a);
            }
            if (!showAll || d == null) return;
            if (Time.time < nextAll) return;
            var c = d.classes[clsIdx];
            if (c.skills == null || allIdx >= c.skills.Length)
            {
                showAll = false;
                return;
            }
            Play(c.skills[allIdx++], true);
            nextAll = Time.time + 2.4f;
        }

        // ---------------------------------------------------------------- пульт

        void OnGUI()
        {
            if (d == null) return;
            wrap ??= new GUIStyle(GUI.skin.label) { wordWrap = true };
            const int W = 430;
            var x = Mathf.Max(8, Screen.width - W - 10);
            GUILayout.BeginArea(new Rect(x, 10, W, Screen.height - 20), GUI.skin.box);
            scroll = GUILayout.BeginScrollView(scroll, GUILayout.Width(W - 20));
            GUILayout.Label($"<b>🎬 Полигон умений</b> · уровень {d.level}", Rich);
            GUILayout.Label("Все числа и эффекты — из кода игры. Сетевой сервер не нужен.", wrap);

            var c = d.classes[clsIdx];
            GUILayout.Space(6);
            for (int row = 0; row < d.classes.Length; row += 3)
            {
                GUILayout.BeginHorizontal();
                for (int i = row; i < Mathf.Min(row + 3, d.classes.Length); i++)
                {
                    var old = GUI.backgroundColor;
                    if (i == clsIdx) GUI.backgroundColor = new Color(0.35f, 0.62f, 0.95f);
                    if (GUILayout.Button(d.classes[i].name, GUILayout.Height(26))) ApplyClass(i);
                    GUI.backgroundColor = old;
                }
                GUILayout.EndHorizontal();
            }

            GUILayout.Space(8);
            GUILayout.Label($"<b>{c.name}</b> — {c.role}", Rich);
            if (c.skills != null)
            {
                foreach (var s in c.skills)
                {
                    GUILayout.BeginVertical(GUI.skin.box);
                    GUILayout.BeginHorizontal();
                    GUILayout.Label($"<b>{s.name}</b>", Rich);
                    if (GUILayout.Button("▶", GUILayout.Width(34), GUILayout.Height(24))) Play(s, true);
                    GUILayout.EndHorizontal();
                    GUILayout.Label($"Откат {s.cooldown:0.#} с", GUI.skin.label);
                    if (!string.IsNullOrEmpty(s.damage)) GUILayout.Label(s.damage, wrap);
                    GUILayout.Label(s.desc, wrap);
                    GUILayout.EndVertical();
                }
            }

            GUILayout.Space(8);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button(showAll ? "⏹ Стоп" : "🎬 Показать все", GUILayout.Height(28)))
            {
                if (showAll) showAll = false;
                else { showAll = true; allIdx = 0; nextAll = Time.time; }
            }
            if (GUILayout.Button("Сброс камеры", GUILayout.Height(28)))
            {
                if (orbit) { orbit.yaw = 0; orbit.pitch = 18; orbit.dist = 7.5f; }
                if (hero)
                {
                    var pos = hero.transform.position + new Vector3(0, 2.2f, 4.6f);
                    if (cam) { cam.transform.position = pos; cam.transform.LookAt(hero.transform.position + Vector3.up * 1.2f); }
                }
            }
            GUILayout.EndHorizontal();
            GUILayout.Label(status, wrap);
            GUILayout.EndScrollView();
            GUILayout.EndArea();

            GUI.Label(new Rect(10, 10, 420, 22), "ПКМ — камера · колесо — дистанция");
        }

        static GUIStyle rich;
        static GUIStyle Rich => rich ??= new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true };
    }
}
