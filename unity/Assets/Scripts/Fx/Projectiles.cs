using System.Collections.Generic;
using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Снаряды из состояния комнаты: BallState (плевки, копья, шипы, паутина мобов) и BoltState (огнешар
    /// посоха, стрела лука). Между патчами летят по своей скорости (как в вебе), за огнём и стрелой — след.
    public class Projectiles : MonoBehaviour
    {
        // Коды SHOTS в shared/mobs.ts: 0 — плевок, 1 — плевок босса, 2 — копьё, 3 — шип, 4 — паутина.
        // Как MobSystem.ts: плевок — цвет плевуна (SPITTER_CFG.tint), у босса — Багрового, полупрозрачный.
        static readonly Color Spit = new(0.86f, 0.52f, 0.16f, 0.62f);
        static readonly Color SpitBoss = new(0.82f, 0.11f, 0.13f, 0.62f);
        static readonly Color WebC = new(0.92f, 0.94f, 0.9f);
        static readonly Color Wood = new(0.4f, 0.28f, 0.16f);
        const float SpitGravity = 4f; // SPITTER.ballGravity
        const float SpitRadius = 0.14f; // SPITTER.ballRadius

        class Shot
        {
            public Transform tr;
            public Vector3 pos, vel;
            /// Последняя vy с сервера: изменилась — пришёл новый патч, берём его скорость.
            public float srvVy;
            public float grav;
            public bool bolt, orient;
        }

        readonly Dictionary<string, Shot> shots = new();
        Mesh sphere, cube;
        MaterialPropertyBlock mpb;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        void Awake()
        {
            mpb = new MaterialPropertyBlock();
            var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere = s.GetComponent<MeshFilter>().sharedMesh;
            Destroy(s);
            var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube = c.GetComponent<MeshFilter>().sharedMesh;
            Destroy(c);
        }

        public void Attach(ZoneState st)
        {
            st.balls.OnAdd((id, b) => Spawn("b" + id, b.x, b.y, b.z, b.vx, b.vy, b.vz, false, b.k, 0.15f));
            st.balls.OnRemove((id, b) => Remove("b" + id, false, 0));
            st.bolts.OnAdd((id, b) => Spawn("p" + id, b.x, b.y, b.z, b.vx, b.vy, b.vz, true, b.kind, b.r));
            st.bolts.OnRemove((id, b) => Remove("p" + id, true, b.kind));
            this.st = st;
        }

        ZoneState st;

        void Spawn(string id, float x, float y, float z, float vx, float vy, float vz, bool bolt, int kind, float r)
        {
            var a = ZoneNet.I.Assets;
            if (!a) return;
            var go = new GameObject(id, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(transform, false);
            var mf = go.GetComponent<MeshFilter>();
            var mr = go.GetComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var pos = new Vector3(x, y, z);
            float grav;
            bool orient = false;
            Color c;
            if (bolt && kind == 1 || !bolt && (kind == 2 || kind == 3))
            {
                // Стрела героя / копьё / шип моба — вытянуты вдоль полёта.
                mf.sharedMesh = cube;
                mr.sharedMaterial = a.litTemplate;
                float len = bolt ? 0.8f : kind == 2 ? 1.6f : 0.5f;
                float w = bolt ? 0.04f : kind == 2 ? 0.07f : 0.12f;
                go.transform.localScale = new Vector3(w, w, len);
                c = bolt ? new Color(0.85f, 0.85f, 0.8f) : Wood;
                grav = bolt ? 0 : kind == 2 ? 2.5f : 3f; // SHOTS.spear/spike.grav
                orient = true;
            }
            else if (bolt)
            {
                // Огнешар: раскалённое ядро, свет вокруг, огненный след.
                mf.sharedMesh = sphere;
                mr.sharedMaterial = a.unlitAdd;
                go.transform.localScale = Vector3.one * Mathf.Max(0.15f, r) * 2f;
                c = new Color(1f, 0.62f, 0.18f);
                grav = 0;
                var l = go.AddComponent<Light>();
                l.type = LightType.Point;
                l.color = Popups.Fire;
                l.range = 6f;
                l.intensity = 2.5f;
                var tr = go.AddComponent<TrailRenderer>();
                tr.sharedMaterial = a.unlitAdd;
                tr.time = 0.2f;
                tr.startWidth = go.transform.localScale.x * 0.8f;
                tr.endWidth = 0f;
                tr.startColor = new Color(1f, 0.5f, 0.15f, 0.8f);
                tr.endColor = new Color(1f, 0.3f, 0.1f, 0f);
                tr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            else if (kind == 4)
            {
                // Паутинный сгусток паука: белый комок.
                mf.sharedMesh = sphere;
                mr.sharedMaterial = a.litTemplate;
                go.transform.localScale = Vector3.one * 0.5f;
                c = WebC;
                grav = 1.2f; // SHOTS.web.grav
            }
            else
            {
                // Плевок плевуна или Багрового: полупрозрачный шарик.
                mf.sharedMesh = sphere;
                mr.sharedMaterial = a.litTransparent;
                go.transform.localScale = Vector3.one * SpitRadius * 2f;
                c = kind == 1 ? SpitBoss : Spit;
                grav = SpitGravity;
            }
            mpb.SetColor(BaseColor, c);
            mr.SetPropertyBlock(mpb);
            go.transform.position = pos;
            var vel = new Vector3(vx, vy, vz);
            if (orient && vel.sqrMagnitude > 1e-4f) go.transform.rotation = Quaternion.LookRotation(vel);
            shots[id] = new Shot { tr = go.transform, pos = pos, vel = vel, srvVy = vy, grav = grav, bolt = bolt, orient = orient };
            // Звук выстрела, как в вебе: паутина — свой, остальные плевки — плевок; огнешар — спуск тетивы
            // (стрелам звук даёт act:"bow" стрелка, иначе вышел бы двойной).
            if (!bolt) SoundBank.At(pos, kind == 4 ? "spiderWebShot" : "spitterFire", range: 28f);
            else if (kind == 0) SoundBank.At(pos, "bow-shot-" + Random.Range(1, 6), 0.6f);
        }

        void Remove(string id, bool bolt, int kind)
        {
            if (!shots.Remove(id, out var s)) return;
            // Огнешар — вспышка и звук разрыва; стрела — стук попадания.
            if (bolt && kind == 0)
            {
                Popups.Puff(s.tr.position, 1.2f, Popups.Fire, 0.4f);
                SoundBank.At(s.tr.position, "fireball-hit-" + Random.Range(1, 4));
            }
            Destroy(s.tr.gameObject);
        }

        void Update()
        {
            if (st == null) return;
            float dt = Time.deltaTime;
            foreach (var kv in shots)
            {
                var s = kv.Value;
                Vector3 server;
                if (!s.bolt && st.balls.TryGetValue(kv.Key.Substring(1), out var b))
                {
                    server = new Vector3(b.x, b.y, b.z);
                    // Новый патч — скорость сервера как есть; между патчами летим сами с той же гравитацией.
                    if (b.vy != s.srvVy) { s.vel = new Vector3(b.vx, b.vy, b.vz); s.srvVy = b.vy; }
                    s.vel.y -= s.grav * dt;
                    s.pos += s.vel * dt;
                    s.pos = Vector3.Lerp(s.pos, server, 1f - Mathf.Exp(-dt * 8f));
                }
                else if (s.bolt && st.bolts.TryGetValue(kv.Key.Substring(1), out var p))
                {
                    server = new Vector3(p.x, p.y, p.z);
                    s.vel = new Vector3(p.vx, p.vy, p.vz);
                    s.pos += s.vel * dt;
                    s.pos = Vector3.Lerp(s.pos, server, 1f - Mathf.Exp(-dt * 10f));
                }
                else continue;
                s.tr.position = s.pos;
                if (s.orient && s.vel.sqrMagnitude > 1e-4f) s.tr.rotation = Quaternion.LookRotation(s.vel);
            }
        }
    }
}
