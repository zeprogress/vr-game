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
        readonly Dictionary<string, PlayerView> players = new();

        async void Start()
        {
            hero.Init(assets.hero);
            var net = ZoneNet.I;
            net.Joined += OnJoined;
            await net.Connect();
        }

        void OnJoined(Colyseus.ColyseusRoom<ZoneState> room)
        {
            var st = room.State;
            st.mobs.OnAdd((id, m) =>
            {
                var go = new GameObject("mob " + m.mobName);
                var v = go.AddComponent<MobView>();
                v.Init(id, m, assets.slime);
                Mobs[id] = v;
            });
            st.mobs.OnRemove((id, m) =>
            {
                if (Mobs.Remove(id, out var v)) Destroy(v.gameObject);
            });
            st.players.OnAdd((id, p) =>
            {
                if (id == room.SessionId) return;
                var go = new GameObject("player " + p.nick);
                var v = go.AddComponent<PlayerView>();
                v.Init(p, assets.hero);
                players[id] = v;
            });
            st.players.OnRemove((id, p) =>
            {
                if (players.Remove(id, out var v)) Destroy(v.gameObject);
            });
        }

        void OnGUI()
        {
            var net = ZoneNet.I;
            var room = net.Room;
            string line = net.Status;
            if (room != null && room.State.players.TryGetValue(room.SessionId, out var me))
                line += $"   {me.nick} · ур. {me.level} · HP {me.hp:0}/{me.maxHp:0}";
            line += $"   мобов {Mobs.Count} · игроков {players.Count} · {1f / Mathf.Max(Time.smoothDeltaTime, 1e-4f):0} fps · {QualitySettings.names[QualitySettings.GetQualityLevel()]}";
            GUI.Label(new Rect(12, 8, Screen.width - 24, 24), line);
        }
    }
}
