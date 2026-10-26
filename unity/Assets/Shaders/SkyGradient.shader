// Небо как в вебе (world/Sky.ts): градиент зенит → горизонт, ниже горизонта — цвет тумана,
// диск солнца с ореолом. Цвета каждый кадр ставит DayCycle из dayState(hour).
Shader "Zep/SkyGradient"
{
    Properties
    {
        _Zenith ("Zenith", Color) = (0.32, 0.52, 0.8, 1)
        _Horizon ("Horizon", Color) = (0.81, 0.89, 0.94, 1)
        _Ground ("Below horizon", Color) = (0.78, 0.85, 0.92, 1)
        _SunDir ("Sun direction (to sun)", Vector) = (0, 1, 0, 0)
        _SunColor ("Sun disc", Color) = (1, 0.97, 0.82, 1)
        _SunSize ("Sun size", Float) = 0.9995
        _Exposure ("Exposure", Float) = 1
        _Fog ("Fog color", Color) = (0.78, 0.85, 0.92, 1)
        _FogMix ("Fog over sky", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" }
        Cull Off ZWrite Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            float4 _Zenith, _Horizon, _Ground, _SunDir, _SunColor, _Fog;
            float _SunSize, _Exposure, _FogMix;

            struct v2f { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; };

            v2f vert(float4 v : POSITION)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v);
                o.dir = v.xyz;
                return o;
            }

            float4 frag(v2f i) : SV_Target
            {
                float3 d = normalize(i.dir);
                float up = d.y;
                // Выше горизонта — к зениту плавно (квадратный корень: светлая полоса у горизонта шире).
                float3 c = up >= 0 ? lerp(_Horizon.rgb, _Zenith.rgb, sqrt(saturate(up))) : lerp(_Horizon.rgb, _Ground.rgb, saturate(-up * 6));
                float s = dot(d, normalize(_SunDir.xyz));
                float disc = smoothstep(_SunSize - 0.0004, _SunSize, s);
                float halo = pow(saturate(s), 64) * 0.35;
                // Купол неба в вебе тоже в тумане: у горизонта затянут целиком, к зениту — слабее.
                c = lerp(c, _Fog.rgb, _FogMix * (1 - 0.35 * saturate(up)));
                c += _SunColor.rgb * (disc + halo) * step(-0.02, up) * (1 - _FogMix * 0.7);
                return float4(c * _Exposure, 1);
            }
            ENDCG
        }
    }
}
