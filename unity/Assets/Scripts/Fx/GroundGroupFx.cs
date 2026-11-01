using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Зрелищные наземные эффекты катакомб и боссов: огонь ВНУТРИ круга и облако яда.
    ///
    /// Огонь: настоящие языки пламени (Flames) по площади пятна — видно, что горит именно здесь,
    /// а не «красный диск». Яд: купол и клубы, как у Грибного колосса в вебе (споры).
    public class GroundGroupFx : MonoBehaviour
    {
        static GroundGroupFx inst;
        static GroundGroupFx I => inst ? inst : inst = new GameObject("GroundGroupFx").AddComponent<GroundGroupFx>();

        /// Пятно огня: языки по кругу, живут `life` секунд, потом убираются.
        public static void Fire(Vector3 at, float r, float life, int count = 9)
        {
            I.StartCoroutine(I.FireRoutine(at, r, Mathf.Max(0.3f, life), count));
        }

        IEnumerator FireRoutine(Vector3 at, float r, float life, int count)
        {
            var assets = ZoneNet.I ? ZoneNet.I.Assets : null;
            if (!assets) yield break;
            string group = "ground" + Random.Range(1000, 999999);
            var spots = new List<Vector3>();
            for (int i = 0; i < count; i++)
            {
                float a = Random.value * Mathf.PI * 2f;
                float d = Mathf.Sqrt(Random.value) * r * 0.8f;
                spots.Add(at + new Vector3(Mathf.Cos(a) * d, 0f, Mathf.Sin(a) * d));
            }
            foreach (var s in spots)
                Flames.Add(group, s, Mathf.Max(0.5f, r * 0.22f), Mathf.Max(0.8f, r * 0.55f), assets);
            yield return new WaitForSeconds(life);
            Flames.Remove(group);
        }

        /// Облако яда: купол + клубы, поднимающиеся и тающие. Как «ядовитые споры» колосса.
        public static void Poison(Vector3 at, float r, float windup, float duration)
        {
            I.StartCoroutine(I.PoisonRoutine(at, r, Mathf.Max(0.2f, windup), Mathf.Max(0.5f, duration)));
        }

        IEnumerator PoisonRoutine(Vector3 at, float r, float windup, float duration)
        {
            var assets = ZoneNet.I ? ZoneNet.I.Assets : null;
            var col = new Color(0.55f, 0.9f, 0.25f);
            // Купол — полусфера, медленно дышит.
            var dome = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            dome.name = "poisonDome";
            Object.Destroy(dome.GetComponent<Collider>());
            dome.transform.position = at;
            dome.transform.localScale = new Vector3(r * 2f, r * 1.2f, r * 2f);
            var mr = dome.GetComponent<MeshRenderer>();
            var domeMat = new Material(assets.unlitAdd) { name = "poisonDomeMat" };
            domeMat.SetColor("_BaseColor", col * 0.25f);
            mr.sharedMaterial = domeMat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;

            var puffs = new List<Transform>();
            for (int i = 0; i < 7; i++)
            {
                var p = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                Object.Destroy(p.GetComponent<Collider>());
                float a = i / 7f * Mathf.PI * 2f;
                float d = r * (0.35f + 0.35f * Random.value);
                p.transform.position = at + new Vector3(Mathf.Cos(a) * d, r * 0.25f, Mathf.Sin(a) * d);
                p.transform.localScale = Vector3.one * r * 0.55f;
                var m = new Material(assets.unlitAdd) { name = "poisonPuffMat" };
                m.SetColor("_BaseColor", col * 0.5f);
                p.GetComponent<MeshRenderer>().sharedMaterial = m;
                p.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                puffs.Add(p.transform);
            }

            // Телеграф: к моменту удара облако раздувается, потом держится и тает.
            float t = 0f;
            while (t < windup)
            {
                t += Time.deltaTime;
                float k = Mathf.Clamp01(t / windup);
                dome.transform.localScale = new Vector3(r * 2f * k, r * 1.2f * k, r * 2f * k);
                yield return null;
            }
            float end = Time.time + duration;
            while (Time.time < end)
            {
                float pulse = 0.9f + 0.1f * Mathf.Sin(Time.time * 2.4f);
                dome.transform.localScale = new Vector3(r * 2f * pulse, r * 1.2f * pulse, r * 2f * pulse);
                for (int i = 0; i < puffs.Count; i++)
                {
                    var tr = puffs[i];
                    if (!tr) continue;
                    tr.position += Vector3.up * (0.25f * Time.deltaTime);
                    tr.Rotate(Vector3.up, 18f * Time.deltaTime, Space.World);
                }
                yield return null;
            }
            Object.Destroy(dome);
            foreach (var p in puffs) if (p) Object.Destroy(p.gameObject);
        }
    }
}
