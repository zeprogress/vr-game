using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using Zep;

/// Недостающие модели без браузера: мелочь подземелья (модули DungeonKit.glb по dunDress, props.json из
/// scripts/unity-heightmap.mts), пугало и манекен (как Mob.buildScarecrow и combat/Dummy.ts), огни свечей и
/// факелов катакомб (по геометрии пламени catFlames).
public static class PropsBuilder
{
    const string Root = "Assets/Slice";

    [Serializable] class Piece { public string k, zone; public float[] p, f, up, s; }
    [Serializable] class PropsJson { public float[] dunOrigin; public Piece[] dress; }

    // Материал модуля по виду — KIT_MAT / MASONRY_KIT / TEX_OF в DungeonFx.ts.
    static readonly Dictionary<string, string> KitMat = new()
    {
        ["Brazier"] = "metal", ["Sconce"] = "metal", ["MineCart"] = "metal", ["Cage"] = "metal",
        ["Barrel"] = "wood", ["Crate"] = "wood", ["Chest"] = "wood", ["Banner"] = "cloth", ["Bones"] = "bone",
        ["Column"] = "masonry", ["Arch"] = "masonry", ["Wall"] = "masonry", ["Stairs"] = "masonry",
        ["BridgeSeg"] = "masonry", ["Statue"] = "masonry", ["Crystal"] = "crystal",
    };

    static Material Mat(string key, Material lit)
    {
        string path = $"{Root}/Kit_{key}.mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m) return m;
        m = new Material(lit);
        if (key == "crystal")
        {
            // Кристаллы светятся холодным (crystalMat в вебе).
            m.SetColor("_BaseColor", new Color(0.35f, 0.65f, 1f));
            m.EnableKeyword("_EMISSION");
            m.SetColor("_EmissionColor", new Color(0.25f, 0.6f, 1.4f));
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
        }
        else
        {
            string t = key == "bone" ? "masonry" : key; // кость — гранитная текстура, светлее (как в вебе)
            m.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"Assets/Textures/dungeon/{t}_c.jpg"));
            var n = $"Assets/Textures/dungeon/{t}_n.jpg";
            if (AssetImporter.GetAtPath(n) is TextureImporter ti && ti.textureType != TextureImporterType.NormalMap) { ti.textureType = TextureImporterType.NormalMap; ti.SaveAndReimport(); }
            m.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>(n));
            m.EnableKeyword("_NORMALMAP");
            m.SetColor("_BaseColor", key == "bone" ? new Color(1f, 0.95f, 0.8f) : Color.white);
            m.SetFloat("_Smoothness", key == "metal" ? 0.45f : 0.08f);
            m.SetFloat("_Metallic", key == "metal" ? 0.5f : 0f);
        }
        AssetDatabase.CreateAsset(m, path);
        return m;
    }

    /// Мелочь подземелья: по предмету на запись dunDress (модуль <k>_LOD0, разворот f/up, масштаб s).
    public static void DungeonDress(Transform parent, Material lit, Action<GameObject> setStatic)
    {
        var json = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Terrain/props.json");
        var kit = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/dungeon/DungeonKit.glb");
        if (!json || !kit) { Debug.LogWarning("[slice] нет props.json или DungeonKit.glb"); return; }
        var data = JsonUtility.FromJson<PropsJson>(json.text);
        var meshes = new Dictionary<string, Mesh>();
        foreach (var mf in kit.GetComponentsInChildren<MeshFilter>(true)) meshes[mf.name] = mf.sharedMesh;
        var origin = new Vector3(data.dunOrigin[0], data.dunOrigin[1], data.dunOrigin[2]);
        var root = new GameObject("dungeonDress").transform;
        root.SetParent(parent, false);
        // Корень — в начале подземелья, предметы — в его осях: так их положение совпадает с dunDress в вебе
        // (по нему правки из Unity находят и меняют те же предметы, LocationEditsTool / locationEdits.ts).
        root.localPosition = origin;
        int made = 0;
        foreach (var d in data.dress)
        {
            if (!meshes.TryGetValue(d.k + "_LOD0", out var mesh)) continue;
            string kind = d.k.Split('_')[0];
            var go = new GameObject(d.k, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(root, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            go.GetComponent<MeshRenderer>().sharedMaterial = Mat(KitMat.TryGetValue(kind, out var key) ? key : "rock", lit);
            // Огонь горит внутри чаши жаровни — её тень ложилась на пол тёмным кругом.
            if (kind == "Brazier") go.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var f = new Vector3(d.f[0], d.f[1], d.f[2]);
            var up = new Vector3(d.up[0], d.up[1], d.up[2]);
            go.transform.localPosition = new Vector3(d.p[0], d.p[1], d.p[2]);
            if (f.sqrMagnitude > 1e-6f) go.transform.rotation = Quaternion.LookRotation(f, up.sqrMagnitude > 1e-6f ? up : Vector3.up);
            go.transform.localScale = new Vector3(d.s[0], d.s[1], d.s[2]);
            setStatic(go);
            var lk = go.AddComponent<Zep.LocEditKey>();
            lk.loc = "dress";
            lk.nm = d.k;
            lk.c = go.transform.localPosition;
            lk.dress = true;
            lk.r0 = go.transform.localRotation;
            lk.s0 = go.transform.localScale;
            made++;
        }
        Debug.Log($"[slice] мелочь подземелья: {made} из {data.dress.Length}");
        LocationEditsTool.ApplyDress(root);
    }

    // ---------------- пугало и манекен ----------------

    static Material Flat(string name, Color c, Material lit)
    {
        string path = $"{Root}/Prop_{name}.mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!m) { m = new Material(lit); AssetDatabase.CreateAsset(m, path); }
        m.SetColor("_BaseColor", c);
        m.SetFloat("_Smoothness", 0f);
        return m;
    }

    /// Конус/усечённый цилиндр по оси Y (MeshBuilder.CreateCylinder с diameterTop/Bottom).
    static Mesh Cone(string name, float dTop, float dBottom, float h, int seg)
    {
        string path = $"{Root}/Mesh_{name}.asset";
        var m = AssetDatabase.LoadAssetAtPath<Mesh>(path);
        if (m) return m;
        var v = new List<Vector3>();
        var t = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            v.Add(d * dBottom / 2 + Vector3.down * h / 2);
            v.Add(d * dTop / 2 + Vector3.up * h / 2);
            if (i < seg) { int k = i * 2; t.AddRange(new[] { k, k + 1, k + 3, k, k + 3, k + 2 }); }
        }
        int cb = v.Count; v.Add(Vector3.down * h / 2);
        int ct = v.Count; v.Add(Vector3.up * h / 2);
        for (int i = 0; i < seg; i++) { t.AddRange(new[] { cb, i * 2 + 2, i * 2 }); t.AddRange(new[] { ct, i * 2 + 1, i * 2 + 3 }); }
        m = new Mesh { name = name, vertices = v.ToArray(), triangles = t.ToArray() };
        m.RecalculateNormals();
        m.RecalculateBounds();
        AssetDatabase.CreateAsset(m, path);
        return m;
    }

    static void Part(Transform root, string name, Mesh mesh, Material mat, Vector3 pos, Vector3 scale, float rotZ = 0)
    {
        var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
        go.transform.SetParent(root, false);
        go.GetComponent<MeshFilter>().sharedMesh = mesh;
        go.GetComponent<MeshRenderer>().sharedMaterial = mat;
        go.transform.localPosition = pos;
        go.transform.localScale = scale;
        go.transform.localRotation = Quaternion.Euler(0, 0, rotZ);
    }

    static Mesh Builtin(PrimitiveType t)
    {
        var g = GameObject.CreatePrimitive(t);
        var m = g.GetComponent<MeshFilter>().sharedMesh;
        UnityEngine.Object.DestroyImmediate(g);
        return m;
    }

    /// Пугало (buildScarecrow): столб, перекладина-руки, мешок-тело, пучки соломы, голова, шляпа. Высота ~1.8 м.
    public static GameObject Scarecrow(Material lit)
    {
        var root = new GameObject("Scarecrow").transform;
        var cyl = Builtin(PrimitiveType.Cylinder); // Unity: высота 2, диаметр 1
        var box = Builtin(PrimitiveType.Cube);
        var sph = Builtin(PrimitiveType.Sphere);
        var wood = Flat("scareWood", new Color(0.42f, 0.29f, 0.16f), lit);
        var sack = Flat("scareSack", new Color(0.74f, 0.6f, 0.38f), lit);
        var straw = Flat("scareStraw", new Color(0.92f, 0.8f, 0.35f), lit);
        var hat = Flat("scareHat", new Color(0.45f, 0.33f, 0.14f), lit);
        Part(root, "post", cyl, wood, new(0, 0.75f, 0), new(0.1f, 0.75f, 0.1f));
        Part(root, "arms", cyl, wood, new(0, 1.15f, 0), new(0.07f, 0.6f, 0.07f), 90);
        Part(root, "body", box, sack, new(0, 1.0f, 0), new(0.5f, 0.6f, 0.26f));
        var tuft = Cone("scareTuft", 0.02f, 0.16f, 0.18f, 6);
        Part(root, "tuftL", tuft, straw, new(-0.62f, 1.15f, 0), Vector3.one, 90);
        Part(root, "tuftR", tuft, straw, new(0.62f, 1.15f, 0), Vector3.one, -90);
        Part(root, "head", sph, sack, new(0, 1.45f, 0), Vector3.one * 0.34f);
        Part(root, "brim", Cone("scareBrim", 0.6f, 0.6f, 0.03f, 12), hat, new(0, 1.58f, 0), Vector3.one);
        Part(root, "crown", Cone("scareCrown", 0.08f, 0.3f, 0.24f, 10), hat, new(0, 1.7f, 0), Vector3.one);
        return Save(root.gameObject, "Scarecrow");
    }

    /// Тренировочный манекен (Dummy.ts): столб 1 м и фигура — туловище-капсула, голова, руки-брусок.
    public static GameObject Dummy(Material lit)
    {
        var root = new GameObject("Dummy").transform;
        var wood = Flat("dummyPost", new Color(0.3f, 0.2f, 0.12f), lit);
        var body = Flat("dummyBody", new Color(0.75f, 0.68f, 0.5f), lit);
        Part(root, "post", Builtin(PrimitiveType.Cylinder), wood, new(0, 0.5f, 0), new(0.16f, 0.5f, 0.16f));
        var fig = new GameObject("figure").transform;
        fig.SetParent(root, false);
        fig.localPosition = new Vector3(0, 1f, 0);
        Part(fig, "torso", Builtin(PrimitiveType.Capsule), body, new(0, 0.5f, 0), new(0.56f, 0.5f, 0.56f));
        Part(fig, "head", Builtin(PrimitiveType.Sphere), body, new(0, 1.15f, 0), Vector3.one * 0.34f);
        Part(fig, "arms", Builtin(PrimitiveType.Cube), body, new(0, 0.75f, 0), new(1.2f, 0.16f, 0.16f));
        return Save(root.gameObject, "Dummy");
    }

    static GameObject Save(GameObject go, string name)
    {
        var p = PrefabUtility.SaveAsPrefabAsset(go, $"{Root}/{name}.prefab");
        UnityEngine.Object.DestroyImmediate(go);
        return p;
    }

    // ---------------- пятна света на полу катакомб ----------------

    /// catLightPools* — в вебе аддитивные пятна (emissive 1, 0.5, 0.16, мягкая круглая маска, alpha 0.7):
    /// именно они делают пол залов оранжевым. В glTF маска теряется — ставим свой материал.
    /// Подземелье: пятна света под жаровнями (dunFirePool) и свечение портала (dunBackPortal*Glow) — в вебе
    /// круг задаёт маска прозрачности, а в glTF свечение рисовалось на весь квадрат (квадраты, белый портал).
    public static void DunPools(GameObject dungeon, Material unlitAdd)
    {
        if (!dungeon || !unlitAdd) return;
        var tex = PoolTexture();
        Material Make(string name, Color c)
        {
            string path = $"{Root}/{name}.mat";
            AssetDatabase.DeleteAsset(path);
            var m = new Material(unlitAdd);
            m.SetTexture("_BaseMap", tex);
            m.SetColor("_BaseColor", c);
            AssetDatabase.CreateAsset(m, path);
            return m;
        }
        var pool = Make("DunFirePool", new Color(1f, 0.55f, 0.25f, 1f) * 0.55f);
        var portal = Make("DunPortalGlow", new Color(0.55f, 0.35f, 1f, 1f) * 0.9f);
        int n = 0;
        foreach (var r in dungeon.GetComponentsInChildren<Renderer>(true))
        {
            // Имя узла веба — у самого объекта или у родителя (glTFast кладёт меш дочерним объектом).
            string nm = r.name + "|" + (r.transform.parent ? r.transform.parent.name : "");
            if (nm.Contains("dunFirePool")) r.sharedMaterial = pool;
            else if (nm.Contains("dunBackPortal") && (nm.Contains("Disc") || nm.Contains("Pad"))) r.sharedMaterial = portal;
            else continue;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            n++;
        }
        Debug.Log($"[props] пятна и свечение подземелья: {n}");
    }

    /// Мягкий круг (белый, прозрачность к краю) — маска световых пятен.
    static Texture2D PoolTexture()
    {
        string texPath = $"{Root}/CatPool.asset";
        var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
        if (!tex)
        {
            const int N = 128;
            tex = new Texture2D(N, N, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, name = "CatPool" };
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = (x + 0.5f) / N * 2 - 1, v = (y + 0.5f) / N * 2 - 1;
                    float a = Mathf.Clamp01(1 - Mathf.Sqrt(u * u + v * v));
                    tex.SetPixel(x, y, new Color(1, 1, 1, a * a));
                }
            tex.Apply();
            AssetDatabase.CreateAsset(tex, texPath);
        }
        return tex;
    }

    public static void CatPools(GameObject catacombs, Material unlitAdd)
    {
        if (!catacombs || !unlitAdd) return;
        var tex = PoolTexture();
        string matPath = $"{Root}/CatPool.mat";
        AssetDatabase.DeleteAsset(matPath);
        var m = new Material(unlitAdd);
        m.SetTexture("_BaseMap", tex);
        m.SetColor("_BaseColor", new Color(1f, 0.55f, 0.25f, 1f) * 0.7f); // было ×1.8 — пол катакомб заливало оранжевым
        AssetDatabase.CreateAsset(m, matPath);
        int n = 0;
        foreach (var r in catacombs.GetComponentsInChildren<Renderer>(true))
            if (r.name.StartsWith("catLightPools")) { r.sharedMaterial = m; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; n++; }
        Debug.Log($"[slice] пятна света катакомб: {n}");
    }

    // ---------------- огни свечей и факелов катакомб ----------------

    /// Язычки пламени катакомб (catFlames*, catVentFlames*): вершины слитых мешей группируем по близости —
    /// каждая группа — одна свеча или факел. Размер группы решает силу и дальность света.
    /// Все язычки по отдельности (до объединения в источники света) — для живого пламени.
    public static List<SliceAssets.FlameLight> LastSpots = new();

    public static List<SliceAssets.FlameLight> CatFlames(GameObject catacombs)
    {
        var res = new List<SliceAssets.FlameLight>();
        if (!catacombs) return res;
        foreach (var mf in catacombs.GetComponentsInChildren<MeshFilter>(true))
        {
            if (!mf.name.StartsWith("catFlames") && !mf.name.StartsWith("catVentFlames")) continue;
            var mesh = mf.sharedMesh;
            if (!mesh) continue;
            var verts = mesh.vertices;
            var used = new bool[verts.Length];
            var world = new Vector3[verts.Length];
            for (int i = 0; i < verts.Length; i++) world[i] = mf.transform.TransformPoint(verts[i]);
            // Сетка 0.35 м: соседние вершины одного язычка попадают в общую или соседнюю ячейку.
            var cells = new Dictionary<Vector3Int, List<int>>();
            for (int i = 0; i < world.Length; i++)
            {
                var c = Vector3Int.FloorToInt(world[i] / 0.35f);
                if (!cells.TryGetValue(c, out var l)) cells[c] = l = new List<int>();
                l.Add(i);
            }
            for (int i = 0; i < world.Length; i++)
            {
                if (used[i]) continue;
                var stack = new Stack<int>();
                stack.Push(i);
                used[i] = true;
                var b = new Bounds(world[i], Vector3.zero);
                while (stack.Count > 0)
                {
                    int j = stack.Pop();
                    b.Encapsulate(world[j]);
                    var c = Vector3Int.FloorToInt(world[j] / 0.35f);
                    for (int dx = -1; dx <= 1; dx++)
                        for (int dy = -1; dy <= 1; dy++)
                            for (int dz = -1; dz <= 1; dz++)
                                if (cells.TryGetValue(c + new Vector3Int(dx, dy, dz), out var l))
                                    foreach (var q in l)
                                        if (!used[q] && (world[q] - world[j]).sqrMagnitude < 0.3f * 0.3f) { used[q] = true; stack.Push(q); }
                }
                float size = b.size.y;
                res.Add(new SliceAssets.FlameLight { p = b.center, size = size, vent = mf.name.StartsWith("catVent") });
            }
        }
        // Свечи (catCandle, catChandCandle — слиты в catBones/catTheme3Wax; огоньки в вебе — спрайты, их в выгрузке
        // нет): ищем цилиндрики Ø12 см высотой 25–60 см, огонёк — на верхушке.
        int candles = 0;
        foreach (var mf in catacombs.GetComponentsInChildren<MeshFilter>(true))
        {
            if (!mf.name.StartsWith("catBones") && !mf.name.StartsWith("catTheme3Wax") || !mf.sharedMesh) continue;
            var vs = mf.sharedMesh.vertices;
            var cols = new Dictionary<Vector2Int, (float minY, float maxY, Vector2 lo, Vector2 hi)>();
            foreach (var v0 in vs)
            {
                var v = mf.transform.TransformPoint(v0);
                // Ячейка 0.16 м по XZ со сдвигом: свеча целиком попадает в одну ячейку.
                var key = new Vector2Int(Mathf.FloorToInt(v.x / 0.16f), Mathf.FloorToInt(v.z / 0.16f));
                var xz = new Vector2(v.x, v.z);
                if (cols.TryGetValue(key, out var c)) cols[key] = (Mathf.Min(c.minY, v.y), Mathf.Max(c.maxY, v.y), Vector2.Min(c.lo, xz), Vector2.Max(c.hi, xz));
                else cols[key] = (v.y, v.y, xz, xz);
            }
            foreach (var c in cols.Values)
            {
                var ext = c.hi - c.lo;
                float h = c.maxY - c.minY;
                if (ext.x > 0.15f || ext.y > 0.15f || ext.x < 0.06f || h < 0.2f || h > 0.7f) continue;
                var mid = (c.lo + c.hi) / 2;
                res.Add(new SliceAssets.FlameLight { p = new Vector3(mid.x, c.maxY + 0.02f, mid.y), size = 0.3f, candle = true });
                candles++;
            }
        }
        Debug.Log($"[slice] свечей найдено: {candles}");

        // Свечи люстры, канделябра или ряда у стены — один источник на группу в 1.5 м (сила — по числу язычков):
        // Forward+ рисует не больше 256 видимых огней, и сотни отдельных свечей вытесняли лампы залов.
        var merged = new List<SliceAssets.FlameLight>();
        var taken = new bool[res.Count];
        for (int i = 0; i < res.Count; i++)
        {
            if (taken[i]) continue;
            taken[i] = true;
            var sum = res[i].p;
            int n = 1;
            float size = res[i].size;
            bool vent = res[i].vent;
            for (int j = i + 1; j < res.Count; j++)
            {
                if (taken[j] || (res[j].p - res[i].p).sqrMagnitude > 1.5f * 1.5f) continue;
                taken[j] = true;
                sum += res[j].p;
                n++;
                size = Mathf.Max(size, res[j].size);
                vent |= res[j].vent;
            }
            merged.Add(new SliceAssets.FlameLight { p = sum / n, size = size, vent = vent, count = n, candle = res[i].candle });
        }
        Debug.Log($"[slice] огней катакомб: язычков {res.Count}, источников {merged.Count}");
        LastSpots = res;
        return merged;
    }
}
