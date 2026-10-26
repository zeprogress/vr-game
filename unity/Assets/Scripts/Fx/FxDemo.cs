using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Проверка эффектов в собранной программе: «ZEP Spectator -fxdemo <файл.png>» — камера на поляне,
    /// все виды эффектов и звуков, снимок экрана и выход. Без ключа ничего не делает.
    public class FxDemo : MonoBehaviour
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            var a = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(a, "-fxdemo");
            if (i < 0) return;
            Debug.LogWarning("[fxdemo] старт");
            var d = new GameObject("FxDemo").AddComponent<FxDemo>();
            d.outPath = i + 1 < a.Length ? a[i + 1] : "fxdemo.png";
        }

        string outPath;

        IEnumerator Start()
        {
            var dir = FindAnyObjectByType<SpectatorDirector>();
            if (dir) dir.enabled = false;
            yield return new WaitForSeconds(2f);
            var cam = Camera.main;
            var t = Terrain.activeTerrain;
            float G(float x, float z) => t.SampleHeight(new Vector3(x, 0, z)) + t.transform.position.y;
            var c = new Vector3(20, G(20, 20), 20);
            cam.transform.position = c + new Vector3(0, 9, -16);
            cam.transform.LookAt(c + Vector3.up);

            var router = FindAnyObjectByType<EffectsRouter>();
            void Act(string k, Vector3 p, Dictionary<string, object> extra = null)
            {
                var m = new Dictionary<string, object> { { "k", k }, { "x", p.x }, { "y", p.y }, { "z", p.z } };
                if (extra != null) foreach (var kv in extra) m[kv.Key] = kv.Value;
                router.OnAct(k, null, m);
            }
            Vector3 P(float dx, float dz) => new(c.x + dx, G(c.x + dx, c.z + dz), c.z + dz);

            Act("stunBash", P(-9, 2));
            Act("arrowRain", P(9, 4), new() { { "d", 0.2f } });
            Act("sporeMark", P(0, 8), new() { { "d", 0.5f } });
            Act("breathMark", P(-6, -3), new() { { "x2", c.x + 3 }, { "z2", c.z - 6 }, { "d", 2f } });
            Act("healAura", P(0, -2));
            Act("levelUp", P(-3, 0) + Vector3.up);
            Act("crit", P(3, 0) + Vector3.up);
            Act("dodge", P(5, -2) + Vector3.up * 2);
            Act("magicHit", P(-5, 5) + Vector3.up * 2);
            Act("swing", P(0, 0));
            for (int i = 0; i < 6; i++) Popups.Damage(P(-1 + i * 0.6f, 1) + Vector3.up * 1.5f, 37 + i * 211, i == 2 ? "poison" : i == 4 ? "heal" : null);
            yield return new WaitForSeconds(0.45f);
            ScreenCapture.CaptureScreenshot(outPath);
            Debug.LogWarning("[fxdemo] снимок → " + outPath);
            yield return new WaitForSeconds(1.5f);
            Application.Quit();
        }
    }
}
