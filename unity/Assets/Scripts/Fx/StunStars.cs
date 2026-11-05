using UnityEngine;

namespace Zep
{
    /// Три жёлтых кубика над головой, вращающиеся по кругу, пока цель оглушена.
    /// Перенос StunStarsFx / Mob.buildStunStars из веб-клиента.
    public class StunStars : MonoBehaviour
    {
        Transform spin;
        Material mat;
        float pulse;

        public static StunStars Attach(Transform parent)
        {
            var go = new GameObject("stunStars");
            go.transform.SetParent(parent, false);
            var s = go.AddComponent<StunStars>();
            s.Build();
            return s;
        }

        void Build()
        {
            var template = ZoneNet.I != null && ZoneNet.I.Assets ? ZoneNet.I.Assets.unlitAdd : null;
            mat = template ? new Material(template) : new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            mat.SetColor("_BaseColor", new Color(1f, 0.92f, 0.4f, 1f));
            mat.renderQueue = 3000;

            spin = new GameObject("spin").transform;
            spin.SetParent(transform, false);
            for (int i = 0; i < 3; i++)
            {
                var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                cube.name = "stunStar" + i;
                Destroy(cube.GetComponent<Collider>());
                cube.transform.SetParent(spin, false);
                cube.transform.localScale = Vector3.one * 0.13f;
                float a = (i / 3f) * Mathf.PI * 2f;
                cube.transform.localPosition = new Vector3(Mathf.Cos(a) * 0.32f, Mathf.Sin(a * 2f) * 0.05f, Mathf.Sin(a) * 0.32f);
                cube.transform.localRotation = Quaternion.Euler(0.6f, a * Mathf.Rad2Deg, 0.4f);
                var r = cube.GetComponent<Renderer>();
                r.sharedMaterial = mat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            spin.gameObject.SetActive(false);
        }

        /// Высота в мировых метрах и масштаб родителя (мобы масштабируются целиком).
        public void SetHeight(float worldHeight, float parentScale = 1f)
        {
            float k = parentScale > 1e-4f ? parentScale : 1f;
            transform.localPosition = Vector3.up * (worldHeight / k);
            transform.localScale = Vector3.one / k;
        }

        public void SetOn(bool on)
        {
            if (spin && spin.gameObject.activeSelf != on) spin.gameObject.SetActive(on);
        }

        void Update()
        {
            if (!spin || !spin.gameObject.activeSelf) return;
            spin.Rotate(0f, Time.deltaTime * 360f, 0f, Space.Self);
            pulse += Time.deltaTime * 6f;
            if (mat) mat.SetColor("_BaseColor", new Color(1f, 0.92f, 0.4f, 0.72f + Mathf.Sin(pulse) * 0.18f));
        }

        void OnDestroy()
        {
            if (mat) Destroy(mat);
        }
    }
}
