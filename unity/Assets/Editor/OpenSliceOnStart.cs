using UnityEditor;
using UnityEditor.SceneManagement;

/// При открытии проекта с пустой безымянной сценой сразу открывает срез.
[InitializeOnLoad]
static class OpenSliceOnStart
{
    static OpenSliceOnStart()
    {
        EditorApplication.delayCall += () =>
        {
            var s = EditorSceneManager.GetActiveScene();
            if (string.IsNullOrEmpty(s.path) && !s.isDirty && !EditorApplication.isPlayingOrWillChangePlaymode)
                EditorSceneManager.OpenScene("Assets/Scenes/Slice.unity");
        };
    }
}
