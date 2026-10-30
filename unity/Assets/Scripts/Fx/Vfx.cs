using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Пул эффектов умений — перенос client/ui/SkillVfx.ts: пятна на земле (волна, зона, прицел, сектор),
    /// снопы искр, молнии и столбы света. Шейдеры Zep/Fx* в Assets/Shaders; материалы-шаблоны в SliceAssets,
    /// чтобы шейдеры попали в сборку. Сигнатуры как в вебе — ClassFx переносится почти дословно.
    public class Vfx : MonoBehaviour
    {
        static Vfx inst;
        public static Vfx I
        {
            get
            {
                if (!inst && ZoneNet.I && ZoneNet.I.Assets && ZoneNet.I.Assets.fxDecal)
                    inst = new GameObject("Vfx").AddComponent<Vfx>();
                return inst;
            }
        }

        public enum Follow { None, Hero, Mob }

        class Item
        {
            public GameObject go;
            public Material mat;
            public float age = 1, life = 1, fadeIn, dy, alpha = 1;
            public int mode;
            public bool scorch;
            public Follow fk;
            public string fid;
            /// Слот зарезервирован под зону (mode 1): быстрые волны и вспышки его не занимают.
            public bool zone;
        }

        const int Sparks = 96, BoltSeg = 14;
        /// Unity-версия ярче веба: цвета в HDR, чтобы bloom давал ореол (по просьбе — «красиво и эффектно», не точь-в-точь).
        const float Glow = 2.4f;
        /// Живой свет от крупных вспышек — освещает землю и героев вокруг (в вебе его не было).
        readonly List<(Light l, float age, float life, float peak)> flashes = new();
        int nF;
        readonly List<Item> decals = new(), scorches = new(), smokes = new(), sparks = new(), bolts = new(), pillars = new();
        /// Пул декалей РАСТЁТ по требованию: долгие зоны («Печать света» 6 с, «Грозовое поле» 5 с)
        /// раньше затирались другими пятнами (жёсткая ротация 40 слотов) и пропадали раньше срока.
        Mesh decalMesh;
        Material decalTemplate;
        /// Последняя выданная декаль — нужна Cone() (раньше брали по индексу nD-1, а с растущим пулом это неверно).
        Item lastDecal;
        const int DecalMax = 96, ZoneMax = 12;
        int nD, nSc, nSm, nS, nB, nP;
        float time;

        static readonly int DropId = Shader.PropertyToID("_Drop"), Color_ = Shader.PropertyToID("_Color"), T = Shader.PropertyToID("_T"), Mode = Shader.PropertyToID("_Mode"),
            Half = Shader.PropertyToID("_Half"), Alpha = Shader.PropertyToID("_Alpha"), Seed = Shader.PropertyToID("_Seed"),
            Center = Shader.PropertyToID("_Center"), Dir = Shader.PropertyToID("_Dir"), Spread = Shader.PropertyToID("_Spread"),
            Life = Shader.PropertyToID("_Life"), Speed = Shader.PropertyToID("_Speed"), Grav = Shader.PropertyToID("_Grav"),
            Size = Shader.PropertyToID("_Size"), Count = Shader.PropertyToID("_Count"), A = Shader.PropertyToID("_A"),
            B = Shader.PropertyToID("_B"), Width = Shader.PropertyToID("_Width"), Amp = Shader.PropertyToID("_Amp"),
            TimeS = Shader.PropertyToID("_TimeS"), A0 = Shader.PropertyToID("_A0"), A1 = Shader.PropertyToID("_A1"),
            R0 = Shader.PropertyToID("_R0"), Sweep = Shader.PropertyToID("_Sweep"), Prog = Shader.PropertyToID("_Prog");

        /// Форма пятна: поворот (yaw — куда смотрит локальная +Z, как atan2(dx,dz) в вебе), сектор a0..a1 (рад),
        /// внутренний радиус r0 (доля), заливка телеграфа: 0 — от центра к краю, −1 — по углу от a1 к a0.
        public struct Shape
        {
            public float yaw, a0, a1, r0, sweep;
            public static Shape Circle => new() { a0 = -Mathf.PI, a1 = Mathf.PI };
            public static Shape Sector(float yaw, float a0, float a1, float r0 = 0, float sweep = 0) => new() { yaw = yaw, a0 = a0, a1 = a1, r0 = r0, sweep = sweep };
        }

        /// Режимы пятна сверх веба: телеграф с заливкой, лава, гарь, наледь.
        public const int Tele = 6, Lava = 7, Scorch = 8, Frost = 9;

        void Awake()
        {
            var a = ZoneNet.I.Assets;
            // Пятно: квадрат 2×2 в плоскости XZ, uv 0..1.
            var plane = new Mesh
            {
                vertices = new[] { new Vector3(-1, 0, -1), new Vector3(1, 0, -1), new Vector3(1, 0, 1), new Vector3(-1, 0, 1) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) },
                triangles = new[] { 0, 2, 1, 0, 3, 2 },
            };
            plane.RecalculateBounds();
            decalMesh = plane;
            decalTemplate = a.fxDecal;
            for (int i = 0; i < 16; i++) decals.Add(NewDecal(false));
            for (int i = 0; i < 10; i++)
            {
                var sc = Make("scorch", plane, a.fxDecal);
                sc.mat.SetFloat("_SrcB", (float)UnityEngine.Rendering.BlendMode.DstColor);
                sc.mat.SetFloat("_DstB", (float)UnityEngine.Rendering.BlendMode.Zero);
                sc.mat.renderQueue = 2990; // гарь под остальными пятнами
                sc.scorch = true;
                scorches.Add(sc);
            }
            // Искры: Sparks квадов, индекс — во втором uv; границы огромные — вершины двигает шейдер.
            var pos = new List<Vector3>();
            var idx = new List<int>();
            var k2 = new List<Vector2>();
            for (int k = 0; k < Sparks; k++)
            {
                foreach (var (x, y) in new[] { (-0.5f, -0.5f), (0.5f, -0.5f), (0.5f, 0.5f), (-0.5f, 0.5f) })
                {
                    pos.Add(new Vector3(x, y, 0));
                    k2.Add(new Vector2(k, 0));
                }
                idx.AddRange(new[] { k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3 });
            }
            var sm = new Mesh { vertices = pos.ToArray(), triangles = idx.ToArray() };
            sm.SetUVs(1, k2);
            sm.bounds = new Bounds(Vector3.zero, Vector3.one * 1e5f);
            for (int i = 0; i < 96; i++) sparks.Add(Make("sparks", sm, a.fxSparks, world: true));
            for (int i = 0; i < 24; i++)
            {
                var it = Make("smoke", sm, a.fxSparks, world: true);
                it.mat.SetFloat("_Smoke", 1);
                it.mat.SetFloat("_SrcB", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                it.mat.SetFloat("_DstB", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                it.mat.renderQueue = 3005;
                smokes.Add(it);
            }
            // Молния: лента (x — доля, y — сторона).
            var bp = new List<Vector3>();
            var bi = new List<int>();
            for (int s = 0; s <= BoltSeg; s++)
            {
                bp.Add(new Vector3(s / (float)BoltSeg, -1, 0));
                bp.Add(new Vector3(s / (float)BoltSeg, 1, 0));
                if (s > 0)
                {
                    int q = (s - 1) * 2;
                    bi.AddRange(new[] { q, q + 1, q + 3, q, q + 3, q + 2 });
                }
            }
            var bm = new Mesh { vertices = bp.ToArray(), triangles = bi.ToArray(), bounds = new Bounds(Vector3.zero, Vector3.one * 1e5f) };
            for (int i = 0; i < 24; i++) bolts.Add(Make("bolt", bm, a.fxBolt, world: true));
            // Столб: открытый цилиндр высотой 1, радиусом 1, v — по высоте.
            var cv = new List<Vector3>();
            var cuv = new List<Vector2>();
            var ci = new List<int>();
            const int tess = 24;
            for (int s = 0; s <= tess; s++)
            {
                float an = s * Mathf.PI * 2 / tess;
                var d = new Vector3(Mathf.Cos(an), 0, Mathf.Sin(an));
                cv.Add(d + Vector3.down * 0.5f); cuv.Add(new Vector2(s / (float)tess, 0));
                cv.Add(d + Vector3.up * 0.5f); cuv.Add(new Vector2(s / (float)tess, 1));
                if (s < tess)
                {
                    int q = s * 2;
                    ci.AddRange(new[] { q, q + 1, q + 3, q, q + 3, q + 2 });
                }
            }
            var cm = new Mesh { vertices = cv.ToArray(), uv = cuv.ToArray(), triangles = ci.ToArray() };
            cm.RecalculateBounds();
            for (int i = 0; i < 6; i++) pillars.Add(Make("pillar", cm, a.fxPillar));
            for (int i = 0; i < 8; i++)
            {
                var l = new GameObject("vfx_flash").AddComponent<Light>();
                l.transform.SetParent(transform, false);
                l.type = LightType.Point;
                l.shadows = LightShadows.None;
                l.enabled = false;
                flashes.Add((l, 1, 1, 0));
            }
        }

        Item NewDecal(bool zone)
        {
            var d = Make("decal", decalMesh, decalTemplate);
            d.zone = zone;
            return d;
        }

        /// Слот под декаль: свободный → новый (до DecalMax) → самый старый из своего вида.
        Item TakeDecal(bool zone)
        {
            int n = decals.Count;
            for (int i = 0; i < n; i++)
            {
                int idx = (nD + i) % n;
                var d = decals[idx];
                if (d.zone != zone) continue; // зоны и обычные пятна не смешиваем
                if (d.age >= d.life) { nD = (idx + 1) % n; return d; }
            }
            int ofKind = 0;
            foreach (var d2 in decals) if (d2.zone == zone) ofKind++;
            int cap = zone ? ZoneMax : DecalMax;
            if (ofKind < cap)
            {
                var fresh = NewDecal(zone);
                decals.Add(fresh);
                return fresh;
            }
            Item oldest = null;
            foreach (var d3 in decals)
                if (d3.zone == zone && (oldest == null || d3.age > oldest.age)) oldest = d3;
            return oldest ?? NewDecal(zone);
        }

        Item Make(string name, Mesh mesh, Material template, bool world = false)
        {
            var go = new GameObject("vfx_" + name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            // Свой материал на элемент пула создаём один раз здесь — в горячем пути ничего не клонируем.
            var it = new Item { go = go, mat = new Material(template) };
            r.sharedMaterial = it.mat;
            go.SetActive(false);
            return it;
        }

        public static Vector3 FollowPos(Follow k, string id)
        {
            if (k == Follow.Hero && id != null && WorldSync.Players.TryGetValue(id, out var p) && p) return p.transform.position;
            // Моб — над головой (fxFollow в вебе: y + bodyRadius·scale·2).
            if (k == Follow.Mob && id != null && WorldSync.Mobs.TryGetValue(id, out var m) && m && m.state != null && m.state.dead == 0)
                return m.transform.position + Vector3.up * (ZoneNet.I.Assets.bodyRadius * Mathf.Max(0.1f, m.state.scale) * 2);
            return new Vector3(float.NaN, 0, 0);
        }

        /// Ударная волна по земле (mode 0), зона (1, life — длительность), прицел (2), сектор (3), волны без трещин (4, 5).
        public void Decal(Vector3 p, float radius, Color color, float life, int mode = 0, float alpha = 1, Follow fk = Follow.None, string fid = null, float dy = 0, Shape? shape = null)
        {
            Item d;
            if (mode == Scorch) { d = scorches[nSc]; nSc = (nSc + 1) % scorches.Count; }
            else d = TakeDecal(mode == 1);
            lastDecal = d;
            var sh = shape ?? Shape.Circle;
            var tr = d.go.transform;
            // Пятно лежит по склону: наклон по нормали земли под центром (мишени на мобах — ровно).
            tr.rotation = (fk == Follow.None ? Tilt(p) : Quaternion.identity) * Quaternion.Euler(0, sh.yaw * Mathf.Rad2Deg, 0);
            tr.position = new Vector3(p.x, p.y + 0.07f + (mode == 2 ? 0 : (nD % 5) * 0.004f), p.z);
            tr.localScale = new Vector3(radius, 1, radius);
            d.mat.SetColor(Color_, color * Glow);
            d.mat.SetFloat(Mode, mode);
            d.mat.SetFloat(Alpha, mode == Scorch ? 0 : alpha);
            d.mat.SetFloat(Seed, Random.value * 50);
            d.mat.SetFloat(T, 0);
            d.mat.SetFloat(Prog, 0);
            d.mat.SetFloat(A0, sh.a0);
            d.mat.SetFloat(A1, sh.a1);
            d.mat.SetFloat(R0, sh.r0);
            d.mat.SetFloat(Sweep, sh.sweep);
            d.age = 0; d.life = life; d.mode = mode; d.fk = fk; d.fid = fid; d.dy = dy; d.alpha = alpha;
            d.fadeIn = mode == 0 || mode == 3 || mode == Tele ? 0 : mode == Scorch ? 0.6f : 0.25f;
            d.go.SetActive(true);
            if ((mode == 0 || mode == 5) && alpha >= 0.8f && radius >= 2.5f && life <= 1.2f) Flash(p + Vector3.up * 1.2f, color, radius * 1.6f, 10, life * 0.7f);
        }

        /// Поворот «вверх → нормаль земли» под точкой (луч по коллайдерам локаций, иначе нормаль рельефа).
        public static Quaternion Tilt(Vector3 p)
        {
            var n = Vector3.up;
            if (Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out var hit, 8f)) n = hit.normal;
            else if (Terrain.activeTerrain)
            {
                var t = Terrain.activeTerrain;
                var lp = p - t.transform.position;
                n = t.terrainData.GetInterpolatedNormal(lp.x / t.terrainData.size.x, lp.z / t.terrainData.size.z);
            }
            if (n.y < 0.3f) n = Vector3.up; // стена или потолок — не кладём на них
            return Quaternion.FromToRotation(Vector3.up, n);
        }

        /// Волна сектором из p в сторону (dx,dz) на radius, полуугол half (рад).
        public void Cone(Vector3 p, float radius, float dx, float dz, float half, Color color, float life = 0.3f, float alpha = 0.5f)
        {
            float l = Mathf.Max(1e-4f, Mathf.Sqrt(dx * dx + dz * dz));
            Decal(p, radius, color, life, 3, alpha);
            var d = lastDecal;
            // Ось сектора в шейдере — локальная +x (uv.x вправо); поворот вокруг Y, чтобы +x смотрела по (dx,dz).
            d.go.transform.rotation = Tilt(p) * Quaternion.Euler(0, Mathf.Atan2(-dz / l, dx / l) * Mathf.Rad2Deg, 0);
            d.mat.SetFloat(Half, half);
        }

        /// Огненное дыхание (дракон): волна по земле, три снопа струи и угли по зоне.
        public void FireBreath(Vector3 p, float x2, float z2, float half, float mouthY = 3)
        {
            float dx = x2 - p.x, dz = z2 - p.z;
            float len = Mathf.Max(1, Mathf.Sqrt(dx * dx + dz * dz));
            float ux = dx / len, uz = dz / len;
            float my = p.y + mouthY;
            Cone(p, len, dx, dz, half, FxColors.FireRed, 0.75f, 1);
            Cone(p + Vector3.up * 0.01f, len * 0.8f, dx, dz, half * 0.5f, FxColors.FireCore, 0.55f, 0.9f);
            var dir = new Vector3(ux, -0.12f, uz);
            var m = new Vector3(p.x + ux, my, p.z + uz);
            Burst(m, FxColors.FireCore, count: 28, speed: len * 1.6f, life: 0.55f, grav: -1, size: 0.55f, dir: dir, spread: half * 0.35f);
            Burst(m, FxColors.Fire, count: 28, speed: len * 1.3f, life: 0.7f, grav: -2, size: 0.7f, dir: dir, spread: half * 0.65f);
            Burst(m, FxColors.FireRed, count: 24, speed: len * 1.1f, life: 0.8f, grav: -3, size: 0.8f, dir: dir, spread: half);
            foreach (var f in new[] { 0.35f, 0.65f, 0.95f })
                Burst(new Vector3(p.x + ux * len * f, p.y + 0.2f, p.z + uz * len * f), FxColors.Fire, count: 14, speed: 2.2f, life: 1.2f, grav: -2.5f, size: 0.22f);
        }

        /// Сноп искр: dir — направление (null — во все стороны), spread 0..1, grav > 0 — падают, < 0 — всплывают.
        public void Burst(Vector3 p, Color color, int count = 20, float speed = 5, float life = 0.6f, float size = 0.22f, float grav = 9, Vector3? dir = null, float spread = 1, bool smoke = false, bool drop = false)
        {
            Item s;
            if (drop) smoke = true; // капли — из пула дыма (обычное смешивание), режим _Drop
            if (smoke) { s = smokes[nSm]; nSm = (nSm + 1) % smokes.Count; }
            else { s = sparks[nS]; nS = (nS + 1) % sparks.Count; }
            s.mat.SetVector(Center, p);
            s.mat.SetVector(Dir, dir ?? Vector3.zero);
            s.mat.SetFloat(Spread, spread);
            s.mat.SetFloat(Life, life);
            s.mat.SetFloat(Speed, speed);
            s.mat.SetFloat(Grav, grav);
            s.mat.SetFloat(Size, size);
            s.mat.SetFloat(Seed, Random.value * 50);
            s.mat.SetFloat(Count, Mathf.Min(Sparks, count));
            s.mat.SetColor(Color_, smoke ? color : color * Glow);
            if (smoke) s.mat.SetFloat(DropId, drop ? 1 : 0);
            s.mat.SetFloat(T, 0);
            s.age = 0; s.life = life;
            s.go.SetActive(true);
            if (!smoke && count * size >= 6) Flash(p, color, 4 + count * size * 0.6f, 6 + count * size * 0.5f, Mathf.Min(0.6f, life));
        }

        /// Вспышка света: быстро загорается и гаснет за life с.
        public void Flash(Vector3 p, Color color, float range, float intensity, float life)
        {
            var f = flashes[nF];
            nF = (nF + 1) % flashes.Count;
            f.l.transform.position = p;
            f.l.color = color;
            f.l.range = range;
            f.l.intensity = 0;
            f.l.enabled = true;
            flashes[(nF + flashes.Count - 1) % flashes.Count] = (f.l, 0, life, intensity);
        }

        /// Молния из a в b на life с.
        public void Bolt(Vector3 a, Vector3 b, Color color, float life = 0.3f, float width = 0.08f)
        {
            var it = bolts[nB];
            nB = (nB + 1) % bolts.Count;
            it.mat.SetVector(A, a);
            it.mat.SetVector(B, b);
            it.mat.SetFloat(Width, width);
            it.mat.SetFloat(Amp, Mathf.Min(1.2f, Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z)) * 0.12f + 0.2f));
            it.mat.SetFloat(Seed, Random.value * 50);
            it.mat.SetColor(Color_, color * Glow * 1.3f);
            it.mat.SetFloat(Alpha, 1);
            it.age = 0; it.life = life;
            it.go.SetActive(true);
        }

        /// Молния атаки: толстый ствол + белое ядро, вспышка на земле (если известна groundY) и снопы искр.
        public void Lightning(Vector3 a, Vector3 b, float? groundY, float life = 0.35f)
        {
            Bolt(a, b, FxColors.Lightning, life, 0.2f);
            Flash(b + Vector3.up * 0.8f, FxColors.LightningCore, 14, 30, life);
            Bolt(a, b, FxColors.LightningCore, life * 0.8f, 0.07f);
            if (groundY.HasValue) Decal(new Vector3(b.x, groundY.Value, b.z), 1.6f, FxColors.Lightning, 0.35f, 0, 1.3f);
            Burst(b, FxColors.Lightning, count: 6, speed: 0.6f, life: 0.2f, grav: 0, size: 0.9f);
            Burst(b, FxColors.Lightning, count: 20, speed: 6, life: 0.45f, grav: 8, size: 0.26f);
            Burst(b, FxColors.LightningCore, count: 8, speed: 3, life: 0.25f, grav: 0, size: 0.4f);
        }

        /// Метка на мобе одна: новая снимает прежние круг и столб на этом мобе.
        public void EndMobMarks(string mobId)
        {
            foreach (var l in new[] { decals, pillars })
                foreach (var d in l)
                    if (d.fk == Follow.Mob && d.fid == mobId && d.age < d.life) { d.life = d.age; d.go.SetActive(false); }
        }

        /// Столб света высотой h, радиус r; follow — держится над героем/мобом.
        public void Pillar(Vector3 p, float r, float h, Color color, float life, Follow fk = Follow.None, string fid = null)
        {
            var it = pillars[nP];
            nP = (nP + 1) % pillars.Count;
            it.go.transform.position = new Vector3(p.x, p.y + h / 2, p.z);
            it.go.transform.localScale = new Vector3(r, h, r);
            it.mat.SetColor(Color_, color * Glow);
            it.mat.SetFloat(Alpha, 0);
            it.age = 0; it.life = life; it.fk = fk; it.fid = fid;
            it.go.SetActive(true);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            time += dt;
            for (int i = 0; i < flashes.Count; i++)
            {
                var (l, age, life, peak) = flashes[i];
                if (!l.enabled) continue;
                age += dt;
                if (age >= life) { l.enabled = false; continue; }
                // Вспыхивает за 0.05 с, гаснет к концу (квадрат — быстрый спад, как у взрыва).
                float k = age < 0.05f ? age / 0.05f : Mathf.Pow(1 - (age - 0.05f) / Mathf.Max(0.01f, life - 0.05f), 2);
                l.intensity = peak * k;
                flashes[i] = (l, age, life, peak);
            }
            foreach (var list in new[] { decals, scorches })
            foreach (var d in list)
            {
                if (d.age >= d.life) continue;
                d.age += dt;
                if (d.age >= d.life) { d.go.SetActive(false); continue; }
                if (d.fk != Follow.None)
                {
                    var at = FollowPos(d.fk, d.fid);
                    if (!float.IsNaN(at.x)) d.go.transform.position = at + Vector3.up * d.dy;
                    else { d.fk = Follow.None; d.life = Mathf.Min(d.life, d.age + 0.3f); }
                }
                if (d.mode == 0 || d.mode == 3 || d.mode == 5) d.mat.SetFloat(T, d.age / d.life);
                else
                {
                    d.mat.SetFloat(T, d.age);
                    // Телеграф: заливка к удару, к концу не гаснет (гаснет за 0.08 с, когда удар уже есть).
                    if (d.mode == Tele) { d.mat.SetFloat(Prog, d.age / d.life); d.mat.SetFloat(Alpha, d.alpha * Mathf.Min(1, (d.life - d.age) / 0.08f)); continue; }
                    float fade = (d.fadeIn > 0 ? Mathf.Min(1, d.age / d.fadeIn) : 1) * Mathf.Min(1, (d.life - d.age) / (d.mode == Scorch ? 2f : 0.4f));
                    // Веб затирал alpha в этих режимах; здесь держим заданную — тусклые следы остаются тусклыми.
                    d.mat.SetFloat(Alpha, fade * (d.mode >= Lava ? d.alpha : 1));
                }
            }
            foreach (var list in new[] { sparks, smokes })
            foreach (var s in list)
            {
                if (s.age >= s.life) continue;
                s.age += dt;
                if (s.age >= s.life) s.go.SetActive(false);
                else s.mat.SetFloat(T, s.age);
            }
            foreach (var b in bolts)
            {
                if (b.age >= b.life) continue;
                b.age += dt;
                if (b.age >= b.life) { b.go.SetActive(false); continue; }
                b.mat.SetFloat(TimeS, time);
                b.mat.SetFloat(Alpha, 1 - Mathf.Pow(b.age / b.life, 2));
            }
            foreach (var p in pillars)
            {
                if (p.age >= p.life) continue;
                p.age += dt;
                if (p.age >= p.life) { p.go.SetActive(false); continue; }
                if (p.fk != Follow.None)
                {
                    var at = FollowPos(p.fk, p.fid);
                    if (!float.IsNaN(at.x)) p.go.transform.position = at + Vector3.up * (p.go.transform.localScale.y / 2);
                    else { p.fk = Follow.None; p.life = Mathf.Min(p.life, p.age + 0.3f); }
                }
                p.mat.SetFloat(TimeS, time);
                p.mat.SetFloat(Alpha, Mathf.Min(1, p.age / 0.15f) * Mathf.Min(1, (p.life - p.age) / 0.35f) * 0.8f);
            }
        }
    }

    /// FX_RGB и прочие цвета эффектов из client/ui/SkillVfx.ts.
    public static class FxColors
    {
        public static readonly Color Attack = new(1, .22f, .14f), Heal = new(.4f, 1, .5f), Defense = new(.35f, .6f, 1),
            Buff = new(1, .55f, .12f), Other = new(1, .88f, .3f), Shadow = new(.62f, .62f, .66f), ShadowDark = new(.35f, .2f, .6f),
            Lightning = new(.3f, .55f, 1), LightningCore = new(.85f, .93f, 1), FireCore = new(1, .9f, .45f), Fire = new(1, .42f, .12f),
            FireRed = new(1, .18f, .06f), Stun = new(1, .16f, .1f), Blood = new(.9f, .06f, .06f), Reflect = new(.62f, .86f, 1),
            Poison = new(.72f, .28f, 1), Venom = new(.5f, 1, .1f), Arcane = new(.72f, .42f, 1), Gold = new(1, .78f, .3f),
            Moon = new(.78f, .87f, 1), Holy = new(.55f, 1, .75f), IceRim = new(.86f, .97f, 1), Frost = new(.6f, .86f, 1),
            ReflectBolt = new(1, .16f, .1f);
        public static readonly Color[] Ult = { new(1, .14f, .12f), Heal, new(.25f, .55f, 1), new(1, .9f, .2f), new(1, .55f, .12f), new(.7f, .3f, 1) };
    }
}
