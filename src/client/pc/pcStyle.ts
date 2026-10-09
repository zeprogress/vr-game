/**
 * Общий стиль ПК-интерфейса «тёмное фэнтези» (как в WoW): тёмные
 * полупрозрачные рамки с золотой каймой. Вставляется один раз.
 */
let injected = false;

export function injectPcStyle(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("style");
  s.textContent = `
:root { --pc-edge:#3a3e48; --pc-edge-hi:#6e7482; --pc-bg:rgba(14,13,19,.84); --pc-text:#eadfc4; }
.pc-target { position:fixed; left:50%; top:14px; transform:translateX(-50%); width:260px; z-index:30;
  background:var(--pc-bg); border:none; border-radius:8px; padding:6px 10px 7px;
  color:var(--pc-text); font:600 13px/1.25 system-ui,sans-serif; pointer-events:auto; cursor:pointer; text-shadow:0 1px 2px #000; }
.pc-target { background:none; }
.pc-target:hover { background:rgba(26,24,33,.25); }
.pc-target.attacking { box-shadow:inset 0 0 0 2px rgba(210,59,59,.55); }
.pc-target-name { color:#ffb3a8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pc-bar { position:relative; height:14px; margin-top:4px; background:#23202a; border:1px solid #000; border-radius:3px; overflow:hidden; }
.pc-bar-fill { height:100%; width:100%; background:linear-gradient(#e0493f,#a8231c); transition:width .15s linear; }
.pc-bar-text { position:absolute; inset:0; text-align:center; font:600 10px/14px system-ui,sans-serif; color:#fff; }
@media (pointer: coarse) { .pc-target { top:34px; width:220px; padding:4px 8px 5px; font-size:12px; } }
.pc-target-hint { color:#ff8a7a; font-size:11px; min-height:0; margin-top:2px; }
.pc-target-hint:empty { display:none; }
/* Тёмные скроллбары в цвет интерфейса (журнал, окна, меню). */
.pc-hud *, .pcinv-root *, .pcmenu-root * { scrollbar-width:thin; scrollbar-color:#4a4d58 transparent; }
.pc-hud ::-webkit-scrollbar, .pcinv-root ::-webkit-scrollbar, .pcmenu-root ::-webkit-scrollbar,
.pcinv-win::-webkit-scrollbar, .pcmenu-box::-webkit-scrollbar { width:8px; height:8px; }
.pc-hud ::-webkit-scrollbar-track, .pcinv-root ::-webkit-scrollbar-track, .pcmenu-root ::-webkit-scrollbar-track,
.pcinv-win::-webkit-scrollbar-track, .pcmenu-box::-webkit-scrollbar-track { background:transparent; }
.pc-hud ::-webkit-scrollbar-thumb, .pcinv-root ::-webkit-scrollbar-thumb, .pcmenu-root ::-webkit-scrollbar-thumb,
.pcinv-win::-webkit-scrollbar-thumb, .pcmenu-box::-webkit-scrollbar-thumb { background:#3d404a; border-radius:4px; }
.pc-hud ::-webkit-scrollbar-thumb:hover, .pcinv-root ::-webkit-scrollbar-thumb:hover, .pcmenu-root ::-webkit-scrollbar-thumb:hover { background:#555966; }
.pcmenu-box, .pcinv-win { scrollbar-width:thin; scrollbar-color:#4a4d58 transparent; }
`;
  document.head.appendChild(s);
}
