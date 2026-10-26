using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Эффекты умений на земле — как client/ui/SkillFx.ts и HealAuraFx.ts: телеграф (круг заполняется за
    /// время замаха и вспыхивает), расходящееся кольцо, зона на время действия, конус/полоса (дыхание, рывок),
    /// град стрел. Меши с неосвещённым прозрачным материалом (шаблоны — в SliceAssets, чтобы шейдер был в сборке).
    public class GroundFx : MonoBehaviour
    {
        static GroundFx inst;
        static GroundFx I => inst ? inst : inst = new GameObject("GroundFx").AddComponent<GroundFx>();

        public static readonly Color Stun = new(1f, 0.16f, 0.1f);
        public static readonly Color HealC = new(0.4f, 1f, 0.5f);
        public static readonly Color Spore = new(0.55f, 0.9f, 0.25f);
        public static readonly Color FireC = new(1f, 0.42f, 0.12f);
        public static readonly Color Ice = new(0.55f, 0.85f, 1f);
        public static readonly Color Gold = new(1f, 0.88f, 0.3f);

        enum Kind { Telegraph, Ring, Zone, Strip, Arrow }

        class Fx
        {
            public Kind kind;
            public Vector3 at;
            public Mesh outerMesh, innerMesh;
            public Vector3[] outerBase, innerBase;
            public Transform tr, inner;
            public Renderer rend, innerRend;
            public float born, windup, life, r;
            public Color color;
            public Vector3 vel;
        }

        readonly List<Fx> live = new();
        Mesh disc, annulus, quad, arrow;
        MaterialPropertyBlock mpb;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        static Material Alpha => ZoneNet.I && ZoneNet.I.Assets ? ZoneNet.I.Assets.unlitAlpha : null;
        static Material Add => ZoneNet.I && ZoneNet.I.Assets ? ZoneNet.I.Assets.unlitAdd : null;
        static Material Lit => ZoneNet.I && ZoneNet.I.Assets ? ZoneNet.I.Assets.litTemplate : null;

        void Awake()
        {
            inst = this;
            mpb = new MaterialPropertyBlock();
            disc = Ring(0f, 1f, 64);
            annulus = Ring(0.9f, 1f, 64);
            quad = new Mesh { vertices = new[] { new Vector3(-0.5f, 0, 0), new Vector3(0.5f, 0, 0), new Vector3(0.5f, 0, 1), new Vector3(-0.5f, 0, 1) }, triangles = new[] { 0, 2, 1, 0, 3, 2 } };
            quad.RecalculateBounds();
            var a = GameObject.CreatePrimitive(PrimitiveType.Cube);
            arrow = a.GetComponent<MeshFilter>().sharedMesh;
            Destroy(a);
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
                    t.AddRange(new[] { k, k + 1, k + 3, k, k + 3, k + 2 });
                }
            }
            var m = new Mesh { vertices = v.ToArray(), triangles = t.ToArray() };
            m.RecalculateBounds();
            return m;
        }

        (Transform, Renderer) Make(Mesh mesh, Material mat, string name)
        {
            var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(transform, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            return (go.transform, r);
        }

        Fx New(Kind k, Vector3 at, float r, float windup, float life, Color c, Mesh outer, Mesh innerMesh)
        {
            if (!Alpha) return null;
            bool drape = k != Kind.Strip;
            // Круги ложатся по рельефу: у каждого эффекта своя копия меша, высоты вершин — с земли.
            var oMesh = drape ? Instantiate(outer) : outer;
            var (tr, rend) = Make(oMesh, k == Kind.Ring ? Add : Alpha, k.ToString());
            tr.position = at;
            var fx = new Fx { kind = k, at = at, tr = tr, rend = rend, born = Time.time, windup = windup, life = life, r = r, color = c };
            if (drape) { fx.outerMesh = oMesh; fx.outerBase = outer.vertices; }
            if (innerMesh)
            {
                var iMesh = Instantiate(innerMesh);
                (fx.inner, fx.innerRend) = Make(iMesh, Alpha, k + "In");
                fx.inner.position = at;
                fx.innerMesh = iMesh;
                fx.innerBase = innerMesh.vertices;
            }
            live.Add(fx);
            return fx;
        }

        // ---------- API ----------

        /// Телеграф удара по площади (stunBash, freezeMark, spikeMark, ultWarn): круг заполняется за windup, потом вспышка.
        public static void Telegraph(Vector3 at, float r, float windup, Color c) =>
            I.New(Kind.Telegraph, at, r, Mathf.Max(0.05f, windup), Mathf.Max(0.05f, windup) + 0.35f, c, I.annulus, I.disc);

        /// Расходящееся кольцо (ultHit, лечение, удар о землю).
        public static void RingOut(Vector3 at, float r, Color c, float life = 0.6f) => I.New(Kind.Ring, at, r, 0, life, c, I.annulus, null);

        /// Зона на время (споры, область града стрел, аура лечения): мягко пульсирует.
        public static void Zone(Vector3 at, float r, float windup, float duration, Color c) =>
            I.New(Kind.Zone, at, r, windup, windup + duration, c, I.annulus, I.disc);

        /// Полоса от (x,z) к (x2,z2) — дыхание/рывок: заливается за windup; hit — вспышка.
        public static void Strip(Vector3 from, Vector3 to, float width, float windup, bool hit, Color c)
        {
            var fx = I.New(Kind.Strip, from, width, hit ? 0 : windup, (hit ? 0 : windup) + 0.35f, c, I.quad, null);
            if (fx == null) return;
            var d = to - from;
            d.y = 0;
            fx.tr.rotation = Quaternion.LookRotation(d.sqrMagnitude > 1e-4f ? d : Vector3.forward);
            fx.tr.localScale = new Vector3(width, 1, d.magnitude);
            fx.tr.position += Vector3.up * 0.08f; // над землёй, без мерцания
        }

        /// Град стрел: зона + падающие стрелы по всей площади, пока идёт действие.
        public static void ArrowRain(Vector3 at, float r, float windup, float duration)
        {
            Zone(at, r, windup, duration, Gold);
            I.StartCoroutine(I.Rain(at, r, windup, duration));
        }

        System.Collections.IEnumerator Rain(Vector3 at, float r, float windup, float duration)
        {
            yield return new WaitForSeconds(windup);
            float end = Time.time + duration;
            while (Time.time < end && Lit)
            {
                for (int i = 0; i < 3; i++)
                {
                    float a = Random.value * Mathf.PI * 2, d = Mathf.Sqrt(Random.value) * r;
                    var p = at + new Vector3(Mathf.Cos(a) * d, 9f, Mathf.Sin(a) * d);
                    var (tr, rend) = Make(arrow, Lit, "arrow");
                    tr.position = p;
                    tr.localScale = new Vector3(0.04f, 0.04f, 0.8f);
                    var vel = new Vector3(Random.Range(-1f, 1f), -22f, Random.Range(-1f, 1f));
                    tr.rotation = Quaternion.LookRotation(vel);
                    mpb.SetColor(BaseColor, new Color(0.35f, 0.25f, 0.15f));
                    rend.SetPropertyBlock(mpb);
                    live.Add(new Fx { kind = Kind.Arrow, tr = tr, rend = rend, born = Time.time, life = 9f / 22f, vel = vel, color = Color.white });
                }
                yield return new WaitForSeconds(0.08f);
            }
        }

        void Update()
        {
            float now = Time.time;
            for (int i = live.Count - 1; i >= 0; i--)
            {
                var f = live[i];
                float age = now - f.born;
                if (age >= f.life || !f.tr)
                {
                    if (f.tr) Destroy(f.tr.gameObject);
                    if (f.inner) Destroy(f.inner.gameObject);
                    if (f.outerMesh) Destroy(f.outerMesh);
                    if (f.innerMesh) Destroy(f.innerMesh);
                    live.RemoveAt(i);
                    continue;
                }
                var c = f.color;
                switch (f.kind)
                {
                    case Kind.Telegraph:
                        {
                            float k = Mathf.Clamp01(age / f.windup);
                            Drape(f.outerMesh, f.outerBase, f.at, f.r, 0.06f);
                            Drape(f.innerMesh, f.innerBase, f.at, f.r * k, 0.05f);
                            bool flashing = age > f.windup;
                            float fade = flashing ? 1f - (age - f.windup) / (f.life - f.windup) : 1f;
                            Tint(f.rend, c, 0.85f * fade);
                            Tint(f.innerRend, c, (flashing ? 0.6f : 0.22f + 0.1f * Mathf.Sin(age * 18f)) * fade);
                            break;
                        }
                    case Kind.Ring:
                        {
                            float t = age / f.life;
                            Drape(f.outerMesh, f.outerBase, f.at, f.r * (0.2f + 0.8f * (1 - (1 - t) * (1 - t))), 0.08f);
                            Tint(f.rend, c, 1f - t);
                            break;
                        }
                    case Kind.Zone:
                        {
                            float grow = Mathf.Clamp01(f.windup > 0 ? age / f.windup : 1);
                            float tail = Mathf.Clamp01((f.life - age) / 0.4f);
                            Drape(f.outerMesh, f.outerBase, f.at, f.r, 0.06f);
                            Drape(f.innerMesh, f.innerBase, f.at, f.r * grow, 0.05f);
                            Tint(f.rend, c, 0.7f * tail);
                            Tint(f.innerRend, c, (0.16f + 0.06f * Mathf.Sin(age * 4f)) * tail);
                            break;
                        }
                    case Kind.Strip:
                        {
                            bool flashing = age > f.windup;
                            float fade = flashing ? 1f - (age - f.windup) / (f.life - f.windup) : Mathf.Clamp01(age / Mathf.Max(0.01f, f.windup));
                            Tint(f.rend, c, flashing ? 0.6f * fade : 0.15f + 0.25f * fade);
                            break;
                        }
                    case Kind.Arrow:
                        f.tr.position += f.vel * Time.deltaTime;
                        break;
                }
            }
        }

        /// Вершины круга радиуса r вокруг at — на высоте земли (+lift): рельеф, под землёй — луч вниз по локации.
        static void Drape(Mesh m, Vector3[] unit, Vector3 at, float r, float lift)
        {
            if (!m) return;
            var t = Terrain.activeTerrain;
            bool under = at.y < -30f; // катакомбы и подземелье лежат глубоко под поляной
            var v = new Vector3[unit.Length];
            for (int i = 0; i < unit.Length; i++)
            {
                float x = at.x + unit[i].x * r, z = at.z + unit[i].z * r;
                float y = at.y;
                if (under) { if (Physics.Raycast(new Vector3(x, at.y + 2f, z), Vector3.down, out var h, 6f)) y = h.point.y; }
                else if (t) y = t.SampleHeight(new Vector3(x, 0, z)) + t.transform.position.y;
                v[i] = new Vector3(unit[i].x * r, y - at.y + lift, unit[i].z * r);
            }
            m.vertices = v;
            m.RecalculateBounds();
        }

        void Tint(Renderer r, Color c, float a)
        {
            if (!r) return;
            c.a = Mathf.Clamp01(a);
            mpb.SetColor(BaseColor, c);
            r.SetPropertyBlock(mpb);
        }
    }
}
