import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { buildFishRod } from "../entities/RemoteAvatar";

import type { PlayerController } from "../player/PlayerController";
import type { CombatSystem } from "../combat/CombatSystem";
import type { NetClient } from "../net/NetClient";
import { LAKE } from "#shared/constants";
import { lakeEllipseDist, LAKE_R_AVG } from "#shared/terrain";

/**
 * Рыбалка: у воды E — выбор режима (ПК/телефон):
 *  - «Авторыбалка» — герой ловит сам, ~1 мин на рыбу, улов считает сервер;
 *  - «Вручную» — быстрее: поклёвка через 10–18 с, потом мини-игра —
 *    трижды нажать E, когда метка в зелёной зоне.
 * Рыбачит, пока не нажмёшь E снова / не отойдёшь / не сменишь оружие.
 * Время поклёвки присылает сервер (MSG.fishWait) — он же решает, поймал ли.
 * В VR (нет DOM) — сразу ручной режим, мини-игра — одно нажатие на поклёвку.
 */
export interface Fishing {
  update(dt: number): void;
  /** Смотать удочку (переодевание, смерть, бой…). */
  cancel(): void;
  readonly active: boolean;
}

type Phase = "idle" | "choosing" | "waiting" | "mini";
type Mode = "auto" | "manual";

const HITS_NEED = 3;
const MINI_TIME = 8;

export function createFishing(
  scene: Scene,
  player: PlayerController,
  combat: CombatSystem,
  net: NetClient,
  onPrompt: (text: string) => void,
  /** Есть экранный интерфейс (ПК/телефон, не в шлеме) — выбор режима и мини-игра. */
  flatUiNow: () => boolean,
): Fishing {
  const flatUi = true; // DOM создаём всегда; в VR он просто не используется
  let phase: Phase = "idle";
  let mode: Mode = "manual";
  let timer = 0;
  let prevInteract = false;
  let rod: Mesh | null = null;
  let castX = 0;
  let castZ = 0;
  // Мини-игра.
  let miniT = 0;
  let hits = 0;
  let markT = 0;
  let zoneC = 0.5;
  const ZONE_W = 0.2;

  const isNearShore = (x: number, z: number): boolean => {
    const ld = lakeEllipseDist(x, z);
    const shoreOuter = LAKE_R_AVG + LAKE.shoreFade;
    // Широкая полоса: и на мелководье, и в паре шагов от кромки (как на сервере, с запасом внутрь).
    return ld > shoreOuter - 16 && ld < shoreOuter + 11;
  };

  const showRod = (): void => {
    if (!rod) {
      rod = buildFishRod(scene, "fishRodLocal", combat.getHandAnchor("right"), {
        pos: [0, 0, 0.02],
        rot: [-0.6, 0, 0],
      });
    }
    rod.setEnabled(true);
  };
  const hideRod = (): void => rod?.setEnabled(false);

  // ---- DOM: выбор режима и мини-игра ----
  let ui: HTMLDivElement | null = null;
  let bar: HTMLDivElement | null = null;
  let zoneEl: HTMLDivElement | null = null;
  let markEl: HTMLDivElement | null = null;
  let miniLabel: HTMLDivElement | null = null;
  if (flatUi) {
    const st = document.createElement("style");
    st.textContent = `
.fish-ui { position:fixed; left:50%; bottom:130px; transform:translateX(-50%); z-index:40; background:rgba(14,13,19,.9);
  border-radius:10px; padding:10px 12px; color:#e6e0d0; font:600 13px system-ui; text-align:center; display:none; }
.fish-ui button { margin:6px 4px 0; padding:8px 12px; border-radius:7px; border:1px solid #3a3e48; background:#23222b;
  color:#e6e0d0; font:600 13px system-ui; cursor:pointer; }
.fish-ui button:hover { border-color:#6e7482; }
.fish-ui small { display:block; font-weight:500; color:#a9a498; font-size:11.5px; }
.fish-bar { position:relative; width:260px; height:16px; margin:8px auto 2px; background:#2c2b35; border-radius:8px; overflow:hidden; cursor:pointer; }
.fish-zone { position:absolute; top:0; bottom:0; background:#3f8f4a; }
.fish-mark { position:absolute; top:-2px; width:4px; height:20px; margin-left:-2px; background:#f1ead6; box-shadow:0 0 6px #fff; }`;
    document.head.appendChild(st);
    ui = document.createElement("div");
    ui.className = "fish-ui";
    document.body.appendChild(ui);
  }
  let useUi = true;
  let wasNear = false;
  const hideUi = (): void => {
    if (ui) ui.style.display = "none";
  };

  const showChooser = (): void => {
    if (!ui) return;
    ui.innerHTML = "";
    ui.append("Рыбалка");
    const b1 = document.createElement("button");
    b1.innerHTML = "Авторыбалка<small>~1 мин на рыбу, сам</small>";
    b1.onclick = () => start("auto");
    const b2 = document.createElement("button");
    b2.innerHTML = "Вручную<small>быстрее, мини-игра</small>";
    b2.onclick = () => start("manual");
    const b3 = document.createElement("button");
    b3.textContent = "✕";
    b3.onclick = () => {
      phase = "idle";
      hideUi();
    };
    ui.append(document.createElement("br"), b1, b2, b3);
    ui.style.display = "block";
  };

  const showMini = (): void => {
    hits = 0;
    miniT = MINI_TIME;
    markT = Math.random() * 6;
    zoneC = 0.2 + Math.random() * 0.6;
    if (!ui || !useUi) {
      onPrompt("Клюёт! Жми E");
      return;
    }
    ui.innerHTML = "";
    miniLabel = document.createElement("div");
    bar = document.createElement("div");
    bar.className = "fish-bar";
    zoneEl = document.createElement("div");
    zoneEl.className = "fish-zone";
    markEl = document.createElement("div");
    markEl.className = "fish-mark";
    bar.append(zoneEl, markEl);
    bar.onpointerdown = () => tryHit();
    ui.append(miniLabel, bar);
    ui.style.display = "block";
    renderMini();
  };

  const markPos = (): number => 0.5 + 0.5 * Math.sin(markT * 2.6);

  const renderMini = (): void => {
    if (!zoneEl || !markEl || !miniLabel) return;
    zoneEl.style.left = `${(zoneC - ZONE_W / 2) * 100}%`;
    zoneEl.style.width = `${ZONE_W * 100}%`;
    markEl.style.left = `${markPos() * 100}%`;
    miniLabel.textContent = `Клюёт! Подсекай — E, когда метка в зелёном (${hits}/${HITS_NEED})`;
  };

  const tryHit = (): void => {
    if (phase !== "mini") return;
    if (!ui || !useUi) {
      // VR: одно нажатие на поклёвку — сразу подсечка.
      reel();
      return;
    }
    if (Math.abs(markPos() - zoneC) <= ZONE_W / 2) {
      hits++;
      zoneC = 0.2 + Math.random() * 0.6; // зона перескакивает
      if (hits >= HITS_NEED) reel();
    } else {
      miniT -= 1; // промах — минус секунда
    }
  };

  const reel = (): void => {
    net.sendFish("reel");
    hideUi();
    // Ловим дальше тем же режимом, пока не смотает.
    phase = "waiting";
    timer = 1.2;
    recastPending = true;
  };
  let recastPending = false;

  const start = (m: Mode): void => {
    mode = m;
    phase = "waiting";
    timer = 999; // точное время пришлёт сервер
    recastPending = false;
    castX = player.position.x;
    castZ = player.position.z;
    combat.fishing = true;
    combat.setFishingGearHidden(true);
    showRod();
    const pos = player.position;
    net.sendAct("swing", pos.x, pos.y, pos.z);
    net.sendFish("cast", m);
    if (ui && useUi) {
      ui.innerHTML = "";
      ui.textContent = m === "auto" ? "Авторыбалка… (E — смотать)" : "Ждём поклёвку… (E — смотать)";
      ui.style.display = "block";
    } else {
      onPrompt("Заброс…");
    }
  };

  const stop = (text?: string, tellServer = true): void => {
    if (phase === "idle") return;
    if (tellServer && phase !== "choosing") net.sendFish("stop");
    phase = "idle";
    recastPending = false;
    combat.fishing = false;
    combat.setFishingGearHidden(false);
    hideRod();
    hideUi();
    if (text) onPrompt(text);
  };

  net.onFishWait = (m) => {
    if (m.stop) {
      stop("Удочка смотана", false);
      return;
    }
    if (phase === "waiting") timer = Math.max(0.1, m.wait - 0.15);
  };

  return {
    get active(): boolean {
      return phase !== "idle";
    },

    cancel(): void {
      stop();
    },

    update(dt: number): void {
      const inp = player.lastInput;
      const edge = inp.interact && !prevInteract;
      prevInteract = inp.interact;

      if (phase === "idle") {
        combat.fishing = false;
        // Подошёл к воде — подсказка (один раз на подход).
        const near = isNearShore(player.position.x, player.position.z);
        if (near && !wasNear) onPrompt("Озеро — нажми E (на телефоне ✋), чтобы рыбачить");
        wasNear = near;
        if (edge && isNearShore(player.position.x, player.position.z)) {
          useUi = flatUiNow();
          if (useUi) {
            phase = "choosing";
            showChooser();
          } else start("manual");
        }
        return;
      }
      if (phase === "choosing") {
        if (!isNearShore(player.position.x, player.position.z)) {
          phase = "idle";
          hideUi();
        }
        return;
      }

      // Отошёл от места заброса / от берега — сматываем.
      if (Math.hypot(player.position.x - castX, player.position.z - castZ) > 2 || !isNearShore(player.position.x, player.position.z)) {
        stop("Удочка смотана");
        return;
      }

      if (phase === "waiting") {
        if (edge) {
          stop("Удочка смотана");
          return;
        }
        timer -= dt;
        if (timer > 0) return;
        if (recastPending) {
          start(mode);
          return;
        }
        if (mode === "manual") {
          phase = "mini";
          showMini();
        } else {
          timer = 999; // авто: улов и новый заброс пришлёт сервер
        }
        return;
      }

      // phase === "mini"
      markT += dt;
      miniT -= dt;
      if (edge) tryHit();
      if (phase !== "mini") return;
      if (miniT <= 0) {
        onPrompt("Сорвалась…");
        hideUi();
        phase = "waiting";
        timer = 1.2;
        recastPending = true;
        return;
      }
      renderMini();
    },
  };
}
