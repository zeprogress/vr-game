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
        /// Модель со своими текстурами, клипами боя и посадкой оружия (Человек — KEEP_MATERIALS в вебе).
        bool own;
        string clsL, clsR, tierL, tierR;
        Transform fistL, fistR, gearL, gearR;

        public void Init(SliceAssets assets) { this.assets = assets; }

        /// Рост модели в мире (по мешам; 0 — не измерен): по нему плашка над головой.
        public float ModelHeight { get; private set; }

        /// Вид оружия для своих клипов модели (kindOf в world/heroMoves.ts).
        string MoveKind
        {
            get
            {
                bool Has(string c) => clsL == c || clsR == c;
                if (Has("spear")) return "spear";
                if (Has("hammer")) return "hammer";
                if (Has("staff")) return "staff";
                if (Has("bow")) return "bow";
                if (Has("dagger") && !Has("sword")) return "dagger";
                if (Has("sword")) return "sword";
                return null;
            }
        }

        /// Варианты удара своей модели: atk<вид>1..4 (у кинжала — atkdaggerr/l по руке).
        string[] Variants(string prefix)
        {
            var list = new System.Collections.Generic.List<string>();
            for (int i = 1; i <= 4; i++) if (Anim.Has(prefix + i)) list.Add(prefix + i);
            return list.ToArray();
        }

        string lastAttack;

        /// Случайный вариант (не тот же, что прошлый) — как pickVariant в вебе.
        string Pick(string[] list)
        {
            if (list.Length == 0) return null;
            var n = list[UnityEngine.Random.Range(0, list.Length)];
            if (list.Length > 1 && n == lastAttack) n = list[(Array.IndexOf(list, n) + 1) % list.Length];
            return lastAttack = n;
        }

        /// Стойка и удар по оружию в руках (classAnimSet в world/classPoses.ts); null — обычные Idle и SwordSlash.
        public (string idle, string attack, string alt)? AnimSet
        {
            get
            {
                if (own)
                {
                    var k = MoveKind;
                    if (k == null || !Anim.Has("stance" + k)) return null;
                    bool two = k == "dagger" && clsL == "dagger" && clsR == "dagger";
                    var a = Variants(k == "dagger" ? "atkdaggerr" : "atk" + k);
                    var alt = two ? Variants("atkdaggerl") : new string[0];
                    return a.Length == 0 ? null : ("stance" + k, a[0], alt.Length > 0 ? alt[0] : null);
                }
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
        /// Высота Body на шаге и беге — постоянная, близко к стойке (LOCO_BODY_Y в bodySplit.ts): без подпрыгивания
        /// и без проседания при смене стойка/шаг/бег.
        const float LocoBodyY = 0.93f, LocoBounce = 0.25f;
        /// Середина размаха Body в клипах бега и шага (для лёгкого подскока вокруг LocoBodyY).
        const float RunMid = 0.844f, WalkMid = 0.9255f;
        Transform body;

        /// После анимации: высота Body на шаге и беге — LocoBodyY по весу этих клипов (ключи легаси-клипа во время игры не прочитать).
        /// У своей модели (Человек) — не трогаем: числа под пак Quaternius; зато сжимаем кулаки.
        void LateUpdate()
        {
            if (own) { Grip(); return; }
            if (!body || Anim == null) return;
            float wr = Anim.Weight("Run"), ww = Anim.Weight("Walk");
            float w = Mathf.Min(1f, wr + ww);
            if (w <= 0f) return;
            float mid = (wr * RunMid + ww * WalkMid) / (wr + ww);
            var p = body.localPosition;
            p.y = Mathf.Lerp(p.y, LocoBodyY + (p.y - mid) * LocoBounce, w);
            body.localPosition = p;
        }

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
                // Своя модель — случайный вариант удара этого оружия (и руки у двух кинжалов), не тот же, что прошлый.
                if (own)
                {
                    var k = MoveKind;
                    var pre = k == "dagger" ? (set.Value.alt != null && stabLeft ? "atkdaggerl" : "atkdaggerr") : "atk" + k;
                    clip = Pick(Variants(pre)) ?? clip;
                }
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

        /// Клип умения своей модели (heroSkillClip в вебе) по act «cast»: сначала свой у класса, потом общий.
        public void PlaySkill(string skill, string cls)
        {
            if (!own || string.IsNullOrEmpty(skill)) return;
            string clip = null;
            if (cls != null && SkillClips.TryGetValue(skill + ":" + cls, out var c1)) clip = c1;
            else if (SkillClips.TryGetValue(skill, out var c2)) clip = c2;
            if (clip == null || !Anim.Has(clip)) return;
            bool full = clip == "skwhirlwind" || clip == "skcrush" || clip == "sksweep" || clip == "skseal";
            if (full) { actionUpper = false; Anim.StopUpper(); Anim.Once(1f, clip); } else PlayAction(1f, clip);
            swingUntil = Time.time + Anim.Length(clip);
        }

        /// act «cast» с сервера: s — умение, v — индекс класса в CLASS_IDS (shared/classes2.ts).
        static readonly string[] ClassIds = { "warrior", "archer", "support", "assassin", "spearman", "battlemage" };

        public static string CastSkill(System.Collections.Generic.Dictionary<string, object> m) =>
            m != null && m.TryGetValue("s", out var s) ? s as string : null;

        public static string CastClass(System.Collections.Generic.Dictionary<string, object> m)
        {
            if (m == null || !m.TryGetValue("v", out var v) || v == null) return null;
            int i = Convert.ToInt32(v);
            return i >= 0 && i < ClassIds.Length ? ClassIds[i] : null;
        }

        /// SKILL_CLIP из world/heroMoves.ts — умение (и умение:класс) → клип модели.
        static readonly System.Collections.Generic.Dictionary<string, string> SkillClips = new()
        {
            ["cleave"] = "skcleave", ["whirlwind"] = "skwhirlwind", ["whirlwind:spearman"] = "skflurry",
            ["whirlwind:battlemage"] = "skwhirlwind", ["stunBash:warrior"] = "skstunbash", ["stunBash:spearman"] = "sksweep",
            ["warcry"] = "skwarcry", ["warcry:support"] = "skmassheal", ["seal"] = "skseal", ["seal:support"] = "skcaststaff",
            ["steelAura"] = "skwarcry", ["drawIn"] = "skseal", ["crush"] = "skcrush", ["chain"] = "skchain",
            ["massHeal"] = "skmassheal", ["arrowRain:archer"] = "skarrowrain", ["arrowRain:support"] = "skcaststaff",
            ["arrowRain:assassin"] = "skthrow", ["arrowRain:spearman"] = "skspearcall", ["arrowStorm"] = "skarrowrain",
            ["mark"] = "skaim", ["lifeArrow"] = "skaim", ["blastArrow"] = "skaim", ["ghostArrow"] = "skaim",
            ["swarmArrow"] = "skaim", ["barrierArrow"] = "skaim", ["webArrow"] = "skaim", ["plague"] = "skcrosscut",
            ["smoke"] = "skthrow", ["soulSteal"] = "skcrosscut", ["abyss"] = "skcrosscut",
        };

        // --- кулак (HandGrip в вебе): пальцы между спокойной кистью и кулаком из клипа Fist ---
        Transform[] fingers = new Transform[0];
        Quaternion[] fingerRest, fingerFist;
        bool[] fingerLeft;
        float gripL, gripR;

        void SetupGrip()
        {
            var list = new System.Collections.Generic.List<Transform>();
            foreach (var t in model.GetComponentsInChildren<Transform>(true))
                if (System.Text.RegularExpressions.Regex.IsMatch(t.name, @"^(Left|Right)_(Thumb|Index|Middle|Ring|Pinky)\d$")) list.Add(t);
            fingers = list.ToArray();
            fingerRest = new Quaternion[fingers.Length];
            fingerFist = new Quaternion[fingers.Length];
            fingerLeft = new bool[fingers.Length];
            var animation = model.GetComponentInChildren<Animation>();
            AnimationClip fist = null;
            if (animation) foreach (AnimationState st in animation) if (st.name.EndsWith("Fist", StringComparison.OrdinalIgnoreCase)) fist = st.clip;
            for (int i = 0; i < fingers.Length; i++) fingerLeft[i] = fingers[i].name.StartsWith("Left");
            if (fist)
            {
                fist.SampleAnimation(animation.gameObject, 0f);
                for (int i = 0; i < fingers.Length; i++) fingerRest[i] = fingers[i].localRotation;
                fist.SampleAnimation(animation.gameObject, fist.length);
                for (int i = 0; i < fingers.Length; i++) fingerFist[i] = fingers[i].localRotation;
            }
            else for (int i = 0; i < fingers.Length; i++) fingerRest[i] = fingerFist[i] = fingers[i].localRotation;
        }

        /// В руке что-то есть (копьё и молот левая держит за древко — handsBusy в вебе) — кулак, плавно ~0.1 с.
        void Grip()
        {
            if (fingers.Length == 0) return;
            bool wantL = !string.IsNullOrEmpty(clsL) || clsR == "spear" || clsR == "hammer";
            bool wantR = !string.IsNullOrEmpty(clsR);
            float k = 1f - Mathf.Exp(-Time.deltaTime * 10f);
            gripL += ((wantL ? 1f : 0f) - gripL) * k;
            gripR += ((wantR ? 1f : 0f) - gripR) * k;
            for (int i = 0; i < fingers.Length; i++)
                fingers[i].localRotation = Quaternion.Slerp(fingerRest[i], fingerFist[i], fingerLeft[i] ? gripL : gripR);
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
            // Корпус (руки, голова) — в родном темпе клипа: копия на слое 1, ускоряются только ноги.
            if (speed > 3.5f) { Anim.Loop(Mathf.Clamp(speed / StrideRun, 0.5f, 2.5f), "Run"); if (!actionUpper) Anim.LoopUpper(1f, "Run"); }
            else if (speed > 0.6f) { Anim.Loop(Mathf.Clamp(speed / StrideWalk, 0.5f, 2.5f), "Walk"); if (!actionUpper) Anim.LoopUpper(1f, "Walk"); }
            else { if (!actionUpper) Anim.StopUpper(); Anim.Loop(1f, set?.idle, "Idle"); }
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
        public void ApplyModel(string key) { var e = assets.Model(key); Build(e?.prefab ?? assets.hero, e); }

        /// Пересобирает модель и оружие, если что-то поменялось.
        public void Apply(int skin, string leftCls, string leftTier, string rightCls, string rightTier)
        {
            if (skin != this.skin)
            {
                this.skin = skin;
                var e = assets.SkinEntry(skin);
                Build(e?.prefab ?? assets.hero, e);
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
        void Build(GameObject src, SliceAssets.ModelEntry entry = null)
        {
            if (model) Destroy(model);
            model = Instantiate(src, transform);
            own = entry != null && entry.keep;
            model.transform.localScale = Vector3.one * RigScale * (entry != null && entry.scale > 0 ? entry.scale : 1f);
            // Своя модель — со своими текстурами (не перекрашиваем) и своими клипами боя (клипы классов рыцаря не нужны).
            if (!own) Recolor.Character(model);
            var animation = model.GetComponentInChildren<Animation>();
            if (!own && animation && assets.classClips != null)
                foreach (var c in assets.classClips)
                    if (c && !animation.GetClip(c.name)) animation.AddClip(c, c.name);
            Anim = new Anim(model);
            // Корпус — от Hips (ноги растут от Body): на бегу действия играют только им (Anim.OnceUpper).
            // Кость Body — не меш с тем же именем (в модели есть и узел-меш «Body»): ищем узел без рендера.
            body = FindBone(model.transform, "Body");
            var hips = Find(model.transform, "Hips");
            // У Человека ноги растут из Hips (у пака — из Body рядом с Hips): корпус тогда — с позвоночника (Abdomen),
            // иначе действие корпусом забирало и ноги (на бегу ноги замирали, бег корпуса сбивал их темп).
            bool legsOnHips = hips && Find(hips, "UpperLeg.L") is Transform ul && ul.parent == hips;
            var upper = legsOnHips ? Find(hips, "Abdomen") : hips;
            if (upper) Anim.SetUpperRoot(upper);
            ModelHeight = entry != null ? entry.height * model.transform.localScale.y : 0f;
            fistL = Find(model.transform, "Fist.L");
            fistR = Find(model.transform, "Fist.R");
            clsL = clsR = null;
            fingers = new Transform[0];
            if (own) SetupGrip();
        }

        Transform Seat(Transform old, Transform fist, string cls, string tier)
        {
            if (old) Destroy(old.gameObject);
            if (!fist || string.IsNullOrEmpty(cls) || string.IsNullOrEmpty(tier)) return null;
            // Своя модель — оружие, посаженное в её кулак (GearHuman.glb: своя посадка на каждую руку).
            string side = fist == fistL ? "L" : "R";
            var src = own ? (assets.GearNamed($"hgear_{side}_{cls}_{tier}") ?? assets.GearNamed($"hgear_{side}_{cls}_base")) : null;
            src ??= assets.Gear(cls, tier);
            if (!src) return null;
            // Instantiate с родителем сохраняет локальные позицию, поворот и масштаб — как под кулаком в Gear.glb.
            var g = Instantiate(src, fist).transform;
            // Кинжалы в кулаке терялись — вдвое крупнее (по просьбе, 2026-10-26); у своей модели — её посадка как есть.
            if (cls == "dagger" && !own) g.localScale *= 2f;
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

        static Transform FindBone(Transform t, string name)
        {
            if (t.name == name && !t.GetComponent<Renderer>()) return t;
            foreach (Transform c in t)
            {
                var r = FindBone(c, name);
                if (r) return r;
            }
            return null;
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
