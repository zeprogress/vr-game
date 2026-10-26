// 6 — телеграф с заливкой (круг/сектор/дуга), 7 — раскалённые трещины лавы, 8 — гарь (множит цвет земли),
// 9 — ледяная наледь. Форма для всех режимов: сектор _A0.._A1 (угол от +Z к +X, как в вебе) и кольцо от _R0.
// Пятно умения на земле — перенос fxDecal из client/ui/SkillVfx.ts: 0 — ударная волна с трещинами,
// 1 — зона с рунами, 2 — прицел, 3 — волна сектором (ось +X), 4 — волна без трещин (яд), 5 — волна без трещин (молот).
Shader "Zep/FxDecal"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _T ("Progress or time", Float) = 0
        _Mode ("Mode", Float) = 0
        _Half ("Sector half angle", Float) = 0.6
        _Alpha ("Alpha", Float) = 1
        _Seed ("Seed", Float) = 0
        _A0 ("Sector from (rad, from +Z to +X)", Float) = -3.1416
        _A1 ("Sector to", Float) = 3.1416
        _R0 ("Inner radius 0..1", Float) = 0
        _Sweep ("Fill sweep: 0 radial, -1 by angle a1->a0", Float) = 0
        _Prog ("Fill progress 0..1", Float) = 0
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcB ("Src", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstB ("Dst", Float) = 1
    }
    SubShader
    {
        Tags { "Queue" = "Transparent+10" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        Blend [_SrcB] [_DstB]
        ZWrite Off
        Cull Off
        Offset -2, -2
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float4 _Color;
            float _T, _Mode, _Half, _Alpha, _Seed, _A0, _A1, _R0, _Sweep, _Prog;
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };
            v2f vert(appdata_base v)
            {
                v2f o;
                // Как groundLift в вебе: чуть ближе к камере — неровная земля круг не срезает.
                float4 cp = UnityObjectToClipPos(v.vertex);
                cp.z += 0.0005 * cp.w * (UNITY_NEAR_CLIP_VALUE < 0 ? -1 : 1);
                o.pos = cp;
                o.uv = v.texcoord.xy;
                return o;
            }
            float hash(float n) { return frac(sin(n * 12.9898 + _Seed) * 43758.5453); }
            float vnoise(float2 q)
            {
                float2 f = frac(q), c = floor(q);
                f = f * f * (3 - 2 * f);
                float h00 = frac(sin(dot(c, float2(127.1, 311.7)) + _Seed) * 43758.5);
                float h10 = frac(sin(dot(c + float2(1, 0), float2(127.1, 311.7)) + _Seed) * 43758.5);
                float h01 = frac(sin(dot(c + float2(0, 1), float2(127.1, 311.7)) + _Seed) * 43758.5);
                float h11 = frac(sin(dot(c + float2(1, 1), float2(127.1, 311.7)) + _Seed) * 43758.5);
                return lerp(lerp(h00, h10, f.x), lerp(h01, h11, f.x), f.y);
            }
            // Ячейки Вороного: расстояние до ближайшей границы — тонкие трещины.
            float cells(float2 q)
            {
                float2 c = floor(q), f = frac(q);
                float d1 = 8, d2 = 8;
                for (int y = -1; y <= 1; y++)
                    for (int x = -1; x <= 1; x++)
                    {
                        float2 g = float2(x, y);
                        float2 o = frac(sin(float2(dot(c + g, float2(127.1, 311.7)), dot(c + g, float2(269.5, 183.3))) + _Seed) * 43758.5);
                        float d = length(g + o - f);
                        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
                    }
                return d2 - d1;
            }
            float4 frag(v2f i) : SV_Target
            {
                float2 p = i.uv * 2.0 - 1.0;
                float r = length(p);
                if (r > 1.0) discard;
                float a = atan2(p.y, p.x);
                // Маска формы: угол от +Z к +X (uv.y — локальная Z), кольцо от _R0; мягкий край.
                float ang = atan2(p.x, p.y);
                float aw = 0.03 / max(r, 0.05);
                float mA = smoothstep(_A0 - aw, _A0 + aw, ang) * smoothstep(_A1 + aw, _A1 - aw, ang);
                float mR = smoothstep(_R0 - 0.02, _R0 + 0.02, r);
                float mask = mA * mR;
                float edgeA = (1 - smoothstep(0.0, 0.035, abs(ang - _A0) * r)) + (1 - smoothstep(0.0, 0.035, abs(ang - _A1) * r));
                float full = step(6.2, _A1 - _A0);
                float outline = max(exp(-pow((r - 0.975) / 0.022, 2.0)), (1 - full) * edgeA * step(_R0, r));
                outline = max(outline, step(0.01, _R0) * exp(-pow((r - _R0) / 0.02, 2.0)) * mA);
                float al = 0.0;
                if (_Mode > 5.5)
                {
                    if (_Mode < 6.5)
                    {
                        // Телеграф: контур, слабая заливка, нарастающая заливка с ярким фронтом.
                        float u = _Sweep < -0.5 ? saturate((_A1 - ang) / max(0.001, _A1 - _A0)) : saturate((r - _R0) / max(0.001, 1 - _R0));
                        float filled = step(u, _Prog);
                        float front = exp(-pow((u - _Prog) / 0.025, 2.0)) * step(0.01, _Prog);
                        float pulse = 0.85 + 0.15 * sin(_T * 18.0);
                        al = (outline * (0.9 + 0.6 * _Prog) * mA + 0.1 + filled * (0.22 + 0.25 * _Prog) + front * 1.3) * pulse;
                        al *= max(mask, outline * mA);
                    }
                    else if (_Mode < 7.5)
                    {
                        // Лава: трещины светятся и «дышат», между ними — тлеющая корка.
                        float c = cells(p * 5.0 + float2(0, _T * 0.15));
                        float n = vnoise(p * 7.0 + _T * 0.6);
                        float crack = smoothstep(0.12, 0.0, c) * (0.7 + 0.6 * n);
                        float edge = smoothstep(1.0, 0.75, r);
                        al = (crack * 1.6 + 0.12 * n) * mask * edge;
                    }
                    else if (_Mode < 8.5)
                    {
                        // Гарь: множитель цвета земли (Blend DstColor Zero) — чернеет к центру, пятнами.
                        float n = vnoise(p * 6.0) * 0.5 + vnoise(p * 13.0) * 0.5;
                        float k = smoothstep(1.0, 0.35, r + (n - 0.5) * 0.35) * mask * _Alpha;
                        return float4(lerp(float3(1, 1, 1), float3(0.12, 0.09, 0.07), k * 0.85), 1);
                    }
                    else
                    {
                        // Наледь: ледяные плиты с яркими швами, иней по краю, блик бежит по льду.
                        float c = cells(p * 4.0);
                        float seams = smoothstep(0.08, 0.0, c);
                        float n = vnoise(p * 9.0);
                        float rim = smoothstep(0.7, 1.0, r) * smoothstep(1.0, 0.92, r) * (0.6 + 0.8 * n);
                        float glint = pow(saturate(1 - abs(frac((p.x + p.y) * 0.5 - _T * 0.25) - 0.5) * 6), 3);
                        float body = smoothstep(1.0, 0.8 + n * 0.15, r);
                        al = (body * (0.05 + seams * 0.45 + glint * 0.15) + rim * 0.6) * mask * 0.6;
                    }
                    return float4(_Color.rgb * al * _Alpha, 1);
                }
                if (_Mode < 0.5 || _Mode > 3.5)
                {
                    float front = 0.12 + 0.88 * sqrt(_T);
                    float band = exp(-pow((r - front) / 0.07, 2.0));
                    float sector = floor((a + 3.14159) / 6.28318 * 11.0);
                    float crackA = abs(frac((a + 3.14159) / 6.28318 * 11.0) - 0.5 + (hash(sector) - 0.5) * 0.5);
                    float crack = smoothstep(0.06, 0.0, crackA) * step(r, front) * smoothstep(0.1, 0.35, r) * step(_Mode, 0.5);
                    float fill = step(r, front) * 0.18 * (1.0 - r);
                    al = (band * 1.2 + crack * 0.9 + fill) * (1.0 - _T * _T);
                }
                else if (_Mode < 1.5)
                {
                    float edge = exp(-pow((r - 0.965) / 0.03, 2.0));
                    float runeBand = smoothstep(0.78, 0.8, r) * smoothstep(0.9, 0.88, r);
                    float runes = step(0.55, frac((a + 3.14159) / 6.28318 * 18.0 + _T * 0.12)) * runeBand;
                    float inner = exp(-pow((r - 0.6) / 0.015, 2.0)) * 0.6;
                    float fill = 0.14 * smoothstep(1.0, 0.2, r);
                    float pulse = 0.75 + 0.25 * sin(_T * 3.0);
                    al = (edge * 1.1 + runes * 0.8 + inner + fill) * pulse;
                }
                else if (_Mode > 2.5)
                {
                    float ang = abs(a);
                    float side = smoothstep(_Half, _Half * 0.7, ang);
                    float front = 0.15 + 0.85 * sqrt(_T);
                    float band = exp(-pow((r - front) / 0.05, 2.0));
                    float trail = step(r, front) * 0.1 * smoothstep(0.15, front, r);
                    al = (band + trail) * side * (1.0 - _T) * smoothstep(0.05, 0.2, r);
                }
                else
                {
                    float ring = exp(-pow((r - 0.78) / 0.05, 2.0));
                    float aa = a + _T * 1.6;
                    float ticks = smoothstep(0.92, 1.0, abs(cos(aa * 2.0))) * smoothstep(0.55, 0.62, r) * smoothstep(1.0, 0.92, r);
                    al = ring + ticks * 1.2;
                }
                return float4(_Color.rgb * al * _Alpha * mask, 1);
            }
            ENDCG
        }
    }
}
