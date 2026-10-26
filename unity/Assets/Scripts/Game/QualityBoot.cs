using UnityEngine;

namespace Zep
{
    /// Уровень качества по платформе: телефон — «Mobile», ПК — «PC High».
    public static class QualityBoot
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Pick()
        {
            Set(Application.isMobilePlatform ? "Mobile" : "PC High");
            Application.targetFrameRate = Application.isMobilePlatform ? 60 : -1;
        }

        public static void Set(string name)
        {
            int i = System.Array.IndexOf(QualitySettings.names, name);
            if (i >= 0) QualitySettings.SetQualityLevel(i, true);
        }
    }
}
