import type { NetClient } from "../net/NetClient";

const NICK_KEY = "lastNick";

export interface LoginResult {
  nick: string;
  /** Вошли в VR-сессию (иначе — плоский режим). */
  vr: boolean;
}

export interface LoginHooks {
  /** Может ли устройство в иммерсивный VR. */
  isVrAvailable: () => Promise<boolean>;
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

  const overlay = document.createElement("div");
  overlay.id = "login";
  overlay.innerHTML = `
    <div class="login-box">
      <div class="login-title">VR GAME</div>
      <input id="login-nick" maxlength="16" placeholder="${
        stream ? "Твой ник в Twitch" : "Твой ник"
      }" autocomplete="off" spellcheck="false" />
      <button id="login-play">${stream ? "Забрать персонажа" : "Играть"}</button>
      <div id="login-status"></div>
    </div>`;
  document.body.appendChild(overlay);

  const box = overlay.querySelector<HTMLDivElement>(".login-box")!;
  const nickInput = overlay.querySelector<HTMLInputElement>("#login-nick")!;
  const playBtn = overlay.querySelector<HTMLButtonElement>("#login-play")!;
  const status = overlay.querySelector<HTMLDivElement>("#login-status")!;

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
        <div class="login-title">VR GAME</div>
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
      letter-spacing: 1px; margin-bottom: 6px;
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
  `;
  return s;
}
