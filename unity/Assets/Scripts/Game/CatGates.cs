using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Решётки катакомб поднимаются, когда путь по маршруту открыт — как в вебе
    /// (client/world/Catacombs.ts: gate.y + CAT_CEIL * 0.62 при открытых соседних залах,
    /// скорость 0.9 вверх и 3 вниз).
    ///
    /// Решётки приходят из локации (catacombs.glb, узлы catGate0..catGate8 — по одному на коридор
    /// CAT_LINKS). Их исходная высота запоминается при первом кадре: в вебе gy — это «закрытое» положение.
    public class CatGates : MonoBehaviour
    {
        /// CAT_LINKS (src/shared/catacombs.ts): коридоры между залами графа.
        static readonly (int a, int b)[] Links =
        {
            (0, 1), (0, 2), (1, 3), (1, 4), (2, 4), (2, 5), (3, 6), (4, 6), (5, 6),
        };
        /// CAT_CEIL — высота свода коридора, м.
        const float Ceil = 16f;
        /// На сколько решётка уходит вверх (доля свода, как в вебе).
        const float LiftK = 0.62f;

        readonly Transform[] gates = new Transform[Links.Length];
        readonly float[] baseY = new float[Links.Length];
        readonly bool[] ready = new bool[Links.Length];
        float scanT;
        int foundAll;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            var go = new GameObject("CatGates");
            go.AddComponent<CatGates>();
        }

        void Update()
        {
            // Пересканируем, только пока не нашли все решётки (скан по сцене не бесплатный).
            if (foundAll < gates.Length && (scanT -= Time.unscaledDeltaTime) <= 0f)
            {
                scanT = 3f;
                Scan();
            }
            var st = ZoneNet.I != null && ZoneNet.I.Room != null ? ZoneNet.I.Room.State : null;
            if (st == null) return;
            // Открытые залы — как catOpen(route, lo, hi) в вебе.
            int lo = st.catLo, hi = st.catHi;
            var route = ParseRoute(st.catRoute);
            bool[] openHall = new bool[CatHalls];
            bool any = false;
            for (int i = Mathf.Max(0, lo); i <= hi && i < route.Count; i++)
            {
                int h = route[i];
                if (h >= 0 && h < CatHalls) { openHall[h] = true; any = true; }
            }
            if (!any && route.Count > 0 && route[0] >= 0 && route[0] < CatHalls) openHall[route[0]] = true;

            float dt = Time.deltaTime;
            for (int i = 0; i < gates.Length; i++)
            {
                if (!ready[i] || !gates[i]) continue;
                bool open = openHall[Links[i].a] && openHall[Links[i].b];
                float want = baseY[i] + (open ? Ceil * LiftK : 0f);
                var p = gates[i].position;
                float y = p.y + (want - p.y) * Mathf.Min(1f, dt * (open ? 0.9f : 3f));
                gates[i].position = new Vector3(p.x, y, p.z);
            }
        }

        /// Число залов в графе катакомб (CAT_HALLS).
        const int CatHalls = 7;

        static readonly System.Collections.Generic.List<int> Scratch = new();

        static System.Collections.Generic.List<int> ParseRoute(string s)
        {
            Scratch.Clear();
            if (string.IsNullOrEmpty(s)) return Scratch;
            int n = 0;
            for (int i = 0; i <= s.Length; i++)
            {
                char c = i < s.Length ? s[i] : ',';
                if (c >= '0' && c <= '9') n = n * 10 + (c - '0');
                else
                {
                    if (i > 0 && s[i - 1] >= '0' && s[i - 1] <= '9') Scratch.Add(n);
                    n = 0;
                }
            }
            return Scratch;
        }

        /// Найти решётки по именам узлов локации и запомнить их «закрытую» высоту.
        void Scan()
        {
            var all = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            int found = 0;
            foreach (var t in all)
            {
                if (!t.name.StartsWith("catGate")) continue;
                int idx = -1;
                if (!int.TryParse(t.name.Substring("catGate".Length), out idx)) continue;
                if (idx < 0 || idx >= gates.Length) continue;
                if (ready[idx]) continue;
                gates[idx] = t;
                baseY[idx] = t.position.y;
                ready[idx] = true;
            }
            for (int i = 0; i < ready.Length; i++) if (ready[i]) found++;
            foundAll = found;
            if (found == 0) scanT = 0.5f; // ещё не загрузилось — попробуем скоро
        }
    }
}
