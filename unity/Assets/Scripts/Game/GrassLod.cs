using UnityEngine;

namespace Zep
{
    /// Трава: вблизи — полные модели пучков, вдали — дешёвые билборды.
    /// Чанк целиком переключается по расстоянию до камеры, как LOD в вебе.
    public class GrassLod : MonoBehaviour
    {
        public Renderer nearRenderer;
        public Renderer farRenderer;
        public float nearDistance = 42f;
        public float farDistance = 170f;

        Camera cam;

        void OnEnable()
        {
            cam = Camera.main;
            Apply();
        }

        void LateUpdate()
        {
            if (!cam) cam = Camera.main;
            if (cam) Apply();
        }

        void Apply()
        {
            if (!cam || !nearRenderer || !farRenderer) return;
            // Считаем по ближайшей точке чанка, а не по его центру: большой чанк
            // не должен переключаться, когда камера уже стоит внутри травы.
            var b = nearRenderer.bounds;
            float d = Mathf.Sqrt(b.SqrDistance(cam.transform.position));
            bool near = d < nearDistance;
            nearRenderer.enabled = near;
            farRenderer.enabled = !near && d < farDistance;
        }
    }
}
