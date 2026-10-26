// Сфера жара вокруг героя («Аура раскалённой стали»): светится по краю силуэта, по поверхности течёт
// марево (шум поднимается вверх), внутри почти прозрачна. Аддитивно, без записи глубины.
Shader "Zep/FxHeatSphere"
{
    Properties
    {
        _Color ("Color", Color) = (1, 0.45, 0.12, 1)
        _Alpha ("Alpha", Float) = 1
        _TimeS ("Time", Float) = 0
        _Rim ("Rim power", Float) = 2.2
    }
    SubShader
    {
        Tags { "Queue" = "Transparent+12" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        Blend One One
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float4 _Color;
            float _Alpha, _TimeS, _Rim;
            struct v2f { float4 pos : SV_POSITION; float3 n : TEXCOORD0; float3 v : TEXCOORD1; float3 o : TEXCOORD2; };
            v2f vert(appdata_base v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.n = UnityObjectToWorldNormal(v.normal);
                o.v = WorldSpaceViewDir(v.vertex);
                o.o = v.vertex.xyz;
                return o;
            }
            float hash(float3 p) { return frac(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453); }
            float noise(float3 p)
            {
                float3 i = floor(p), f = frac(p);
                f = f * f * (3 - 2 * f);
                return lerp(lerp(lerp(hash(i), hash(i + float3(1, 0, 0)), f.x), lerp(hash(i + float3(0, 1, 0)), hash(i + float3(1, 1, 0)), f.x), f.y),
                            lerp(lerp(hash(i + float3(0, 0, 1)), hash(i + float3(1, 0, 1)), f.x), lerp(hash(i + float3(0, 1, 1)), hash(i + float3(1, 1, 1)), f.x), f.y), f.z);
            }
            float4 frag(v2f i) : SV_Target
            {
                float ndv = abs(dot(normalize(i.n), normalize(i.v)));
                float rim = pow(1 - ndv, _Rim);
                // Марево: шум, поднимающийся вверх, двумя слоями.
                float3 q = i.o * 3.0 + float3(0, -_TimeS * 1.3, 0);
                float n = noise(q) * 0.6 + noise(q * 2.3 + 7.1) * 0.4;
                float flow = smoothstep(0.35, 0.85, n);
                // К верху сферы жар слабее — горячее у земли.
                float low = saturate(0.75 - i.o.y * 0.6);
                float a = (rim * (0.8 + 0.6 * flow) + flow * 0.12 * low) * _Alpha;
                float3 col = lerp(_Color.rgb, float3(1, 0.85, 0.55), rim * flow * 0.6);
                return float4(col * a, 1);
            }
            ENDCG
        }
    }
}
