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
        foreach (var guid in AssetDatabase.FindAssets("", new[] { "Assets/Models", "Assets/Locations" }))
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
        // Музыка — потоком (иначе смена трека грузит весь mp3 разом — рывок), короткие звуки — в памяти.
        foreach (var guid in AssetDatabase.FindAssets("t:AudioClip", new[] { "Assets/Resources/Music" }))
        {
            var ai = (AudioImporter)AssetImporter.GetAtPath(AssetDatabase.GUIDToAssetPath(guid));
            var st = ai.defaultSampleSettings;
            if (st.loadType == AudioClipLoadType.Streaming) continue;
            st.loadType = AudioClipLoadType.Streaming;
            st.compressionFormat = AudioCompressionFormat.Vorbis;
            st.quality = 0.6f;
            ai.defaultSampleSettings = st;
            ai.SaveAndReimport();
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
        // ПК — Forward+: в катакомбах десятки факелов, обычный Forward даёт не больше 8 огней на объект.
        if (ssao) rd.renderingMode = RenderingMode.ForwardPlus;
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
        // ПК: тени от точечных огней (подземелье) — атлас под ближайшие к камере огни.
        Set("m_AdditionalLightShadowsSupported", p => p.boolValue = ssao);
        Set("m_AdditionalLightsShadowmapResolution", p => p.intValue = 4096);
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
        a.hero = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/chars/Knight_Male.glb");
        a.slime = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/Slime.glb");

        // Все модели из MODELS (models.json): префаб и его высота по мешам.
        var mj = JsonUtility.FromJson<ModelsJson>(AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/models.json").text);
        var entries = new List<SliceAssets.ModelEntry>();
        foreach (var m in mj.models)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/" + m.path);
            if (!prefab) { Debug.LogWarning($"[slice] нет модели {m.key}: {m.path}"); continue; }
            entries.Add(new SliceAssets.ModelEntry { key = m.key, prefab = prefab, height = MeasureHeight(prefab) });
        }
        a.models = entries.ToArray();
        a.elites = mj.elites;
        a.skins = mj.skins;
        a.bodyRadius = mj.bodyRadius;
        a.meleeRate = mj.meleeRate;
        a.kinds = mj.kinds;
        string litPath = $"{Root}/LitTemplate.mat";
        var lit = AssetDatabase.LoadAssetAtPath<Material>(litPath);
        if (!lit) { lit = new Material(Shader.Find("Universal Render Pipeline/Lit")); AssetDatabase.CreateAsset(lit, litPath); }
        a.litTemplate = lit;
        string trPath = $"{Root}/LitTransparent.mat";
        AssetDatabase.DeleteAsset(trPath);
        var tr = new Material(lit);
        tr.SetFloat("_Surface", 1);
        tr.SetFloat("_Blend", 0);
        tr.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
        tr.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        tr.SetFloat("_ZWrite", 0);
        tr.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        tr.EnableKeyword("_EMISSION");
        tr.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        AssetDatabase.CreateAsset(tr, trPath);
        a.litTransparent = tr;
        a.unlitAlpha = UnlitTemplate("UnlitAlpha", additive: false);
        a.unlitAdd = UnlitTemplate("UnlitAdd", additive: true);
        a.fxDecal = FxTemplate("FxDecal");
        a.fxSparks = FxTemplate("FxSparks");
        a.fxBolt = FxTemplate("FxBolt");
        a.fxPillar = FxTemplate("FxPillar");
        a.bossSkin = FxTemplate("BossSkin");
        a.fxHeat = FxTemplate("FxHeatSphere");
        a.spectatorJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/spectator.json");
        // Оружие в руках из веба: узлы gear_* под кулаками в Gear.glb.
        var gearPrefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Locations/Gear.glb");
        var gear = new List<GameObject>();
        if (gearPrefab)
            foreach (var t in gearPrefab.GetComponentsInChildren<Transform>(true))
                if (t.name.StartsWith("gear_")) gear.Add(t.gameObject);
        a.gear = gear.ToArray();
        Debug.Log($"[slice] оружия в руках {gear.Count}");
        a.xpNext = mj.xpNext;
        // Клипы классов из веба (src/client/dev/unityExport.ts → exportClassClips).
        var clips = new List<AnimationClip>();
        foreach (var o in AssetDatabase.LoadAllAssetsAtPath("Assets/Locations/ClassClips.glb"))
            if (o is AnimationClip c && !c.name.StartsWith("__preview")) clips.Add(c);
        a.classClips = clips.ToArray();
        Debug.Log($"[slice] клипов классов {clips.Count}: {string.Join(", ", clips.ConvertAll(c => c.name))}");
        Debug.Log($"[slice] моделей {entries.Count} из {mj.models.Length}");
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
            var imp = AssetImporter.GetAtPath("Assets/Models/chars/Knight_Male.glb");
            Debug.LogError($"[slice] модели не импортированы: импортёр {imp?.GetType().FullName}, " +
                string.Join(", ", Array.ConvertAll(AssetDatabase.LoadAllAssetsAtPath("Assets/Models/chars/Knight_Male.glb"), o => o.GetType().Name)));
        }
        EditorUtility.SetDirty(a);
        return a;
    }

    /// Статика для батчинга и отсечения, но БЕЗ «участвует в GI»: такие объекты ждут запечённых карт освещения
    /// и без них не получают заливку — подземелье и катакомбы выходили чёрными.
    static void SetStatic(GameObject go) =>
        GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic);

    /// Шаблон URP Unlit для эффектов: прозрачный (alpha) или аддитивный (огонь, свечение), двусторонний.
    static Material FxTemplate(string name)
    {
        string path = $"{Root}/{name}.mat";
        AssetDatabase.DeleteAsset(path);
        var m = new Material(Shader.Find("Zep/" + name));
        AssetDatabase.CreateAsset(m, path);
        return m;
    }

    static Material UnlitTemplate(string name, bool additive)
    {
        string path = $"{Root}/{name}.mat";
        AssetDatabase.DeleteAsset(path);
        var m = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
        m.SetFloat("_Surface", 1);
        m.SetFloat("_Blend", additive ? 2 : 0);
        m.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
        m.SetFloat("_DstBlend", (float)(additive ? UnityEngine.Rendering.BlendMode.One : UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha));
        m.SetFloat("_ZWrite", 0);
        m.SetFloat("_Cull", 0);
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        if (additive) m.EnableKeyword("_BLENDMODE_ADD");
        m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        AssetDatabase.CreateAsset(m, path);
        return m;
    }

    [Serializable] class ModelPath { public string key, path; }
    [Serializable] class ModelsJson
    {
        public ModelPath[] models;
        public SliceAssets.EliteEntry[] elites;
        public string[] skins;
        public float bodyRadius;
        public float[] meleeRate;
        public double[] xpNext;
        public SliceAssets.KindEntry[] kinds;
    }

    /// Высота модели в позе файла: по вершинам мешей в мировых координатах (bounds скиннутых мешей в редакторе врут).
    static float MeasureHeight(GameObject prefab)
    {
        var go = UnityEngine.Object.Instantiate(prefab);
        float lo = float.PositiveInfinity, hi = float.NegativeInfinity;
        foreach (var smr in go.GetComponentsInChildren<SkinnedMeshRenderer>())
        {
            var baked = new Mesh();
            smr.BakeMesh(baked);
            foreach (var v in baked.vertices)
            {
                float y = smr.transform.TransformPoint(v).y;
                lo = Mathf.Min(lo, y); hi = Mathf.Max(hi, y);
            }
            UnityEngine.Object.DestroyImmediate(baked);
        }
        foreach (var mf in go.GetComponentsInChildren<MeshFilter>())
            if (mf.sharedMesh)
                foreach (var v in mf.sharedMesh.vertices)
                {
                    float y = mf.transform.TransformPoint(v).y;
                    lo = Mathf.Min(lo, y); hi = Mathf.Max(hi, y);
                }
        UnityEngine.Object.DestroyImmediate(go);
        return hi > lo ? hi - lo : 1f;
    }

    // --- сцена ---

    [Serializable] class HeightInfo { public int res; public float size, x0, z0, minY, maxY; }
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

        var grass = Layer("Grass", "Assets/Terrain/grass_diffuse.png", "Assets/Terrain/grass_bump.png", 11f, default, new Vector4(0.86f, 0.9f, 0.86f, 1), new Vector4(0.2f, 0.2f, 0.2f, 0));
        var rock = Layer("Rock", "Assets/Terrain/rock_c.jpg", "Assets/Terrain/rock_n.jpg", 9f);
        // Против повтора рисунка: та же трава ещё двумя слоями — другой шаг и сдвиг, суше и зеленее;
        // слои смешиваются крупным шумом, рисунок не совпадает, по поляне — естественные пятна.
        var grassDry = Layer("GrassDry", "Assets/Terrain/grass_diffuse.png", "Assets/Terrain/grass_bump.png", 23f, new Vector2(3.1f, 7.7f), new Vector4(0.9f, 0.84f, 0.66f, 1), new Vector4(0.2f, 0.18f, 0.14f, 0));
        // Свой бесшовный слой «трава без рисунка»: шум средних цветов родной текстуры. Занимает около
        // половины веса — повторяющийся узор травы тонет в нём, а поляна сохраняет её цвет и крупные пятна.
        var grassLush = Layer("GrassNoise", GrassNoiseTexture(), null, 17f, new Vector2(2.3f, 4.1f), null, null);
        td.terrainLayers = new[] { grass, rock, grassDry, grassLush };
        td.alphamapResolution = 512;
        int ar = td.alphamapResolution;
        var al = new float[ar, ar, 4];
        float Fbm(float u, float v, float f) => Mathf.PerlinNoise(u * f + 13.1f, v * f + 7.3f) * 0.65f + Mathf.PerlinNoise(u * f * 2.7f + 3.3f, v * f * 2.7f + 19.9f) * 0.35f;
        for (int y = 0; y < ar; y++)
            for (int x = 0; x < ar; x++)
            {
                float u = (x + 0.5f) / ar, v = (y + 0.5f) / ar;
                float steep = td.GetSteepness(u, v);
                float r = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(24f, 38f, steep));
                // Три тайлинга травы смешаны везде (рисунки с разным шагом гасят друг друга), доли плавают шумом.
                float w0 = 0.15f + 0.35f * Fbm(u, v, 7f);
                float w2 = 0.12f + 0.35f * Fbm(v + 0.37f, u + 0.61f, 9f);
                float w3 = 0.75f + 0.3f * Fbm(u + 0.83f, v + 0.19f, 12f);
                float sum = w0 + w2 + w3;
                float g = 1 - r;
                al[y, x, 0] = g * w0 / sum;
                al[y, x, 1] = r;
                al[y, x, 2] = g * w2 / sum;
                al[y, x, 3] = g * w3 / sum;
            }
        td.SetAlphamaps(0, 0, al);
        AssetDatabase.DeleteAsset($"{Root}/Terrain.asset");
        AssetDatabase.CreateAsset(td, $"{Root}/Terrain.asset");

        var tgo = Terrain.CreateTerrainGameObject(td);
        tgo.name = "Terrain";
        tgo.transform.position = new Vector3(info.x0, info.minY, info.z0);
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
                // Деревья крупнее и темнее веба (по просьбе): ×1.35 и тёмные копии материалов.
                go.transform.localScale = Vector3.one * t.scale * 1.35f;
                foreach (var r in go.GetComponentsInChildren<Renderer>())
                {
                    var mats = r.sharedMaterials;
                    for (int i = 0; i < mats.Length; i++) mats[i] = DarkTree(mats[i]);
                    r.sharedMaterials = mats;
                }
                SetStatic(go);
            }
        }

        // Пугало и манекен — собраны из примитивов, как в вебе.
        assets.scarecrow = PropsBuilder.Scarecrow(assets.litTemplate);
        assets.dummy = PropsBuilder.Dummy(assets.litTemplate);
        assets.propsJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/props.json");
        EditorUtility.SetDirty(assets);

        // Локации из веб-клиента (src/client/dev/unityExport.ts): лагерь, арена рейда, горы, озеро,
        // башня, катакомбы, подземелье — уже в мировых координатах.
        var locRoot = new GameObject("Locations").transform;
        foreach (var name in new[] { "world", "catacombs", "dungeon" })
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"Assets/Locations/{name}.glb");
            if (!prefab) { Debug.LogWarning($"[slice] нет локации {name}.glb"); continue; }
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, locRoot);
            go.name = name;
            foreach (var t in go.GetComponentsInChildren<Transform>()) SetStatic(t.gameObject);
            FixUnlit(go);
            // Плоскости огня жаровен веба (dunFire) — на своём шейдере, в glTF без материала, рисовались розовыми.
            // Пламя рисует DayCycle; пятна света на полу (dunFirePool) оставляем.
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                if (r.name.StartsWith("dunFire") && !r.name.StartsWith("dunFirePool")) r.enabled = false;
            if (name == "dungeon") PropsBuilder.DunPools(go, assets.unlitAdd);
            // Под землёй камера спектатора идёт по полу и упирается в стены и свод — лучами по этим коллайдерам.
            if (name == "catacombs")
            {
                assets.catFlames = PropsBuilder.CatFlames(go).ToArray();
                assets.catFlameSpots = PropsBuilder.LastSpots.ToArray();
                // Плоские язычки веба — неподвижные прямоугольники; вместо них живое пламя (Flames).
                foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                    if (r.name.StartsWith("catFlames") || r.name.StartsWith("catVentFlames")) r.enabled = false;
                PropsBuilder.CatPools(go, assets.unlitAdd);
                EditorUtility.SetDirty(assets);
            }
            // Ручные правки локаций (меню «Zep → Локации → Сохранить правки», общий с вебом locationEdits.json).
            LocationEditsTool.TagAndApply(go, name);
            if (name != "world")
                foreach (var mf in go.GetComponentsInChildren<MeshFilter>())
                    if (mf.sharedMesh) mf.gameObject.AddComponent<MeshCollider>().sharedMesh = mf.sharedMesh;
        }

        // Мелочь подземелья — модули набора по dunDress (без браузера).
        PropsBuilder.DungeonDress(locRoot, assets.litTemplate, SetStatic);

        // Солнце, небо, туман
        var sun = new GameObject("Sun").AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.color = new Color(1f, 0.94f, 0.84f);
        sun.intensity = 1.6f;
        sun.shadows = LightShadows.Soft;
        sun.transform.rotation = Quaternion.Euler(38, -35, 0);
        RenderSettings.sun = sun;
        // Небо — градиент как в вебе (Shaders/SkyGradient), цвета по часам ставит DayCycle.
        var sky = new Material(Shader.Find("Zep/SkyGradient"));
        AssetDatabase.DeleteAsset($"{Root}/Sky.mat");
        AssetDatabase.CreateAsset(sky, $"{Root}/Sky.mat");
        RenderSettings.skybox = sky;
        RenderSettings.ambientMode = AmbientMode.Skybox;
        RenderSettings.ambientIntensity = 1.1f;
        RenderSettings.fog = true;
        // Линейный, как в вебе (и DayCycle ставит линейный): сохранённый в сцене режим решает, какой вариант
        // тумана попадёт в шейдеры сборки — с экспоненциальным линейный выбрасывался, тумана не было вовсе.
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogStartDistance = 40f;
        RenderSettings.fogEndDistance = 346f;
        RenderSettings.fogColor = new Color(0.72f, 0.8f, 0.88f);

        // Постобработка
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.DeleteAsset($"{Root}/Post.asset");
        AssetDatabase.CreateAsset(profile, $"{Root}/Post.asset");
        // Цвета — как в вебе: нейтральная тональная коррекция, без тёплого баланса и лишней насыщенности
        // (с ними полдень уходил в оранжевый).
        var tm = profile.Add<Tonemapping>(true); tm.mode.Override(TonemappingMode.Neutral);
        var bloom = profile.Add<Bloom>(true); bloom.intensity.Override(0.3f); bloom.threshold.Override(1.1f);
        var ca = profile.Add<ColorAdjustments>(true); ca.contrast.Override(6f);
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
        // Отсечь «битые» пиксели (NaN/Inf) до bloom: на Linux один такой пиксель раздувался в белое пятно.
        cd.stopNaN = true;
        cd.renderPostProcessing = true;
        cd.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        cam.gameObject.AddComponent<AudioListener>();

        // Сеть, мир, герой
        // Свет по часам и местам (как в вебе): DayCycle рулит солнцем, туманом, небом и огнями под землёй.
        var dayCycle = sun.gameObject.AddComponent<DayCycle>();
        dayCycle.sun = sun;
        dayCycle.assets = assets;
        dayCycle.lightJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/light.json");
        dayCycle.catLightsJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Locations/cat-lights.json");

        var net = new GameObject("Net").AddComponent<ZoneNet>();
        net.gameObject.AddComponent<SoundBank>();
        net.gameObject.AddComponent<ChatTts>();
        net.gameObject.AddComponent<TowerArena>();
        net.gameObject.AddComponent<EffectsRouter>();
        net.gameObject.AddComponent<Projectiles>();
        var hero = new GameObject("Hero").AddComponent<Hero>();
        hero.cam = cam;
        hero.transform.position = new Vector3(0, terrain.SampleHeight(Vector3.zero) + tgo.transform.position.y, 0);
        var world = new GameObject("World").AddComponent<WorldSync>();
        world.assets = assets;
        world.hero = hero;

        Dir("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Slice.unity");

        // Спектатор: тот же мир без героя, камерой рулит режиссёр (SpectatorCamera.ts).
        UnityEngine.Object.DestroyImmediate(hero.gameObject);
        world.hero = null;
        net.spectator = true;
        var director = cam.gameObject.AddComponent<SpectatorDirector>();
        cam.gameObject.AddComponent<VersionWatch>();
        director.cam = cam;
        director.configJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/spectator.json");
        EditorSceneManager.SaveScene(scene, SpectatorScene);

        EditorBuildSettings.scenes = new[]
        {
            new EditorBuildSettingsScene("Assets/Scenes/Slice.unity", true),
            new EditorBuildSettingsScene(SpectatorScene, true),
        };
    }

    const string SpectatorScene = "Assets/Scenes/Spectator.unity";

    /// Отдельная программа спектатора для OBS: только сцена Spectator, окно 1920×1080.
    [MenuItem("Zep/Build Spectator (macOS)")]
    public static void BuildSpectatorMac() => BuildSpectator(BuildTarget.StandaloneOSX, "Builds/Spectator-mac/ZEP Spectator.app");

    [MenuItem("Zep/Build Spectator (Windows)")]
    public static void BuildSpectatorWin() => BuildSpectator(BuildTarget.StandaloneWindows64, "Builds/Spectator-win/ZEP Spectator.exe");

    /// Linux x86_64 (Ubuntu): рядом кладём Spectator.sh — запуск с подключением к прод-серверу.
    [MenuItem("Zep/Build Spectator (Linux)")]
    public static void BuildSpectatorLinux()
    {
        const string dir = "Builds/Spectator-linux";
        BuildSpectator(BuildTarget.StandaloneLinux64, $"{dir}/ZEP Spectator.x86_64");
        var sh = $"{dir}/Spectator.sh";
        System.IO.File.WriteAllText(sh,
            "#!/bin/sh\n" +
            "# Спектатор для OBS, подключается к прод-серверу. Другой сервер: ./Spectator.sh ws://localhost:2567\n" +
            "cd \"$(dirname \"$0\")\"\n" +
            "# Перед стартом — обновление (спектатор закрывается сам, когда на сервере новая версия).\n" +
            "if [ -z \"$ZEP_UPDATED\" ] && [ -x \"$HOME/zep-spectator/update.sh\" ]; then\n" +
            "  ZEP_UPDATED=1 \"$HOME/zep-spectator/update.sh\" --no-restart || true\n" +
            "  [ -x \"$HOME/zep-spectator/current/Spectator.sh\" ] && ZEP_UPDATED=1 exec \"$HOME/zep-spectator/current/Spectator.sh\" \"$@\"\n" +
            "fi\n" +
            "chmod +x \"ZEP Spectator.x86_64\"\n" +
            "# Окно ровно 1920×1080 для OBS (не полный экран; Unity помнит прошлый размер — задаём явно).\n" +
            "exec \"./ZEP Spectator.x86_64\" -screen-width 1920 -screen-height 1080 -screen-fullscreen 0 -server \"${1:-wss://zepgame.duckdns.org}\"\n");
    }

    static void BuildSpectator(BuildTarget target, string path)
    {
        PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
        PlayerSettings.defaultScreenWidth = 1920;
        PlayerSettings.defaultScreenHeight = 1080;
        PlayerSettings.resizableWindow = true;
        PlayerSettings.runInBackground = true; // OBS захватывает окно, даже когда оно не в фокусе
        var r = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { SpectatorScene },
            locationPathName = path,
            target = target,
        });
        Debug.Log($"[slice] спектатор {target}: {r.summary.result}, {r.summary.totalSize / 1048576} МБ → {path}");
    }

    /// В вебе часть материалов — без освещения, только цвет свечения (StandardMaterial.disableLighting:
    /// дальние горы, руны). После выгрузки такой материал чёрный — меняем на URP Unlit цвета свечения.
    /// Трещины лавы (lavaCrackTexture в world/Catacombs.ts): 14 изломанных линий от центра к краю, три слоя
    /// толщины — багровый ореол, оранжевое тело, жёлто-белая середина; центр пустой (печать).
    static readonly Dictionary<Material, Material> darkTrees = new();

    static Material DarkTree(Material src)
    {
        if (!src) return src;
        if (darkTrees.TryGetValue(src, out var d)) return d;
        string path = $"{Root}/TreeMats/{src.name}_{darkTrees.Count}.mat";
        if (!AssetDatabase.IsValidFolder($"{Root}/TreeMats")) AssetDatabase.CreateFolder(Root, "TreeMats");
        AssetDatabase.DeleteAsset(path);
        d = new Material(src) { name = src.name + "_dark" };
        foreach (var prop in new[] { "baseColorFactor", "_BaseColor" })
            if (d.HasProperty(prop)) { var c = d.GetColor(prop); d.SetColor(prop, new Color(c.r * 0.68f, c.g * 0.7f, c.b * 0.66f, c.a)); }
        AssetDatabase.CreateAsset(d, path);
        darkTrees[src] = d;
        return d;
    }

    static Material lavaTpl;

    static Texture2D LavaCrackTexture()
    {
        string path = $"{Root}/CatLavaCracks.asset";
        var old = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        if (old) return old;
        const int S = 512;
        var px = new Color[S * S];
        int seed = 17;
        float Rnd() { seed = (int)((seed * 16807L) % 2147483647); return seed / 2147483647f; }
        void Stroke(List<Vector2> pts, float w, Color c)
        {
            for (int k = 1; k < pts.Count; k++)
            {
                var a = pts[k - 1];
                var b = pts[k];
                int n = Mathf.CeilToInt(Vector2.Distance(a, b));
                for (int i = 0; i <= n; i++)
                {
                    var p = Vector2.Lerp(a, b, i / (float)Mathf.Max(1, n));
                    int r = Mathf.CeilToInt(w / 2);
                    for (int dy = -r; dy <= r; dy++)
                        for (int dx = -r; dx <= r; dx++)
                        {
                            int x = (int)p.x + dx, y = (int)p.y + dy;
                            if (x < 0 || y < 0 || x >= S || y >= S || dx * dx + dy * dy > r * r) continue;
                            var d = px[y * S + x];
                            // Слои ложатся поверх (source-over), как в canvas.
                            px[y * S + x] = new Color(Mathf.Lerp(d.r, c.r, c.a), Mathf.Lerp(d.g, c.g, c.a), Mathf.Lerp(d.b, c.b, c.a), d.a + c.a * (1 - d.a));
                        }
                }
            }
        }
        for (int i = 0; i < 14; i++)
        {
            float a = i / 14f * Mathf.PI * 2 + Rnd() * 0.3f;
            float r = S * (0.14f + Rnd() * 0.06f);
            var pts = new List<Vector2>();
            while (r < S * 0.48f)
            {
                pts.Add(new Vector2(S / 2f + Mathf.Cos(a) * r, S / 2f + Mathf.Sin(a) * r));
                r += 10 + Rnd() * 18;
                a += (Rnd() - 0.5f) * 0.22f;
            }
            Stroke(pts, 9, new Color(1f, 70 / 255f, 10 / 255f, 0.35f));
            Stroke(pts, 4, new Color(1f, 140 / 255f, 30 / 255f, 0.85f));
            Stroke(pts, 1.5f, new Color(1f, 230 / 255f, 140 / 255f, 1f));
        }
        var tex = new Texture2D(S, S, TextureFormat.RGBA32, true) { name = "CatLavaCracks", wrapMode = TextureWrapMode.Clamp };
        tex.SetPixels(px);
        tex.Apply(true);
        AssetDatabase.CreateAsset(tex, path);
        return tex;
    }

    static void FixUnlit(GameObject root)
    {
        var cache = new Dictionary<Material, Material>();
        var unlit = Shader.Find("Universal Render Pipeline/Unlit");
        foreach (var r in root.GetComponentsInChildren<Renderer>())
        {
            var mats = r.sharedMaterials;
            bool changed = false;
            for (int i = 0; i < mats.Length; i++)
            {
                var m = mats[i];
                if (!m) continue;
                if (!cache.TryGetValue(m, out var fixedMat))
                {
                    fixedMat = null;
                    Color baseC = m.HasProperty("baseColorFactor") ? m.GetColor("baseColorFactor") : m.HasProperty("_BaseColor") ? m.GetColor("_BaseColor") : Color.white;
                    Color em = m.HasProperty("emissiveFactor") ? m.GetColor("emissiveFactor") : m.HasProperty("_EmissionColor") ? m.GetColor("_EmissionColor") : Color.black;
                    if (r.name.StartsWith("mountainRing") && em.maxColorComponent < 0.01f) em = new Color(0.4f, 0.45f, 0.54f);
                    string p = $"{Root}/LocMats/{root.name}_{cache.Count}.mat";
                    if (m.name.StartsWith("catLava"))
                    {
                        // Трещины лавы огненной ямы: в вебе — динамическая текстура (не выгружается), без неё
                        // плоскость закрывала весь пол зала чёрным. Своя текстура трещин, аддитивно.
                        lavaTpl = lavaTpl ? lavaTpl : UnlitTemplate("UnlitAddLava", additive: true);
                        fixedMat = new Material(lavaTpl) { name = m.name + "_cracks" };
                        fixedMat.SetTexture("_BaseMap", LavaCrackTexture());
                        fixedMat.SetColor("_BaseColor", new Color(0.55f, 0.4f, 0.32f, 1f)); // приглушено: трещины были слишком явные
                    }
                    else if (m.name == "catSealMat" || m.name == "catRunnerMat")
                    {
                        // Печать и дорожка на полу катакомб в вебе тёмные, едва различимые; у нас светились оранжевым
                        // на весь зал. Без свечения и темнее — узор читается тенью на плитах.
                        fixedMat = new Material(m) { name = m.name + "_dim" };
                        if (fixedMat.HasProperty("emissiveFactor")) fixedMat.SetColor("emissiveFactor", Color.black);
                        if (fixedMat.HasProperty("_EmissionColor")) fixedMat.SetColor("_EmissionColor", Color.black);
                        var bc = fixedMat.HasProperty("baseColorFactor") ? fixedMat.GetColor("baseColorFactor") : Color.white;
                        if (fixedMat.HasProperty("baseColorFactor")) fixedMat.SetColor("baseColorFactor", new Color(bc.r * 0.35f, bc.g * 0.3f, bc.b * 0.3f, bc.a * 0.6f));
                        if (fixedMat.HasProperty("_BaseColor")) fixedMat.SetColor("_BaseColor", new Color(bc.r * 0.35f, bc.g * 0.3f, bc.b * 0.3f, bc.a * 0.6f));
                    }
                    else if (m.name == "catObsidian")
                    {
                        fixedMat = new Material(m) { name = m.name + "_lit" };
                        if (fixedMat.HasProperty("baseColorFactor")) fixedMat.SetColor("baseColorFactor", new Color(0.08f, 0.06f, 0.07f));
                        if (fixedMat.HasProperty("roughnessFactor")) fixedMat.SetFloat("roughnessFactor", 0.35f);
                    }
                    else if (baseC.maxColorComponent < 0.02f && em.maxColorComponent > 0.01f)
                    {
                        fixedMat = new Material(unlit) { name = m.name + "_unlit" };
                        fixedMat.SetColor("_BaseColor", em);
                    }
                    else
                    {
                        // В вебе локации матовые (StandardMaterial без бликов); после выгрузки glTF они блестят и
                        // отражают небо — особенно видно в сумерках и ночью. Делаем матовыми.
                        fixedMat = new Material(m) { name = m.name + "_matte" };
                        if (fixedMat.HasProperty("roughnessFactor")) fixedMat.SetFloat("roughnessFactor", 1f);
                        if (fixedMat.HasProperty("metallicFactor")) fixedMat.SetFloat("metallicFactor", 0f);
                        if (fixedMat.HasProperty("_Smoothness")) fixedMat.SetFloat("_Smoothness", 0f);
                        if (fixedMat.HasProperty("_Metallic")) fixedMat.SetFloat("_Metallic", 0f);
                        // Подсветка материалов (emissive StandardMaterial веба) в URP выходит ярче — ночью палатки
                        // светились. Ослабляем до того же «чуть видно в темноте».
                        if (fixedMat.HasProperty("emissiveFactor")) fixedMat.SetColor("emissiveFactor", fixedMat.GetColor("emissiveFactor") * 0.25f);
                    }
                    if (!AssetDatabase.IsValidFolder($"{Root}/LocMats")) AssetDatabase.CreateFolder(Root, "LocMats");
                    AssetDatabase.DeleteAsset(p);
                    AssetDatabase.CreateAsset(fixedMat, p);
                    cache[m] = fixedMat;
                }
                if (fixedMat) { mats[i] = fixedMat; changed = true; }
            }
            if (changed) r.sharedMaterials = mats;
        }
        Debug.Log($"[slice] {root.name}: материалов переделано {System.Linq.Enumerable.Count(cache.Values, v => v)}");
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
        var cam = Camera.main;
        string what = Arg("-shotWhat", "heroes");
        // Парад моделей: герои всех скинов с разным оружием или все мобы — тем же кодом, что в игре.
        var classes = new[] { "sword", "bow", "dagger", "spear", "hammer", "staff" };
        var items = new List<string>();
        if (what == "heroes") for (int i = 0; i <= assets.skins.Length; i++) items.Add(i.ToString());
        else foreach (var m in assets.models) if (m.key == "slime" || m.key.StartsWith("mon")) items.Add(m.key);
        int cols = what == "heroes" ? items.Count : 9;
        float step = what == "heroes" ? 1.3f : 3.2f;
        var names = new[] { "zep", "Охотник", "bot:Лиса", "Мастер_клинка", "bot:Тень", "NightOwl", "bot:Гром", "Ведьма", "bot:Ёж", "Kappa123", "bot:Север" };
        for (int i = 0; i < items.Count; i++)
        {
            float x = (i % cols - (cols - 1) / 2f) * step, z = (i / cols) * step * 1.4f;
            var pos = new Vector3(x, G(x, z), z);
            if (what == "heroes")
            {
                // Настоящий PlayerView с плашкой; каждый — в середине замаха своим оружием.
                var nick = names[i % names.Length];
                var st = new ZepSchema.PlayerState
                {
                    nick = nick.Replace("bot:", ""), level = (ushort)(5 + i * 9), hp = 40 + i * 6, maxHp = 100, xp = 30 + i * 40,
                    plat = (byte)(i % 3 + 1), skin = (byte)int.Parse(items[i]), title = i == 3 ? "Царь башни" : "",
                    leftCls = classes[i % classes.Length] == "dagger" ? "dagger" : "shield", leftTier = "base",
                    rightCls = classes[i % classes.Length], rightTier = i % 2 == 0 ? "base" : "gold",
                };
                st.head.x = pos.x; st.head.y = pos.y + Hero.EyeHeight; st.head.z = pos.z;
                var q = Quaternion.Euler(0, 180, 0); st.head.qx = q.x; st.head.qy = q.y; st.head.qz = q.z; st.head.qw = q.w;
                var go = new GameObject("hero " + nick);
                var pv = go.AddComponent<PlayerView>();
                pv.Init(nick, st, assets);
                go.transform.SetPositionAndRotation(pos, q);
                pv.SendMessage("Update");
                var rig = go.GetComponent<HeroRig>();
                rig.PlaySwing(st.level);
                var animation = go.GetComponentInChildren<Animation>();
                foreach (AnimationState a in animation) if (animation.IsPlaying(a.name)) { a.normalizedTime = 0.4f; a.weight = 1; }
                animation.Sample();
            }
            else
            {
                var el = assets.Elite(items[i]);
                var st = new ZepSchema.MobState
                {
                    model = items[i] == "slime" ? "" : items[i], scale = el?.scaleMul ?? 1, x = pos.x, y = pos.y, z = pos.z, yaw = Mathf.PI,
                    mobName = items[i].Replace("mon", ""), mobLevel = (byte)(3 + i), hp = i % 3 == 0 ? 60 : 100, maxHp = 100, armor = (byte)(i % 7 == 0 ? 0 : 1 << (i % 6)),
                    kind = i == 5 ? "boss" : "slime",
                };
                var go = new GameObject("mob " + items[i]);
                var mv = go.AddComponent<MobView>();
                mv.Init(items[i], st, assets);
                mv.SendMessage("Update");
            }
        }
        float rows = Mathf.Ceil(items.Count / (float)cols);
        var target = new Vector3(0, G(0, 0) + (what == "heroes" ? 1.0f : 1.5f), (rows - 1) * step * 0.7f);
        cam.transform.position = target + (what == "heroes" ? new Vector3(0, 1.0f, -9.5f) : new Vector3(0, 9f, -26f));
        if (Arg("-shotWhat", "") == "") cam.transform.position = target + new Vector3(-4.5f, 2.2f, -6f);
        cam.transform.LookAt(target);
        // -shotCam x,y,z,tx,ty,tz — снять любую точку мира (проверка локаций).
        var camArg = Arg("-shotCam", "");
        if (camArg != "")
        {
            var v = Array.ConvertAll(camArg.Split(','), s => float.Parse(s, System.Globalization.CultureInfo.InvariantCulture));
            cam.transform.position = new Vector3(v[0], v[1], v[2]);
            cam.transform.LookAt(new Vector3(v[3], v[4], v[5]));
        }
        // -shotHour 18.3 — свет на этот час (и по месту камеры: подземелье, катакомбы).
        var dc = UnityEngine.Object.FindAnyObjectByType<DayCycle>();
        if (dc) dc.Apply(float.Parse(Arg("-shotHour", "12"), System.Globalization.CultureInfo.InvariantCulture), cam.transform.position);
        var rt = new RenderTexture(1600, 900, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
        cam.targetTexture = rt;
        Nameplates.RenderInto(cam);
        Canvas.ForceUpdateCanvases();
        cam.Render();
        cam.Render();
        RenderTexture.active = rt;
        var tex = new Texture2D(1600, 900, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
        System.IO.File.WriteAllBytes(Arg("-shotOut", "slice.png"), tex.EncodeToPNG());
        Debug.Log("[slice] снимок готов");
    }

    static TerrainLayer Layer(string name, string diffuse, string normal, float tile, Vector2 offset = default, Vector4? remapMax = null, Vector4? remapMin = null)
        => Layer(name, AssetDatabase.LoadAssetAtPath<Texture2D>(diffuse), normal, tile, offset, remapMax, remapMin);

    /// Бесшовный шум цвета травы (периодический value-noise, 4 октавы): средний цвет родной текстуры травы,
    /// светлее/темнее и чуть желтее/зеленее пятнами — без узнаваемого рисунка.
    static Texture2D GrassNoiseTexture()
    {
        string path = $"{Root}/GrassNoise.asset";
        AssetDatabase.DeleteAsset(path);
        var src = new Texture2D(2, 2);
        src.LoadImage(System.IO.File.ReadAllBytes("Assets/Terrain/grass_diffuse.png"));
        var px = src.GetPixels32();
        double r = 0, g = 0, b = 0;
        foreach (var c in px) { r += c.r; g += c.g; b += c.b; }
        var avg = new Color((float)(r / px.Length / 255), (float)(g / px.Length / 255), (float)(b / px.Length / 255));
        const int S = 1024;
        float Val(int x, int y, int period, int seed)
        {
            x = ((x % period) + period) % period; y = ((y % period) + period) % period;
            return Mathf.Abs(Mathf.Sin(x * 127.1f + y * 311.7f + seed * 74.7f) * 43758.5453f) % 1f;
        }
        float Noise(float u, float v, int period, int seed)
        {
            float x = u * period, y = v * period;
            int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y);
            float fx = x - xi, fy = y - yi;
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
            return Mathf.Lerp(Mathf.Lerp(Val(xi, yi, period, seed), Val(xi + 1, yi, period, seed), fx),
                              Mathf.Lerp(Val(xi, yi + 1, period, seed), Val(xi + 1, yi + 1, period, seed), fx), fy);
        }
        var outPx = new Color[S * S];
        for (int y = 0; y < S; y++)
            for (int x = 0; x < S; x++)
            {
                float u = (float)x / S, v = (float)y / S;
                float n = Noise(u, v, 6, 1) * 0.4f + Noise(u, v, 17, 2) * 0.3f + Noise(u, v, 53, 3) * 0.2f + Noise(u, v, 160, 4) * 0.1f;
                float hue = Noise(u, v, 9, 5) - 0.5f;
                float k = 0.78f + 0.44f * n;
                outPx[y * S + x] = new Color(avg.r * k * (1 + hue * 0.25f), avg.g * k, avg.b * k * (1 - hue * 0.2f), 1);
            }
        var tex = new Texture2D(S, S, TextureFormat.RGBA32, true) { name = "GrassNoise", wrapMode = TextureWrapMode.Repeat };
        tex.SetPixels(outPx);
        tex.Apply(true);
        AssetDatabase.CreateAsset(tex, path);
        return tex;
    }

    static TerrainLayer Layer(string name, Texture2D diffuse, string normal, float tile, Vector2 offset, Vector4? remapMax, Vector4? remapMin)
    {
        string path = $"{Root}/Layer_{name}.terrainlayer";
        AssetDatabase.DeleteAsset(path);
        var l = new TerrainLayer
        {
            diffuseTexture = diffuse,
            normalMapTexture = normal != null ? AssetDatabase.LoadAssetAtPath<Texture2D>(normal) : null,
            tileSize = new Vector2(tile, tile),
            tileOffset = offset,
            // Рельеф травы — втрое мягче: одна карта на всех слоях давала одинаковые пятна света (повтор).
            normalScale = name.StartsWith("Grass") ? 0.35f : 1f,
            smoothness = 0.05f,
        };
        if (remapMax.HasValue) l.diffuseRemapMax = remapMax.Value;
        // Подъём «нуля» — тёмные пятна текстуры мягче, повтор рисунка не бросается в глаза.
        if (remapMin.HasValue) l.diffuseRemapMin = remapMin.Value;
        AssetDatabase.CreateAsset(l, path);
        return l;
    }
}
