using UnityEngine;
using UnityEngine.UI;

namespace Zep
{
    /// Мирная плашка над мобом в мировых координатах: тёмный прямоугольник и две строки текста,
    /// всегда лицом к камере. Повторяет табло пугала из веба (client/combat/Mob.ts buildScarecrow:
    /// плоскость 2.6×0.75 м, BILLBOARDMODE_ALL, первая строка — ник, вторая — DPS и макс. удар).
    public class MobPlate : MonoBehaviour
    {
        /// Размер холста плашки в «пикселях веба» (как динамическая текстура 768×220 в Mob.ts).
        const float PxW = 768f, PxH = 220f;

        Text line1, line2;
        string last;
        Camera cam;

        /// Плашка на 2.6×0.75 м над точкой `y` в родителе `parent`.
        public static MobPlate Create(Transform parent, float y, float widthM = 2.6f)
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
            // Плашка живёт в мировых метрах: холст 768 px → widthM метров.
            float k = widthM / PxW;
            transform.localScale = new Vector3(k, k, k);

            var bg = new GameObject("bg").AddComponent<Image>();
            bg.transform.SetParent(transform, false);
            bg.sprite = Nameplates.White;
            bg.color = new Color(0.04f, 0.035f, 0.055f, 0.72f);
            bg.raycastTarget = false;
            var br = (RectTransform)bg.transform;
            br.anchorMin = Vector2.zero;
            br.anchorMax = Vector2.one;
            br.offsetMin = new Vector2(8, 8);
            br.offsetMax = new Vector2(-8, -8);

            line1 = MakeText("line1", 52, new Color(0.90f, 0.88f, 0.82f), 66);
            line2 = MakeText("line2", 62, new Color(1f, 0.81f, 0.35f), 150);
            cam = Camera.main;
        }

        Text MakeText(string name, int size, Color color, float centerY)
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
            rt.sizeDelta = new Vector2(PxW - 40, 90);
            // В холсте Y растёт вверх, а текст веба рисовался от верхнего края — считаем от центра.
            rt.anchoredPosition = new Vector2(0, PxH * 0.5f - centerY);
            return t;
        }

        /// Текст как у веба: «ник\nDPS 1234 · макс. удар 567» (две строки).
        public void SetText(string s)
        {
            if (s == last) return;
            last = s;
            if (string.IsNullOrEmpty(s))
            {
                line1.text = "";
                line2.text = "";
                return;
            }
            int nl = s.IndexOf('\n');
            if (nl < 0)
            {
                line1.text = s;
                line2.text = "";
            }
            else
            {
                line1.text = s.Substring(0, nl);
                line2.text = s.Substring(nl + 1);
            }
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
