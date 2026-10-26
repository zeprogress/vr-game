using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Zep
{
    /// Мировые «всплывашки» — как client/ui/WorldCrossFx.ts: числа урона, «MISS», крестики (лечение /
    /// уровень / вампиризм), вспышка и кольцо крита, дымка. Живут в мире, рисуются в экранном холсте плашек.
    public class Popups : MonoBehaviour
    {
        static Popups inst;
        static Popups I => inst ? inst : inst = new GameObject("Popups").AddComponent<Popups>();

        // Цвета — FX_RGB в shared/look.ts и WorldCrossFx.
        public static readonly Color DmgGold = new(1f, 0.88f, 0.47f);
        public static readonly Color Poison = new(0.72f, 0.28f, 1f);
        public static readonly Color Venom = new(0.5f, 1f, 0.1f);
        public static readonly Color Fire = new(1f, 0.42f, 0.12f);
        public static readonly Color Heal = new(0.4f, 1f, 0.5f);
        public static readonly Color Blood = new(0.9f, 0.06f, 0.06f);
        public static readonly Color Reflect = new(0.62f, 0.86f, 1f);
        public static readonly Color CrossGreen = new(0.4f, 1f, 0.5f);
        public static readonly Color CrossOrange = new(1f, 0.6f, 0.15f);
        public static readonly Color CrossRed = new(1f, 0.2f, 0.25f);
        public static readonly Color Magic = new(0.62f, 0.35f, 1f);

        enum Kind { Digits, Miss, Cross, Flash, Ring, Puff }

        class Item
        {
            public Kind kind;
            public Vector3 pos, drift;
            public float born, life, size, rot;
            public Color color;
            public Graphic g;
        }

        readonly List<Item> live = new();
        readonly Stack<Text> texts = new();
        readonly Stack<Image> images = new();
        Sprite cross, flash, ring, soft;
        RectTransform root;

        void Awake()
        {
            inst = this;
            var go = new GameObject("popups", typeof(RectTransform));
            go.transform.SetParent(Nameplates.Root, false);
            root = (RectTransform)go.transform;
            cross = MakeSprite((x, y) => Mathf.Abs(x) < 0.22f && Mathf.Abs(y) < 0.8f || Mathf.Abs(y) < 0.22f && Mathf.Abs(x) < 0.8f ? 1 : 0);
            flash = MakeSprite((x, y) => { float r = Mathf.Sqrt(x * x + y * y); float a = Mathf.Atan2(y, x); return Mathf.Clamp01(1 - r) * (0.55f + 0.45f * Mathf.Abs(Mathf.Cos(a * 4))); });
            ring = MakeSprite((x, y) => { float r = Mathf.Sqrt(x * x + y * y); return Mathf.Clamp01(1 - Mathf.Abs(r - 0.82f) / 0.12f); });
            soft = MakeSprite((x, y) => { float r = Mathf.Sqrt(x * x + y * y); return Mathf.Clamp01(1 - r) * Mathf.Clamp01(1 - r); });
        }

        static Sprite MakeSprite(System.Func<float, float, float> a)
        {
            const int N = 64;
            var t = new Texture2D(N, N, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int j = 0; j < N; j++)
                for (int i = 0; i < N; i++)
                    t.SetPixel(i, j, new Color(1, 1, 1, a((i + 0.5f) / N * 2 - 1, (j + 0.5f) / N * 2 - 1)));
            t.Apply();
            return Sprite.Create(t, new Rect(0, 0, N, N), new Vector2(0.5f, 0.5f));
        }

        // ---------- API (как у WorldCrossFx) ----------

        /// Число урона: золотистое, у яда/огня/лечения/крови/отражения — свой цвет (dmgNumberColor).
        public static void Damage(Vector3 p, float dmg, string c = null)
        {
            var col = c switch { "poison" => Poison, "venom" => Venom, "fire" => Fire, "heal" => Heal, "bleed" => Blood, "reflect" => Reflect, _ => DmgGold };
            I.Add(Kind.Digits, p, 0.9f, col, 0.448f, new Vector3(Random.Range(-0.25f, 0.25f), 1.1f, Random.Range(-0.25f, 0.25f)), Mathf.Max(0, Mathf.Round(dmg)).ToString());
        }

        public static void Miss(Vector3 p) => I.Add(Kind.Miss, p + Vector3.up * 1.3f, 0.7f, new Color(0.92f, 0.92f, 0.92f), 0.41f, new Vector3(0, 0.8f, 0), "MISS");

        /// Крестики: разлёт по горизонтали, всплытие на 1.6 м за 1.5 с.
        public static void Burst(Vector3 p, int count, Color c, float alpha = 1f)
        {
            for (int i = 0; i < count; i++)
            {
                float a = Random.value * Mathf.PI * 2, r = 0.9f * (0.35f + Random.value * 0.65f);
                var at = p + new Vector3(Mathf.Cos(a) * r * 0.4f, Random.value * 0.4f, Mathf.Sin(a) * r * 0.4f);
                c.a = alpha;
                I.Add(Kind.Cross, at, 1.5f, c, 0.34f, new Vector3(Mathf.Cos(a) * r * 0.6f, 1.6f, Mathf.Sin(a) * r * 0.6f));
            }
        }

        /// Крит: вспышка раздувается и гаснет, кольцо расходится.
        public static void Crit(Vector3 p)
        {
            I.Add(Kind.Flash, p, 0.5f, new Color(1f, 0.75f, 0.3f), 1.5f, Vector3.zero);
            I.Add(Kind.Ring, p, 0.5f, new Color(1f, 0.85f, 0.45f), 1.3f, Vector3.zero);
        }

        /// Дымка (призрак, магический удар): мягкий круг, раздувается и тает.
        public static void Puff(Vector3 p, float size, Color c, float life = 0.7f) => I.Add(Kind.Puff, p, life, c, size, new Vector3(0, 0.4f, 0));

        void Add(Kind k, Vector3 p, float life, Color c, float size, Vector3 drift, string text = null)
        {
            var it = new Item { kind = k, pos = p, life = life, color = c, size = size, drift = drift, born = Time.time, rot = Random.value * 360 };
            if (text != null)
            {
                var t = texts.Count > 0 ? texts.Pop() : NewText();
                t.text = text;
                t.gameObject.SetActive(true);
                it.g = t;
            }
            else
            {
                var img = images.Count > 0 ? images.Pop() : NewImage();
                img.sprite = k == Kind.Cross ? cross : k == Kind.Ring ? ring : k == Kind.Flash ? flash : soft;
                img.gameObject.SetActive(true);
                it.g = img;
            }
            it.g.color = c;
            live.Add(it);
        }

        Text NewText()
        {
            var go = new GameObject("t", typeof(RectTransform));
            go.transform.SetParent(root, false);
            var t = go.AddComponent<Text>();
            t.font = Nameplates.Font;
            t.fontSize = 64;
            t.fontStyle = FontStyle.Bold;
            t.alignment = TextAnchor.MiddleCenter;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false;
            t.rectTransform.sizeDelta = new Vector2(400, 80);
            var o = go.AddComponent<Outline>();
            o.effectColor = new Color(0.03f, 0.03f, 0.05f, 0.9f);
            o.effectDistance = new Vector2(3, -3);
            return t;
        }

        Image NewImage()
        {
            var go = new GameObject("i", typeof(RectTransform));
            go.transform.SetParent(root, false);
            var img = go.AddComponent<Image>();
            img.raycastTarget = false;
            img.rectTransform.sizeDelta = new Vector2(100, 100);
            return img;
        }

        void LateUpdate()
        {
            var cam = Camera.main;
            float now = Time.time;
            for (int i = live.Count - 1; i >= 0; i--)
            {
                var it = live[i];
                float age = now - it.born, t = age / it.life;
                if (t >= 1f || !cam)
                {
                    it.g.gameObject.SetActive(false);
                    if (it.g is Text tx) texts.Push(tx); else images.Push((Image)it.g);
                    live.RemoveAt(i);
                    continue;
                }
                var world = it.pos + it.drift * t;
                var v = cam.WorldToScreenPoint(world);
                if (v.z < 0.3f) { it.g.enabled = false; continue; }
                it.g.enabled = true;
                float ppm = cam.pixelHeight / (2f * v.z * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad));
                float pop = Mathf.Min(1f, age / 0.1f), alpha = Mathf.Min(1f, (1f - t) * 2.2f), scale = pop;
                float rot = 0;
                switch (it.kind)
                {
                    case Kind.Flash:
                        {
                            float f = Mathf.Min(1f, age / (it.life * 0.55f));
                            scale = 1f + (1f - (1f - f) * (1f - f)) * 1.27f;
                            alpha = Mathf.Min(0.8f, 1.6f * (1f - f));
                            rot = it.rot + age * 34f;
                            break;
                        }
                    case Kind.Ring:
                        {
                            float u = Mathf.Max(0, (t - 0.18f) / 0.82f);
                            scale = 1f + u * 2f;
                            alpha = u <= 0 ? 0 : Mathf.Min(0.8f, 1.5f * (1f - u));
                            rot = it.rot;
                            break;
                        }
                    case Kind.Cross: scale = Mathf.Min(1f, age / 0.12f) * (1f - t * 0.25f); alpha *= 0.95f * it.color.a; break;
                    case Kind.Puff: scale = 0.6f + t * 0.8f; alpha = 0.7f * (1f - t); break;
                    case Kind.Miss: scale = pop * (1f - t * 0.15f); break;
                    default: scale = pop * (1f - t * 0.1f); break;
                }
                // Размер в мире (м) → пиксели; не мельче читаемого (как плашки).
                float px = Mathf.Max(it.size * ppm, it.kind == Kind.Digits || it.kind == Kind.Miss ? 22f * cam.pixelHeight / 1080f : 0f) * scale;
                var rt = it.g.rectTransform;
                RectTransformUtility.ScreenPointToLocalPointInRectangle(Nameplates.CanvasRect, v, Nameplates.UiCamera, out var local);
                rt.localPosition = local;
                rt.localRotation = Quaternion.Euler(0, 0, rot);
                if (it.g is Text txt) rt.localScale = Vector3.one * (px / 64f);
                else rt.localScale = Vector3.one * (px / 100f);
                var col = it.color;
                col.a = Mathf.Clamp01(alpha);
                it.g.color = col;
            }
        }
    }
}
