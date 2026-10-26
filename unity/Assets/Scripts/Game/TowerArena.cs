using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// «Охотничья башня» в эфире — как spectator/TowerArenaFx.ts: одна арена в фиксированной точке
    /// (TOWER_HIDE), круглый зал радиусом 26 м и высотой 20 м, цвет и свет по этажу (6 палитр), мобы этажа
    /// из MSG.towerMobs (их нет в ZoneState) — модель по FLOOR_MONSTERS, растут от этажа к этажу, босс ×3.
    public class TowerArena : MonoBehaviour
    {
        // shared/tower.ts
        public static readonly Vector3 Hide = new(0, 260, 0);
        public const float Radius = 26, WallH = 20;
        const int Floors = 20, MaxMobs = 10;
        const float BossScaleMul = 3;
        public static float FloorY => Hide.y - Hero.EyeHeight;
        /// Идёт забег (герой на этаже) — режиссёр держит камеру внутри зала.
        public static bool Active { get; private set; }
        public static int Floor { get; private set; }
        public static string HeroId { get; private set; } = "";

        static readonly (string model, string name)[] Monsters =
        {
            ("monAlien", "Пришелец"), ("monCat", "Одичавший кот"), ("monChicken", "Бешеная курица"), ("monFrog", "Болотная жаба"),
            ("monGreenBlob", "Зелёный слизень"), ("monMushnub", "Грибовик"), ("monPinkBlob", "Розовый плевун"), ("monYeti", "Йети"),
            ("monBirb", "Птер"), ("monBlueDemon", "Синий демон"), ("monBunny", "Кровожадный кролик"), ("monDemon", "Демон руин"),
            ("monDino", "Динозавр"), ("monFish", "Летучая рыба"), ("monMonkroose", "Обезьян-лось"), ("monOrcSkull", "Орк-костолом"),
            ("monTribal", "Соплеменник"), ("monNinja", "Ниндзя башни"), ("monAlpaking", "Альпакороль"), ("monDragonEvolved", "Дракон башни"),
        };

        /// Палитры этажей (камень, лава, лёд, заросли, кость, пустота): пол, стены, свод, свет, сила.
        static readonly (Color floor, Color wall, Color ceil, Color light, float k)[] Palettes =
        {
            (new(0.42f, 0.42f, 0.46f), new(0.3f, 0.3f, 0.34f), new(0.22f, 0.22f, 0.25f), new(0.85f, 0.85f, 0.95f), 1.1f),
            (new(0.5f, 0.16f, 0.1f), new(0.32f, 0.11f, 0.08f), new(0.18f, 0.06f, 0.05f), new(1, 0.45f, 0.15f), 1.4f),
            (new(0.22f, 0.4f, 0.55f), new(0.16f, 0.28f, 0.4f), new(0.1f, 0.18f, 0.28f), new(0.4f, 0.75f, 1), 1.2f),
            (new(0.2f, 0.38f, 0.18f), new(0.14f, 0.26f, 0.13f), new(0.08f, 0.16f, 0.08f), new(0.55f, 1, 0.45f), 1.0f),
            (new(0.58f, 0.54f, 0.46f), new(0.4f, 0.37f, 0.3f), new(0.26f, 0.24f, 0.2f), new(1, 0.95f, 0.8f), 1.2f),
            (new(0.28f, 0.14f, 0.38f), new(0.18f, 0.08f, 0.26f), new(0.1f, 0.04f, 0.16f), new(0.75f, 0.35f, 1), 1.3f),
        };

        class MobSlot
        {
            public Transform root, holder;
            public Anim anim;
            public Nameplate plate;
            public float baseScale, atkT;
            public bool lastPulse, init;
            public Vector3 target;
            public float yaw;
        }

        SliceAssets assets;
        GameObject room;
        Material floorMat, wallMat, ceilMat, runeMat;
        readonly List<Light> lights = new();
        readonly List<MobSlot> mobs = new();
        MobSlot boss;
        int builtFloor;
        List<object> lastMobs;
        float lastMsg;

        void Start()
        {
            ZoneNet.I.TowerMobs += m =>
            {
                lastMobs = m.TryGetValue("mobs", out var l) && l is IList list ? new List<object>((IEnumerable<object>)CastList(list)) : null;
                lastMsg = Time.time;
            };
        }

        static IEnumerable<object> CastList(IList l) { foreach (var o in l) yield return o; }

        void Build()
        {
            room = new GameObject("TowerRoom");
            room.transform.position = new Vector3(Hide.x, FloorY, Hide.z);
            floorMat = new Material(assets.litTemplate) { name = "towerFloor" };
            wallMat = new Material(assets.litTemplate) { name = "towerWall" };
            ceilMat = new Material(assets.litTemplate) { name = "towerCeil" };
            floorMat.SetFloat("_Smoothness", 0.35f);
            wallMat.SetFloat("_Smoothness", 0.15f);
            Part("floor", Disc(Radius + 0.5f, 64, false), floorMat, 0);
            Part("ceiling", Disc(Radius + 0.5f, 64, true), ceilMat, WallH);
            Part("wall", Wall(Radius, WallH, 64), wallMat, 0);
            // Колонны по стене — объём и ритм, свет на них ложится полосами.
            var cyl = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            var cylMesh = cyl.GetComponent<MeshFilter>().sharedMesh;
            Destroy(cyl);
            for (int i = 0; i < 12; i++)
            {
                float a = i / 12f * Mathf.PI * 2;
                var c = Part("pillar", cylMesh, wallMat, WallH / 2);
                c.transform.localPosition = new Vector3(Mathf.Cos(a) * (Radius - 0.6f), WallH / 2, Mathf.Sin(a) * (Radius - 0.6f));
                c.transform.localScale = new Vector3(1.4f, WallH / 2, 1.4f);
            }
            // Светящийся круг на полу — рунный обод арены.
            runeMat = new Material(assets.unlitAdd) { name = "towerRune" };
            Part("rune", Ring(Radius * 0.62f, Radius * 0.64f, 96), runeMat, 0.03f);
            Part("rune2", Ring(Radius * 0.95f, Radius * 0.965f, 96), runeMat, 0.03f);
            // Свет: центральный сверху и 6 «жаровен» у стен.
            for (int i = 0; i < 7; i++)
            {
                var l = new GameObject("towerLight").AddComponent<Light>();
                l.transform.SetParent(room.transform, false);
                l.type = LightType.Point;
                l.shadows = i == 0 ? LightShadows.Soft : LightShadows.None;
                if (i == 0) { l.transform.localPosition = new Vector3(0, WallH - 3, 0); l.range = 45; }
                else
                {
                    float a = (i - 1) / 6f * Mathf.PI * 2 + 0.26f;
                    l.transform.localPosition = new Vector3(Mathf.Cos(a) * (Radius - 3), 3.5f, Mathf.Sin(a) * (Radius - 3));
                    l.range = 16;
                }
                lights.Add(l);
            }
            room.SetActive(false);
        }

        GameObject Part(string name, Mesh mesh, Material mat, float y)
        {
            var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(room.transform, false);
            go.transform.localPosition = new Vector3(0, y, 0);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            return go;
        }

        static Mesh Disc(float r, int seg, bool down)
        {
            var v = new List<Vector3> { Vector3.zero };
            var uv = new List<Vector2> { new(0.5f, 0.5f) };
            var t = new List<int>();
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                v.Add(new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r));
                uv.Add(new Vector2(0.5f + Mathf.Cos(a) * 0.5f, 0.5f + Mathf.Sin(a) * 0.5f));
                if (i < seg) { if (down) t.AddRange(new[] { 0, i + 1, i + 2 }); else t.AddRange(new[] { 0, i + 2, i + 1 }); }
            }
            var m = new Mesh { vertices = v.ToArray(), uv = uv.ToArray(), triangles = t.ToArray() };
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        /// Стена изнутри (нормали к центру).
        static Mesh Wall(float r, float h, int seg)
        {
            var v = new List<Vector3>();
            var t = new List<int>();
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * r;
                v.Add(d);
                v.Add(d + Vector3.up * h);
                if (i < seg)
                {
                    int k = i * 2;
                    t.AddRange(new[] { k, k + 3, k + 1, k, k + 2, k + 3 });
                }
            }
            var m = new Mesh { vertices = v.ToArray(), triangles = t.ToArray() };
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        static Mesh Ring(float r0, float r1, int seg)
        {
            var v = new List<Vector3>();
            var t = new List<int>();
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                v.Add(d * r0);
                v.Add(d * r1);
                if (i < seg)
                {
                    int k = i * 2;
                    t.AddRange(new[] { k, k + 3, k + 1, k, k + 2, k + 3 });
                }
            }
            var m = new Mesh { vertices = v.ToArray(), triangles = t.ToArray() };
            m.RecalculateBounds();
            return m;
        }

        void ApplyFloor(int floor)
        {
            builtFloor = floor;
            var p = Palettes[(floor - 1) % Palettes.Length];
            floorMat.SetColor("_BaseColor", p.floor);
            wallMat.SetColor("_BaseColor", p.wall);
            ceilMat.SetColor("_BaseColor", p.ceil);
            runeMat.SetColor("_BaseColor", p.light * 0.6f);
            for (int i = 0; i < lights.Count; i++)
            {
                lights[i].color = p.light;
                lights[i].intensity = (i == 0 ? 22 : 9) * p.k;
            }
            // Модели этажа: мобы и босс (растут ×1 → ×3 к последнему этажу).
            foreach (var m in mobs) Destroy(m.root.gameObject);
            mobs.Clear();
            if (boss != null) Destroy(boss.root.gameObject);
            var fm = Monsters[Mathf.Clamp(floor, 1, Monsters.Length) - 1];
            float growth = 1 + (floor - 1) / (float)(Floors - 1) * 2;
            float h = 1.1f * growth;
            for (int i = 0; i < MaxMobs; i++) mobs.Add(MakeMob(fm.model, fm.name, h, floor));
            boss = MakeMob(fm.model, fm.name + " (босс этажа)", h * BossScaleMul, floor);
        }

        MobSlot MakeMob(string model, string name, float height, int floor)
        {
            var e = assets.Model(model);
            var root = new GameObject("towerMob").transform;
            root.SetParent(room.transform, false);
            var holder = new GameObject("model").transform;
            holder.SetParent(root, false);
            float bs = height / (e != null && e.height > 0.01f ? e.height : 1);
            holder.localScale = Vector3.one * bs;
            var body = Instantiate(e?.prefab ?? assets.slime, holder);
            var anchor = new GameObject("plate").transform;
            anchor.SetParent(root, false);
            anchor.localPosition = Vector3.up * (height + 0.4f);
            var plate = Nameplates.Create(anchor);
            plate.SetInfo(name, new Color(1, 0.55f, 0.45f), $"{floor * 5} ур.", new Color(1, 0.85f, 0.4f), 0, 0);
            root.gameObject.SetActive(false);
            var a = new Anim(body);
            a.Loop(1, "Idle", "idle", "Walk");
            return new MobSlot { root = root, holder = holder, anim = a, plate = plate, baseScale = bs };
        }

        /// Проверка без забега: «-towerdemo N» — этаж N, подставные мобы, камера в зале, снимок в -towershot.
        int demoFloor;
        string demoShot;

        void Awake()
        {
            var a = System.Environment.GetCommandLineArgs();
            int i = System.Array.IndexOf(a, "-towerdemo");
            if (i >= 0 && i + 1 < a.Length) int.TryParse(a[i + 1], out demoFloor);
            int j = System.Array.IndexOf(a, "-towershot");
            if (j >= 0 && j + 1 < a.Length) demoShot = a[j + 1];
            if (demoFloor > 0) StartCoroutine(Demo());
        }

        IEnumerator Demo()
        {
            yield return new WaitForSeconds(2.5f);
            var dir = FindAnyObjectByType<SpectatorDirector>();
            if (dir) dir.enabled = false;
            var cam = Camera.main;
            cam.transform.position = Hide + new Vector3(14, 2.5f, 14);
            cam.transform.LookAt(new Vector3(Hide.x - 2, FloorY + 2, Hide.z - 2));
            yield return new WaitForSeconds(1.5f);
            if (demoShot != null) ScreenCapture.CaptureScreenshot(demoShot);
            yield return new WaitForSeconds(1f);
            if (demoShot != null) Application.Quit();
        }

        void Update()
        {
            // Ассеты кладёт WorldSync.Start — порядок Start не гарантирован.
            if (!assets) assets = ZoneNet.I ? ZoneNet.I.Assets : null;
            if (!assets) return;
            // Забег идёт — у кого-то из героев towerFloor > 0.
            Active = false;
            if (demoFloor > 0)
            {
                Active = true;
                Floor = demoFloor;
                lastMsg = Time.time;
                lastMobs = new List<object>();
                for (int k = 0; k < 6; k++)
                {
                    float a = k / 6f * Mathf.PI * 2;
                    lastMobs.Add(new Dictionary<string, object> { { "x", Hide.x + Mathf.Cos(a) * 8 }, { "z", Hide.z + Mathf.Sin(a) * 8 }, { "yaw", a + Mathf.PI }, { "hpFrac", 0.4f + k * 0.1f }, { "boss", false } });
                }
                lastMobs.Add(new Dictionary<string, object> { { "x", Hide.x - 4f }, { "z", Hide.z - 4f }, { "yaw", 0.8f }, { "hpFrac", 0.9f }, { "boss", true } });
            }
            if (demoFloor == 0)
            foreach (var kv in WorldSync.Players)
            {
                var st = kv.Value ? kv.Value.state : null;
                if (st == null || st.towerFloor == 0) continue;
                Active = true;
                Floor = st.towerFloor;
                HeroId = kv.Key;
                break;
            }
            if (!Active) { if (room) room.SetActive(false); return; }
            if (!room) Build();
            room.SetActive(true);
            if (builtFloor != Floor) ApplyFloor(Floor);

            var list = Time.time - lastMsg < 2 ? lastMobs : null;
            int n = 0;
            MobSlot bossUsed = null;
            if (list != null)
                foreach (var o in list)
                {
                    if (o is not IDictionary m) continue;
                    bool isBoss = m.Contains("boss") && m["boss"] is bool b && b;
                    MobSlot s = isBoss ? boss : n < mobs.Count ? mobs[n++] : null;
                    if (s == null) continue;
                    if (isBoss) bossUsed = s;
                    float F(string k) => m.Contains(k) && m[k] is System.IConvertible c && m[k] is not bool ? c.ToSingle(System.Globalization.CultureInfo.InvariantCulture) : 0;
                    s.target = new Vector3(F("x"), FloorY, F("z"));
                    s.yaw = F("yaw");
                    if (!s.root.gameObject.activeSelf || !s.init) { s.root.position = s.target; s.init = true; }
                    s.root.gameObject.SetActive(true);
                    s.plate.SetBars(Mathf.Clamp01(F("hpFrac")), -1);
                    bool pulse = m.Contains("atkPulse") && m["atkPulse"] is bool ap && ap;
                    if (pulse && !s.lastPulse) s.atkT = 0.35f;
                    s.lastPulse = pulse;
                    if (m.Contains("burning") && m["burning"] is bool br && br && Random.value < 0.15f)
                        Vfx.I?.Burst(s.root.position + Vector3.up * 0.8f, FxColors.Fire, count: 3, speed: 1, life: 0.5f, grav: -3, size: 0.3f);
                }
            for (int i = n; i < mobs.Count; i++) if (mobs[i].root.gameObject.activeSelf) { mobs[i].root.gameObject.SetActive(false); mobs[i].init = false; }
            if (boss != null && bossUsed == null && boss.root.gameObject.activeSelf) { boss.root.gameObject.SetActive(false); boss.init = false; }

            float dt = Time.deltaTime;
            foreach (var s in AllSlots())
            {
                if (!s.root.gameObject.activeSelf) continue;
                var prev = s.root.position;
                s.root.position = Vector3.Lerp(s.root.position, s.target, 1 - Mathf.Exp(-12 * dt));
                s.root.rotation = Quaternion.Slerp(s.root.rotation, Quaternion.Euler(0, s.yaw * Mathf.Rad2Deg, 0), 1 - Mathf.Exp(-10 * dt));
                float speed = (s.root.position - prev).magnitude / Mathf.Max(dt, 1e-4f);
                if (speed > 0.6f) s.anim.Loop(1, "Walk", "Run", "Idle");
                else s.anim.Loop(1, "Idle", "idle", "Walk");
                // Замах — процедурный «удар»: сжатие и рывок вверх (как applyAttackSquash в вебе).
                s.atkT = Mathf.Max(0, s.atkT - dt);
                float k = s.atkT > 0 ? Mathf.Sin((1 - s.atkT / 0.35f) * Mathf.PI) : 0;
                s.holder.localScale = new Vector3(s.baseScale * (1 + 0.18f * k), s.baseScale * (1 - 0.12f * k), s.baseScale * (1 + 0.18f * k));
            }
        }

        IEnumerable<MobSlot> AllSlots()
        {
            foreach (var m in mobs) yield return m;
            if (boss != null) yield return boss;
        }
    }
}
