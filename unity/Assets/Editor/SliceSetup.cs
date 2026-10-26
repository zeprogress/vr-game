using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Zep;

/// Собирает вертикальный срез с нуля: URP для ПК и телефона, уровни качества,
/// рельеф поляны из heightmap (scripts/unity-heightmap.mts), деревья, свет, постобработку и сцену.
/// Запуск: меню Zep → Build Slice, или -batchmode -executeMethod SliceSetup.Build.
public static class SliceSetup
{
    const string Root = "Assets/Slice";

    /// После смены версии glTFast старые импорты ссылаются на шейдеры прошлой версии (розовые материалы).
    [MenuItem("Zep/Reimport Models")]
    public static void ReimportModels()
    {
        AssetDatabase.ImportAsset("Assets/Models", ImportAssetOptions.ForceUpdate | ImportAssetOptions.ImportRecursive);
    }

    [MenuItem("Zep/Build Slice")]
    public static void Build()
    {
        Dir(Root);
        ImportModels();
        var (pc, mobile) = Pipelines();
        Quality(pc, mobile);
        Input();
        var assets = Assets();
        Scene(assets);
        AssetDatabase.SaveAssets();
        Debug.Log("[slice] готово");
    }

    static void Dir(string p)
    {
        if (!AssetDatabase.IsValidFolder(p)) AssetDatabase.CreateFolder("Assets", p.Substring("Assets/".Length));
    }

    // --- модели: glTFast, анимации как Legacy (Animation) ---

    static void ImportModels()
    {
        foreach (var guid in AssetDatabase.FindAssets("", new[] { "Assets/Models" }))
        {
            var path = AssetDatabase.GUIDToAssetPath(guid);
            if (!path.EndsWith(".glb") && !path.EndsWith(".gltf")) continue;
            var imp = AssetImporter.GetAtPath(path);
            if (imp == null) continue;
            var so = new SerializedObject(imp);
            var am = so.FindProperty("importSettings.animationMethod");
            if (am != null && am.intValue != 1)
            {
                am.intValue = 1; // Legacy
                so.ApplyModifiedPropertiesWithoutUndo();
                imp.SaveAndReimport();
            }
            else if (AssetDatabase.LoadMainAssetAtPath(path) is not GameObject)
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate); // прошлый импорт упал
        }
        foreach (var n in new[] { "grass_bump.png", "rock_n.jpg" })
        {
            var ti = (TextureImporter)AssetImporter.GetAtPath("Assets/Terrain/" + n);
            if (ti != null && ti.textureType != TextureImporterType.NormalMap)
            {
                ti.textureType = TextureImporterType.NormalMap;
                ti.SaveAndReimport();
            }
        }
    }

    // --- URP: два ассета — ПК (HDR, MSAA, мягкие тени, SSAO) и телефон (дешёвый) ---

    static (UniversalRenderPipelineAsset, UniversalRenderPipelineAsset) Pipelines()
    {
        var pc = Pipeline("PC", hdr: true, msaa: 4, scale: 1f, shadowDist: 140, cascades: 4, shadowRes: 4096, soft: true, ssao: true);
        var mobile = Pipeline("Mobile", hdr: false, msaa: 1, scale: 0.8f, shadowDist: 40, cascades: 1, shadowRes: 1024, soft: false, ssao: false);
        GraphicsSettings.defaultRenderPipeline = pc;
        return (pc, mobile);
    }

    static UniversalRenderPipelineAsset Pipeline(string name, bool hdr, int msaa, float scale, float shadowDist,
        int cascades, int shadowRes, bool soft, bool ssao)
    {
        string rdPath = $"{Root}/URP_{name}_Renderer.asset";
        string path = $"{Root}/URP_{name}.asset";
        AssetDatabase.DeleteAsset(rdPath);
        AssetDatabase.DeleteAsset(path);

        var rd = ScriptableObject.CreateInstance<UniversalRendererData>();
        AssetDatabase.CreateAsset(rd, rdPath);
        var ppd = AssetDatabase.LoadAssetAtPath<PostProcessData>(
            "Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
        if (ppd != null) rd.postProcessData = ppd;

        if (ssao)
        {
            var t = Type.GetType("UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion, Unity.RenderPipelines.Universal.Runtime");
            if (t != null)
            {
                var f = (ScriptableRendererFeature)ScriptableObject.CreateInstance(t);
                f.name = "SSAO";
                AssetDatabase.AddObjectToAsset(f, rd);
                rd.rendererFeatures.Add(f);
                var rso = new SerializedObject(rd);
                var map = rso.FindProperty("m_RendererFeatureMap");
                map.arraySize = rd.rendererFeatures.Count;
                AssetDatabase.TryGetGUIDAndLocalFileIdentifier(f, out _, out long lid);
                map.GetArrayElementAtIndex(map.arraySize - 1).longValue = lid;
                rso.ApplyModifiedPropertiesWithoutUndo();
            }
        }
        EditorUtility.SetDirty(rd);

        var asset = UniversalRenderPipelineAsset.Create(rd);
        AssetDatabase.CreateAsset(asset, path);
        var so = new SerializedObject(asset);
        void Set(string prop, Action<SerializedProperty> f)
        {
            var p = so.FindProperty(prop);
            if (p != null) f(p); else Debug.LogWarning("[slice] нет поля URP " + prop);
        }
        Set("m_SupportsHDR", p => p.boolValue = hdr);
        Set("m_MSAA", p => p.intValue = msaa);
        Set("m_RenderScale", p => p.floatValue = scale);
        Set("m_ShadowDistance", p => p.floatValue = shadowDist);
        Set("m_ShadowCascadeCount", p => p.intValue = cascades);
        Set("m_MainLightShadowmapResolution", p => p.intValue = shadowRes);
        Set("m_SoftShadowsSupported", p => p.boolValue = soft);
        Set("m_RequireDepthTexture", p => p.boolValue = ssao);
        so.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(asset);
        return asset;
    }

    // --- уровни качества: «Mobile» (0) и «PC High» (1) ---

    static void Quality(UniversalRenderPipelineAsset pc, UniversalRenderPipelineAsset mobile)
    {
        var qs = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/QualitySettings.asset")[0]);
        var arr = qs.FindProperty("m_QualitySettings");
        while (arr.arraySize > 2) arr.DeleteArrayElementAtIndex(arr.arraySize - 1);
        void Level(int i, string name, RenderPipelineAsset rp, float lodBias, float detailDensity, int texLimit)
        {
            var e = arr.GetArrayElementAtIndex(i);
            e.FindPropertyRelative("name").stringValue = name;
            e.FindPropertyRelative("customRenderPipeline").objectReferenceValue = rp;
            e.FindPropertyRelative("lodBias").floatValue = lodBias;
            var tl = e.FindPropertyRelative("globalTextureMipmapLimit") ?? e.FindPropertyRelative("masterTextureLimit");
            if (tl != null) tl.intValue = texLimit;
            var dd = e.FindPropertyRelative("terrainDetailDensityScale");
            if (dd != null) dd.floatValue = detailDensity;
            var vs = e.FindPropertyRelative("vSyncCount");
            if (vs != null) vs.intValue = 0;
        }
        Level(0, "Mobile", mobile, 0.6f, 0f, 1);
        Level(1, "PC High", pc, 2f, 1f, 0);
        qs.FindProperty("m_CurrentQuality").intValue = 1;

        var per = qs.FindProperty("m_PerPlatformDefaultQuality");
        for (int i = 0; i < per.arraySize; i++)
        {
            var e = per.GetArrayElementAtIndex(i);
            var key = e.FindPropertyRelative("first").stringValue;
            e.FindPropertyRelative("second").intValue = key == "Android" || key == "iPhone" ? 0 : 1;
        }
        qs.ApplyModifiedPropertiesWithoutUndo();
    }

    static void Input()
    {
        var ps = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
        var p = ps.FindProperty("activeInputHandler");
        if (p != null) { p.intValue = 1; ps.ApplyModifiedPropertiesWithoutUndo(); } // только новая Input System
        PlayerSettings.colorSpace = ColorSpace.Linear;
    }

    static SliceAssets Assets()
    {
        string path = $"{Root}/SliceAssets.asset";
        var a = AssetDatabase.LoadAssetAtPath<SliceAssets>(path);
        if (a == null) { a = ScriptableObject.CreateInstance<SliceAssets>(); AssetDatabase.CreateAsset(a, path); }
        a.hero = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/Knight_Male.glb");
        a.slime = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/Slime.glb");
        var trees = new List<GameObject>();
        for (int i = 1; i <= 5; i++)
        {
            var t = AssetDatabase.LoadAssetAtPath<GameObject>($"Assets/Models/Nature/CommonTree_{i}.gltf");
            if (t) trees.Add(t);
        }
        a.trees = trees.ToArray();
        a.treesJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/trees.json");
        if (!a.hero || !a.slime)
        {
            var imp = AssetImporter.GetAtPath("Assets/Models/Knight_Male.glb");
            Debug.LogError($"[slice] модели не импортированы: импортёр {imp?.GetType().FullName}, " +
                string.Join(", ", Array.ConvertAll(AssetDatabase.LoadAllAssetsAtPath("Assets/Models/Knight_Male.glb"), o => o.GetType().Name)));
        }
        EditorUtility.SetDirty(a);
        return a;
    }

    // --- сцена ---

    [Serializable] class HeightInfo { public int res; public float size, minY, maxY; }
    [Serializable] class TreeItem { public float x, z, scale, yaw; }
    [Serializable] class TreeList { public TreeItem[] items; }

    static void Scene(SliceAssets assets)
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // Рельеф
        var info = JsonUtility.FromJson<HeightInfo>(AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/heightmap.json").text);
        var raw = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/heightmap.r16.bytes").bytes;
        var td = new TerrainData { heightmapResolution = info.res };
        td.size = new Vector3(info.size, info.maxY - info.minY, info.size);
        var h = new float[info.res, info.res];
        for (int j = 0; j < info.res; j++)
            for (int i = 0; i < info.res; i++)
                h[j, i] = BitConverter.ToUInt16(raw, (j * info.res + i) * 2) / 65535f;
        td.SetHeights(0, 0, h);

        var grass = Layer("Grass", "Assets/Terrain/grass_diffuse.png", "Assets/Terrain/grass_bump.png", 5f);
        var rock = Layer("Rock", "Assets/Terrain/rock_c.jpg", "Assets/Terrain/rock_n.jpg", 9f);
        td.terrainLayers = new[] { grass, rock };
        td.alphamapResolution = 512;
        int ar = td.alphamapResolution;
        var al = new float[ar, ar, 2];
        for (int y = 0; y < ar; y++)
            for (int x = 0; x < ar; x++)
            {
                float steep = td.GetSteepness((x + 0.5f) / ar, (y + 0.5f) / ar);
                float r = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(24f, 38f, steep));
                al[y, x, 0] = 1 - r;
                al[y, x, 1] = r;
            }
        td.SetAlphamaps(0, 0, al);
        AssetDatabase.DeleteAsset($"{Root}/Terrain.asset");
        AssetDatabase.CreateAsset(td, $"{Root}/Terrain.asset");

        var tgo = Terrain.CreateTerrainGameObject(td);
        tgo.name = "Terrain";
        tgo.transform.position = new Vector3(-info.size / 2, info.minY, -info.size / 2);
        var terrain = tgo.GetComponent<Terrain>();
        var terrainMat = new Material(Shader.Find("Universal Render Pipeline/Terrain/Lit"));
        AssetDatabase.DeleteAsset($"{Root}/TerrainLit.mat");
        AssetDatabase.CreateAsset(terrainMat, $"{Root}/TerrainLit.mat");
        terrain.materialTemplate = terrainMat;
        terrain.heightmapPixelError = 3;
        terrain.basemapDistance = 120;

        // Деревья — те же места, что на сервере
        var treesRoot = new GameObject("Trees").transform;
        if (assets.treesJson && assets.trees.Length > 0)
        {
            var list = JsonUtility.FromJson<TreeList>(assets.treesJson.text);
            int k = 0;
            foreach (var t in list.items)
            {
                var prefab = assets.trees[k++ % assets.trees.Length];
                var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, treesRoot);
                var p = new Vector3(t.x, 0, t.z);
                p.y = terrain.SampleHeight(p) + tgo.transform.position.y;
                go.transform.SetPositionAndRotation(p, Quaternion.Euler(0, t.yaw * Mathf.Rad2Deg, 0));
                go.transform.localScale = Vector3.one * t.scale;
                go.isStatic = true;
            }
        }

        // Солнце, небо, туман
        var sun = new GameObject("Sun").AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.color = new Color(1f, 0.94f, 0.84f);
        sun.intensity = 1.6f;
        sun.shadows = LightShadows.Soft;
        sun.transform.rotation = Quaternion.Euler(38, -35, 0);
        RenderSettings.sun = sun;
        var sky = new Material(Shader.Find("Skybox/Procedural"));
        sky.SetFloat("_SunSize", 0.035f);
        sky.SetFloat("_AtmosphereThickness", 0.9f);
        sky.SetColor("_SkyTint", new Color(0.5f, 0.6f, 0.75f));
        AssetDatabase.DeleteAsset($"{Root}/Sky.mat");
        AssetDatabase.CreateAsset(sky, $"{Root}/Sky.mat");
        RenderSettings.skybox = sky;
        RenderSettings.ambientMode = AmbientMode.Skybox;
        RenderSettings.ambientIntensity = 1.1f;
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogDensity = 0.0045f;
        RenderSettings.fogColor = new Color(0.72f, 0.8f, 0.88f);

        // Постобработка
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.DeleteAsset($"{Root}/Post.asset");
        AssetDatabase.CreateAsset(profile, $"{Root}/Post.asset");
        var tm = profile.Add<Tonemapping>(true); tm.mode.Override(TonemappingMode.ACES);
        var bloom = profile.Add<Bloom>(true); bloom.intensity.Override(0.35f); bloom.threshold.Override(1.1f);
        var ca = profile.Add<ColorAdjustments>(true); ca.postExposure.Override(0.15f); ca.contrast.Override(12f); ca.saturation.Override(8f);
        var wb = profile.Add<WhiteBalance>(true); wb.temperature.Override(6f);
        var vg = profile.Add<Vignette>(true); vg.intensity.Override(0.2f);
        foreach (var c in profile.components) AssetDatabase.AddObjectToAsset(c, profile);
        EditorUtility.SetDirty(profile);
        var vol = new GameObject("Post").AddComponent<Volume>();
        vol.isGlobal = true;
        vol.sharedProfile = profile;

        // Камера
        var cam = new GameObject("Camera").AddComponent<Camera>();
        cam.tag = "MainCamera";
        cam.farClipPlane = 800;
        cam.nearClipPlane = 0.1f;
        cam.fieldOfView = 60;
        var cd = cam.gameObject.AddComponent<UniversalAdditionalCameraData>();
        cd.renderPostProcessing = true;
        cd.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        cam.gameObject.AddComponent<AudioListener>();

        // Сеть, мир, герой
        var net = new GameObject("Net").AddComponent<ZoneNet>();
        var hero = new GameObject("Hero").AddComponent<Hero>();
        hero.cam = cam;
        hero.transform.position = new Vector3(0, terrain.SampleHeight(Vector3.zero) + tgo.transform.position.y, 0);
        var world = new GameObject("World").AddComponent<WorldSync>();
        world.assets = assets;
        world.hero = hero;

        Dir("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Slice.unity");
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Slice.unity", true) };
    }

    /// Снимок сцены без запуска игры: рыцарь и слизень у спавна, кадр в PNG.
    /// -batchmode (без -nographics) -executeMethod SliceSetup.Shot -shotOut <файл.png> [-shotQuality "Mobile"]
    public static void Shot()
    {
        string Arg(string key, string def)
        {
            var a = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(a, key);
            return i >= 0 && i + 1 < a.Length ? a[i + 1] : def;
        }
        QualityBoot.Set(Arg("-shotQuality", "PC High"));
        EditorSceneManager.OpenScene("Assets/Scenes/Slice.unity");
        var assets = AssetDatabase.LoadAssetAtPath<SliceAssets>($"{Root}/SliceAssets.asset");
        var terrain = Terrain.activeTerrain;
        float G(float x, float z) => terrain.SampleHeight(new Vector3(x, 0, z)) + terrain.transform.position.y;
        var hero = UnityEngine.Object.Instantiate(assets.hero);
        hero.transform.SetPositionAndRotation(new Vector3(0, G(0, 0), 0), Quaternion.Euler(0, 30, 0));
        for (int i = 0; i < 3; i++)
        {
            var s = UnityEngine.Object.Instantiate(assets.slime);
            float x = 2.5f + i * 1.6f, z = 3.5f + (i % 2) * 1.2f;
            s.transform.SetPositionAndRotation(new Vector3(x, G(x, z), z), Quaternion.Euler(0, 200, 0));
        }
        var cam = Camera.main;
        var target = new Vector3(1.5f, G(0, 0) + 1.3f, 1.5f);
        cam.transform.position = target + new Vector3(-4.5f, 2.2f, -6f);
        cam.transform.LookAt(target);
        var rt = new RenderTexture(1600, 900, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
        cam.targetTexture = rt;
        cam.Render();
        cam.Render();
        RenderTexture.active = rt;
        var tex = new Texture2D(1600, 900, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
        System.IO.File.WriteAllBytes(Arg("-shotOut", "slice.png"), tex.EncodeToPNG());
        Debug.Log("[slice] снимок готов");
    }

    static TerrainLayer Layer(string name, string diffuse, string normal, float tile)
    {
        string path = $"{Root}/Layer_{name}.terrainlayer";
        AssetDatabase.DeleteAsset(path);
        var l = new TerrainLayer
        {
            diffuseTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(diffuse),
            normalMapTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(normal),
            tileSize = new Vector2(tile, tile),
            normalScale = 1f,
            smoothness = 0.05f,
        };
        AssetDatabase.CreateAsset(l, path);
        return l;
    }
}
