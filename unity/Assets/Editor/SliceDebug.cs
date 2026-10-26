using UnityEditor;
using UnityEngine;
using Zep;

/// Отладка посадки оружия и перекраски: -executeMethod SliceDebug.Gear
public static class SliceDebug
{
    public static void Gear()
    {
        var a = AssetDatabase.LoadAssetAtPath<SliceAssets>("Assets/Slice/SliceAssets.asset");
        foreach (var cls in new[] { "sword", "spear", "hammer", "bow", "shield" })
        {
            var g = a.Gear(cls, "base");
            var rs = g ? g.GetComponentsInChildren<Renderer>(true) : new Renderer[0];
            var mf = g ? g.GetComponentInChildren<MeshFilter>(true) : null;
            Debug.Log($"[dbg] {cls}: {(g ? g.name : "нет")} parent={(g ? g.transform.parent.name : "")} lpos={(g ? g.transform.localPosition : Vector3.zero)} lscale={(g ? g.transform.localScale : Vector3.zero)} renderers={rs.Length} meshBounds={(mf && mf.sharedMesh ? mf.sharedMesh.bounds.size : Vector3.zero)} children={(g ? g.transform.childCount : 0)}");
        }
        var go = new GameObject("t");
        var rig = go.AddComponent<HeroRig>();
        rig.Init(a);
        rig.Apply(6, "shield", "base", "sword", "base"); // пират
        foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            Debug.Log($"[dbg] {r.name}: {string.Join(", ", System.Array.ConvertAll(r.sharedMaterials, m => m ? m.name + " " + (m.HasProperty("baseColorFactor") ? m.GetColor("baseColorFactor").ToString() : "?") : "-"))} bounds={r.bounds.size}");
    }
}
