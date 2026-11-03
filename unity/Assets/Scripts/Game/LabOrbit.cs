using UnityEngine;
using UnityEngine.InputSystem;

namespace Zep
{
    /// Простая орбитальная камера полигона: ПКМ — вращение, колесо — дистанция.
    /// Не мешает OnGUI: кнопки пульта нажимаются ЛКМ.
    public class LabOrbit : MonoBehaviour
    {
        public Transform target;
        public float yaw;
        public float pitch = 18f;
        public float dist = 7.5f;
        public float height = 1.3f;

        void LateUpdate()
        {
            var m = Mouse.current;
            if (m != null)
            {
                if (m.rightButton.isPressed)
                {
                    var d = m.delta.ReadValue();
                    yaw += d.x * 0.18f;
                    pitch = Mathf.Clamp(pitch - d.y * 0.18f, -8f, 72f);
                }
                dist = Mathf.Clamp(dist - m.scroll.ReadValue().y * 0.006f, 2.4f, 20f);
            }
            if (!target) return;
            var focus = target.position + Vector3.up * height;
            var rot = Quaternion.Euler(pitch, yaw, 0);
            transform.position = focus - rot * Vector3.forward * dist;
            transform.LookAt(focus);
        }
    }
}
