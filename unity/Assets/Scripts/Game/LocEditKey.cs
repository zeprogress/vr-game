using UnityEngine;

namespace Zep
{
    /// Метка объекта локации из выгрузки веба: имя меша и центр его геометрии в момент выгрузки — по ним
    /// правка из Unity находит тот же объект в вебе (Editor/LocationEditsTool.cs, client/world/locationEdits.ts).
    public class LocEditKey : MonoBehaviour
    {
        public string loc;
        public string nm;
        public Vector3 c;
        /// Центры частей после нарезки (LocEditPart) — чтобы при сохранении заметить удалённую часть.
        public Vector3[] partCs;
        /// Предмет подземелья (dunDress): c — его исходное место в осях подземелья, r0/s0 — поворот и размер.
        /// Правка такого предмета — новое место целиком, а не сдвиг относительно исходного.
        public bool dress;
        public Quaternion r0 = Quaternion.identity;
        public Vector3 s0 = Vector3.one;
    }
}
