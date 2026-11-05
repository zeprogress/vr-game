using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Чужой герой (игрок или бот): тело стоит на head.y − рост глаз, поворот — только yaw.
    /// Скин и оружие в руках — по PlayerState (HeroRig).
    public class PlayerView : MonoBehaviour
    {
        public PlayerState state;
        HeroRig rig;
        /// Риг героя (для эффектов, которым нужен его клип — например кручение вихря по числу ударов).
        public HeroRig Rig => rig;
        Vector3 lastPos;
        Nameplate plate;
        StunStars stunStars;
        SliceAssets assets;
        bool isBot;
        /// Уровень голубым — у живых игроков и ботов одинаково (RemoteAvatar.ts).
        static readonly Color LevelColor = new(0.42f, 0.72f, 1f);

        public void Init(string id, PlayerState s, SliceAssets assets)
        {
            state = s;
            this.assets = assets;
            isBot = id.StartsWith("bot:");
            plate = Nameplates.Create(transform);
            plate.offset = Hero.EyeHeight + 0.42f;
            plate.scaleMul = 1.5f;
            rig = gameObject.AddComponent<HeroRig>();
            rig.Init(assets);
            stunStars = StunStars.Attach(transform);
            rig.Apply(s.skin, s.leftCls, s.leftTier, s.rightCls, s.rightTier);
            transform.position = Target();
            lastPos = transform.position;
        }

        /// Сглаженная голова (глаза) и направление взгляда — для режиссёра спектатора.
        public Vector3 Head => transform.position + Vector3.up * Hero.EyeHeight;
        public Vector3 Forward =>
            new Quaternion(state.head.qx, state.head.qy, state.head.qz, state.head.qw) * Vector3.forward;

        /// Событие героя по сети (Spectator.onAct в вебе): замах, выстрел, флинч, новый уровень.
        public void OnAct(string kind, System.Collections.Generic.Dictionary<string, object> m = null)
        {
            if (!rig) return; // полигон умений: тело без сети/рига — эффектам достаточно transform
            switch (kind)
            {
                case "cast":
                    {
                        // Если сервер сказал, сколько движений делает умение (n) — крутим/бьём ровно столько.
                        string sk = HeroRig.CastSkill(m);
                        string cls = HeroRig.CastClass(m);
                        float n = m.TryGetValue("n", out var nv) && nv is System.IConvertible ? System.Convert.ToSingle(nv) : 1f;
                        float dur = m.TryGetValue("d", out var dv) && dv is System.IConvertible ? System.Convert.ToSingle(dv) : 1f;
                        if (sk != null && n > 1.5f) rig.PlayRepeat(sk, cls, Mathf.RoundToInt(n), Mathf.Max(0.2f, dur));
                        else rig.PlaySkill(sk, cls);
                    }
                    break;
                case "swing": case "bow": rig.PlaySwing(state.level); break;
                case "hurt": rig.PlayOneShot("RecieveHit", 1.6f); break;
                case "levelUp": rig.PlayOneShot("Victory"); break;
                case "pickup": rig.PlayOneShot("PickUp", 1.6f); break;
            }
        }

        /// Эмоция героя от умения (ClassActs: roll/jump/cheer) — клипы как BOT_EMOTE_CLIP в вебе.
        public void Emote(string e) { if (rig) rig.PlayOneShot(e == "cheer" ? "Victory" : e == "roll" ? "Roll" : "Jump"); }

        Vector3 Target() => new Vector3(state.head.x, state.head.y - Hero.EyeHeight, state.head.z);

        void Update()
        {
            if (state == null) return;
            rig.Apply(state.skin, state.leftCls, state.leftTier, state.rightCls, state.rightTier);
            // Плашка — над головой: у высокой модели (Человек) выше обычной.
            plate.offset = Mathf.Max(Hero.EyeHeight + 0.42f, rig.ModelHeight + 0.3f);
            rig.SetSharp(WeaponGlow.PctOf(state.leftAffix), WeaponGlow.PctOf(state.rightAffix));
            transform.position = Vector3.Lerp(transform.position, Target(), 1f - Mathf.Exp(-12f * Time.deltaTime));
            var fwd = Forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude > 1e-4f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(fwd),
                    1f - Mathf.Exp(-10f * Time.deltaTime));

            rig.Anim?.Cull(transform.position);
            float speed = (transform.position - lastPos).magnitude / Mathf.Max(Time.deltaTime, 1e-4f);
            lastPos = transform.position;
            rig.Locomotion(speed, state.dead != 0);

            string lvl = (string.IsNullOrEmpty(state.title) ? "" : state.title + " · ") + state.level + " ур.";
            plate.SetInfo(state.nick, Color.white, lvl, LevelColor, isBot ? 4 : state.plat, 0);
            plate.SetBars(state.dead != 0 ? 0 : state.maxHp > 0 ? Mathf.Clamp01(state.hp / state.maxHp) : 1, assets.XpFrac(state.level, state.xp));
            if (stunStars)
            {
                stunStars.SetHeight(Mathf.Max(Hero.EyeHeight + 0.5f, rig.ModelHeight + 0.35f));
                stunStars.SetOn(state.stunned != 0 && state.dead == 0);
            }
        }
    }
}
