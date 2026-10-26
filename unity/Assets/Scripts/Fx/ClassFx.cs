using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Эффекты «Классов 2.0» — перенос client/ui/ClassFx.ts: пулы колец, куполов, полос по земле, печатей,
    /// тёмных следов рывка и летящих стрел умений; отложенные вспышки (later) и повторяющиеся
    /// (грозовое поле, искры ауры, вихрь). Сами события умений — ClassActs.Play.
    public class ClassFx : MonoBehaviour
    {
        static ClassFx inst;
        public static ClassFx I
        {
            get
            {
                if (!inst && ZoneNet.I && ZoneNet.I.Assets && ZoneNet.I.Assets.unlitAdd)
                    inst = new GameObject("ClassFx").AddComponent<ClassFx>();
                return inst;
            }
        }

        class Item
        {
            public GameObject go;
            public Material mat;
            public Color color;
            public float age = 1, life = 1, r0, r1, alpha = 1, width = 1, radius = 1, stick;
            public GameObject glow;
            public Material glowMat;
            public Vector3 a, b;
            public float arc;
            public bool landed;
            public Action onHit;
        }

        readonly List<Item> rings = new(), domes = new(), streaks = new(), seals = new(), ghosts = new(), arrows = new();
        int nRing, nDome, nStreak, nSeal, nGhost, nArrow;
        readonly List<(float t, Action fn)> timers = new();
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor"), BaseMap = Shader.PropertyToID("_BaseMap");

        void Awake()
        {
            var a = ZoneNet.I.Assets;
            var torus = Torus(1f, 0.025f, 40, 6);
            for (int i = 0; i < 10; i++) rings.Add(Make("ring", torus, a.unlitAdd));
            var dome = HalfSphere(14);
            for (int i = 0; i < 4; i++) domes.Add(Make("dome", dome, a.unlitAdd));
            // Полоса длиной 1 вдоль +Z с центром в начале координат — тянем scale.z.
            var strip = new Mesh
            {
                vertices = new[] { new Vector3(-0.5f, 0, -0.5f), new Vector3(0.5f, 0, -0.5f), new Vector3(0.5f, 0, 0.5f), new Vector3(-0.5f, 0, 0.5f) },
                triangles = new[] { 0, 2, 1, 0, 3, 2 },
            };
            strip.RecalculateBounds();
            for (int i = 0; i < 6; i++) streaks.Add(Make("streak", strip, a.unlitAdd));
            var sealTex = SealTexture();
            var disc = Disc(40);
            for (int i = 0; i < 4; i++)
            {
                var s = Make("seal", disc, a.unlitAdd);
                s.mat.SetTexture(BaseMap, sealTex);
                var g = Make("sealGlow", dome, a.unlitAdd);
                s.glow = g.go;
                s.glowMat = g.mat;
                seals.Add(s);
            }
            var ball = Sphere(8);
            for (int i = 0; i < 12; i++) ghosts.Add(Make("ghost", ball, a.unlitAlpha));
            // Стрела умения: тонкий брусок вдоль +Z (у веба — модель стрелы, scale 1.5).
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var cubeMesh = cube.GetComponent<MeshFilter>().sharedMesh;
            Destroy(cube);
            for (int i = 0; i < 48; i++)
            {
                var it = Make("arrow", cubeMesh, a.litTemplate);
                it.go.transform.localScale = new Vector3(0.05f, 0.05f, 1.1f);
                it.mat.SetColor(BaseColor, new Color(0.85f, 0.85f, 0.8f));
                it.color = Color.clear;
                arrows.Add(it);
            }
        }

        Item Make(string name, Mesh mesh, Material template)
        {
            var go = new GameObject("cfx_" + name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            var it = new Item { go = go, mat = new Material(template) };
            r.sharedMaterial = it.mat;
            go.SetActive(false);
            return it;
        }

        static void SetC(Material m, Color c, float alpha) => m.SetColor(BaseColor, new Color(c.r, c.g, c.b, Mathf.Clamp01(alpha)));

        /// Расходящееся кольцо по земле: от r0 до r1 за life с.
        public void Ring(Vector3 p, float r0, float r1, Color color, float life = 0.45f, float alpha = 0.9f)
        {
            var r = rings[nRing];
            nRing = (nRing + 1) % rings.Count;
            r.color = color;
            r.go.transform.position = p + Vector3.up * 0.06f;
            r.age = 0; r.life = life; r.r0 = r0; r.r1 = r1; r.alpha = alpha;
            r.go.SetActive(true);
        }

        /// Купол-удар (приземление): быстро раздувается и гаснет.
        public void Dome(Vector3 p, float radius, Color color, float life = 0.5f)
        {
            var d = domes[nDome];
            nDome = (nDome + 1) % domes.Count;
            d.color = color;
            d.go.transform.position = p + Vector3.up * 0.02f;
            d.age = 0; d.life = life; d.r0 = radius * 0.2f; d.r1 = radius; d.alpha = 0.35f;
            d.go.SetActive(true);
        }

        /// Полоса по земле от (x1,z1) до (x2,z2).
        public void Streak(float x1, float y, float z1, float x2, float z2, Color color, float width = 0.5f, float life = 0.35f)
        {
            var s = streaks[nStreak];
            nStreak = (nStreak + 1) % streaks.Count;
            float len = Mathf.Sqrt((x2 - x1) * (x2 - x1) + (z2 - z1) * (z2 - z1));
            if (len < 0.1f) return;
            s.color = color;
            s.go.transform.position = new Vector3((x1 + x2) / 2, y + 0.08f, (z1 + z2) / 2);
            s.go.transform.rotation = Quaternion.Euler(0, Mathf.Atan2(x2 - x1, z2 - z1) * Mathf.Rad2Deg, 0);
            s.go.transform.localScale = new Vector3(width, 1, len);
            s.age = 0; s.life = life; s.width = width;
            s.go.SetActive(true);
        }

        /// Печать на земле на life с: знак вращается, купол-свечение дышит.
        public void Seal(Vector3 p, float radius, Color color, float life)
        {
            var s = seals[nSeal];
            nSeal = (nSeal + 1) % seals.Count;
            s.color = color;
            s.go.transform.position = p + Vector3.up * 0.07f;
            s.glow.transform.position = p + Vector3.up * 0.02f;
            s.go.transform.localScale = Vector3.one * radius;
            s.age = 0; s.life = life; s.radius = radius;
            s.go.SetActive(true);
            s.glow.SetActive(true);
        }

        /// Тёмные следы рывка: несколько сгустков вдоль пути, гаснут по очереди.
        public void ShadowTrail(float x1, float y, float z1, float x2, float z2)
        {
            const int N = 5;
            for (int i = 0; i < N; i++)
            {
                var g = ghosts[nGhost];
                nGhost = (nGhost + 1) % ghosts.Count;
                float t = i / (float)(N - 1);
                g.go.transform.position = new Vector3(x1 + (x2 - x1) * t, y + 0.9f, z1 + (z2 - z1) * t);
                g.age = -t * 0.12f; g.life = 0.55f;
                g.go.transform.localScale = Vector3.one * 0.01f;
                g.go.SetActive(true);
            }
        }

        /// Стрела умения летит из a в b за time с (по умолчанию — dist / SKILL_ARROW.speed) с дугой arc,
        /// потом торчит stick с; onHit — в момент попадания (SkillArrows.fly).
        public void Fly(Vector3 a, Vector3 b, float? time = null, float? arc = null, float stick = 0, Action onHit = null)
        {
            var f = arrows[nArrow];
            nArrow = (nArrow + 1) % arrows.Count;
            float dist = Vector3.Distance(a, b);
            f.a = a; f.b = b;
            f.life = time ?? Mathf.Max(0.06f, dist / 40f);
            f.arc = arc ?? Mathf.Min(2, dist * 0.04f);
            f.stick = stick; f.onHit = onHit; f.landed = false; f.age = 0;
            Place(f, 0);
            f.go.SetActive(true);
        }

        static Vector3 ArrowPos(Item f, float u) =>
            new(f.a.x + (f.b.x - f.a.x) * u, f.a.y + (f.b.y - f.a.y) * u + f.arc * 4 * u * (1 - u), f.a.z + (f.b.z - f.a.z) * u);

        static void Place(Item f, float u)
        {
            var p = ArrowPos(f, u);
            var ahead = u >= 0.98f ? p + (p - ArrowPos(f, 0.96f)) : ArrowPos(f, Mathf.Min(1, u + 0.02f));
            f.go.transform.position = p;
            if ((ahead - p).sqrMagnitude > 1e-8f) f.go.transform.rotation = Quaternion.LookRotation(ahead - p);
        }

        /// Запустить fn через sec секунд.
        public void Later(float sec, Action fn)
        {
            if (sec <= 0) fn();
            else timers.Add((sec, fn));
        }

        /// Грозовое поле: каждые 0.5 с три молнии с неба в случайные точки круга.
        public void StormZone(Vector3 p, float r, float dur)
        {
            for (float t = 0.2f; t < dur; t += 0.5f)
                Later(t, () =>
                {
                    for (int k = 0; k < 3; k++)
                    {
                        float a = UnityEngine.Random.value * Mathf.PI * 2;
                        float rr = Mathf.Sqrt(UnityEngine.Random.value) * r * 0.9f;
                        float px = p.x + Mathf.Cos(a) * rr, pz = p.z + Mathf.Sin(a) * rr;
                        Vfx.I?.Lightning(new Vector3(px + 0.6f, p.y + 9, pz), new Vector3(px, p.y + 0.15f, pz), p.y, 0.3f);
                    }
                });
        }

        /// Ноги героя id (для следящих эффектов) или null.
        public static Vector3? HeroFeet(string id) =>
            id != null && WorldSync.Players.TryGetValue(id, out var pv) && pv ? pv.transform.position : null;

        /// Аура исцеления: каждые 0.5 с — зелёные искры всплывают в случайных точках круга вокруг героя.
        public void HealSparkles(string id, float r, float dur)
        {
            for (float t = 0; t < dur; t += 0.5f)
                Later(t, () =>
                {
                    var at = HeroFeet(id);
                    if (at == null) return;
                    float a = UnityEngine.Random.value * Mathf.PI * 2, rr = UnityEngine.Random.value * r * 0.8f;
                    Vfx.I?.Burst(at.Value + new Vector3(Mathf.Cos(a) * rr, 0.2f, Mathf.Sin(a) * rr), FxColors.Heal, count: 10, speed: 1.2f, life: 1.1f, grav: -2.2f, size: 0.2f);
                });
        }

        /// Вихрь: каждые 0.4 с — кольцо искр вокруг героя id.
        public void SpinSparks(string id, float r, Color color, float dur)
        {
            for (float t = 0; t < dur; t += 0.4f)
                Later(t, () =>
                {
                    var at = HeroFeet(id);
                    if (at == null) return;
                    Vfx.I?.Burst(at.Value + Vector3.up, color, count: 16, speed: r * 2.4f, life: 0.3f, grav: 2, size: 0.18f, dir: new Vector3(1, 0, 0), spread: 1);
                });
        }

        void Update()
        {
            float dt = Time.deltaTime;
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
            foreach (var r in rings)
            {
                if (!Tick(r, dt)) continue;
                float t = r.age / r.life, rr = r.r0 + (r.r1 - r.r0) * Mathf.Sqrt(t);
                r.go.transform.localScale = new Vector3(rr, 1 + 2 * (1 - t), rr);
                SetC(r.mat, r.color, r.alpha * (1 - t));
            }
            foreach (var d in domes)
            {
                if (!Tick(d, dt)) continue;
                float t = d.age / d.life, rr = d.r0 + (d.r1 - d.r0) * Mathf.Sqrt(t);
                d.go.transform.localScale = new Vector3(rr, rr * 0.5f, rr);
                SetC(d.mat, d.color, d.alpha * (1 - t));
            }
            foreach (var s in streaks)
            {
                if (!Tick(s, dt)) continue;
                float t = s.age / s.life;
                var sc = s.go.transform.localScale;
                s.go.transform.localScale = new Vector3(s.width * (1 - 0.6f * t), 1, sc.z);
                SetC(s.mat, s.color, 0.85f * (1 - t));
            }
            foreach (var s in seals)
            {
                if (!Tick(s, dt)) { if (s.age >= s.life && s.glow.activeSelf) s.glow.SetActive(false); continue; }
                float fade = Mathf.Min(1, s.age / 0.3f) * Mathf.Min(1, (s.life - s.age) / 0.6f);
                s.go.transform.Rotate(0, dt * 0.6f * Mathf.Rad2Deg, 0);
                SetC(s.mat, s.color, 0.75f * fade);
                float br = 1 + 0.04f * Mathf.Sin(s.age * 4);
                s.glow.transform.localScale = new Vector3(s.radius * br, s.radius * 0.35f * br, s.radius * br);
                SetC(s.glowMat, s.color * 0.5f, 0.1f * fade);
            }
            foreach (var g in ghosts)
            {
                if (g.age >= g.life) continue;
                g.age += dt;
                if (g.age < 0) continue;
                if (g.age >= g.life) { g.go.SetActive(false); continue; }
                float t = g.age / g.life;
                g.go.transform.localScale = new Vector3(0.7f * (1 - 0.5f * t), 1.5f * (1 - 0.3f * t), 0.7f * (1 - 0.5f * t));
                SetC(g.mat, FxColors.ShadowDark * 0.5f, 0.55f * (1 - t));
            }
            foreach (var f in arrows)
            {
                if (!f.go.activeSelf) continue;
                f.age += dt;
                if (!f.landed)
                {
                    float u = Mathf.Min(1, f.age / f.life);
                    Place(f, u);
                    if (u >= 1)
                    {
                        f.landed = true;
                        f.age = 0;
                        try { f.onHit?.Invoke(); } catch (Exception e) { Debug.LogException(e); }
                        if (f.stick <= 0) f.go.SetActive(false);
                    }
                }
                else if (f.age >= f.stick) f.go.SetActive(false);
            }
        }

        static bool Tick(Item it, float dt)
        {
            if (it.age >= it.life) return false;
            it.age += dt;
            if (it.age >= it.life) { it.go.SetActive(false); return false; }
            return true;
        }

        // ---- меши и текстура печати ----

        static Mesh Torus(float R, float r, int seg, int side)
        {
            var v = new List<Vector3>();
            var t = new List<int>();
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                var c = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                for (int j = 0; j <= side; j++)
                {
                    float b = j * Mathf.PI * 2 / side;
                    v.Add(c * (R + Mathf.Cos(b) * r) + Vector3.up * Mathf.Sin(b) * r);
                    if (i < seg && j < side)
                    {
                        int k = i * (side + 1) + j, n = k + side + 1;
                        t.AddRange(new[] { k, n, n + 1, k, n + 1, k + 1 });
                    }
                }
            }
            var m = new Mesh { vertices = v.ToArray(), triangles = t.ToArray() };
            m.RecalculateBounds();
            return m;
        }

        static Mesh SphereBand(int seg, float maxLat)
        {
            var v = new List<Vector3>();
            var t = new List<int>();
            int rows = seg;
            for (int i = 0; i <= rows; i++)
            {
                float lat = Mathf.Lerp(maxLat, Mathf.PI / 2, i / (float)rows);
                for (int j = 0; j <= seg * 2; j++)
                {
                    float lon = j * Mathf.PI / seg;
                    v.Add(new Vector3(Mathf.Cos(lat) * Mathf.Cos(lon), Mathf.Sin(lat), Mathf.Cos(lat) * Mathf.Sin(lon)));
                    if (i < rows && j < seg * 2)
                    {
                        int k = i * (seg * 2 + 1) + j, n = k + seg * 2 + 1;
                        t.AddRange(new[] { k, n, n + 1, k, n + 1, k + 1 });
                    }
                }
            }
            var m = new Mesh { vertices = v.ToArray(), triangles = t.ToArray() };
            m.RecalculateBounds();
            return m;
        }

        static Mesh HalfSphere(int seg) => SphereBand(seg, 0);
        static Mesh Sphere(int seg) => SphereBand(seg, -Mathf.PI / 2);

        static Mesh Disc(int seg)
        {
            var v = new List<Vector3> { Vector3.zero };
            var uv = new List<Vector2> { new(0.5f, 0.5f) };
            var t = new List<int>();
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                v.Add(new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)));
                uv.Add(new Vector2(0.5f + Mathf.Cos(a) * 0.5f, 0.5f + Mathf.Sin(a) * 0.5f));
                if (i < seg) t.AddRange(new[] { 0, i + 2, i + 1 });
            }
            var m = new Mesh { vertices = v.ToArray(), uv = uv.ToArray(), triangles = t.ToArray() };
            m.RecalculateBounds();
            return m;
        }

        /// Знак печати: двойное кольцо, гексаграмма, 12 засечек — белым по прозрачному (sealTexture в вебе).
        static Texture2D SealTexture()
        {
            const int S = 256;
            var px = new Color32[S * S];
            float cx = S / 2f;
            void Dot(float x, float y, float w)
            {
                int r = Mathf.CeilToInt(w / 2);
                for (int dy = -r; dy <= r; dy++)
                    for (int dx = -r; dx <= r; dx++)
                    {
                        int ix = (int)x + dx, iy = (int)y + dy;
                        if (ix < 0 || iy < 0 || ix >= S || iy >= S || dx * dx + dy * dy > r * r) continue;
                        px[iy * S + ix] = new Color32(255, 255, 255, 255);
                    }
            }
            void Line(float x0, float y0, float x1, float y1, float w)
            {
                int n = Mathf.CeilToInt(Mathf.Max(Mathf.Abs(x1 - x0), Mathf.Abs(y1 - y0)));
                for (int i = 0; i <= n; i++) Dot(Mathf.Lerp(x0, x1, i / (float)n), Mathf.Lerp(y0, y1, i / (float)n), w);
            }
            void Circle(float rad, float w)
            {
                for (int i = 0; i < 720; i++) { float a = i * Mathf.PI / 360; Dot(cx + Mathf.Cos(a) * rad, cx + Mathf.Sin(a) * rad, w); }
            }
            Circle(S * 0.46f, 7);
            Circle(S * 0.4f, 3);
            foreach (var off in new[] { 0f, Mathf.PI / 3 })
                for (int i = 0; i < 3; i++)
                {
                    float a0 = off + i * Mathf.PI * 2 / 3 - Mathf.PI / 2, a1 = off + (i + 1) * Mathf.PI * 2 / 3 - Mathf.PI / 2;
                    Line(cx + Mathf.Cos(a0) * S * 0.38f, cx + Mathf.Sin(a0) * S * 0.38f, cx + Mathf.Cos(a1) * S * 0.38f, cx + Mathf.Sin(a1) * S * 0.38f, 5);
                }
            for (int i = 0; i < 12; i++)
            {
                float a = i * Mathf.PI * 2 / 12;
                Line(cx + Mathf.Cos(a) * S * 0.41f, cx + Mathf.Sin(a) * S * 0.41f, cx + Mathf.Cos(a) * S * 0.455f, cx + Mathf.Sin(a) * S * 0.455f, 4);
            }
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true) { name = "sealTex", wrapMode = TextureWrapMode.Clamp };
            tex.SetPixels32(px);
            tex.Apply(true, true);
            return tex;
        }
    }
}
