// Молния — перенос fxBolt из client/ui/SkillVfx.ts: лента из A в B, излом по сегментам перескакивает
// ~12 раз в секунду, ширина к камере. В позиции: x — доля вдоль (0..1), y — сторона (−1/1).
Shader "Zep/FxBolt"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _A ("From", Vector) = (0, 0, 0, 0)
        _B ("To", Vector) = (0, 0, 0, 0)
        _Width ("Width", Float) = 0.08
        _Seed ("Seed", Float) = 0
        _Amp ("Amplitude", Float) = 0.5
        _Alpha ("Alpha", Float) = 1
        _TimeS ("Time", Float) = 0
    }
    SubShader
    {
        Tags { "Queue" = "Transparent+20" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        Blend One One
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float4 _Color, _A, _B;
            float _Width, _Seed, _Amp, _Alpha, _TimeS;
            struct v2f { float4 pos : SV_POSITION; float side : TEXCOORD0; };
            float hash(float n) { return frac(sin(n * 12.9898 + _Seed) * 43758.5453); }
            v2f vert(appdata_base v)
            {
                v2f o;
                float t = v.vertex.x;
                float3 ab = _B.xyz - _A.xyz;
                float3 mid = _A.xyz + ab * t;
                float3 side = normalize(cross(ab, _WorldSpaceCameraPos - mid) + float3(1e-4, 0, 0));
                float3 up2 = normalize(cross(side, ab) + float3(0, 1e-4, 0));
                float seg = floor(t * 14.0);
                float tick = floor(_TimeS * 12.0);
                float env = sin(3.14159 * t);
                float3 off = (side * (hash(seg + tick * 13.0) - 0.5) + up2 * (hash(seg * 3.0 + tick * 7.0) - 0.5)) * _Amp * env;
                float3 p = mid + off + side * v.vertex.y * _Width;
                o.pos = mul(UNITY_MATRIX_VP, float4(p, 1));
                o.side = v.vertex.y;
                return o;
            }
            float4 frag(v2f i) : SV_Target
            {
                float s = 1.0 - abs(i.side);
                float a = (s * s * 0.8 + smoothstep(0.6, 1.0, s)) * _Alpha;
                return float4(lerp(_Color.rgb, 1.0, smoothstep(0.7, 1.0, s)) * a, 1);
            }
            ENDCG
        }
    }
}
