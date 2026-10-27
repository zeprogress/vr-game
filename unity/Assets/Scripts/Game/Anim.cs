using UnityEngine;

namespace Zep
{
    /// Обёртка над Legacy Animation из glTFast. Клип ищется по списку имён без учёта регистра
    /// и префикса ("Slime|Hop" → "Hop"): у паков разные имена — Bite_Front, Punch, Attack…
    public class Anim
    {
        readonly Animation a;
        string current;

        public Anim(GameObject go) { a = go.GetComponentInChildren<Animation>(); }

        public bool Has(params string[] names) => Find(names) != null;

        /// Длина клипа в секундах (0 — нет такого).
        public float Length(params string[] names)
        {
            var n = Find(names);
            return n != null ? a[n].length : 0f;
        }

        string Find(params string[] names)
        {
            if (a == null) return null;
            foreach (var want in names)
            {
                if (string.IsNullOrEmpty(want)) continue;
                foreach (AnimationState s in a)
                {
                    var n = s.name;
                    int bar = n.LastIndexOf('|');
                    var tail = bar >= 0 ? n.Substring(bar + 1) : n;
                    if (string.Equals(tail, want, System.StringComparison.OrdinalIgnoreCase)) return n;
                }
            }
            return null;
        }

        public void Loop(float speed, params string[] names)
        {
            var n = Find(names);
            if (n == null) return;
            a[n].wrapMode = WrapMode.Loop;
            a[n].speed = speed;
            if (current == n) return;
            a.CrossFade(n, 0.15f);
            current = n;
        }

        public void Loop(string name, float speed = 1f) => Loop(speed, name);

        public void Once(float speed, params string[] names)
        {
            var n = Find(names);
            if (n == null) return;
            a[n].wrapMode = WrapMode.ClampForever;
            a[n].speed = speed;
            a[n].time = 0; // повторный замах — с начала, а не продолжением прошлого
            a.CrossFade(n, 0.08f);
            current = n;
        }

        public void Once(string name, float speed = 1f) => Once(speed, name);

        /// Разовый клип, который зовут каждый кадр (смерть): запускается один раз, дальше доигрывает и держит
        /// последний кадр. Once каждый кадр сбрасывал время на 0 — смерть стояла на первом кадре.
        public bool Hold(float speed, params string[] names)
        {
            var n = Find(names);
            if (n == null) return false;
            if (current != n) Once(speed, names);
            return true;
        }

        // ---- корпус поверх ног (как bodySplit.ts в вебе) ----
        // На бегу действие играет копия клипа с маской «корпус» (кость Hips и ниже по иерархии: Abdomen, Torso,
        // руки, голова — ноги растут от Body и в маску не входят) на слое 1, а бег на слое 0 не прерывается.
        Transform upperRoot;
        string upperCur;

        /// Кость, от которой начинается корпус (у героев — Hips). Без неё разделения нет — всё тело.
        public void SetUpperRoot(Transform t) { upperRoot = t; }

        public bool CanSplit => upperRoot != null && a != null;

        string UpperOf(string n)
        {
            var u = n + "#upper";
            if (a[u] == null)
            {
                a.AddClip(a[n].clip, u);
                a[u].AddMixingTransform(upperRoot, true);
                a[u].layer = 1;
            }
            return u;
        }

        /// Разовый клип только корпусом (на бегу); ноги продолжают то, что играет слой 0.
        public void OnceUpper(float speed, params string[] names)
        {
            var n = Find(names);
            if (n == null || !CanSplit) return;
            var u = UpperOf(n);
            a[u].wrapMode = WrapMode.ClampForever;
            a[u].speed = speed;
            a[u].time = 0;
            a.CrossFade(u, 0.08f, PlayMode.StopSameLayer);
            upperCur = u;
        }

        /// Корпус возвращается к общему клипу: копия на слое 1 плавно гаснет.
        public void StopUpper()
        {
            if (upperCur == null) return;
            a.Blend(upperCur, 0f, 0.15f);
            upperCur = null;
        }

        /// Разовый клип ещё идёт (ClampForever держит последний кадр — считаем его законченным).
        public bool Playing(params string[] names)
        {
            var n = Find(names);
            return n != null && a.IsPlaying(n) && a[n].normalizedTime < 1f;
        }
    }
}
