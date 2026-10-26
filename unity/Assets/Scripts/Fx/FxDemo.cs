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
            int mi = Array.IndexOf(a, "-mobdemo");
            if (mi >= 0)
            {
                var md = new GameObject("MobDemo").AddComponent<FxDemo>();
                md.outPath = mi + 1 < a.Length ? a[mi + 1] : "mobdemo.png";
                md.mobs = true;
                return;
            }
            int gi = Array.IndexOf(a, "-glowdemo");
            if (gi >= 0)
            {
                var gd = new GameObject("GlowDemo").AddComponent<FxDemo>();
                gd.outPath = gi + 1 < a.Length ? a[gi + 1] : "glowdemo.png";
                gd.glow = true;
                return;
            }
            int i = Array.IndexOf(a, "-fxdemo");
            if (i < 0) return;
            Debug.LogWarning("[fxdemo] старт");
            var d = new GameObject("FxDemo").AddComponent<FxDemo>();
            d.outPath = i + 1 < a.Length ? a[i + 1] : "fxdemo.png";
        }

        string outPath;
        bool glow, mobs;

        /// Боссы и мобы крупно: страж лавы, маг лавы, ледяной гигант, паук (подставные MobState, без сервера).
        IEnumerator MobDemo()
        {
            var dir = FindAnyObjectByType<SpectatorDirector>();
            if (dir) dir.enabled = false;
            yield return new WaitForSeconds(2f);
            var assets = ZoneNet.I.Assets;
            var t = Terrain.activeTerrain;
            float G(float x, float z) => t.SampleHeight(new Vector3(x, 0, z)) + t.transform.position.y;
            var list = new[] { ("monLavaMonster", "slime", 3.2f, -9f), ("monLavaMonster", "spitter", 2.4f, -2f), ("monIceGiant", "slime", 3.2f, 5f), ("monSpider", "slime", 1.6f, 11f) };
            int n = 0;
            foreach (var (model, kind, sc, dx) in list)
            {
                var st = new ZepSchema.MobState { model = model, kind = kind, scale = sc, x = 20 + dx, z = 20, yaw = Mathf.PI };
                st.y = G(st.x, st.z);
                var go = new GameObject("demoMob" + n++);
                var mv = go.AddComponent<MobView>();
                mv.Init("demo" + n, st, assets);
            }
            var cam = Camera.main;
            var c = new Vector3(21, G(21, 20), 20);
            cam.transform.position = c + new Vector3(0, 4.5f, -17);
            cam.transform.LookAt(c + Vector3.up * 2.5f);
            yield return new WaitForSeconds(1.5f);
            ScreenCapture.CaptureScreenshot(outPath);
            yield return new WaitForSeconds(1f);
            Application.Quit();
        }

        /// Свечение заточки: четыре героя с заточенным оружием разных тиров, крупно.
        IEnumerator GlowDemo()
        {
            var dir = FindAnyObjectByType<SpectatorDirector>();
            if (dir) dir.enabled = false;
            yield return new WaitForSeconds(2f);
            var assets = ZoneNet.I.Assets;
            var t = Terrain.activeTerrain;
            var c = new Vector3(20, t.SampleHeight(new Vector3(20, 0, 20)) + t.transform.position.y, 20);
            var sets = new[] { ("sword", "legendary"), ("sword", "ruby"), ("spear", "craft"), ("bow", "legendary") };
            var rigs = new List<HeroRig>();
            for (int k = 0; k < sets.Length; k++)
            {
                var go = new GameObject("glowHero");
                go.transform.position = c + new Vector3(-3 + k * 2, 0, 0);
                go.transform.rotation = Quaternion.Euler(0, 180, 0);
                var rig = go.AddComponent<HeroRig>();
                rig.Init(assets);
                rig.Apply(0, sets[k].Item1 == "bow" ? sets[k].Item1 : null, sets[k].Item1 == "bow" ? sets[k].Item2 : null, sets[k].Item1, sets[k].Item2);
                rigs.Add(rig);
            }
            var cam = Camera.main;
            cam.transform.position = c + new Vector3(0, 1.4f, -5.5f);
            cam.transform.LookAt(c + Vector3.up * 1.0f);
            for (float tt = 0; tt < 1.5f; tt += Time.deltaTime)
            {
                foreach (var r in rigs) { r.SetSharp(25.4f, 25.4f); r.Locomotion(0, false); }
                yield return null;
            }
            foreach (var r in rigs)
            {
                foreach (var tr in r.GetComponentsInChildren<Transform>(true))
                    if (tr.name.Contains("gear_") || tr.name.Contains("legGlow"))
                        Debug.LogWarning($"[glowdemo] {tr.name} active={tr.gameObject.activeInHierarchy} rend={(tr.GetComponent<Renderer>() ? tr.GetComponent<Renderer>().enabled.ToString() : "-")} glow={(bool)tr.GetComponent<WeaponGlow>()} scale={tr.lossyScale} mesh={(tr.GetComponent<MeshFilter>() && tr.GetComponent<MeshFilter>().sharedMesh ? tr.GetComponent<MeshFilter>().sharedMesh.bounds.size.ToString() : "-")}");
            }
            ScreenCapture.CaptureScreenshot(outPath);
            yield return new WaitForSeconds(1f);
            Application.Quit();
        }

        IEnumerator Start()
        {
            if (glow) { yield return GlowDemo(); yield break; }
            if (mobs) { yield return MobDemo(); yield break; }
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
