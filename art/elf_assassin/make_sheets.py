import sys, types, os
# --- minimal stubs for the Blender modules (only used for functions we don't call)
for m in ("bpy", "bmesh", "mathutils"):
    sys.modules[m] = types.ModuleType(m)
sys.modules["mathutils"].Vector = tuple
sys.modules["mathutils"].Matrix = None
src = open("elf_assassin.py").read()
src = src.replace('OUT = os.path.dirname(os.path.abspath(__file__))', 'OUT = os.getcwd()')
src = src.replace('os.makedirs(VIEWS_DIR, exist_ok=True)', '')
src = src[:src.index("def main():")] + src[src.index("main()"):] if False else src
# strip the final main() call
idx = src.rindex("\nmain()")
src = src[:idx]
g = {"__name__": "elfsheet", "__file__": os.path.abspath("elf_assassin.py")}
exec(compile(src, "elf_assassin.py", "exec"), g)
views = {k: os.path.join(g["VIEWS_DIR"], f"elf_assassin_{k}.png") for k in ("front", "right", "back", "left", "top")}
g["composite_sheet"](views, os.path.join(g["OUT"], "ElfAssassin_turnaround.png"))
g["contact_sheet"](views, os.path.join(g["VIEWS_DIR"], "contact_silhouettes.png"))
print("sheets ok")
