// Сноп искр — перенос fxSparks из client/ui/SkillVfx.ts: N квадов, траектории (разлёт, гравитация,
// задержка, уменьшение) считает вершинный шейдер. Индекс искры — в uv2.x, угол квада — в позиции.
Shader "Zep/FxSparks"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _Center ("Center", Vector) = (0, 0, 0, 0)
        _Dir ("Direction", Vector) = (0, 0, 0, 0)
        _Spread ("Spread", Float) = 1
        _T ("Time", Float) = 0
        _Life ("Life", Float) = 0.6
        _Speed ("Speed", Float) = 5
        _Grav ("Gravity", Float) = 9
        _Size ("Size", Float) = 0.22
        _Seed ("Seed", Float) = 0
        _Count ("Count", Float) = 20
        _Smoke ("Smoke (alpha blend, grows)", Float) = 0
        _Drop ("Drop (with Smoke: dense, no grow)", Float) = 0
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcB ("Src", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstB ("Dst", Float) = 1
    }
    SubShader
    {
        Tags { "Queue" = "Transparent+20" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        Blend [_SrcB] [_DstB]
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float4 _Color, _Center, _Dir;
            float _Spread, _T, _Life, _Speed, _Grav, _Size, _Seed, _Count, _Smoke, _Drop;
            struct appdata { float4 vertex : POSITION; float2 uv2 : TEXCOORD1; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; float a : TEXCOORD1; };
            float hash(float n) { return frac(sin(n * 12.9898 + _Seed) * 43758.5453); }
            v2f vert(appdata v)
            {
                v2f o;
                float k = v.uv2.x;
                if (k >= _Count || _T > _Life) { o.pos = float4(2, 2, 2, 1); o.uv = 0; o.a = 0; return o; }
                float delay = hash(k * 7.1) * 0.15 * _Life;
                float t = max(0.0, _T - delay);
                float u = hash(k * 1.7) * 6.28318;
                float w = hash(k * 3.3);
                float3 rnd = normalize(float3(cos(u) * sqrt(1.0 - w * w), w, sin(u) * sqrt(1.0 - w * w)));
                float3 dir = length(_Dir.xyz) > 0.01 ? normalize(lerp(normalize(_Dir.xyz), rnd, _Spread)) : rnd;
                float sp = _Speed * (0.45 + 0.55 * hash(k * 5.9));
                float3 c = _Center.xyz + dir * sp * t + float3(0.0, -0.5 * _Grav * t * t, 0.0);
                float3 right = UNITY_MATRIX_V[0].xyz;
                float3 up = UNITY_MATRIX_V[1].xyz;
                float life = saturate(t / max(0.01, _Life - delay));
                // Искра к концу жизни сжимается, клуб дыма — разрастается.
                float s = _Size * (0.6 + 0.6 * hash(k * 9.1)) * (_Drop > 0.5 ? 1.0 - 0.2 * life : _Smoke > 0.5 ? 0.6 + 1.6 * life : 1.0 - 0.7 * life);
                float3 p = c + (right * v.vertex.x + up * v.vertex.y) * s;
                o.pos = mul(UNITY_MATRIX_VP, float4(p, 1));
                o.uv = v.vertex.xy + 0.5;
                o.a = (1.0 - life) * step(delay, _T);
                return o;
            }
            float4 frag(v2f i) : SV_Target
            {
                float d = length(i.uv - 0.5) * 2.0;
                float a = smoothstep(1.0, 0.0, d) * i.a;
                float core = smoothstep(0.45, 0.0, d);
                // Капля (кровь): плотная, край узкий, гаснет только в конце жизни.
                if (_Drop > 0.5) return float4(_Color.rgb, smoothstep(1.0, 0.75, d) * saturate(i.a * 4.0) * 0.95);
                if (_Smoke > 0.5) return float4(_Color.rgb, smoothstep(1.0, 0.1, d) * i.a * 0.55);
                return float4(lerp(_Color.rgb, 1.0, core * 0.6) * a, 1);
            }
            ENDCG
        }
    }
}
