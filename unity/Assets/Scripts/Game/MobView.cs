using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Моб из MobState — как client/combat/Mob.ts: модель по MobState.model ("" — слизень),
    /// рост модели = 1.75 радиуса тела × MobState.scale, опускание modelDrop, клипы по смыслу
    /// (стоит / идёт / удар / ранен / смерть), squash на замахе у слизней и вспышка при попадании.
    public class MobView : MonoBehaviour
    {
        public string id;
        public MobState state;
        Anim anim;
        Transform holder, body;
        SliceAssets.EliteEntry elite;
        ushort lastAttack, lastHurt;
        float squash, flash, baseScale, actionLeft;
        Vector3 lastPos;
        Renderer[] rends;
        Nameplate plate;
        float bodyRadius;
        /// Цвет плашки: босс красный, стрелок оранжевый, остальные голубовато-белые (Mob.ts tagColor).
        Color tagColor;
        MaterialPropertyBlock mpb;
        static readonly int EmissionId = Shader.PropertyToID("_EmissionColor");

        static readonly string[] IdleClips = { "Idle", "Flying_Idle", "Hop" };
        static readonly string[] MoveClips = { "Run", "Walk", "Fast_Flying", "Hop" };
        /// Клип вида замаха босса по MobState.attackKind (MOB_SWING, SWING_ANIM в combat/Mob.ts); 0 — укус, обычный удар.
        static readonly string[] SwingClips =
        {
            null, "AttackClaw", "AttackTail", "AttackBreath", "AttackWings", "MagicCharge",
            "Attack2", "Slam", "Throw", "Fissure", "Roar", "Slam", "Spill", "Mark", "Ring", "Roar",
        };
        static readonly string[] HurtClips = { "HitReact", "HitRecieve" };

        public void Init(string id, MobState s, SliceAssets assets)
        {
            this.id = id;
            state = s;
            // Пугало лагеря — своя модель в натуральную величину (Mob.buildScarecrow), без подгонки роста.
            bool scare = s.model == "scarecrow" && assets.scarecrow;
            var entry = scare ? null : assets.Model(string.IsNullOrEmpty(s.model) ? "slime" : s.model);
            var prefab = scare ? assets.scarecrow : entry?.prefab ?? assets.slime;
            float nativeH = scare ? assets.bodyRadius * 1.75f : entry != null && entry.height > 0.01f ? entry.height : 1f;
            elite = assets.Elite(s.model);

            holder = new GameObject("model").transform;
            holder.SetParent(transform, false);
            holder.localPosition = new Vector3(0, -(elite?.drop ?? 0) * assets.bodyRadius * 2, 0);
            baseScale = assets.bodyRadius * 1.75f / nativeH;
            holder.localScale = Vector3.one * baseScale;
            body = Instantiate(prefab, holder).transform;
            // Перекраска как в вебе: без своей модели — цвет вида (слизень синий, плевун оранжевый…), элита — свой оттенок.
            if (scare) { }
            else if (string.IsNullOrEmpty(s.model)) Recolor.Kind(body.gameObject, assets.Kind(s.kind), assets.litTemplate, assets.litTransparent);
            else Recolor.Tint(body.gameObject, elite?.tint);
            anim = new Anim(body.gameObject);
            rends = body.GetComponentsInChildren<Renderer>();
            mpb = new MaterialPropertyBlock();
            lastAttack = s.attackSeq;
            lastHurt = s.hurtSeq;
            deathPlayed = s.dead != 0; // уже мёртв при появлении — смерть не озвучиваем
            transform.position = lastPos = new Vector3(s.x, s.y, s.z);
            bodyRadius = assets.bodyRadius;
            tagColor = s.kind == "boss" ? new Color(1f, 0.3f, 0.3f) : s.kind == "spitter" ? new Color(1f, 0.6f, 0.25f) : new Color(0.85f, 0.9f, 1f);
            plate = Nameplates.Create(transform);
            transform.rotation = Quaternion.Euler(0, s.yaw * Mathf.Rad2Deg, 0);
        }

        bool deathPlayed, wasGrounded = true;

        /// Звук замаха босса (Mob.ts + Sfx.ts: ice / lava / lord / dragon) по виду замаха; у обычных мобов — нет.
        string SwingSound()
        {
            string m = state.model ?? "";
            int k = state.attackKind;
            if (m == "monIceGiant") return k switch { 7 => "giant-slam", 8 => "giant-throw", 9 => "ice-spikes", 10 => "giant-roar", _ => "giant-swipe" };
            if (m == "monLavaMonster") return k switch { 11 => "lava-slam", 12 => "lava-spill", 13 => "lava-mark", 14 => "lava-ring", 15 => "lava-roar", _ => "lava-hit" };
            if (m == "monDragonBest") return k switch { 2 => "lord-tail", 3 => "lord-breath", 4 => "lord-wings", _ => "lord-bite" };
            if (m == "monFireDragon" || m == "monDragonEvolved") return k == 3 ? "dragon-breath" : k == 4 ? "dragon-roar" : null;
            if (m == "monSpider") return "spiderBite";
            return null;
        }

        string DeathSound() => (state.model ?? "") switch
        {
            "monIceGiant" => "giant-death",
            "monLavaMonster" => "lava-death",
            "monDragonBest" => "lord-death",
            _ => "mobDie",
        };

        bool Squashes => state.model != "scarecrow" && (elite == null ? string.IsNullOrEmpty(state.model) || state.model == "slime" : !elite.noSquash);

        void Update()
        {
            if (state == null) return;
            var target = new Vector3(state.x, state.y, state.z);
            transform.position = Vector3.Lerp(transform.position, target, 1f - Mathf.Exp(-12f * Time.deltaTime));
            transform.rotation = Quaternion.Slerp(transform.rotation,
                Quaternion.Euler(0, state.yaw * Mathf.Rad2Deg, 0), 1f - Mathf.Exp(-10f * Time.deltaTime));
            float sc = state.scale > 0 ? state.scale : 1f;
            transform.localScale = Vector3.one * sc;

            float speed = (transform.position - lastPos).magnitude / Mathf.Max(Time.deltaTime, 1e-4f) / sc;
            lastPos = transform.position;
            actionLeft -= Time.deltaTime;

            if (state.attackSeq != lastAttack)
            {
                lastAttack = state.attackSeq;
                squash = 1f;
                // Как atkClip в вебе: свой клип вида замаха, иначе клип моба (attackClip), иначе Weapon / Punch / Attack.
                string swing = state.attackKind > 0 && state.attackKind < SwingClips.Length ? SwingClips[state.attackKind] : null;
                if (swing != null && !anim.Has(swing)) swing = null;
                string[] clips = { swing, elite?.attackClip, "Weapon", "Punch", "Attack", "Bite_Front", "Headbutt", "AttackBite" };
                anim.Once(1f, clips);
                var snd = SwingSound();
                if (snd != null) SoundBank.At(transform.position, snd, range: 45f);
                actionLeft = Mathf.Max(0.5f, anim.Length(clips));
            }
            if (state.hurtSeq != lastHurt)
            {
                lastHurt = state.hurtSeq;
                SoundBank.At(transform.position, "mobHurt", range: 28f);
                flash = 1f;
                if (actionLeft <= 0) { anim.Once(1f, HurtClips); actionLeft = 0.4f; }
            }

            if (state.dead != 0)
            {
                if (!deathPlayed)
                {
                    deathPlayed = true;
                    var ds = DeathSound();
                    SoundBank.At(transform.position, ds, range: ds == "mobDie" ? 28f : 60f);
                }
                anim.Once(1f, "Death");
            }
            else if (actionLeft <= 0)
            {
                if (speed > 0.4f) anim.Loop(Mathf.Clamp(speed * 0.6f, 0.6f, 1.6f), MoveClips);
                else anim.Loop(1f, IdleClips);
            }

            // Слизень оторвался от земли — звук прыжка (mobHop в вебе, только рядом).
            if (state.grounded == 0 && wasGrounded && string.IsNullOrEmpty(state.model)) SoundBank.At(transform.position, "mobHop", range: 20f);
            wasGrounded = state.grounded != 0;

            squash = Mathf.MoveTowards(squash, 0, Time.deltaTime * 3f);
            flash = Mathf.MoveTowards(flash, 0, Time.deltaTime * 5f);
            float q = Squashes ? Mathf.Sin(squash * Mathf.PI) * 0.35f : 0f;
            holder.localScale = new Vector3(baseScale * (1 + q), baseScale * (1 - q), baseScale * (1 + q));

            // Плашка: над телом с учётом масштаба; полоска HP — когда моб ранен (как бар моба в вебе).
            plate.offset = bodyRadius * 2f * sc + 0.78f;
            plate.visible = state.dead == 0;
            string lvl = state.kind == "boss" ? null : (state.mobLevel > 0 ? state.mobLevel : 1) + " ур.";
            plate.SetInfo(string.IsNullOrEmpty(state.mobName) ? "Слизень" : state.mobName, Color.white, lvl, tagColor, 0, state.armor);
            plate.SetBars(state.maxHp > 0 && state.hp < state.maxHp ? Mathf.Clamp01(state.hp / state.maxHp) : -1, -1);

            mpb.SetColor(EmissionId, Color.white * flash * 1.5f);
            foreach (var r in rends) if (r) r.SetPropertyBlock(mpb);
        }
    }
}
