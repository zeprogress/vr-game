import type { NetClient } from "../net/NetClient";
import { QUALITY_KEY, QUALITY_LABELS, type Quality } from "../config/quality";

const NICK_KEY = "lastNick";

export interface LoginResult {
  nick: string;
  /** Вошли в VR-сессию (иначе — плоский режим). */
  vr: boolean;
}

export interface LoginHooks {
  /** Может ли устройство в иммерсивный VR. */
  isVrAvailable: () => Promise<boolean>;
  /** Действующий пресет качества (с которым уже собрана сцена). */
  currentQuality: () => Quality;
  /** Тач-устройство: переключатель качества не даёт выбрать выше «Среднего». */
  isTouch: () => boolean;
  /** Телефон (тач без WebXR): в переключателе качества нет «Высокого». */
  restrictQuality: () => boolean;
  /** Дождаться готовности WebXR (до этого кнопку «Войти в VR» не жмём). */
  whenXrReady: () => Promise<void>;
  /** Запустить VR-сессию — вызывать прямо из обработчика клика. true — вошли. */
  enterVR: () => Promise<boolean>;
  /**
   * Захватить мышь сразу по клику «Играть» — вызывать синхронно, без await
   * перед ней, иначе «жест пользователя» для requestPointerLock потеряется
   * (тот же приём, что и у enterVR ниже). На тач-устройстве это просто
   * ничего не делает — сам метод внутри себя это уже проверяет.
   */
  requestPointerLock: () => void;
}

/**
 * Экран входа: ник → «Играть». Игра только онлайн — без сервера в мир не
 * пускаем (кнопка повторяет попытку). Если устройство — VR-шлем, после ника
 * показываем экран «Войти в VR».
 */
export function runLogin(
  net: NetClient,
  token: string,
  hooks: LoginHooks,
  stream = false,
): Promise<LoginResult> {
  document.head.appendChild(styleEl());

  const curQ = hooks.currentQuality();
  const qOpts = hooks.restrictQuality()
    ? QUALITY_LABELS.filter((x) => x.q !== "high") // на телефоне не выше «Среднего»
    : QUALITY_LABELS;
  const qButtons = qOpts
    .map(
      ({ q, label }) =>
        `<button type="button" class="q-opt${q === curQ ? " on" : ""}" data-q="${q}">${label}</button>`,
    )
    .join("");

  const overlay = document.createElement("div");
  overlay.id = "login";
  overlay.innerHTML = `
    <div class="login-box">
      <div class="login-title">ZEP GAME</div>
      <div class="login-tag">VR / PC / Mobile</div>
      <input id="login-nick" maxlength="16" placeholder="${
        stream ? "Твой ник в Twitch" : "Твой ник"
      }" autocomplete="off" spellcheck="false" />
      <div class="login-qlabel">Качество графики</div>
      <div class="login-q">${qButtons}</div>
      <button id="login-play">${stream ? "Забрать персонажа" : "Играть"}</button>
      <div id="login-status"></div>
    </div>`;
  document.body.appendChild(overlay);

  const box = overlay.querySelector<HTMLDivElement>(".login-box")!;
  const nickInput = overlay.querySelector<HTMLInputElement>("#login-nick")!;
  const playBtn = overlay.querySelector<HTMLButtonElement>("#login-play")!;
  const status = overlay.querySelector<HTMLDivElement>("#login-status")!;

  // Переключатель качества. Смена пресета требует пересборки сцены — сохраняем
  // выбор и один раз перезагружаем страницу (ник уже в localStorage).
  let pickedQ: Quality = curQ;
  overlay.querySelectorAll<HTMLButtonElement>(".q-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      pickedQ = btn.dataset.q as Quality;
      overlay
        .querySelectorAll<HTMLButtonElement>(".q-opt")
        .forEach((b) => b.classList.toggle("on", b === btn));
      status.textContent = pickedQ !== curQ ? "Качество сменится при входе" : "";
    });
  });

  nickInput.value = localStorage.getItem(NICK_KEY) ?? "";
  setTimeout(() => nickInput.focus(), 50);

  const nick = () => nickInput.value.trim() || "гость";

  return new Promise<LoginResult>((resolve) => {
    const finish = (vr: boolean): void => {
      localStorage.setItem(NICK_KEY, nick());
      overlay.remove();
      resolve({ nick: nick(), vr });
    };

    /** Ник введён, соединение поднято — дальше решаем про VR. */
    const proceed = async (): Promise<void> => {
      if (!(await hooks.isVrAvailable())) {
        finish(false);
        return;
      }
      // Экран входа в VR.
      box.innerHTML = `
        <div class="login-title">ZEP GAME</div>
        <div class="login-tag">VR / PC / Mobile</div>
        <div class="login-sub">Надень шлем и нажми</div>
        <button id="login-vr" disabled>Войти в VR</button>
        <button id="login-flat" class="ghost">Войти без VR</button>
        <div id="login-status"></div>`;
      const vrBtn = box.querySelector<HTMLButtonElement>("#login-vr")!;
      const flatBtn = box.querySelector<HTMLButtonElement>("#login-flat")!;
      const vrStatus = box.querySelector<HTMLDivElement>("#login-status")!;

      void hooks.whenXrReady().then(() => (vrBtn.disabled = false));

      vrBtn.addEventListener("click", () => {
        vrBtn.disabled = true;
        vrStatus.textContent = "Запуск VR…";
        // Без await до enterVR — иначе теряется «жест пользователя».
        hooks.enterVR().then((entered) => {
          if (entered) finish(true);
          else {
            vrBtn.disabled = false;
            vrStatus.textContent = "Не удалось войти в VR — попробуй ещё раз";
          }
        });
        // Подстраховка: если через 20 с всё ещё висим (в шлеме экран не виден) —
        // впускаем в мир, чтобы не застрять с пустой сценой.
        setTimeout(() => {
          if (document.getElementById("login")) finish(false);
        }, 20000);
      });
      flatBtn.addEventListener("click", () => {
        hooks.requestPointerLock();
        finish(false);
      });
    };

    playBtn.addEventListener("click", async () => {
      // Сменили качество — сохраняем и перезагружаемся с новым пресетом.
      // Ник уже сохранён; после reload вход продолжится сам (autoPlay).
      if (pickedQ !== curQ) {
        localStorage.setItem(NICK_KEY, nick());
        localStorage.setItem(QUALITY_KEY, pickedQ);
        try {
          sessionStorage.setItem("loginAutoPlay", "1");
        } catch {
          /* ok */
        }
        status.textContent = "Меняю качество…";
        location.reload();
        return;
      }
      hooks.requestPointerLock(); // синхронно, до await — см. requestPointerLock в LoginHooks
      playBtn.disabled = true;
      status.textContent = "Подключение…";
      const ok = await net.connect(nick(), token, stream);
      if (ok) {
        void proceed();
      } else {
        status.textContent = stream
          ? "Не пустило — напиши !play в чате канала и попробуй снова"
          : "Сервер недоступен — попробуй ещё раз";
        playBtn.disabled = false;
      }
    });
    nickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !playBtn.disabled) playBtn.click();
    });

    // После перезагрузки из-за смены качества — входим сразу, без второго клика.
    try {
      if (sessionStorage.getItem("loginAutoPlay") === "1" && nickInput.value.trim()) {
        sessionStorage.removeItem("loginAutoPlay");
        setTimeout(() => playBtn.click(), 30);
      }
    } catch {
      /* нет sessionStorage — просто ждём клика */
    }
  });
}

function styleEl(): HTMLStyleElement {
  const s = document.createElement("style");
  s.textContent = `
    #login {
      position: fixed; inset: 0; z-index: 10000; display: flex;
      align-items: center; justify-content: center;
      background: radial-gradient(120% 120% at 50% 0%, #1a2233 0%, #0a0d14 70%);
      font-family: system-ui, sans-serif;
    }
    #login .login-box {
      display: flex; flex-direction: column; gap: 12px; width: 280px;
      padding: 28px; background: rgba(20,24,34,0.9);
      border: 1px solid #39415a; border-radius: 14px;
    }
    #login .login-title {
      font-size: 26px; font-weight: 700; color: #e8ecf8; text-align: center;
      letter-spacing: 1px;
    }
    #login .login-tag {
      font-size: 12px; font-weight: 600; color: #8b93a8; text-align: center;
      letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px;
    }
    #login .login-sub {
      font-size: 14px; color: #9aa3b8; text-align: center; margin-bottom: 4px;
    }
    #login input {
      padding: 11px 13px; font-size: 16px; border-radius: 8px;
      border: 1px solid #4a5474; background: #10141e; color: #f2f4fb; outline: none;
    }
    #login input:focus { border-color: #7aa2ff; }
    #login button {
      padding: 11px; font-size: 15px; font-weight: 600; border-radius: 8px;
      border: none; cursor: pointer; color: #fff; background: #2f7a35;
    }
    #login button:hover:not(:disabled) { background: #379140; }
    #login button.ghost { background: transparent; border: 1px solid #4a5474; color: #c9d2e6; }
    #login button.ghost:hover:not(:disabled) { background: rgba(255,255,255,0.05); }
    #login button:disabled { opacity: 0.5; cursor: default; }
    #login #login-status { min-height: 18px; font-size: 13px; color: #9aa3b8; text-align: center; }
    #login .login-qlabel { font-size: 12px; color: #8b93a8; text-align: center; margin-top: 2px; }
    #login .login-q { display: flex; gap: 6px; }
    #login .login-q .q-opt {
      flex: 1; padding: 8px 4px; font-size: 12.5px; font-weight: 600; border-radius: 7px;
      background: #10141e; border: 1px solid #4a5474; color: #c9d2e6; cursor: pointer;
    }
    #login .login-q .q-opt:hover:not(.on) { background: rgba(255,255,255,0.05); }
    #login .login-q .q-opt.on { background: #2f4a7a; border-color: #7aa2ff; color: #fff; }
  `;
  return s;
}
