using UnityEngine;
using UnityEngine.InputSystem;

namespace Zep
{
    /// Свой герой: вид от третьего лица (ПК и телефон), WASD/стик, ЛКМ/тап — удар.
    /// Позицию шлём серверу 20 раз в секунду, как веб-клиент (MSG.move).
    public class Hero : MonoBehaviour
    {
        public const float EyeHeight = 1.7f; // WORLD.eyeHeight в shared/constants.ts
        public float runSpeed = 6f;
        public float hitReach = 2.6f;
        public Camera cam;

        HeroRig rig;
        float yaw, pitch = 18f, camDist = 6f;
        float sendTimer, attackCd;
        bool placed;
        Terrain terrain;
        Vector2 touchMove;
        int moveFinger = -1;
        Vector2 moveOrigin;

        /// Свои события с сервера: флинч и новый уровень (свой замах играем сразу, без ожидания сети).
        public void OnAct(string kind, System.Collections.Generic.Dictionary<string, object> m = null)
        {
            if (kind == "cast") rig.PlaySkill(HeroRig.CastSkill(m), HeroRig.CastClass(m));
            else if (kind == "hurt") rig.PlayOneShot("RecieveHit", 1.6f);
            else if (kind == "levelUp") rig.PlayOneShot("Victory");
        }

        public bool Mobile => Application.isMobilePlatform;

        public void Init(SliceAssets assets)
        {
            rig = gameObject.AddComponent<HeroRig>();
            rig.Init(assets);
            rig.Apply(0, "", "", "sword", "");
            terrain = Terrain.activeTerrain;
            yaw = transform.eulerAngles.y;
        }

        float Ground(Vector3 p) => terrain ? terrain.SampleHeight(p) + terrain.transform.position.y : 0f;

        void Update()
        {
            var net = ZoneNet.I;
            var room = net ? net.Room : null;

            // Первая позиция — с сервера (сохранённое место героя).
            if (!placed && room != null && room.State.players.TryGetValue(room.SessionId, out var me))
            {
                var p = new Vector3(me.head.x, 0, me.head.z);
                p.y = Ground(p);
                transform.position = p;
                placed = true;
            }
            if (room != null && room.State.players.TryGetValue(room.SessionId, out var self))
            {
                rig.Apply(self.skin, self.leftCls, self.leftTier, self.rightCls, self.rightTier);
                rig.SetSharp(WeaponGlow.PctOf(self.leftAffix), WeaponGlow.PctOf(self.rightAffix));
            }

            Vector2 move = ReadMove();
            Vector2 look = ReadLook();
            yaw += look.x;
            pitch = Mathf.Clamp(pitch - look.y, -10f, 70f);
            if (Mouse.current != null) camDist = Mathf.Clamp(camDist - Mouse.current.scroll.ReadValue().y * 0.01f, 2.5f, 14f);

            var camYaw = Quaternion.Euler(0, yaw, 0);
            var dir = camYaw * new Vector3(move.x, 0, move.y);
            if (dir.sqrMagnitude > 1) dir.Normalize();
            var pos = transform.position + dir * runSpeed * Time.deltaTime;
            pos.y = Ground(pos);
            transform.position = pos;
            if (dir.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir),
                    1f - Mathf.Exp(-14f * Time.deltaTime));

            attackCd -= Time.deltaTime;
            if (ReadAttack() && attackCd <= 0) Attack();
            rig.Locomotion(dir.sqrMagnitude > 0.01f ? runSpeed : 0f, false);

            // Камера: орбита за спиной, не уходит под землю.
            var target = transform.position + Vector3.up * 1.6f;
            var camPos = target - Quaternion.Euler(pitch, yaw, 0) * Vector3.forward * camDist;
            camPos.y = Mathf.Max(camPos.y, Ground(camPos) + 0.4f);
            cam.transform.position = camPos;
            cam.transform.LookAt(target);

            sendTimer -= Time.deltaTime;
            if (placed && sendTimer <= 0)
            {
                sendTimer = 0.05f;
                net.SendMove(transform.position + Vector3.up * EyeHeight, transform.rotation, Mobile);
            }
        }

        void Attack()
        {
            var room = ZoneNet.I.Room;
            ZepSchema.PlayerState me = null;
            room?.State.players.TryGetValue(room.SessionId, out me);
            int level = me?.level ?? 1;
            attackCd = 0.8f / ZoneNet.I.Assets.MeleeRate(level);
            rig.PlaySwing(level);
            if (room == null) return;
            string weapon = me != null && !string.IsNullOrEmpty(me.rightCls) ? me.rightCls : "fist";
            if (weapon == "staff" || weapon == "bow" || weapon == "shield") weapon = "fist";

            MobView best = null;
            float bestD = hitReach;
            foreach (var m in WorldSync.Mobs.Values)
            {
                if (m.state.dead != 0) continue;
                var d = m.transform.position - transform.position;
                d.y = 0;
                float r = d.magnitude - 0.5f * Mathf.Max(m.state.scale, 1f);
                if (r < bestD && Vector3.Dot(d.normalized, transform.forward) > 0.2f) { bestD = r; best = m; }
            }
            if (best == null) return;
            var hitDir = (best.transform.position - transform.position).normalized;
            ZoneNet.I.SendHitMob(best.id, weapon, "right", hitDir);
        }

        // --- ввод: клавиатура/мышь и сенсор (левая половина — стик, правая — обзор, тап — удар) ---

        Vector2 ReadMove()
        {
            var v = Vector2.zero;
            var k = Keyboard.current;
            if (k != null)
            {
                if (k.wKey.isPressed) v.y += 1;
                if (k.sKey.isPressed) v.y -= 1;
                if (k.dKey.isPressed) v.x += 1;
                if (k.aKey.isPressed) v.x -= 1;
            }
            return v + touchMove;
        }

        bool tapAttack;

        Vector2 ReadLook()
        {
            var look = Vector2.zero;
            var m = Mouse.current;
            if (m != null && m.rightButton.isPressed) look += m.delta.ReadValue() * 0.15f;

            touchMove = Vector2.zero;
            var ts = Touchscreen.current;
            if (ts == null) return look;
            foreach (var t in ts.touches)
            {
                var ph = t.phase.ReadValue();
                if (ph == UnityEngine.InputSystem.TouchPhase.None) continue;
                int id = t.touchId.ReadValue();
                var p = t.position.ReadValue();
                if (ph == UnityEngine.InputSystem.TouchPhase.Began && p.x < Screen.width * 0.45f && moveFinger < 0)
                { moveFinger = id; moveOrigin = p; }
                if (id == moveFinger)
                {
                    if (ph == UnityEngine.InputSystem.TouchPhase.Ended || ph == UnityEngine.InputSystem.TouchPhase.Canceled) moveFinger = -1;
                    else touchMove = Vector2.ClampMagnitude((p - moveOrigin) / (Screen.dpi > 0 ? Screen.dpi * 0.5f : 120f), 1f);
                }
                else
                {
                    look += t.delta.ReadValue() * 0.2f;
                    if (ph == UnityEngine.InputSystem.TouchPhase.Ended && t.tapCount.ReadValue() > 0) tapAttack = true;
                }
            }
            return look;
        }

        bool ReadAttack()
        {
            bool a = tapAttack;
            tapAttack = false;
            var m = Mouse.current;
            return a || (m != null && m.leftButton.wasPressedThisFrame);
        }
    }
}
