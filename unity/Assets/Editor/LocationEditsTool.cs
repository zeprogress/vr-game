using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Zep;

/// Ручные правки локаций в Unity, общие с вебом. Как пользоваться:
///   1. Открыть сцену (Assets/Scenes/Slice.unity или Spectator.unity), в «Locations» двигать, вращать,
///      масштабировать объекты, выключать или удалять их, дублировать (Ctrl+D) — объекты верхнего уровня
///      внутри world / catacombs / dungeon.
///   2. Меню «Zep → Локации → Сохранить правки» — отличия от выгрузки пишутся в src/client/world/locationEdits.json.
///   3. Этот файл читают и пересборка Unity (Zep → Build Slice), и веб (client/world/locationEdits.ts).
/// Сохранение перечитывает весь файл из сцены — правки, сделанные раньше, должны быть в сцене (они там есть
/// после пересборки).
public static class LocationEditsTool
{
    const string Root = "Assets/Slice";
    const float MatchM = 3f;

    static string JsonPath => Path.GetFullPath(Path.Combine(Application.dataPath, "../../src/client/world/locationEdits.json"));
    static string BasePath => $"{Root}/LocKeys.txt";

    [System.Serializable] class Trs { public float[] p, r, s; }
    [System.Serializable] class Part { public float[] c; public bool hide; public Trs move; }
    [System.Serializable] class Edit { public string loc, name; public float[] c; public bool hide; public Trs move; public Trs[] copies; public Part[] parts; }

    /// Режем меш на части, только если их от 2 до стольких (пол из тысяч плиток не дробим).
    const int MaxParts = 400;
    const float PartMatchM = 0.6f;
    [System.Serializable] class File_ { public int version; public Edit[] edits; }

    static readonly List<string> baseline = new();

    /// Пересборка: пометить объекты локации и применить сохранённые правки.
    public static void TagAndApply(GameObject loc, string locName)
    {
        if (locName == "world") baseline.Clear();
        var tops = new List<Transform>();
        foreach (Transform t in loc.transform) tops.Add(t);
        foreach (var t in tops)
        {
            var rends = t.GetComponentsInChildren<Renderer>(true);
            if (rends.Length == 0) continue;
            var b = rends[0].bounds;
            foreach (var r in rends) b.Encapsulate(r.bounds);
            var k = t.gameObject.AddComponent<LocEditKey>();
            k.loc = locName;
            k.nm = t.name;
            k.c = b.center;
            baseline.Add(Key(k));
            foreach (var mf in t.GetComponentsInChildren<MeshFilter>(true)) Split(mf);
            var parts = t.GetComponentsInChildren<LocEditPart>(true);
            if (parts.Length > 0) k.partCs = System.Array.ConvertAll(parts, x => x.c);
        }
        File.WriteAllLines(BasePath, baseline);

        var edits = Load();
        int n = 0;
        foreach (var e in edits)
        {
            if (e.loc != locName) continue;
            var c = V(e.c);
            LocEditKey best = null;
            float bd = MatchM;
            foreach (var t in tops)
            {
                var k = t.GetComponent<LocEditKey>();
                if (!k || k.nm != e.name) continue;
                float d = Vector3.Distance(k.c, c);
                if (d < bd) { bd = d; best = k; }
            }
            if (!best) { Debug.LogWarning($"[locEdits] не нашёл {e.loc}/{e.name} у {c}"); continue; }
            foreach (var cp in e.copies ?? new Trs[0])
            {
                var copy = Object.Instantiate(best.gameObject, loc.transform);
                copy.name = best.name;
                Put(copy.transform, cp);
            }
            foreach (var pe in e.parts ?? new Part[0])
            {
                var pc = V(pe.c);
                LocEditPart bp = null;
                float pd = PartMatchM;
                foreach (var part in best.GetComponentsInChildren<LocEditPart>(true))
                {
                    float d = Vector3.Distance(part.c, pc);
                    if (d < pd) { pd = d; bp = part; }
                }
                if (!bp) { Debug.LogWarning($"[locEdits] не нашёл часть {e.name} у {pc}"); continue; }
                if (pe.move != null && pe.move.p != null && pe.move.p.Length == 3) PutLocal(bp.transform, pe.move);
                if (pe.hide) bp.gameObject.SetActive(false);
            }
            if (e.move != null && e.move.p != null && e.move.p.Length == 3) Put(best.transform, e.move);
            if (e.hide) best.gameObject.SetActive(false);
            n++;
        }
        if (n > 0) Debug.Log($"[locEdits] {locName}: применено правок {n}");
    }

    /// Меш из нескольких несвязных кусков → дочерние объекты «part N», по куску на каждый. Связность — по
    /// совпадающим позициям вершин (шов UV/нормалей не разрывает кусок). Так же режет веб (locationEdits.ts).
    static void Split(MeshFilter mf)
    {
        var mesh = mf.sharedMesh;
        if (!mesh || mesh.subMeshCount != 1 || mf.GetComponent<LocEditPart>()) return;
        var rend = mf.GetComponent<MeshRenderer>();
        if (!rend) return;
        var pos = mesh.vertices;
        var tri = mesh.triangles;
        var weld = new Dictionary<Vector3Int, int>();
        var vid = new int[pos.Length];
        for (int i = 0; i < pos.Length; i++)
        {
            var q = new Vector3Int(Mathf.RoundToInt(pos[i].x * 1000), Mathf.RoundToInt(pos[i].y * 1000), Mathf.RoundToInt(pos[i].z * 1000));
            if (!weld.TryGetValue(q, out var w)) weld[q] = w = weld.Count;
            vid[i] = w;
        }
        var parent = new int[weld.Count];
        for (int i = 0; i < parent.Length; i++) parent[i] = i;
        int FindRoot(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
        for (int t = 0; t < tri.Length; t += 3)
        {
            int a = FindRoot(vid[tri[t]]), b = FindRoot(vid[tri[t + 1]]), c = FindRoot(vid[tri[t + 2]]);
            parent[b] = a; parent[FindRoot(c)] = a;
        }
        var compOf = new Dictionary<int, int>();
        var comps = new List<List<int>>();
        for (int t = 0; t < tri.Length; t += 3)
        {
            int r = FindRoot(vid[tri[t]]);
            if (!compOf.TryGetValue(r, out var ci)) { compOf[r] = ci = comps.Count; comps.Add(new List<int>()); }
            comps[ci].Add(t);
        }
        if (comps.Count < 2 || comps.Count > MaxParts) return;
        var nrm = mesh.normals;
        var uv = mesh.uv;
        var col = mesh.colors;
        for (int ci = 0; ci < comps.Count; ci++)
        {
            var map = new Dictionary<int, int>();
            var v = new List<Vector3>();
            var n = new List<Vector3>();
            var u = new List<Vector2>();
            var cl = new List<Color>();
            var it = new List<int>();
            var sum = Vector3.zero;
            foreach (int t in comps[ci])
                for (int j = 0; j < 3; j++)
                {
                    int old = tri[t + j];
                    if (!map.TryGetValue(old, out var nw))
                    {
                        map[old] = nw = v.Count;
                        v.Add(pos[old]);
                        sum += pos[old];
                        if (nrm.Length == pos.Length) n.Add(nrm[old]);
                        if (uv.Length == pos.Length) u.Add(uv[old]);
                        if (col.Length == pos.Length) cl.Add(col[old]);
                    }
                    it.Add(nw);
                }
            var pm = new Mesh { name = $"{mesh.name}_part{ci}" };
            if (v.Count > 65000) pm.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            pm.SetVertices(v);
            if (n.Count == v.Count) pm.SetNormals(n);
            if (u.Count == v.Count) pm.SetUVs(0, u);
            if (cl.Count == v.Count) pm.SetColors(cl);
            pm.SetTriangles(it, 0);
            pm.RecalculateBounds();
            var go = new GameObject($"part {ci}", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(mf.transform, false);
            go.isStatic = mf.gameObject.isStatic;
            go.GetComponent<MeshFilter>().sharedMesh = pm;
            var pr = go.GetComponent<MeshRenderer>();
            pr.sharedMaterials = rend.sharedMaterials;
            pr.shadowCastingMode = rend.shadowCastingMode;
            pr.receiveShadows = rend.receiveShadows;
            pr.enabled = rend.enabled;
            go.AddComponent<LocEditPart>().c = mf.transform.TransformPoint(sum / v.Count);
        }
        Object.DestroyImmediate(rend);
        Object.DestroyImmediate(mf);
    }

    /// Проверка из командной строки: открыть Slice.unity и сохранить правки (-executeMethod LocationEditsTool.SaveSlice).
    public static void SaveSlice()
    {
        EditorSceneManager.OpenScene("Assets/Scenes/Slice.unity");
        Save();
    }

    [MenuItem("Zep/Локации/Сохранить правки (Unity и веб)")]
    public static void Save()
    {
        var keys = Object.FindObjectsByType<LocEditKey>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        if (keys.Length == 0) { EditorUtility.DisplayDialog("Правки локаций", "В открытой сцене нет объектов локаций. Откройте Slice.unity или Spectator.unity.", "OK"); return; }
        var groups = new Dictionary<string, List<LocEditKey>>();
        foreach (var k in keys)
        {
            var id = Key(k);
            if (!groups.TryGetValue(id, out var l)) groups[id] = l = new List<LocEditKey>();
            l.Add(k);
        }
        var outEdits = new List<Edit>();
        int hidden = 0, moved = 0, copied = 0, partsN = 0;
        // Удалённые из сцены — спрятать.
        var known = File.Exists(BasePath) ? new List<string>(File.ReadAllLines(BasePath)) : new List<string>();
        foreach (var id in known)
        {
            if (groups.ContainsKey(id)) continue;
            var (loc, nm, c) = Parse(id);
            outEdits.Add(new Edit { loc = loc, name = nm, c = A(c), hide = true });
            hidden++;
        }
        foreach (var kv in groups)
        {
            var list = kv.Value;
            // Исходный — раньше в иерархии; остальные — копии (Ctrl+D ставит копию следом).
            list.Sort((a, b) => a.transform.GetSiblingIndex().CompareTo(b.transform.GetSiblingIndex()));
            var orig = list[0];
            var e = new Edit { loc = orig.loc, name = orig.nm, c = A(orig.c) };
            bool any = false;
            if (!orig.gameObject.activeInHierarchy) { e.hide = true; any = true; hidden++; }
            else if (!Identity(orig.transform)) { e.move = T(orig.transform); any = true; moved++; }
            // Части этого объекта: спрятанные, удалённые, сдвинутые.
            var partEdits = new List<Part>();
            var present = orig.GetComponentsInChildren<LocEditPart>(true);
            foreach (var part in present)
            {
                if (!part.gameObject.activeSelf) partEdits.Add(new Part { c = A(part.c), hide = true });
                else if (!LocalIdentity(part.transform)) partEdits.Add(new Part { c = A(part.c), move = TLocal(part.transform) });
            }
            foreach (var pc in orig.partCs ?? new Vector3[0])
            {
                bool found = false;
                foreach (var part in present) if ((part.c - pc).sqrMagnitude < 1e-4f) { found = true; break; }
                if (!found) partEdits.Add(new Part { c = A(pc), hide = true });
            }
            if (partEdits.Count > 0) { e.parts = partEdits.ToArray(); any = true; partsN += partEdits.Count; }
            if (list.Count > 1)
            {
                var cps = new List<Trs>();
                for (int i = 1; i < list.Count; i++) if (list[i].gameObject.activeInHierarchy) cps.Add(T(list[i].transform));
                if (cps.Count > 0) { e.copies = cps.ToArray(); any = true; copied += cps.Count; }
            }
            if (any) outEdits.Add(e);
        }
        File.WriteAllText(JsonPath, ToJson(outEdits));
        Debug.Log($"[locEdits] сохранено в {JsonPath}: спрятано {hidden}, сдвинуто {moved}, копий {copied}, правок частей {partsN}");
        EditorUtility.DisplayDialog("Правки локаций", $"Сохранено: спрятано {hidden}, сдвинуто {moved}, копий {copied}, правок частей {partsN}.\n\nФайл: src/client/world/locationEdits.json — его читают и Unity, и веб.", "OK");
    }

    static string Key(LocEditKey k) => $"{k.loc}|{k.nm}|{k.c.x.ToString("0.00", CultureInfo.InvariantCulture)},{k.c.y.ToString("0.00", CultureInfo.InvariantCulture)},{k.c.z.ToString("0.00", CultureInfo.InvariantCulture)}";

    static (string, string, Vector3) Parse(string id)
    {
        var p = id.Split('|');
        var c = p[2].Split(',');
        return (p[0], p[1], new Vector3(F(c[0]), F(c[1]), F(c[2])));
    }

    static float F(string s) => float.Parse(s, CultureInfo.InvariantCulture);
    static float[] A(Vector3 v) => new[] { v.x, v.y, v.z };
    static Vector3 V(float[] a) => a != null && a.Length == 3 ? new Vector3(a[0], a[1], a[2]) : Vector3.zero;

    /// Локация стоит в начале координат без поворота — мировой TRS объекта и есть правка.
    static bool Identity(Transform t) =>
        t.position.sqrMagnitude < 1e-6f && Quaternion.Angle(t.rotation, Quaternion.identity) < 0.01f && (t.lossyScale - Vector3.one).sqrMagnitude < 1e-6f;

    static bool LocalIdentity(Transform t) =>
        t.localPosition.sqrMagnitude < 1e-6f && Quaternion.Angle(t.localRotation, Quaternion.identity) < 0.01f && (t.localScale - Vector3.one).sqrMagnitude < 1e-6f;

    /// Сдвиг части — в осях её объекта (он стоит в начале координат, так что это и мировые оси).
    static Trs TLocal(Transform t)
    {
        var q = t.localRotation;
        return new Trs { p = A(t.localPosition), r = new[] { q.x, q.y, q.z, q.w }, s = A(t.localScale) };
    }

    static Trs T(Transform t)
    {
        var q = t.rotation;
        return new Trs { p = A(t.position), r = new[] { q.x, q.y, q.z, q.w }, s = A(t.lossyScale) };
    }

    static void Put(Transform t, Trs x)
    {
        t.position = V(x.p);
        t.rotation = new Quaternion(x.r[0], x.r[1], x.r[2], x.r[3]);
        t.localScale = V(x.s);
    }

    static void PutLocal(Transform t, Trs x)
    {
        t.localPosition = V(x.p);
        t.localRotation = new Quaternion(x.r[0], x.r[1], x.r[2], x.r[3]);
        t.localScale = V(x.s);
    }

    static List<Edit> Load()
    {
        if (!File.Exists(JsonPath)) return new List<Edit>();
        var f = JsonUtility.FromJson<File_>(File.ReadAllText(JsonPath));
        return f?.edits != null ? new List<Edit>(f.edits) : new List<Edit>();
    }

    static string N(float v) => v.ToString("0.####", CultureInfo.InvariantCulture);
    static string Arr(float[] a) => "[" + string.Join(", ", System.Array.ConvertAll(a, N)) + "]";
    static string TrsJson(Trs t) => $"{{ \"p\": {Arr(t.p)}, \"r\": {Arr(t.r)}, \"s\": {Arr(t.s)} }}";

    static string ToJson(List<Edit> edits)
    {
        var sb = new StringBuilder();
        sb.Append("{\n  \"version\": 1,\n  \"edits\": [");
        for (int i = 0; i < edits.Count; i++)
        {
            var e = edits[i];
            sb.Append(i == 0 ? "\n" : ",\n");
            sb.Append($"    {{ \"loc\": \"{e.loc}\", \"name\": \"{e.name.Replace("\\", "\\\\").Replace("\"", "\\\"")}\", \"c\": {Arr(e.c)}");
            if (e.hide) sb.Append(", \"hide\": true");
            if (e.move != null) sb.Append($", \"move\": {TrsJson(e.move)}");
            if (e.parts != null && e.parts.Length > 0)
            {
                sb.Append(", \"parts\": [");
                for (int k = 0; k < e.parts.Length; k++)
                {
                    var pt = e.parts[k];
                    sb.Append((k > 0 ? ", " : "") + $"{{ \"c\": {Arr(pt.c)}");
                    if (pt.hide) sb.Append(", \"hide\": true");
                    if (pt.move != null) sb.Append($", \"move\": {TrsJson(pt.move)}");
                    sb.Append(" }");
                }
                sb.Append("]");
            }
            if (e.copies != null && e.copies.Length > 0)
            {
                sb.Append(", \"copies\": [");
                for (int k = 0; k < e.copies.Length; k++) sb.Append((k > 0 ? ", " : "") + TrsJson(e.copies[k]));
                sb.Append("]");
            }
            sb.Append(" }");
        }
        sb.Append(edits.Count > 0 ? "\n  ]\n}\n" : "]\n}\n");
        return sb.ToString();
    }
}
