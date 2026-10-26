using System;
using System.Collections.Generic;
using UnityEngine;
using static Zep.FxColors;

namespace Zep
{
    /// Приёмы боссов — Ледяной гигант, Владыка Бездны, Лавовый страж, «Аура раскалённой стали» и «Стягивание»
    /// воина (в вебе IceGiantAct / DragonAct / LavaAct / SteelAct / DrawAct). События и тайминги те же, картинка
    /// своя и богаче: объёмный лёд (BossFx), телеграфы с заливкой, лава и гарь на земле, струя огня со светом,
    /// дым и пыль, метеоры с хвостом.
    public static class BossActs
    {
        // Константы сервера (shared/mobs.ts ICE_GIANT / DRAGON, shared/classes2.ts, shared/drawIn.ts).
        const float SlamR = 10, SlamWind = 1.3f, ThrowR = 3.5f, ThrowWind = 1.35f, ThrowFlight = 1.2f, PatchR = 4, PatchSec = 8;
        const float FisWind = 0.85f, FisLen = 36, FisSpeed = 18, FisHalfW = 1.6f, FrostStackSec = 7, FreezeSec = 2;
        const float BreathLen = 16, BreathHalf = 0.5f, BreathStart = 1.25f, BreathEnd = 1.95f, BurnSec = 3;
        const float TailRMin = 2, TailRMax = 18, TailFrom = -15, TailTo = 110, TailHit = 1.12f;
        const float MeteorR = 3, MeteorFall = 0.6f, ChargeHit = 1.3f, ChargeClip = 2.0f, RingR = 9, RingTele = 1.8f;
        const float SteelDur = 6, DrawR = 10, DrawSec = 0.45f;

        static readonly Color Dust = new(0.32f, 0.27f, 0.22f), RockC = new(0.55f, 0.22f, 0.08f), Soot = new(0.12f, 0.1f, 0.09f);
        static readonly Color Steel = new(0.82f, 0.88f, 0.98f), SteelHot = new(1, 0.62f, 0.28f);
        static readonly Color[] SteelMode = { Fire, Frost, FireRed };
        const float Deg = Mathf.Deg2Rad;

        static readonly Dictionary<string, BossFx.Group> held = new(), flying = new();
        static readonly Dictionary<string, (float t, int falls, int hits)> batch = new();
        static float lastPull = -1;

        static Vfx V => Vfx.I;
        static BossFx B => BossFx.I;
        static float Rnd => UnityEngine.Random.value;
        static Vector3 P(float x, float y, float z) => new(x, y, z);
        static void Later(float t, Action fn) => B.Later(t, fn);
        static void Snd(Vector3 at, string name, float vol = 1) => SoundBank.At(at, name, vol, range: 70);

        /// Пол под точкой: луч вниз по коллайдерам (подземелья, катакомбы), иначе рельеф.
        static float Ground(float x, float z, float hint)
        {
            if (Physics.Raycast(new Vector3(x, hint + 8, z), Vector3.down, out var hit, 40)) return hit.point.y;
            var t = Terrain.activeTerrain;
            return t ? t.SampleHeight(new Vector3(x, 0, z)) + t.transform.position.y : hint;
        }

        static Vector3? Mob(string id)
        {
            var p = Vfx.FollowPos(Vfx.Follow.Mob, id);
            return float.IsNaN(p.x) ? null : p;
        }

        static Vector3? Hero(string id)
        {
            var p = Vfx.FollowPos(Vfx.Follow.Hero, id);
            return float.IsNaN(p.x) ? null : p;
        }

        /// Мировая точка кости модели моба (рука с глыбой, челюсть дракона).
        static Vector3? Bone(string mobId, string name)
        {
            if (mobId == null || !WorldSync.Mobs.TryGetValue(mobId, out var m) || !m) return null;
            var t = Find(m.transform, name);
            return t ? t.position : null;
        }

        static Transform Find(Transform t, string name)
        {
            if (t.name == name || t.name.EndsWith(":" + name)) return t;
            for (int i = 0; i < t.childCount; i++)
            {
                var r = Find(t.GetChild(i), name);
                if (r) return r;
            }
            return null;
        }

        /// Пасть Владыки: челюсть + (челюсть − голова) — кончик морды, идёт за клипом.
        static Vector3? Mouth(string id)
        {
            var j = Bone(id, "Jaw");
            var h = Bone(id, "Head");
            return j.HasValue && h.HasValue ? 2 * j.Value - h.Value : null;
        }

        public static bool Play(string k, string id, float x, float y, float z, float? d, float? x2, float? z2, int? v, float? r, string mobId)
        {
            if (V == null || B == null) return false;
            id ??= "";
            switch (k)
            {
                case "giantSlam": case "giantSlamHit": case "giantThrowMark": case "giantThrowFly": case "giantThrowHit":
                case "giantFissure": case "giantFissureGo": case "giantFury": case "frostStack": case "mobFrost":
                case "iceEncase": case "mobEncase":
                    Giant(k, id, x, y, z, d, x2, z2, r);
                    return true;
                case "dragonBreath": case "dragonBreathGo": case "dragonBurn": case "dragonTail": case "dragonTailHit":
                case "dragonMeteorMark": case "dragonMeteorFall": case "dragonMeteorHit": case "dragonRingMark": case "dragonRing":
                case "dragonShieldBreak": case "dragonRage":
                    Dragon(k, mobId ?? id ?? "", x, z, Ground(x, z, y), d, x2, z2, r);
                    return true;
                case "lavaSlam": case "lavaSlamHit": case "lavaSpill": case "lavaSpillHit": case "lavaFury": case "lavaFuryHit":
                case "lavaMark": case "lavaMarkHit": case "lavaRing": case "lavaRingHit":
                    Lava(k, x, y, z, d, x2, z2, r ?? 3);
                    return true;
                case "steelAura": case "steelBurn":
                    SteelAura(k, id, x, y, z, d, r, v ?? 0);
                    return true;
                case "drawIn": case "drawPull": case "drawImpact":
                    Draw(k, x, y, z, d, x2, z2, r, v ?? 0);
                    return true;
            }
            return false;
        }

        // ---------------------------------------------------------------- Ледяной гигант

        static void Giant(string k, string id, float x, float y, float z, float? d, float? x2, float? z2, float? r)
        {
            var vfx = V;
            var ice = B;
            var at = P(x, y, z);
            switch (k)
            {
                case "giantSlam":
                    // Круг вокруг гиганта заливается льдом к краю; по контуру поднимается морозная дымка.
                    vfx.Decal(at, r ?? SlamR, Frost, d ?? SlamWind, Vfx.Tele, 0.9f);
                    for (float t = 0; t < (d ?? SlamWind); t += 0.2f)
                        Later(t, () =>
                        {
                            float a = Rnd * Mathf.PI * 2, rr = (r ?? SlamR) * (0.9f + Rnd * 0.1f);
                            vfx.Burst(P(x + Mathf.Cos(a) * rr, y + 0.2f, z + Mathf.Sin(a) * rr), IceRim, count: 6, speed: 1, life: 0.8f, grav: -1.2f, size: 0.25f);
                        });
                    break;
                case "giantSlamHit":
                {
                    float R = r ?? SlamR;
                    ice.Shards(BossFx.Shard.Ring, at, R * 0.9f, 2.8f, 1.1f, 26);
                    ice.Shards(BossFx.Shard.Crater, at, 4, 1.8f, 0.9f, 28);
                    vfx.Decal(at, R * 1.05f, IceRim, 0.55f, 5, 1);
                    vfx.Decal(at, R * 0.85f, Frost, 3.5f, Vfx.Frost, 0.9f);
                    vfx.Flash(at + Vector3.up * 2, LightningCore, R * 1.8f, 25, 0.5f);
                    float a0 = Rnd * Mathf.PI;
                    for (int i = 0; i < 6; i++)
                    {
                        float a = a0 + i / 6f * Mathf.PI * 2, cx = Mathf.Cos(a), cz = Mathf.Sin(a);
                        vfx.Burst(P(x + cx * R * 0.8f, y + 0.6f, z + cz * R * 0.8f), IceRim, count: 16, speed: 7, life: 0.8f, size: 0.3f, dir: new Vector3(cx, 1.4f, cz), spread: 0.45f);
                    }
                    vfx.Burst(P(x, y + 1.2f, z), Frost, count: 36, speed: 10, life: 0.9f, grav: 6, size: 0.45f);
                    vfx.Burst(P(x, y + 0.5f, z), new Color(0.8f, 0.9f, 1f), count: 10, speed: 3, life: 1.6f, grav: -0.6f, size: 1.6f, smoke: true);
                    Snd(at, "giant-slam");
                    Snd(at, "ice-spikes", 0.8f);
                    Later(1.15f, () => Snd(at, "ice-shatter", 0.6f));
                    break;
                }
                case "giantThrowMark":
                {
                    vfx.Decal(at, r ?? ThrowR, Frost, d ?? ThrowWind + ThrowFlight, Vfx.Tele, 0.9f);
                    var mob = Mob(id);
                    if (mob.HasValue) Later(0.62f, () => Snd(mob.Value, "giant-throw"));
                    Later(0.62f, () =>
                    {
                        Vector3? Hand() => Bone(id, "Hand.R");
                        var p = Hand();
                        if (!p.HasValue) return;
                        held[id] = ice.Shards(BossFx.Shard.Boulder, p.Value, 1.1f, 1.6f, ThrowWind - 0.62f + 0.3f, 20, track: Hand, spin: 1.2f);
                        vfx.Burst(p.Value, Frost, count: 16, speed: 3, life: 0.6f, grav: 4, size: 0.3f);
                    });
                    break;
                }
                case "giantThrowFly":
                {
                    float T = d ?? ThrowFlight;
                    var to = P(x, y + 0.8f, z);
                    held.TryGetValue(id, out var gr);
                    held.Remove(id);
                    var from = gr != null ? gr.At : Bone(id, "Hand.R") ?? P(x2 ?? x, Ground(x2 ?? x, z2 ?? z, y) + 9, z2 ?? z);
                    float arc = Mathf.Max(3, Vector2.Distance(new Vector2(to.x, to.z), new Vector2(from.x, from.z)) * 0.3f);
                    float t0 = ice.Clock;
                    Vector3? Path()
                    {
                        float u = Mathf.Min(1, (ice.Clock - t0) / T);
                        return Vector3.Lerp(from, to, u) + Vector3.up * arc * 4 * u * (1 - u);
                    }
                    if (gr != null) ice.Retrack(gr, Path, T + 0.05f);
                    else gr = ice.Shards(BossFx.Shard.Boulder, from, 1.1f, 1.6f, T + 0.05f, 20, track: Path, spin: 1.2f);
                    flying[id] = gr;
                    // За глыбой — шлейф инея и дымки.
                    for (float t = 0.06f; t < T; t += 0.06f)
                        Later(t, () =>
                        {
                            var p = Path().Value;
                            vfx.Burst(p, Frost, count: 5, speed: 0.8f, life: 0.55f, grav: 2, size: 0.4f);
                            vfx.Burst(p, new Color(0.85f, 0.93f, 1f), count: 2, speed: 0.4f, life: 0.9f, grav: -0.5f, size: 0.8f, smoke: true);
                        });
                    break;
                }
                case "giantThrowHit":
                    if (flying.TryGetValue(id, out var fl)) { ice.End(fl); flying.Remove(id); }
                    ice.Shards(BossFx.Shard.Crater, at, 2.4f, 1.6f, 1.0f, 26);
                    ice.Shards(BossFx.Shard.Ring, at, ThrowR * 0.8f, 1.2f, 0.8f, 16);
                    vfx.Decal(at, ThrowR * 1.2f, IceRim, 0.5f, 5, 1);
                    vfx.Decal(at, r ?? PatchR, Frost, d ?? PatchSec, Vfx.Frost, 0.95f);
                    vfx.Flash(at + Vector3.up * 1.5f, LightningCore, 12, 22, 0.45f);
                    vfx.Burst(P(x, y + 1, z), IceRim, count: 30, speed: 8, life: 0.9f, grav: 9, size: 0.35f);
                    vfx.Burst(P(x, y + 0.5f, z), new Color(0.85f, 0.93f, 1f), count: 8, speed: 2.5f, life: 1.4f, grav: -0.5f, size: 1.4f, smoke: true);
                    Snd(at, "ice-impact");
                    break;
                case "giantFissure":
                {
                    // Полоса к герою: прямоугольник как узкий сектор от гиганта — заливка бежит к концу.
                    float ex = x2 ?? x, ez = z2 ?? z, dx = ex - x, dz = z2.HasValue ? ez - z : 1, len = Mathf.Max(1, Mathf.Sqrt(dx * dx + dz * dz));
                    float half = Mathf.Atan2(r ?? FisHalfW, len);
                    vfx.Decal(at, len, Frost, (d ?? FisWind) + FisLen / FisSpeed, Vfx.Tele, 0.85f, shape: Vfx.Shape.Sector(Mathf.Atan2(dx, dz), -half, half));
                    break;
                }
                case "giantFissureGo":
                {
                    float ex = x2 ?? x, ez = z2 ?? z, ey = Ground(ex, ez, y);
                    float len = Vector2.Distance(new Vector2(x, z), new Vector2(ex, ez));
                    float speed = len / Mathf.Max(0.1f, d ?? FisLen / FisSpeed);
                    ice.Shards(BossFx.Shard.Line, at, size: 2.8f, hold: 0.9f, b: P(ex, ey, ez), w: r ?? FisHalfW, speed: speed);
                    vfx.Decal(at, 3, IceRim, 0.4f, 5, 1);
                    Snd(at, "ice-spikes", 0.9f);
                    for (int i = 1; i <= 6; i++)
                    {
                        float u = i / 6f, px = x + (ex - x) * u, pz = z + (ez - z) * u, py = Ground(px, pz, y);
                        int ii = i;
                        Later(len * u / speed, () =>
                        {
                            vfx.Burst(P(px, py + 0.8f, pz), IceRim, count: 14, speed: 5, life: 0.6f, size: 0.28f, dir: Vector3.up, spread: 0.6f);
                            vfx.Burst(P(px, py + 0.3f, pz), new Color(0.85f, 0.93f, 1f), count: 3, speed: 1.2f, life: 1.1f, grav: -0.4f, size: 1.1f, smoke: true);
                            if (ii % 2 == 0) Snd(P(px, py, pz), "ice-spikes", 0.6f);
                        });
                    }
                    Later(len / speed + 0.9f, () => Snd(P(ex, ey, ez), "ice-shatter", 0.45f));
                    break;
                }
                case "giantFury":
                    vfx.Decal(at, 16, IceRim, 0.9f, 5, 1);
                    vfx.Decal(at, 9, Frost, 6, Vfx.Frost, 0.7f);
                    vfx.Pillar(at, 3, 16, Frost, 1.4f);
                    Later(0.4f, () =>
                    {
                        vfx.Burst(P(x, y + 3, z), Frost, count: 40, speed: 10, life: 1.4f, grav: 2, size: 0.5f);
                        vfx.Burst(P(x, y + 1, z), new Color(0.88f, 0.95f, 1f), count: 16, speed: 6, life: 2, grav: -0.3f, size: 2.2f, smoke: true);
                        vfx.Flash(at + Vector3.up * 4, Frost, 25, 20, 0.9f);
                    });
                    Snd(at, "giant-roar");
                    break;
                case "frostStack":
                case "mobFrost":
                {
                    var kind = k == "mobFrost" ? Vfx.Follow.Mob : Vfx.Follow.Hero;
                    Vector3? Fol() { var p = Vfx.FollowPos(kind, id); return float.IsNaN(p.x) ? null : (kind == Vfx.Follow.Mob ? p + Vector3.down * 1.1f : p); }
                    ice.FrostOrbit(id, Mathf.Max(1, Mathf.RoundToInt(d ?? 1)), FrostStackSec, Fol);
                    Snd(Fol() ?? at, "frost-stack", 0.55f);
                    break;
                }
                case "iceEncase":
                case "mobEncase":
                {
                    ice.ClearOrbit(id);
                    var f = Vfx.FollowPos(k == "mobEncase" ? Vfx.Follow.Mob : Vfx.Follow.Hero, id);
                    var p = float.IsNaN(f.x) ? P(x, Ground(x, z, y), z) : P(f.x, Ground(f.x, f.z, f.y), f.z);
                    float T = d ?? FreezeSec;
                    ice.Shards(BossFx.Shard.Cage, p, r ?? 0.62f, 2.1f, T, 14);
                    vfx.Decal(p, 1.6f, Frost, T + 0.8f, Vfx.Frost, 0.9f);
                    vfx.Burst(p + Vector3.up, Frost, count: 20, speed: 3, life: 0.7f, grav: 2, size: 0.35f);
                    Snd(p, "ice-freeze");
                    Later(T, () =>
                    {
                        vfx.Burst(p + Vector3.up * 1.1f, IceRim, count: 30, speed: 6, life: 0.8f, grav: 9, size: 0.28f);
                        Snd(p, "ice-shatter", 0.8f);
                    });
                    break;
                }
            }
        }

        // ---------------------------------------------------------------- Владыка Бездны

        static void Dragon(string k, string id, float x, float z, float y, float? d, float? x2, float? z2, float? r)
        {
            var vfx = V;
            var fx = B;
            var at = P(x, y, z);
            float yaw = x2.HasValue && z2.HasValue ? Mathf.Atan2(x2.Value - x, z2.Value - z) : 0;
            Vector3 MouthOr() => Mouth(id) ?? P(x, y + 6, z);
            switch (k)
            {
                case "dragonBreath":
                {
                    float T = d ?? BreathStart, half = r ?? BreathHalf;
                    vfx.Decal(at, BreathLen, Fire, T, Vfx.Tele, 0.95f, shape: Vfx.Shape.Sector(yaw, -half, half));
                    Snd(MouthOr(), "lord-breath-in");
                    // В пасти разгорается жар: искры и свет, всё ярче к выдоху.
                    for (float t = 0.3f; t < T - 0.05f; t += 0.12f)
                    {
                        float g = t / T;
                        Later(t, () =>
                        {
                            var m = MouthOr();
                            vfx.Burst(m, Fire, count: 4 + (int)(g * 8), speed: 1.2f, life: 0.4f, grav: -1, size: 0.25f + g * 0.25f);
                            vfx.Flash(m, Fire, 6 + g * 6, 4 + g * 10, 0.2f);
                        });
                    }
                    break;
                }
                case "dragonBreathGo":
                {
                    float S = d ?? BreathEnd - BreathStart, half = r ?? BreathHalf;
                    float ex = x2 ?? x, ez = z2 ?? z;
                    var end = P(ex, Ground(ex, ez, y) + 0.5f, ez);
                    vfx.Decal(at, BreathLen, FireRed, S + 0.25f, 5, 0.9f, shape: Vfx.Shape.Sector(yaw, -half, half));
                    Snd(MouthOr(), "lord-breath");
                    // Струя: каждые 40 мс — ядро (белое, быстрое, узкое) и клубы (крупнее, шире), свет у пасти и в зоне.
                    for (float t = 0; t < S; t += 0.04f)
                        Later(t, () =>
                        {
                            var m = MouthOr();
                            var dir = end - m;
                            float len = dir.magnitude;
                            vfx.Burst(m, FireCore, count: 10, speed: len * 1.7f, life: 0.42f, grav: -1, size: 0.6f, dir: dir, spread: half * 0.4f);
                            vfx.Burst(m, Fire, count: 8, speed: len * 1.3f, life: 0.65f, grav: -3, size: 1.0f, dir: dir, spread: half * 0.75f);
                            vfx.Burst(m, FireRed, count: 4, speed: len * 1.0f, life: 0.8f, grav: -4, size: 1.3f, dir: dir, spread: half);
                        });
                    for (float t = 0; t < S; t += 0.15f)
                        Later(t, () =>
                        {
                            vfx.Flash(MouthOr(), FireCore, 12, 18, 0.2f);
                            float u = 0.55f + Rnd * 0.45f;
                            float px = x + (ex - x) * u, pz = z + (ez - z) * u;
                            var g = P(px, Ground(px, pz, y) + 0.4f, pz);
                            vfx.Flash(g + Vector3.up, Fire, 14, 22, 0.25f);
                            vfx.Burst(g, FireCore, count: 10, speed: 4, life: 0.6f, size: 0.24f, dir: Vector3.up, spread: 0.8f);
                            vfx.Burst(g, Soot, count: 3, speed: 1.5f, life: 1.6f, grav: -2, size: 1.6f, smoke: true);
                        });
                    break;
                }
                case "dragonBurn":
                {
                    float T = d ?? BurnSec, half = r ?? BreathHalf;
                    var sh = Vfx.Shape.Sector(yaw, -half, half);
                    vfx.Decal(at, BreathLen, Fire, T + 0.6f, Vfx.Lava, 1, shape: sh);
                    vfx.Decal(at, BreathLen, Soot, T + 6, Vfx.Scorch, 0.9f, shape: sh);
                    // Языки пламени по всему конусу, потом дым над гарью.
                    for (float t = 0; t < T; t += 0.06f)
                        Later(t, () =>
                        {
                            float a = yaw + (Rnd * 2 - 1) * half, rr = Mathf.Sqrt(Rnd) * BreathLen;
                            float px = x + Mathf.Sin(a) * rr, pz = z + Mathf.Cos(a) * rr;
                            var g = P(px, Ground(px, pz, y) + 0.1f, pz);
                            vfx.Burst(g, Fire, count: 5, speed: 1.4f, life: 0.85f, grav: -4, size: 0.9f, dir: Vector3.up, spread: 0.35f);
                            vfx.Burst(g, FireCore, count: 3, speed: 1, life: 0.5f, grav: -3, size: 0.45f, dir: Vector3.up, spread: 0.3f);
                        });
                    for (float t = 0; t < T; t += 0.3f)
                        Later(t, () =>
                        {
                            float a = yaw + (Rnd * 2 - 1) * half, rr = Mathf.Sqrt(Rnd) * BreathLen;
                            vfx.Flash(P(x + Mathf.Sin(a) * rr, y + 1.2f, z + Mathf.Cos(a) * rr), Fire, 10, 14, 0.5f);
                        });
                    Later(Mathf.Max(0, T - 0.4f), () =>
                    {
                        for (int i = 0; i < 6; i++)
                        {
                            float a = yaw + (Rnd * 2 - 1) * half, rr = Mathf.Sqrt(Rnd) * BreathLen;
                            vfx.Burst(P(x + Mathf.Sin(a) * rr, y + 0.5f, z + Mathf.Cos(a) * rr), Soot, count: 4, speed: 1, life: 2.4f, grav: -1.2f, size: 2.2f, smoke: true);
                        }
                    });
                    Snd(P((x + (x2 ?? x)) / 2, y, (z + (z2 ?? z)) / 2), "lord-burn", 0.8f);
                    break;
                }
                case "dragonTail":
                {
                    float T = d ?? TailHit, R = r ?? TailRMax;
                    vfx.Decal(at, R, Fire, T, Vfx.Tele, 0.9f, shape: Vfx.Shape.Sector(yaw, TailFrom * Deg, TailTo * Deg, TailRMin / R, -1));
                    Snd(at, "lord-tail");
                    for (float t = T - 0.32f; t < T + 0.2f; t += 0.06f)
                        Later(Mathf.Max(0, t), () =>
                        {
                            var tip = Bone(id, "Tail8");
                            if (!tip.HasValue) return;
                            float g = Ground(tip.Value.x, tip.Value.z, y);
                            if (tip.Value.y - g < 1.5f) vfx.Burst(P(tip.Value.x, g + 0.3f, tip.Value.z), Fire, count: 6, speed: 2.5f, life: 0.4f, size: 0.2f, dir: Vector3.up, spread: 0.9f);
                            vfx.Burst(P(tip.Value.x, Mathf.Max(g + 0.4f, tip.Value.y), tip.Value.z), Dust, count: 3, speed: 0.8f, life: 1.1f, grav: -0.6f, size: 1.2f, smoke: true);
                        });
                    break;
                }
                case "dragonTailHit":
                {
                    float R = r ?? TailRMax;
                    var sh = Vfx.Shape.Sector(yaw, TailFrom * Deg, TailTo * Deg, TailRMin / R, -1);
                    vfx.Decal(at, R, Fire, 0.45f, 5, 1, shape: sh);
                    float rr = (TailRMin + R) / 2;
                    for (int i = 0; i < 7; i++)
                    {
                        float a = yaw + (TailTo - (i + 0.5f) / 7 * (TailTo - TailFrom)) * Deg;
                        float px = x + Mathf.Sin(a) * rr, pz = z + Mathf.Cos(a) * rr, py = Ground(px, pz, y);
                        var side = new Vector3(Mathf.Sin(a - Mathf.PI / 2), 0.8f, Mathf.Cos(a - Mathf.PI / 2));
                        Later(i * 0.035f, () =>
                        {
                            vfx.Burst(P(px, py + 0.4f, pz), Dust, count: 6, speed: 2.5f, life: 1.6f, grav: -0.8f, size: 2.2f, smoke: true);
                            vfx.Burst(P(px, py + 0.5f, pz), RockC, count: 12, speed: 7, life: 0.9f, grav: 14, size: 0.24f, dir: side, spread: 0.6f);
                        });
                    }
                    float mid = yaw + (TailFrom + TailTo) / 2 * Deg;
                    Snd(P(x + Mathf.Sin(mid) * rr, y, z + Mathf.Cos(mid) * rr), "lord-tail-hit");
                    break;
                }
                case "dragonMeteorMark":
                {
                    float T = d ?? ChargeHit + MeteorFall;
                    vfx.Decal(at, r ?? MeteorR, Fire, T, Vfx.Tele, 0.95f);
                    if (batch.TryGetValue(id, out var bt) && fx.Clock - bt.t < 0.25f) break;
                    batch[id] = (fx.Clock, 0, 0);
                    var boss = Mob(id);
                    if (boss.HasValue) Snd(boss.Value, "lord-charge");
                    for (float t = 0.5f; t < ChargeHit; t += 0.12f)
                        Later(t, () =>
                        {
                            var m = Mouth(id);
                            if (m.HasValue) vfx.Burst(m.Value, Fire, count: 8, speed: 3, life: 0.6f, grav: -4, size: 0.3f, dir: Vector3.up, spread: 0.5f);
                        });
                    Later(ChargeHit, () =>
                    {
                        var m = Mouth(id);
                        if (!m.HasValue) return;
                        vfx.Burst(m.Value, FireCore, count: 40, speed: 16, life: 0.9f, grav: 2, size: 0.45f, dir: Vector3.up, spread: 0.25f);
                        vfx.Burst(m.Value, Fire, count: 20, speed: 8, life: 1.1f, grav: -2, size: 1.1f, dir: Vector3.up, spread: 0.35f);
                        vfx.Flash(m.Value + Vector3.up * 2, FireCore, 30, 40, 0.6f);
                    });
                    break;
                }
                case "dragonMeteorFall":
                {
                    float T = d ?? MeteorFall, a = Rnd * Mathf.PI * 2;
                    fx.Meteor(P(x + Mathf.Cos(a) * 5, y + 18, z + Mathf.Sin(a) * 5), P(x, y + 0.6f, z), T);
                    batch.TryGetValue(id, out var bt);
                    if (bt.falls++ < 4) Snd(at, "lord-meteor-fall", 0.7f);
                    batch[id] = bt;
                    break;
                }
                case "dragonMeteorHit":
                {
                    float R = r ?? MeteorR;
                    vfx.Decal(at, R * 1.4f, FireCore, 0.45f, 5, 1);
                    vfx.Decal(at, R * 0.9f, Fire, 2.4f, Vfx.Lava, 1);
                    vfx.Decal(at, R * 1.1f, Soot, 8, Vfx.Scorch, 0.9f);
                    vfx.Flash(at + Vector3.up * 1.5f, FireCore, R * 6, 40, 0.5f);
                    vfx.Burst(P(x, y + 0.5f, z), FireCore, count: 30, speed: 7, life: 0.55f, grav: -2, size: 0.9f, dir: Vector3.up, spread: 0.8f);
                    vfx.Burst(P(x, y + 0.8f, z), Fire, count: 18, speed: 4, life: 1, grav: -3, size: 1.5f, dir: Vector3.up, spread: 0.6f);
                    vfx.Burst(P(x, y + 1, z), Soot, count: 10, speed: 2.5f, life: 2.2f, grav: -1.5f, size: 2.4f, smoke: true);
                    vfx.Burst(P(x, y + 0.6f, z), RockC, count: 20, speed: 9, life: 1, grav: 14, size: 0.3f, dir: Vector3.up, spread: 0.7f);
                    batch.TryGetValue(id, out var bt);
                    if (bt.hits++ < 4) Snd(at, "lord-meteor-hit", 0.8f);
                    batch[id] = bt;
                    break;
                }
                case "dragonRingMark":
                {
                    float T = d ?? RingTele, R = r ?? RingR;
                    vfx.Decal(at, R, Fire, T, Vfx.Tele, 0.95f);
                    // По краю разгорается огонь — всё гуще к удару.
                    for (float t = 0; t < T; t += 0.05f)
                    {
                        float g = t / T;
                        Later(t, () =>
                        {
                            for (int i = 0; i < 1 + (int)(g * 3); i++)
                            {
                                float a = Rnd * Mathf.PI * 2;
                                vfx.Burst(P(x + Mathf.Cos(a) * R * 0.96f, y + 0.1f, z + Mathf.Sin(a) * R * 0.96f), Fire, count: 4, speed: 1.2f + g * 1.5f, life: 0.55f, grav: -4, size: 0.5f + g * 0.4f, dir: Vector3.up, spread: 0.3f);
                            }
                        });
                    }
                    Snd(at, "lord-ring-mark");
                    break;
                }
                case "dragonRing":
                {
                    float R = r ?? RingR;
                    vfx.Decal(at, R * 1.05f, FireCore, 0.5f, 5, 1);
                    vfx.Decal(at, R, Fire, 1.6f, Vfx.Lava, 0.9f);
                    vfx.Decal(at, R, Soot, 6, Vfx.Scorch, 0.7f);
                    vfx.Flash(at + Vector3.up * 3, FireCore, R * 3, 45, 0.8f);
                    // Огненный фронт от центра: кольца столбов огня одно за другим.
                    for (int ring = 1; ring <= 5; ring++)
                    {
                        float rr = R * ring / 5f;
                        int n = 6 + ring * 3;
                        Later(ring * 0.06f, () =>
                        {
                            for (int i = 0; i < n; i++)
                            {
                                float a = (i + Rnd) / n * Mathf.PI * 2;
                                vfx.Burst(P(x + Mathf.Cos(a) * rr, y + 0.2f, z + Mathf.Sin(a) * rr), Fire, count: 4, speed: 3 + ring, life: 0.7f, grav: -5, size: 0.9f, dir: Vector3.up, spread: 0.25f);
                            }
                        });
                    }
                    for (int i = 0; i < 6; i++)
                    {
                        float a = i / 6f * Mathf.PI * 2, cx = Mathf.Cos(a), cz = Mathf.Sin(a);
                        Later(0.3f, () => vfx.Burst(P(x + cx * R * 0.95f, y + 0.6f, z + cz * R * 0.95f), FireCore, count: 14, speed: 7, life: 0.7f, size: 0.26f, dir: new Vector3(cx, 1.2f, cz), spread: 0.45f));
                    }
                    Later(0.4f, () => vfx.Burst(P(x, y + 1, z), Soot, count: 14, speed: R * 0.6f, life: 2.2f, grav: -1, size: 2.6f, smoke: true));
                    Snd(at, "lord-ring");
                    break;
                }
                case "dragonShieldBreak":
                {
                    var m = MouthOr();
                    vfx.Burst(m, Fire, count: 30, speed: 5, life: 0.7f, grav: -2, size: 1.1f);
                    vfx.Burst(P(x, y + 3, z), Arcane, count: 40, speed: 12, life: 1.1f, grav: 6, size: 0.36f);
                    vfx.Pillar(at, 4, 12, Arcane, 0.7f);
                    vfx.Flash(P(x, y + 3, z), Arcane, 25, 35, 0.7f);
                    Snd(at, "lord-shield");
                    break;
                }
                case "dragonRage":
                {
                    float C = d ?? ChargeClip;
                    Snd(at, "lord-rage");
                    for (float t = 0.4f; t < ChargeHit; t += 0.12f)
                        Later(t, () =>
                        {
                            var m = Mouth(id);
                            if (m.HasValue) vfx.Burst(m.Value, Fire, count: 8, speed: 3, life: 0.6f, grav: -4, size: 0.3f, dir: Vector3.up, spread: 0.6f);
                        });
                    Later(ChargeHit, () =>
                    {
                        var m = MouthOr();
                        vfx.Burst(m, FireCore, count: 50, speed: 18, life: 0.8f, grav: -2, size: 0.8f, dir: Vector3.up, spread: 0.3f);
                        vfx.Burst(m, Fire, count: 30, speed: 10, life: 1.1f, grav: -3, size: 1.4f, dir: Vector3.up, spread: 0.4f);
                        vfx.Decal(at, 14, FireCore, 0.8f, 5, 1);
                        vfx.Decal(at, 7, Fire, 2.5f, Vfx.Lava, 0.9f);
                        vfx.Burst(P(x, y + 1, z), FireCore, count: 36, speed: 10, life: 1.1f, grav: 3, size: 0.32f);
                        vfx.Flash(m + Vector3.up * 3, FireCore, 35, 50, 0.9f);
                    });
                    Later(C, () => vfx.Decal(at, 7, Soot, 5, Vfx.Scorch, 0.6f));
                    break;
                }
            }
        }

        // ---------------------------------------------------------------- Лавовый страж

        static void Lava(string k, float x, float y, float z, float? d, float? x2, float? z2, float R)
        {
            var vfx = V;
            var at = P(x, y, z);
            Vfx.Shape? Spill()
            {
                if (!x2.HasValue || !z2.HasValue) return null;
                float dx = x2.Value - x, dz = z2.Value - z, len = Mathf.Max(1, Mathf.Sqrt(dx * dx + dz * dz));
                return Vfx.Shape.Sector(Mathf.Atan2(dx, dz), -Mathf.Atan2(R, len), Mathf.Atan2(R, len));
            }
            float SpillLen() => x2.HasValue && z2.HasValue ? Mathf.Max(1, Vector2.Distance(new Vector2(x, z), new Vector2(x2.Value, z2.Value))) : R;
            switch (k)
            {
                case "lavaSlam":
                    vfx.Decal(at, R, FireRed, d ?? 1.2f, Vfx.Tele, 0.9f);
                    break;
                case "lavaSlamHit":
                    vfx.Decal(at, R * 1.05f, FireCore, 0.55f, 5, 1);
                    vfx.Decal(at, R * 0.9f, Fire, 2.5f, Vfx.Lava, 1);
                    vfx.Decal(at, R * 0.95f, Soot, 5, Vfx.Scorch, 0.85f);
                    vfx.Burst(P(x, y + 0.4f, z), Fire, count: 34, speed: 7, life: 0.8f, size: 0.4f, grav: 5);
                    vfx.Burst(P(x, y + 0.3f, z), FireRed, count: 14, speed: 2, life: 1, grav: -3, size: 0.9f, dir: Vector3.up, spread: 0.6f);
                    vfx.Burst(P(x, y + 0.8f, z), Soot, count: 6, speed: 2, life: 1.8f, grav: -1.2f, size: 1.8f, smoke: true);
                    Snd(at, "lava-slam");
                    break;
                case "lavaSpill":
                    if (Spill() is { } sh) vfx.Decal(at, SpillLen(), FireRed, d ?? 1, Vfx.Tele, 0.9f, shape: sh);
                    Snd(at, "lava-spill", 0.6f);
                    break;
                case "lavaSpillHit":
                    if (Spill() is { } sh2)
                    {
                        float len = SpillLen();
                        vfx.Decal(at, len, Fire, 3, Vfx.Lava, 1, shape: sh2);
                        vfx.Decal(at, len, Soot, 4, Vfx.Scorch, 0.8f, shape: sh2);
                        Snd(at, "lava-hit", 0.5f);
                        for (int i = 1; i <= 6; i++)
                        {
                            float u = i / 6f;
                            var p = P(x + (x2.Value - x) * u, y + 0.3f, z + (z2.Value - z) * u);
                            Later(u * 0.25f, () =>
                            {
                                vfx.Burst(p, FireRed, count: 10, speed: 4, life: 0.6f, size: 0.35f, grav: 3);
                                vfx.Burst(p, Fire, count: 5, speed: 1.5f, life: 0.8f, grav: -3, size: 0.8f, dir: Vector3.up, spread: 0.4f);
                            });
                        }
                    }
                    break;
                case "lavaFury":
                    vfx.Decal(at, R, FireRed, d ?? 1.5f, Vfx.Tele, 0.9f);
                    for (float t = 0; t < (d ?? 1.5f); t += 0.1f)
                        Later(t, () => vfx.Burst(P(x, y + 1.5f, z), Fire, count: 4, speed: 2, life: 0.6f, grav: -3, size: 0.5f));
                    Snd(at, "lava-roar");
                    break;
                case "lavaFuryHit":
                    vfx.Decal(at, R, FireCore, 0.7f, 5, 1);
                    vfx.Decal(at, R * 0.7f, Fire, 2, Vfx.Lava, 0.9f);
                    vfx.Burst(P(x, y + 1.2f, z), FireCore, count: 40, speed: 9, life: 0.9f, size: 0.45f, grav: 2);
                    vfx.Pillar(at, 1.5f, 8, Fire, 0.6f);
                    break;
                case "lavaMark":
                    vfx.Decal(at, R, FireRed, d ?? 3, Vfx.Tele, 0.95f);
                    Snd(at, "lava-mark");
                    break;
                case "lavaMarkHit":
                    vfx.Decal(at, R, Fire, 1.8f, Vfx.Lava, 1);
                    vfx.Decal(at, R, Soot, 4, Vfx.Scorch, 0.7f);
                    vfx.Burst(P(x, y + 0.5f, z), Fire, count: 26, speed: 6, life: 0.7f, size: 0.4f);
                    vfx.Burst(P(x, y + 0.3f, z), FireCore, count: 10, speed: 2, life: 0.8f, grav: -4, size: 0.9f, dir: Vector3.up, spread: 0.4f);
                    Snd(at, "lava-hit");
                    break;
                case "lavaRing":
                    vfx.Decal(at, R, FireRed, d ?? 1, Vfx.Tele, 0.9f);
                    Snd(at, "lava-ring", 0.7f);
                    break;
                case "lavaRingHit":
                    vfx.Decal(at, R, FireCore, 0.6f, 5, 1);
                    vfx.Decal(at, R * 0.8f, Fire, 3, Vfx.Lava, 1);
                    for (int i = 0; i < 12; i++)
                    {
                        float a = i / 12f * Mathf.PI * 2;
                        vfx.Burst(P(x + Mathf.Cos(a) * R * 0.9f, y + 0.2f, z + Mathf.Sin(a) * R * 0.9f), FireRed, count: 5, speed: 2.5f, life: 0.7f, grav: -4, size: 0.7f, dir: Vector3.up, spread: 0.3f);
                    }
                    Snd(at, "lava-hit", 0.7f);
                    break;
            }
        }

        // ---------------------------------------------------------------- воин: сталь и стягивание

        static void SteelAura(string k, string id, float x, float y, float z, float? d, float? r, int mode)
        {
            var vfx = V;
            var c = SteelMode[Mathf.Clamp(mode, 0, 2)];
            if (k == "steelBurn")
            {
                // Враг в зоне жара вспыхнул: язык пламени по телу, искры и короткий отсвет.
                var p0 = P(x, y + 0.3f, z);
                vfx.Burst(p0, c, count: 8, speed: 2.2f, life: 0.6f, grav: -5, size: 0.45f, dir: Vector3.up, spread: 0.3f);
                vfx.Burst(p0, FireCore, count: 5, speed: 3, life: 0.4f, grav: -3, size: 0.2f, dir: Vector3.up, spread: 0.5f);
                vfx.Flash(p0 + Vector3.up * 0.6f, c, 4, 4, 0.3f);
                return;
            }
            float dur = d ?? SteelDur, R = r ?? 6;
            // Сфера жара: от героя исходит раскалённый купол на весь радиус, внутри — марево и угли,
            // земля под ним тлеет. Враги внутри вспыхивают (steelBurn).
            B.HeatSphere(id, R, dur, c);
            vfx.Decal(P(x, y, z), R * 0.95f, c, dur, Vfx.Lava, 0.14f, Vfx.Follow.Hero, id);
            vfx.Burst(P(x, y + 1.1f, z), c, count: 16, speed: R * 1.2f, life: 0.45f, grav: 0, size: 0.22f);
            vfx.Flash(P(x, y + 1.2f, z), c, R * 2, 8, 0.5f);
            for (float t = 0; t < dur; t += 0.12f)
            {
                float tt = t;
                Later(t, () =>
                {
                    var h = Hero(id);
                    if (!h.HasValue) return;
                    var hp = h.Value;
                    // Угли поднимаются внутри сферы, у самого героя — гуще.
                    for (int i = 0; i < 2; i++)
                    {
                        float a = Rnd * Mathf.PI * 2, rr = Mathf.Pow(Rnd, 1.6f) * R * 0.9f;
                        vfx.Burst(hp + new Vector3(Mathf.Cos(a) * rr, 0.15f, Mathf.Sin(a) * rr), FireCore, count: 2, speed: 2.2f, life: 1.1f, grav: -2.5f, size: 0.08f, dir: Vector3.up, spread: 0.5f);
                    }
                    
                    if (Mathf.Repeat(tt, 0.48f) < 0.12f) vfx.Flash(hp + Vector3.up * 1.2f, c, R * 1.8f, 5 + 1.5f * Mathf.Sin(tt * 7), 0.55f);
                });
            }
        }

        static void Draw(string k, float x, float y, float z, float? d, float? x2, float? z2, float? r, int mode)
        {
            var vfx = V;
            var at = P(x, y, z);
            var edge = mode == 2 ? SteelHot : Steel;
            switch (k)
            {
                case "drawIn":
                {
                    float R = r ?? DrawR, T = d ?? DrawSec;
                    // Сжимающиеся кольца к воину и искры, летящие внутрь.
                    for (int i = 0; i < 4; i++)
                    {
                        float u = i / 4f;
                        Later(u * T, () => vfx.Decal(at, Mathf.Max(1, R * (1 - u)), Steel, 0.25f, 0, 0.8f));
                    }
                    for (int i = 0; i < 16; i++)
                    {
                        float a = i / 16f * Mathf.PI * 2, cx = Mathf.Cos(a), cz = Mathf.Sin(a);
                        vfx.Burst(P(x + cx * R, y + 1, z + cz * R), Steel, count: 4, speed: R / T * 0.9f, life: T, grav: 0, size: 0.18f, dir: new Vector3(-cx, 0, -cz), spread: 0.05f);
                    }
                    Snd(at, "steel-draw-start", 0.9f);
                    break;
                }
                case "drawPull":
                {
                    float tx = x2 ?? x, tz = z2 ?? z, ty = Ground(tx, tz, y) + 1.1f;
                    ClassFx.I?.Streak(x, y - 1, z, tx, tz, edge, 0.5f, d ?? DrawSec);
                    vfx.Burst(at, edge, count: 8, speed: 3, life: 0.4f, size: 0.16f, dir: new Vector3(tx - x, 0.2f, tz - z), spread: 0.2f);
                    if (Time.time - lastPull > 0.15f)
                    {
                        lastPull = Time.time;
                        Snd(at, "steel-draw-pull", 0.5f);
                    }
                    break;
                }
                case "drawImpact":
                    vfx.Decal(at, 1.8f, Steel, 0.4f, 5, 0.9f);
                    vfx.Burst(P(x, y + 0.5f, z), Steel, count: 18, speed: 5, life: 0.5f, grav: 8, size: 0.2f, dir: Vector3.up, spread: 0.8f);
                    vfx.Burst(P(x, y + 0.4f, z), edge, count: 10, speed: 2.5f, life: 0.6f, size: 0.18f);
                    vfx.Burst(P(x, y + 0.3f, z), Dust, count: 4, speed: 1.5f, life: 1.2f, grav: -0.5f, size: 1.1f, smoke: true);
                    Snd(at, "steel-draw-impact", 0.9f);
                    break;
            }
        }
    }
}
