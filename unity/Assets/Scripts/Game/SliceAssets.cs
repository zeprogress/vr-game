using UnityEngine;

namespace Zep
{
    /// Ссылки на импортированные модели — заполняет Editor/SliceSetup.
    [CreateAssetMenu(menuName = "Zep/Slice Assets")]
    public class SliceAssets : ScriptableObject
    {
        public GameObject hero;
        public GameObject slime;
        public GameObject[] trees;
        public TextAsset treesJson;
    }
}
