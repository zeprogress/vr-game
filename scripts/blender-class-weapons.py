import bpy, bmesh, math
K="/Users/zep/ASSETS/art/kits/Ultimate RPG Items Pack - Aug 2019/OBJ/"
OUT="/Users/zep/VR GAME/public/models/weapons/"
def export(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT+name+".glb", export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_texcoords=False)
for src,dst in [("Dagger","dagger"),("Dagger_Golden","dagger_gold"),("Hammer_Double","hammer"),("Hammer_Double_Golden","hammer_gold")]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=K+src+".obj")
    export(dst)

# ---- Копьё: тот же лоу-поли стиль и палитра пака. Ось — +Z блендера (= +Y glTF), хват (origin) у нижней трети.
def mat(name, rgb):
    m=bpy.data.materials.new(name); m.use_nodes=True
    b=m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value=(*rgb,1); b.inputs["Roughness"].default_value=0.6
    m.diffuse_color=(*rgb,1); return m
def spear(gold):
    # Простое копьё: древко, одна обмотка хвата, втулка, узкий плоский наконечник, подток.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    wood=mat("LightWood",(0.13,0.06,0.07)); dark=mat("DarkWood",(0.05,0.03,0.04))
    if gold:
        blade=mat("LightGold",(0.63,0.54,0.15)); metal=mat("Golden",(0.37,0.27,0.05))
    else:
        blade=mat("LightSteel",(0.28,0.28,0.29)); metal=mat("Steel",(0.11,0.13,0.18))
    parts=[]
    def cone(r1,r2,z0,z1,m,verts=8,sy=1.0):
        bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r1,radius2=r2,depth=z1-z0,location=(0,0,(z0+z1)/2))
        o=bpy.context.active_object; o.scale.y=sy
        o.data.materials.append(m); parts.append(o); return o
    cone(0.07,0.065,-1.6,3.1,wood)          # древко
    cone(0.085,0.085,-0.25,1.35,dark)       # обмотка хвата
    cone(0.06,0.09,-1.75,-1.6,metal,6)      # подток
    cone(0.095,0.075,3.05,3.3,metal,8)      # втулка
    cone(0.06,0.17,3.3,3.55,blade,4,0.22)   # наконечник: расширение
    cone(0.17,0.0,3.55,4.35,blade,4,0.22)   # наконечник: к острию
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bpy.ops.object.shade_flat()
    export("spear_gold" if gold else "spear")
spear(False); spear(True)
print("BUILD OK")
