using System.Collections.Generic;
using UnityEngine;
using static Zep.FxColors;

namespace Zep
{
    /// События умений героев и мобов-«особых» — перенос playClassAct / ultBlast / ultCastFx из
    /// client/ui/ClassFx.ts почти дословно. true — событие обработано целиком; false — пусть доиграет
    /// EffectsRouter (град: древки и звук остаются, здесь только зона и искры).
    public static class ClassActs
    {
        const int V_SUPPORT = 2, V_ASSASSIN = 3, V_BATTLEMAGE = 5;
        static readonly Color Light = new(0.85f, 0.95f, 1), Crit = new(1, 1, 0.85f);
        /// Цвета святилищ катакомб (CAT_SHRINES в shared/catacombs.ts).
        static readonly Color[] Shrine = { new(1, 0.35f, 0.15f), new(0.35f, 1, 0.45f), new(0.35f, 0.6f, 1), new(0.85f, 0.95f, 1) };
        /// ARROW_STORM.fall (shared/classes2.ts).
        const float StormFall = 0.3f;

        static Vfx V => Vfx.I;
        static ClassFx C => ClassFx.I;
        static float Rnd => Random.value;

        /// Звуки веба (ClassActCtx.sound) → сэмплы SoundBank.
        public static void Sound(Vector3 at, string kind)
        {
            switch (kind)
            {
                case "bash": SoundBank.At(at, "groundBash"); break;
                case "swing": SoundBank.At(at, "sword-swing"); break;
                case "horn": SoundBank.At(at, "bossHorn", range: 120); break;
                case "volley": SoundBank.At(at, "arrowVolley"); break;
                case "bow": SoundBank.At(at, "bow-shot-" + Random.Range(1, 6), 0.8f); break;
                case "fire": SoundBank.At(at, "fireball-hit-" + Random.Range(1, 4), 0.6f); break;
                case "holy": SoundBank.At(at, "levelUp"); break;
                case "fanfare": SoundBank.At(at, "bossFanfare", range: 120); break;
                case "ultW": SoundBank.At(at, "ultWarrior", range: 120); break;
                case "ultA": SoundBank.At(at, "ultArcher", range: 120); break;
                case "ultS": SoundBank.At(at, "ultSupport", range: 120); break;
                case "ultK": SoundBank.At(at, "ultAssassin", range: 120); break;
                case "ultP": SoundBank.At(at, "ultSpear", range: 120); break;
                case "ultB": SoundBank.At(at, "ultBattlemage", range: 120); break;
                default: SoundBank.At(at, "hitThud", 0.7f); break;
            }
        }

        static void Sample(Vector3 at, string name) => SoundBank.At(at, "hero-" + name);

        static void Emote(string id, string e)
        {
            if (id != null && WorldSync.Players.TryGetValue(id, out var pv) && pv) pv.Emote(e);
        }

        static Vector3 P(float x, float y, float z) => new(x, y, z);

        static void Later(float t, System.Action fn) => C.Later(t, fn);

        public static bool Play(string k, string id, float x, float y, float z, float? d, float? x2, float? z2, int? v, float? r, string mobId)
        {
            if (V == null || C == null) return false;
            var at = P(x, y, z);
            var vfx = V;
            var ATK = Attack;
            var HEALC = Heal;
            var DEF = Defense;
            switch (k)
            {
                case "ultWarn":
                {
                    float dd = Mathf.Max(0.4f, d ?? 5), rr = r ?? 10;
                    vfx.Decal(at, rr, ATK, Mathf.Max(0.2f, d ?? 5), 0, 0.35f);
                    vfx.Pillar(at, rr * 0.08f, 5, UltColor(v ?? 0), dd);
                    UltCast(v ?? 0, x, y, z, rr, dd);
                    vfx.Burst(P(x, y + 0.2f, z), ATK, count: 30, speed: 3, life: dd, grav: 0, size: 0.2f);
                    Sound(at, v == 2 ? "holy" : "horn");
                    return true;
                }
                case "ultHeal":
                    vfx.Pillar(at, 0.6f, 4.5f, Heal, 1.4f);
                    vfx.Decal(P(x, y + 0.05f, z), 1.6f, Heal, 1.0f, 0, 0.8f);
                    vfx.Burst(P(x, y + 0.5f, z), Heal, count: 22, speed: 1.8f, life: 1.1f, grav: -1.6f, size: 0.22f);
                    vfx.Burst(P(x, y + 1, z), Crit, count: 10, speed: 2.5f, life: 0.7f, grav: -1, size: 0.14f);
                    return true;
                case "ultSlow":
                    vfx.Decal(P(x, y - 0.5f, z), 1.2f, new Color(0.3f, 0.6f, 1), 6, 0, 0.6f);
                    vfx.Burst(P(x, y + 0.2f, z), new Color(0.55f, 0.85f, 1), count: 12, speed: 1.4f, life: 1.0f, grav: -0.6f, size: 0.16f);
                    return true;
                case "ultHit":
                {
                    UltBlast(v ?? 0, x, y, z, r ?? 10);
                    var snd = new[] { "ultW", "ultA", "ultS", "ultK", "ultP", "ultB" };
                    Sound(at, "fanfare");
                    Sound(at, snd[Mathf.Clamp(v ?? 0, 0, 5)]);
                    return true;
                }
                case "stunBash":
                    vfx.Decal(at, r ?? 5, ATK, Mathf.Max(0.2f, d ?? 0.5f), 0, 0.35f);
                    Sample(at, "sword-windup");
                    Later(Mathf.Max(0, d ?? 0.5f), () => Sample(at, "sword-impact"));
                    return true;
                case "stunHit":
                    vfx.Decal(at, r ?? 5, ATK, 0.55f, 0, 1);
                    vfx.Burst(P(x, y + 0.2f, z), ATK, count: 24, speed: 7, life: 0.55f, grav: 14, size: 0.2f);
                    return true;
                case "hammerWave":
                    vfx.Decal(at, d ?? 4, Lightning, 0.4f, 5, 0.7f);
                    vfx.Burst(at, Lightning, count: 10, speed: 4, life: 0.35f, grav: 6, size: 0.16f);
                    return true;
                case "spearPierce":
                    if (x2.HasValue && z2.HasValue)
                    {
                        float ddx = x2.Value - x, ddz = z2.Value - z;
                        vfx.Cone(P(x, y - 1.5f, z), Mathf.Sqrt(ddx * ddx + ddz * ddz), ddx, ddz, r ?? 0.6f, ATK, 0.32f, 0.75f);
                    }
                    return true;
                case "shadowStep":
                    if (x2.HasValue && z2.HasValue)
                    {
                        C.ShadowTrail(x, y, z, x2.Value, z2.Value);
                        C.Streak(x, y, z, x2.Value, z2.Value, Shadow, 0.6f, 0.4f);
                        vfx.Burst(P(x, y + 0.9f, z), Shadow, count: 14, speed: 3, life: 0.5f, grav: -2, size: 0.3f);
                        vfx.Burst(P(x2.Value, y + 0.9f, z2.Value), Shadow, count: 14, speed: 4, life: 0.45f, grav: -1, size: 0.25f);
                    }
                    if (v != V_ASSASSIN) Emote(id, "roll");
                    Sample(at, "shadow-step");
                    return true;
                case "leap":
                    if (x2.HasValue && z2.HasValue)
                    {
                        float lx = x2.Value, lz = z2.Value;
                        C.Streak(x, y, z, lx, lz, Shadow, 0.5f, 0.35f);
                        Later(d ?? 0.35f, () => vfx.Burst(P(lx, y + 0.6f, lz), ATK, count: 16, speed: 5, life: 0.4f, grav: 8, size: 0.2f));
                    }
                    Emote(id, "jump");
                    Sound(at, "swing");
                    return true;
                case "crushMark":
                    vfx.Decal(at, (r ?? 5) * 0.55f, ATK, d ?? 0.6f, 2, 0.9f);
                    Emote(id, "jump");
                    return true;
                case "leapMark":
                    vfx.Decal(at, r ?? 3.2f, ATK, d ?? 1.6f, 2, 0.95f);
                    return true;
                case "leapHit":
                    vfx.Decal(at, r ?? 3.2f, ATK, 0.6f, 0, 1.1f);
                    vfx.Burst(P(x, y + 0.2f, z), Gold, count: 26, speed: 8, life: 0.7f, grav: 16, size: 0.26f);
                    Sound(at, "bash");
                    return true;
                case "burrowDive":
                    vfx.Burst(P(x, y + 0.3f, z), Gold, count: 22, speed: 6, life: 0.8f, grav: 14, size: 0.3f);
                    vfx.Decal(at, 2.4f, Gold, 0.8f, 0, 0.7f);
                    Sound(at, "bash");
                    return true;
                case "burrowTrail":
                    vfx.Burst(P(x, y + 0.1f, z), Gold, count: 5, speed: 2.2f, life: 0.55f, grav: 7, size: 0.22f);
                    return true;
                case "burrowMark":
                    vfx.Decal(at, r ?? 3.6f, ATK, d ?? 1.1f, 2, 0.95f);
                    vfx.Burst(P(x, y + 0.1f, z), Gold, count: 12, speed: 3, life: 0.6f, grav: 9, size: 0.2f);
                    return true;
                case "burrowHit":
                    vfx.Decal(at, r ?? 3.6f, ATK, 0.6f, 0, 1.2f);
                    vfx.Burst(P(x, y + 0.3f, z), Gold, count: 34, speed: 10, life: 0.8f, grav: 16, size: 0.3f);
                    vfx.Pillar(at, 1.6f, 3.5f, Gold, 0.4f);
                    Sound(at, "bash");
                    return true;
                case "stormMark":
                    vfx.Decal(at, r ?? 2.4f, Lightning, d ?? 1.4f, 2, 0.95f);
                    return true;
                case "stormHit":
                    vfx.Lightning(P(x + 0.5f, y + 12, z), P(x, y + 0.15f, z), y, 0.35f);
                    vfx.Burst(P(x, y + 0.4f, z), LightningCore, count: 18, speed: 7, life: 0.4f, grav: 6, size: 0.2f);
                    Sample(at, "storm-zap");
                    return true;
                case "stormJump":
                    Sample(at, "storm-jump");
                    if (x2.HasValue && z2.HasValue) vfx.Lightning(P(x, y + 1.1f, z), P(x2.Value, y + 1.1f, z2.Value), null, 0.38f);
                    return true;
                case "pierceShot":
                    if (x2.HasValue && z2.HasValue)
                    {
                        C.Streak(x, y + 1.1f, z, x2.Value, z2.Value, Gold, 0.25f, 0.3f);
                        vfx.Burst(P(x2.Value, y + 1.1f, z2.Value), Gold, count: 10, speed: 4, life: 0.35f, grav: 6, size: 0.15f);
                    }
                    return true;
                case "ninjaSmoke":
                    vfx.Burst(P(x, y + 1, z), ShadowDark, count: 26, speed: 3.5f, life: 0.9f, grav: -1.5f, size: 0.55f);
                    vfx.Burst(P(x, y + 0.6f, z), Shadow, count: 14, speed: 2, life: 0.7f, grav: -1, size: 0.4f);
                    Sample(at, "smoke-puff");
                    return true;
                case "parryOn":
                    vfx.Decal(at, r ?? 2.2f, ShadowDark, d ?? 1.6f, 1, 0.9f);
                    vfx.Burst(P(x, y + 1, z), ShadowDark, count: 18, speed: 2.5f, life: 0.7f, grav: -1, size: 0.4f);
                    Sound(at, "swing");
                    return true;
                case "parryHit":
                    vfx.Burst(P(x, y + 1.2f, z), Shadow, count: 14, speed: 7, life: 0.35f, grav: 4, size: 0.18f);
                    Sound(at, "bash");
                    return true;
                case "caltrops":
                    Sample(at, "caltrops");
                    vfx.Decal(at, r ?? 1.4f, ATK, d ?? 6, 1, 0.55f);
                    vfx.Burst(P(x, y + 0.1f, z), Other, count: 8, speed: 2, life: 0.4f, grav: 8, size: 0.12f);
                    return true;
                case "crushHit":
                    vfx.Decal(at, r ?? 5, ATK, 0.65f, 0, 1.2f);
                    vfx.Burst(P(x, y + 0.2f, z), ATK, count: 28, speed: 9, life: 0.7f, grav: 16, size: 0.26f);
                    vfx.Pillar(at, 1.4f, 4, ATK, 0.35f);
                    Sample(at, "ground-slam");
                    return true;
                case "seal":
                {
                    var cc = v == V_BATTLEMAGE ? ATK : v == 0 ? DEF : v == V_SUPPORT ? HEALC : Other;
                    vfx.Decal(at, r ?? 5, cc, d ?? 6, 1, 1);
                    if (v == V_BATTLEMAGE) C.StormZone(at, r ?? 5, d ?? 6);
                    else vfx.Pillar(at, (r ?? 5) * 0.9f, 2.5f, cc, 0.8f);
                    Emote(id, "cheer");
                    Sample(at, "holy-seal");
                    return true;
                }
                case "spearFlurry":
                    vfx.Burst(P(x, y + 1.2f, z), ATK, count: 10, speed: 5, life: 0.3f, grav: 0, size: 0.14f);
                    Sample(at, "spear-thrust");
                    return true;
                case "whirl":
                    vfx.Decal(at, r ?? 3.2f, ATK, d ?? 2, 1, 1, Vfx.Follow.Hero, id);
                    C.SpinSparks(id, r ?? 3.2f, ATK, d ?? 2);
                    Sound(at, "swing");
                    return true;
                case "warcry":
                    vfx.Decal(at, r ?? 12, Buff, 0.9f, 0, 0.8f);
                    vfx.Pillar(at, 0.9f, 5, Buff, 1.1f, Vfx.Follow.Hero, id);
                    vfx.Burst(P(x, y + 1, z), Buff, count: 24, speed: 3, life: 1.1f, grav: -3, size: 0.24f);
                    Emote(id, "cheer");
                    Sound(at, "bash");
                    return true;
                case "plagueOn":
                    vfx.Pillar(at, 0.5f, 2.2f, Poison, d ?? 8, Vfx.Follow.Hero, id);
                    vfx.Burst(P(x, y + 1, z), Poison, count: 14, speed: 2, life: 0.6f, grav: -2, size: 0.18f);
                    Sound(at, "swing");
                    return true;
                case "catBoss":
                {
                    bool fin = r == 1;
                    float dur = d ?? 4;
                    vfx.Decal(at, fin ? 7 : 4.5f, Arcane, dur, 0, 0.9f);
                    vfx.Decal(at, fin ? 9 : 6, ShadowDark, dur + 1, 2, 1);
                    vfx.Pillar(at, fin ? 2.4f : 1.4f, fin ? 14 : 9, ShadowDark, dur + 0.6f);
                    for (int i = 0; i < Mathf.CeilToInt(dur * 2); i++)
                        Later(i * 0.5f, () => vfx.Burst(P(x, y + 0.3f, z), Arcane, count: fin ? 30 : 18, speed: fin ? 7 : 5, life: 0.8f, grav: -3, size: 0.3f));
                    Later(dur, () =>
                    {
                        vfx.Burst(P(x, y + 1, z), Arcane, count: fin ? 80 : 45, speed: fin ? 14 : 9, life: 1.1f, grav: 4, size: 0.35f);
                        vfx.Decal(at, fin ? 10 : 6, Arcane, 0.8f, 0, 1.2f);
                        Sample(at, "cat-slam");
                    });
                    Sample(at, "cat-charge");
                    return true;
                }
                case "catHazard":
                {
                    var col = v == 1 ? Fire : v == 2 ? Arcane : v == 3 ? Moon : Gold;
                    float life = d ?? 1.7f;
                    vfx.Decal(at, r ?? 2.8f, col, life, 2, 1);
                    vfx.Decal(at, r ?? 2.8f, col, life, 1, 0.35f);
                    for (int i = 0; i < 3; i++)
                    {
                        if (v == 0) Later(i * 0.45f, () => vfx.Burst(P(x, y + 9, z), Shadow, count: 10, speed: 1, life: 1.2f, grav: 9, size: 0.18f));
                        else if (v == 1) Later(i * 0.45f, () => vfx.Burst(P(x, y + 0.2f, z), Fire, count: 8, speed: 1.5f, life: 0.6f, grav: -4, size: 0.18f));
                        else if (v == 3) Later(i * 0.45f, () => vfx.Burst(P(x, y + 12, z), Moon, count: 10, speed: 0.8f, life: 1.2f, grav: 7, size: 0.2f));
                        else Later(i * 0.45f, () => vfx.Burst(P(x, y + 0.2f, z), Arcane, count: 8, speed: 2, life: 0.7f, grav: -5, size: 0.2f));
                    }
                    return true;
                }
                case "catHazardHit":
                {
                    float rr = r ?? 2.8f;
                    if (v == 0)
                    {
                        for (int i = 0; i < 5; i++)
                        {
                            float a = Rnd * Mathf.PI * 2, d2 = Rnd * rr * 0.8f;
                            float rx = x + Mathf.Cos(a) * d2, rz = z + Mathf.Sin(a) * d2;
                            Later(i * 0.05f, () => vfx.Burst(P(rx, y + 10, rz), Shadow, count: 3, speed: 0.4f, life: 0.5f, grav: 40, size: 0.8f));
                        }
                        Later(0.3f, () =>
                        {
                            vfx.Decal(at, rr * 1.2f, Gold, 0.7f, 0, 1);
                            vfx.Burst(P(x, y + 0.5f, z), Shadow, count: 40, speed: 6, life: 1.4f, grav: 2, size: 0.7f);
                            Sample(at, "cat-rockfall");
                        });
                    }
                    else if (v == 1)
                    {
                        vfx.Pillar(at, rr * 0.7f, 7, Fire, 0.9f);
                        vfx.Burst(P(x, y + 0.5f, z), Fire, count: 50, speed: 7, life: 0.9f, grav: -6, size: 0.45f);
                        vfx.Burst(P(x, y + 0.5f, z), FireCore, count: 25, speed: 4, life: 0.6f, grav: -8, size: 0.35f);
                        vfx.Decal(at, rr, Fire, 1.2f, 0, 1);
                        Sound(at, "thud");
                    }
                    else if (v == 3)
                    {
                        vfx.Burst(P(x, y + 14, z), Moon, count: 6, speed: 0.3f, life: 0.35f, grav: 60, size: 0.9f);
                        Later(0.3f, () =>
                        {
                            vfx.Pillar(at, rr * 0.45f, 9, Moon, 0.8f);
                            vfx.Decal(at, rr * 1.15f, Moon, 0.9f, 0, 1);
                            vfx.Burst(P(x, y + 0.6f, z), Moon, count: 45, speed: 8, life: 0.9f, grav: 6, size: 0.35f);
                            Sample(at, "cat-crystal");
                        });
                    }
                    else
                    {
                        vfx.Pillar(at, rr * 0.6f, 11, Arcane, 1.1f);
                        vfx.Burst(P(x, y + 0.5f, z), Arcane, count: 45, speed: 9, life: 1.1f, grav: -10, size: 0.35f);
                        vfx.Decal(at, rr * 1.3f, ShadowDark, 1, 0, 1);
                        Sample(at, "cat-soul");
                    }
                    return true;
                }
                case "raidTide":
                    vfx.Burst(P(x, y + 1, z), Moon, count: 70, speed: 16, life: 1.1f, grav: 0, size: 0.5f);
                    vfx.Pillar(at, 3, 14, Moon, 1);
                    vfx.Decal(at, 30, Moon, 2.5f, 0, 0.8f);
                    Sound(at, "bash");
                    return true;
                case "raidBreath":
                    vfx.Burst(P(x, y + 0.8f, z), FireCore, count: 80, speed: 20, life: 0.8f, grav: 0, size: 0.45f);
                    vfx.Decal(at, 28, FireCore, 0.6f, 0, 1);
                    Sound(at, "bash");
                    return true;
                case "raidFall":
                    vfx.Burst(P(x, y + 0.5f, z), Arcane, count: 30, speed: 3, life: 1, grav: 9, size: 0.4f);
                    Sound(at, "thud");
                    return true;
                case "catGate":
                {
                    float life = (d ?? 1.4f) + 0.6f;
                    vfx.Decal(at, 2.2f, Arcane, life, 1, 1);
                    vfx.Pillar(at, 1.3f, 5, ShadowDark, life);
                    for (int i = 0; i < 5; i++) Later(i * 0.3f, () => vfx.Burst(P(x, y + 1.2f, z), Arcane, count: 16, speed: 3, life: 0.8f, grav: -2, size: 0.3f));
                    Later(d ?? 1.4f, () => vfx.Burst(P(x, y + 1, z), Arcane, count: 36, speed: 7, life: 0.9f, grav: 3, size: 0.32f));
                    Sample(at, "cat-gate");
                    return true;
                }
                case "catShield":
                    if (d == 1 && mobId != null)
                    {
                        vfx.Pillar(at, 4.2f, 9, Arcane, 6, Vfx.Follow.Mob, mobId);
                        vfx.Decal(at, 5, Arcane, 6, 1, 0.8f, Vfx.Follow.Mob, mobId, 0.05f);
                    }
                    else
                    {
                        vfx.Burst(P(x, y + 3, z), Arcane, count: 90, speed: 14, life: 1.2f, grav: 6, size: 0.4f);
                        vfx.Decal(at, 9, Arcane, 0.9f, 0, 1.2f);
                        Sample(at, "cat-shield");
                    }
                    return true;
                case "catDust":
                    vfx.Burst(P(x, y + 0.6f, z), Shadow, count: 26, speed: 3, life: 1.3f, grav: -1.5f, size: 0.5f + (r ?? 0.5f) * 0.3f);
                    vfx.Burst(P(x, y + 0.6f, z), Arcane, count: 14, speed: 4, life: 0.8f, grav: -3, size: 0.2f);
                    return true;
                case "catShrine":
                {
                    var col = Shrine[Mathf.Clamp(v ?? 0, 0, Shrine.Length - 1)];
                    vfx.Pillar(at, 0.9f, 6, col, 1.6f, Vfx.Follow.Hero, id);
                    vfx.Decal(at, 2.4f, col, 1.4f, 1, 1, Vfx.Follow.Hero, id, 0.05f);
                    vfx.Burst(P(x, y + 1, z), col, count: 30, speed: 4, life: 1.1f, grav: -4, size: 0.25f);
                    return true;
                }
                case "catChest":
                {
                    bool fin = r == 1;
                    vfx.Pillar(at, fin ? 2 : 1.2f, fin ? 16 : 10, Gold, fin ? 6 : 4);
                    vfx.Decal(at, fin ? 6 : 3.5f, Gold, fin ? 6 : 4, 1, 1);
                    for (int i = 0; i < (fin ? 8 : 4); i++)
                        Later(i * 0.35f, () => vfx.Burst(P(x, y + 1.2f, z), Gold, count: fin ? 40 : 24, speed: 8, life: 1, grav: 10, size: 0.25f));
                    Sample(at, "cat-chest");
                    return true;
                }
                case "bleedTick":
                    return true;
                case "poisonStack":
                case "venomStack":
                {
                    var col = k == "poisonStack" ? Poison : Venom;
                    float n = r ?? 1;
                    if (mobId != null) vfx.Decal(at, 0.3f + n * 0.11f, col, d ?? 3, 1, 0.45f + n * 0.1f, Vfx.Follow.Mob, mobId, 0.1f);
                    vfx.Burst(P(x, y + 0.8f, z), col, count: 4 + (int)n * 2, speed: 2.5f, life: 0.45f, grav: 3, size: 0.14f);
                    return true;
                }
                case "plagueBurst":
                case "venomBurst":
                {
                    var col = k == "plagueBurst" ? Poison : Venom;
                    vfx.Decal(at, r ?? 3, col, 0.6f, 4, 1.1f);
                    vfx.Burst(P(x, y + (d ?? 0.6f), z), col, count: 26, speed: 6, life: 0.6f, grav: 4, size: 0.24f);
                    Sound(at, "thud");
                    return true;
                }
                case "smoke":
                {
                    float dur = d ?? 6;
                    vfx.Decal(at, r ?? 3.5f, Shadow, dur, 1, 0.9f);
                    vfx.Pillar(at, (r ?? 3.5f) * 0.85f, 2.2f, Shadow, dur);
                    for (int i = 0; i < Mathf.CeilToInt(dur * 2); i++)
                        Later(i * 0.5f, () => vfx.Burst(P(x, y + 0.6f, z), Shadow, count: 22, speed: 2.2f, life: 1.6f, grav: -0.5f, size: 0.8f));
                    Sound(at, "thud");
                    return true;
                }
                case "soulSteal":
                    if (x2.HasValue && z2.HasValue)
                    {
                        vfx.Bolt(at, P(x2.Value, d ?? y, z2.Value), Arcane, 0.4f, 0.07f);
                        vfx.Burst(at, Arcane, count: 12, speed: 4, life: 0.4f, grav: -2, size: 0.2f);
                    }
                    Sound(at, "swing");
                    return true;
                case "abyss":
                    vfx.Decal(at, 1.2f, ShadowDark, d ?? 3, 1, 1, Vfx.Follow.Hero, id);
                    vfx.Pillar(at, 0.7f, 2.4f, ShadowDark, d ?? 3, Vfx.Follow.Hero, id);
                    vfx.Burst(P(x, y + 0.9f, z), Shadow, count: 22, speed: 3, life: 0.6f, grav: -2, size: 0.35f);
                    Sound(at, "swing");
                    return true;
                case "markOn":
                    if (mobId != null)
                    {
                        vfx.EndMobMarks(mobId);
                        vfx.Decal(at, 1.1f, ATK, d ?? 8, 2, 1, Vfx.Follow.Mob, mobId, 0.4f);
                        vfx.Pillar(at, 0.5f, 9, ATK, 0.5f, Vfx.Follow.Mob, mobId);
                    }
                    return true;
                case "reflectHit":
                {
                    // Щит отразил удар: вспышка у щита (в руке героя — примерно у груди), ряд искр в моба, столб в нём.
                    var sp = id != null && WorldSync.Players.TryGetValue(id, out var pv) && pv ? pv.Head + Vector3.down * 0.5f : at;
                    vfx.Burst(sp, Reflect, count: 26, speed: 6, life: 0.45f, grav: 0, size: 0.28f);
                    vfx.Burst(sp, ReflectBolt, count: 12, speed: 3, life: 0.35f, grav: 0, size: 0.2f);
                    if (x2.HasValue && z2.HasValue)
                    {
                        var to = P(x2.Value, d ?? y, z2.Value);
                        const int STEPS = 7;
                        const float TRAVEL = 0.4f;
                        for (int i = 1; i <= STEPS; i++)
                        {
                            float kk = i / (float)STEPS;
                            Later(TRAVEL * (kk - 1f / STEPS), () =>
                            {
                                var pp = Vector3.Lerp(sp, to, kk);
                                vfx.Burst(pp, ReflectBolt, count: 7, speed: 1.5f, life: 0.28f, grav: 0, size: 0.24f);
                                vfx.Burst(pp, Reflect, count: 3, speed: 1, life: 0.2f, grav: 0, size: 0.14f);
                            });
                        }
                        Later(TRAVEL, () =>
                        {
                            vfx.Burst(to, ReflectBolt, count: 34, speed: 8, life: 0.55f, grav: 3, size: 0.32f);
                            vfx.Burst(to, Reflect, count: 16, speed: 5, life: 0.4f, grav: 0, size: 0.22f);
                            vfx.Pillar(to + Vector3.down * 1.2f, 0.7f, 3.4f, ReflectBolt, 0.45f);
                        });
                    }
                    return true;
                }
                case "skillShot":
                    if (id != null && WorldSync.Players.TryGetValue(id, out var shooter) && shooter) shooter.OnAct("bow");
                    Sound(at, (r ?? 1) > 1 ? "volley" : "bow");
                    return true;
                case "blastArrow":
                    if (x2.HasValue && z2.HasValue)
                    {
                        var to = P(x2.Value, d ?? y, z2.Value);
                        float R = r ?? 5;
                        C.Fly(at, to, onHit: () =>
                        {
                            vfx.Burst(to, FireCore, count: 26, speed: 9, life: 0.5f, grav: 4, size: 0.3f);
                            vfx.Burst(to, Fire, count: 18, speed: 5, life: 0.8f, grav: -1, size: 0.55f);
                            vfx.Decal(to + Vector3.down * 0.9f, R, Fire, 0.5f, 0, 1);
                            C.Ring(to + Vector3.down * 0.9f, 0.3f, R, FireCore, 0.35f, 0.8f);
                            Sample(to, "blast-boom");
                        });
                    }
                    return true;
                case "stormWave":
                {
                    float R = r ?? 12;
                    if (!(d > 0))
                    {
                        for (int i = 0; i < 10; i++)
                        {
                            float a = i / 10f * Mathf.PI * 2;
                            C.Fly(P(x, y + 1.4f, z), P(x + Mathf.Cos(a) * 3, y + 18, z + Mathf.Sin(a) * 3), 0.45f, 0);
                        }
                        return true;
                    }
                    for (int i = 0; i < 14; i++)
                    {
                        float a = Rnd * Mathf.PI * 2, rr = Mathf.Sqrt(Rnd) * R;
                        float px = x + Mathf.Cos(a) * rr, pz = z + Mathf.Sin(a) * rr;
                        C.Fly(P(px + 1.2f, y + 16, pz + 0.5f), P(px, y + 0.25f, pz), StormFall, 0, 0.9f,
                            () => vfx.Burst(P(px, y + 0.15f, pz), Gold, count: 5, speed: 3, life: 0.35f, grav: 10, size: 0.13f));
                    }
                    Later(StormFall, () =>
                    {
                        vfx.Decal(at, R, ATK, 0.55f, 0, 0.9f);
                        C.Ring(at, 0.6f, R, Gold, 0.45f, 0.7f);
                        Sound(at, "volley");
                    });
                    return true;
                }
                case "ghostOn":
                    vfx.Decal(at, 1.3f, Frost, d ?? 4, 1, 0.8f, Vfx.Follow.Hero, id);
                    vfx.Pillar(at, 0.75f, 2.6f, Frost, d ?? 4, Vfx.Follow.Hero, id);
                    vfx.Burst(P(x, y + 1, z), IceRim, count: 24, speed: 3, life: 0.7f, grav: -2, size: 0.3f);
                    Sound(at, "swing");
                    return true;
                case "swarmArrow":
                    if (x2.HasValue && z2.HasValue)
                    {
                        var to = P(x2.Value, d ?? y, z2.Value);
                        float rr = r ?? 0;
                        C.Fly(at, to, onHit: rr > 0 ? () =>
                        {
                            vfx.Burst(to, Fire, count: 14, speed: 6, life: 0.45f, grav: 3, size: 0.24f);
                            vfx.Decal(to + Vector3.down * 0.9f, rr, Buff, 0.4f, 0, 0.8f);
                        } : null);
                    }
                    return true;
                case "arrowBarrier":
                {
                    float R = r ?? 4, dur = d ?? 4;
                    C.Seal(at, R, DEF, dur);
                    vfx.Decal(at, R, DEF, dur, 1, 0.7f);
                    C.Ring(at, 0.5f, R, DEF, 0.4f, 0.9f);
                    for (int i = 0; i < 12; i++)
                    {
                        float a = i / 12f * Mathf.PI * 2;
                        float px = x + Mathf.Cos(a) * R, pz = z + Mathf.Sin(a) * R;
                        C.Fly(P(px + Mathf.Cos(a) * 2.5f, y + 12, pz + Mathf.Sin(a) * 2.5f), P(px, y + 0.35f, pz), 0.35f, 0, Mathf.Max(0.3f, dur - 0.35f),
                            () => vfx.Burst(P(px, y + 0.15f, pz), Gold, count: 5, speed: 3, life: 0.35f, grav: 8, size: 0.13f));
                    }
                    return true;
                }
                case "barrierHit":
                    vfx.Burst(at, DEF, count: 14, speed: 6, life: 0.4f, grav: 4, size: 0.22f);
                    if (x2.HasValue && z2.HasValue) C.Streak(x2.Value, y - 1, z2.Value, x, z, DEF, 0.35f, 0.3f);
                    Sound(at, "thud");
                    return true;
                case "webShot":
                    Sample(at, "web-shot");
                    if (x2.HasValue && z2.HasValue)
                    {
                        var to = P(x2.Value, (d ?? y) + 0.3f, z2.Value);
                        C.Fly(at, to, stick: 1.5f, onHit: () => vfx.Burst(to, IceRim, count: 20, speed: 5, life: 0.5f, grav: 6, size: 0.16f));
                    }
                    return true;
                case "webZone":
                {
                    float R = r ?? 6, dur = d ?? 5;
                    vfx.Decal(at, R, Shadow, dur, 1, 0.85f);
                    C.Ring(at, 0.4f, R, IceRim, 0.5f, 0.7f);
                    for (int i = 0; i < Mathf.CeilToInt(dur); i++)
                        Later(0.15f + i, () =>
                        {
                            float a = Rnd * Mathf.PI * 2, rr = Rnd * R * 0.8f;
                            vfx.Burst(P(x + Mathf.Cos(a) * rr, y + 0.15f, z + Mathf.Sin(a) * rr), IceRim, count: 10, speed: 2, life: 0.6f, grav: 1, size: 0.12f);
                        });
                    Sound(at, "thud");
                    return true;
                }
                case "lifeArrow":
                    if (x2.HasValue && z2.HasValue)
                    {
                        var to = P(x2.Value, d ?? y, z2.Value);
                        C.Fly(at, to, onHit: () =>
                        {
                            vfx.Burst(to, Gold, count: 14, speed: 5, life: 0.4f, grav: 2, size: 0.2f);
                            vfx.Bolt(to, at, HEALC, 0.45f, 0.07f);
                            vfx.Burst(P(x, y - 0.6f, z), HEALC, count: 24, speed: 3, life: 0.9f, grav: -4, size: 0.22f);
                            vfx.Decal(P(x, y - 1.6f, z), 1.6f, HEALC, 1, 1, 0.9f, Vfx.Follow.Hero, id, 0.05f);
                        });
                    }
                    return true;
                case "chainHit":
                    if (x2.HasValue && z2.HasValue)
                    {
                        var to = P(x2.Value, d ?? y, z2.Value);
                        bool sup = v == V_SUPPORT;
                        Later((r ?? 0) * 0.09f, () =>
                        {
                            if (sup)
                            {
                                vfx.Bolt(at, to, HEALC, 0.32f, 0.06f);
                                vfx.Burst(to, HEALC, count: 10, speed: 4, life: 0.35f, grav: -3, size: 0.18f);
                            }
                            else vfx.Lightning(at, to, null, 0.38f);
                        });
                    }
                    return true;
                case "fanKnives":
                    if (x2.HasValue && z2.HasValue)
                    {
                        float tx = x2.Value, tz = z2.Value;
                        int n = (int)(d ?? 3);
                        for (int i = 0; i < n; i++)
                            Later(0.1f + i * 0.18f, () =>
                            {
                                vfx.Burst(P(x, y + 1.1f, z), ATK, count: 18, speed: 16, life: 0.5f, grav: 1, size: 0.14f, dir: new Vector3(tx - x, 0, tz - z), spread: 0.32f);
                                C.Streak(x, y, z, tx, tz, ATK, 2.5f, 0.25f);
                            });
                        Sample(at, "knife-fan");
                    }
                    return true;
                case "arrowRain":
                    Sample(at, "arrow-whistle");
                    Later(Mathf.Max(0, d ?? 0.9f), () => Sample(at, "arrow-impact"));
                    vfx.Decal(at, r ?? 6.5f, ATK, (d ?? 0.9f) + 3, 1, 0.8f);
                    return false;
                case "rainTick":
                    for (int i = 0; i < 3; i++)
                    {
                        float a = Rnd * Mathf.PI * 2, rr = Rnd * 4;
                        vfx.Burst(P(x + Mathf.Cos(a) * rr, y + 0.1f, z + Mathf.Sin(a) * rr), ATK, count: 8, speed: 4, life: 0.35f, grav: 12, size: 0.14f);
                    }
                    return false;
                case "healAura":
                {
                    Sample(at, "heal-chime");
                    float dur = d ?? 6;
                    vfx.Decal(at, r ?? 8, HEALC, dur, 1, 0.9f, Vfx.Follow.Hero, id);
                    vfx.Pillar(at, 0.8f, 3.2f, HEALC, dur, Vfx.Follow.Hero, id);
                    C.HealSparkles(id, r ?? 8, dur);
                    if (v != V_BATTLEMAGE) Emote(id, "cheer");
                    return true;
                }
                case "healHit":
                    vfx.Burst(P(x, y - 0.8f, z), HEALC, count: 12, speed: 1.6f, life: 0.9f, grav: -2.5f, size: 0.2f);
                    return false;
                default:
                    return false;
            }
        }

        static Color UltColor(int v) => v >= 0 && v < Ult.Length ? Ult[v] : Gold;

        /// Удар ультимейта — каждый показывает ту механику, что на сервере (SKILL → ZoneRoom.applyUlt).
        static void UltBlast(int v, float x, float y, float z, float r)
        {
            var vfx = V;
            var c = UltColor(v);
            var at = P(x, y, z);
            void RingTo(float sec, float rad, float life, float alpha) => Later(sec, () => vfx.Decal(P(x, y + 0.05f, z), rad, c, life, 0, alpha));
            Vector2 RndInRing()
            {
                float a = Rnd * Mathf.PI * 2, dd = Mathf.Sqrt(Rnd) * r;
                return new Vector2(x + Mathf.Cos(a) * dd, z + Mathf.Sin(a) * dd);
            }
            switch (v)
            {
                case 0:
                    vfx.Pillar(at, r * 0.1f, 12, c, 1.0f);
                    for (int k = 1; k <= 4; k++) RingTo(k * 0.12f, r * k / 4, 0.7f, 0.9f);
                    for (int i = 0; i < 10; i++)
                    {
                        float a = i / 10f * Mathf.PI * 2 + Rnd * 0.3f;
                        vfx.Bolt(P(x, y + 0.1f, z), P(x + Mathf.Cos(a) * r, y + 0.1f, z + Mathf.Sin(a) * r), c, 0.9f, 0.12f);
                    }
                    for (int i = 0; i < 40; i++)
                    {
                        var q = RndInRing();
                        vfx.Burst(P(q.x, y + 0.3f, q.y), c, count: 6, speed: 9, life: 0.8f, grav: 14, size: 0.3f);
                    }
                    for (int i = 0; i < 16; i++)
                    {
                        float a = i / 16f * Mathf.PI * 2;
                        vfx.Burst(P(x + Mathf.Cos(a) * r, y + 0.4f, z + Mathf.Sin(a) * r), Gold, count: 5, speed: 5, life: 0.9f, grav: 9, size: 0.35f);
                    }
                    vfx.Decal(P(x, y + 0.05f, z), r, c, 5, 0, 0.22f);
                    vfx.Decal(P(x, y + 0.06f, z), r * 0.6f, c, 5, 0, 0.12f);
                    Later(0.3f, () => Sound(at, "thud"));
                    return;
                case 1:
                    for (int w = 0; w < 3; w++)
                    {
                        int ww = w;
                        Later(w * 1.0f, () =>
                        {
                            if (ww > 0) Sound(at, "volley");
                            for (int i = 0; i < 16; i++)
                            {
                                var q = RndInRing();
                                C.Fly(P(q.x + 1.5f, y + 18, q.y + 0.6f), P(q.x, y + 0.25f, q.y), 0.3f, 0, 1, () =>
                                {
                                    vfx.Burst(P(q.x, y + 0.2f, q.y), c, count: 6, speed: 4, life: 0.5f, grav: 6, size: 0.18f);
                                    vfx.Burst(P(q.x, y + 0.1f, q.y), Gold, count: 3, speed: 2, life: 0.3f, grav: 8, size: 0.12f);
                                });
                            }
                            RingTo(0, r, 0.6f, 0.7f);
                        });
                    }
                    vfx.Decal(P(x, y + 0.05f, z), r, c, 5, 0, 0.2f);
                    return;
                case 2:
                    RingTo(0, r, 0.9f, 0.85f);
                    for (int j = 0; j < 8; j++)
                    {
                        float a = j / 8f * Mathf.PI * 2;
                        vfx.Pillar(P(x + Mathf.Cos(a) * r, y, z + Mathf.Sin(a) * r), 0.35f, 4.5f, Light, 1.4f);
                    }
                    for (int i = 0; i < 30; i++)
                    {
                        var q = RndInRing();
                        vfx.Burst(P(q.x, y + 0.3f, q.y), Light, count: 4, speed: 1.2f, life: 1.3f, grav: -1.4f, size: 0.18f);
                    }
                    Later(0.45f, () => Sound(at, "holy"));
                    vfx.Decal(P(x, y + 0.05f, z), r, c, 6, 0, 0.18f);
                    for (int k = 1; k <= 5; k++) Later(k, () => vfx.Decal(P(x, y + 0.05f, z), r, c, 0.9f, 0, 0.35f));
                    return;
                case 3:
                {
                    const int HITS = 16;
                    const float STEP = 0.15f;
                    vfx.Burst(P(x, y + 1, z), c, count: 20, speed: 5, life: 0.5f, grav: 2, size: 0.25f);
                    RingTo(0, r, 0.5f, 0.5f);
                    for (int i = 0; i < HITS; i++)
                    {
                        int ii = i;
                        Later(i * STEP, () =>
                        {
                            float a = ii / (float)HITS * Mathf.PI * 4;
                            float dd = r * (0.35f + 0.65f * ((ii * 7) % HITS) / HITS);
                            var p = P(x + Mathf.Cos(a) * dd, y + 1, z + Mathf.Sin(a) * dd);
                            vfx.Bolt(P(x, y + 1.2f, z), p, c, 0.12f, 0.05f);
                            vfx.Burst(p, c, count: 10, speed: 7, life: 0.4f, grav: 6, size: 0.22f);
                            vfx.Burst(p, Crit, count: 4, speed: 3, life: 0.25f, grav: 0, size: 0.12f);
                            if (ii % 4 == 0) Sound(at, "swing");
                        });
                    }
                    Later(HITS * STEP, () =>
                    {
                        RingTo(0, r, 0.7f, 0.6f);
                        for (int i = 0; i < 24; i++)
                        {
                            var q = RndInRing();
                            vfx.Burst(P(q.x, y + 0.5f, q.y), c, count: 4, speed: 8, life: 0.7f, grav: 4, size: 0.3f);
                        }
                        vfx.Burst(P(x, y + 1.5f, z), Crit, count: 30, speed: 6, life: 0.6f, grav: 1, size: 0.25f);
                        Sound(at, "thud");
                    });
                    return;
                }
                case 4:
                    vfx.Burst(P(x, y + 0.2f, z), c, count: 40, speed: 7, life: 0.7f, grav: 10, size: 0.35f);
                    RingTo(0, r, 0.5f, 0.6f);
                    Sound(at, "thud");
                    for (int k = 0; k < 6; k++)
                    {
                        int kk = k;
                        Later(0.1f * (k + 1), () =>
                        {
                            vfx.Decal(P(x, y + 0.05f, z), Mathf.Max(0.5f, r * (1 - kk / 7f)), c, 0.35f, 0, 0.35f);
                            for (int i = 0; i < 28; i++)
                            {
                                var q = RndInRing();
                                float dx = x - q.x, dz = z - q.y, l = Mathf.Max(1e-3f, Mathf.Sqrt(dx * dx + dz * dz));
                                vfx.Burst(P(q.x, y + 0.4f, q.y), c, count: 3, speed: 8, life: 0.5f, grav: 0, size: 0.2f, dir: new Vector3(dx / l, 0.1f, dz / l), spread: 0.25f);
                            }
                            if (kk == 2 || kk == 4) Sound(at, "swing");
                            if (kk == 5) Sound(at, "thud");
                        });
                    }
                    Later(0.7f, () =>
                    {
                        vfx.Decal(P(x, y + 0.05f, z), r, c, 3, 0, 0.18f);
                        for (int j = 0; j < 10; j++)
                            Later(j * 0.3f, () =>
                            {
                                var q = RndInRing();
                                vfx.Burst(P(q.x, y + 0.3f, q.y), c, count: 4, speed: 1.5f, life: 0.9f, grav: -1.5f, size: 0.18f);
                            });
                    });
                    return;
                case 5:
                    vfx.Bolt(P(x + 2, y + 30, z - 2), P(x, y + 0.5f, z), FireCore, 0.35f, 0.35f);
                    for (float t = 0.05f; t < 0.35f; t += 0.1f)
                    {
                        float f = (0.35f - t) / 0.35f;
                        Later(t, () => vfx.Burst(P(x + 2 * f, y + 30 * f + 0.5f, z - 2 * f), Fire, count: 6, speed: 2, life: 0.5f, grav: 0, size: 0.35f));
                    }
                    Later(0.35f, () =>
                    {
                        Sound(at, "thud");
                        vfx.Decal(P(x, y + 0.05f, z), 3, FireCore, 0.5f, 0, 0.9f);
                        vfx.Burst(P(x, y + 0.5f, z), FireCore, count: 90, speed: 11, life: 0.6f, grav: 4, size: 0.45f);
                        vfx.Burst(P(x, y + 0.5f, z), Fire, count: 40, speed: 5, life: 1.0f, grav: -2, size: 0.6f);
                        for (int k = 1; k <= 3; k++) RingTo((k - 1) * 0.15f, r * k / 3, 0.6f, 0.85f);
                        for (int i = 0; i < 36; i++)
                        {
                            var q = RndInRing();
                            vfx.Burst(P(q.x, y + 0.4f, q.y), c, count: 5, speed: 7, life: 0.8f, grav: 8, size: 0.32f);
                            vfx.Burst(P(q.x, y + 0.3f, q.y), Fire, count: 2, speed: 3, life: 1.2f, grav: -1, size: 0.5f);
                        }
                    });
                    vfx.Decal(P(x, y + 0.05f, z), r, Fire, 10, 0, 0.25f);
                    for (int k = 0; k < 20; k++)
                        Later(0.6f + k * 0.5f, () =>
                        {
                            for (int i = 0; i < 4; i++)
                            {
                                var q = RndInRing();
                                vfx.Burst(P(q.x, y + 0.3f, q.y), Fire, count: 4, speed: 2.5f, life: 0.7f, grav: -1.5f, size: 0.4f);
                                vfx.Burst(P(q.x, y + 0.2f, q.y), FireRed, count: 2, speed: 1.5f, life: 0.5f, grav: -1, size: 0.25f);
                            }
                        });
                    return;
                default:
                    vfx.Decal(at, r, Gold, 0.8f, 0, 1);
                    return;
            }
        }

        /// Замах ультимейта вокруг героя: руна под ногами, спираль частиц вверх, кольца на поясе, нарастающее свечение.
        static void UltCast(int v, float x, float y, float z, float r, float d)
        {
            var vfx = V;
            var c = UltColor(v);
            var at = P(x, y, z);
            if (v == V_BATTLEMAGE)
            {
                int steps = Mathf.Max(1, Mathf.RoundToInt(d * 8));
                for (int i = 0; i < steps; i++)
                {
                    float t = i / (float)steps * d;
                    int ii = i;
                    Later(t, () =>
                    {
                        float rad = 4 * (1 - t / d) + 0.4f, ang = ii * 0.9f;
                        vfx.Burst(P(x + Mathf.Cos(ang) * rad, y + 0.3f + t / d * 2.2f, z + Mathf.Sin(ang) * rad), Fire, count: 3, speed: 1.2f, life: 0.45f, grav: -2, size: 0.18f);
                    });
                }
                for (float t = 0; t < d; t += 0.8f)
                {
                    float tt = t;
                    Later(t, () => vfx.Decal(P(x, y + 0.05f, z), Mathf.Max(1.5f, r * (1 - 0.6f * tt / d)), Fire, 0.7f, 0, 0.6f));
                }
                float dur = Mathf.Max(0.4f, d);
                for (float t = 0; t < dur; t += 0.25f)
                {
                    float grow = t / dur;
                    Later(t, () => vfx.Burst(P(x, y + 3.2f + grow * 2, z), FireCore, count: 2 + Mathf.FloorToInt(grow * 6), speed: 0.8f, life: 0.5f, grav: 0, size: 0.2f + grow * 0.25f));
                }
                for (float t = 0.5f; t < dur - 0.4f; t += 0.5f)
                    Later(t, () =>
                    {
                        float ang = Rnd * Mathf.PI * 2, rr = 2 + Rnd * 2;
                        vfx.Burst(P(x + Mathf.Cos(ang) * rr, y + 7, z + Mathf.Sin(ang) * rr), Fire, count: 3, speed: 2, life: 0.6f, grav: 0, size: 0.25f,
                            dir: new Vector3(-Mathf.Cos(ang) * 0.2f, -1, -Mathf.Sin(ang) * 0.2f), spread: 0.2f);
                    });
                Later(Mathf.Max(0, dur - 2), () => Sound(at, "fire"));
                return;
            }
            if (v == 2)
            {
                float rune2 = Mathf.Max(1, Mathf.Min(r, 3));
                for (float t = 0; t < d; t += 0.8f)
                {
                    float tt = t;
                    Later(t, () =>
                    {
                        float h = 1.5f + tt / d * 3;
                        for (int j = 0; j < 6; j++)
                        {
                            float a = j * (Mathf.PI / 3) + tt * 0.3f;
                            vfx.Pillar(P(x + Mathf.Cos(a) * r, y, z + Mathf.Sin(a) * r), 0.25f, h, Light, 0.9f);
                        }
                        vfx.Decal(P(x, y + 0.05f, z), rune2, c, 0.8f, 0, 0.7f);
                    });
                }
                for (int i = 0; i < d * 10; i++)
                {
                    int ii = i;
                    Later(i * 0.1f, () =>
                    {
                        float ang = ii * 0.5f, rad = r * 0.5f;
                        vfx.Burst(P(x + Mathf.Cos(ang) * rad, y + 0.3f + ii * 0.1f / d * 3, z + Mathf.Sin(ang) * rad), Light, count: 3, speed: 0.6f, life: 0.6f, grav: -0.5f, size: 0.14f);
                    });
                }
                Later(Mathf.Max(0, d - 1), () => vfx.Burst(P(x, y + 1, z), Light, count: 40, speed: 4, life: 0.8f, size: 0.25f));
                return;
            }
            if (v == 3)
                for (int k = 0; k < 16; k++)
                {
                    float a = k / 16f * Mathf.PI * 2;
                    Later(k / 16f * d * 0.9f, () => vfx.Burst(P(x + Mathf.Cos(a) * r, y + 0.3f, z + Mathf.Sin(a) * r), c, count: 6, speed: 2, life: 0.5f, grav: -1, size: 0.18f));
                }
            float rune = Mathf.Max(1, Mathf.Min(r, 3));
            for (float t = 0; t < d; t += 0.6f)
            {
                float tt = t;
                Later(t, () => vfx.Decal(P(x, y + 0.05f, z), rune + (Mathf.Round(tt / 0.6f) % 2) * 0.6f, c, 0.7f, 0, 0.8f));
            }
            for (int i = 0; i < d * 10; i++)
            {
                int ii = i;
                Later(i * 0.1f, () =>
                {
                    float ang = ii * 0.5f;
                    vfx.Burst(P(x + Mathf.Cos(ang) * 1.1f, y + 0.2f + ii * 0.1f / d * 2.5f, z + Mathf.Sin(ang) * 1.1f), c, count: 3, speed: 1, life: 0.4f, size: 0.15f);
                });
            }
            for (int k = 0; k < Mathf.FloorToInt(d / 0.8f); k++)
            {
                int kk = k;
                Later(k * 0.8f, () => vfx.Decal(P(x, y + 1.2f, z), Mathf.Max(0.8f, 2.6f - kk * 0.3f), c, 0.6f, 0, 0.7f));
            }
            Later(Mathf.Max(0, d - 1), () => vfx.Burst(P(x, y + 1, z), c, count: 40, speed: 4, life: 0.8f, size: 0.25f));
            if (v == 1)
                for (int w = 0; w < 3; w++)
                    Later(Mathf.Max(0, d - 3 + w), () => vfx.Decal(P(x, y + 0.05f, z), r, c, 0.9f, 0, 0.3f));
            if (v == 0)
            {
                float rr = Mathf.Max(2, r);
                for (float t = 0; t < d - 0.4f; t += 0.9f)
                {
                    float kf = t / Mathf.Max(0.1f, d);
                    Later(t, () => vfx.Decal(P(x, y + 0.05f, z), rr * (1 - kf * 0.8f), c, 0.9f, 0, 0.45f));
                }
                foreach (var t in new[] { d * 0.25f, d * 0.5f, d * 0.7f, d * 0.85f, Mathf.Max(0, d - 1.2f) })
                    Later(t, () => Sound(at, "thud"));
                Later(Mathf.Max(0, d - 2), () =>
                {
                    for (int i = 0; i < 24; i++)
                    {
                        float a = i / 24f * Mathf.PI * 2;
                        vfx.Burst(P(x + Mathf.Cos(a) * rr, y + 0.2f, z + Mathf.Sin(a) * rr), Gold, count: 4, speed: 3, life: 0.6f, grav: 2, size: 0.2f);
                    }
                });
            }
        }
    }
}
