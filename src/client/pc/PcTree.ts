import { treeOf, type TreeNode, type TreePart } from "#shared/passiveTree";
import type { ClassId } from "#shared/classes2";

/**
 * Окно дерева прокачки (вкладка «Атрибуты» в PcInventory — ПК и веб-инвентарь !inv).
 * Данные — shared/passiveTree.ts (то же дерево, что считает сервер). Узел открывается, если взят
 * соседний; клик по взятому — снять (сервер снимет и всё, что от него оторвётся).
 */

const STEP = 34;
const PAD = 22;
const LANE_COLOR: Record<TreePart, string> = { dmg: "#f0664f", mixa: "#f08a3c", def: "#5fb0d6", mixb: "#f08a3c", skl: "#a98be0" };
const GOLD = "#d9b35a";
const KIND_RU: Record<TreeNode["kind"], string> = { root: "старт", attr: "атрибут", small: "малый", skill: "умение", key: "ключевой" };
const NS = "http://www.w3.org/2000/svg";

let styled = false;
function ensureStyle(): void {
  if (styled) return;
  styled = true;
  const st = document.createElement("style");
  st.textContent = `
.pctree { display:flex; flex-direction:column; gap:10px; }
.pctree-svg { width:100%; height:auto; max-height:62vh; display:block; }
.pctree-svg .edge { stroke:#4a4339; stroke-width:2; fill:none; }
.pctree-svg .edge.on { stroke-width:3.5; }
.pctree-svg .edge.bridge { stroke:${GOLD}; stroke-dasharray:5 4; }
.pctree-svg .edge.bridge.on { stroke-dasharray:none; }
.pctree-svg .node { cursor:pointer; }
.pctree-svg .node circle { fill:#14120f; stroke:#4a4339; stroke-width:2; }
.pctree-svg .node text { font:700 10px sans-serif; fill:#9b9184; text-anchor:middle; dominant-baseline:central; pointer-events:none; }
.pctree-svg .node.attr circle { stroke-dasharray:4 3; }
.pctree-svg .node.key circle { stroke:${GOLD}; stroke-width:2.5; }
.pctree-svg .node.free circle { stroke-width:3; }
.pctree-svg .node.on text { fill:#14120f; }
.pctree-svg .node.locked { opacity:.35; cursor:default; }
.pctree-svg .node.soon circle { stroke-dasharray:2 3; }
.pctree-svg .node.sel circle { stroke:#efe9dd; stroke-width:3; }
.pctree-svg .node:focus { outline:none; }
.pctree-svg .node:focus-visible circle { stroke:#efe9dd; stroke-width:3.5; }
.pctree-svg .lane { font:700 10px sans-serif; fill:#9b9184; text-anchor:middle; letter-spacing:.06em; text-transform:uppercase; }
.pctree-info { min-height:58px; font-size:13px; line-height:1.4; }
.pctree-info b { font-size:14px; }
.pctree-info .k { opacity:.65; }
.pctree-sum { font-size:12px; display:grid; gap:2px; max-height:140px; overflow:auto; }
.pctree-sum .k { color:${GOLD}; }
`;
  document.head.append(st);
}

export interface PcTreeOpts {
  cls: ClassId;
  taken: number[];
  unspent: number;
  /** Взять (true) или снять (false) узел. */
  act: (id: number, take: boolean) => void;
  /** Касания (телефон): первый тап — выбрать узел и показать описание, второй тап по нему — взять / снять. */
  touch?: boolean;
}

/** Выбранный тапом узел — живёт между перерисовками окна (телефон). */
let touchSel = -1;

/** Собрать окно дерева. Возвращает готовый элемент (перерисовка — новый вызов с новыми данными). */
export function pcTreePanel(o: PcTreeOpts): HTMLElement {
  ensureStyle();
  const t = treeOf(o.cls);
  const taken = new Set(o.taken);
  const isOn = (id: number) => id === 0 || taken.has(id);
  const near = (id: number) => t.adj[id].some(isOn);
  const free = (id: number) => !isOn(id) && near(id) && o.unspent > 0;
  const color = (n: TreeNode) => (n.kind === "key" ? GOLD : LANE_COLOR[n.part]);
  const X = (x: number) => PAD + x * STEP;
  const Y = (y: number) => PAD + 10 + y * STEP;

  const wrap = document.createElement("div");
  wrap.className = "pctree";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "pctree-svg");
  const W = PAD * 2 + t.width * STEP;
  const H = PAD * 2 + 10 + t.height * STEP;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Дерево прокачки");

  const info = document.createElement("div");
  info.className = "pctree-info";
  const describe = (n: TreeNode) => {
    let state: string;
    if (n.id === 0) state = "Стартовая точка — бери узлы рядом с ней.";
    else if (taken.has(n.id)) state = o.touch ? "Взято. Тапни ещё раз — снять вместе со всем, что от него оторвётся." : "Взято. Клик — снять вместе со всем, что от него оторвётся.";
    else if (!near(n.id)) state = "Сначала возьми соседний узел.";
    else if (o.unspent <= 0) state = "Нет свободных очков — их дают за уровень.";
    else state = o.touch ? "Тапни ещё раз — взять за 1 очко." : "Клик — взять за 1 очко.";
    info.replaceChildren();
    const b = document.createElement("b");
    b.textContent = n.name;
    const k = document.createElement("div");
    k.className = "k";
    k.textContent = n.id === 0 ? "старт" : `${n.lane} → ${n.theme} · ${KIND_RU[n.kind]}`;
    const d = document.createElement("div");
    d.textContent = n.desc;
    const s = document.createElement("div");
    s.className = "k";
    s.textContent = n.active ? state : `${state} Пока не действует в бою — механика появится позже.`;
    info.append(b, k, d, s);
  };

  for (const l of t.laneTitles) {
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("class", "lane");
    tx.setAttribute("x", String(X(l.x)));
    tx.setAttribute("y", "14");
    tx.textContent = l.title;
    svg.append(tx);
  }
  for (const e of t.edges) {
    const a = t.nodes[e.a], b = t.nodes[e.b];
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(X(a.x))); line.setAttribute("y1", String(Y(a.y)));
    line.setAttribute("x2", String(X(b.x))); line.setAttribute("y2", String(Y(b.y)));
    const on = isOn(e.a) && isOn(e.b);
    line.setAttribute("class", "edge" + (e.bridge ? " bridge" : "") + (on ? " on" : ""));
    if (on && !e.bridge) line.style.stroke = color(b);
    svg.append(line);
  }
  for (const n of t.nodes) {
    const on = isOn(n.id);
    const fr = free(n.id);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", ["node", n.kind, on ? "on" : fr ? "free" : near(n.id) ? "" : "locked", n.active ? "" : "soon", o.touch && touchSel === n.id ? "sel" : ""].filter(Boolean).join(" "));
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${n.name}: ${n.desc}`);
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(X(n.x))); c.setAttribute("cy", String(Y(n.y)));
    c.setAttribute("r", n.kind === "root" ? "13" : n.kind === "key" ? "12" : "10");
    if (on) { c.style.fill = color(n); c.style.stroke = color(n); }
    else if (fr) c.style.stroke = color(n);
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", String(X(n.x))); tx.setAttribute("y", String(Y(n.y)));
    tx.textContent = n.kind === "root" ? "" : n.kind === "attr" ? n.name.split(" ")[1]?.[0] ?? "" : n.kind === "skill" ? "★" : n.kind === "key" ? "◆" : "+";
    if (fr && !on) tx.style.fill = color(n);
    g.append(c, tx);
    const pickIt = () => {
      if (n.id === 0) return;
      // Телефон: наведения нет — первый тап выбирает и показывает описание, второй действует.
      if (o.touch && touchSel !== n.id) {
        svg.querySelector(".node.sel")?.classList.remove("sel");
        g.classList.add("sel");
        touchSel = n.id;
        describe(n);
        return;
      }
      if (taken.has(n.id)) o.act(n.id, false);
      else if (fr) o.act(n.id, true);
      else describe(n);
    };
    g.addEventListener("click", pickIt);
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pickIt(); } });
    g.addEventListener("mouseenter", () => describe(n));
    g.addEventListener("focus", () => describe(n));
    svg.append(g);
  }
  describe(o.touch && touchSel > 0 && t.nodes[touchSel] ? t.nodes[touchSel] : t.nodes[0]);
  wrap.append(svg, info, summary(t.nodes, taken));
  return wrap;
}

/** Итого от дерева: ключевые узлы и сложенные одинаковые бонусы («+4% урона» ×2 → «+8% урона»). */
function summary(nodes: TreeNode[], taken: Set<number>): HTMLElement {
  const el = document.createElement("div");
  el.className = "pctree-sum";
  const groups = new Map<string, { kind: string; name: string; pre: string; post: string; val: number; text: string; active: boolean }>();
  for (const id of taken) {
    const n = nodes[id];
    if (!n || n.kind === "attr") continue;
    const m = n.desc.match(/^([^\d]*)(\d+(?:,\d+)?)(.*)$/);
    const key = n.kind === "key" || !m ? n.name + n.desc : `${n.name.replace(/ I+$/, "")}#${m[1]}#${m[3]}`;
    const g = groups.get(key) ?? { kind: n.kind, name: n.name.replace(/ I+$/, ""), pre: m?.[1] ?? "", post: m?.[3] ?? "", val: 0, text: n.desc, active: n.active };
    if (m) g.val += parseFloat(m[2].replace(",", "."));
    groups.set(key, g);
  }
  if (!groups.size) {
    el.textContent = "Бонусы взятых узлов появятся здесь.";
    return el;
  }
  const order: Record<string, number> = { key: 0, skill: 1, small: 2 };
  for (const g of [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind])) {
    const row = document.createElement("div");
    if (g.kind === "key") row.className = "k";
    const v = (Math.round(g.val * 10) / 10).toString().replace(".", ",");
    row.textContent = (g.kind === "key" ? `◆ ${g.name}: ${g.text}` : `${g.name}: ${g.pre}${v}${g.post}`) + (g.active ? "" : " (пока не действует)");
    el.append(row);
  }
  return el;
}
