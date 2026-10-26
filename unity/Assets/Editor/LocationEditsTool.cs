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
    [System.Serializable] class Edit { public string loc, name; public float[] c; public bool hide; public Trs move; public Trs[] copies; }
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
            if (e.move != null && e.move.p != null && e.move.p.Length == 3) Put(best.transform, e.move);
            if (e.hide) best.gameObject.SetActive(false);
            n++;
        }
        if (n > 0) Debug.Log($"[locEdits] {locName}: применено правок {n}");
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
        int hidden = 0, moved = 0, copied = 0;
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
            if (list.Count > 1)
            {
                var cps = new List<Trs>();
                for (int i = 1; i < list.Count; i++) if (list[i].gameObject.activeInHierarchy) cps.Add(T(list[i].transform));
                if (cps.Count > 0) { e.copies = cps.ToArray(); any = true; copied += cps.Count; }
            }
            if (any) outEdits.Add(e);
        }
        File.WriteAllText(JsonPath, ToJson(outEdits));
        Debug.Log($"[locEdits] сохранено в {JsonPath}: спрятано {hidden}, сдвинуто {moved}, копий {copied}");
        EditorUtility.DisplayDialog("Правки локаций", $"Сохранено: спрятано {hidden}, сдвинуто {moved}, копий {copied}.\n\nФайл: src/client/world/locationEdits.json — его читают и Unity, и веб.", "OK");
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
