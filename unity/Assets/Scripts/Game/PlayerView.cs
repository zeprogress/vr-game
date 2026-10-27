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
        Vector3 lastPos;
        Nameplate plate;
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
            rig.Apply(s.skin, s.leftCls, s.leftTier, s.rightCls, s.rightTier);
            transform.position = Target();
            lastPos = transform.position;
        }

        /// Сглаженная голова (глаза) и направление взгляда — для режиссёра спектатора.
        public Vector3 Head => transform.position + Vector3.up * Hero.EyeHeight;
        public Vector3 Forward =>
            new Quaternion(state.head.qx, state.head.qy, state.head.qz, state.head.qw) * Vector3.forward;

        /// Событие героя по сети (Spectator.onAct в вебе): замах, выстрел, флинч, новый уровень.
        public void OnAct(string kind)
        {
            switch (kind)
            {
                case "swing": case "bow": rig.PlaySwing(state.level); break;
                case "hurt": rig.PlayOneShot("RecieveHit", 1.6f); break;
                case "levelUp": rig.PlayOneShot("Victory"); break;
                case "pickup": rig.PlayOneShot("PickUp", 1.6f); break;
            }
        }

        /// Эмоция героя от умения (ClassActs: roll/jump/cheer) — клипы как BOT_EMOTE_CLIP в вебе.
        public void Emote(string e) => rig.PlayOneShot(e == "cheer" ? "Victory" : e == "roll" ? "Roll" : "Jump");

        Vector3 Target() => new Vector3(state.head.x, state.head.y - Hero.EyeHeight, state.head.z);

        void Update()
        {
            if (state == null) return;
            rig.Apply(state.skin, state.leftCls, state.leftTier, state.rightCls, state.rightTier);
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
        }
    }
}
