using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Тренировочный манекен (DummyState, combat/Dummy.ts): столб и фигура; удар — фигура качается,
    /// «смерть» — фигура падает, пока сервер не поднимет.
    public class DummyView : MonoBehaviour
    {
        DummyState state;
        Transform figure;
        ushort lastHurt;
        float sway, fall;

        public void Init(DummyState s, SliceAssets assets)
        {
            state = s;
            var m = Instantiate(assets.dummy, transform);
            figure = m.transform.Find("figure");
            lastHurt = s.hurtSeq;
            transform.position = new Vector3(s.x, s.y, s.z);
        }

        void Update()
        {
            if (state == null) return;
            transform.position = new Vector3(state.x, state.y, state.z);
            if (state.hurtSeq != lastHurt) { lastHurt = state.hurtSeq; sway = 1f; }
            sway = Mathf.MoveTowards(sway, 0, Time.deltaTime * 2.5f);
            fall = Mathf.MoveTowards(fall, state.dead != 0 ? 1f : 0f, Time.deltaTime * 3f);
            if (figure) figure.localRotation = Quaternion.Euler(Mathf.Sin(sway * 14f) * 12f * sway + fall * 80f, 0, 0);
        }
    }
}
