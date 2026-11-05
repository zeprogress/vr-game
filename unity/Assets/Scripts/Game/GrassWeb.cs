using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Zep
{
    /// Трава по веб-раскладке: positions из grass.json (computeGrassLayout),
    /// рисуется instancing-ом. Вблизи — полный меш, вдали — дешёвые лезвия.
    public class GrassWeb : MonoBehaviour
    {
        [Serializable] public class Blade { public float x, z, s, h, yaw; }
        [Serializable] public class Layout { public Blade[] blades; }

        public TextAsset layout;
        public Mesh grassMesh;
        public Material grassMaterial;
        public Mesh farMesh;
        public Material farMaterial;
        public float nearDistance = 45f;
        public float farDistance = 170f;

        readonly List<Matrix4x4> near = new();
        readonly List<Matrix4x4> far = new();
        Camera cam;
        Vector3 last = new(1e9f, 0, 0);
        bool built;

        void Start() { Build(); }

        void Build()
        {
            if (built || !layout || !grassMesh || !grassMaterial) return;
            built = true;
            var data = JsonUtility.FromJson<Layout>(layout.text);
            if (data?.blades == null) return;
            var terrain = Terrain.activeTerrain;
            if (!terrain) return;
            var tp = terrain.transform.position;
            foreach (var b in data.blades)
            {
                float y = terrain.SampleHeight(new Vector3(b.x, 0, b.z)) + tp.y;
                var rot = Quaternion.Euler(0, b.yaw * Mathf.Rad2Deg, 0);
                var sc = Mathf.Max(0.2f, b.s) * (b.h > 0 ? 1f : 1f);
                var m = Matrix4x4.TRS(new Vector3(b.x, y, b.z), rot, new Vector3(sc, sc * (b.h > 0 ? b.h : 1f), sc));
                // Разложение по дальности делаем в LateUpdate.
                near.Add(m);
            }
            cam = Camera.main;
        }

        void LateUpdate()
        {
            if (!built) Build();
            if (!cam) cam = Camera.main;
            if (!cam || near.Count == 0) return;
            var p = cam.transform.position;
            if ((p - last).sqrMagnitude > 4f) { last = p; Split(p); }
            Draw(near, grassMesh, grassMaterial);
            if (farMesh && farMaterial) Draw(far, farMesh, farMaterial);
        }

        void Split(Vector3 p)
        {
            near.Clear(); far.Clear();
            var data = JsonUtility.FromJson<Layout>(layout.text);
            var terrain = Terrain.activeTerrain;
            if (data?.blades == null || !terrain) return;
            var tp = terrain.transform.position;
            foreach (var b in data.blades)
            {
                float dx = b.x - p.x, dz = b.z - p.z;
                float dd = dx * dx + dz * dz;
                if (dd > farDistance * farDistance) continue;
                float y = terrain.SampleHeight(new Vector3(b.x, 0, b.z)) + tp.y;
                var rot = Quaternion.Euler(0, b.yaw * Mathf.Rad2Deg, 0);
                float sc = Mathf.Max(0.2f, b.s);
                var m = Matrix4x4.TRS(new Vector3(b.x, y, b.z), rot, new Vector3(sc, sc * (b.h > 0 ? b.h : 1f), sc));
                if (dd < nearDistance * nearDistance) near.Add(m); else far.Add(m);
            }
        }

        static void Draw(List<Matrix4x4> list, Mesh mesh, Material mat)
        {
            const int batch = 1023;
            for (int i = 0; i < list.Count; i += batch)
            {
                int n = Mathf.Min(batch, list.Count - i);
                var part = new Matrix4x4[n];
                list.CopyTo(i, part, 0, n);
                Graphics.DrawMeshInstanced(mesh, 0, mat, part, n, null, ShadowCastingMode.Off, true, 0);
            }
        }
    }
}
