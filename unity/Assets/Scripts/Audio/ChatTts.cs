using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Zep
{
    /// Озвучка чата на стриме — как spectator/SpectatorTts.ts: сервер уже синтезировал mp3 и шлёт команду
    /// пульта ttsPlay (url вида /tts/…); играем по одной, очередь не длиннее 4 реплик, громкость 0.9.
    public class ChatTts : MonoBehaviour
    {
        readonly Queue<string> queue = new();
        AudioSource src;
        bool playing;

        void Start()
        {
            src = gameObject.AddComponent<AudioSource>();
            src.spatialBlend = 0f;
            src.volume = 0.9f;
            ZoneNet.I.SpecCmd += c =>
            {
                if (!(c.TryGetValue("t", out var t) && (string)t == "ttsPlay") || !(c.TryGetValue("url", out var u) && u is string url)) return;
                if (queue.Count >= 4) queue.Dequeue();
                queue.Enqueue(Absolute(url));
                if (!playing) StartCoroutine(Pump());
            };
        }

        /// /tts/… — путь на том же сервере, что и игра: wss://хост → https://хост.
        static string Absolute(string url)
        {
            if (url.StartsWith("http")) return url;
            var s = ZoneNet.I.serverUrl.Replace("wss://", "https://").Replace("ws://", "http://").TrimEnd('/');
            return s + (url.StartsWith("/") ? url : "/" + url);
        }

        IEnumerator Pump()
        {
            playing = true;
            while (queue.Count > 0)
            {
                var url = queue.Dequeue();
                using var req = UnityWebRequestMultimedia.GetAudioClip(url, AudioType.MPEG);
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) { Debug.LogWarning($"[tts] не проиграл {url}: {req.error}"); continue; }
                var clip = DownloadHandlerAudioClip.GetContent(req);
                src.clip = clip;
                src.volume = 0.9f * (SoundBank.I ? Mathf.Max(0.2f, SoundBank.I.sfxLevel) : 1f);
                src.Play();
                while (src.isPlaying) yield return null;
                Destroy(clip);
            }
            playing = false;
        }
    }
}
