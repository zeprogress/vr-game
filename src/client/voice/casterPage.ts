import { Client, type Room } from "colyseus.js";

import { MSG, type RtcMsg, type VoiceRelay } from "#shared/net/messages";
import { VoiceChat } from "./VoiceChat";

/**
 * Страница диктора (voice.html?key=…): невидимый участник комнаты «zone»
 * без героя — только микрофон. Сам звонит всем игрокам и спектаторам (список
 * шлёт сервер), игроки слышат его ровно, не «по месту». В игре его голос
 * глушится адресом `?nocaster=1`.
 */
const key = new URLSearchParams(location.search).get("key") ?? "";
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const btn = $("go") as HTMLButtonElement;
const status = (t: string): void => {
  $("status").textContent = t;
};

let voice: VoiceChat | null = null;
let room: Room | null = null;

async function start(): Promise<void> {
  btn.disabled = true;
  const ctx = new AudioContext();
  void ctx.resume();
  const v = new VoiceChat(ctx);
  v.setOutputVolume(0); // игроков диктору слышать не нужно (эхо в эфир)
  voice = v;
  status("Подключаюсь…");
  try {
    room = await new Client().joinOrCreate("zone", { caster: key });
  } catch (e) {
    status(`Не пустило: ${(e as Error).message}`);
    btn.disabled = false;
    return;
  }
  const r = room;
  v.send = (m) => r.send(MSG.rtc, m);
  v.sendVoice = (t, d) => r.send(MSG.voice, { t, d });
  r.onMessage(MSG.rtc, (m: RtcMsg) => void v.handle(m));
  r.onMessage(MSG.voice, (_m: VoiceRelay) => {});
  r.onMessage(MSG.casterPeers, (ids: string[]) => {
    const want = new Set(ids);
    for (const id of want) v.addPeer(id, true); // диктор всегда звонит сам
    for (const id of peerIds(v)) if (!want.has(id)) v.removePeer(id);
  });
  r.onMessage("*", () => {});
  r.onLeave(() => {
    status("Связь потеряна — переподключаюсь…");
    v.dispose();
    setTimeout(() => void start(), 2000);
  });

  const ok = await v.start(r.sessionId);
  if (!ok) {
    status(`Микрофон: ${v.micError ?? "недоступен"}`);
    return;
  }
  v.micEnabled = true;
  btn.disabled = false;
  syncBtn();
  status("В эфире игры");
}

function peerIds(v: VoiceChat): string[] {
  return [...(v as unknown as { peers: Map<string, unknown> }).peers.keys()];
}

function syncBtn(): void {
  if (!voice) return;
  btn.textContent = voice.micEnabled ? "Выключить микрофон" : "Включить микрофон";
  btn.classList.toggle("off", !voice.micEnabled);
}

btn.onclick = () => {
  if (!voice) return void start();
  voice.micEnabled = !voice.micEnabled;
  syncBtn();
};

let last = performance.now();
const loop = (): void => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  if (voice) {
    voice.update(dt);
    const st = voice.status();
    $("lvl").style.width = voice.speaking ? "100%" : "0";
    $("talk").textContent = voice.speaking ? "🔴 Говоришь" : "";
    if (voice.micEnabled && room) status(`В эфире игры · слушателей ${st.connected}/${st.peers}`);
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
