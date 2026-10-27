using UnityEngine;

namespace Zep
{
    /// Картинка спектатора всегда 16:9: окно сжалось по высоте (экран 1080p, панель системы) — чёрные полосы
    /// по бокам, а не «широкий» кадр с другим полем зрения. OBS захватывает окно как есть.
    [RequireComponent(typeof(Camera))]
    public class AspectLock : MonoBehaviour
    {
        const float Want = 16f / 9f;
        Camera cam;
        int w, h;

        void Awake() => cam = GetComponent<Camera>();

        void Update()
        {
            if (Screen.width == w && Screen.height == h) return;
            w = Screen.width;
            h = Screen.height;
            float a = (float)w / Mathf.Max(1, h);
            cam.rect = a > Want
                ? new Rect((1 - Want / a) / 2, 0, Want / a, 1)
                : new Rect(0, (1 - a / Want) / 2, 1, a / Want);
        }
    }
}
