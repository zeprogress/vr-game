using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Объёмные эффекты боссов: ледяные кристаллы (вырастают из земли, держатся, рассыпаются искрами) —
    /// кольцо, кратер, гряда разлома, клетка, глыба в руке/в полёте, кружащие кристаллы «Обморожения»;
    /// метеоры Владыки (раскалённый камень со светом и огненным хвостом). В вебе — IceFx/FireFx, здесь своё:
    /// настоящий полупрозрачный лёд с бликами и свечением вместо плоских спрайтов.
    public class BossFx : MonoBehaviour
    {
        static BossFx inst;
        public static BossFx I
        {
            get
            {
                if (!inst && ZoneNet.I && ZoneNet.I.Assets && ZoneNet.I.Assets.litTransparent)
                    inst = new GameObject("BossFx").AddComponent<BossFx>();
                return inst;
            }
        }

        public enum Shard { Ring, Crater, Line, Cage, Boulder }

        internal class Crystal
        {
            public Transform tr;
            public Vector3 off;
            public Quaternion rot;
            public float len, delay;
        }

        public class Group
        {
            internal readonly List<Crystal> parts = new();
            internal Vector3 at;
            internal float age, hold, spin, shatterAt = -1;
            internal Func<Vector3?> track;
            internal bool orbit, done;
            /// Текущий центр группы (глыба в руке/в полёте).
            public Vector3 At => at;
        }

        class Rock
        {
            public Transform tr;
            public Light light;
            public Vector3 a, b;
            public float age, life, nextTrail;
        }

        readonly Stack<Transform> free = new();
        readonly List<Group> groups = new();
        readonly List<Rock> rocks = new();
        readonly Dictionary<string, Group> orbits = new();
        readonly List<(float t, Action fn)> timers = new();
        Mesh crystal, rockMesh;
        Material ice, rockMat;
        public float Clock { get; private set; }

        static readonly Color IceRim = FxColors.IceRim, Frost = FxColors.Frost;

        void Awake()
        {
            var a = ZoneNet.I.Assets;
            crystal = CrystalMesh();
            // Лёд: прозрачный, гладкий, с холодным свечением изнутри — bloom даёт ореол на гранях.
            ice = new Material(a.litTransparent) { name = "bossIce" };
            ice.SetColor("_BaseColor", new Color(0.62f, 0.86f, 1f, 0.88f)); // плотнее — кристаллы заморозки и стаки читались слабо
            ice.SetColor("_EmissionColor", new Color(0.18f, 0.5f, 1f) * 1.6f);
            ice.SetFloat("_Smoothness", 0.95f);
            ice.SetFloat("_Metallic", 0.1f);
            var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            rockMesh = s.GetComponent<MeshFilter>().sharedMesh;
            Destroy(s);
            rockMat = new Material(a.litTransparent) { name = "bossRock" };
            rockMat.SetColor("_BaseColor", new Color(0.2f, 0.12f, 0.08f, 1f));
            rockMat.SetColor("_EmissionColor", new Color(1f, 0.35f, 0.08f) * 2.2f);
            for (int i = 0; i < 260; i++) free.Push(NewCrystal());
            for (int i = 0; i < 12; i++)
            {
                var go = new GameObject("bossRock", typeof(MeshFilter), typeof(MeshRenderer));
                go.transform.SetParent(transform, false);
                go.GetComponent<MeshFilter>().sharedMesh = rockMesh;
                var r = go.GetComponent<MeshRenderer>();
                r.sharedMaterial = rockMat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                var l = go.AddComponent<Light>();
                l.type = LightType.Point;
                l.color = new Color(1f, 0.5f, 0.15f);
                l.range = 10;
                l.intensity = 8;
                l.shadows = LightShadows.None;
                go.SetActive(false);
                rocks.Add(new Rock { tr = go.transform, light = l, life = 0 });
            }
        }

        Transform NewCrystal()
        {
            var go = new GameObject("iceCrystal", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(transform, false);
            go.GetComponent<MeshFilter>().sharedMesh = crystal;
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = ice;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            go.SetActive(false);
            return go.transform;
        }

        /// Шестигранный кристалл высотой 1 вдоль +Y с острой вершиной и чуть скошенным основанием.
        static Mesh CrystalMesh()
        {
            const int N = 6;
            var v = new List<Vector3>();
            var t = new List<int>();
            void Tri(Vector3 a, Vector3 b, Vector3 c)
            {
                int k = v.Count;
                v.Add(a); v.Add(b); v.Add(c);
                t.Add(k); t.Add(k + 1); t.Add(k + 2);
            }
            var tip = new Vector3(0.02f, 1f, 0);
            for (int i = 0; i < N; i++)
            {
                float a0 = i * Mathf.PI * 2 / N, a1 = (i + 1) * Mathf.PI * 2 / N;
                var b0 = new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)) * 0.16f + Vector3.down * 0.15f;
                var b1 = new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1)) * 0.16f + Vector3.down * 0.15f;
                var m0 = new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)) * 0.13f + Vector3.up * 0.62f;
                var m1 = new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1)) * 0.13f + Vector3.up * 0.62f;
                Tri(b0, m1, b1); Tri(b0, m0, m1);
                Tri(m0, tip, m1);
            }
            var m = new Mesh { vertices = v.ToArray(), triangles = t.ToArray() };
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        Transform Take()
        {
            var tr = free.Count > 0 ? free.Pop() : NewCrystal();
            tr.gameObject.SetActive(true);
            return tr;
        }

        /// Кристаллы формы shape в точке p. r — радиус (кольцо/кратер/клетка/глыба), size — длина кристалла,
        /// hold — сколько стоят, count — сколько; line: b — конец гряды, w — полуширина, speed — бег фронта;
        /// track — центр следует за точкой (глыба в руке), spin — оборотов в секунду.
        public Group Shards(Shard shape, Vector3 p, float r = 2, float size = 1.5f, float hold = 1, int count = 20,
            Vector3? b = null, float w = 1, float speed = 18, Func<Vector3?> track = null, float spin = 0)
        {
            var g = new Group { at = p, hold = hold, track = track, spin = spin };
            var rnd = new System.Random(UnityEngine.Random.Range(0, 1 << 30));
            float R() => (float)rnd.NextDouble();
            void Add(Vector3 off, Vector3 up, float len, float delay)
            {
                var tr = Take();
                g.parts.Add(new Crystal { tr = tr, off = off, rot = Quaternion.FromToRotation(Vector3.up, up.normalized) * Quaternion.Euler(0, R() * 360, 0), len = len, delay = delay });
            }
            switch (shape)
            {
                case Shard.Ring:
                    for (int i = 0; i < count; i++)
                    {
                        float a = (i + R() * 0.6f) / count * Mathf.PI * 2;
                        var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                        float rr = r * (0.85f + R() * 0.25f);
                        Add(d * rr, d * (0.35f + R() * 0.35f) + Vector3.up, size * (0.55f + R() * 0.6f), rr / 40f);
                        if (R() < 0.6f) Add(d * (rr - 0.5f), d * 0.9f + Vector3.up, size * (0.3f + R() * 0.3f), rr / 40f + 0.03f);
                    }
                    break;
                case Shard.Crater:
                    for (int i = 0; i < count; i++)
                    {
                        float a = R() * Mathf.PI * 2, rr = Mathf.Sqrt(R()) * r;
                        var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                        Add(d * rr, d * (0.2f + rr / r * 0.9f) + Vector3.up, size * (1.1f - rr / r * 0.6f) * (0.6f + R() * 0.5f), R() * 0.08f);
                    }
                    break;
                case Shard.Line:
                {
                    var e = b ?? p;
                    var dir = e - p;
                    dir.y = 0;
                    float len = dir.magnitude;
                    var fwd = len > 0.01f ? dir / len : Vector3.forward;
                    var side = Vector3.Cross(Vector3.up, fwd);
                    int n = Mathf.Max(4, Mathf.RoundToInt(len / 0.75f));
                    for (int i = 0; i < n; i++)
                    {
                        float u = (i + R() * 0.5f) / n, along = len * u;
                        for (int j = 0; j < 2; j++)
                        {
                            float sx = (R() * 2 - 1) * w * 0.8f;
                            var off = fwd * along + side * sx + Vector3.up * Mathf.Lerp(0, e.y - p.y, u);
                            Add(off, Vector3.up + side * (sx / Mathf.Max(0.1f, w)) * 0.5f + fwd * 0.3f, size * (0.5f + R() * 0.6f) * (j == 0 ? 1 : 0.6f), along / Mathf.Max(1, speed));
                        }
                    }
                    break;
                }
                case Shard.Cage:
                    for (int i = 0; i < count; i++)
                    {
                        float a = (i + R() * 0.4f) / count * Mathf.PI * 2;
                        var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                        Add(d * r * (0.9f + R() * 0.3f), Vector3.up - d * (0.25f + R() * 0.2f), size * (0.7f + R() * 0.4f), R() * 0.06f);
                    }
                    break;
                case Shard.Boulder:
                    for (int i = 0; i < count; i++)
                    {
                        var d = UnityEngine.Random.onUnitSphere;
                        Add(d * r * 0.3f, d, size * (0.5f + R() * 0.5f), 0);
                    }
                    break;
            }
            Place(g, 0);
            groups.Add(g);
            return g;
        }

        /// Глыба сменила путь (из руки — в полёт): новый центр и время.
        public void Retrack(Group g, Func<Vector3?> track, float hold)
        {
            g.track = track;
            g.hold = g.age + hold;
        }

        /// Снять группу сразу (глыба долетела): рассыпается искрами.
        public void End(Group g)
        {
            if (g == null || g.done) return;
            g.hold = Mathf.Min(g.hold, g.age);
        }

        /// Кристаллы «Обморожения» кружат вокруг героя/моба: сколько стаков — столько кристаллов.
        public void FrostOrbit(string id, int stacks, float sec, Func<Vector3?> follow)
        {
            ClearOrbit(id, quiet: true);
            var g = new Group { hold = sec, track = follow, orbit = true, at = follow() ?? Vector3.zero, spin = 0.6f };
            for (int i = 0; i < stacks; i++)
            {
                float a = i / (float)stacks * Mathf.PI * 2;
                var tr = Take();
                g.parts.Add(new Crystal { tr = tr, off = new Vector3(Mathf.Cos(a) * 0.85f, 1.1f + 0.15f * (i % 2), Mathf.Sin(a) * 0.85f), rot = Quaternion.Euler(0, 0, 25), len = 0.45f, delay = i * 0.04f });
            }
            groups.Add(g);
            orbits[id] = g;
        }

        public void ClearOrbit(string id, bool quiet = false)
        {
            if (!orbits.TryGetValue(id, out var g)) return;
            orbits.Remove(id);
            if (quiet) { Release(g); g.done = true; }
            else End(g);
        }

        /// Метеор: раскалённый камень из a в b за t с, со светом и огненно-дымным хвостом.
        public void Meteor(Vector3 a, Vector3 b, float t, float size = 0.85f)
        {
            Rock rk = null;
            foreach (var r in rocks) if (r.age >= r.life) { rk = r; break; }
            rk ??= rocks[0];
            rk.a = a; rk.b = b; rk.age = 0; rk.life = t; rk.nextTrail = 0;
            rk.tr.localScale = Vector3.one * size * 1.6f;
            rk.tr.position = a;
            rk.tr.gameObject.SetActive(true);
        }

        class Heat
        {
            public Transform sphere;
            public Material mat;
            public Transform[] shells;
            public Material[] shellMats;
            public string id;
            public float age, life, r;
            public Color color;
        }

        readonly List<Heat> heats = new();
        static readonly int HColor = Shader.PropertyToID("_Color"), HAlpha = Shader.PropertyToID("_Alpha"), HTime = Shader.PropertyToID("_TimeS"), HRim = Shader.PropertyToID("_Rim");

        /// Сфера жара вокруг героя id на dur с (аура воина): раскалённый купол радиусом r и горячие
        /// оболочки, волнами расходящиеся от героя к краю. Ходит за героем.
        public void HeatSphere(string id, float r, float dur, Color color)
        {
            var tpl = ZoneNet.I.Assets.fxHeat;
            if (!tpl) return;
            Heat h = null;
            foreach (var x in heats) if (x.id == id || x.age >= x.life) { h = x; break; }
            if (h == null)
            {
                var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                var mesh = s.GetComponent<MeshFilter>().sharedMesh;
                Destroy(s);
                Transform Make(out Material m)
                {
                    var go = new GameObject("heatSphere", typeof(MeshFilter), typeof(MeshRenderer));
                    go.transform.SetParent(transform, false);
                    go.GetComponent<MeshFilter>().sharedMesh = mesh;
                    var rr = go.GetComponent<MeshRenderer>();
                    m = new Material(tpl);
                    rr.sharedMaterial = m;
                    rr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                    rr.receiveShadows = false;
                    return go.transform;
                }
                h = new Heat { shells = new Transform[3], shellMats = new Material[3] };
                h.sphere = Make(out h.mat);
                for (int i = 0; i < 3; i++) h.shells[i] = Make(out h.shellMats[i]);
                heats.Add(h);
            }
            h.id = id; h.age = 0; h.life = dur; h.r = r; h.color = color;
            h.mat.SetColor(HColor, color);
            h.mat.SetFloat(HRim, 2.2f);
            foreach (var m in h.shellMats) { m.SetColor(HColor, Color.Lerp(color, new Color(1, 0.8f, 0.5f), 0.3f)); m.SetFloat(HRim, 3.5f); }
            h.sphere.gameObject.SetActive(true);
            foreach (var t in h.shells) t.gameObject.SetActive(true);
        }

        void UpdateHeats(float dt)
        {
            foreach (var h in heats)
            {
                if (h.age >= h.life) continue;
                h.age += dt;
                var p = Vfx.FollowPos(Vfx.Follow.Hero, h.id);
                if (h.age >= h.life || float.IsNaN(p.x))
                {
                    h.age = h.life;
                    h.sphere.gameObject.SetActive(false);
                    foreach (var t in h.shells) t.gameObject.SetActive(false);
                    continue;
                }
                // Появляется за 0.35 с (раздувается от героя), гаснет за 0.6 с.
                float fade = Mathf.Min(1, h.age / 0.35f) * Mathf.Min(1, (h.life - h.age) / 0.6f);
                float grow = Mathf.SmoothStep(0.2f, 1f, Mathf.Min(1, h.age / 0.35f));
                h.sphere.position = p;
                h.sphere.localScale = Vector3.one * h.r * 2 * grow * (1 + 0.015f * Mathf.Sin(h.age * 6));
                h.mat.SetFloat(HAlpha, 0.1f * fade); // едва заметное сияние, не навязчиво
                h.mat.SetFloat(HTime, Clock);
                // Волны жара: три оболочки по очереди расходятся от героя к краю и гаснут.
                for (int i = 0; i < h.shells.Length; i++)
                {
                    float u = Mathf.Repeat(h.age * 0.8f + i / 3f, 1f);
                    h.shells[i].position = p;
                    h.shells[i].localScale = Vector3.one * h.r * 2 * Mathf.Lerp(0.15f, 1f, u) * grow;
                    h.shellMats[i].SetFloat(HAlpha, 0.06f * fade * Mathf.Sin(u * Mathf.PI));
                    h.shellMats[i].SetFloat(HTime, Clock + i * 3.1f);
                }
            }
        }

        public void Later(float sec, Action fn)
        {
            if (sec <= 0) fn();
            else timers.Add((sec, fn));
        }

        void Place(Group g, float dt)
        {
            if (g.track != null)
            {
                var p = g.track();
                if (p.HasValue) g.at = p.Value;
                else if (g.orbit) g.hold = Mathf.Min(g.hold, g.age);
            }
            var spinQ = Quaternion.Euler(0, g.age * g.spin * 360, 0);
            foreach (var c in g.parts)
            {
                float t = g.age - c.delay;
                // Рост: выскакивает за 0.12 с с лёгким перехлёстом; рассыпание — быстрое сжатие.
                float grow = t <= 0 ? 0 : t < 0.12f ? Mathf.Sin(t / 0.12f * Mathf.PI * 0.5f) * 1.12f : t < 0.2f ? Mathf.Lerp(1.12f, 1f, (t - 0.12f) / 0.08f) : 1f;
                if (g.shatterAt >= 0) grow *= Mathf.Clamp01(1 - (g.age - g.shatterAt) / 0.14f);
                float l = c.len * grow;
                c.tr.localScale = new Vector3(Mathf.Max(0.001f, c.len * 0.9f * Mathf.Min(1, grow)), Mathf.Max(0.001f, l), Mathf.Max(0.001f, c.len * 0.9f * Mathf.Min(1, grow)));
                c.tr.position = g.at + (g.spin != 0 ? spinQ * c.off : c.off) + (g.orbit ? Vector3.up * 0.1f * Mathf.Sin(g.age * 3 + c.delay * 40) : Vector3.zero);
                c.tr.rotation = g.spin != 0 ? spinQ * c.rot : c.rot;
            }
        }

        void Release(Group g)
        {
            foreach (var c in g.parts)
            {
                c.tr.gameObject.SetActive(false);
                free.Push(c.tr);
            }
            g.parts.Clear();
        }

        void Update()
        {
            float dt = Time.deltaTime;
            Clock += dt;
            UpdateHeats(dt);
            for (int i = timers.Count - 1; i >= 0; i--)
            {
                var (t, fn) = timers[i];
                t -= dt;
                if (t <= 0)
                {
                    timers.RemoveAt(i);
                    try { fn(); } catch (Exception e) { Debug.LogException(e); }
                }
                else timers[i] = (t, fn);
            }
            for (int i = groups.Count - 1; i >= 0; i--)
            {
                var g = groups[i];
                if (g.done) { groups.RemoveAt(i); continue; }
                g.age += dt;
                if (g.shatterAt < 0 && g.age >= g.hold)
                {
                    g.shatterAt = g.age;
                    // Рассыпается: ледяная крошка от каждого крупного кристалла.
                    var vfx = Vfx.I;
                    if (vfx != null)
                    {
                        int step = Mathf.Max(1, g.parts.Count / 6);
                        for (int k = 0; k < g.parts.Count; k += step)
                        {
                            var c = g.parts[k];
                            vfx.Burst(c.tr.position + c.tr.up * c.len * 0.5f, IceRim, count: 8, speed: 3.5f, life: 0.55f, grav: 9, size: 0.14f + c.len * 0.04f);
                        }
                    }
                }
                Place(g, dt);
                if (g.shatterAt >= 0 && g.age - g.shatterAt > 0.15f)
                {
                    Release(g);
                    g.done = true;
                    groups.RemoveAt(i);
                }
            }
            foreach (var rk in rocks)
            {
                if (rk.age >= rk.life) continue;
                rk.age += dt;
                float u = Mathf.Min(1, rk.age / rk.life);
                // Разгон к земле (u²) — камень «падает», а не скользит.
                var p = Vector3.Lerp(rk.a, rk.b, u * u);
                rk.tr.position = p;
                rk.tr.Rotate(240 * dt, 170 * dt, 0);
                if (Clock >= rk.nextTrail && Vfx.I != null)
                {
                    rk.nextTrail = Clock + 0.035f;
                    var back = (rk.a - rk.b).normalized;
                    Vfx.I.Burst(p, FxColors.FireCore, count: 5, speed: 1.5f, life: 0.3f, grav: -1, size: 0.55f, dir: back, spread: 0.3f);
                    Vfx.I.Burst(p, FxColors.Fire, count: 4, speed: 1, life: 0.55f, grav: -2, size: 0.8f, dir: back, spread: 0.5f);
                    Vfx.I.Burst(p, new Color(0.18f, 0.15f, 0.13f), count: 2, speed: 0.6f, life: 1.1f, grav: -1.2f, size: 0.9f, smoke: true);
                }
                if (rk.age >= rk.life) rk.tr.gameObject.SetActive(false);
            }
        }
    }
}
