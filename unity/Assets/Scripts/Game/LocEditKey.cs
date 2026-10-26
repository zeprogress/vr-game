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
    }
}
