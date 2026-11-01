"""
Обрезает клип SkWhirlwind до ОДНОГО оборота (360°).

Зачем: в моделях героя клип кручения содержал 4 оборота за 2 с. Скрипты умений
масштабировали скорость, но единицей анимации должен быть ровно один круг —
тогда любое число оборотов (5 ударов вихря, 8 и т.д.) получается повтором.

Как: берём ключи первых 25 % клипа (1440° / 4 = 360°) по всем каналам и пишем
их новыми accessors (старые данные не трогаем — файл остаётся валидным).

Запуск: python3 tools/glb/trim_spin.py public/models/chars/Human_Male.glb ...
"""
import json
import math
import struct
import sys

TARGET = "SkWhirlwind"
KEEP_FRAC = 0.25  # один оборот из четырёх


def load(path):
    data = open(path, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen + 8
    return js, data[bin_off:]


def acc_data(js, chunk, idx):
    a = js["accessors"][idx]
    bv = js["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    assert a["componentType"] == 5126, "ожидались float-данные"
    n = a["count"]
    vals = struct.unpack_from("<" + "f" * (comps * n), chunk, off)
    return [vals[i * comps:(i + 1) * comps] for i in range(n)], comps


def one_turn_time(js, chunk, anim, end):
    """Момент, когда тело повернулось ровно на 360° от начала клипа."""
    best = None
    for ch in anim["channels"]:
        if ch["target"]["path"] != "rotation":
            continue
        node = js["nodes"][ch["target"]["node"]].get("name", "")
        smp = anim["samplers"][ch["sampler"]]
        times, _ = acc_data(js, chunk, smp["input"])
        vals, comps = acc_data(js, chunk, smp["output"])
        if comps != 4:
            continue
        total = 0.0
        prev = None
        for i, q in enumerate(vals):
            ang = 2.0 * math.atan2(q[1], q[3])
            if prev is not None:
                d = ang - prev
                while d > math.pi:
                    d -= 2 * math.pi
                while d < -math.pi:
                    d += 2 * math.pi
                total += d
                if abs(total) >= 2 * math.pi:
                    t = times[i][0]
                    cand = (abs(total) - 2 * math.pi, t)
                    if best is None or cand[0] < best[0]:
                        best = cand
                    break
            prev = ang
        if best is not None and "hips" in node.lower():
            break
    if best is None:
        return end * KEEP_FRAC
    return best[1]


def trim(path):
    js, chunk = load(path)
    anim = next((a for a in js.get("animations", []) if a.get("name") == TARGET), None)
    if not anim:
        print(f"{path}: клипа {TARGET} нет — пропуск")
        return False

    # Длительность клипа — по максимуму входных времён.
    end = 0.0
    for smp in anim["samplers"]:
        times, _ = acc_data(js, chunk, smp["input"])
        end = max(end, times[-1][0])
    # Один оборот ищем ПО ФАКТУ вращения, а не по доле времени: в клипе есть
    # разгон/торможение, и первые 25 % времени дают всего ~190°.
    keep_until = one_turn_time(js, chunk, anim, end)

    bin_out = bytearray(chunk)
    # выравниваем до 4 байт (GLB требует выравнивания accessor'ов)
    while len(bin_out) % 4:
        bin_out.append(0)

    def add_accessor(rows, comps, minmax=True):
        nonlocal bin_out
        while len(bin_out) % 4:
            bin_out.append(0)
        off = len(bin_out)
        flat = [v for row in rows for v in row]
        bin_out += struct.pack("<" + "f" * len(flat), *flat)
        js["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": 4 * len(flat)})
        acc = {
            "bufferView": len(js["bufferViews"]) - 1,
            "componentType": 5126,
            "count": len(rows),
            "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}[comps],
        }
        if minmax:
            cols = list(zip(*rows))
            acc["min"] = [min(c) for c in cols]
            acc["max"] = [max(c) for c in cols]
        js["accessors"].append(acc)
        return len(js["accessors"]) - 1

    for ch in anim["channels"]:
        smp = anim["samplers"][ch["sampler"]]
        times, _ = acc_data(js, chunk, smp["input"])
        keep = [i for i, t in enumerate(times) if t[0] <= keep_until + 1e-6]
        vals, comps = acc_data(js, chunk, smp["output"])
        if len(keep) < 2:
            # Канал-константа (два ключа: начало и конец клипа): иначе его хвост держал бы
            # длительность 2 с, и обрезанный клип снова считался бы двухсекундным.
            new_in = add_accessor([[0.0], [keep_until]], 1)
            new_out = add_accessor([vals[0], vals[0]], comps)
        else:
            new_in = add_accessor([times[i] for i in keep], 1)
            new_out = add_accessor([vals[i] for i in keep], comps)
        smp["input"] = new_in
        smp["output"] = new_out
        # интерполяция остаётся как была (LINEAR); cubic spline потребовал бы 3 значения на ключ
        smp["interpolation"] = "LINEAR"

    js["buffers"][0]["byteLength"] = len(bin_out)
    # выравниваем BIN-чанк до 4 байт (GLB)
    while len(bin_out) % 4:
        bin_out.append(0)

    jbytes = json.dumps(js, separators=(",", ":")).encode()
    while len(jbytes) % 4:
        jbytes += b" "
    total = 12 + 8 + len(jbytes) + 8 + len(bin_out)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(jbytes), 0x4E4F534A) + jbytes
    out += struct.pack("<II", len(bin_out), 0x004E4942) + bytes(bin_out)
    open(path, "wb").write(out)
    print(f"{path}: {TARGET} обрезан до {keep_until:.2f} с ({KEEP_FRAC:.0%} от {end:.2f} с)")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("укажи .glb файлы")
        raise SystemExit(1)
    for p in sys.argv[1:]:
        trim(p)
