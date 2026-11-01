using UnityEngine;

namespace Zep
{
    /// Плашка/табличка в мире, которая поворачивается к камере ЛИЦОМ (вокруг вертикали).
    /// Так в вебе живут таблички порталов (Catacombs.ts: plane.billboardMode = BILLBOARDMODE_Y).
    ///
    /// Важно: у табличек из локаций (world.glb / dungeon.glb) геометрия запечена в вершины,
    /// а трансформ стоит в (0,0,0). Поэтому просто «повернуть объект» нельзя — он улетит:
    /// крутим вокруг СОБСТВЕННОГО центра (Renderer.bounds), компенсируя позицией.
    ///
    /// Из двух разворотов (лицом/спиной) берём тот, что ближе к исходному: у таблички из glTF
    /// лицевая сторона может смотреть в любую сторону.
    public class BillboardY : MonoBehaviour
    {
        Camera cam;
        Vector3 pivot;
        Vector3 basePos;
        Quaternion baseRot = Quaternion.identity;
        bool ready;

        void Start() { Prepare(); }

        void Prepare()
        {
            basePos = transform.position;
            baseRot = transform.rotation;
            var rs = GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return;
            var b = rs[0].bounds;
            for (int i = 1; i < rs.Length; i++) b.Encapsulate(rs[i].bounds);
            pivot = b.center;
            ready = true;
        }

        void LateUpdate()
        {
            if (!ready) Prepare();
            if (!ready) return;
            if (!cam) cam = Camera.main;
            if (!cam) return;

            var c = cam.transform.position;
            Vector3 dir = new Vector3(pivot.x - c.x, 0f, pivot.z - c.z);
            if (dir.sqrMagnitude < 0.0001f) return;

            float want = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            float cur = baseRot.eulerAngles.y;
            // Два решения отличаются на 180° — берём то, что требует меньшего поворота.
            float d1 = Mathf.DeltaAngle(cur, want);
            float d2 = Mathf.DeltaAngle(cur, want + 180f);
            float yaw = cur + (Mathf.Abs(d1) <= Mathf.Abs(d2) ? d1 : d2);

            var want_rot = Quaternion.Euler(0f, yaw, 0f);
            // Поворот «сверху» от исходной ориентации: R = want_rot * baseRot⁻¹.
            var R = want_rot * Quaternion.Inverse(baseRot);
            transform.rotation = want_rot;
            // Компенсация: разворачиваем вокруг своего центра, а не вокруг начала координат.
            transform.position = pivot - R * (pivot - basePos);
        }
    }
}
