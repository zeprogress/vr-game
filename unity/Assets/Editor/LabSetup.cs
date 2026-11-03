using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Zep
{
    /// Собирает сцену полигона умений: Zep → Build Skills Lab.
    /// Сами данные и эффекты — из игры (Assets/Resources/skillLab.json + ClassActs/BossActs),
    /// поэтому сцена — только камера, свет, земля и компонент SkillLab.
    public static class LabSetup
    {
        [MenuItem("Zep/Build Skills Lab")]
        public static void Build()
        {
            var assets = AssetDatabase.LoadAssetAtPath<SliceAssets>("Assets/Slice/SliceAssets.asset");
            var data = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Resources/skillLab.json");
            if (!assets) Debug.LogError("[lab] нет Assets/Slice/SliceAssets.asset");
            if (!data) Debug.LogError("[lab] нет Assets/Resources/skillLab.json — запусти npm run lab:unity");

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var labGo = new GameObject("SkillLab");
            var lab = labGo.AddComponent<SkillLab>();
            lab.assets = assets;
            lab.data = data;

            // Земля: тот же зелёный, что в веб-лаборатории.
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "LabGround";
            ground.transform.localScale = new Vector3(8, 1, 8);
            var sh = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var mat = new Material(sh);
            var green = new Color(0.28f, 0.42f, 0.22f);
            mat.color = green;
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", green);
            Directory.CreateDirectory("Assets/Slice");
            var matPath = "Assets/Slice/LabGround.mat";
            AssetDatabase.DeleteAsset(matPath);
            AssetDatabase.CreateAsset(mat, matPath);
            ground.GetComponent<Renderer>().sharedMaterial = mat;

            // Свет: мягкое солнце, как на поляне.
            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.94f, 0.84f);
            sun.intensity = 1.6f;
            sun.shadows = LightShadows.Soft;
            sun.transform.rotation = Quaternion.Euler(38, -35, 0);
            RenderSettings.sun = sun;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.42f, 0.46f, 0.52f);
            RenderSettings.fog = false;

            // Камера: полигон смотрит на героя и манекены.
            var camGo = new GameObject("Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.tag = "MainCamera";
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.55f, 0.72f, 0.9f);
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 300f;
            cam.fieldOfView = 60;
            camGo.transform.position = new Vector3(0, 2.4f, -7f);
            camGo.transform.LookAt(new Vector3(0, 1.2f, 2f));
            var orbit = camGo.AddComponent<LabOrbit>();
            orbit.target = labGo.transform;
            lab.cam = cam;

            Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Lab.unity");
            AssetDatabase.SaveAssets();
            Debug.Log("[lab] Assets/Scenes/Lab.unity сохранена — нажми Play");
        }

        [MenuItem("Zep/Open Skills Lab")]
        public static void Open()
        {
            if (File.Exists("Assets/Scenes/Lab.unity")) EditorSceneManager.OpenScene("Assets/Scenes/Lab.unity");
            else Build();
        }
    }
}
