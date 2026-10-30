using System.Collections.Generic;
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

        /// Щит отражения (MobState.reflecting) — светящаяся сфера вокруг тела, как reflectShield в вебе
        /// (client/combat/Mob.ts): аддитивная, слегка пульсирует, живёт в корне моба (движется с ним).
        Transform reflectShield;
        Material reflectMat;
        float reflectT;

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
            BossSkin(body.gameObject, s, assets, nativeH);
            if (s.model == "monSpider") Matte(body.gameObject, assets.litTemplate, 0.7f, 0.18f);
            if (s.model == "monSkeletonReaver") Matte(body.gameObject, assets.litTemplate, 0.72f, -1);
            if (s.model == "monLavaMonster") lavaLights = LavaLights(s.kind == "spitter");
            if (s.model == "monIceGiant") chestLight = IceChestLight();
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
        float deadT;

        static readonly Dictionary<string, Material> skins = new();
        static readonly Dictionary<Material, Material> darker = new();

        static readonly Dictionary<Material, Material> mattes = new();

        /// Своя текстура модели на обычном URP Lit: темнее в k раз, гладкость smooth (−1 — как была).
        /// У паука в glTF блик завышен (KHR_materials_specular ×2) — блестел как лак; жнецы — чуть темнее.
        static void Matte(GameObject go, Material lit, float k, float smooth)
        {
            if (!lit) return;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    var src = mats[i];
                    if (!src) continue;
                    if (!mattes.TryGetValue(src, out var d))
                    {
                        Texture tex = src.HasProperty("baseColorTexture") ? src.GetTexture("baseColorTexture") : src.HasProperty("_BaseMap") ? src.GetTexture("_BaseMap") : null;
                        var c = src.HasProperty("baseColorFactor") ? src.GetColor("baseColorFactor") : src.HasProperty("_BaseColor") ? src.GetColor("_BaseColor") : Color.white;
                        float sm = smooth >= 0 ? smooth : src.HasProperty("roughnessFactor") ? 1 - src.GetFloat("roughnessFactor") : 0.3f;
                        d = new Material(lit) { name = src.name + "_matte" };
                        if (tex) d.SetTexture("_BaseMap", tex);
                        d.SetColor("_BaseColor", new Color(c.r * k, c.g * k, c.b * k, 1));
                        d.SetFloat("_Smoothness", Mathf.Clamp01(sm));
                        d.SetFloat("_Metallic", 0);
                        mattes[src] = d;
                    }
                    mats[i] = d;
                }
                r.sharedMaterials = mats;
            }
        }

        /// Темнее модели (пауки — по просьбе): копия материала с цветом × k, одна на исходный материал.
        static void Darken(GameObject go, float k)
        {
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    var src = mats[i];
                    if (!src) continue;
                    if (!darker.TryGetValue(src, out var d))
                    {
                        d = new Material(src) { name = src.name + "_dark" };
                        foreach (var prop in new[] { "baseColorFactor", "_BaseColor" })
                            if (d.HasProperty(prop)) { var c = d.GetColor(prop); d.SetColor(prop, new Color(c.r * k, c.g * k, c.b * k, c.a)); }
                        // Без глянца: матовая хитиновая шкура (пауки блестели как лак).
                        if (d.HasProperty("roughnessFactor")) d.SetFloat("roughnessFactor", 0.85f);
                        if (d.HasProperty("metallicFactor")) d.SetFloat("metallicFactor", 0f);
                        if (d.HasProperty("_Smoothness")) d.SetFloat("_Smoothness", 0.15f);
                        if (d.HasProperty("_Metallic")) d.SetFloat("_Metallic", 0f);
                        darker[src] = d;
                    }
                    mats[i] = d;
                }
                r.sharedMaterials = mats;
            }
        }

        /// Лавовые и ледяные боссы — своя «живая» кожа (Shaders/BossSkin): магма в трещинах корки, гранёный лёд.
        static void BossSkin(GameObject go, MobState s, SliceAssets assets, float nativeH)
        {
            string m = s.model ?? "";
            bool lava = m == "monLavaMonster", ice = m == "monIceGiant";
            if ((!lava && !ice) || !assets.bossSkin) return;
            // Маг лавы светится ярче и желтее стража (у него свой оттенок в ELITE_MOBS).
            bool mage = lava && s.kind == "spitter"; // маг лавы — дальник (kind spitter), страж — ближний
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    var src = mats[i];
                    Texture tex = src && src.HasProperty("baseColorTexture") ? src.GetTexture("baseColorTexture") : src && src.HasProperty("_BaseMap") ? src.GetTexture("_BaseMap") : null;
                    string key = $"{m}|{mage}|{(tex ? tex.GetInstanceID() : 0)}";
                    if (!skins.TryGetValue(key, out var skin))
                    {
                        skin = new Material(assets.bossSkin) { name = key };
                        if (tex) skin.SetTexture("_BaseMap", tex);
                        // Оттенок мага лавы (ELITE_MOBS.lavaMage.tint) — как в вебе умножает текстуру.
                        if (mage) skin.SetColor("_BaseColor", new Color(0.95f, 0.42f, 0.12f) * 1.6f);
                        skin.SetFloat("_Mode", ice ? 3 : 2); // лава — своя текстура модели, только свечение красного
                        skin.SetFloat("_Scale", (ice ? 3.2f : 4.5f) / Mathf.Max(0.1f, nativeH));
                        skin.SetColor("_Tint", ice ? new Color(0.1f, 0.3f, 1f) : mage ? new Color(1.1f, 0.8f, 0.5f) : new Color(1.5f, 0.5f, 0.22f)); // страж — красно-оранжевые прожилки
                        skin.SetFloat("_Glow", ice ? 1.4f : mage ? 3.2f : 5f);
                        if (ice)
                        {
                            // Гигант чуть прозрачный — лёд просвечивает (по просьбе).
                            skin.SetColor("_BaseColor", new Color(1, 1, 1, 0.8f));
                            skin.SetFloat("_SrcB", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                            skin.SetFloat("_DstB", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                            skin.renderQueue = 2950;
                        }
                        skins[key] = skin;
                    }
                    mats[i] = skin;
                }
                r.sharedMaterials = mats;
            }
        }

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

        Light[] lavaLights;
        Light chestLight;

        /// Ледяной гигант: холодный свет изнутри груди — как кристаллы подземелья (голубой, мягкий, пульсирует).
        Transform chestGlow;
        Material chestGlowMat;

        /// Голубой шар внутри груди: виден сквозь полупрозрачный лёд, пульсирует. Аддитивный, без записи глубины.
        void MakeChestGlow(Material unlitAdd)
        {
            if (!unlitAdd) return;
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = "iceCore";
            go.transform.SetParent(transform, false);
            Destroy(go.GetComponent<Collider>());
            var r = go.GetComponent<MeshRenderer>();
            chestGlowMat = new Material(unlitAdd) { name = "iceCoreMat" };
            chestGlowMat.SetColor("_BaseColor", new Color(0.35f, 0.7f, 1f) * 2.6f);
            r.sharedMaterial = chestGlowMat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            chestGlow = go.transform;
        }

        Light IceChestLight()
        {
            var l = new GameObject("iceChest").AddComponent<Light>();
            l.transform.SetParent(transform, false);
            l.type = LightType.Point;
            l.color = new Color(0.3f, 0.58f, 1f);
            l.shadows = LightShadows.None;
            return l;
        }

        void ChestLightUpdate()
        {
            if (!chestLight) return;
            bool on = state.dead == 0;
            chestLight.enabled = on;
            if (!on) return;
            float h = bodyRadius * 1.75f * (state.scale > 0 ? state.scale : 1f);
            chestLight.transform.position = transform.position + Vector3.up * h * 0.6f;
            chestLight.range = h * 2.2f;
            float pulse = 0.9f + 0.1f * Mathf.Sin(Time.time * 2.4f + transform.position.x);
            chestLight.intensity = 3.5f * h * pulse;
            if (chestGlow)
            {
                chestGlow.position = transform.position + Vector3.up * h * 0.6f;
                // Корень моба уже масштабирован state.scale — внутри него размер без этого множителя.
                chestGlow.localScale = Vector3.one * bodyRadius * 1.75f * 0.5f * pulse;
                if (chestGlowMat) chestGlowMat.SetColor("_BaseColor", new Color(0.35f, 0.7f, 1f) * (2.2f + 0.8f * pulse));
            }
        }

        /// Лавовые мобы светят сами: огонь у груди (на героях рядом) и низкий у земли (отсвет лавы на полу).
        Light[] LavaLights(bool mage)
        {
            var c = mage ? new Color(1f, 0.55f, 0.2f) : new Color(1f, 0.38f, 0.1f);
            var res = new Light[2];
            for (int i = 0; i < 2; i++)
            {
                var l = new GameObject(i == 0 ? "lavaChest" : "lavaFloor").AddComponent<Light>();
                l.transform.SetParent(transform, false);
                l.type = LightType.Point;
                l.color = c;
                l.shadows = LightShadows.None;
                res[i] = l;
            }
            return res;
        }

        void LavaLightUpdate()
        {
            if (lavaLights == null) return;
            bool on = state.dead == 0;
            // Рост модели ≈ 1.75 радиуса тела × scale; огни — в мировых метрах, не в масштабе моба.
            float h = bodyRadius * 1.75f * (state.scale > 0 ? state.scale : 1f);
            float t = Time.time + transform.position.x * 0.37f;
            float flick = 0.85f + 0.1f * Mathf.Sin(t * 5.3f) + 0.05f * Mathf.Sin(t * 13.1f);
            for (int i = 0; i < 2; i++)
            {
                var l = lavaLights[i];
                l.enabled = on;
                if (!on) continue;
                l.transform.position = transform.position + Vector3.up * (i == 0 ? h * 0.55f : 0.4f) + transform.forward * (i == 0 ? h * 0.15f : 0);
                l.range = i == 0 ? h * 2.6f : h * 1.8f;
                l.intensity = (i == 0 ? 6f : 5f) * h * flick;
            }
        }

        float burnGlow, burnTick, burnLastSec;
        Light burnLight;

        /// Поджог мага (MobState.burning — остаток в секундах): языки пламени и угли над мобом, тёплый мерцающий
        /// свет вокруг, гаснет за последнюю секунду. Кровотечение (bleeding) — те же языки, красные и без света.
        void Burn(float dt)
        {
            bool bleedOnly = state.burning == 0 && state.bleeding > 0 && state.dead == 0;
            bool on = (state.burning > 0 || bleedOnly) && state.dead == 0;
            burnGlow = on ? Mathf.Min(1, burnGlow + dt * 5) : Mathf.Max(0, burnGlow - dt * 3);
            if (on && state.burning == 1) burnLastSec = Mathf.Min(1, burnLastSec + dt); else if (on) burnLastSec = 0;
            float fade = state.burning > 0 ? 1 - burnLastSec : 0;
            float sc = (state.scale > 0 ? state.scale : 1f) * bodyRadius;
            var center = transform.position + Vector3.up * sc * 1.1f;
            if (burnGlow > 0.01f && Vfx.I != null && FxCull.Near(transform.position))
            {
                burnTick -= dt;
                if (burnTick <= 0)
                {
                    burnTick = 0.09f;
                    var col = bleedOnly ? FxColors.Blood : FxColors.Fire;
                    var p = center + new Vector3(Random.Range(-0.5f, 0.5f) * sc, Random.Range(-0.3f, 0.6f) * sc, Random.Range(-0.5f, 0.5f) * sc);
                    // Кровь — мелкие плотные капли, падают вниз; огонь — языки вверх.
                    if (bleedOnly) Vfx.I.Burst(p, col, count: 3, speed: 0.6f, life: 0.7f, grav: 9, size: 0.06f * Mathf.Sqrt(sc) + 0.04f, dir: Vector3.down, spread: 1f, drop: true);
                    else Vfx.I.Burst(p, col, count: 3, speed: 1f * sc + 0.5f, life: 0.55f, grav: -5 * Mathf.Max(0.6f, sc), size: 0.5f * sc + 0.18f, dir: Vector3.up, spread: 0.3f);
                    if (!bleedOnly)
                    {
                        Vfx.I.Burst(p, FxColors.FireCore, count: 1, speed: 0.8f * sc + 0.4f, life: 0.35f, grav: -4, size: 0.28f * sc + 0.08f, dir: Vector3.up, spread: 0.25f);
                        if (Random.value < 0.1f) Vfx.I.Burst(center + Vector3.up * sc * 0.8f, new Color(0.12f, 0.1f, 0.09f), count: 2, speed: 0.6f, life: 1.4f, grav: -1.2f, size: 0.5f * sc + 0.2f, smoke: true);
                    }
                }
            }
            bool lit = !bleedOnly && burnGlow > 0.01f && fade > 0;
            if (lit && !burnLight)
            {
                burnLight = new GameObject("burnLight").AddComponent<Light>();
                burnLight.transform.SetParent(transform, false);
                burnLight.type = LightType.Point;
                burnLight.color = new Color(1f, 0.5f, 0.18f);
                burnLight.shadows = LightShadows.None;
            }
            if (burnLight)
            {
                burnLight.enabled = lit;
                if (lit)
                {
                    burnLight.transform.position = center;
                    burnLight.range = 3 + sc * 4;
                    burnLight.intensity = (3f + sc * 2.5f) * burnGlow * fade * (0.8f + 0.2f * Mathf.Sin(Time.time * 17 + transform.position.x) + 0.1f * Mathf.Sin(Time.time * 31));
                }
            }
        }

        /// Сфера отражения: включается по MobState.reflecting, пульсирует (масштаб ±5%, прозрачность 45–70%),
        /// как в вебе. Материал аддитивный — сама сфера светится, а не затеняется сценой.
        void ReflectShield()
        {
            bool on = state.reflecting != 0 && state.dead == 0;
            if (on)
            {
                if (!reflectShield) MakeReflectShield();
                if (!reflectShield) return; // нет аддитивного материала — сферу не рисуем
                reflectShield.gameObject.SetActive(true);
                reflectT += Time.deltaTime;
                float pulse = 1f + 0.05f * Mathf.Sin(reflectT * 10f);
                reflectShield.localScale = Vector3.one * (REFLECT_DIAMETER * pulse);
                if (reflectMat)
                {
                    float a = 0.45f + 0.25f * Mathf.Abs(Mathf.Sin(reflectT * 7f));
                    reflectMat.SetColor("_BaseColor", new Color(0.5f, 0.9f, 1f, a));
                }
            }
            else if (reflectShield && reflectShield.gameObject.activeSelf)
            {
                reflectShield.gameObject.SetActive(false);
                reflectT = 0f;
            }
        }

        /// Диаметр сферы в локальных единицах корня моба (как diameter 1.3 в Mob.ts).
        const float REFLECT_DIAMETER = 1.3f;

        void MakeReflectShield()
        {
            var assets = ZoneNet.I ? ZoneNet.I.Assets : null;
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = "reflectShield";
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(transform, false);
            // Центр тела — та же точка, что у прицела и попаданий (bodyRadius над подошвой).
            go.transform.localPosition = new Vector3(0f, bodyRadius, 0f);
            go.transform.localScale = Vector3.one * REFLECT_DIAMETER;
            var mr = go.GetComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            if (assets && assets.unlitAdd)
            {
                reflectMat = new Material(assets.unlitAdd) { name = "reflectShield" };
                reflectMat.SetColor("_BaseColor", new Color(0.5f, 0.9f, 1f, 0.55f));
                mr.sharedMaterial = reflectMat;
                reflectShield = go.transform;
            }
            else
            {
                Destroy(go);
            }
        }

        void OnDestroy()
        {
            if (reflectMat) Destroy(reflectMat);
        }

        void Update()
        {
            if (state == null) return;
            Burn(Time.deltaTime);
            ReflectShield();
            LavaLightUpdate();
            ChestLightUpdate();
            var target = new Vector3(state.x, state.y, state.z);
            transform.position = Vector3.Lerp(transform.position, target, 1f - Mathf.Exp(-12f * Time.deltaTime));
            transform.rotation = Quaternion.Slerp(transform.rotation,
                Quaternion.Euler(0, state.yaw * Mathf.Rad2Deg, 0), 1f - Mathf.Exp(-10f * Time.deltaTime));
            float sc = state.scale > 0 ? state.scale : 1f;
            transform.localScale = Vector3.one * sc;
            anim.Cull(transform.position);

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
                // Клип урона — только стоящему мобу: на бегу он подменял шаги, и моб «скользил» по земле.
                // Порог — тот же, что включает ходьбу (speed > 0.4).
                if (actionLeft <= 0 && speed <= 0.4f) { anim.Once(1f, HurtClips); actionLeft = 0.4f; }
            }

            if (state.dead != 0)
            {
                if (!deathPlayed)
                {
                    deathPlayed = true;
                    var ds = DeathSound();
                    SoundBank.At(transform.position, ds, range: ds == "mobDie" ? 28f : 60f);
                }
                // Клипа смерти нет (слизни) — тело сплющивается и уходит в землю.
                if (!anim.Hold(1f, "Death", "death", "Die", "Dead"))
                {
                    deadT += Time.deltaTime;
                    float k = Mathf.Clamp01(deadT / 0.6f);
                    holder.localScale = new Vector3(baseScale * (1 + 0.4f * k), baseScale * Mathf.Max(0.05f, 1 - k * 0.9f), baseScale * (1 + 0.4f * k));
                }
            }
            else if (actionLeft <= 0)
            {
                deadT = 0;
                if (speed > 0.4f) anim.Loop(Mathf.Clamp(speed * 0.6f, 0.6f, 1.6f), MoveClips);
                else anim.Loop(1f, IdleClips);
            }

            // Слизень оторвался от земли — звук прыжка (mobHop в вебе, только рядом).
            if (state.grounded == 0 && wasGrounded && string.IsNullOrEmpty(state.model)) SoundBank.At(transform.position, "mobHop", range: 20f);
            wasGrounded = state.grounded != 0;

            squash = Mathf.MoveTowards(squash, 0, Time.deltaTime * 3f);
            flash = Mathf.MoveTowards(flash, 0, Time.deltaTime * 5f);
            float q = Squashes ? Mathf.Sin(squash * Mathf.PI) * 0.35f : 0f;
            if (state.dead == 0) holder.localScale = new Vector3(baseScale * (1 + q), baseScale * (1 - q), baseScale * (1 + q));

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
