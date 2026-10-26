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

            // Приёмы боссов (BossActs): лёд гиганта, огонь Владыки, лава стража, телеграфы.
            Act("giantSlamHit", P(-8, 6), new() { { "r", 5f } });
            Act("giantThrowHit", P(-2, -4));
            Act("giantFissureGo", P(-10, -2), new() { { "x2", c.x - 2 }, { "z2", c.z + 12 }, { "d", 0.6f } });
            Act("dragonBurn", P(4, 2), new() { { "x2", c.x + 10 }, { "z2", c.z + 14 }, { "d", 3f } });
            Act("dragonMeteorHit", P(8, -2));
            Act("lavaSpillHit", P(-3, 2), new() { { "x2", c.x + 3 }, { "z2", c.z + 8 }, { "r", 1.5f } });
            Act("dragonTail", P(12, 10), new() { { "x2", c.x + 2 }, { "z2", c.z + 10 }, { "d", 1.5f }, { "r", 8f } });
            Act("lavaMark", P(3, -6), new() { { "r", 2.5f }, { "d", 2f } });
            Act("dragonMeteorFall", P(0, 12), new() { { "d", 1.2f } });
            yield return new WaitForSeconds(0.3f);
            yield return new WaitForSeconds(0.45f);
            ScreenCapture.CaptureScreenshot(outPath);
            Debug.LogWarning("[fxdemo] снимок → " + outPath);
            yield return new WaitForSeconds(1.5f);
            Application.Quit();
        }
    }
}
