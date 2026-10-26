using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Чужой герой (игрок или бот): тело стоит на head.y − рост глаз, поворот — только yaw.
    public class PlayerView : MonoBehaviour
    {
        public PlayerState state;
        Anim anim;
        Vector3 lastPos;

        public void Init(PlayerState s, GameObject model)
        {
            state = s;
            anim = new Anim(Instantiate(model, transform));
            transform.position = Target();
            lastPos = transform.position;
        }

        Vector3 Target() => new Vector3(state.head.x, state.head.y - Hero.EyeHeight, state.head.z);

        void Update()
        {
            if (state == null) return;
            transform.position = Vector3.Lerp(transform.position, Target(), 1f - Mathf.Exp(-12f * Time.deltaTime));
            var q = new Quaternion(state.head.qx, state.head.qy, state.head.qz, state.head.qw);
            var fwd = q * Vector3.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude > 1e-4f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(fwd),
                    1f - Mathf.Exp(-10f * Time.deltaTime));

            float speed = (transform.position - lastPos).magnitude / Mathf.Max(Time.deltaTime, 1e-4f);
            lastPos = transform.position;
            if (state.dead != 0) anim.Once("Death");
            else if (speed > 0.6f) anim.Loop("Run");
            else anim.Loop("Idle");
        }
    }
}
