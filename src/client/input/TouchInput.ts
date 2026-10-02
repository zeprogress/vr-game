import { skillIcon, type IconKey } from "#shared/icons";
import { iconHtml } from "../ui/icons";
import { LOOK } from "#shared/constants";
import { emptyInput, type InputSource, type InputState } from "./InputSource";

/** Метры зума на пиксель изменения расстояния между пальцами. */
const ZOOM_PER_PX = 0.012;
/**
 * Прицел кнопкой ⚔: у центра кнопки — обычное перетаскивание, дальше плавно
 * (квадратично) добавляется инерция панорамы.
 */
const AIM_DEADZONE_PX = 25;
const AIM_SPAN_PX = 44; // за столько пикселей от края мёртвой зоны — полная скорость
const AIM_YAW_RATE = 0.9; // рад/с на полном отклонении (было 1.4 — просили помедленнее)

/**
 * Тач-управление для телефона: левый джойстик — движение, перетаскивание
 * по правой половине экрана — осмотр, кнопки справа снизу — действия.
 * Строит собственный DOM-оверлей поверх canvas.
 */
export class TouchInput implements InputSource {
  private readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly btnAttack: HTMLDivElement;
  private readonly btnInteract: HTMLDivElement;
  private readonly btnFire: HTMLDivElement;
  private readonly fireFill: HTMLDivElement;
  private readonly btnAbility: HTMLDivElement;
  private readonly btnAbility2: HTMLDivElement;
  private readonly ability2Cd: HTMLDivElement;
  private ability2Tap = false;
  /** Второе умение: прицел пальцем (град) — хук Game; true — нажатие забрано. */
  ability2Hook: (() => boolean) | null = null;
  private readonly abilityCd: HTMLDivElement;

  private moveX = 0;
  private moveY = 0;
  private accYaw = 0;
  private accPitch = 0;
  private accZoom = 0;
  /** Короткий тап по экрану (не поворот камеры) — выбор цели / NPC / предмета, как клик на ПК. */
  private tapQueue: { x: number; y: number } | null = null;
  private tapStart = new Map<number, { x: number; y: number; t: number; moved: number }>();

  /** Забрать тап (экранные координаты), если был. */
  /** Кнопка атаки не бьёт (ставит Game: рядом NPC, рыбалка). */
  attackBlocked = false;
  /** Кнопка умения: true — Game забрал нажатие себе (напр. прицел града стрел). */
  abilityHook: (() => boolean) | null = null;
  /** Прицел умения по земле: палец на экране двигает круг, а не камеру. */
  groundAim = false;
  /** Где палец (экранные координаты) — для прицела по земле. */
  aimXY: { x: number; y: number } | null = null;

  /** Нажатие кнопки атаки (фронт) — Game пробует навестись на ближайшего, как на ПК. */
  private attackTap = false;
  takeAttackTap(): boolean {
    const t = this.attackTap;
    this.attackTap = false;
    return t;
  }

  takeTap(): { x: number; y: number } | null {
    const t = this.tapQueue;
    this.tapQueue = null;
    return t;
  }
  private attack = false;
  private interactBtn = false;
  /** Фронт тапа по кнопке умения — читается один раз в sample(). */
  private abilityTap = false;
  /** Кнопка «выстрел» у джойстика — жива только в прицеле. */
  private fireBtn = false;

  /**
   * Прицеливание: пока держишь кнопку удара, её перетаскивание крутит
   * взгляд. Ставит Game через setAiming().
   */
  private aimMode = false;
  private atkPointer: number | null = null;
  private atkLast = { x: 0, y: 0 };
  /** Центр кнопки удара и текущее положение пальца — для инерции панорамы. */
  private atkCenter = { x: 0, y: 0 };
  private atkPos = { x: 0, y: 0 };
  private atkKnob: HTMLDivElement | null = null;
  private lastSample = 0;

  /** id активного пальца на джойстике. */
  private movePointer: number | null = null;
  /** Пальцы на зоне осмотра: 1 — крутим обзор, 2 — щипок-зум. */
  private readonly lookPts = new Map<number, { x: number; y: number }>();
  private pinchLen: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private readonly stickRadius = 55;

  constructor() {
    this.root = document.createElement("div");
    this.root.innerHTML = STYLE;
    this.root.className = "touch-ui";

    const lookZone = el("div", "touch-look");
    const stick = el("div", "touch-stick");
    this.knob = el("div", "touch-knob");
    stick.appendChild(this.knob);

    // Значки кнопок — из общего реестра (shared/icons.ts).
    const btnAttack = iconBtn("touch-btn touch-attack", "w.sword");
    const btnInteract = iconBtn("touch-btn touch-interact", "ui.grab");
    const btnFire = iconBtn("touch-btn touch-fire", "ui.fire");
    btnFire.style.display = "none"; // видна только в прицеле
    this.fireFill = el("div", "touch-fire-fill");
    btnFire.appendChild(this.fireFill);
    const btnAbility = iconBtn("touch-btn touch-ability", "ui.noSkill");
    this.abilityCd = el("div", "touch-ability-cd");
    btnAbility.appendChild(this.abilityCd);
    this.btnAbility = btnAbility;
    const btnAbility2 = iconBtn("touch-btn touch-ability touch-ability2", "ui.noSkill");
    this.ability2Cd = el("div", "touch-ability-cd");
    btnAbility2.appendChild(this.ability2Cd);
    this.btnAbility2 = btnAbility2;
    this.btnAttack = btnAttack;
    this.btnInteract = btnInteract;
    this.btnFire = btnFire;
    // Точка внутри кнопки удара — куда сдвинут палец в режиме прицела.
    this.atkKnob = el("div", "touch-atk-knob");
    this.atkKnob.hidden = true;
    btnAttack.appendChild(this.atkKnob);

    this.root.append(lookZone, stick, btnAttack, btnInteract, btnFire, btnAbility, btnAbility2);
    document.body.appendChild(this.root);

    // --- Осмотр / зум: перетаскивание и щипок по правой зоне ---
    const pinchDist = (): number => {
      const [a, b] = [...this.lookPts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    lookZone.addEventListener("pointerdown", (e) => {
      this.tapStart.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
      if (this.groundAim) this.aimXY = { x: e.clientX, y: e.clientY };
      if (this.lookPts.size >= 2) return;
      this.lookPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        lookZone.setPointerCapture(e.pointerId);
      } catch {
        /* палец уже ушёл — не критично */
      }
      if (this.lookPts.size === 2) this.pinchLen = pinchDist();
    });
    lookZone.addEventListener("pointermove", (e) => {
      const pt = this.lookPts.get(e.pointerId);
      if (!pt) return;
      const dx = e.clientX - pt.x;
      const dy = e.clientY - pt.y;
      const ts = this.tapStart.get(e.pointerId);
      if (ts) ts.moved += Math.abs(dx) + Math.abs(dy);
      if (this.groundAim) {
        // Прицел: палец ведёт круг по земле, камера стоит.
        this.aimXY = { x: e.clientX, y: e.clientY };
        pt.x = e.clientX;
        pt.y = e.clientY;
        return;
      }
      pt.x = e.clientX;
      pt.y = e.clientY;
      if (this.lookPts.size >= 2) {
        // Щипок: пальцы врозь — приближаем (dist меньше), вместе — отдаляем.
        const len = pinchDist();
        if (this.pinchLen !== null) this.accZoom += (this.pinchLen - len) * ZOOM_PER_PX;
        this.pinchLen = len;
      } else {
        this.accYaw += dx * LOOK.touchSensitivity;
        this.accPitch += dy * LOOK.touchSensitivity;
      }
    });
    const endLook = (e: PointerEvent): void => {
      const ts = this.tapStart.get(e.pointerId);
      this.tapStart.delete(e.pointerId);
      // Тап: палец почти не двигался, недолго и один — это «клик», а не поворот камеры.
      // В прицеле умения любой отпуск пальца — «применить сюда».
      if (e.type === "pointerup" && ts && (this.groundAim || (ts.moved < 14 && performance.now() - ts.t < 350)) && this.lookPts.size <= 1) {
        this.tapQueue = { x: e.clientX, y: e.clientY };
      }
      if (!this.lookPts.delete(e.pointerId)) return;
      if (this.lookPts.size < 2) this.pinchLen = null;
    };
    lookZone.addEventListener("pointerup", endLook);
    lookZone.addEventListener("pointercancel", endLook);

    // --- Джойстик движения ---
    stick.addEventListener("pointerdown", (e) => {
      this.movePointer = e.pointerId;
      const r = stick.getBoundingClientRect();
      this.moveOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stick.setPointerCapture(e.pointerId);
      this.updateStick(e.clientX, e.clientY);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.movePointer) this.updateStick(e.clientX, e.clientY);
    });
    const endMove = (e: PointerEvent): void => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = null;
      this.moveX = 0;
      this.moveY = 0;
      this.knob.style.transform = "translate(0px, 0px)";
    };
    stick.addEventListener("pointerup", endMove);
    stick.addEventListener("pointercancel", endMove);

    // --- Кнопки ---
    hold(btnInteract, (v) => (this.interactBtn = v));
    hold(btnFire, (v) => (this.fireBtn = v));
    btnAbility.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // Град стрел: вместо мгновенного каста — прицел пальцем (Game ставит хук).
      if (this.abilityHook?.()) return;
      this.abilityTap = true;
    });
    btnAbility2.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.ability2Hook?.()) return;
      this.ability2Tap = true;
    });

    // Кнопка удара: держишь — атака; в режиме прицела её перетаскивание
    // крутит взгляд, отпускаешь — выстрел.
    btnAttack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.attackTap = true;
      this.atkPointer = e.pointerId;
      this.atkLast = { x: e.clientX, y: e.clientY };
      this.atkPos = { x: e.clientX, y: e.clientY };
      const r = btnAttack.getBoundingClientRect();
      this.atkCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.attack = true;
      this.applyAtkKnob();
      try {
        btnAttack.setPointerCapture(e.pointerId);
      } catch {
        /* палец уже ушёл */
      }
    });
    btnAttack.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.atkPointer) return;
      this.atkPos = { x: e.clientX, y: e.clientY };
      if (this.aimMode) {
        // Перетаскивание работает всегда (в т.ч. в мёртвой зоне) — и по
        // вертикали (наклон), и по горизонтали (точная доводка). За мёртвой
        // зоной к горизонтали добавляется инерция (см. sample()).
        this.accYaw += (e.clientX - this.atkLast.x) * LOOK.touchSensitivity;
        this.accPitch += (e.clientY - this.atkLast.y) * LOOK.touchSensitivity;
        this.applyAtkKnob();
      }
      this.atkLast = { x: e.clientX, y: e.clientY };
    });
    const endAtk = (e: PointerEvent): void => {
      if (e.pointerId !== this.atkPointer) return;
      this.atkPointer = null;
      this.attack = false;
      this.applyAtkKnob();
    };
    btnAttack.addEventListener("pointerup", endAtk);
    btnAttack.addEventListener("pointercancel", endAtk);
  }

  /** Точка внутри кнопки удара — куда сдвинут палец (только в прицеле). */
  private applyAtkKnob(): void {
    const k = this.atkKnob;
    if (!k) return;
    const show = this.aimMode && this.atkPointer !== null;
    k.hidden = !show;
    if (!show) return;
    const dx = Math.max(-34, Math.min(34, this.atkPos.x - this.atkCenter.x));
    const dy = Math.max(-34, Math.min(34, this.atkPos.y - this.atkCenter.y));
    k.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Game: вход/выход из прицела (лук/посох). Прячет ✋, ⚔ становится наводкой. */
  setAiming(on: boolean): void {
    if (on === this.aimMode) return;
    this.aimMode = on;
    this.btnInteract.style.display = on ? "none" : "";
    this.btnFire.style.display = on ? "" : "none";
    if (!on) {
      this.fireBtn = false;
      this.setFireCharge(0);
    }
    this.btnAttack.classList.toggle("touch-aiming", on);
    this.applyAtkKnob();
  }

  /**
   * Game: остаток кулдауна умения 0..1 (1 — только применили, 0 — готово).
   * Отрицательное значение — умения нет (нет меча/лука), кнопку прячем.
   */
  setSkillCd(frac: number, slot = 0, icon?: string): void {
    const btn = slot === 0 ? this.btnAbility : this.btnAbility2;
    const cd = slot === 0 ? this.abilityCd : this.ability2Cd;
    if (frac < 0) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "";
    // icon — id умения: значок из общего реестра (shared/icons.ts), как на ПК и в VR.
    if (icon && btn.dataset.icon !== icon) {
      btn.dataset.icon = icon;
      (btn.firstChild as HTMLElement).innerHTML = iconHtml(skillIcon(icon));
    }
    const k = Math.max(0, Math.min(1, frac));
    cd.style.transform = `scaleY(${k})`;
    btn.style.opacity = k > 0.01 ? "0.5" : "1";
  }

  /** Game: уровень накопленного заряда 0..1 — визуально заливает кнопку ➤. */
  setFireCharge(t: number): void {
    const k = Math.max(0, Math.min(1, t));
    this.fireFill.style.transform = `scale(${k})`;
    this.fireFill.style.opacity = k > 0.02 ? "1" : "0";
  }

  private updateStick(px: number, py: number): void {
    let dx = px - this.moveOrigin.x;
    let dy = py - this.moveOrigin.y;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, this.stickRadius);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.moveX = dx / this.stickRadius;
    this.moveY = -dy / this.stickRadius; // экран вниз = назад
  }

  sample(): InputState {
    const now = performance.now();
    const dt = this.lastSample ? Math.min(0.05, (now - this.lastSample) / 1000) : 0;
    this.lastSample = now;

    // Прицел: перетаскивание (см. pointermove) + плавная инерция панорамы за
    // мёртвой зоной — палец у центра кнопки, прицел стоит; дальше крутит.
    if (this.aimMode && this.atkPointer !== null && dt > 0) {
      const dx = this.atkPos.x - this.atkCenter.x;
      const off = Math.abs(dx) - AIM_DEADZONE_PX;
      if (off > 0) {
        const m = Math.min(1, off / AIM_SPAN_PX);
        this.accYaw += Math.sign(dx) * m * m * AIM_YAW_RATE * dt;
      }
    }

    const s = emptyInput();
    s.moveX = this.moveX;
    s.moveY = this.moveY;
    s.lookYaw = this.accYaw;
    s.lookPitch = this.accPitch;
    s.zoom = this.accZoom;
    // Рядом NPC/доска (или идёт рыбалка) — кнопка атаки не бьёт, а открывает окно / подсекает.
    s.primaryAction = this.attack && !this.attackBlocked;
    s.altFire = this.fireBtn;
    s.interact = this.interactBtn;
    s.ability = this.abilityTap;
    this.abilityTap = false;
    s.ability2 = this.ability2Tap;
    this.ability2Tap = false;

    this.accYaw = 0;
    this.accPitch = 0;
    this.accZoom = 0;
    return s;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Кнопка со значком из реестра: первый ребёнок — <span> со значком (его меняет setSkillCd). */
function iconBtn(className: string, k: IconKey): HTMLDivElement {
  const d = el("div", className);
  const ico = document.createElement("span");
  ico.className = "touch-ico";
  ico.innerHTML = iconHtml(k);
  d.appendChild(ico);
  return d;
}

function el(tag: string, className: string, text = ""): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.className = className;
  if (text) d.textContent = text;
  return d;
}

function hold(node: HTMLElement, set: (v: boolean) => void): void {
  node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      /* палец уже ушёл */
    }
    set(true);
  });
  const off = (): void => set(false);
  node.addEventListener("pointerup", off);
  node.addEventListener("pointercancel", off);
}

const STYLE = `<style>
.touch-ui { position: fixed; inset: 0; z-index: 10; touch-action: none;
  font: 22px system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
.touch-ui > * { position: absolute; }
/* Осмотр и щипок-зум — по всему экрану (стик и кнопки лежат поверх). */
.touch-look { inset: 0; }
.touch-stick { left: 40px; bottom: 22px; width: 130px; height: 130px;
  border-radius: 50%; background: rgba(255,255,255,0.12);
  border: 2px solid rgba(255,255,255,0.25); }
.touch-knob { position: absolute; left: 40px; top: 40px; width: 50px; height: 50px;
  border-radius: 50%; background: rgba(255,255,255,0.5); }
.touch-btn { right: 40px; width: 76px; height: 76px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3);
  color: #fff; }
.touch-attack   { right: 34px; bottom: 28px; width: 96px; height: 96px; font-size: 30px; }
.touch-interact { display: none !important; } /* ✋ больше не нужна: подбор — тапом/подходом, NPC — тапом */
/* Кнопка умения — слева от большой кнопки удара. */
.touch-ability { right: 150px; bottom: 18px; width: 66px; height: 66px; font-size: 26px;
  background: rgba(120,90,220,0.4); border-color: rgba(190,160,255,0.7); overflow: hidden; }
/* Второе умение — над первым. */
.touch-ability2 { right: 150px; bottom: 96px; }
.touch-ability-cd { position: absolute; left: 0; bottom: 0; width: 100%; height: 100%;
  background: rgba(20,10,40,0.55); transform-origin: bottom; transform: scaleY(0);
  pointer-events: none; }
/* Кнопка «выстрел» в прицеле — над джойстиком движения, для левого пальца. */
.touch-fire { left: 48px; bottom: 176px; width: 82px; height: 82px; font-size: 30px;
  background: rgba(230,120,60,0.42); border-color: rgba(255,190,140,0.75);
  overflow: hidden; }
/* Заливка накопления заряда — растёт из центра при удержании. */
.touch-fire-fill { position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  border-radius: 50%; background: radial-gradient(circle, rgba(120,200,255,0.9) 0%,
  rgba(90,160,255,0.55) 70%, rgba(90,160,255,0) 100%); transform: scale(0); opacity: 0;
  transition: opacity 0.08s linear; pointer-events: none; }
.touch-btn.touch-aiming { background: rgba(230,120,60,0.4);
  border-color: rgba(255,190,140,0.7); }
.touch-atk-knob { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px;
  margin: -11px 0 0 -11px; border-radius: 50%; background: rgba(255,255,255,0.85);
  box-shadow: 0 0 6px rgba(0,0,0,0.4); pointer-events: none; }
</style>`;
