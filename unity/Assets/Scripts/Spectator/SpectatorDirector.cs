using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zep
{
    /// Режиссёр стрима — перенос src/client/spectator/SpectatorCamera.ts (поляна):
    /// ротация кадров (обзор, орбита, бок, дуэль, группа, погоня, дрон, напротив, моб, босс),
    /// кинопути на пустом сервере, вступление «Вся поляна», плавные переезды, команды пульта
    /// (cam / auto / bots / camTune). Катакомбы, рейд и башня — SpectatorDirector.Arenas.cs.
    public partial class SpectatorDirector : MonoBehaviour
    {
        public Camera cam;
        public TextAsset configJson; // Assets/Terrain/spectator.json (scripts/unity-heightmap.mts)

        // --- константы кадров (как в SpectatorCamera.ts) ---
        const float BotCamBack = 4.5f, BotCamLead = 1.5f, BotCamAimY = 0.6f, BotCamUp = 2.0f;
        const float FrontDist = 15f, FrontUp = 2f, FrontAimY = 0.5f;
        const float SideDist = 7.5f, SideUp = 2.3f, SideAimY = 1f, SideLead = 3.4f, SideBack = 1.2f;
        const float DuelMax = 14f, DuelPad = 5.5f, DuelUp = 2.6f, DuelFoeSmooth = 3.2f, DuelCamSmooth = 2.6f, DuelSwitchMargin = 2.5f;
        const float DroneBack = 13f, DroneUp = 9f, DroneAimY = 0.4f;
        const float CrowdAngle = 0.62f, CrowdUp = 0.92f, CrowdMin = 17f, CrowdMax = 34f, CrowdGroupRadius = 16f;
        const int CrowdMinMembers = 2;
        const float CrowdSwitchMargin = 2.5f, CrowdCenterSmooth = 1.1f, CrowdZoomOut = 1.4f, CrowdZoomIn = 0.45f;
        const float CamTeleportJump = 3f;
        const float DefaultFov = 0.9f; // рад, вертикальный — как у Babylon
        const float LookDip = 1.5f;

        static readonly string[] BotRotation = { "eyePlayer", "sidePlayer", "crowd", "duelPlayer", "orbitPlayer", "dronePlayer", "frontPlayer" };
        static readonly string[] FreshRotation = { "eyePlayer", "sidePlayer", "orbitPlayer", "frontPlayer", "duelPlayer", "dronePlayer" };
        static readonly HashSet<string> PlayerShots = new() { "orbitPlayer", "eyePlayer", "frontPlayer", "sidePlayer", "dronePlayer", "duelPlayer" };
        static readonly HashSet<string> BotFilterShots = new() { "eyePlayer", "frontPlayer", "sidePlayer", "dronePlayer", "duelPlayer" };

        // --- конфиг из JSON ---
        [Serializable] public class PathKey { public float[] p; public float[] l; }
        [Serializable] public class CinePath { public string name; public float duration, fov, lookLevel; public bool freePitch; public PathKey[] keys; }
        [Serializable] public class Hub { public float x, z, r; }
        [Serializable] public class Dun { public float x, z, half, camMin; }
        [Serializable] public class Cat { public float z0, halfX; }
        [Serializable] public class Spectate
        {
            public float holdTime, blendTime, orbitRadius, orbitHeight, orbitSpeed, overviewHeight, overviewRadius, overviewSpeed;
            public float bossOrbitRadius, bossOrbitHeight, eyeSmooth, botCamPosSmooth, botCamFwdSmooth, botCamMaxTurn, botCamDeadzone;
        }
        [Serializable] public class Config
        {
            public CinePath[] paths; public int introPath; public string[] rotation, rotationIdle;
            public Hub hub; public float bossAggro, mobBodyRadius; public Spectate spectate;
            public Dun dun; public Cat cat;
        }

        // --- контекст кадра ---
        public class CtxPlayer { public string id, nick; public Vector3 pos, eye, forward; public int prio; }
        public class CtxMob { public string id, kind; public Vector3 eye, forward; }
        class Shot { public string kind; public string id = ""; public int idx; }

        Config cfg;
        Spectate S => cfg.spectate;
        readonly List<CtxPlayer> players = new();
        readonly List<CtxMob> mobs = new();
        bool bossOn, bossAggro;
        string bossId = "";
        Vector3 bossPos;

        // --- состояние режиссёра ---
        Shot shot = new() { kind = "overview" };
        public bool auto = true;
        public bool botsOnly;
        public float eyeSmooth, botCamPosSmooth, botCamFwdSmooth; // CAM_TUNE — меняет пульт
        float orbitClock, sinceSwitch = 999, curBlend;
        int rotIdx, idleRotIdx, fightIdx, pickI, botRotIdx, freshIdx, botPickI;
        bool introPending = true, introActive, showHud;
        string followId = "", lastRegion = "";
        Vector3 followPos, fromPos, fromTgt, toPos, toTgt, curTgt = new(0, 2, 0);
        Vector3 eyePos, eyeFwd = Vector3.forward, botPos, botFwd = Vector3.forward;
        float botYaw, frameDt = 0.016f;
        Vector3 duelFoe, duelPos, duelTgt;
        string duelFoeId;
        bool duelInit, crowdInit;
        float crowdX, crowdZ, crowdDist;
        Terrain terrain;

        void Awake()
        {
            cfg = JsonUtility.FromJson<Config>(configJson.text);
            // Стрим идёт в 60 к/с: без предела спектатор рисовал сотни кадров, забирал всю видеокарту, и захват
            // окна в OBS подтормаживал. Другой предел — ключ -fps N.
            var args = Environment.GetCommandLineArgs();
            int fi = Array.IndexOf(args, "-fps");
            Application.targetFrameRate = fi >= 0 && fi + 1 < args.Length && int.TryParse(args[fi + 1], out var fps) && fps > 0 ? fps : 60;
            QualitySettings.vSyncCount = 0;
            Physics.queriesHitBackfaces = true; // стены локаций односторонние — луч изнутри комнаты должен их видеть
            curBlend = S.blendTime;
            eyeSmooth = S.eyeSmooth;
            botCamPosSmooth = S.botCamPosSmooth;
            botCamFwdSmooth = S.botCamFwdSmooth;
            cam.fieldOfView = DefaultFov * Mathf.Rad2Deg;
            cam.transform.position = new Vector3(0, S.overviewHeight, -S.overviewRadius);
            fromPos = cam.transform.position;
            fromTgt = curTgt;
        }

        void Start()
        {
            terrain = Terrain.activeTerrain;
            ZoneNet.I.SpecCmd += OnSpecCmd;
        }

        // ---------------- области: поверхность / катакомбы / подземелье ----------------

        string RegionOf(float x, float z)
        {
            if (z > cfg.cat.z0 && Mathf.Abs(x) < cfg.cat.halfX) return "cat";
            if (Mathf.Abs(x - cfg.dun.x) < cfg.dun.half && Mathf.Abs(z - cfg.dun.z) < cfg.dun.half) return "dun";
            return "world";
        }

        /// Высота пола под точкой. На поверхности — рельеф; под землёй (как terrainHeight в вебе
        /// с катакомбами и подземельем) — луч вниз по коллайдерам локации от высоты refY.
        float GroundY(float x, float z, float refY = float.NaN)
        {
            if (RegionOf(x, z) == "world" || float.IsNaN(refY))
                return terrain ? terrain.SampleHeight(new Vector3(x, 0, z)) + terrain.transform.position.y : 0f;
            return Physics.Raycast(new Vector3(x, refY + 1.5f, z), Vector3.down, out var hit, 60f) ? hit.point.y : refY - 60f;
        }

        /// Камера под землёй не проходит сквозь стены и свод (dunCamPos в shared/dungeon.ts): от цели
        /// к камере идём шаром; упёрлись — ближе, но не ближе camMin; совсем тесно — в сторону, где просторнее.
        Vector3 ClampToRooms(Vector3 tgt, Vector3 pos)
        {
            if (RegionOf(tgt.x, tgt.z) == "world") return pos;
            var d = pos - tgt;
            float dist = d.magnitude;
            if (dist < 1e-3f) return pos;
            float min = cfg.dun.camMin;
            float Clear(Vector3 dir) => Physics.SphereCast(tgt, 0.25f, dir, out var h, dist) ? h.distance : dist;
            var dir0 = d / dist;
            float back = Clear(dir0);
            if (back >= dist) return pos;
            if (back >= min) return tgt + dir0 * Mathf.Max(min, back - 0.15f);
            var side = Vector3.Cross(Vector3.up, dir0).normalized;
            var best = -dir0;
            float bestLen = Clear(best);
            foreach (var c in new[] { side, -side })
            {
                float len = Clear(c);
                if (len > bestLen) { best = c; bestLen = len; }
            }
            return tgt + (bestLen >= min ? best * Mathf.Max(min, Mathf.Min(dist, bestLen - 0.15f)) : dir0 * min);
        }

        // ---------------- пульт ----------------

        void OnSpecCmd(Dictionary<string, object> c)
        {
            string t = c.TryGetValue("t", out var tv) ? tv as string : null;
            int On() => c.TryGetValue("on", out var v) ? Convert.ToInt32(v) : 0;
            switch (t)
            {
                case "cam": ForceShot(c["shot"] as string); break;
                case "auto": auto = On() != 0; break;
                case "bots": botsOnly = On() != 0; if (botsOnly) auto = true; break;
                case "camTune":
                    {
                        var key = c["key"] as string;
                        float v = Convert.ToSingle(c["v"]);
                        if (!(v > 0)) break;
                        if (key == "eyeSmooth") eyeSmooth = v;
                        else if (key == "botCamPosSmooth") botCamPosSmooth = v;
                        else if (key == "botCamFwdSmooth") botCamFwdSmooth = v;
                        break;
                    }
            }
        }

        public void ForceShot(string token)
        {
            if (token == null) return;
            if (token == "auto") { auto = true; return; }
            var s = ResolveToken(token);
            if (s != null) { auto = false; SwitchTo(s); }
        }

        // ---------------- кадр ----------------

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (UnityEngine.InputSystem.Keyboard.current?.f3Key.wasPressedThisFrame == true) showHud = !showHud;
            BuildCtx();

            if (introPending && ZoneNet.I.Room != null)
            {
                introPending = false;
                idleRotIdx = 0;
                SwitchTo(new Shot { kind = "path", idx = cfg.introPath });
                introActive = true;
            }
            orbitClock += dt;
            sinceSwitch += dt;

            bool fighting = bossAggro && !botsOnly;
            bool invalid = !ShotValid(shot);
            bool timedOut = shot.kind != "path" && sinceSwitch >= S.holdTime;
            bool idlePathInterrupted = shot.kind == "path" && !botsOnly && !introActive && players.Count > 0;

            if (ArenaDirect(invalid)) { }
            else if (auto && fighting && !IsFightShot(shot)) SwitchTo(new Shot { kind = "orbitBoss" });
            else if (invalid) SwitchTo(auto ? NextShot(fighting) : new Shot { kind = "overview" });
            else if (auto && (timedOut || idlePathInterrupted)) SwitchTo(NextShot(fighting));

            SendSubject(dt);
            SendCam(dt);
            frameDt = dt;
            bool jumped = FollowJumped();
            TrackEye(dt, jumped);
            EvalShot(shot, out toPos, out toTgt);
            if (jumped)
            {
                fromPos = toPos;
                fromTgt = toTgt;
                curBlend = Mathf.Max(1e-3f, sinceSwitch);
            }

            // Переход между поверхностью, катакомбами и подземельем — склейка, а не перелёт через всю карту.
            string region = toTgt.y > 200 ? "tower" : RegionOf(toTgt.x, toTgt.z);
            if (lastRegion != "" && region != lastRegion)
            {
                fromPos = toPos;
                fromTgt = toTgt;
                curBlend = Mathf.Max(1e-3f, sinceSwitch);
            }
            lastRegion = region;

            float k = Smoothstep(sinceSwitch / curBlend);
            var p = Vector3.Lerp(fromPos, toPos, k);
            var tgt = Vector3.Lerp(fromTgt, toTgt, k);
            float minY = GroundY(p.x, p.z, tgt.y) + 1.2f;
            if (p.y < minY) p.y = minY;
            p = ClampToRooms(tgt, p);
            p = ClampToTower(p);

            cam.transform.position = p;
            curTgt = tgt;
            if ((tgt - p).sqrMagnitude > 1e-6f) cam.transform.rotation = Quaternion.LookRotation(tgt - p);

            float wantFov = shot.kind == "path" && cfg.paths[shot.idx].fov > 0 ? cfg.paths[shot.idx].fov : shot.kind == "catTop" ? catFov : DefaultFov;
            float fov = cam.fieldOfView * Mathf.Deg2Rad;
            fov += (wantFov - fov) * (1 - Mathf.Exp(-dt * 2.5f));
            cam.fieldOfView = fov * Mathf.Rad2Deg;
        }

        void BuildCtx()
        {
            players.Clear();
            mobs.Clear();
            bossOn = bossAggro = false;
            var room = ZoneNet.I.Room;
            if (room == null) return;
            foreach (var kv in WorldSync.Players)
            {
                var v = kv.Value;
                var head = v.Head;
                players.Add(new CtxPlayer
                {
                    id = kv.Key, nick = v.state.nick, eye = head, pos = head - new Vector3(0, 0.5f, 0),
                    forward = v.Forward, prio = v.state.camPrio,
                });
            }
            foreach (var kv in WorldSync.Mobs)
            {
                var m = kv.Value.state;
                if (m.dead != 0 || m.kind == "shard") continue;
                var mp = kv.Value.transform.position;
                float r = cfg.mobBodyRadius * (m.scale > 0 ? m.scale : 1f);
                float fx = Mathf.Sin(m.yaw), fz = Mathf.Cos(m.yaw);
                mobs.Add(new CtxMob
                {
                    id = kv.Key, kind = m.kind,
                    eye = new Vector3(mp.x + fx * r * 0.9f, mp.y + r * 1.1f, mp.z + fz * r * 0.9f),
                    forward = new Vector3(fx, 0, fz),
                });
                if (m.kind == "boss")
                {
                    bool aggro = m.windup > 0 || m.charging == 1 || m.enraged == 1;
                    foreach (var pl in players)
                        if (Mathf.Sqrt((pl.eye.x - mp.x) * (pl.eye.x - mp.x) + (pl.eye.z - mp.z) * (pl.eye.z - mp.z)) < cfg.bossAggro) aggro = true;
                    bossOn = true;
                    bossId = kv.Key;
                    bossPos = mp;
                    bossAggro = aggro;
                }
            }
            BuildArenas(room.State);
        }

        // ---------------- режиссура ----------------

        List<CtxPlayer> PrioPool(List<CtxPlayer> list)
        {
            int top = 0;
            foreach (var p in list) top = Mathf.Max(top, p.prio);
            return top > 0 ? list.FindAll(p => p.prio == top) : list;
        }

        void SwitchTo(Shot s)
        {
            introActive = false;
            fromPos = cam.transform.position;
            fromTgt = curTgt;
            shot = s;
            sinceSwitch = 0;
            curBlend = S.blendTime;
            if (LiveEye(s, out var eye, out var fwd))
            {
                eyePos = botPos = eye;
                eyeFwd = botFwd = fwd;
                botYaw = Mathf.Atan2(fwd.x, fwd.z);
            }
            if (s.kind != "crowd") crowdInit = false;
            if (s.kind != "duelPlayer") { duelFoeId = null; duelInit = false; }
        }

        static bool IsFightShot(Shot s) => s.kind is "orbitBoss" or "eyeMob" or "eyePlayer" or "sidePlayer";

        Shot NextShot(bool fighting)
        {
            if (botsOnly)
            {
                var bots = PrioPool(players.FindAll(p => p.id.StartsWith("bot:")));
                if (bots.Count > 0)
                {
                    var kind = BotRotation[botRotIdx % BotRotation.Length];
                    botRotIdx++;
                    if (botRotIdx % BotRotation.Length == 0) botPickI++;
                    if (kind == "crowd")
                    {
                        var cs = ResolveToken("crowd");
                        if (cs != null) return cs;
                    }
                    var id = bots[botPickI % bots.Count].id;
                    return new Shot { kind = PlayerShots.Contains(kind) ? kind : "eyePlayer", id = id };
                }
            }
            if (!(fighting && bossOn))
            {
                var fresh = players.FindAll(p => p.prio >= 3);
                if (fresh.Count > 0)
                {
                    freshIdx++;
                    return new Shot
                    {
                        kind = FreshRotation[freshIdx % FreshRotation.Length],
                        id = fresh[(freshIdx / FreshRotation.Length) % fresh.Count].id,
                    };
                }
            }
            if (fighting && bossOn)
            {
                var near = PlayerNearestBoss();
                var fight = new List<Shot> { new() { kind = "orbitBoss" } };
                if (near != null)
                {
                    fight.Add(new Shot { kind = "eyePlayer", id = near.id });
                    fight.Add(new Shot { kind = "sidePlayer", id = near.id });
                }
                fightIdx = (fightIdx + 1) % fight.Count;
                return fight[fightIdx];
            }
            var rot = players.Count > 0 ? cfg.rotation : cfg.rotationIdle;
            ref int idx = ref (players.Count > 0 ? ref rotIdx : ref idleRotIdx);
            for (int step = 1; step <= rot.Length; step++)
            {
                var s = ResolveToken(rot[(idx + step) % rot.Length]);
                if (s != null) { idx = (idx + step) % rot.Length; return s; }
            }
            return new Shot { kind = "overview" };
        }

        Shot ResolveToken(string tok)
        {
            int ci = tok.IndexOf(':');
            string kind = ci < 0 ? tok : tok.Substring(0, ci);
            string id = ci < 0 ? "" : tok.Substring(ci + 1);
            switch (kind)
            {
                case "overview": return new Shot { kind = "overview" };
                case "crowd": return CrowdPlayers().Count > 0 ? new Shot { kind = "crowd" } : null;
                case "orbitBoss": return bossOn ? new Shot { kind = "orbitBoss" } : null;
                case "path":
                    return int.TryParse(id, out int n) && n >= 0 && n < cfg.paths.Length ? new Shot { kind = "path", idx = n } : null;
                case "eyeMob":
                    {
                        if (id != "")
                        {
                            var m = mobs.Find(x => x.id == id);
                            return m != null && m.kind != "boss" ? new Shot { kind = "eyeMob", id = id } : null;
                        }
                        var critters = mobs.FindAll(x => x.kind == "slime" || x.kind == "spitter");
                        return critters.Count == 0 ? null : new Shot { kind = "eyeMob", id = critters[pickI % critters.Count].id };
                    }
            }
            var arena = ArenaToken(kind, id);
            if (arena != null) return arena;
            if (!PlayerShots.Contains(kind)) return null;
            if (id == "")
            {
                if (players.Count == 0) return null;
                var pool = PrioPool(players);
                pickI = (pickI + 1) % (players.Count * 60);
                id = pool[pickI % pool.Count].id;
            }
            else if (!players.Exists(p => p.id == id)) return null;
            return new Shot { kind = kind, id = id };
        }

        bool ShotValid(Shot s)
        {
            if (ArenaValid(s, out bool av)) return av;
            if (PlayerShots.Contains(s.kind)) return players.Exists(p => p.id == s.id);
            if (s.kind == "orbitBoss") return bossOn;
            if (s.kind == "crowd") return CrowdPlayers().Count > 0;
            if (s.kind == "eyeMob") return mobs.Exists(m => m.id == s.id);
            if (s.kind == "path") return s.idx < cfg.paths.Length && sinceSwitch < cfg.paths[s.idx].duration;
            return true;
        }

        bool InHub(Vector3 p)
        {
            float dx = p.x - cfg.hub.x, dz = p.z - cfg.hub.z;
            return dx * dx + dz * dz < cfg.hub.r * cfg.hub.r;
        }

        static float Dist2D(Vector3 a, Vector3 b) => Mathf.Sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));

        List<CtxPlayer> CrowdPlayers()
        {
            var field = players.FindAll(p => !InHub(p.pos));
            var best = new List<CtxPlayer>();
            if (field.Count < CrowdMinMembers) return best;
            bool sticky = crowdInit;
            float bestScore = float.NegativeInfinity;
            foreach (var seed in field)
            {
                var near = field.FindAll(o => Dist2D(o.pos, seed.pos) <= CrowdGroupRadius);
                if (near.Count < CrowdMinMembers) continue;
                float dAnchor = sticky ? Mathf.Sqrt((seed.pos.x - crowdX) * (seed.pos.x - crowdX) + (seed.pos.z - crowdZ) * (seed.pos.z - crowdZ)) : 0;
                float score = near.Count + (sticky && dAnchor <= CrowdGroupRadius ? CrowdSwitchMargin : 0) - dAnchor * 0.01f;
                if (score > bestScore) { bestScore = score; best = near; }
            }
            return best;
        }

        CtxPlayer PlayerNearestBoss()
        {
            CtxPlayer best = null;
            float bd = float.PositiveInfinity;
            foreach (var p in players)
            {
                float d = (p.pos - bossPos).sqrMagnitude;
                if (d < bd) { bd = d; best = p; }
            }
            return best;
        }

        bool LiveEye(Shot s, out Vector3 eye, out Vector3 fwd)
        {
            eye = fwd = default;
            if (BotFilterShots.Contains(s.kind))
            {
                var p = players.Find(x => x.id == s.id);
                if (p == null) return false;
                eye = p.eye; fwd = p.forward; return true;
            }
            if (s.kind == "eyeMob")
            {
                var m = mobs.Find(x => x.id == s.id);
                if (m == null) return false;
                eye = m.eye; fwd = m.forward; return true;
            }
            return false;
        }

        bool FollowJumped()
        {
            if (!PlayerShots.Contains(shot.kind)) { followId = ""; return false; }
            var p = players.Find(x => x.id == shot.id);
            if (p == null) return false;
            bool jumped = followId == p.id && (p.pos - followPos).sqrMagnitude > CamTeleportJump * CamTeleportJump;
            followId = p.id;
            followPos = p.pos;
            return jumped;
        }

        void TrackEye(float dt, bool jumped)
        {
            if (!LiveEye(shot, out var eye, out var fwd)) return;
            if (jumped)
            {
                eyePos = botPos = eye;
                eyeFwd = botFwd = fwd;
                botYaw = Mathf.Atan2(fwd.x, fwd.z);
                return;
            }
            float k = 1 - Mathf.Exp(-dt * eyeSmooth);
            eyePos = Vector3.Lerp(eyePos, eye, k);
            eyeFwd = Vector3.Lerp(eyeFwd, fwd, k);
            float kp = 1 - Mathf.Exp(-dt * botCamPosSmooth);
            float kf = 1 - Mathf.Exp(-dt * botCamFwdSmooth);
            botPos = Vector3.Lerp(botPos, eye, kp);
            if (Mathf.Sqrt(fwd.x * fwd.x + fwd.z * fwd.z) > 1e-3f)
            {
                float d = Mathf.Atan2(fwd.x, fwd.z) - botYaw;
                while (d > Mathf.PI) d -= Mathf.PI * 2;
                while (d < -Mathf.PI) d += Mathf.PI * 2;
                float dz = S.botCamDeadzone;
                float eff = Mathf.Abs(d) <= dz ? 0 : d - Mathf.Sign(d) * dz;
                float maxStep = S.botCamMaxTurn * dt;
                botYaw += Mathf.Clamp(eff * kf, -maxStep, maxStep);
                botFwd = new Vector3(Mathf.Sin(botYaw), 0, Mathf.Cos(botYaw));
            }
        }

        static Vector3 Flat(Vector3 f)
        {
            float l = Mathf.Sqrt(f.x * f.x + f.z * f.z);
            if (l < 1e-6f) l = 1;
            return new Vector3(f.x / l, 0, f.z / l);
        }

        static int SideOf(string id) => (id[id.Length - 1] & 1) == 0 ? 1 : -1;

        void Orbit(Vector3 focus, float radius, float height, float speed, out Vector3 pos, out Vector3 tgt)
        {
            float a = orbitClock * speed;
            pos = new Vector3(focus.x + Mathf.Cos(a) * radius, focus.y + height, focus.z + Mathf.Sin(a) * radius);
            tgt = focus;
        }

        void EvalShot(Shot s, out Vector3 pos, out Vector3 tgt)
        {
            if (EvalArena(s, out pos, out tgt)) return;
            switch (s.kind)
            {
                case "orbitPlayer":
                    {
                        var p = players.Find(x => x.id == s.id);
                        if (p != null) { Orbit(p.pos, S.orbitRadius, S.orbitHeight, S.orbitSpeed, out pos, out tgt); return; }
                        break;
                    }
                case "orbitBoss":
                    if (bossOn)
                    {
                        Orbit(bossPos, S.bossOrbitRadius, S.bossOrbitHeight, S.orbitSpeed * 0.55f, out pos, out tgt);
                        tgt.y += 2;
                        return;
                    }
                    break;
                case "path":
                    {
                        var path = cfg.paths[s.idx];
                        SamplePath(path, sinceSwitch / path.duration, out pos, out tgt);
                        float minY = GroundY(pos.x, pos.z, pos.y) + 2.5f;
                        if (pos.y < minY) { tgt.y += minY - pos.y; pos.y = minY; }
                        if (!path.freePitch)
                        {
                            float dh = Dist2D(tgt, pos);
                            float maxDrop = dh * 0.7f;
                            if (pos.y - tgt.y > maxDrop) tgt.y = pos.y - maxDrop;
                        }
                        return;
                    }
                case "frontPlayer":
                    {
                        var f = Flat(botFwd);
                        pos = botPos + f * FrontDist + Vector3.up * FrontUp;
                        tgt = botPos + Vector3.up * FrontAimY;
                        return;
                    }
                case "sidePlayer":
                    {
                        var f = Flat(botFwd);
                        int side = SideOf(s.id);
                        var perp = new Vector3(-f.z * side, 0, f.x * side);
                        pos = botPos + perp * SideDist - f * SideBack + Vector3.up * SideUp;
                        tgt = botPos + f * SideLead + Vector3.up * SideAimY;
                        return;
                    }
                case "duelPlayer":
                    {
                        EvalDuel(s, out pos, out tgt);
                        return;
                    }
                case "dronePlayer":
                    {
                        var f = Flat(botFwd);
                        pos = botPos - f * DroneBack + Vector3.up * DroneUp;
                        tgt = botPos + Vector3.up * DroneAimY;
                        return;
                    }
                case "eyePlayer":
                    {
                        // В вебе живого игрока снимали «из глаз»; тут у всех героев модель —
                        // из глаз камера попадала бы в голову, поэтому всех ведём погоней сзади, как ботов.
                        var f = Flat(botFwd);
                        pos = botPos - f * BotCamBack + Vector3.up * BotCamUp;
                        tgt = botPos + f * BotCamLead + Vector3.up * BotCamAimY;
                        return;
                    }
                case "crowd":
                    {
                        var grp = CrowdPlayers();
                        if (grp.Count > 0)
                        {
                            float gx = 0, gz = 0;
                            foreach (var p in grp) { gx += p.pos.x; gz += p.pos.z; }
                            gx /= grp.Count; gz /= grp.Count;
                            float spread = 6;
                            foreach (var p in grp) spread = Mathf.Max(spread, Mathf.Sqrt((p.pos.x - gx) * (p.pos.x - gx) + (p.pos.z - gz) * (p.pos.z - gz)));
                            float dist = Mathf.Clamp(spread * 1.7f + 11, CrowdMin, CrowdMax);
                            if (!crowdInit) { crowdInit = true; crowdX = gx; crowdZ = gz; crowdDist = dist; }
                            else
                            {
                                float kc = 1 - Mathf.Exp(-frameDt * CrowdCenterSmooth);
                                float kd = 1 - Mathf.Exp(-frameDt * (dist > crowdDist ? CrowdZoomOut : CrowdZoomIn));
                                crowdX += (gx - crowdX) * kc;
                                crowdZ += (gz - crowdZ) * kc;
                                crowdDist += (dist - crowdDist) * kd;
                            }
                            float gy = GroundY(crowdX, crowdZ, grp[0].pos.y);
                            pos = new Vector3(crowdX - crowdDist * CrowdAngle, gy + crowdDist * CrowdUp, crowdZ - crowdDist * CrowdAngle * 0.6f);
                            tgt = new Vector3(crowdX, gy + 1.4f, crowdZ);
                            return;
                        }
                        break;
                    }
                case "eyeMob":
                    {
                        var f = Flat(eyeFwd);
                        pos = eyePos - f * 3.6f + Vector3.up * 2.6f;
                        tgt = eyePos + f * 8f - Vector3.up * 0.4f;
                        return;
                    }
            }
            // Обзор зоны (и запасной вариант).
            float a = orbitClock * S.overviewSpeed;
            float g0 = GroundY(0, 0);
            pos = new Vector3(Mathf.Cos(a) * S.overviewRadius, g0 + S.overviewHeight, Mathf.Sin(a) * S.overviewRadius);
            tgt = new Vector3(0, g0 + 3, 0);
        }

        void EvalDuel(Shot s, out Vector3 pos, out Vector3 tgt)
        {
            var me = players.Find(x => x.id == s.id);
            float kFoe = 1 - Mathf.Exp(-frameDt * DuelFoeSmooth);
            float kCam = 1 - Mathf.Exp(-frameDt * DuelCamSmooth);
            CtxMob cur = duelFoeId != null ? mobs.Find(m => m.id == duelFoeId) : null;
            float curD = cur != null && me != null ? Vector3.Distance(cur.eye, me.pos) : float.PositiveInfinity;
            if (me != null && (cur == null || curD > DuelMax))
            {
                CtxMob best = null;
                float bd = DuelMax;
                foreach (var m in mobs)
                {
                    float d = Vector3.Distance(m.eye, me.pos);
                    if (d < bd) { bd = d; best = m; }
                }
                cur = best;
            }
            else if (me != null && cur != null)
            {
                foreach (var m in mobs)
                    if (m.id != cur.id && Vector3.Distance(m.eye, me.pos) < curD - DuelSwitchMargin) { cur = m; break; }
            }

            Vector3 rawPos, rawTgt;
            var f = Flat(botFwd);
            if (cur == null)
            {
                duelFoeId = null;
                rawPos = botPos + new Vector3(-f.z, 0, f.x) * SideDist + Vector3.up * SideUp;
                rawTgt = botPos + f * SideLead + Vector3.up * SideAimY;
            }
            else
            {
                if (duelFoeId != cur.id) { duelFoeId = cur.id; duelFoe = cur.eye; }
                duelFoe = Vector3.Lerp(duelFoe, cur.eye, kFoe);
                float mx = (botPos.x + duelFoe.x) * 0.5f, mz = (botPos.z + duelFoe.z) * 0.5f;
                float ax = duelFoe.x - botPos.x, az = duelFoe.z - botPos.z;
                float al = Mathf.Sqrt(ax * ax + az * az);
                if (al < 1e-6f) al = 1;
                ax /= al; az /= al;
                float dist = al * 0.5f + DuelPad;
                int side = SideOf(s.id);
                rawPos = new Vector3(mx - az * dist * side, botPos.y + DuelUp, mz + ax * dist * side);
                rawTgt = new Vector3(mx, botPos.y + 0.9f, mz);
            }
            if (!duelInit) { duelPos = rawPos; duelTgt = rawTgt; duelInit = true; }
            else { duelPos = Vector3.Lerp(duelPos, rawPos, kCam); duelTgt = Vector3.Lerp(duelTgt, rawTgt, kCam); }
            pos = duelPos;
            tgt = duelTgt;
        }

        // ---------------- кинопути (cine.ts samplePath) ----------------

        static float Smoothstep(float t)
        {
            float x = Mathf.Clamp01(t);
            return x * x * (3 - 2 * x);
        }

        static float Catmull(float p0, float p1, float p2, float p3, float t)
        {
            float t2 = t * t, t3 = t2 * t;
            return 0.5f * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        }

        static void SamplePath(CinePath path, float t, out Vector3 outP, out Vector3 outL)
        {
            var k = path.keys;
            int n = k.Length;
            float f = Mathf.Clamp01(t) * (n - 1);
            int i = Mathf.Min(n - 2, Mathf.Max(0, Mathf.FloorToInt(f)));
            float lt = f - i;
            var k0 = k[Mathf.Max(0, i - 1)];
            var k1 = k[i];
            var k2 = k[i + 1];
            var k3 = k[Mathf.Min(n - 1, i + 2)];
            float P(int c) => Catmull(k0.p[c], k1.p[c], k2.p[c], k3.p[c], lt);
            float L(int c) => Catmull(k0.l[c], k1.l[c], k2.l[c], k3.l[c], lt);
            outP = new Vector3(P(0), P(1), P(2));
            outL = new Vector3(L(0), L(1), L(2));
            if (path.lookLevel > 0)
            {
                float w = Mathf.Clamp01(path.lookLevel);
                float lift = Mathf.Max(0, outP.y - LookDip - outL.y);
                outL.y += lift * w;
            }
        }

        // Цель кадра — странице оверлея (overlay.html): по ней она сама собирает панели «смотрим», HP цели,
        // характеристики и баффы из состояния комнаты (overlayState.watchPanels). Сразу при смене и раз в 0,5 с.
        string sentSubj = "";
        float subjClock;

        void SendSubject(float dt)
        {
            if (ZoneNet.I.Room == null) return;
            string type = "", id = "";
            if (PlayerShots.Contains(shot.kind)) { type = "player"; id = shot.id; }
            else if (shot.kind == "eyeMob") { type = "mob"; id = shot.id; }
            else if (shot.kind == "orbitBoss") { var b = mobs.Find(m => m.kind == "boss"); if (b != null) { type = "mob"; id = b.id; } }
            string kind = shot.kind == "path" && shot.idx >= 0 && shot.idx < cfg.paths.Length ? $"path ({cfg.paths[shot.idx].name})" : shot.kind;
            string key = $"{type}|{id}|{kind}";
            subjClock += dt;
            if (key == sentSubj && subjClock < 0.5f) return;
            sentSubj = key;
            subjClock = 0;
            ZoneNet.I.SendSpecCmd(new Dictionary<string, object> { { "t", "subj" }, { "type", type }, { "id", id }, { "shot", kind } });
        }

        // Где камера эфира (MSG.specCam): по ней оверлей находит босса рядом, игра рисует метку камеры. Раз в 0,25 с.
        float camClock;

        void SendCam(float dt)
        {
            if ((camClock += dt) < 0.25f || ZoneNet.I.Room == null) return;
            camClock = 0;
            var c = Camera.main;
            if (!c) return;
            var p = c.transform.position;
            ZoneNet.I.SendSpecCam(p, curTgt);
        }

        void OnGUI()
        {
            if (!showHud) return;
            string subject = PlayerShots.Contains(shot.kind) && WorldSync.Players.TryGetValue(shot.id, out var pv) ? pv.state.nick : shot.id;
            GUI.Label(new Rect(12, 8, Screen.width - 24, 24),
                $"{ZoneNet.I.Status} · кадр {shot.kind} {subject} · {(auto ? "авто" : "ручной")}{(botsOnly ? " · только боты" : "")} · " +
                $"игроков {players.Count} · мобов {mobs.Count} · {1f / Mathf.Max(Time.smoothDeltaTime, 1e-4f):0} fps");
        }
    }
}
