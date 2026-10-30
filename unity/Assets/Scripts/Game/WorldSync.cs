using System.Collections.Generic;
using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Создаёт и убирает объекты мира по состоянию комнаты: мобы и чужие герои.
    public class WorldSync : MonoBehaviour
    {
        public SliceAssets assets;
        public Hero hero;

        public static readonly Dictionary<string, MobView> Mobs = new();
        public static readonly Dictionary<string, PlayerView> Players = new();
        readonly Dictionary<string, GameObject> dummies = new();

        [System.Serializable] class Npc { public string title, model; public float x, y, z, yaw; }
        [System.Serializable] class NpcList { public Npc[] npcs; }

        /// NPC лагеря (Zone.ts → spawnHubNpc): модель героя, лицом к костру, сиреневая плашка с титулом.
        void SpawnNpcs()
        {
            if (!assets.propsJson) return;
            foreach (var n in JsonUtility.FromJson<NpcList>(assets.propsJson.text).npcs)
            {
                var go = new GameObject("npc " + n.title);
                go.transform.SetPositionAndRotation(new Vector3(n.x, n.y, n.z), Quaternion.Euler(0, n.yaw * Mathf.Rad2Deg, 0));
                var rig = go.AddComponent<HeroRig>();
                rig.Init(assets);
                rig.ApplyModel(n.model);
                rig.Anim.Loop("Idle");
                var plate = Nameplates.Create(go.transform);
                plate.offset = 2.5f;
                plate.SetInfo(n.title, new Color(0.78f, 0.61f, 1f), null, Color.white, 0, 0);
            }
        }

        async void Start()
        {
            if (hero) hero.Init(assets);
            SpawnNpcs();
            var net = ZoneNet.I;
            net.Assets = assets;
            CatShrine.Ensure(); // алтарь катакомб: строится лениво, когда ассеты уже в ZoneNet
            net.Joined += OnJoined;
            net.Left += ClearWorld;
            net.Act += (kind, id, m) =>
            {
                if (id != null && Players.TryGetValue(id, out var pv)) pv.OnAct(kind, m);
                else if (hero && id == net.Room?.SessionId) hero.OnAct(kind, m);
            };
            await net.Connect();
            if (net.Room == null) net.KeepAlive(); // первый вход не удался — пробуем снова
        }

        /// Связь потеряна: старые объекты убираем. После нового входа они создадутся из состояния комнаты.
        void ClearWorld()
        {
            foreach (var v in Mobs.Values) if (v) Destroy(v.gameObject);
            Mobs.Clear();
            foreach (var v in Players.Values) if (v) Destroy(v.gameObject);
            Players.Clear();
            foreach (var go in dummies.Values) if (go) Destroy(go);
            dummies.Clear();
        }

        void OnJoined(Colyseus.ColyseusRoom<ZoneState> room)
        {
            var st = room.State;
            var shots = FindAnyObjectByType<Projectiles>();
            if (shots) shots.Attach(st);
            st.mobs.OnAdd((id, m) =>
            {
                var go = new GameObject("mob " + m.mobName);
                var v = go.AddComponent<MobView>();
                v.Init(id, m, assets);
                Mobs[id] = v;
            });
            st.mobs.OnRemove((id, m) =>
            {
                if (Mobs.Remove(id, out var v)) Destroy(v.gameObject);
            });
            // Тренировочные манекены лагеря.
            st.dummies.OnAdd((id, d) =>
            {
                var go = new GameObject("dummy " + id);
                go.AddComponent<DummyView>().Init(d, assets);
                dummies[id] = go;
            });
            st.dummies.OnRemove((id, d) =>
            {
                if (dummies.Remove(id, out var go)) Destroy(go);
            });
            st.players.OnAdd((id, p) =>
            {
                if (id == room.SessionId) return;
                var go = new GameObject("player " + p.nick);
                var v = go.AddComponent<PlayerView>();
                v.Init(id, p, assets);
                Players[id] = v;
            });
            st.players.OnRemove((id, p) =>
            {
                if (Players.Remove(id, out var v)) Destroy(v.gameObject);
            });
        }

        void OnGUI()
        {
            var net = ZoneNet.I;
            if (net.spectator) return; // в эфире своя строка — SpectatorDirector (F3)
            var room = net.Room;
            string line = net.Status;
            if (room != null && room.State.players.TryGetValue(room.SessionId, out var me))
                line += $"   {me.nick} · ур. {me.level} · HP {me.hp:0}/{me.maxHp:0}";
            line += $"   мобов {Mobs.Count} · игроков {Players.Count} · {1f / Mathf.Max(Time.smoothDeltaTime, 1e-4f):0} fps · {QualitySettings.names[QualitySettings.GetQualityLevel()]}";
            GUI.Label(new Rect(12, 8, Screen.width - 24, 24), line);
        }
    }
}
