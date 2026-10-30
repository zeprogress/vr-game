using UnityEngine;

namespace Zep
{
    /// Святилище катакомб (алтарь) — как world/Catacombs.ts buildShrine в вебе:
    /// тёмный алтарь (цилиндр + плита), светящееся кольцо на полу, столб света,
    /// парящая сфера и точечный свет. Стоит там, где сервер прислал catShrineX/Z,
    /// цвет — по типу святилища (CAT_SHRINES), виден только когда catShrine >= 0.
    ///
    /// В вебе алтарь есть всегда; в Unity его не было вовсе — в катакомбах нечего было
    /// активировать. Скрипт сам ставится из WorldSync.Start (объект в сцене не нужен).
    public class CatShrine : MonoBehaviour
    {
        public static CatShrine I { get; private set; }

        /// Высота пола катакомб — CAT_FLOOR_Y в shared/catacombs.ts.
        const float FloorY = -80f;
        /// Цвета святилищ (CAT_SHRINES): ярость, жизнь, стойкость, ветер.
        static readonly Color[] Shrine =
        {
            new(1f, 0.35f, 0.15f), new(0.35f, 1f, 0.45f), new(0.35f, 0.6f, 1f), new(0.85f, 0.95f, 1f),
        };

        Transform root, orb, ring, beam;
        Material stone, glowRing, glowBeam, glowOrb;
        Light lightSrc;
        Texture2D ringTex;
        int shownType = -2;
        float time;

        /// Поставить алтарь (один раз на сцену). Вызывает WorldSync.Start.
        public static CatShrine Ensure()
        {
            if (I) return I;
            var go = new GameObject("catShrine");
            return go.AddComponent<CatShrine>();
        }

        /// Собран ли алтарь. Строим лениво, при первом появлении святилища: в Awake материалы
        /// из ZoneNet.Assets ещё не выставлены (WorldSync кладёт их позже), и «светящиеся» части
        /// получали шейдер, которого нет в сборке — на земле появлялся розовый квадрат.
        bool built;

        void Awake()
        {
            I = this;
            root = new GameObject("altar").transform;
            root.SetParent(transform, false);
            root.gameObject.SetActive(false);
        }

        void OnDestroy()
        {
            if (I == this) I = null;
            if (stone) Destroy(stone);
            if (glowRing) Destroy(glowRing);
            if (glowBeam) Destroy(glowBeam);
            if (glowOrb) Destroy(glowOrb);
            if (ringTex) Destroy(ringTex);
        }

        /// Материал-свечение: аддитивный unlit, цвет в HDR (bloom даёт ореол), как «glow» в вебе.
        Material Glow(SliceAssets assets, Color c, float a)
        {
            var m = new Material(assets.unlitAdd);
            m.name = "catShrineGlow";
            m.SetColor("_BaseColor", new Color(c.r * 2.2f, c.g * 2.2f, c.b * 2.2f, a));
            if (m.HasProperty("_Color")) m.SetColor("_Color", new Color(c.r, c.g, c.b, a));
            return m;
        }

        /// Собрать алтарь. Требует готовых ассетов (litTemplate + unlitAdd): без них материалы
        /// получились бы «розовым квадратом» — поэтому ждём и пробуем в следующем кадре.
        void Build(SliceAssets assets)
        {
            stone = new Material(assets.litTemplate);
            stone.name = "catShrineStone";
            if (stone.HasProperty("_BaseColor")) stone.SetColor("_BaseColor", new Color(0.16f, 0.15f, 0.17f, 1f));
            if (stone.HasProperty("_Smoothness")) stone.SetFloat("_Smoothness", 0.35f);

            // Основание: цилиндр (примитив высотой 2 → сжимаем до 1.2).
            var baseGo = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            baseGo.name = "shrineBase";
            Destroy(baseGo.GetComponent<Collider>());
            baseGo.transform.SetParent(root, false);
            baseGo.transform.localPosition = new Vector3(0, 0.6f, 0);
            baseGo.transform.localScale = new Vector3(1.15f, 0.6f, 1.15f);
            baseGo.GetComponent<MeshRenderer>().sharedMaterial = stone;

            // Плита сверху.
            var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
            slab.name = "shrineSlab";
            Destroy(slab.GetComponent<Collider>());
            slab.transform.SetParent(root, false);
            slab.transform.localPosition = new Vector3(0, 1.3f, 0);
            slab.transform.localScale = new Vector3(1.5f, 0.2f, 1.5f);
            slab.GetComponent<MeshRenderer>().sharedMaterial = stone;

            // Свет — только на алтарь (как includedOnlyMeshes в вебе: cullingMask на слой алтаря).
            lightSrc = new GameObject("shrineLight").AddComponent<Light>();
            lightSrc.transform.SetParent(root, false);
            lightSrc.transform.localPosition = new Vector3(0, 2.2f, 0);
            lightSrc.type = LightType.Point;
            lightSrc.range = 7f;
            lightSrc.intensity = 2.2f;
            lightSrc.shadows = LightShadows.None;

            // Кольцо на полу — плоскость с текстурой кольца, аддитивная.
            ringTex = RingTexture();
            var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            ringGo.name = "shrineRing";
            Destroy(ringGo.GetComponent<Collider>());
            ringGo.transform.SetParent(root, false);
            ringGo.transform.localPosition = new Vector3(0, 0.09f, 0);
            ringGo.transform.localRotation = Quaternion.Euler(90f, 0, 0); // плоскость лежит на земле
            ringGo.transform.localScale = new Vector3(7f, 7f, 1f);
            glowRing = Glow(assets, Color.white, 0.95f);
            glowRing.SetTexture("_BaseMap", ringTex);
            if (glowRing.HasProperty("_BaseColor")) glowRing.SetColor("_BaseColor", Color.white * 2.4f);
            ringGo.GetComponent<MeshRenderer>().sharedMaterial = glowRing;
            ring = ringGo.transform;

            // Столб света над алтарём.
            var beamGo = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            beamGo.name = "shrineBeam";
            Destroy(beamGo.GetComponent<Collider>());
            beamGo.transform.SetParent(root, false);
            beamGo.transform.localPosition = new Vector3(0, 6.8f, 0);
            beamGo.transform.localScale = new Vector3(1.5f, 5.5f, 1.5f); // примитив 2 ед → 11 м
            glowBeam = Glow(assets, Color.white, 0.18f);
            beamGo.GetComponent<MeshRenderer>().sharedMaterial = glowBeam;
            var beamR = beamGo.GetComponent<MeshRenderer>();
            beamR.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            beamR.receiveShadows = false;
            beam = beamGo.transform;

            // Парящая сфера + ореол.
            var orbGo = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            orbGo.name = "shrineOrb";
            Destroy(orbGo.GetComponent<Collider>());
            orbGo.transform.SetParent(root, false);
            orbGo.transform.localPosition = new Vector3(0, 2.2f, 0);
            orbGo.transform.localScale = Vector3.one * 0.6f;
            glowOrb = Glow(assets, Color.white, 1f);
            orbGo.GetComponent<MeshRenderer>().sharedMaterial = glowOrb;
            orb = orbGo.transform;
        }

        /// Кольцо: яркое по краю, мягкая заливка внутри, ступенчатые «руны» по кругу.
        static Texture2D RingTexture()
        {
            const int S = 128;
            var t = new Texture2D(S, S, TextureFormat.RGBA32, false) { name = "catShrineRingTex", wrapMode = TextureWrapMode.Clamp };
            var px = new Color[S * S];
            for (int y = 0; y < S; y++)
                for (int x = 0; x < S; x++)
                {
                    float u = (x + 0.5f) / S * 2f - 1f, v = (y + 0.5f) / S * 2f - 1f;
                    float r = Mathf.Sqrt(u * u + v * v);
                    float a = Mathf.Exp(-Mathf.Pow((r - 0.965f) / 0.03f, 2f));           // край
                    a += Mathf.Exp(-Mathf.Pow((r - 0.72f) / 0.012f, 2f)) * 0.6f;          // внутреннее кольцо
                    float ang = Mathf.Atan2(v, u);
                    if (r > 0.78f && r < 0.9f && Mathf.Repeat(ang / (Mathf.PI * 2f) * 18f, 1f) > 0.55f) a += 0.5f; // руны
                    a += 0.12f * Mathf.Clamp01(1f - r);                                    // мягкая заливка
                    px[y * S + x] = new Color(1f, 1f, 1f, Mathf.Clamp01(a));
                }
            t.SetPixels(px);
            t.Apply();
            return t;
        }

        /// Цвет святилища по типу: все светящиеся части перекрашиваются разом.
        void Paint(Color c)
        {
            if (glowRing) glowRing.SetColor("_BaseColor", new Color(c.r * 2.4f, c.g * 2.4f, c.b * 2.4f, 0.95f));
            if (glowBeam) glowBeam.SetColor("_BaseColor", new Color(c.r * 2f, c.g * 2f, c.b * 2f, 0.18f));
            if (glowOrb) glowOrb.SetColor("_BaseColor", new Color(c.r * 3f, c.g * 3f, c.b * 3f, 1f));
            if (lightSrc) lightSrc.color = c;
        }

        void Update()
        {
            var state = ZoneNet.I && ZoneNet.I.Room != null ? ZoneNet.I.Room.State : null;
            if (state == null) return;
            int type = state.catShrine;
            bool on = type >= 0;
            if (!on)
            {
                if (root && root.gameObject.activeSelf) root.gameObject.SetActive(false);
                return;
            }
            if (!built)
            {
                var assets = ZoneNet.I.Assets;
                if (!assets || !assets.litTemplate || !assets.unlitAdd) return; // ждём материалы
                Build(assets);
                built = true;
            }
            if (!root.gameObject.activeSelf) root.gameObject.SetActive(true);

            if (type != shownType)
            {
                shownType = type;
                Paint(Shrine[Mathf.Clamp(type, 0, Shrine.Length - 1)]);
            }

            root.position = new Vector3(state.catShrineX, FloorY + 0.02f, state.catShrineZ);

            time += Time.deltaTime;
            if (orb) orb.localPosition = new Vector3(0, 2.2f + 0.18f * Mathf.Sin(time * 2.2f), 0);
            if (ring) ring.Rotate(0, 0, -0.5f * Mathf.Rad2Deg * Time.deltaTime, Space.Self); // крутится в своей плоскости
            if (lightSrc) lightSrc.intensity = 2.2f * (0.85f + 0.15f * Mathf.Sin(time * 2.6f));
        }
    }
}
