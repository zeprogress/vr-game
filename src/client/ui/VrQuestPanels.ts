import type { PcInvData, QuestActMsg, QuestData, QuestSlotView, ShopData } from "#shared/net/messages";
import { VR_UI, type PanelUi } from "./VrPanel";

/**
 * Содержимое VR-панелей у NPC лагеря — те же карточки, что в ПК-окнах
 * (QuestWindow / HunterWindow / ShopWindow), нарисованные на холсте.
 */

const PAD = 40;

function header(ui: PanelUi, title: string, right?: string): number {
  ui.text(title, PAD, 34, 46, VR_UI.title, 800);
  if (right) ui.text(right, ui.W - PAD, 42, 38, VR_UI.gold, 800, "right");
  return 104;
}

function reward(r: QuestSlotView["reward"]): string {
  return [r.xpPct > 0 ? "опыт" : "", `${r.tokens} ◈`, `лом ×${r.scrap}`].filter(Boolean).join(" · ");
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

/** Карточка задания; btn — кнопка справа. Вернёт новую y. */
function slotCard(
  ui: PanelUi,
  y: number,
  s: QuestSlotView,
  id: string,
  btn: { label: string; act: () => void; main?: boolean; enabled?: boolean } | null,
  progress = true,
): number {
  const x = PAD;
  const w = ui.W - PAD * 2;
  const h = progress && !s.claimed ? 128 : 104;
  ui.rect(x, y, w, h, s.hard ? VR_UI.cardHard : VR_UI.card, 14, s.hard ? "#6d4a96" : undefined);
  if (s.claimed) ui.ctx.globalAlpha = 0.45;
  let tx = x + 20;
  if (s.hard) {
    ui.rect(tx, y + 18, 150, 32, "#3a2a4c", 6);
    ui.text("Усложн.", tx + 75, y + 20, 22, "#dcc2ff", 800, "center");
    tx += 162;
  }
  ui.text(s.title, tx, y + 16, 32, VR_UI.title, 700);
  if (progress) {
    ui.text(s.claimed ? "сдано" : s.done ? "✓ готово" : `${s.got}/${s.need}`, x + w - 20, y + 18, 30, VR_UI.good, 700, "right");
  }
  let ry = y + 62;
  if (progress && !s.claimed) {
    ui.bar(x + 20, y + 62, w - 40, s.got / Math.max(1, s.need), s.hard ? VR_UI.barHard : VR_UI.barFill);
    ry = y + 86;
  }
  ui.text(reward(s.reward), x + 20, ry, 26, VR_UI.sub);
  ui.ctx.globalAlpha = 1;
  if (btn) ui.button(id, btn.label, x + w - 220, y + h - 64, 200, 52, btn.act, btn.main ?? true, btn.enabled ?? true);
  return y + h + 14;
}

export function drawBoard(ui: PanelUi, d: QuestData | null, act: (m: QuestActMsg) => void): void {
  let y = header(ui, "Доска заданий", d ? `◈ ${d.tokens}` : undefined);
  if (!d) {
    ui.text("Загрузка…", PAD, y, 30, VR_UI.dim);
    return;
  }
  ui.text(`Новые задания через ${fmtTime(d.nextSecs)}`, PAD, y, 26, VR_UI.dim);
  y += 50;
  if (!d.dailyTaken) {
    ui.text("ЗАДАНИЯ ДНЯ", PAD, y, 24, VR_UI.dim, 800);
    y += 38;
    for (const s of d.slots.slice(0, 3)) y = slotCard(ui, y, s, "", null, false);
    ui.button("takeDaily", "Взять задания дня", PAD, y, ui.W - PAD * 2, 64, () => act({ act: "takeDaily", idx: 0 }), true);
    y += 84;
  } else {
    ui.text("МОИ ЗАДАНИЯ", PAD, y, 24, VR_UI.dim, 800);
    y += 38;
    d.slots.forEach((s, i) => {
      y = slotCard(ui, y, s, `claim:${i}`, s.done && !s.claimed ? { label: "Сдать", act: () => act({ act: "claim", idx: i }) } : null);
    });
  }
  ui.text(d.picksLeft > 0 ? `ДОПОЛНИТЕЛЬНЫЕ — МОЖНО ВЗЯТЬ ЕЩЁ ${d.picksLeft}` : "ДОПОЛНИТЕЛЬНЫЕ — НА СЕГОДНЯ ВЗЯТО", PAD, y, 24, VR_UI.dim, 800);
  y += 38;
  d.offers.forEach((s, i) => {
    if (y > ui.H - 130) return;
    y = slotCard(ui, y, s, `take:${i}`, d.picksLeft > 0 ? { label: "Взять", act: () => act({ act: "take", idx: i }), main: false } : null, false);
  });
}

export function drawHunter(ui: PanelUi, d: QuestData | null, act: (m: QuestActMsg) => void): void {
  let y = header(ui, "Охотник");
  if (!d) return;
  ui.text("ИСТОРИЯ ЛАГЕРЯ", PAD, y, 24, VR_UI.dim, 800);
  y += 40;
  const st = d.story;
  const w = ui.W - PAD * 2;
  if (!st) {
    ui.text("Вся история пройдена — ты защитник лагеря.", PAD, y, 28, VR_UI.sub);
    y += 60;
  } else {
    const top = y;
    ui.rect(PAD, y, w, 300, VR_UI.cardStory, 14, "#3f5580");
    ui.text(`Глава ${st.chapter}/${st.total}: ${st.title}`, PAD + 20, y + 16, 34, VR_UI.title, 700);
    ui.text(st.done ? "✓ готово" : `${st.got}/${st.need}`, PAD + w - 20, y + 18, 30, VR_UI.good, 700, "right");
    y += 64;
    y += ui.wrap(`«${st.text}»`, PAD + 20, y, w - 40, 28, "#c9c2b0");
    ui.bar(PAD + 20, y + 8, w - 40, st.got / Math.max(1, st.need));
    const r = st.reward;
    ui.text(
      [r.xpPct ? "опыт" : "", `${r.tokens} ◈`, `зелья ×${r.potions}`, r.final ? "титул и оружие 80+" : ""].filter(Boolean).join(" · "),
      PAD + 20,
      y + 34,
      26,
      VR_UI.sub,
    );
    const by = top + 300 - 66;
    if (!st.taken) ui.button("storyTake", "Взять", PAD + w - 220, by, 200, 52, () => act({ act: "storyTake", idx: 0 }), true);
    else if (st.done) ui.button("storyClaim", "Сдать", PAD + w - 220, by, 200, 52, () => act({ act: "storyClaim", idx: 0 }), true);
    y = top + 320;
  }
  const wk = d.weekly;
  ui.text(`КОНТРАКТ НЕДЕЛИ · ОБНОВИТСЯ ЧЕРЕЗ ${fmtTime(wk.secsLeft).toUpperCase()}`, PAD, y, 24, VR_UI.dim, 800);
  y += 40;
  const top = y;
  ui.rect(PAD, y, w, 380, VR_UI.cardHard, 14, "#6d4a96");
  if (wk.claimed) ui.ctx.globalAlpha = 0.45;
  y += 18;
  for (const p of wk.parts) {
    ui.text(p.label.length > 44 ? `${p.label.slice(0, 42)}…` : p.label, PAD + 20, y, 26, VR_UI.sub);
    ui.text(`${p.got}/${p.need}`, PAD + w - 20, y, 26, VR_UI.good, 700, "right");
    ui.bar(PAD + 20, y + 38, w - 40, p.got / Math.max(1, p.need), VR_UI.barHard);
    y += 76;
  }
  ui.text(
    wk.claimed ? "Сдан — новый контракт в понедельник" : [wk.reward.xpPct ? "опыт" : "", `${wk.reward.tokens} ◈`, "оружие 80+"].filter(Boolean).join(" · "),
    PAD + 20,
    y + 4,
    26,
    VR_UI.sub,
  );
  ui.ctx.globalAlpha = 1;
  const by = top + 380 - 66;
  if (!wk.taken) ui.button("weeklyTake", "Взять контракт", PAD + w - 300, by, 280, 52, () => act({ act: "weeklyTake", idx: 0 }), true);
  else if (wk.done && !wk.claimed) ui.button("weeklyClaim", "Сдать", PAD + w - 220, by, 200, 52, () => act({ act: "weeklyClaim", idx: 0 }), true);
}

export function drawShop(ui: PanelUi, d: ShopData | null, buy: (id: string) => void): void {
  let y = header(ui, "Трактир «Тёплый угол»", d ? `◈ ${d.tokens}` : undefined);
  ui.text("Жетоны ◈ дают за задания (доска и Охотник у выхода из лагеря)", PAD, y, 26, VR_UI.dim);
  y += 54;
  if (!d) return;
  const w = ui.W - PAD * 2;
  for (const it of d.items) {
    ui.rect(PAD, y, w, 116, VR_UI.card, 14);
    ui.text(it.name, PAD + 20, y + 16, 32, VR_UI.title, 700);
    ui.text(it.desc, PAD + 20, y + 62, 26, VR_UI.sub);
    const label = it.fishCost ? `${it.fishCost}🐟→1◈` : `${it.price} ◈`;
    const can = it.fishCost ? (d.fish ?? 0) >= it.fishCost : d.tokens >= it.price;
    ui.button(`buy:${it.id}`, label, PAD + w - 220, y + 30, 200, 56, () => buy(it.id), true, can);
    y += 130;
  }
}

/** Рыбалка в VR: выбор режима и мини-игра (метка должна попасть в зелёную зону — жми курок/кнопку). */
export function drawFishing(
  ui: PanelUi,
  st: { phase: string; mode: string; hits: number; need: number; mark: number; zone: number; zoneW: number; timeLeft: number },
  choose: (mode: "auto" | "manual") => void,
  cancel: () => void,
): void {
  const w = ui.W - PAD * 2;
  header(ui, "Рыбалка");
  if (st.phase === "choosing") {
    ui.button("auto", "Авторыбалка", PAD, 130, w / 2 - 10, 90, () => choose("auto"), true);
    ui.button("manual", "Вручную", PAD + w / 2 + 10, 130, w / 2 - 10, 90, () => choose("manual"), true);
    ui.text("~1 мин на рыбу, сам", PAD + w / 4, 236, 24, VR_UI.sub, 500, "center");
    ui.text("быстрее, мини-игра", PAD + (3 * w) / 4, 236, 24, VR_UI.sub, 500, "center");
    ui.button("cancel", "Отмена", PAD + w / 2 - 110, 290, 220, 56, cancel);
    return;
  }
  if (st.phase === "mini") {
    ui.text(`Клюёт! Подсекай, когда метка в зелёном (${st.hits}/${st.need})`, PAD, 130, 30, VR_UI.title, 700);
    const bx = PAD;
    const by = 200;
    ui.rect(bx, by, w, 60, VR_UI.barBg, 30);
    ui.rect(bx + (st.zone - st.zoneW / 2) * w, by, st.zoneW * w, 60, "#3f8f4a", 8);
    ui.rect(bx + st.mark * w - 6, by - 10, 12, 80, "#f1ead6", 4);
    ui.text(`Жми курок или кнопку взаимодействия · ${Math.ceil(st.timeLeft)} с`, PAD, 290, 26, VR_UI.sub);
    return;
  }
  ui.text(st.mode === "auto" ? "Авторыбалка… герой ловит сам" : "Ждём поклёвку…", PAD, 140, 32, VR_UI.title, 700);
  ui.button("stop", "Смотать удочку", PAD + w / 2 - 170, 220, 340, 64, cancel);
}

/** Заточка в VR (как ПК-вкладка «Заточка»): роллы предмета, цена в ломе, шанс. */
export function drawEnchant(
  ui: PanelUi,
  d: PcInvData | null,
  id: string,
  inHand: boolean,
  lastResult: { up: boolean; text: string } | null,
  enchant: (idx: number) => void,
  close: () => void,
): void {
  const w = d?.weapons.find((x) => x.id === id) ?? null;
  header(ui, "Заточка");
  ui.button("close", "✕", ui.W - PAD - 70, 30, 70, 56, close);
  // Лом — левее крестика (раньше рисовался под ним и не читался).
  if (d) ui.text(`лом ${d.scrap}`, ui.W - PAD - 90, 42, 36, VR_UI.gold, 800, "right");
  if (!d || !w) {
    ui.text(d ? "Предмет не найден на складе" : "Загрузка…", PAD, 120, 30, VR_UI.dim);
    return;
  }
  const tierColor = w.tier === "legendary" ? VR_UI.purple : w.tier === "gold" ? "#f5c542" : VR_UI.text;
  let x = ui.text(w.name, PAD, 110, 36, tierColor, 800);
  if (inHand) {
    ui.rect(PAD + x + 16, 114, 110, 34, "#8fd18f", 6);
    ui.text("в руке", PAD + x + 71, 117, 24, "#0e1a10", 800, "center");
  }
  x = ui.text("оценка ", PAD, 162, 26, VR_UI.sub);
  ui.text(String(w.quality), PAD + x, 154, 40, "#ffcf5a", 800);
  let y = 224;
  const bw = ui.W - PAD * 2;
  w.ench.forEach((a, i) => {
    ui.rect(PAD, y, bw, 110, VR_UI.card, 14);
    ui.text(a.label, PAD + 20, y + 14, 28, "#9fe39a", 700);
    ui.bar(PAD + 20, y + 62, bw - 300, a.points / 33, VR_UI.gold, 16);
    ui.text(`${a.points}/33`, PAD + 20 + bw - 290, y + 56, 24, VR_UI.sub);
    if (a.max) ui.text("MAX", PAD + bw - 110, y + 36, 32, VR_UI.gold, 800, "center");
    else {
      ui.button(`ench:${i}`, `⚒ ${a.cost}`, PAD + bw - 200, y + 14, 180, 50, () => enchant(i), true, d.scrap >= a.cost);
      ui.text(`шанс ${Math.round(a.chance * 100)}%`, PAD + bw - 110, y + 72, 22, VR_UI.sub, 500, "center");
    }
    y += 124;
  });
  if (lastResult) {
    ui.rect(PAD, y + 4, bw, 70, lastResult.up ? "#1f3a24" : "#3a1f1f", 12);
    ui.text(lastResult.text, ui.W / 2, y + 24, 28, lastResult.up ? "#9fe39a" : "#ff9a8e", 700, "center");
    y += 90;
  }
  ui.wrap("Чем ближе аффикс к максимуму и чем лучше предмет — тем дороже и меньше шанс. При неудаче лом сгорает.", PAD, y + 10, bw, 22, VR_UI.dim);
}

/** Итог последнего действия (покупка, сдача) — плашкой внизу панели NPC. */
export function drawNote(ui: PanelUi, note: string | null): void {
  if (!note) return;
  const h = 96;
  const y = ui.H - h - 24;
  ui.rect(PAD, y, ui.W - PAD * 2, h, "rgba(36,58,38,0.95)", 14, "#3f7a45");
  ui.wrap(note, PAD + 20, y + 16, ui.W - PAD * 2 - 40, 28, "#e9ffe9", 700);
}
