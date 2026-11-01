using UnityEngine;

namespace Zep
{
    /// Таблички порталов в мире смотрят на камеру лицом (в вебе — BILLBOARDMODE_Y,
    /// Catacombs.ts portalLabelPlane). Объекты приходят из локаций (world.glb / dungeon.glb:
    /// dunCampPortalLabel, dunBackPortal0Label…), имена сохраняются — ищем по ним и навешиваем
    /// BillboardY. Скан повторяем: локация может подгрузиться позже первого кадра.
    public class PortalLabels : MonoBehaviour
    {
        float scanT;
        int rounds, found;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            var go = new GameObject("PortalLabels");
            go.AddComponent<PortalLabels>();
        }

        void Update()
        {
            // Скан не бесплатный (в сцене тысячи объектов): ищем первые 30 секунд и останавливаемся.
            if (found > 0 || rounds >= 15) return;
            if ((scanT -= Time.unscaledDeltaTime) > 0f) return;
            scanT = 2f;
            rounds++;
            var all = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            foreach (var t in all)
            {
                if (!t.name.Contains("Portal") || !t.name.Contains("Label")) continue;
                if (!t.GetComponent<BillboardY>()) t.gameObject.AddComponent<BillboardY>();
                found++;
            }
        }
    }
}
