using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Zep
{
    /// Плотная трава вокруг камеры: статичные чанки дают общий покров и дальний
    /// LOD, а этот слой добавляет густые пучки в ближнем радиусе (как веб).
    /// Рисуется instancing-ом, без GameObject на каждый пучок.
    public class GrassNear : MonoBehaviour
    {
        public Mesh grassMesh;
        public Material grassMaterial;
        public float radius = 42f;
        public float cell = 0.85f;
        public int maxInstances = 8000;
        /** Центр лагеря: на вытоптанной площадке травы нет. */
        public Vector2 hub = new(-55f, -55f);

        Camera cam;
        Vector3 last = new(1e9f, 0, 0);
        Matrix4x4[] instances = Array.Empty<Matrix4x4>();
        int count;

        void Update()
        {
            if (!cam) cam = Camera.main;
            if (!cam || !grassMesh || !grassMaterial) return;
            var p = cam.transform.position;
            if ((p - last).sqrMagnitude < 2.25f) return;
            last = p;
            Build(p);
        }

        void Build(Vector3 center)
        {
            if (instances.Length < maxInstances) instances = new Matrix4x4[maxInstances];
            var terrain = Terrain.activeTerrain;
            if (!terrain) { count = 0; return; }
            var tp = terrain.transform.position;
            count = 0;
            int n = Mathf.CeilToInt(radius / cell);
            for (int ix = -n; ix <= n; ix++)
                for (int iz = -n; iz <= n; iz++)
                {
                    if (count >= maxInstances) break;
                    float x = center.x + ix * cell + Hash(ix, iz, 1) * cell * 0.7f;
                    float z = center.z + iz * cell + Hash(ix, iz, 2) * cell * 0.7f;
                    float dx = x - center.x, dz = z - center.z;
                    if (dx * dx + dz * dz > radius * radius) continue;
                    if (Mathf.Sqrt((x - hub.x) * (x - hub.x) + (z - hub.y) * (z - hub.y)) < 23f) continue;
                    float y = terrain.SampleHeight(new Vector3(x, 0, z)) + tp.y;
                    float sc = 0.45f + Hash(ix, iz, 3) * 0.7f;
                    var rot = Quaternion.Euler(0, Hash(ix, iz, 4) * 360f, 0);
                    instances[count++] = Matrix4x4.TRS(new Vector3(x, y, z), rot, Vector3.one * sc);
                }
        }

        static float Hash(int x, int z, int salt)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393 + z * 668265263 + salt * 1442695041);
                h = (h ^ (h >> 13)) * 1274126177u;
                return ((h ^ (h >> 16)) & 0xffffff) / 16777215f;
            }
        }

        void LateUpdate()
        {
            if (count == 0 || !grassMesh || !grassMaterial) return;
            const int batch = 1023;
            for (int i = 0; i < count; i += batch)
            {
                int n = Mathf.Min(batch, count - i);
                var part = new Matrix4x4[n];
                Array.Copy(instances, i, part, 0, n);
                Graphics.DrawMeshInstanced(grassMesh, 0, grassMaterial, part, n, null, ShadowCastingMode.Off, true, gameObject.layer);
            }
        }
    }
}
