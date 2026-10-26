using System.Collections.Generic;
using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Камеры катакомб, рейда и башни — перенос SpectatorCamera.ts (catTop / catGate / catBoss,
    /// raidWide / raidHero / raidBoss / raidTop, towerApproach и удержание камеры в зале башни).
    public partial class SpectatorDirector
    {
        // shared/catacombs.ts: залы (z от CAT_Z0), коридоры между ними, свод.
        static readonly (float x, float dz, float r)[] CatHallsRaw =
        {
            (0, 30, 22), (-32, 98, 25), (32, 98, 25), (-60, 168, 24), (0, 168, 24), (60, 168, 24), (0, 246, 30),
        };
        static readonly (int a, int b)[] CatLinks = { (0, 1), (0, 2), (1, 3), (1, 4), (2, 4), (2, 5), (3, 6), (4, 6), (5, 6) };
        const float CatCorridorHalf = 4.5f, CatCeil = 16;
        const int CatPhaseRun = 2;
        // Камера катакомб (CAT_CAM, CAT_GATE_CAM).
        const float CatCamHeight = 5.2f, CatCamHeightPerSpread = 0.22f, CatCamBackPerHeight = 1.1f, CatCamMobNear = 9, CatCamBossFit = 0.6f;
        const float GateBack = 7, GateHeight = 3.4f, GateAhead = 14, GateLookY = 1.3f, GateFollow = 1.6f;
        // Рейд (RAID, RAID_CAM).
        static readonly Vector2 RaidC = new(-84, -219);
        const float RaidHold = 6.5f, RaidBlend = 1.6f, RaidWideOut = 14, RaidWideH = 15, RaidTopH = 42, RaidHeroBack = 7, RaidHeroUp = 3.2f;
        static readonly string[] RaidOrder = { "raidWide", "raidHero", "raidBoss", "raidTop", "raidHero" };
        // Подлёт к декоративной башне (TOWER_PROP_POS и константы подлёта).
        static readonly Vector2 TowerProp = new(34, 83);
        const float TowerApproachDur = 2.3f;

        struct Hall { public float x, z, r; }
        struct Corridor { public int a, b; public float ax, az, dx, dz, len; }

        class CatCtx
        {
            public Hall hall;
            public int lo, hi, from, to;
            public List<int> open = new();
            public string bossId = "";
            public bool final;
            public readonly List<string> heroes = new();
        }

        class RaidCtx
        {
            public float edge;
            public string bossId = "";
            public readonly List<string> heroes = new();
        }

        Hall[] halls;
        Corridor[] corridors;
        CatCtx cat;
        RaidCtx raid;
        float catFov = DefaultFov;
        Vector3 catTopC;
        float catTopH = 6, catTopBossMix;
        bool catTopInit;
        string catGateKey = "";
        float catGateS;
        int raidIdx;
        float towerApproachStart;

        void InitCat()
        {
            if (halls != null) return;
            halls = new Hall[CatHallsRaw.Length];
            for (int i = 0; i < halls.Length; i++)
                halls[i] = new Hall { x = CatHallsRaw[i].x, z = cfg.cat.z0 + CatHallsRaw[i].dz, r = CatHallsRaw[i].r };
            corridors = new Corridor[CatLinks.Length];
            for (int i = 0; i < CatLinks.Length; i++)
            {
                var A = halls[CatLinks[i].a];
                var B = halls[CatLinks[i].b];
                float L = Mathf.Sqrt((B.x - A.x) * (B.x - A.x) + (B.z - A.z) * (B.z - A.z));
                float dx = (B.x - A.x) / L, dz = (B.z - A.z) / L, s0 = A.r - 2, s1 = L - B.r + 2;
                corridors[i] = new Corridor { a = CatLinks[i].a, b = CatLinks[i].b, ax = A.x + dx * s0, az = A.z + dz * s0, dx = dx, dz = dz, len = s1 - s0 };
            }
        }

        int CatLinkIndex(int a, int b)
        {
            for (int i = 0; i < CatLinks.Length; i++)
                if (CatLinks[i].a == a && CatLinks[i].b == b || CatLinks[i].a == b && CatLinks[i].b == a) return i;
            return -1;
        }

        /// Ближайшая точка внутри открытых залов и коридоров между ними, с отступом pad от стен (catProject).
        Vector2 CatProject(float x, float z, List<int> open, float pad)
        {
            float bx = x, bz = z, bd = float.PositiveInfinity;
            bool Take(float px, float pz)
            {
                float d = (px - x) * (px - x) + (pz - z) * (pz - z);
                if (d < bd) { bd = d; bx = px; bz = pz; }
                return d < 1e-9f;
            }
            foreach (var i in open)
            {
                var h = halls[i];
                float r = h.r - pad, dx = x - h.x, dz = z - h.z, d = Mathf.Sqrt(dx * dx + dz * dz);
                if (d <= r) return new Vector2(x, z);
                if (d < 1e-6f) d = 1;
                Take(h.x + dx / d * r, h.z + dz / d * r);
            }
            float w = CatCorridorHalf - pad;
            foreach (var c in corridors)
            {
                if (!open.Contains(c.a) || !open.Contains(c.b)) continue;
                float rx = x - c.ax, rz = z - c.az;
                float s = Mathf.Clamp(rx * c.dx + rz * c.dz, 0, c.len);
                float t = Mathf.Clamp(rx * c.dz - rz * c.dx, -w, w);
                if (Take(c.ax + c.dx * s + c.dz * t, c.az + c.dz * s - c.dx * t)) return new Vector2(x, z);
            }
            return new Vector2(bx, bz);
        }

        bool InCat(float x, float z) => z > cfg.cat.z0 && Mathf.Abs(x) < cfg.cat.halfX;

        void BuildArenas(ZoneState st)
        {
            InitCat();
            cat = null;
            raid = null;
            if (st == null) return;
            if (st.catPhase >= CatPhaseRun)
            {
                var route = new List<int>();
                foreach (var part in (st.catRoute ?? "").Split(','))
                    if (int.TryParse(part, out int n) && n >= 0 && n < halls.Length) route.Add(n);
                if (route.Count == 0) route.Add(0);
                int At(int i) => i >= 0 && i < route.Count ? route[i] : 0;
                var c = new CatCtx { lo = st.catLo, hi = st.catHi, from = At(st.catLo), to = At(st.catHi), final = st.catFinal == 1 };
                c.hall = halls[c.to];
                for (int i = Mathf.Max(0, c.lo); i <= c.hi && i < route.Count; i++) c.open.Add(route[i]);
                if (c.open.Count == 0) c.open.Add(route[0]);
                if (!string.IsNullOrEmpty(st.catBoss) && st.mobs.TryGetValue(st.catBoss, out var bm) && bm.dead == 0) c.bossId = st.catBoss;
                foreach (var kv in WorldSync.Players)
                    if (kv.Value && kv.Value.state.dead == 0 && InCat(kv.Value.Head.x, kv.Value.Head.z)) c.heroes.Add(kv.Key);
                cat = c;
            }
            if (st.raid != null && st.raid.ph != 0)
            {
                var r = new RaidCtx { edge = st.raid.edge };
                foreach (var kv in WorldSync.Mobs)
                {
                    var m = kv.Value.state;
                    if (m.dead == 0 && Mathf.Abs(m.x - RaidC.x) < 2 && Mathf.Abs(m.z - RaidC.y) < 2) { r.bossId = kv.Key; break; }
                }
                foreach (var kv in WorldSync.Players)
                {
                    var h = kv.Value.Head;
                    if (kv.Value.state.dead == 0 && Vector2.Distance(new Vector2(h.x, h.z), RaidC) < r.edge) r.heroes.Add(kv.Key);
                }
                raid = r;
            }
        }

        /// Авто-режиссёр в катакомбах и на рейде: true — кадр выбран здесь.
        bool ArenaDirect(bool invalid)
        {
            if (!auto) return false;
            if (cat != null)
            {
                // Решётка поднята (lo < hi) — камера идёт с отрядом сквозь ворота; иначе — одна камера на бой сверху.
                var want = cat.lo < cat.hi ? "catGate" : "catTop";
                if (shot.kind != want) SwitchTo(new Shot { kind = want });
                return true;
            }
            if (raid != null && !botsOnly)
            {
                if (!shot.kind.StartsWith("raid") || invalid || sinceSwitch >= RaidHold)
                {
                    SwitchTo(NextRaidShot());
                    curBlend = RaidBlend;
                }
                return true;
            }
            return false;
        }

        Shot NextRaidShot()
        {
            for (int i = 0; i < RaidOrder.Length; i++)
            {
                var k = RaidOrder[raidIdx++ % RaidOrder.Length];
                if (k == "raidHero")
                {
                    var ids = raid.heroes.FindAll(id => players.Exists(p => p.id == id));
                    if (ids.Count == 0) continue;
                    return new Shot { kind = "raidHero", id = ids[Random.Range(0, ids.Count)] };
                }
                if (k == "raidBoss" && !(raid.bossId != "" && mobs.Exists(m => m.id == raid.bossId))) continue;
                return new Shot { kind = k };
            }
            return new Shot { kind = "raidWide" };
        }

        Shot ArenaToken(string kind, string id) => kind switch
        {
            "catTop" or "catGate" => cat != null ? new Shot { kind = kind } : null,
            "catBoss" => cat != null && cat.bossId != "" ? new Shot { kind = kind } : null,
            "raidWide" or "raidTop" => raid != null ? new Shot { kind = kind } : null,
            "raidBoss" => raid != null && raid.bossId != "" ? new Shot { kind = kind } : null,
            "raidHero" => raid != null && (id != "" ? players.Exists(p => p.id == id) : raid.heroes.Count > 0)
                ? new Shot { kind = kind, id = id != "" ? id : raid.heroes[0] } : null,
            "towerApproach" => StartApproach(),
            _ => null,
        };

        Shot StartApproach()
        {
            towerApproachStart = Time.time;
            return new Shot { kind = "towerApproach" };
        }

        bool ArenaValid(Shot s, out bool valid)
        {
            valid = true;
            switch (s.kind)
            {
                case "catTop": case "catGate": valid = cat != null; return true;
                case "catBoss": valid = cat != null && cat.bossId != "" && mobs.Exists(m => m.id == cat.bossId); return true;
                case "raidWide": case "raidTop": valid = raid != null; return true;
                case "raidBoss": valid = raid != null && raid.bossId != "" && mobs.Exists(m => m.id == raid.bossId); return true;
                case "raidHero": valid = raid != null && players.Exists(p => p.id == s.id); return true;
                case "towerApproach": valid = Time.time - towerApproachStart < TowerApproachDur + 4; return true;
            }
            return false;
        }

        float Floor(float x, float z, float refY) => GroundY(x, z, refY);

        bool EvalArena(Shot s, out Vector3 pos, out Vector3 tgt)
        {
            pos = tgt = default;
            switch (s.kind)
            {
                case "catTop": return cat != null && CatTop(out pos, out tgt);
                case "catGate": return cat != null && CatGate(out pos, out tgt);
                case "catBoss":
                {
                    var m = cat != null ? mobs.Find(x => x.id == cat.bossId) : null;
                    if (m == null) return false;
                    // Снизу вверх — страж/Владыка выглядит огромным; дальше — по росту, чтобы не влезть в модель.
                    float gy = Floor(m.eye.x, m.eye.z, m.eye.y);
                    float tall = Mathf.Max(1.5f, m.eye.y - gy);
                    Orbit(new Vector3(m.eye.x, gy, m.eye.z), Mathf.Max(cat.final ? 12 : 8, tall * 3.2f), cat.final ? 2.2f : 1.6f, S.orbitSpeed * 0.5f, out pos, out tgt);
                    tgt.y += cat.final ? 3.5f : 2.2f;
                    return true;
                }
                case "raidWide":
                {
                    if (raid == null) return false;
                    float gy = GroundY(RaidC.x, RaidC.y);
                    Orbit(new Vector3(RaidC.x, gy + 2, RaidC.y), raid.edge + RaidWideOut, RaidWideH, S.orbitSpeed * 0.6f, out pos, out tgt);
                    return true;
                }
                case "raidTop":
                {
                    if (raid == null) return false;
                    float gy = GroundY(RaidC.x, RaidC.y), a = orbitClock * 0.08f;
                    pos = new Vector3(RaidC.x + Mathf.Cos(a) * 9, gy + RaidTopH, RaidC.y + Mathf.Sin(a) * 9);
                    tgt = new Vector3(RaidC.x, gy, RaidC.y);
                    return true;
                }
                case "raidHero":
                {
                    var p = players.Find(x => x.id == s.id);
                    if (raid == null || p == null) return false;
                    float gy = GroundY(p.pos.x, p.pos.z);
                    float dx = p.pos.x - RaidC.x, dz = p.pos.z - RaidC.y, l = Mathf.Max(1e-3f, Mathf.Sqrt(dx * dx + dz * dz));
                    dx /= l; dz /= l;
                    pos = new Vector3(p.pos.x + dx * RaidHeroBack - dz * 1.6f, gy + RaidHeroUp, p.pos.z + dz * RaidHeroBack + dx * 1.6f);
                    tgt = new Vector3(RaidC.x, GroundY(RaidC.x, RaidC.y) + 4.5f, RaidC.y);
                    return true;
                }
                case "raidBoss":
                {
                    if (raid == null || !mobs.Exists(m => m.id == raid.bossId)) return false;
                    float gy = GroundY(RaidC.x, RaidC.y);
                    Orbit(new Vector3(RaidC.x, gy, RaidC.y), Mathf.Min(raid.edge - 2, 15), 1.4f, S.orbitSpeed * 0.7f, out pos, out tgt);
                    tgt.y += 6;
                    return true;
                }
                case "towerApproach":
                {
                    // Подлёт со стороны поляны к декоративной башне — у подножья, взгляд вверх на неё.
                    float tx = TowerProp.x, tz = TowerProp.y, g = GroundY(tx, tz), dl = TowerProp.magnitude;
                    float dx = -tx / dl, dz = -tz / dl;
                    float k = Smoothstep(Mathf.Min(1, (Time.time - towerApproachStart) / TowerApproachDur));
                    float dist = Mathf.Lerp(34, 8, k), up = Mathf.Lerp(16, 5, k);
                    pos = new Vector3(tx + dx * dist, g + up, tz + dz * dist);
                    tgt = new Vector3(tx, g + 14, tz);
                    return true;
                }
            }
            return false;
        }

        /// Одна камера на бой в катакомбах: под сводом, все герои и монстры у них в кадре; не выходит за стены.
        bool CatTop(out Vector3 pos, out Vector3 tgt)
        {
            var c = cat;
            float x0 = float.PositiveInfinity, x1 = float.NegativeInfinity, z0 = float.PositiveInfinity, z1 = float.NegativeInfinity;
            void Add(float x, float z) { x0 = Mathf.Min(x0, x); x1 = Mathf.Max(x1, x); z0 = Mathf.Min(z0, z); z1 = Mathf.Max(z1, z); }
            bool InHall(float x, float z) => Mathf.Sqrt((x - c.hall.x) * (x - c.hall.x) + (z - c.hall.z) * (z - c.hall.z)) < c.hall.r + 1;
            var heroes = players.FindAll(p => c.heroes.Contains(p.id) && InHall(p.pos.x, p.pos.z));
            if (heroes.Count == 0) heroes = players.FindAll(p => c.heroes.Contains(p.id));
            float refY = heroes.Count > 0 ? heroes[0].pos.y : 0;
            foreach (var p in heroes) Add(p.pos.x, p.pos.z);
            foreach (var m in mobs)
            {
                if (!InHall(m.eye.x, m.eye.z) || !InCat(m.eye.x, m.eye.z)) continue;
                bool near = m.id == c.bossId || heroes.Exists(p => Dist2D(m.eye, p.pos) < CatCamMobNear);
                if (near) Add(m.eye.x, m.eye.z);
            }
            if (float.IsInfinity(x0)) Add(c.hall.x, c.hall.z);
            float cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
            float spread = Mathf.Max(6, Mathf.Sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0)) / 2);
            float k = 1 - Mathf.Exp(-frameDt * 1.1f);
            if (!catTopInit) { catTopC = new Vector3(cx, 0, cz); catTopH = spread; catTopInit = true; }
            catTopC.x += (cx - catTopC.x) * k;
            catTopC.z += (cz - catTopC.z) * k;
            catTopH += (spread - catTopH) * k;
            var only = new List<int> { c.to };
            var pc = CatProject(catTopC.x, catTopC.z, only, 3);
            catTopC.x = pc.x; catTopC.z = pc.y;
            float gy = Floor(catTopC.x, catTopC.z, refY);
            // Супербосс: рост от подошвы до макушки — кадр по высоте целиком.
            var bossM = c.final && c.bossId != "" ? mobs.Find(mm => mm.id == c.bossId) : null;
            float bossTop = bossM != null ? Mathf.Max(2.5f, (bossM.eye.y - Floor(bossM.eye.x, bossM.eye.z, bossM.eye.y)) * 1.25f) : 0;
            catTopBossMix += ((bossM != null ? 1 : 0) - catTopBossMix) * k;
            // Дыхание кадра и лёгкое покачивание (±35° за ~50 с) — камера не замирает под сводом.
            float breathe = Mathf.Sin(orbitClock * 0.23f) * 0.5f + Mathf.Sin(orbitClock * 0.61f) * 0.25f;
            float height = Mathf.Min(CatCeil - 2, CatCamHeight + catTopH * CatCamHeightPerSpread + breathe * (0.4f + 0.8f * catTopBossMix));
            float back = Mathf.Min(c.hall.r * 0.9f, height * CatCamBackPerHeight + catTopH * 0.3f);
            float sway = Mathf.Sin(orbitClock * 0.125f) * 0.6f;
            var pp = CatProject(catTopC.x + Mathf.Sin(sway) * back, catTopC.z - Mathf.Cos(sway) * back, only, 2);
            pos = new Vector3(pp.x, gy + height, pp.y);
            float aimY = gy + 0.6f + (bossTop * 0.5f - 0.6f) * catTopBossMix;
            tgt = new Vector3(catTopC.x, aimY, catTopC.z);
            float hd = Mathf.Sqrt((catTopC.x - pp.x) * (catTopC.x - pp.x) + (catTopC.z - pp.y) * (catTopC.z - pp.y));
            float dist = Mathf.Sqrt(hd * hd + height * height);
            float fovWide = 2 * Mathf.Atan((catTopH + 2.5f) / dist);
            float fovBoss = 2 * Mathf.Atan((bossTop * CatCamBossFit + 0.5f) / Mathf.Sqrt(hd * hd + (height - bossTop * 0.5f) * (height - bossTop * 0.5f)));
            float fovWant = Mathf.Max(fovWide, fovBoss * catTopBossMix + fovWide * (1 - catTopBossMix));
            catFov = Mathf.Clamp(fovWant, 0.9f, 1.35f);
            return true;
        }

        /// Переход между залами: камера за спинами отряда по оси коридора сквозь поднятую решётку.
        bool CatGate(out Vector3 pos, out Vector3 tgt)
        {
            pos = tgt = default;
            var c = cat;
            int li = c.lo < c.hi ? CatLinkIndex(c.from, c.to) : -1;
            if (li < 0) return CatTop(out pos, out tgt);
            var cor = corridors[li];
            // Направление коридора — от старого зала к новому (в таблице он мог быть записан обратно).
            float dx = cor.dx, dz = cor.dz, ax = cor.ax, az = cor.az;
            if (cor.a != c.from) { dx = -dx; dz = -dz; ax = cor.ax + cor.dx * cor.len; az = cor.az + cor.dz * cor.len; }
            var a = halls[c.from];
            var b = halls[c.to];
            float sum = 0, refY = 0;
            int n = 0;
            foreach (var p in players)
            {
                if (!c.heroes.Contains(p.id)) continue;
                sum += (p.pos.x - ax) * dx + (p.pos.z - az) * dz;
                refY = p.pos.y;
                n++;
            }
            float want = Mathf.Clamp((n > 0 ? sum / n : 0) - GateBack, -(a.r - 5), cor.len + b.r * 0.4f);
            string key = c.from + ">" + c.to;
            if (catGateKey != key) { catGateKey = key; catGateS = want; }
            // Только вперёд и плавно — камера не дёргается назад, когда кто-то оглянулся.
            if (want > catGateS) catGateS += (want - catGateS) * (1 - Mathf.Exp(-frameDt * GateFollow));
            float px = ax + dx * catGateS, pz = az + dz * catGateS;
            float gy = Floor(px, pz, n > 0 ? refY : 0);
            pos = new Vector3(px, gy + GateHeight, pz);
            float ta = catGateS + GateAhead;
            tgt = new Vector3(ax + dx * ta, gy + GateLookY, az + dz * ta);
            return true;
        }

        /// Забег в башне: камера не вылетает за стены и свод зала (в вебе — после director.update).
        Vector3 ClampToTower(Vector3 p)
        {
            if (!TowerArena.Active || !auto || p.y < 200) return p;
            const float margin = 1.2f;
            float R = TowerArena.Radius - margin;
            float floorY = TowerArena.FloorY + margin, ceilY = TowerArena.FloorY + TowerArena.WallH - margin;
            float lx = p.x - TowerArena.Hide.x, lz = p.z - TowerArena.Hide.z, d = Mathf.Sqrt(lx * lx + lz * lz);
            if (d > R) { p.x = TowerArena.Hide.x + lx * R / d; p.z = TowerArena.Hide.z + lz * R / d; }
            p.y = Mathf.Clamp(p.y, floorY, ceilY);
            return p;
        }
    }
}
