using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Zep
{
    /// Плашки над героями и мобами — как client/ui/NameTag.ts: сверху полоска опыта (у героев),
    /// под ней HP, ник со значком платформы/бота, ниже «титул · N ур.» и значки защит моба.
    /// Рисуются в экранном холсте, но размером как в вебе — 0.9 м в мире (вдали меньше, но не мельче читаемого).
    public class Nameplates : MonoBehaviour
    {
        static Nameplates inst;
        Canvas canvas;
        Font font;
        Sprite white;
        readonly Dictionary<string, Sprite> icons = new();

        /// Пикселей «веба» на 0.9 м плашки (NameTag: 0.9 м на 448 px).
        public const float PlatePx = 448f;
        public const float PlateM = 0.9f;
        /// Дальше этого плашки не показываем (как SPEC_RANGE у аватаров спектатора).
        public float maxDist = 45f;

        static Nameplates I
        {
            get
            {
                if (!inst) inst = new GameObject("Nameplates").AddComponent<Nameplates>();
                if (!inst.canvas) inst.Setup(); // в редакторе (снимки) Awake не вызывается
                return inst;
            }
        }

        void Awake()
        {
            inst = this;
            if (!canvas) Setup();
        }

        void Setup()
        {
            canvas = gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = -10; // под служебными подписями
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var tex = Texture2D.whiteTexture;
            white = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f));
        }

        public static Font Font => I.font;
        public static RectTransform CanvasRect => (RectTransform)I.transform;
        /// Камера холста: null — поверх экрана; для снимков из редактора — камера кадра.
        public static Camera UiCamera => I.canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : I.canvas.worldCamera;

        /// Снимок из редактора: холст рисуется камерой кадра (поверх экрана в RenderTexture не попадает).
        public static void RenderInto(Camera cam)
        {
            I.canvas.renderMode = RenderMode.ScreenSpaceCamera;
            I.canvas.worldCamera = cam;
            I.canvas.planeDistance = cam.nearClipPlane + 0.05f;
            foreach (var p in I.GetComponentsInChildren<Nameplate>(true)) p.Refresh(cam);
        }
        public static Sprite White => I.white;
        public static Transform Root => I.transform;
        public static float MaxDist => I.maxDist;

        /// Значок из Resources/Icons (scripts/unity-icons.py): armor_<бит>, plat_<1..3>, bot.
        public static Sprite Icon(string name)
        {
            var d = I.icons;
            if (d.TryGetValue(name, out var s)) return s;
            var tex = Resources.Load<Texture2D>("Icons/" + name);
            s = tex ? Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f)) : null;
            d[name] = s;
            return s;
        }

        public static Nameplate Create(Transform anchor) => Nameplate.Build(anchor);

        float sortT;
        readonly List<Nameplate> sortBuf = new();

        /// Раз в 0.25 с: дальние плашки — раньше в списке (рисуются первыми), ближние — поверх.
        void LateUpdate()
        {
            if ((sortT -= Time.unscaledDeltaTime) > 0) return;
            sortT = 0.25f;
            sortBuf.Clear();
            GetComponentsInChildren(false, sortBuf);
            sortBuf.Sort((a, b) => b.Depth.CompareTo(a.Depth));
            for (int i = 0; i < sortBuf.Count; i++) sortBuf[i].transform.SetSiblingIndex(i);
        }
    }

    public class Nameplate : MonoBehaviour
    {
        static readonly int[] ArmorBits = { 1, 2, 4, 8, 16, 32 }; // MOB_ARMOR
        static readonly Color BarBg = new(0.03f, 0.03f, 0.03f, 0.65f);
        static readonly Color XpColor = new(0.62f, 0.64f, 0.68f, 1f);

        Transform anchor;
        /// Высота плашки над якорем, м.
        public float offset;
        /// Множитель размера: герои крупнее мобов (по просьбе — плашки героев читаются издалека).
        public float scaleMul = 1;
        /// Скрыть (моб погиб и т.п.), не удаляя.
        public bool visible = true;
        /// Дальность до камеры — ближние плашки рисуются поверх дальних.
        public float Depth { get; private set; }
        RectTransform rt;
        /// Всё содержимое — здесь: прячем его, а не саму плашку (у выключенного объекта не идёт LateUpdate).
        RectTransform body;
        Text nameText, levelText;
        Image leadIcon;
        RectTransform armorRow;
        Image hpBg, hpFill, xpBg, xpFill;
        readonly List<Image> armorIcons = new();
        string curName, curLevel;
        int curArmor = -1, curLead = -1;

        internal static Nameplate Build(Transform anchor)
        {
            var go = new GameObject("plate", typeof(RectTransform));
            go.transform.SetParent(Nameplates.Root, false);
            var p = go.AddComponent<Nameplate>();
            p.anchor = anchor;
            p.rt = (RectTransform)go.transform;
            p.rt.sizeDelta = new Vector2(512, 260);
            var b = new GameObject("body", typeof(RectTransform));
            b.transform.SetParent(go.transform, false);
            p.body = (RectTransform)b.transform;
            // Координаты — пиксели ячейки NameTag (512×128 на текст), центр плашки — (0,0), вверх — плюс.
            p.xpBg = p.Bar(96, 16, BarBg);
            p.xpFill = p.Bar(96, 10, XpColor);
            p.hpBg = p.Bar(60, 34, BarBg);
            p.hpFill = p.Bar(60, 22, Color.green);
            p.nameText = p.Label(20, 56, FontStyle.Bold);
            p.levelText = p.Label(-36, 36, FontStyle.Bold);
            p.leadIcon = p.Img(new Vector2(-200, 20), 46);
            var row = new GameObject("armor", typeof(RectTransform));
            row.transform.SetParent(p.body, false);
            p.armorRow = (RectTransform)row.transform;
            p.armorRow.anchoredPosition = new Vector2(0, -36);
            return p;
        }

        Image Bar(float y, float h, Color c)
        {
            var img = Img(new Vector2(0, y), h);
            img.color = c;
            img.rectTransform.sizeDelta = new Vector2(296, h);
            img.type = Image.Type.Filled;
            img.fillMethod = Image.FillMethod.Horizontal;
            img.gameObject.SetActive(false);
            return img;
        }

        Image Img(Vector2 at, float size)
        {
            var go = new GameObject("img", typeof(RectTransform));
            go.transform.SetParent(body, false);
            var img = go.AddComponent<Image>();
            img.sprite = Nameplates.White;
            img.raycastTarget = false;
            img.rectTransform.anchoredPosition = at;
            img.rectTransform.sizeDelta = new Vector2(size, size);
            return img;
        }

        Text Label(float y, int px, FontStyle style)
        {
            var go = new GameObject("text", typeof(RectTransform));
            go.transform.SetParent(body, false);
            var t = go.AddComponent<Text>();
            t.font = Nameplates.Font;
            t.fontSize = px;
            t.fontStyle = style;
            t.alignment = TextAnchor.MiddleCenter;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false;
            t.rectTransform.anchoredPosition = new Vector2(0, y);
            t.rectTransform.sizeDelta = new Vector2(480, px * 1.3f);
            // Тёмная обводка, как strokeText в вебе: читается на любом фоне.
            var o = go.AddComponent<Outline>();
            o.effectColor = new Color(0.024f, 0.03f, 0.047f, 0.88f);
            o.effectDistance = new Vector2(3, -3);
            return t;
        }

        /// Текст и значки (перерисовываются только при изменении). lead: 0 — нет, 1..3 — платформа, 4 — бот.
        public void SetInfo(string name, Color nameColor, string levelLine, Color levelColor, int lead, int armor)
        {
            if (name != curName)
            {
                curName = name;
                nameText.text = name;
            }
            nameText.color = nameColor;
            if (levelLine != curLevel)
            {
                curLevel = levelLine;
                levelText.text = levelLine ?? "";
                levelText.gameObject.SetActive(!string.IsNullOrEmpty(levelLine));
                curArmor = -1; // ряд значков встаёт после строки уровня — пересчитать
            }
            levelText.color = levelColor;
            if (lead != curLead)
            {
                curLead = lead;
                var s = lead switch { 1 or 2 or 3 => Nameplates.Icon("plat_" + lead), 4 => Nameplates.Icon("bot"), _ => null };
                leadIcon.sprite = s;
                leadIcon.gameObject.SetActive(s);
            }
            // Значок — слева от ника, по его ширине.
            leadIcon.rectTransform.anchoredPosition = new Vector2(-nameText.preferredWidth / 2 - 34, 20);
            if (armor != curArmor)
            {
                curArmor = armor;
                foreach (var i in armorIcons) Destroy(i.gameObject);
                armorIcons.Clear();
                foreach (var bit in ArmorBits)
                {
                    if ((armor & bit) == 0) continue;
                    var img = Img(Vector2.zero, 42);
                    img.transform.SetParent(armorRow, false);
                    img.sprite = Nameplates.Icon("armor_" + bit);
                    armorIcons.Add(img);
                }
                // Строка «уровень + значки» по центру, как в вебе.
                float tw = levelText.preferredWidth, iw = armorIcons.Count > 0 ? 10 + armorIcons.Count * 48 - 6 : 0;
                levelText.rectTransform.anchoredPosition = new Vector2(-iw / 2, -36);
                float x = -(tw + iw) / 2 + tw + 10 + 21;
                foreach (var i in armorIcons) { i.rectTransform.anchoredPosition = new Vector2(x, 0); x += 48; }
            }
        }

        /// Полоски: доля 0..1; меньше нуля — полоски нет.
        public void SetBars(float hp, float xp)
        {
            SetBar(hpBg, hpFill, hp);
            if (hp >= 0)
                hpFill.color = new Color(hp > 0.5f ? 0.25f : 0.85f, hp > 0.25f ? 0.75f : 0.2f, hp > 0.5f ? 0.3f : 0.15f, 1f);
            SetBar(xpBg, xpFill, xp);
        }

        static void SetBar(Image bg, Image fill, float f)
        {
            bool on = f >= 0;
            if (bg.gameObject.activeSelf != on) { bg.gameObject.SetActive(on); fill.gameObject.SetActive(on); }
            if (on) fill.fillAmount = Mathf.Max(0.004f, f);
        }

        void LateUpdate()
        {
            if (!anchor) { Destroy(gameObject); return; }
            if (Camera.main) Refresh(Camera.main);
        }

        public void Refresh(Camera cam)
        {
            if (!anchor) return;
            var world = anchor.position + Vector3.up * offset;
            var v = cam.WorldToScreenPoint(world);
            float dist = v.z;
            bool show = visible && dist > 0.3f && dist < Nameplates.MaxDist && anchor.gameObject.activeInHierarchy;
            if (body.gameObject.activeSelf != show) body.gameObject.SetActive(show);
            if (!show) return;
            // Пикселей на метр на этой дальности → масштаб плашки (0.9 м = 448 px «веба»), не мельче читаемого.
            float h = cam.pixelHeight;
            float ppm = h / (2f * dist * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad));
            float k = Mathf.Max(ppm * Nameplates.PlateM / Nameplates.PlatePx, 0.34f * h / 1080f);
            Depth = dist;
            k *= scaleMul;
            rt.localScale = Vector3.one * k;
            // Нижний край плашки — над якорем: центр выше на половину высоты текста.
            RectTransformUtility.ScreenPointToLocalPointInRectangle(Nameplates.CanvasRect, new Vector2(v.x, v.y + 64 * k), Nameplates.UiCamera, out var local);
            rt.localPosition = local;
        }

    }
}
