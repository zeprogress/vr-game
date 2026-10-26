// Кожа боссов: 2 — своя текстура, красное светится (лавовые мобы); 0 — лава (тёмная корка базальта, сквозь трещины течёт и пульсирует магма — свечение в bloom),
// 1 — лёд (гранёные кристаллы: свой наклон нормали на каждой грани, острые блики, холодный ореол по силуэту,
// искры внутри). Узор — трёхмерные ячейки Вороного в пространстве модели, без развёртки. Свет: солнце с тенью,
// окружение (SH) и точечные огни (Forward+), туман.
Shader "Zep/BossSkin"
{
    Properties
    {
        _BaseMap ("Texture", 2D) = "white" {}
        _BaseColor ("Color", Color) = (1, 1, 1, 1)
        _Mode ("0 lava, 1 ice", Float) = 0
        _Scale ("Pattern scale", Float) = 3
        _Tint ("Glow tint", Color) = (1, 0.42, 0.1, 1)
        _Glow ("Glow strength", Float) = 3
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcB ("Src", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstB ("Dst", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Blend [_SrcB] [_DstB]
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile _ _FORWARD_PLUS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float4 _BaseColor, _Tint;
                float _Mode, _Scale, _Glow;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; float4 color : COLOR; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 positionOS : TEXCOORD2;
                float2 uv : TEXCOORD3;
                float fog : TEXCOORD4;
                float4 color : TEXCOORD5;
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.positionOS = v.positionOS.xyz;
                o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
                o.fog = ComputeFogFactor(p.positionCS.z);
                o.color = v.color;
                return o;
            }

            float3 hash3(float3 p)
            {
                p = float3(dot(p, float3(127.1, 311.7, 74.7)), dot(p, float3(269.5, 183.3, 246.1)), dot(p, float3(113.5, 271.9, 124.6)));
                return frac(sin(p) * 43758.5453);
            }

            // Ячейки Вороного: f1, f2 и номер ближайшей ячейки.
            void voronoi(float3 p, out float f1, out float f2, out float3 cellId)
            {
                float3 c = floor(p), f = frac(p);
                f1 = 8; f2 = 8; cellId = 0;
                for (int z = -1; z <= 1; z++)
                for (int y = -1; y <= 1; y++)
                for (int x = -1; x <= 1; x++)
                {
                    float3 g = float3(x, y, z);
                    float3 o = hash3(c + g);
                    float d = length(g + o - f);
                    if (d < f1) { f2 = f1; f1 = d; cellId = c + g; }
                    else if (d < f2) f2 = d;
                }
            }

            float noise3(float3 p)
            {
                float3 i = floor(p), f = frac(p);
                f = f * f * (3 - 2 * f);
                float n = dot(i, float3(1, 57, 113));
                float4 a = frac(sin(n + float4(0, 1, 57, 58)) * 43758.5453);
                float4 b = frac(sin(n + 113 + float4(0, 1, 57, 58)) * 43758.5453);
                float4 m = lerp(a, b, f.z);
                return lerp(lerp(m.x, m.y, f.x), lerp(m.z, m.w, f.x), f.y);
            }

            float3 Shade(float3 albedo, float3 N, float3 V, float3 posWS, float4 posCS, float spec, float wrap)
            {
                float4 shadowCoord = TransformWorldToShadowCoord(posWS);
                Light main = GetMainLight(shadowCoord);
                float3 col = albedo * SampleSH(N);
                float ndl = saturate((dot(N, main.direction) + wrap) / (1 + wrap));
                float atten = main.distanceAttenuation * main.shadowAttenuation;
                col += albedo * main.color * ndl * atten;
                float3 H = normalize(main.direction + V);
                col += main.color * pow(saturate(dot(N, H)), 96) * spec * atten;
            #if defined(_ADDITIONAL_LIGHTS)
                InputData inputData = (InputData)0;
                inputData.positionWS = posWS;
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(posCS);
                uint count = GetAdditionalLightsCount();
                LIGHT_LOOP_BEGIN(count)
                    Light l = GetAdditionalLight(lightIndex, posWS, half4(1, 1, 1, 1));
                    float a = l.distanceAttenuation * l.shadowAttenuation;
                    float nl = saturate((dot(N, l.direction) + wrap) / (1 + wrap));
                    col += albedo * l.color * nl * a;
                    float3 h2 = normalize(l.direction + V);
                    col += l.color * pow(saturate(dot(N, h2)), 64) * spec * a;
                LIGHT_LOOP_END
            #endif
                return col;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float3 N = normalize(i.normalWS);
                float3 V = normalize(GetWorldSpaceViewDir(i.positionWS));
                float3 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).rgb * _BaseColor.rgb;
                float t = _Time.y;
                float3 col;
                if (_Mode > 3.5)
                {
                    // Оружие в руках: цвет грейда записан в цвета вершин (mergeToVertexColors в вебе).
                    float3 albedo = i.color.rgb * _BaseColor.rgb;
                    col = Shade(albedo, N, V, i.positionWS, i.positionCS, 0.5, 0.1);
                    col += albedo * 0.12;
                }
                else if (_Mode > 2.5)
                {
                    // Своя текстура ледяной модели: гладкий блестящий лёд (острые блики, мягкий свет сквозь
                    // толщу), светлые грани чуть светятся холодным — без своего рисунка поверх.
                    float lum = dot(tex, float3(0.3, 0.55, 0.15));
                    col = Shade(tex, N, V, i.positionWS, i.positionCS, 1.4, 0.45);
                    float fres = pow(1 - saturate(dot(N, V)), 4);
                    col += tex * fres * 0.6;
                    col += tex * _Tint.rgb * smoothstep(0.5, 0.95, lum) * _Glow * 0.35;
                }
                else if (_Mode > 1.5)
                {
                    // Своя текстура модели — она уже рисует лаву. Тёмное остаётся тёмным и освещается обычно,
                    // а красно-оранжевое светится само (сила — по яркости и «красноте» пикселя), чуть дышит.
                    float lum = dot(tex, float3(0.3, 0.55, 0.15));
                    float red = saturate((tex.r - max(tex.g, tex.b) * 0.6) * 2.2);
                    float hot = smoothstep(0.18, 0.55, lum) * smoothstep(0.15, 0.6, red);
                    col = Shade(tex * (1 - hot * 0.6), N, V, i.positionWS, i.positionCS, 0.1, 0.1);
                    float pulse = 0.85 + 0.15 * sin(t * 2.2 + i.positionOS.y * 3.0);
                    col += tex * _Tint.rgb * hot * _Glow * pulse;
                }
                else if (_Mode < 0.5)
                {
                    // Лава: трещины между плитами корки; магма течёт (сдвиг узора) и дышит.
                    float3 q = i.positionOS * _Scale;
                    float f1, f2; float3 id;
                    voronoi(q + float3(0, t * 0.05, 0), f1, f2, id);
                    float edge = f2 - f1;
                    float n = noise3(q * 2.3 + t * 0.4);
                    float crack = smoothstep(0.16 + 0.08 * n, 0.0, edge);
                    float heat = saturate(crack * (0.75 + 0.5 * n) + smoothstep(0.35, 0.0, edge) * 0.25);
                    float3 crust = lerp(float3(0.07, 0.05, 0.045), tex * 0.25, 0.35) * (0.7 + 0.6 * hash3(id).x);
                    col = Shade(crust, N, V, i.positionWS, i.positionCS, 0.15 * (1 - heat), 0.2);
                    float pulse = 0.8 + 0.2 * sin(t * 2.3 + hash3(id).y * 6.28);
                    float3 magma = lerp(_Tint.rgb * float3(0.9, 0.35, 0.3), lerp(_Tint.rgb, float3(1, 0.9, 0.55), heat * heat), heat);
                    col += magma * heat * _Glow * pulse;
                    // Края силуэта раскалены сильнее — объём.
                    col += _Tint.rgb * pow(1 - saturate(dot(N, V)), 4) * 0.6 * _Glow * 0.3;
                }
                else
                {
                    // Лёд: каждая грань-ячейка слегка повёрнута (своя нормаль) — модель читается кристаллом.
                    float3 q = i.positionOS * _Scale;
                    float f1, f2; float3 id;
                    voronoi(q, f1, f2, id);
                    float3 h = hash3(id) * 2 - 1;
                    float3 Nf = normalize(N + h * 0.45);
                    float seam = smoothstep(0.08, 0.0, f2 - f1);
                    float3 albedo = lerp(float3(0.55, 0.78, 0.95), tex * float3(0.7, 0.9, 1.1), 0.25) * (0.85 + 0.25 * hash3(id).z);
                    col = Shade(albedo, Nf, V, i.positionWS, i.positionCS, 2.2, 0.6);
                    float fres = pow(1 - saturate(dot(Nf, V)), 3);
                    col += _Tint.rgb * fres * _Glow * 0.55;
                    // Внутреннее свечение и швы между кристаллами.
                    col += _Tint.rgb * (0.12 + seam * 0.6) * _Glow * 0.35;
                    // Искры: редкие ячейки вспыхивают.
                    float spark = step(0.965, hash3(id + floor(t * 2.0)).x) * smoothstep(0.35, 0.0, f1);
                    col += float3(0.9, 0.97, 1) * spark * 3;
                }
                col = MixFog(col, i.fog);
                return half4(col, _BaseColor.a);
            }
            ENDHLSL
        }
        // Имена проходов в UsePass — заглавными (иначе Unity молча не находит проход и тени у модели нет).
        UsePass "Universal Render Pipeline/Lit/SHADOWCASTER"
        UsePass "Universal Render Pipeline/Lit/DEPTHONLY"
        UsePass "Universal Render Pipeline/Lit/DEPTHNORMALS"
    }
}
