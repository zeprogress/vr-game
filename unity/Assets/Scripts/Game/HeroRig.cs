using System;
using UnityEngine;

namespace Zep
{
    /// Модель героя как у RemoteAvatar.ts: скин (PlayerState.skin), масштаб пака 0.52,
    /// оружие в кулаках Fist.R / Fist.L по классу в руке (leftCls / rightCls) и посадке BOT_GEAR.
    public class HeroRig : MonoBehaviour
    {
        public const float RigScale = 0.52f; // BOT_RIG_SCALE

        public Anim Anim { get; private set; }
        SliceAssets assets;
        GameObject model;
        int skin = -1;
        string clsL, clsR, tierL, tierR;
        Transform fistL, fistR, gearL, gearR;

        public void Init(SliceAssets assets) { this.assets = assets; }

        /// Стойка и удар по оружию в руках (classAnimSet в world/classPoses.ts); null — обычные Idle и SwordSlash.
        public (string idle, string attack, string alt)? AnimSet
        {
            get
            {
                bool Has(string c) => clsL == c || clsR == c;
                if (Has("spear")) return ("spearidle", "spearthrust", null);
                if (Has("hammer")) return ("hammeridle", "hammerslam", null);
                if (Has("dagger")) return ("daggeridle", "daggerstabr", clsL == "dagger" && clsR == "dagger" ? "daggerstabl" : null);
                if (Has("bow")) return ("bowidle", "bowshoot", null);
                return null;
            }
        }

        bool stabLeft;
        float swingUntil;

        /// Замах по сети (act: swing / bow) — клип класса или SwordSlash, темп растёт с уровнем (RemoteAvatar.playSwing).
        public void PlaySwing(int level)
        {
            var set = AnimSet;
            string clip = "SwordSlash";
            if (set != null && Anim.Has(set.Value.attack))
            {
                clip = set.Value.alt != null && stabLeft ? set.Value.alt : set.Value.attack;
                stabLeft = set.Value.alt != null && !stabLeft;
            }
            float rate = assets.MeleeRate(level);
            Anim.Once(rate, clip);
            swingUntil = Time.time + Anim.Length(clip) / rate;
        }

        float oneShotUntil;

        /// Разовый клип (ранен, победа) — не перебивает идущий замах.
        public void PlayOneShot(string clip, float speed = 1f)
        {
            if (Time.time < swingUntil) return;
            Anim.Once(speed, clip);
            oneShotUntil = Time.time + Anim.Length(clip) / speed;
        }

        /// Ходьба/бег/стойка — когда не идёт замах или разовый клип.
        public void Locomotion(float speed, bool dead)
        {
            if (dead) { Anim.Once(1f, "Death"); return; }
            if (Time.time < swingUntil || Time.time < oneShotUntil) return;
            var set = AnimSet;
            if (speed > 3.5f) Anim.Loop(1f, "Run");
            else if (speed > 0.6f) Anim.Loop(1f, "Walk");
            else Anim.Loop(1f, set?.idle, "Idle");
        }

        public bool Swinging => Time.time < swingUntil;

        /// Модель по ключу MODELS без оружия — NPC лагеря (charViking, charCowboy).
        public void ApplyModel(string key) => Build(assets.Model(key)?.prefab ?? assets.hero);

        /// Пересобирает модель и оружие, если что-то поменялось.
        public void Apply(int skin, string leftCls, string leftTier, string rightCls, string rightTier)
        {
            if (skin != this.skin)
            {
                this.skin = skin;
                Build(assets.Skin(skin));
            }
            if (leftCls != clsL || leftTier != tierL)
            {
                clsL = leftCls; tierL = leftTier;
                gearL = Seat(gearL, fistL, leftCls, leftTier);
            }
            if (rightCls != clsR || rightTier != tierR)
            {
                clsR = rightCls; tierR = rightTier;
                gearR = Seat(gearR, rightCls == "bow" || rightCls == "shield" ? fistL : fistR, rightCls, rightTier);
            }
        }

        /// Оружие из Gear.glb (выгрузка веба: makeWeaponMesh + посадка BOT_GEAR в кулак) — модель и её
        /// положение относительно кулака ровно как в вебе. Пустой тир — в руке ничего (fitGear в RemoteAvatar).
        /// Модель героя: масштаб пака, перекраска кожи, клипы классов из веба (скелет общий у всех скинов).
        void Build(GameObject src)
        {
            if (model) Destroy(model);
            model = Instantiate(src, transform);
            model.transform.localScale = Vector3.one * RigScale;
            Recolor.Character(model);
            var animation = model.GetComponentInChildren<Animation>();
            if (animation && assets.classClips != null)
                foreach (var c in assets.classClips)
                    if (c && !animation.GetClip(c.name)) animation.AddClip(c, c.name);
            Anim = new Anim(model);
            fistL = Find(model.transform, "Fist.L");
            fistR = Find(model.transform, "Fist.R");
            clsL = clsR = null;
        }

        Transform Seat(Transform old, Transform fist, string cls, string tier)
        {
            if (old) Destroy(old.gameObject);
            if (!fist || string.IsNullOrEmpty(cls) || string.IsNullOrEmpty(tier)) return null;
            var src = assets.Gear(cls, tier);
            if (!src) return null;
            // Instantiate с родителем сохраняет локальные позицию, поворот и масштаб — как под кулаком в Gear.glb.
            return Instantiate(src, fist).transform;
        }

        static Transform Find(Transform t, string name)
        {
            if (t.name == name) return t;
            foreach (Transform c in t)
            {
                var r = Find(c, name);
                if (r) return r;
            }
            return null;
        }
    }
}
