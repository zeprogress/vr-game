using System.Text;
using UnityEngine;
using UnityEngine.UI;

namespace Zep
{
    /// Мирная плашка над мобом в мировых координатах: тёмная подложка и две строки,
    /// всегда лицом к камере. Повторяет табло пугала из веба (client/combat/Mob.ts buildScarecrow),
    /// но крупнее: в эфире важны цифры, а не подписи.
    public class MobPlate : MonoBehaviour
    {
        /// Размер холста плашки в «пикселях веба» (было 768×220 в Mob.ts).
        const float PxW = 900f, PxH = 260f;

        Text line1, line2;
        Image bg;
        string last;
        Camera cam;
        /// Есть ли что показывать (подсказку без цифр не показываем — это и есть «лишние буквы»).
        public bool HasText { get; private set; }

        /// Плашка над точкой `y` в родителе `parent`, шириной widthM метров.
        public static MobPlate Create(Transform parent, float y, float widthM = 3f)
        {
            // RectTransform сразу: Canvas требует его, иначе transform подменится при AddComponent.
            var go = new GameObject("plate", typeof(RectTransform));
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0, y, 0);
            var p = go.AddComponent<MobPlate>();
            p.Build(widthM);
            return p;
        }

        void Build(float widthM)
        {
            var canvas = gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var cr = (RectTransform)transform;
            cr.sizeDelta = new Vector2(PxW, PxH);
            // Плашка живёт в мировых метрах: холст PxW px → widthM метров.
            float k = widthM / PxW;
            transform.localScale = new Vector3(k, k, k);

            // Подложка на всю плашку (в вебе было с отступом 8 px — цифры вылезали за неё).
            bg = new GameObject("bg").AddComponent<Image>();
            bg.transform.SetParent(transform, false);
            bg.sprite = Nameplates.White;
            bg.color = new Color(0.03f, 0.03f, 0.045f, 0.78f);
            bg.raycastTarget = false;
            var br = (RectTransform)bg.transform;
            br.anchorMin = Vector2.zero;
            br.anchorMax = Vector2.one;
            br.offsetMin = new Vector2(2, 2);
            br.offsetMax = new Vector2(-2, -2);

            line1 = MakeText("line1", 64, new Color(0.92f, 0.90f, 0.84f), 0.5f);
            // Цифры — крупно и золотом: их читают в эфире.
            line2 = MakeText("line2", 124, new Color(1f, 0.82f, 0.32f), 0.78f);
            cam = Camera.main;
        }

        /// Текст-строка плашки: `y01` — доля высоты холста от верхнего края до центра строки.
        Text MakeText(string name, int size, Color color, float y01)
        {
            var t = new GameObject(name).AddComponent<Text>();
            t.transform.SetParent(transform, false);
            t.font = Nameplates.Font;
            t.fontSize = size;
            t.fontStyle = FontStyle.Bold;
            t.alignment = TextAnchor.MiddleCenter;
            t.color = color;
            t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            var rt = (RectTransform)t.transform;
            rt.sizeDelta = new Vector2(PxW - 8, PxH);
            rt.anchoredPosition = new Vector2(0, PxH * (0.5f - y01));
            return rt.GetComponent<Text>();
        }

        /// Текст с сервера: «ник\nDPS 1234 · макс. удар 567».
        /// Показываем ник и ТОЛЬКО цифры (1234 · 567) — слова «DPS», «макс. удар» в эфире лишние.
        /// Подсказку «Ударь меня…» (никто не бьёт) не показываем вовсе.
        public void SetText(string s)
        {
            if (s == last) return;
            last = s;

            string who = "", nums = "";
            if (!string.IsNullOrEmpty(s))
            {
                int nl = s.IndexOf('\n');
                who = nl < 0 ? s : s.Substring(0, nl);
                var rest = nl < 0 ? "" : s.Substring(nl + 1);
                if (who.Contains("Ударь")) { who = ""; rest = ""; }   // подсказка, а не счёт
                nums = CompactNumbers(rest);
            }
            HasText = !string.IsNullOrEmpty(nums) || !string.IsNullOrEmpty(who);
            line1.text = who;
            line2.text = nums;
        }

        /// «DPS 1234 · удары/с 1.8 · макс. удар 567» → «1234 · 1.8 · 567»: только числа,
        /// у дробных (удары/с) запятая часть сохраняется — иначе «1.8» превращалось в «1 · 8».
        static string CompactNumbers(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var parts = new StringBuilder();
            var num = new StringBuilder();
            void Flush()
            {
                if (num.Length == 0) return;
                if (parts.Length > 0) parts.Append(" · ");
                parts.Append(num);
                num.Clear();
            }
            foreach (char c in s)
            {
                if (c >= '0' && c <= '9') { num.Append(c); continue; }
                // Точка/запятая внутри числа — дробная часть (1.8), а не разделитель.
                if ((c == '.' || c == ',') && num.Length > 0) { num.Append(','); continue; }
                Flush();
            }
            Flush();
            return parts.ToString();
        }

        /// Показывать или нет (в вебе табло включается, только когда герой рядом).
        public void SetVisible(bool on)
        {
            if (gameObject.activeSelf != on) gameObject.SetActive(on);
        }

        void LateUpdate()
        {
            if (!cam) cam = Camera.main;
            if (!cam) return;
            // Полный билборд: разворот по камере целиком (BILLBOARDMODE_ALL).
            transform.rotation = cam.transform.rotation;
        }
    }
}
