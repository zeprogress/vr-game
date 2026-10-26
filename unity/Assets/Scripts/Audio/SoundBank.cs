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

        /// Музыка по области камеры: поляна — город, подземелье и катакомбы — свои наборы (как в вебе).
        void Update()
        {
            if ((musicCheck -= Time.unscaledDeltaTime) > 0 && music.isPlaying) { music.volume = MusicVol * musicLevel; return; }
            musicCheck = 1f;
            var cam = Camera.main;
            if (!cam) return;
            var p = cam.transform.position;
            string set = p.z > 240 && Mathf.Abs(p.x) < 100 ? "cat" : p.x < -220 ? "dun" : "town";
            if (set == musicSet && music.isPlaying) return;
            musicSet = set;
            var list = set == "cat" ? CatacombsMusic : set == "dun" ? DungeonMusic : TownMusic;
            var clip = Resources.Load<AudioClip>("Music/" + list[Random.Range(0, list.Length)]);
            if (!clip) return;
            music.clip = clip;
            music.volume = MusicVol * musicLevel;
            music.Play();
        }
    }
}
