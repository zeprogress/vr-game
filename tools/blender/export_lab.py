import bpy, sys
log = lambda m: print(f"[e8] {m}", flush=True)
OUT = sys.argv[sys.argv.index("--") + 1]
arm = next(o for o in bpy.data.objects if o.type=='ARMATURE')
elf = next(o for o in bpy.data.objects if o.type=='MESH' and len(o.data.polygons)>100)

# ГЛАВНОЕ: снять скрытие (hide_get — «скрыть в окне», экспортёр такие объекты пропускает)
arm.hide_set(False)
arm.hide_viewport = False
elf.hide_set(False)
elf.hide_viewport = False
log(f"после: arm.hide_get={arm.hide_get()}, elf.hide_get={elf.hide_get()}")

arm.data.pose_position = 'POSE'
ad = arm.animation_data
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
ad.action = None
made = 0
for a in bpy.data.actions:
    tr = ad.nla_tracks.new(); tr.name = a.name
    st = tr.strips.new(a.name, int(a.frame_range[0]), a); st.name = a.name
    if a.slots:
        try: st.action_slot = a.slots[0]
        except Exception: pass
    made += 1
log(f"NLA-дорожек: {made}")
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()

for o in list(bpy.data.objects):
    if o is not elf and o is not arm: bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.context.scene.objects: o.select_set(o in (arm, elf))
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True,
    export_animations=True, export_animation_mode="NLA_TRACKS",
    export_skins=True, export_yup=True, export_apply=False,
    export_force_sampling=True,
)
log("готово")
