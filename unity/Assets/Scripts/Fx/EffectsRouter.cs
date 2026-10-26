using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// События сервера → эффекты и звуки, как Spectator.onAct / onDmgHits в вебе:
    /// MSG.act ("ac") — удары, умения, MISS, крестики; MSG.dmgHits ("dh") — числа урона.
    public class EffectsRouter : MonoBehaviour
    {
        [Serializable] public class FxDefaults
        {
            public float stunRadius, stunCast, healRadius, healCast, rainRadius, rainCast, rainDuration;
            public float freezeRadius, freezeWindup, spikesRadius, spikesWindup, sporeRadius, sporeWindup, sporeDuration;
            public float chargeWindup, pullWindup, blinkFade, chiefHealRadius;
        }
        [Serializable] class Wrap { public FxDefaults fx; }

        FxDefaults d;
        /// Константы читаем при первом событии: ассеты в ZoneNet кладёт WorldSync.Start, порядок Start не гарантирован.
        FxDefaults D => d ??= JsonUtility.FromJson<Wrap>(ZoneNet.I.Assets.spectatorJson.text).fx;
        /// Дальше этого от камеры числа урона не показываем (SPEC_RANGE у спектатора).
        const float Range = 45f;

        void Start()
        {
            var net = ZoneNet.I;
            net.Act += OnAct;
            net.DmgHits += OnDmg;
        }

        /// Число из события; поле может прийти не числом (строка, флаг) — тогда значение по умолчанию.
        static float F(IDictionary m, string k, float def = float.NaN)
        {
            if (!m.Contains(k) || m[k] is not IConvertible v || v is string || v is bool) return def;
            try { return v.ToSingle(System.Globalization.CultureInfo.InvariantCulture); }
            catch { return def; }
        }

        void OnDmg(IEnumerable hits)
        {
            var cam = Camera.main;
            foreach (var o in hits)
            {
                if (o is not IDictionary h) continue;
                var p = new Vector3(F(h, "x", 0), F(h, "y", 0), F(h, "z", 0));
                if (cam && Vector2.Distance(new Vector2(p.x, p.z), new Vector2(cam.transform.position.x, cam.transform.position.z)) > Range) continue;
                Popups.Damage(p, F(h, "dmg", 0), h.Contains("c") ? h["c"] as string : null);
            }
        }

        public void OnAct(string k, string id, Dictionary<string, object> m)
        {
            var p = new Vector3(F(m, "x", 0), F(m, "y", 0), F(m, "z", 0));
            float d = F(m, "d"), r = F(m, "r"), x2 = F(m, "x2"), z2 = F(m, "z2");
            float Or(float v, float def) => float.IsNaN(v) ? def : v;
            // Действие героя звучит от его тела (как `at` в вебе), остальное — от точки события.
            var at = id != null && WorldSync.Players.TryGetValue(id, out var pv) ? pv.Head : p;
            var to = new Vector3(Or(x2, p.x), p.y, Or(z2, p.z));
            // Умения классов и особых мобов — как playClassAct в вебе (Fx/ClassActs.cs).
            float? N(float f) => float.IsNaN(f) ? null : f;
            float vv = F(m, "v");
            string mobId = m.TryGetValue("mobId", out var mo) ? mo as string : null;
            if (ClassActs.Play(k, id, p.x, p.y, p.z, N(d), N(x2), N(z2), float.IsNaN(vv) ? null : (int)vv, N(r), mobId)) return;
            if (BossActs.Play(k, id, p.x, p.y, p.z, N(d), N(x2), N(z2), float.IsNaN(vv) ? null : (int)vv, N(r), mobId)) return;
            switch (k)
            {
                case "swing": SoundBank.At(at, "sword-swing"); break;
                case "swordHit": case "stunHit": SoundBank.At(p, "sword-hit"); break;
                case "step": SoundBank.At(at, "footstep", 0.85f); break;
                case "jump": SoundBank.At(at, "jump"); break;
                case "drink": SoundBank.At(at, "drink"); Popups.Burst(p, 5, Popups.CrossGreen); break;
                case "pickup": SoundBank.At(at, "pickup"); break;
                case "levelUp": SoundBank.At(p, "levelUp"); Popups.Burst(p, 9, Popups.CrossOrange); break;
                case "bow": SoundBank.At(at, "bow-shot-" + UnityEngine.Random.Range(1, 6), 0.8f); break;
                case "crit": Popups.Crit(p + Vector3.up * 0.4f); SoundBank.At(p, "arrow-crit"); break;
                case "arrowHit": SoundBank.At(at, "arrowHitWood", 0.8f); break;
                case "hurt": SoundBank.At(at, "playerHurt"); break;
                case "blockShield": SoundBank.At(at, "block"); break;
                case "blockSword": SoundBank.At(at, "blockSoft"); break;
                case "dodge": Popups.Miss(p + Vector3.down * 1f); break;
                case "miss": Popups.Miss(p + Vector3.down * 0.4f); break;
                case "vampHit": Popups.Burst(id != null && WorldSync.Players.TryGetValue(id, out var vp) ? vp.Head + Vector3.down * 0.4f : p, 2, Popups.CrossRed, 0.4f); break;
                case "magicHit": Popups.Puff(at + Vector3.down * 0.9f, 1.1f, Popups.Magic, 0.55f); break;
                case "healHit": Popups.Burst(at + Vector3.down * 0.3f, 6, Popups.CrossGreen); break;
                case "healAura":
                    GroundFx.Zone(p, D.healRadius, 0.3f, D.healCast, GroundFx.HealC);
                    GroundFx.RingOut(p, D.healRadius, GroundFx.HealC, 1f);
                    SoundBank.At(p, "levelUp");
                    break;
                case "chiefHeal":
                    GroundFx.RingOut(p, D.chiefHealRadius, GroundFx.HealC, 1.2f);
                    SoundBank.At(p, "levelUp");
                    break;
                case "stunBash":
                    GroundFx.Telegraph(p, Or(r, D.stunRadius), Or(d, D.stunCast), GroundFx.Stun);
                    SoundBank.At(p, "groundBash");
                    break;
                case "freezeMark": GroundFx.Telegraph(p, D.freezeRadius, Or(d, D.freezeWindup), GroundFx.Ice); break;
                case "freezeHit": Popups.Puff(p + Vector3.down * 0.8f, 2.4f, GroundFx.Ice, 1.2f); SoundBank.At(p, "groundBash"); break;
                case "spikeMark": GroundFx.Telegraph(p, D.spikesRadius, Or(d, D.spikesWindup), GroundFx.Stun); break;
                case "spikeHit": SoundBank.At(p, "groundBash"); break;
                case "sporeMark":
                    GroundFx.Zone(p, D.sporeRadius, Or(d, D.sporeWindup), D.sporeDuration, GroundFx.Spore);
                    StartCoroutine(Later(Or(d, D.sporeWindup), () => SoundBank.At(p, "groundBash")));
                    break;
                case "breathMark": case "breathHit":
                    GroundFx.Strip(p, to, 4f, Or(d, 1f), k == "breathHit", GroundFx.FireC);
                    if (k == "breathHit") SoundBank.At(p, "groundBash");
                    break;
                case "chargeMark": case "chargeHit":
                    GroundFx.Strip(p, to, 2.5f, k == "chargeMark" ? Or(d, D.chargeWindup) : 0.4f, k == "chargeHit", GroundFx.Stun);
                    if (k == "chargeHit") SoundBank.At(to, "groundBash");
                    break;
                case "pullMark": case "pullHit":
                    GroundFx.Strip(to, p, 0.5f, k == "pullMark" ? Or(d, D.pullWindup) : 0.35f, k == "pullHit", Popups.Magic);
                    if (k == "pullHit") SoundBank.At(p, "sword-hit");
                    break;
                case "blinkOut": Popups.Puff(p, 1.4f, new Color(0.62f, 0.62f, 0.66f), Or(d, D.blinkFade)); break;
                case "blinkIn": Popups.Puff(p, 1.4f, new Color(0.62f, 0.62f, 0.66f), 0.6f); SoundBank.At(p, "sword-hit"); break;
                case "arrowRain":
                    GroundFx.ArrowRain(p, Or(r, D.rainRadius), Or(d, D.rainCast), D.rainDuration);
                    SoundBank.At(p, "arrowVolley");
                    break;
                case "rainTick": SoundBank.At(p, "arrowVolley"); break;
                case "ultWarn": GroundFx.Telegraph(p, Or(r, 6f), Or(d, 1f), GroundFx.Gold); break;
                case "ultHit": GroundFx.RingOut(p, Or(r, 6f), GroundFx.Gold, 0.7f); SoundBank.At(p, "ultWarrior"); break;
                case "ultHeal": Popups.Burst(p, 6, Popups.CrossGreen); break;
                case "ultSlow": Popups.Puff(p, 1.6f, GroundFx.Ice, 0.8f); break;
                case "raidTide": GroundFx.RingOut(p, 30f, Popups.Reflect, 2.5f); break;
                case "raidBreath": GroundFx.RingOut(p, 30f, Popups.Magic, 1.2f); SoundBank.At(p, "groundBash"); break;
                case "raidFall": Popups.Puff(p, 2f, Popups.Reflect, 0.8f); break;
            }
        }

        static IEnumerator Later(float sec, Action a)
        {
            yield return new WaitForSeconds(sec);
            a();
        }
    }
}
