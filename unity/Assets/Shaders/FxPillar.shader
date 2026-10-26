// Столб света — перенос fxPillar из client/ui/SkillVfx.ts: открытый цилиндр, бегущие полосы, к верху гаснет.
Shader "Zep/FxPillar"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _TimeS ("Time", Float) = 0
        _Alpha ("Alpha", Float) = 1
    }
    SubShader
    {
        Tags { "Queue" = "Transparent+15" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
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
            float _TimeS, _Alpha;
            struct v2f { float4 pos : SV_POSITION; float v : TEXCOORD0; };
            v2f vert(appdata_base v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.v = v.texcoord.y;
                return o;
            }
            float4 frag(v2f i) : SV_Target
            {
                float bands = 0.65 + 0.35 * sin(i.v * 18.0 - _TimeS * 7.0);
                float a = pow(1.0 - i.v, 1.6) * bands * _Alpha;
                return float4(_Color.rgb * a, 1);
            }
            ENDCG
        }
    }
}
