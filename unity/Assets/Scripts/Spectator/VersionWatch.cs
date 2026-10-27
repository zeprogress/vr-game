using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace Zep
{
    /// Спектатор на Linux-компьютере стрима: раз в 30 с сверяет свою версию (файл VERSION рядом с программой)
    /// с выложенной на сервере (dist/spectator/version.txt). Новая — закрывается; systemd запускает снова через
    /// 5 с, а Spectator.sh перед стартом ставит обновление (unity/linux/update.sh). Без файла VERSION
    /// (запуск не из установки) ничего не делает.
    public class VersionWatch : MonoBehaviour
    {
        const float Every = 30f;
        string mine;

        void Start()
        {
            if (Application.platform != RuntimePlatform.LinuxPlayer) { enabled = false; return; }
            var path = Path.Combine(Path.GetDirectoryName(Application.dataPath) ?? ".", "VERSION");
            mine = File.Exists(path) ? File.ReadAllText(path).Trim() : null;
            if (string.IsNullOrEmpty(mine)) { enabled = false; return; }
            StartCoroutine(Loop());
        }

        IEnumerator Loop()
        {
            var url = ZoneNet.I.serverUrl.Replace("wss://", "https://").Replace("ws://", "http://").TrimEnd('/') + "/spectator/version.txt";
            while (true)
            {
                yield return new WaitForSecondsRealtime(Every);
                using var req = UnityWebRequest.Get(url + "?t=" + System.DateTime.UtcNow.Ticks);
                req.timeout = 15;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) continue;
                var srv = req.downloadHandler.text.Trim();
                if (srv.Length > 0 && srv != mine)
                {
                    Debug.Log($"[version] на сервере {srv}, у меня {mine} — перезапуск за обновлением");
                    Application.Quit();
                    yield break;
                }
            }
        }
    }
}
