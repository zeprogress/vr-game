using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Моб из MobState: плавное следование за серверной позицией, прыжок/смерть,
    /// процедурный squash на замахе (attackSeq) и вспышка при попадании (hurtSeq).
    public class MobView : MonoBehaviour
    {
        public string id;
        public MobState state;
        Anim anim;
        Transform body;
        ushort lastAttack, lastHurt;
        float squash, flash;
        Renderer[] rends;
        MaterialPropertyBlock mpb;
        static readonly int EmissionId = Shader.PropertyToID("_EmissionColor");

        public void Init(string id, MobState s, GameObject model)
        {
            this.id = id;
            state = s;
            body = Instantiate(model, transform).transform;
            anim = new Anim(body.gameObject);
            rends = body.GetComponentsInChildren<Renderer>();
            mpb = new MaterialPropertyBlock();
            lastAttack = s.attackSeq;
            lastHurt = s.hurtSeq;
            transform.position = new Vector3(s.x, s.y, s.z);
        }

        void Update()
        {
            if (state == null) return;
            var target = new Vector3(state.x, state.y, state.z);
            transform.position = Vector3.Lerp(transform.position, target, 1f - Mathf.Exp(-12f * Time.deltaTime));
            transform.rotation = Quaternion.Slerp(transform.rotation,
                Quaternion.Euler(0, state.yaw * Mathf.Rad2Deg, 0), 1f - Mathf.Exp(-10f * Time.deltaTime));
            float sc = state.scale > 0 ? state.scale : 1f;

            if (state.dead != 0) anim.Once("Death");
            else anim.Loop("Hop");

            if (state.attackSeq != lastAttack) { lastAttack = state.attackSeq; squash = 1f; }
            if (state.hurtSeq != lastHurt) { lastHurt = state.hurtSeq; flash = 1f; }
            squash = Mathf.MoveTowards(squash, 0, Time.deltaTime * 3f);
            flash = Mathf.MoveTowards(flash, 0, Time.deltaTime * 5f);
            float s = Mathf.Sin(squash * Mathf.PI) * 0.35f;
            body.localScale = new Vector3(sc * (1 + s), sc * (1 - s), sc * (1 + s));

            mpb.SetColor(EmissionId, Color.white * flash * 1.5f);
            foreach (var r in rends) r.SetPropertyBlock(mpb);
        }
    }
}
