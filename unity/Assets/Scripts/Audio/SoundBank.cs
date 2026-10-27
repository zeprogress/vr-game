using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Звуки как audio/Sfx.ts: сэмплы из public/sfx (Resources/Sfx, тем же именем) и синтезированные
    /// звуки веба, записанные в WAV (src/client/dev/unityExport.ts → bakeSfx: <имя>_0..2 — варианты).
    /// Объёмно от точки (как sfx.at), пул источников; музыка — плейлисты playlist.ts по области камеры.
    public class SoundBank : MonoBehaviour
    {
        public static SoundBank I { get; private set; }

        /// Громкость эффектов и музыки 0..1 (пульт: sfxVol / musicVol в процентах).
        public float sfxLevel = 1f, musicLevel = 1f;
        /// Громкость сэмплов относительно синтеза: синтез записан уже с мастером веба (0.32).
        const float SampleGain = 0.45f;
        const float MusicVol = 0.25f;

        readonly Dictionary<string, AudioClip[]> clips = new();
        /// Когда последний раз звучал звук с этим именем — одинаковые в один момент не складываем.
        readonly Dictionary<string, float> lastPlayed = new();
        readonly List<AudioSource> pool = new();
        int next;
        AudioSource music;
        string musicSet = "";
        float musicCheck;

        static readonly string[] TownMusic =
        {
            "luminous-swell", "castle-hall-1", "castle-hall-2", "village-waltz-1", "village-waltz-2",
            "village-dawn", "medieval-dawn", "medieval-dawn-2", "moonlit-meadow-path",
        };
        static readonly string[] DungeonMusic = { "dungeon-subterranean-silence", "dungeon-deep-temple" };
        static readonly string[] CatacombsMusic = { "catacombs" };
        /// Тема супербосса: последний зал катакомб (Трон Бездны) и бой с рейд-боссом — как в вебе (catacombs-boss.mp3).
        static readonly string[] SuperBossMusic = { "catacombs-boss" };
        static readonly string[] BossMusic = { "boss" };
        // Числа — из src/shared (catacombs.ts CAT_STEPS, CAT_PHASE.run; raid.ts RAID; mobs.ts BOSS.musicRange/musicOut).
        const int CatSteps = 4, CatPhaseRun = 2;
        const float RaidX = -84f, RaidZ = -219f, RaidR = 30f, BossNear = 26f, BossOut = 40f;

        void Awake()
        {
            I = this;
            for (int i = 0; i < 24; i++)
            {
                // Источник — отдельный объект: двигаем его к звуку, не трогая остальные.
                var s = new GameObject("sfx" + i).AddComponent<AudioSource>();
                s.transform.SetParent(transform, false);
                s.playOnAwake = false;
                s.spatialBlend = 1f;
                s.rolloffMode = AudioRolloffMode.Linear;
                s.minDistance = 4f;
                s.maxDistance = 50f;
                s.dopplerLevel = 0f;
                pool.Add(s);
            }
            music = gameObject.AddComponent<AudioSource>();
            music.spatialBlend = 0f;
            music.loop = false;
        }

        void Start()
        {
            if (ZoneNet.I) ZoneNet.I.SpecCmd += c =>
            {
                string t = c.TryGetValue("t", out var tv) ? tv as string : null;
                float V() => c.TryGetValue("v", out var v) ? System.Convert.ToSingle(v) / 100f : 1f;
                if (t == "sfxVol") sfxLevel = V();
                else if (t == "musicVol") musicLevel = V();
            };
        }

        /// Клипы по имени: сэмпл "sword-hit" или записанный синтез "levelUp" (варианты levelUp_0..2).
        AudioClip[] Clips(string name)
        {
            if (clips.TryGetValue(name, out var c)) return c;
            var one = Resources.Load<AudioClip>("Sfx/" + name);
            if (one) c = new[] { one };
            else
            {
                var list = new List<AudioClip>();
                for (int v = 0; v < 3; v++)
                {
                    var x = Resources.Load<AudioClip>($"Sfx/{name}_{v}");
                    if (x) list.Add(x);
                }
                c = list.ToArray();
            }
            clips[name] = c;
            return c;
        }

        /// Звук в точке мира. Синтезированные звуки (без дефиса в имени) записаны уже с громкостью веба.
        /// range — дальше от слушателя не играем вовсе (playIfNear в вебе: мобы 28 м, боссы 45–60 м).
        public static void At(Vector3 pos, string name, float vol = 1f, float pitchJitter = 0.04f, float range = 50f)
        {
            if (!I || string.IsNullOrEmpty(name)) return;
            var cam = Camera.main;
            if (cam && (cam.transform.position - pos).sqrMagnitude > range * range) return;
            // Один и тот же звук чаще раза в 40 мс — это эхо одного события (несколько попаданий за тик).
            float now = Time.unscaledTime;
            if (I.lastPlayed.TryGetValue(name, out var t) && now - t < 0.04f) return;
            I.lastPlayed[name] = now;
            var c = I.Clips(name);
            if (c.Length == 0) return;
            // Свой источник на каждый звук: свободный, а если все заняты — тот, что звучит дольше всех.
            AudioSource s = null;
            float oldest = -1;
            foreach (var src in I.pool)
            {
                if (!src.isPlaying) { s = src; break; }
                if (src.time > oldest) { oldest = src.time; s = src; }
            }
            s.Stop();
            s.transform.position = pos;
            s.clip = c[Random.Range(0, c.Length)];
            s.pitch = 1f + Random.Range(-pitchJitter, pitchJitter);
            float gain = name.Contains("-") ? SampleGain : 1f;
            s.volume = Mathf.Clamp01(vol * gain * I.sfxLevel);
            s.Play();
        }

        /// Музыка по области камеры (как у веб-спектатора, Spectator.updateBossMusic): катакомбы — свои треки,
        /// в последнем зале и на финальном боссе — тема супербосса; бой с рейд-боссом рядом — она же;
        /// подземелье — своя; рядом с живым Багровым — boss; иначе — город.
        void Update()
        {
            if ((musicCheck -= Time.unscaledDeltaTime) > 0 && music.isPlaying) { music.volume = MusicVol * musicLevel; return; }
            musicCheck = 1f;
            var cam = Camera.main;
            if (!cam) return;
            var p = cam.transform.position;
            var st = ZoneNet.I && ZoneNet.I.Room != null ? ZoneNet.I.Room.State : null;
            string set;
            if (p.z > 240 && Mathf.Abs(p.x) < 100)
                set = st != null && st.catPhase >= CatPhaseRun && (st.catFinal == 1 || st.catHi >= CatSteps - 1) ? "superBoss" : "cat";
            else if (st != null && st.raid != null && st.raid.ph > 0 && Vector2.Distance(new Vector2(p.x, p.z), new Vector2(RaidX, RaidZ)) < RaidR + 60f)
                set = "superBoss";
            else if (p.x < -220) set = "dun";
            else set = BossNearby(p) ? "boss" : "town";
            if (set == musicSet && music.isPlaying) return;
            musicSet = set;
            var list = set == "superBoss" ? SuperBossMusic : set == "boss" ? BossMusic : set == "cat" ? CatacombsMusic : set == "dun" ? DungeonMusic : TownMusic;
            var clip = Resources.Load<AudioClip>("Music/" + list[Random.Range(0, list.Length)]);
            if (!clip) return;
            music.clip = clip;
            music.volume = MusicVol * musicLevel;
            music.Play();
        }

        /// Живой Багровый ближе BossNear; уже играет его тема — держим до BossOut (гистерезис, как в вебе).
        bool BossNearby(Vector3 p)
        {
            float lim = musicSet == "boss" ? BossOut : BossNear;
            foreach (var kv in WorldSync.Mobs)
            {
                var m = kv.Value.state;
                if (m == null || m.dead != 0 || m.kind != "boss") continue;
                var mp = kv.Value.transform.position;
                if (Vector2.Distance(new Vector2(p.x, p.z), new Vector2(mp.x, mp.z)) < lim) return true;
            }
            return false;
        }
    }
}
