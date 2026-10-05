import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/torusBuilder";

import { BOSS_CFG, SLIME_CFG, SPITTER_CFG } from "#shared/mobs";
import { MOB, SHARD_CFG } from "#shared/mobs";
import type { MobState, PlayerState, ZoneState } from "#shared/net/schema";
import { difficultyCss } from "./difficulty";
import type { NetMobs } from "../combat/MobSystem";
import type { MouseClick } from "../input/DesktopInput";

/** Два клика ЛКМ по одному мобу чаще этого (мс) — начать атаку. */
const DOUBLE_CLICK_MS = 450;
/** Tab выбирает мобов не дальше, м. */
const TAB_RANGE = 40;
/** Клик ловит моба в пределах стольких пикселей от его проекции (плюс видимый размер тела). */
const PICK_PX = 26;

export interface PcTargetSeg {
  a: Vector3;
  b: Vector3;
  radius: number;
}

/**
 * Выбор цели на ПК «как в WoW»: клик по мобу / Tab — цель, Esc — снять.
 * Под целью — красное кольцо, сверху по центру — рамка цели (имя, уровень,
 * здоровье). Автоатака (клавиша 1 или ПКМ по мобу) включается здесь, а бьёт
 * по цели CombatSystem (pcTarget / pcAttack).
 *
 * Мобов берём прямо из состояния комнаты — вид моба (NetMobs) рядом может
 * ещё не быть создан (ленивая подгрузка), а цель должна выбираться и издалека.
 */
export class PcTargeting {
  targetId: string | null = null;
  autoAttack = false;
  /** Игрок сам начал атаку (1, двойной клик, ПКМ, клик по рамке цели) — Game ведёт героя к цели. */
  onAttackStart: (() => void) | null = null;
  // --- игроки в цель (id цели = "@" + sessionId) ---
  /** Свой sessionId — себя не выбираем. */
  selfId: () => string | undefined = () => undefined;
  /** Отрезок тела игрока (его RemoteAvatar), если модель рядом. */
  playerSeg: (sessionId: string) => PcTargetSeg | null = () => null;
  /** Можно ли атаковать игрока (PvP у обоих). null — можно, иначе причина. */
  canAttackPlayer: (sessionId: string) => string | null = () => null;
  /** Уровень героя — цвет уровня цели по опасности. */
  heroLevel: () => number = () => 1;
  onError: ((text: string) => void) | null = null;
  private readonly ring: Mesh;
  private readonly frame: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly _vp = Matrix.Identity();
  private tabOrder: string[] = [];
  private lastSig = "";

  constructor(
    private readonly scene: Scene,
    private readonly state: () => ZoneState | null,
    private readonly netMobs: NetMobs,
  ) {
    const mat = new StandardMaterial("pcTargetRingMat", scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(1, 0.18, 0.12);
    mat.alpha = 0.85;
    mat.backFaceCulling = false;
    this.ring = MeshBuilder.CreateTorus("pcTargetRing", { diameter: 1, thickness: 0.06, tessellation: 40 }, scene);
    this.ring.material = mat;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);

    this.frame = document.createElement("div");
    this.frame.className = "pc-target";
    this.frame.innerHTML =
      `<div class="pc-target-name"></div><div class="pc-bar"><div class="pc-bar-fill"></div>` +
      `<div class="pc-bar-text"></div></div><div class="pc-target-hint"></div>`;
    this.nameEl = this.frame.querySelector(".pc-target-name")!;
    this.hpFill = this.frame.querySelector(".pc-bar-fill")!;
    this.hpText = this.frame.querySelector(".pc-bar-text")!;
    this.hintEl = this.frame.querySelector(".pc-target-hint")!;
    this.frame.style.display = "none";
    // Клик по рамке цели — как двойной клик по мобу: бежать и атаковать.
    this.frame.addEventListener("click", () => {
      if (!this.targetId) return;
      this.startAttack();
      this.lastSig = "";
    });
    document.body.appendChild(this.frame);
  }

  private mob(id: string | null): MobState | null {
    if (!id || id.startsWith("@")) return null;
    const m = this.state()?.mobs.get(id);
    return m && !m.dead ? m : null;
  }

  private player(id: string | null): PlayerState | null {
    if (!id || !id.startsWith("@")) return null;
    const p = this.state()?.players.get(id.slice(1));
    return p && !p.dead ? p : null;
  }

  private alive(id: string | null): boolean {
    return !!(this.mob(id) || this.player(id));
  }

  /** Включить автоатаку по цели (игрока — только при PvP у обоих). */
  private startAttack(): boolean {
    if (!this.targetId) return false;
    if (this.targetId.startsWith("@")) {
      const err = this.canAttackPlayer(this.targetId.slice(1));
      if (err) {
        this.autoAttack = false;
        this.onError?.(err);
        return false;
      }
    }
    this.autoAttack = true;
    this.onAttackStart?.();
    return true;
  }

  select(id: string | null): void {
    if (id === this.targetId) return;
    this.targetId = id;
    if (!id) this.autoAttack = false;
    this.lastSig = "";
  }

  /**
   * Телефон, кнопка атаки: ближайший живой моб в радиусе — цель и автоатака.
   * false — рядом никого (кнопка бьёт как обычно, перед собой).
   */
  attackNearest(x: number, z: number, range: number): boolean {
    const st = this.state();
    if (!st) return false;
    let best: string | null = null;
    let bd = range;
    st.mobs.forEach((m, id) => {
      if (m.dead || m.kind === "shard") return;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < bd) {
        bd = d;
        best = id;
      }
    });
    if (!best) return false;
    this.select(best);
    return this.startAttack();
  }

  /** Esc: снять цель. true — было что снимать (Esc не должен открыть меню). */
  clear(): boolean {
    if (!this.targetId) return false;
    this.select(null);
    return true;
  }

  /** Клавиша 1: автоатака по цели вкл/выкл (без цели — берём ближайшую впереди). */
  toggleAttack(camera: Camera): void {
    if (!this.alive(this.targetId)) this.tab(camera);
    if (!this.targetId) return;
    if (this.autoAttack) this.autoAttack = false;
    else this.startAttack();
  }

  private lastClickAt = 0;
  private lastClickId: string | null = null;

  /**
   * Клик без перетаскивания: ЛКМ — выбрать моба (или снять цель), двойной ЛКМ
   * по мобу или ПКМ — выбрать и атаковать.
   */
  handleClick(c: MouseClick, camera: Camera, canvas: HTMLCanvasElement): void {
    const id = this.pickAt(c.x, c.y, camera, canvas);
    if (c.button === 0) {
      const now = performance.now();
      // Двойной клик ИЛИ клик по уже выбранной цели — атаковать.
      const again = !!id && id === this.targetId && !this.autoAttack;
      const dbl = again || (!!id && id === this.lastClickId && now - this.lastClickAt < DOUBLE_CLICK_MS);
      this.lastClickAt = now;
      this.lastClickId = id;
      this.select(id);
      if (dbl) this.startAttack();
      return;
    }
    if (id) {
      this.select(id);
      this.startAttack();
    }
  }

  /** Tab: следующий живой моб впереди, по удалённости. */
  tab(camera: Camera): void {
    const st = this.state();
    if (!st) return;
    const cp = camera.globalPosition;
    const f = camera.getForwardRay(1).direction;
    const fl = Math.hypot(f.x, f.z) || 1;
    const list: { id: string; d: number }[] = [];
    st.mobs.forEach((m, id) => {
      if (m.dead || m.kind === "shard") return;
      const dx = m.x - cp.x;
      const dz = m.z - cp.z;
      const d = Math.hypot(dx, dz);
      if (d > TAB_RANGE + 8 || d < 0.1) return;
      if ((dx * f.x + dz * f.z) / (d * fl) < 0.35) return; // не сзади и не сбоку
      list.push({ id, d });
    });
    if (!list.length) return;
    list.sort((a, b) => a.d - b.d);
    const ids = list.map((e) => e.id);
    // Тот же набор — идём по кругу; новый — начинаем с ближайшего.
    const same = ids.length === this.tabOrder.length && ids.every((id) => this.tabOrder.includes(id));
    this.tabOrder = ids;
    const cur = same && this.targetId ? ids.indexOf(this.targetId) : -1;
    const keepAttack = this.autoAttack;
    this.select(ids[(cur + 1) % ids.length]);
    this.autoAttack = keepAttack && !!this.targetId;
  }

  /** Моб под курсором (или null) — Game решает, клик по мобу или по луту. */
  mobAt(x: number, y: number, camera: Camera, canvas: HTMLCanvasElement): string | null {
    return this.pickAt(x, y, camera, canvas);
  }

  /**
   * Точка мира под курсором: ближайшая к (x,y) из `points` в пределах `px`
   * пикселей (для лута на земле). -1 — ничего.
   */
  pointAt(x: number, y: number, camera: Camera, canvas: HTMLCanvasElement, points: Vector3[], px = 34): number {
    const eng = this.scene.getEngine();
    const rw = eng.getRenderWidth();
    const rh = eng.getRenderHeight();
    const rect = canvas.getBoundingClientRect();
    const sx = (x * rw) / Math.max(1, rect.width);
    const sy = (y * rh) / Math.max(1, rect.height);
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), this._vp);
    const vp = camera.viewport.toGlobal(rw, rh);
    const lim = px * (rh / Math.max(1, rect.height));
    let best = -1;
    let bestD = lim;
    points.forEach((p, i) => {
      const s = Vector3.Project(p, Matrix.IdentityReadOnly, this._vp, vp);
      if (s.z < 0 || s.z > 1) return;
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private pickAt(x: number, y: number, camera: Camera, canvas: HTMLCanvasElement): string | null {
    const st = this.state();
    if (!st) return null;
    const eng = this.scene.getEngine();
    const rw = eng.getRenderWidth();
    const rh = eng.getRenderHeight();
    const rect = canvas.getBoundingClientRect();
    const sx = (x * rw) / Math.max(1, rect.width);
    const sy = (y * rh) / Math.max(1, rect.height);
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), this._vp);
    const vp = camera.viewport.toGlobal(rw, rh);
    const fov = (camera as { fov?: number }).fov ?? 0.8;
    const cp = camera.globalPosition;
    let best: string | null = null;
    let bestScore = Infinity;
    const p = new Vector3();
    st.mobs.forEach((m, id) => {
      if (m.dead) return;
      const h = MOB.bodyRadius * (m.scale || 1);
      p.set(m.x, m.y + h, m.z);
      const s = Vector3.Project(p, Matrix.IdentityReadOnly, this._vp, vp);
      if (s.z < 0 || s.z > 1) return; // за камерой
      const dist = Vector3.Distance(p, cp);
      // Видимый радиус тела в пикселях — крупного моба можно ткнуть по краю.
      const bodyPx = (h * 1.3 * rh) / (2 * Math.tan(fov / 2) * Math.max(0.5, dist));
      const off = Math.hypot(s.x - sx, s.y - sy);
      const lim = PICK_PX * (rh / Math.max(1, rect.height)) + bodyPx;
      if (off > lim) return;
      const score = off / lim + dist * 0.002;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    });
    const self = this.selfId();
    st.players.forEach((pl, sid) => {
      if (pl.dead || sid === self) return;
      p.set(pl.head.x, pl.head.y - 0.7, pl.head.z);
      const s = Vector3.Project(p, Matrix.IdentityReadOnly, this._vp, vp);
      if (s.z < 0 || s.z > 1) return;
      const dist = Vector3.Distance(p, cp);
      const bodyPx = (1.0 * rh) / (2 * Math.tan(fov / 2) * Math.max(0.5, dist));
      const off = Math.hypot(s.x - sx, s.y - sy);
      const lim = PICK_PX * (rh / Math.max(1, rect.height)) + bodyPx;
      if (off > lim) return;
      const score = off / lim + dist * 0.002;
      if (score < bestScore) {
        bestScore = score;
        best = `@${sid}`;
      }
    });
    return best;
  }

  /** Отрезок тела цели для боя; null — цели нет (умерла/пропала — снимаем). */
  segment(): PcTargetSeg | null {
    const pl = this.player(this.targetId);
    if (pl) {
      const sid = this.targetId!.slice(1);
      return (
        this.playerSeg(sid) ?? {
          a: new Vector3(pl.head.x, pl.head.y - 1.6, pl.head.z),
          b: new Vector3(pl.head.x, pl.head.y - 0.1, pl.head.z),
          radius: 0.4,
        }
      );
    }
    const m = this.mob(this.targetId);
    if (!m) {
      if (this.targetId) this.select(null);
      return null;
    }
    const view = this.netMobs.getMob(this.targetId!);
    if (view && view.alive) return view.hitSegment();
    const sc = m.scale || 1;
    return {
      a: new Vector3(m.x, m.y + 0.1, m.z),
      b: new Vector3(m.x, m.y + MOB.bodyRadius * 2 * sc, m.z),
      radius: MOB.hitRadius * sc,
    };
  }

  /** Каждый кадр: кольцо под целью и рамка цели. */
  update(outOfRange: boolean): void {
    const pl = this.player(this.targetId);
    if (pl) {
      this.ring.setEnabled(true);
      this.ring.position.set(pl.head.x, pl.head.y - 1.64, pl.head.z);
      this.ring.scaling.set(1.2, 1, 1.2);
      const sid = this.targetId!.slice(1);
      const bot = sid.startsWith("bot:");
      const sig = `${this.targetId}|${Math.ceil(pl.hp)}|${pl.maxHp}|${outOfRange ? 1 : 0}|${this.autoAttack ? 1 : 0}|${pl.pvp}`;
      if (sig === this.lastSig) return;
      this.lastSig = sig;
      this.frame.style.display = "";
      this.nameEl.textContent = `${pl.nick} · ${pl.level} · ${bot ? "бот" : "игрок"}${pl.pvp ? " · PvP" : ""}`;
      this.nameEl.style.color = pl.pvp ? "#ff9a8e" : "#9fd0ff";
      this.frame.classList.toggle("attacking", this.autoAttack);
      const frac = pl.maxHp > 0 ? Math.max(0, Math.min(1, pl.hp / pl.maxHp)) : 0;
      this.hpFill.style.width = `${(frac * 100).toFixed(1)}%`;
      this.hpText.textContent = `${fmt(Math.ceil(pl.hp))} / ${fmt(Math.ceil(pl.maxHp))}`;
      this.hintEl.textContent = this.autoAttack && outOfRange ? "Слишком далеко" : "";
      return;
    }
    const m = this.mob(this.targetId);
    if (!m) {
      if (this.targetId) this.select(null);
      this.ring.setEnabled(false);
      if (this.frame.style.display !== "none") this.frame.style.display = "none";
      return;
    }
    const sc = m.scale || 1;
    this.ring.setEnabled(true);
    this.ring.position.set(m.x, m.y + 0.06, m.z);
    const d = Math.max(1.1, MOB.hitRadius * sc * 2.6);
    this.ring.scaling.set(d, 1, d);
    const name = m.mobName || cfgOf(m.kind).name;
    const lvl = m.kind === "boss" ? "??" : String(m.mobLevel || cfgOf(m.kind).level);
    const elite = !!m.mobName && m.kind !== "boss";
    const hero = this.heroLevel();
    const sig = `${this.targetId}|${Math.ceil(m.hp)}|${m.maxHp}|${outOfRange ? 1 : 0}|${this.autoAttack ? 1 : 0}|${hero}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.frame.style.display = "";
    this.nameEl.textContent = `${name} · ${lvl}${elite ? " · элита" : ""}`;
    this.nameEl.style.color = m.kind === "boss" ? "#ff5a4a" : difficultyCss(m.mobLevel || cfgOf(m.kind).level, hero);
    this.frame.classList.toggle("attacking", this.autoAttack);
    const frac = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
    this.hpFill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.hpText.textContent = `${fmt(Math.ceil(m.hp))} / ${fmt(Math.ceil(m.maxHp))}`;
    this.hintEl.textContent = this.autoAttack && outOfRange ? "Слишком далеко" : "";
  }

  dispose(): void {
    this.ring.dispose();
    this.frame.remove();
  }
}

function cfgOf(kind: string): { name: string; level: number } {
  if (kind === "spitter") return SPITTER_CFG;
  if (kind === "boss") return BOSS_CFG;
  if (kind === "shard") return SHARD_CFG;
  return SLIME_CFG;
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}
