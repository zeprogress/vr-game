using UnityEngine;

namespace Zep
{
    /// Обёртка над Legacy Animation из glTFast: клипы ищутся по концу имени ("Slime|Hop" → "Hop").
    public class Anim
    {
        readonly Animation a;
        string current;

        public Anim(GameObject go) { a = go.GetComponentInChildren<Animation>(); }

        string Find(string name)
        {
            if (a == null) return null;
            foreach (AnimationState s in a)
                if (s.name == name || s.name.EndsWith("|" + name) || s.name.EndsWith(name)) return s.name;
            return null;
        }

        public void Loop(string name, float speed = 1f)
        {
            var n = Find(name);
            if (n == null) return;
            a[n].wrapMode = WrapMode.Loop;
            a[n].speed = speed;
            if (current == n) return;
            a.CrossFade(n, 0.15f);
            current = n;
        }

        public void Once(string name, float speed = 1f)
        {
            var n = Find(name);
            if (n == null) return;
            a[n].wrapMode = WrapMode.Once;
            a[n].speed = speed;
            a.CrossFade(n, 0.08f);
            current = n;
        }

        public bool Playing(string name)
        {
            var n = Find(name);
            return n != null && a.IsPlaying(n);
        }
    }
}
