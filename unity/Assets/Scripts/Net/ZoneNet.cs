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

        public const string ProdUrl = "wss://zepgame.duckdns.org";

        [Tooltip("wss://zepgame.duckdns.org — прод, ws://localhost:2567 — локальный стенд")]
        public string serverUrl = ProdUrl;
        public string nick = "zep";
        [Tooltip("Пароль админ-ника (ADMIN_PASS на сервере). Обычные ники пускаются только через код из чата.")]
        public string adminPass = "";
        [Tooltip("Невидимый спектатор: без героя, только смотрит (SPECTATOR_KEY на сервере)")]
        public bool spectator;
        public string spectatorKey = "zepgame-spec-a19f3c7d5b"; // SPECTATOR_KEY в shared/constants.ts

        public ColyseusRoom<ZoneState> Room { get; private set; }
        /// Модели и таблицы уровней — ставит WorldSync.
        public SliceAssets Assets { get; set; }
        public string Status { get; private set; } = "не подключён";
        public event Action<ColyseusRoom<ZoneState>> Joined;
        /// Команда пульта (MSG.specCmd = "sc", тип SpecCmd в messages.ts): поле "t" и его параметры.
        public event Action<Dictionary<string, object>> SpecCmd;
        /// Мобы «Охотничьей башни» тик в тик (MSG.towerMobs): позиции, HP, замахи — их нет в ZoneState.
        public event Action<Dictionary<string, object>> TowerMobs;
        /// Событие героя (MSG.act = "ac", ActRelay): k — вид (swing, bow, hurt, levelUp…), id — кто.
        public event Action<string, string, Dictionary<string, object>> Act;
        /// Числа урона за тик (MSG.dmgHits = "dh", DmgHitsMsg): список {x, y, z, dmg, c?}.
        public event Action<System.Collections.IEnumerable> DmgHits;

        ColyseusClient client;

        void Awake()
        {
            I = this;
            // SDK пишет Debug.Log на каждого моба и игрока («InvokeOnAdd») — в сборке оставляем только предупреждения.
            if (!Application.isEditor) Debug.unityLogger.filterLogType = LogType.Warning;
            // Собранная программа: «ZEP Spectator -server wss://zepgame.duckdns.org».
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, "-server");
            if (i >= 0 && i + 1 < args.Length) serverUrl = args[i + 1];
        }

        public async Task Connect()
        {
            Status = "подключение…";
            try
            {
                client = new ColyseusClient(serverUrl);
                var opts = new Dictionary<string, object>();
                if (spectator) opts["spectator"] = spectatorKey;
                else
                {
                    opts["nick"] = nick;
                    if (!string.IsNullOrEmpty(adminPass)) opts["adminPass"] = adminPass;
                }
                Room = await client.JoinOrCreate<ZoneState>("zone", opts);
                Room.OnMessage<Dictionary<string, object>>("sc", m => SpecCmd?.Invoke(m));
                Room.OnMessage<Dictionary<string, object>>("dh", m =>
                {
                    if (m.TryGetValue("hits", out var h) && h is System.Collections.IEnumerable list) DmgHits?.Invoke(list);
                });
                Room.OnMessage<Dictionary<string, object>>("ac", m =>
                    Act?.Invoke(m.TryGetValue("k", out var k) ? k as string : null, m.TryGetValue("id", out var id) ? id as string : null, m));
                Room.OnMessage<Dictionary<string, object>>("twmobs", m => TowerMobs?.Invoke(m));
                MuteOtherMessages();
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

        [Serializable] class MsgTypes { public string[] types; }

        /// Сообщения, которые клиент пока не обрабатывает (MSG в messages.ts, Resources/msgTypes.json):
        /// пустой обработчик, иначе SDK пишет предупреждение на каждое — десятки в секунду.
        void MuteOtherMessages()
        {
            var json = Resources.Load<TextAsset>("msgTypes");
            if (json == null) return;
            foreach (var t in JsonUtility.FromJson<MsgTypes>(json.text).types)
                if (t != "sc" && t != "ac" && t != "dh" && t != "twmobs") Room.OnMessage<object>(t, _ => { });
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
