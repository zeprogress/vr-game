using UnityEngine;

namespace Zep
{
    /// Отсечка боя по дальности от камеры: дальше Far не рисуем эффекты, надписи и не гоняем анимации.
    public static class FxCull
    {
        public const float Far = 200f;

        public static bool Near(Vector3 p)
        {
            var cam = Camera.main;
            return !cam || (cam.transform.position - p).sqrMagnitude <= Far * Far;
        }

        /// Точку закрывает земля или скала: луч от камеры упёрся во что-то раньше, чем в 1.5 м от точки.
        public static bool Hidden(Vector3 camPos, Vector3 p)
        {
            var d = p - camPos;
            float len = d.magnitude;
            return len > 1.5f && Physics.Raycast(camPos, d / len, len - 1.5f, ~0, QueryTriggerInteraction.Ignore);
        }
    }
}
