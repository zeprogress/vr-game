using System;
using System.Collections;
using UnityEngine;

namespace Zep
{
    /// Проверка света в собранной программе: «ZEP Spectator -lightdemo <папка>» — те же пять кадров, что эталоны
    /// веба (лагерь в 12, 18.3 и 23 ч, подземелье, катакомбы), снимки и выход. Без ключа ничего не делает.
    public class LightDemo : MonoBehaviour
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            var a = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(a, "-lightdemo");
            if (i < 0) return;
            new GameObject("LightDemo").AddComponent<LightDemo>().dir = i + 1 < a.Length ? a[i + 1] : ".";
        }

        string dir;

        IEnumerator Start()
        {
            var director = FindAnyObjectByType<SpectatorDirector>();
            if (director) director.enabled = false;
            var dc = FindAnyObjectByType<DayCycle>();
            yield return new WaitForSeconds(3f);
            var shots = new (string name, Vector3 p, Vector3 t, float hour)[]
            {
                ("noon", new(-30, 14, -30), new(-55, 0, -55), 12f),
                ("dusk", new(-30, 14, -30), new(-55, 0, -55), 18.3f),
                ("night", new(-30, 14, -30), new(-55, 0, -55), 23f),
                ("dun", new(-430, -436, -180), new(-441, -442, -195), 12f),
                ("cat", new(-12, -73, 258), new(4, -80, 280), 12f),
            };
            var cam = Camera.main;
            foreach (var s in shots)
            {
                dc.overrideHour = s.hour;
                cam.transform.position = s.p;
                cam.transform.LookAt(s.t);
                cam.fieldOfView = 0.9f * Mathf.Rad2Deg;
                yield return new WaitForSeconds(2f);
                ScreenCapture.CaptureScreenshot($"{dir}/l_{s.name}.png");
                yield return new WaitForSeconds(0.5f);
            }
            Debug.LogWarning("[lightdemo] готово");
            Application.Quit();
        }
    }
}
