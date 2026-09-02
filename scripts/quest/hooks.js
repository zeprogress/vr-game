// Диагностические перехваты для игровой сессии на шлеме.
// Инъекция: node scripts/quest/watch.mjs  (или eval.mjs с этим файлом на stdin).
// Идемпотентно — вешает обёртки один раз, пишет события в console.
(() => {
  const g = window.game;
  if (!g) return "нет window.game";
  if (g.__questHooks) return "перехваты уже стоят";
  g.__questHooks = true;
  const f = (n) => (typeof n === "number" ? n.toFixed(2) : n);
  const out = [];

  const nm = g.netMobs;
  if (nm && typeof nm.spawnBurst === "function") {
    const orig = nm.spawnBurst.bind(nm);
    nm.spawnBurst = (pos, r, hit) => {
      console.log(`[BURST] r=${f(r)} hit=${hit} @ ${f(pos.x)},${f(pos.y)},${f(pos.z)}`);
      return orig(pos, r, hit);
    };
    out.push("spawnBurst");
  }

  const c = g.combat;
  if (c) {
    const oc = c.onCast;
    c.onCast = (m) => {
      console.log(`[CAST] charge=${f(m.charge)} pull=${f(m.pull)} hand=${m.hand} mana=${f(c.mana)}`);
      return oc?.(m);
    };
    out.push("onCast");
    if (typeof c.resetCast === "function") {
      const orr = c.resetCast.bind(c);
      c.resetCast = () => {
        if (c.charge > 0.01) console.log(`[CAST-ABORT] charge=${f(c.charge)} mana=${f(c.mana)}`);
        return orr();
      };
      out.push("resetCast");
    }
  }

  // Разовый снимок ошибок рендера, которые уже случились до инъекции.
  console.log(`[HOOKS] ${out.join(", ")} — готово`);
  return "ok: " + out.join(", ");
})();
