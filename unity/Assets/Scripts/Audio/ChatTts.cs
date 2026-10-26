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
                if (!(c.TryGetValue("t", out var t) && t as string == "ttsPlay")) return;
                if (!(c.TryGetValue("url", out var u) && u is string url)) { Debug.LogWarning("[tts] команда без url"); return; }
                Debug.Log($"[tts] пришла озвучка: {url}");
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

        /// Речь в эфире была тише игры: усиление сэмплов с мягким ограничением (tanh) — громче без хрипа.
        static void Louder(AudioClip clip, float gain)
        {
            if (clip.loadState != AudioDataLoadState.Loaded) clip.LoadAudioData();
            var data = new float[clip.samples * clip.channels];
            if (!clip.GetData(data, 0)) return;
            float norm = 1f / (float)System.Math.Tanh(gain);
            for (int i = 0; i < data.Length; i++) data[i] = (float)System.Math.Tanh(data[i] * gain) * norm * 0.95f;
            clip.SetData(data, 0);
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
                if (!clip || clip.length <= 0) { Debug.LogWarning($"[tts] пустой звук {url}"); continue; }
                Debug.Log($"[tts] играю {clip.length:0.0} с");
                Louder(clip, 2.4f);
                src.clip = clip;
                src.volume = 1f;
                src.Play();
                while (src.isPlaying) yield return null;
                Destroy(clip);
            }
            playing = false;
        }
    }
}
