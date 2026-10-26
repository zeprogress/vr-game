using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Colyseus;
using UnityEngine;
using ZepSchema;

namespace Zep
{
    /// Подключение к комнате "zone" того же сервера Colyseus 0.15, что у веб-клиента.
    /// Протокол — src/shared/net/messages.ts (MSG.move = "m", MSG.hitMob = "hm").
    public class ZoneNet : MonoBehaviour
    {
        public static ZoneNet I { get; private set; }

        [Tooltip("ws://localhost:2567 — локальный стенд, wss://zepgame.duckdns.org — прод")]
        public string serverUrl = "ws://localhost:2567";
        public string nick = "zep";
        [Tooltip("Пароль админ-ника (ADMIN_PASS на сервере). Обычные ники пускаются только через код из чата.")]
        public string adminPass = "";

        public ColyseusRoom<ZoneState> Room { get; private set; }
        public string Status { get; private set; } = "не подключён";
        public event Action<ColyseusRoom<ZoneState>> Joined;

        ColyseusClient client;

        void Awake() { I = this; }

        public async Task Connect()
        {
            Status = "подключение…";
            try
            {
                client = new ColyseusClient(serverUrl);
                var opts = new Dictionary<string, object> { { "nick", nick } };
                if (!string.IsNullOrEmpty(adminPass)) opts["adminPass"] = adminPass;
                Room = await client.JoinOrCreate<ZoneState>("zone", opts);
                Room.OnLeave += code => Status = $"отключён ({code})";
                Room.OnError += (code, msg) => Debug.LogWarning($"[net] {code}: {msg}");
                Status = $"в комнате {Room.Id}";
                Joined?.Invoke(Room);
            }
            catch (Exception e)
            {
                Status = "ошибка: " + e.Message;
                Debug.LogWarning("[net] вход не удался: " + e.Message);
                Room = null;
            }
        }

        static readonly float[] Zero7 = { 0, 0, 0, 0, 0, 0, 1 };

        /// Позиция «головы» (глаза над землёй) и поворот — как MoveMsg в плоском режиме.
        public void SendMove(Vector3 eye, Quaternion rot, bool mobile)
        {
            if (Room == null) return;
            _ = Room.Send("m", new Dictionary<string, object>
            {
                { "mode", "flat" },
                { "plat", mobile ? 2 : 1 },
                { "head", new float[] { eye.x, eye.y, eye.z, rot.x, rot.y, rot.z, rot.w } },
                { "handL", Zero7 },
                { "handR", Zero7 },
                { "guard", new Dictionary<string, object> { { "sx", 0f }, { "sz", 0f }, { "wx", 0f }, { "wz", 0f } } },
            });
        }

        public void SendHitMob(string mobId, string weapon, string hand, Vector3 dir)
        {
            if (Room == null) return;
            _ = Room.Send("hm", new Dictionary<string, object>
            {
                { "id", mobId }, { "target", "mob" }, { "weapon", weapon }, { "hand", hand },
                { "dx", dir.x }, { "dz", dir.z },
            });
        }

        async void OnDestroy()
        {
            if (Room != null) await Room.Leave();
        }
    }
}
