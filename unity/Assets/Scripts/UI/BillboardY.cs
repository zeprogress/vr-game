using UnityEngine;

namespace Zep
{
    /// Табличка в мире, которая смотрит на камеру ЛИЦОМ (в вебе — BILLBOARDMODE_Y у плашки портала,
    /// Catacombs.ts portalLabelPlane).
    ///
    /// Поворот считаем по НОРМАЛИ меша, а не «ближайшим из двух»: у квада из локации нормаль уже
    /// смотрит в нужную сторону, а «ближайший» вариант мог развернуть плашку к камере спиной —
    /// материал односторонний, и табличка просто исчезала.
    ///
    /// Геометрия у табличек запечена в вершины, а трансформ в (0,0,0): крутим вокруг СОБСТВЕННОГО
    /// центра (Renderer.bounds) с компенсацией позиции, иначе табличка улетает по дуге от нуля.
    public class BillboardY : MonoBehaviour
    {
        Camera cam;
        Vector3 pivot;
        Vector3 basePos;
        Quaternion baseRot = Quaternion.identity;
        /// Горизонтальная проекция «лица» таблички в исходной ориентации.
        Vector3 faceBase = Vector3.forward;
        bool ready;

        void Start() { Prepare(); }

        void Prepare()
        {
            basePos = transform.position;
            baseRot = transform.rotation;
            var rs = GetComponentsInChildren<Renderer>(true);
            if (rs.Length > 0)
            {
                var b = rs[0].bounds;
                for (int i = 1; i < rs.Length; i++) b.Encapsulate(rs[i].bounds);
                pivot = b.center;
            }
            else pivot = basePos;

            // Нормаль квада: усредняем нормали мешей (у плашки портала 4 вершины, нормаль одна).
            Vector3 n = Vector3.zero;
            foreach (var mf in GetComponentsInChildren<MeshFilter>(true))
            {
                var m = mf.sharedMesh;
                if (!m) continue;
                var nn = m.normals;
                for (int i = 0; i < nn.Length; i++) n += mf.transform.rotation * nn[i];
            }
            if (n.sqrMagnitude < 1e-6f) n = baseRot * Vector3.forward;
            n.y = 0f;
            if (n.sqrMagnitude < 1e-6f) n = Vector3.forward;
            faceBase = n.normalized;
            ready = true;
        }

        void LateUpdate()
        {
            if (!ready) Prepare();
            if (!ready) return;
            if (!cam) cam = Camera.main;
            if (!cam) return;

            var cp = cam.transform.position;
            Vector3 toCam = new Vector3(cp.x - pivot.x, 0f, cp.z - pivot.z);
            if (toCam.sqrMagnitude < 1e-4f) return;
            toCam.Normalize();

            // На сколько довернуть исходную нормаль, чтобы она смотрела на камеру.
            float cur = Mathf.Atan2(faceBase.x, faceBase.z) * Mathf.Rad2Deg;
            float want = Mathf.Atan2(toCam.x, toCam.z) * Mathf.Rad2Deg;
            var R = Quaternion.Euler(0f, Mathf.DeltaAngle(cur, want), 0f);

            transform.rotation = R * baseRot;
            // Компенсация: разворачиваем вокруг своего центра, а не вокруг начала координат.
            transform.position = pivot - R * (pivot - basePos);
        }
    }
}
