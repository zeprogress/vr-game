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
        /// Скорость с прошлого Locomotion — бежит ли герой, когда пришло действие.
        float moveSpeed;
        /// Идущее действие играет только корпус (на бегу) — ноги не блокирует.
        bool actionUpper;
        float upperUntil;
        const float MoveSpeedMin = 0.6f;
        /// Родная скорость клипов шага и бега (м/с) при RigScale — HERO_STRIDE в src/client/entities/bodySplit.ts.
        const float StrideWalk = 1.14f, StrideRun = 2.27f;

        /// Действие на бегу — корпусом поверх бега, стоя — всем телом (как bodySplit.ts в вебе).
        void PlayAction(float rate, string clip)
        {
            actionUpper = moveSpeed > MoveSpeedMin && Anim.CanSplit;
            if (actionUpper) { Anim.OnceUpper(rate, clip); upperUntil = Time.time + Anim.Length(clip) / rate; }
            else { Anim.StopUpper(); Anim.Once(rate, clip); }
        }

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
            PlayAction(rate, clip);
            swingUntil = Time.time + Anim.Length(clip) / rate;
        }

        float oneShotUntil;

        /// Разовый клип (ранен, победа) — не перебивает идущий замах.
        public void PlayOneShot(string clip, float speed = 1f)
        {
            if (Time.time < swingUntil) return;
            // Урон и подбор на бегу — корпусом; победа и прочие эмоции — всем телом.
            if (clip == "RecieveHit" || clip == "PickUp") PlayAction(speed, clip);
            else { actionUpper = false; Anim.StopUpper(); Anim.Once(speed, clip); }
            oneShotUntil = Time.time + Anim.Length(clip) / speed;
        }

        /// Ходьба/бег/стойка — когда не идёт замах или разовый клип.
        public void Locomotion(float speed, bool dead)
        {
            moveSpeed = speed;
            if (dead) { Anim.StopUpper(); Anim.Hold(1f, "Death", "death", "Defeat"); return; }
            // Действие корпусом кончилось — корпус снова за ногами.
            if (actionUpper && Time.time >= upperUntil) { actionUpper = false; Anim.StopUpper(); }
            // Действие всем телом — ноги ждут; корпусом — ноги продолжают бег.
            if (!actionUpper && (Time.time < swingUntil || Time.time < oneShotUntil)) return;
            var set = AnimSet;
            // Темп ног — скорость / родная скорость клипа (как legRate в bodySplit.ts): без скольжения.
            if (speed > 3.5f) Anim.Loop(Mathf.Clamp(speed / StrideRun, 0.5f, 2.5f), "Run");
            else if (speed > 0.6f) Anim.Loop(Mathf.Clamp(speed / StrideWalk, 0.5f, 2.5f), "Walk");
            else Anim.Loop(1f, set?.idle, "Idle");
        }

        public bool Swinging => Time.time < swingUntil;

        /// Свечение заточки по прибавке рук (как applySharpGlow): двуручное (лук, посох) — по большей из двух.
        public void SetSharp(float pctL, float pctR)
        {
            bool two = clsL == "bow" || clsR == "bow" || clsL == "staff" || clsR == "staff";
            float both = Mathf.Max(pctL, pctR);
            if (gearL) foreach (var g in gearL.GetComponentsInChildren<WeaponGlow>(true)) g.SetPct(two ? both : pctL);
            if (gearR) foreach (var g in gearR.GetComponentsInChildren<WeaponGlow>(true)) g.SetPct(two ? both : pctR);
        }

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
            // Корпус — от Hips (ноги растут от Body): на бегу действия играют только им (Anim.OnceUpper).
            var hips = Find(model.transform, "Hips");
            if (hips) Anim.SetUpperRoot(hips);
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
            var g = Instantiate(src, fist).transform;
            // Кинжалы в кулаке терялись — вдвое крупнее (по просьбе, 2026-10-26).
            if (cls == "dagger") g.localScale *= 2f;
            // Цвет грейда — в цветах вершин; материал glTF их не рисует (щиты были серые) — свой шейдер.
            if (assets.bossSkin)
            {
                gearMat ??= MakeGearMat(assets.bossSkin);
                foreach (var r in g.GetComponentsInChildren<Renderer>(true))
                    if (!r.name.StartsWith("legGlow")) { var m = r.sharedMaterials; for (int i = 0; i < m.Length; i++) m[i] = gearMat; r.sharedMaterials = m; }
            }
            WeaponGlow.Attach(g, src.name.Substring(src.name.LastIndexOf('_') + 1), assets.unlitAdd);
            return g;
        }

        static Material gearMat;

        static Material MakeGearMat(Material tpl)
        {
            var m = new Material(tpl) { name = "gearVertexColor" };
            m.SetFloat("_Mode", 4);
            m.SetColor("_BaseColor", Color.white);
            return m;
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
