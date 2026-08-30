import type { NetClient } from "../net/NetClient";

const NICK_KEY = "lastNick";

export interface LoginResult {
  nick: string;
  online: boolean;
}

/** Экран входа: ник + «Играть» / «Играть офлайн». Резолвится после выбора. */
export function runLogin(net: NetClient, token: string): Promise<LoginResult> {
  document.head.appendChild(styleEl());

  const overlay = document.createElement("div");
  overlay.id = "login";
  overlay.innerHTML = `
    <div class="login-box">
      <div class="login-title">VR GAME</div>
      <input id="login-nick" maxlength="16" placeholder="Твой ник" autocomplete="off" spellcheck="false" />
      <button id="login-play">Играть</button>
      <button id="login-offline" class="ghost">Играть офлайн</button>
      <div id="login-status"></div>
    </div>`;
  document.body.appendChild(overlay);

  const nickInput = overlay.querySelector<HTMLInputElement>("#login-nick")!;
  const playBtn = overlay.querySelector<HTMLButtonElement>("#login-play")!;
  const offlineBtn = overlay.querySelector<HTMLButtonElement>("#login-offline")!;
  const status = overlay.querySelector<HTMLDivElement>("#login-status")!;

  nickInput.value = localStorage.getItem(NICK_KEY) ?? "";
  setTimeout(() => nickInput.focus(), 50);

  const nick = () => nickInput.value.trim() || "гость";
  const done = (online: boolean): LoginResult => {
    localStorage.setItem(NICK_KEY, nick());
    overlay.remove();
    return { nick: nick(), online };
  };

  return new Promise<LoginResult>((resolve) => {
    playBtn.addEventListener("click", async () => {
      playBtn.disabled = offlineBtn.disabled = true;
      status.textContent = "Подключение…";
      const ok = await net.connect(nick(), token);
      if (!ok) status.textContent = "Сервер недоступен — одиночный режим";
      setTimeout(() => resolve(done(ok)), ok ? 0 : 900);
    });
    offlineBtn.addEventListener("click", () => resolve(done(false)));
    nickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !playBtn.disabled) playBtn.click();
    });
  });
}

function styleEl(): HTMLStyleElement {
  const s = document.createElement("style");
  s.textContent = `
    #login {
      position: fixed; inset: 0; z-index: 999; display: flex;
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
