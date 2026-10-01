import "./billboardFix";
import { vrLights } from "../world/vrLights";
import { STAT_NAMES } from "#shared/progression";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import { WebXRFeatureName } from "@babylonjs/core/XR/webXRFeaturesManager";
// Без этого импорта режим ?layers=1 (multiview) падает: "createMultiviewRenderTargetTexture is not a function".
import "@babylonjs/core/Engines/Extensions/engine.multiview";
import "@babylonjs/core/XR/features/WebXRLayers";

import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";

import { buildZone } from "../world/Zone";
import { PRESETS, type Quality } from "../config/quality";
import { CombatSystem, STOW } from "../combat/CombatSystem";
import { createFishing, type Fishing } from "../world/Fishing";
import { NetMobs } from "../combat/MobSystem";
import type { Hittable, HitReporter } from "../combat/Hittable";
import { Hud } from "../ui/Hud";
import { PcTargeting } from "../pc/PcTargeting";
import { PcHud, SACK_SVG, type MapData, type WeaponIcon } from "../pc/PcHud";
import { QuestBang } from "../world/hub/HubNpc";
import { setGrassVr } from "../world/GrassField";
import { LightFocus } from "../world/lightFocus";
import { VrPanel } from "../ui/VrPanel";
import { drawBoard, drawEnchant, drawFishing, drawHunter, drawNote, drawShop } from "../ui/VrQuestPanels";
import { QuestWindow, QuestTracker, QuestCompass, ShopWindow, HunterWindow, trackItems, type TrackItem } from "../ui/QuestWindow";
import { VrCompass } from "../ui/VrCompass";
import { buffList } from "../ui/buffList";
import { QUEST, questPoint } from "#shared/quests";
import { HUB } from "#shared/hub";
import { terrainHeight } from "#shared/terrain";
import { SCROLL, TAVERN_REACH } from "#shared/shop";
import { PcInventory } from "../pc/PcInventory";
import { PcMenu } from "../pc/PcMenu";
import { enableTreeFade, fadeTreesOccluding } from "../world/nature";
import { LootMarker } from "../pc/LootMarker";
import { AoeAim } from "../pc/AoeAim";
import { PcHover, type HoverInfo } from "../pc/PcHover";
import { difficultyCss } from "../pc/difficulty";
import { Mob } from "../combat/Mob";
import { BOSS_CFG, SHARD_CFG, SLIME_CFG, SPITTER_CFG } from "#shared/constants";
import { toggleFullscreen } from "../pc/PcHud";
import { injectPcStyle } from "../pc/pcStyle";
import { HealthBar3D } from "../ui/HealthBar3D";
import { VrWasted } from "../ui/VrWasted";
import { VrStunStars } from "../ui/VrStunStars";
import { VrVignette } from "../ui/VrVignette";
import { ComfortVignette } from "../ui/ComfortVignette";
import { HealCrossFx, CROSS_ORANGE } from "../ui/HealCrossFx";
import { WorldCrossFx, CROSS_GREEN as W_GREEN, CROSS_ORANGE as W_ORANGE, CROSS_RED as W_RED } from "../ui/WorldCrossFx";
import { HealAuraFx } from "../ui/HealAuraFx";
import { SkillFx } from "../ui/SkillFx";
import { SpecCamMarker } from "../world/SpecCamMarker";
import { EventBeacon } from "../world/EventBeacon";
import { SpellLights } from "../world/SpellLights";
import { RELIGHT_STATS } from "../world/Fireflies";
import { BlobShadow } from "../world/blobShadow";
import { installActiveMeshCandidates } from "./meshCandidates";
import { daylightAt } from "../world/DayTime";
import { WristMenu, type MenuAction } from "../ui/WristMenu";
import { VrHud } from "../ui/VrHud";
import { VrCull } from "../world/VrCull";
import { Ray } from "@babylonjs/core/Culling/ray";
import { VrPerfHud } from "../ui/VrPerfHud";
import { FpsCounter } from "../ui/FpsCounter";
import { secReport, secEndFrame } from "./secProf";
import { installFlushPacing, type FlushPacing } from "./glFlushPacing";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import type { WornWeapon } from "../ui/itemStats";
import { LoadoutPanel } from "../ui/LoadoutPanel";
import {
  LOADOUT,
  printLoadout,
  importOverrides,
  exportOverrides,
  applyWorldLoadout,
  worldLoadoutSnapshot,
} from "../config/loadout";
import { HUD, VIGNETTE } from "#shared/constants";
import { Sfx } from "../audio/Sfx";
import { Hands } from "../player/Hands";
import { Progression } from "../player/Progression";
import { Inventory } from "../player/Inventory";
import { LootDrops, makeWeaponMesh } from "../world/LootDrops";
import { preloadWeaponModels } from "../items/weaponModels";
import { PlayerController } from "../player/PlayerController";
import { DesktopInput, type MouseClick } from "../input/DesktopInput";
import { TouchInput } from "../input/TouchInput";
import { XRInput } from "../input/XRInput";
import type { InputSource } from "../input/InputSource";
import type { NetClient } from "../net/NetClient";
import { RemoteAvatar } from "../entities/RemoteAvatar";
import { LocalAvatar } from "../entities/LocalAvatar";
import { VoiceChat } from "../voice/VoiceChat";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import { SharpenPostProcess } from "@babylonjs/core/PostProcesses/sharpenPostProcess";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { ActKind, CharMsg, LootItem, MoveMsg, PcInvData, QuestActMsg, QuestData, SaveMsg, ShopData, Xf7 } from "#shared/net/messages";
import type { PlayerState, ZoneState } from "#shared/net/schema";
import type { Room } from "colyseus.js";
import { noGuard, type BlockedBy } from "#shared/combat";
import { ITEMS, weaponDef, type ItemId, type WeaponClass, type WeaponTier } from "#shared/items";
import { BLINK, BOSS, BOT, PLAYER, PULL, CHARGE, REFLECT, SPIKES, CHIEF_HEAL, FREEZE, RESPAWN, SKILL, SPORE, isAdminNick } from "#shared/constants";
import { MAGIC, MANA_ENABLED } from "#shared/magic";
import { VR_SETTINGS, onVrSettingsChanged, setVrSettings } from "../config/vrSettings";
import { TOWN_MUSIC, BOSS_MUSIC } from "../audio/playlist";

/**
 * Каркас движка: один Engine, одна Scene, один рендер-луп.
 * Выбирает источник ввода по устройству и подключает WebXR.
 */
/** Фиксированная фовеация: `?fov=` (0 — выкл, 1 — макс), по умолчанию 1 (максимум). (Раньше `Number(null)` давал 0 — по умолчанию она была выключена.) */
/** Ждать промис не дольше ms — иначе резолвиться самостоятельно (не блокировать выход из-за зависшей XR-сессии и т.п.). */
function raceTimeout<T>(p: Promise<T> | undefined, ms: number): Promise<T | void> {
  if (!p) return Promise.resolve();
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

function ffrLevel(): number {
  const q = new URLSearchParams(location.search);
  const want = q.has("fov") ? Number(q.get("fov")) : 1;
  return Number.isFinite(want) ? Math.min(1, Math.max(0, want)) : 1;
}

/** VR: дальше этого (м) боевые эффекты не показываются. */
const VR_FX_RANGE = 150;

export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly player: PlayerController;
  readonly progression = new Progression();
  readonly inventory = new Inventory();
  readonly hands: Hands;
  readonly isTouch: boolean;
  /** Действующий пресет качества (из `?q=`, выбора игрока или авто по железу). */
  readonly quality: Quality;
  private readonly ground: Mesh;
  private readonly combat: CombatSystem;
  private readonly netMobs: NetMobs;
  private readonly loot: LootDrops;
  private fishing: Fishing | null = null;
  private readonly zoneTick: (
    dt: number,
    playerPos: Vector3,
    net?: { hour: number; auto: number } | null,
  ) => void;
  /** Ник этого игрока: панель настройки открывает только админ (ADMIN_NICK). */
  private localNick = "";
  /** Голосовой чат: разговор идёт напрямую между игроками. */
  readonly voice: VoiceChat;
  /** Общий список целей (мобы + куклы) — наполняет NetMobs, читает CombatSystem. */
  private readonly targets: Hittable[] = [];
  private report: HitReporter | null = null;
  private readonly sfx = new Sfx();
  private readonly hud = new Hud();

  /** Узел, который следует за головой, но не наклоняется: HUD параллелен горизонту. */
  private hudAnchor: TransformNode | null = null;
  private playerBar3D: HealthBar3D | null = null;
  private manaBar3D: HealthBar3D | null = null;
  private manaMax = 30;
  private vrVignette: VrVignette | null = null;
  private vrWasted: VrWasted | null = null;
  /** Последняя отправленная платформа (0 — ещё не отправляли в этой сессии). */
  private lastSentPlat = 0;
  private vrStars: VrStunStars | null = null;
  private comfortVignette: ComfortVignette | null = null;
  /** Секунду после поворота (snap-turn) виньетка тоже включена. */
  private vignetteTurnT = 0;
  private healCrossFx: HealCrossFx | null = null;
  private readonly spellLights: SpellLights;
  private readonly botLights: import("../world/BotLights").BotLights;
  private readonly fireflies: import("../world/Fireflies").Fireflies;
  private readonly _botPos: Vector3[] = [];
  /** Пятно-тень под самим игроком — опора при прыжке и в VR. */
  private readonly ownShadow: BlobShadow;
  /** Крестики над ЧУЖИМИ телами: свои игрок видит через HealCrossFx. */
  private readonly crossFx: WorldCrossFx;
  /** Аура массового лечения бота-лекаря. */
  private readonly healAura: HealAuraFx;
  /** Визуал массовых скиллов ботов (рассекающий удар, град стрел). */
  private readonly skillFx: SkillFx;
  /** Метка камеры стрима в мире (Ф10) — видна, пока specActive и specVisible. */
  private specMarker: SpecCamMarker | null = null;
  private specMarkerShown = false;
  private eventBeacon: EventBeacon | null = null;
  private specRaysShown = true;
  private readonly _botFwd: Vector3[] = [];
  private wristPanel: WristMenu | null = null;
  /** Надписи в VR: события мира, подсказки, «кто говорит». */
  private vrHud: VrHud | null = null;
  private vrCull: VrCull | null = null;
  private readonly voiceSpeakers = new Set<string>();
  private tts: import("../spectator/SpectatorTts").SpectatorTts | null = null;
  private ttsLoading = false;
  private ttsNick = "";
  private ttsListenSent = -1;
  private perfHud: VrPerfHud | null = null;
  /** Промежуточный gl.flush() в кадре VR (см. glFlushPacing). */
  private flushPacing: FlushPacing | null = null;
  /** `?fps=1` — голый счётчик кадров над полоской здоровья. */
  private fpsCounter: FpsCounter | null = null;
  private perfInstr: SceneInstrumentation | null = null;
  private engInstr: EngineInstrumentation | null = null;
  private prevEffectKeys = new Set<string>();
  private lastNewEffects: string[] = [];
  private readonly showPerfHud = new URLSearchParams(location.search).has("perf");
  /** ?perf=1 включает тяжёлую диагностику (инструментовка + патчи прототипов);
   *  ?perf=lite — только FPS-плашка, без накладных расходов. (?fps=1 — теперь голый счётчик, см. FpsCounter.) */
  private readonly lightPerf = new URLSearchParams(location.search).get("perf") === "lite";
  loadoutPanel: LoadoutPanel | null = null;
  private xrInput: XRInput | null = null;
  xr: WebXRDefaultExperience | null = null;

  // Сеть: чужие игроки.
  private net: NetClient | null = null;
  private readonly avatars = new Map<string, RemoteAvatar>();
  /** Своя модель — только на смартфоне (вид от третьего лица). */
  private localAvatar: LocalAvatar | null = null;
  /** ПК в третьем лице «как в WoW» (по умолчанию; `?fp=1` — старый вид из глаз). */
  pcThirdPerson = false;
  private desktopInput: DesktopInput | null = null;
  private pcTarget: PcTargeting | null = null;
  private pcHud: PcHud | null = null;
  private lastCampBuff = 0;
  private pcInv: PcInventory | null = null;
  private questWin: QuestWindow | null = null;
  private questTracker: QuestTracker | null = null;
  private nearQuestBoard = false;
  private questCompass: QuestCompass | null = null;
  private shopWin: ShopWindow | null = null;
  /** Последние данные заданий/лавки — для VR-панелей (HTML в шлеме не виден). */
  private questData: QuestData | null = null;
  private shopData: ShopData | null = null;
  /** VR: панель у NPC (доска / Охотник / трактирщик) и панель рыбалки. */
  private vrNpcPanel: VrPanel | null = null;
  private vrNpcKind: "board" | "hunter" | "tavern" | null = null;
  private vrFishPanel: VrPanel | null = null;
  /** VR: панель заточки (открывается из меню на руке) — что точим, где открыли, последний итог. */
  private vrEnchPanel: VrPanel | null = null;
  private vrEnchId: string | null = null;
  private vrEnchAt: Vector3 | null = null;
  private vrEnchResult: { up: boolean; text: string } | null = null;
  private pcInvData: PcInvData | null = null;
  private hunterWin: HunterWindow | null = null;
  private nearHunter = false;
  /** Жёлтые «!» над доской и Охотником — есть что взять/сдать. */
  private bangBoard: QuestBang | null = null;
  private bangHunter: QuestBang | null = null;
  private nearTavern = false;
  private pcMenu: PcMenu | null = null;
  private lootMarker: LootMarker | null = null;
  private aoeAim: AoeAim | null = null;
  private pcHover: PcHover | null = null;
  private hoverT = 0;
  private readonly pcPlates = { level: 1 };
  /** ПК: герой сам бежит к цели на дальность атаки (пока игрок не взялся за WASD). */
  private pcChase = false;
  private pcChaseMoving = false;
  /** Своя внешность (с сервера) — для меню ПК. */
  private mySkin = 1;
  /** Опыт на прошлом кадре — чтобы писать в журнал «+N опыта». */
  private pcLastXp: { level: number; xp: number } | null = null;
  private readonly aim = new Vector3(0, 0, 1);
  /** Локальный кулдаун активного умения оружия, с (сервер тоже сверяет). */
  private skillCdLeft = 0;
  private skillCdTotal = 1;
  /** Слепок содержимого рук — чтобы не слать серверу одно и то же. */
  private handsKey = "";
  /** Про неудачу голоса говорим один раз, а не на каждого собеседника. */
  private voiceWarned = false;
  /** Сглаживание краёв кадра и камера, к которой оно прицеплено. */
  private fxaa: FxaaPostProcess | null = null;
  private fxaaCam: Camera | null = null;
  /** Резкость кадра (смартфон, `?sharpen=` 0..1.5). 0 — выключено. */
  private sharpen: SharpenPostProcess | null = null;
  private sharpenCam: Camera | null = null;
  private sharpenAmount = 0;
  private readonly moveMsg: MoveMsg = {
    mode: "flat",
    head: zeros7(),
    handL: zeros7(),
    handR: zeros7(),
    guard: noGuard(),
  };
  /** Локальный отсчёт до возрождения — только для надписи на экране. */
  private deathCountdown = 0;
  /**
   * «Оставить бота после выхода» — источник правды для обеих панелей (C и
   * запястье в VR): сервер не подтверждает этот тумблер отдельным
   * сообщением, только начальным MSG.char, поэтому переключение из ЛЮБОЙ
   * панели правит это поле сразу же (оптимистично), а не ждёт ответа.
   */
  private leaveBotOn = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    // Uniform-буферы (UBO) Babylon ОСТАВЛЕНЫ включёнными. Отключение (`?noubo=1`, только для диагностики)
    // ломает multiview: матрица правого глаза `viewProjectionR` в режиме без UBO не выставляется, и
    // в шлеме рисуется один глаз. Замеры «быстрее без UBO» были сделаны именно на таком, одноглазом рендере.
    if (new URLSearchParams(location.search).has("noubo")) this.engine.disableUniformBuffers = true;
    this.scene = new Scene(this.engine);
    installActiveMeshCandidates(this.scene); // обход только включённых и видимых мешей (см. meshCandidates.ts)
    if (new URLSearchParams(location.search).has("fps")) this.fpsCounter = new FpsCounter();
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
    this.scene.collisionsEnabled = true;

    // Выбора качества больше нет — всегда максимум на всех платформах (в VR
    // сверху ложится лёгкий профиль, см. applyVrQuality).
    this.isTouch =
      window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    this.pcThirdPerson = !this.isTouch && new URLSearchParams(location.search).get("fp") !== "1";
    this.quality = "high";
    const preset = PRESETS[this.quality];
    if (preset.scaling !== 1) this.engine.setHardwareScalingLevel(preset.scaling);
    this.scene.performancePriority = preset.fireflies && preset.fireflies > 0 ? 1 : 2;

    // Резкость кадра — только по явному `?sharpen=` 0..1.5 (для теста).
    const spRaw = new URLSearchParams(location.search).get("sharpen");
    const sp = spRaw === null ? NaN : Number(spRaw);
    this.sharpenAmount = Number.isFinite(sp) ? Math.max(0, Math.min(1.5, sp)) : 0;

    preloadWeaponModels(this.scene); // модели меча/лука — до первого createSword

    const zone = buildZone(this.scene, {
      grass: preset.grass,
      fireflies: preset.fireflies,
      minLights: preset.minLights,
      simpleSky: preset.simpleSky,
      botTorches: preset.botTorches,
      // ПК в третьем лице: деревья отдельными мешами — чтобы гасить те, что
      // закрывают героя от камеры (как у спектатора).
      treeFade: this.pcThirdPerson,
    });
    if (this.pcThirdPerson) enableTreeFade();
    this.ground = zone.ground;
    this.zoneTick = zone.tick;
    this.botLights = zone.botLights;
    this.lightFocus = new LightFocus(this.scene);
    this.fireflies = zone.fireflies;

    this.player = new PlayerController(this.scene, this.progression);
    this.player.setObstacles(zone.obstacles);
    this.scene.activeCamera = this.player.camera;
    this.player.placeOnGround();

    this.combat = new CombatSystem(
      this.scene,
      this.player,
      () => this.xr,
      this.targets,
      this.sfx,
      this.progression,
      zone.groundHeight,
      zone.swordHome,
      zone.bowHome,
      zone.shieldHome,
      zone.staffHome,
      zone.weaponsFaceYaw,
    );
    const report: HitReporter = (id, target, weapon, dx, dz) =>
      this.net?.sendHitMob({ id, target, weapon, hand: this.combat.lastHitHand, dx, dz });
    this.report = report;
    this.netMobs = new NetMobs(
      this.scene,
      this.sfx,
      this.targets,
      report,
      preset.leanMobs,
      this.isTouch ? 2 : 1, // плашки мобов вдвое крупнее на телефоне
    );
    this.netMobs.lazy = true; // виды мобов — только рядом с игроком (см. NetMobs.materialize)
    this.spellLights = new SpellLights(this.scene);
    this.ownShadow = new BlobShadow(this.scene, "self");
    this.crossFx = new WorldCrossFx(this.scene);
    this.healAura = new HealAuraFx(this.scene);
    this.skillFx = new SkillFx(this.scene);
    this.specMarker = new SpecCamMarker(this.scene);
    this.eventBeacon = new EventBeacon(this.scene);
    this.eventBeacon.bindGround(zone.groundHeight);
    this.loot = new LootDrops(this.scene);
    this.voice = new VoiceChat(this.sfx.audioContext());
    this.voice.peerPosition = (id) => this.avatars.get(id)?.position ?? null;
    this.voice.onSpeaking = (id, on) => {
      this.avatars.get(id)?.setSpeaking(on);
      if (on) this.voiceSpeakers.add(id);
      else this.voiceSpeakers.delete(id);
    };
    // Молчащий голос без объяснения выглядит поломкой — говорим прямо.
    this.voice.onPeerFailed = () => {
      if (this.voiceWarned || this.voice.micDenied) return;
      this.voiceWarned = true;
      this.notifyToast("Голос не пробился: мешает VPN или сеть");
    };
    this.voice.onPeerState = (_id, state) => {
      if (state === "говорим") this.notifyToast("Голос: связь установлена");
      else if (state === "соединяется") this.notifyToast("Голос: соединяюсь…");
    };
    this.hands = new Hands(this.scene);
    this.hud.bindProgression(this.progression);
    // ПК от третьего лица: курсор свободен, захват мыши — только на время
    // поворота камеры (его ведёт DesktopInput), панель по снятию захвата не открываем.
    if (!this.pcThirdPerson) this.hud.bindPointerLock(() => this.requestPointerLock());
    this.hud.bindInventory(this.inventory);
    this.hud.bindWarehouse(() => this.net?.warehouse?.list ?? []);
    // Инвентарь показывает и снаряжение: что в руках и что за спиной.
    this.hud.bindEquipped(() => {
      const h = this.combat.handsSnapshot();
      // Текст роллов ("+12% урона" и т.п.) — сервер считает и держит в
      // своём PlayerState (leftAffix/rightAffix), клиент их только читает.
      const self = this.net?.self;
      // Лук занимает обе руки: в интерфейсе он в левой, а в правой — стрела (везде одинаково).
      const bow = h.left?.cls === "bow" ? h.left : h.right?.cls === "bow" ? h.right : null;
      const bowAffix = self?.rightAffix || self?.leftAffix || undefined;
      return {
        arrow: !!bow,
        left: bow
          ? ({ ...bow, affix: bowAffix } as WornWeapon)
          : h.left
            ? ({ ...h.left, affix: self?.leftAffix || undefined } as WornWeapon)
            : null,
        right: bow
          ? null
          : h.right
            ? ({ ...h.right, affix: self?.rightAffix || undefined } as WornWeapon)
            : null,
        stowed: this.combat.stowedSnapshot(),
        stats: {
          level: this.progression.level,
          ...this.progression.stats,
        },
      };
    });
    // Плейсхолдер до первого пакета с сервера — syncSelf поправит на реальный.
    this.hud.bindSkin(1, (skin) => this.net?.sendSetSkin(skin));
    this.hud.bindLeaveBot(false, (on) => {
      this.leaveBotOn = on;
      this.net?.sendSetLeaveBot(on);
    });
    this.hud.bindExit(() => void this.leaveWorld());

    // Бутылочка на поясе показывает запас зелий и пьётся поднесением ко рту.
    const syncPotion = (): void => {
      this.combat.setPotionCount(this.potionCount());
    };
    this.inventory.onChange(syncPotion);
    syncPotion();
    this.combat.onDrinkPotion = () => {
      const slot = this.inventory.slots.findIndex((s) => s.item === "potion" && s.count > 0);
      if (slot >= 0) this.inventory.use(slot);
    };

    // Офлайн уровень считает Progression, онлайн — сервер шлёт MSG.levelUp.
    this.progression.onLevelUp = (lvl) => {
      this.levelUpFx(lvl);
      // Новый уровень поднимает потолок HP — доливаем разницу (офлайн).
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
      this.showHp(this.player.hp);
    };

    this.player.hooks.step = () => {
      const p = this.player.position;
      const fx = p.x;
      const fy = p.y - PLAYER.eyeHeight; // под ногами, не у головы
      const fz = p.z;
      // Свои шаги слышим снизу — объёмно от точки под ногами.
      this.sfx.at({ x: fx, y: fy, z: fz }, () => this.sfx.footstep(0.9));
      this.net?.sendAct("step", fx, fy, fz);
    };
    this.player.hooks.land = (impact) => this.sfx.land(Math.min(1, impact / 9));
    this.player.hooks.jump = () => {
      this.localAvatar?.jump();
      const p = this.player.position;
      this.net?.sendAct("jump", p.x, p.y, p.z);
    };
    this.player.hooks.hurt = (hp, dmg) => {
      this.sfx.playerHurt();
      if (dmg >= 0.5) this.pcHud?.log("damage", `Вы получили ${Math.round(dmg).toLocaleString("ru-RU")} урона`, undefined, "#ff8a7a");
      this.localAvatar?.hurt();
      this.showHp(hp);
      this.hud.setOpacity(1);
      this.playerBar3D?.setOpacity(1);
      this.hud.flashDamage(dmg);
      this.vrVignette?.flash(dmg);
      this.hapticBoth();
    };
    this.player.hooks.heal = (hp) => this.showHp(hp);
    this.player.hooks.respawn = () => {
      this.showHp(this.player.hp);
      this.hud.flashDamage(30);
    };
    this.showHp(this.player.hp);

    this.player.setInput(this.defaultInput());

    // Доска заданий в лагере (ПК и телефон): окно по E/✋ у доски + трекер.
    if (this.isTouch || this.pcThirdPerson) {
      this.questWin = new QuestWindow({
        request: () => this.net?.sendQuestOpen(),
        act: (m) => this.net?.sendQuestAct(m),
      });
      this.questCompass = new QuestCompass();
      this.questTracker = new QuestTracker(
        !this.isTouch,
        () => this.questWin?.open(),
        (q) => this.setQuestCompass(q),
      );
      {
        const b = HUB.zones.questBoard;
        const h = HUB.zones.hunter;
        this.bangBoard = new QuestBang(this.scene, b.x, b.z, 2.8);
        this.bangHunter = new QuestBang(this.scene, h.x, h.z, 3.6);
      }
      this.hunterWin = new HunterWindow({
        request: () => this.net?.sendQuestOpen(),
        act: (m) => this.net?.sendQuestAct(m),
      });
      this.shopWin = new ShopWindow({
        request: () => this.net?.sendShopOpen(),
        buy: (id) => this.net?.sendShopBuy(id),
      });
      this.combat.interactHook = () => {
        const p = this.player.position;
        const b = HUB.zones.questBoard;
        if (Math.hypot(p.x - b.x, p.z - b.z) <= QUEST.boardReach) {
          this.questWin?.toggle();
          return true;
        }
        const t = HUB.zones.tavern;
        if (Math.hypot(p.x - t.x, p.z - t.z) <= TAVERN_REACH) {
          this.shopWin?.toggle();
          return true;
        }
        const h = HUB.zones.hunter;
        if (Math.hypot(p.x - h.x, p.z - h.z) <= QUEST.boardReach) {
          this.hunterWin?.toggle();
          return true;
        }
        return false;
      };
    }

    // Смартфон — вид от третьего лица: орбитальная камера + видимая модель.
    // Десктоп/VR остаются от первого лица.
    if (this.isTouch) {
      this.player.enableThirdPerson();
      this.localAvatar = new LocalAvatar(this.scene);
      this.scene.activeCamera = this.player.renderCamera;
      this.netMobs.boltViewScale = 2.4; // огнешар крупнее на телефоне
      // Окна как на ПК: снаряжение (тап-меню / перетаскивание пальцем) и меню.
      injectPcStyle();
      this.pcInv = this.makePcInventory(true);
      this.hud.touchMenuHook = () => this.pcMenu?.toggle();
      this.hud.touchBagHook = () => this.pcInv?.toggle("gear");
      this.hud.touchBagIcon = SACK_SVG;
      this.hud.topBtnShift = 88; // левее квадратной мини-карты в углу
      this.hud.enableTouchMenu();
      // Тапы по миру как клики на ПК: цель/атака, NPC, предметы (подбор — в сумку, как на ПК).
      this.pcTarget = new PcTargeting(this.scene, () => this.net?.room?.state ?? null, this.netMobs);
      this.pcTarget.selfId = () => this.net?.sessionId;
      this.pcTarget.playerSeg = (sid) => this.avatars.get(sid)?.hitSegment() ?? null;
      this.pcTarget.heroLevel = () => this.progression.level;
      this.pcTarget.onError = (t) => this.notifyToast(t);
      this.pcTarget.onAttackStart = () => {
        this.fishing?.cancel();
        this.pcChase = true;
      };
      this.pcTarget.canAttackPlayer = (sid) => {
        if (!this.net?.pvpOn) return "Включи PvP в меню, чтобы атаковать игроков";
        const ps = this.net.room?.state.players.get(sid);
        if (ps && !ps.pvp) return `У ${ps.nick} PvP выключен — атаковать нельзя`;
        return null;
      };
      this.lootMarker = new LootMarker();
      this.aoeAim = new AoeAim(this.scene);
      this.combat.lootToBag = true;
      this.combat.onPickupBlocked = () => this.notifyToast("Руки заняты — сначала сними оружие (мешок сверху)");
      this.combat.onLocalPickup = () => {
        this.localAvatar?.pickup();
        const p = this.player.position;
        this.net?.sendAct("pickup", p.x, p.y, p.z);
      };
      Mob.pcPlates = this.pcPlates;
      // Рамка героя и мини-карта — как на ПК (старые полоски HP/маны прячем).
      this.hud.setPcMode();
      this.pcHud = new PcHud({
        touch: true,
        onCharacter: () => this.pcInv?.toggle("gear"),
        onBag: () => this.pcInv?.toggle("gear"),
        onMenu: () => this.pcMenu?.toggle(),
        onSlot: (key) => this.pcSlot(key),
        onAttrs: () => this.pcInv?.open("attrs"),
      });
      this.hud.bindDrinkPotion(() => {
        const slot = this.inventory.slots.findIndex((s) => s.item === "potion" && s.count > 0);
        if (slot >= 0) this.inventory.use(slot);
      });
      // Оружие — в кости кулака модели, замах — её клипом (как у ботов).
      this.combat.avatarFist = (side) => this.localAvatar?.fistBone(side) ?? null;
      this.combat.onMeleeSwing = () => this.localAvatar?.swing(this.progression.meleeAnimRate * this.combat.atkSpeedAffix);
    } else if (this.pcThirdPerson) {
      // ПК «как в WoW»: орбитальная камера за спиной + видимая модель, бой —
      // автоатакой по выбранной цели (PcTargeting → CombatSystem.pcTarget).
      injectPcStyle();
      this.player.enableThirdPerson(true);
      this.localAvatar = new LocalAvatar(this.scene);
      this.scene.activeCamera = this.player.renderCamera;
      this.combat.avatarFist = (side) => this.localAvatar?.fistBone(side) ?? null;
      this.combat.onMeleeSwing = () => this.localAvatar?.swing(this.progression.meleeAnimRate * this.combat.atkSpeedAffix);
      this.combat.pcAuto = true;
      this.combat.lootToBag = true;
      this.combat.onPickupBlocked = () => this.notifyToast("Руки заняты — сначала сними оружие (C)");
      this.combat.onLocalPickup = () => {
        this.localAvatar?.pickup();
        const p = this.player.position;
        this.net?.sendAct("pickup", p.x, p.y, p.z);
      };
      this.pcTarget = new PcTargeting(this.scene, () => this.net?.room?.state ?? null, this.netMobs);
      this.hud.setPcMode();
      this.pcInv = this.makePcInventory(false);
      // Esc: закрыть меню → окно → карту → снять цель → открыть меню.
      this.hud.escHook = () => {
        if (this.aoeAim?.active) {
          this.aoeAim.cancel();
          return true;
        }
        if (this.pcMenu?.close()) return true;
        if (this.questWin?.close() || this.shopWin?.close() || this.hunterWin?.close()) return true;
        if (this.pcInv?.close() || this.pcHud?.closeMap() || this.pcTarget?.clear()) return true;
        this.pcMenu?.open();
        return true;
      };
      this.pcHud = new PcHud({
        onCharacter: () => this.pcInv?.toggle("gear"),
        onBag: () => this.pcInv?.toggle("gear"),
        onMenu: () => this.pcMenu?.toggle(),
        onSlot: (key) => this.pcSlot(key),
        onAttrs: () => this.pcInv?.open("attrs"),
      });
      this.lootMarker = new LootMarker();
      this.aoeAim = new AoeAim(this.scene);
      this.pcTarget.onAttackStart = () => {
        this.fishing?.cancel();
        this.pcChase = true;
      };
      this.pcTarget.selfId = () => this.net?.sessionId;
      this.pcTarget.playerSeg = (sid) => this.avatars.get(sid)?.hitSegment() ?? null;
      this.pcTarget.heroLevel = () => this.progression.level;
      this.pcTarget.onError = (t) => this.notifyToast(t);
      this.pcTarget.canAttackPlayer = (sid) => {
        if (!this.net?.pvpOn) return "Включи PvP (клавиша P или в меню), чтобы атаковать игроков";
        const ps = this.net.room?.state.players.get(sid);
        if (ps && !ps.pvp) return `У ${ps.nick} PvP выключен — атаковать нельзя`;
        return null;
      };
      this.pcHover = new PcHover(this.canvas, (css) => {
        this.scene.defaultCursor = css;
        this.scene.hoverCursor = css || "pointer";
      });
      Mob.pcPlates = this.pcPlates;
    }

    // Общая громкость (слайдер в меню). Near-0 глушит звук, музыку и голос.
    const applyVol = (v: number): void => {
      this.sfx.setMasterVolume(v);
      this.voice.setOutputVolume(v);
    };
    let vol0 = 1;
    try {
      const s = localStorage.getItem("zep.volume");
      if (s !== null && Number.isFinite(Number(s))) vol0 = Math.max(0, Math.min(1, Number(s)));
    } catch {
      /* приватный режим */
    }
    applyVol(vol0);
    // Личные громкости музыки/эффектов (VR-меню, вкладка «Настройки») — сверху общей.
    const applyLevels = (): void => {
      this.sfx.setEffectsLevel(VR_SETTINGS.sfx);
      this.sfx.setMusicLevel(VR_SETTINGS.music);
    };
    applyLevels();
    // Микрофон и «звук по месту» — тоже личные настройки из меню (для всех, не только админа).
    const applyVoice = (): void => {
      LOADOUT.voice.mic = VR_SETTINGS.mic ? 1 : 0;
      LOADOUT.voice.spatial = VR_SETTINGS.spatial ? 1 : 0;
    };
    applyVoice();
    onVrSettingsChanged(applyLevels);
    onVrSettingsChanged(applyVoice);
    this.hud.bindVolume(
      () => this.sfx.masterVolume,
      (v) => {
        applyVol(v);
        try {
          localStorage.setItem("zep.volume", String(v));
        } catch {
          /* приватный режим */
        }
      },
    );

    if (this.pcThirdPerson || this.isTouch) {
      this.pcMenu = new PcMenu({
        touch: this.isTouch,
        getVolume: () => this.sfx.masterVolume,
        setVolume: (v) => {
          applyVol(v);
          try {
            localStorage.setItem("zep.volume", String(v));
          } catch {
            /* приватный режим */
          }
        },
        getMusic: () => VR_SETTINGS.music,
        setMusic: (v) => setVrSettings({ music: v }),
        getSfx: () => VR_SETTINGS.sfx,
        setSfx: (v) => setVrSettings({ sfx: v }),
        getMic: () => VR_SETTINGS.mic,
        setMic: (on) => setVrSettings({ mic: on }),
        getSpatial: () => VR_SETTINGS.spatial,
        setSpatial: (on) => setVrSettings({ spatial: on }),
        getChat: () => this.pcHud?.chatOn ?? true,
        setChat: (on) => this.pcHud?.setChatOn(on),
        getDmg: () => VR_SETTINGS.dmgNumbers,
        setDmg: (on) => setVrSettings({ dmgNumbers: on }),
        getSkin: () => this.mySkin,
        setSkin: (skin) => this.net?.sendSetSkin(skin),
        getLeaveBot: () => this.leaveBotOn,
        setLeaveBot: (on) => {
          this.leaveBotOn = on;
          this.hud.setLeaveBot(on);
          this.net?.sendSetLeaveBot(on);
        },
        getPvp: () => this.net?.pvpOn ?? false,
        setPvp: (on) => this.net?.sendPvp(on),
        fullscreen: () => toggleFullscreen(),
        exit: () => void this.leaveWorld(),
      });
    }

    // Звук просыпается по первому жесту; музыку заводим только при входе в
    // мир (enterWorld) — на экране ввода ника её быть не должно.
    const wake = () => this.sfx.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);

    // Выключатель микрофона: в шлеме он в панели настройки, на десктопе —
    // клавиша M, на смартфоне — кнопка сверху (появляется после доступа).
    const toggleMic = (): void => {
      LOADOUT.voice.mic = LOADOUT.voice.mic ? 0 : 1;
      setVrSettings({ mic: LOADOUT.voice.mic !== 0 }); // и в меню на руке, и запомнить
      this.notifyToast(LOADOUT.voice.mic ? "Микрофон включён" : "Микрофон выключен");
    };
    window.addEventListener("keydown", (e) => {
      // ПК в третьем лице: M — карта, микрофон — V.
      if (e.code !== (this.pcThirdPerson ? "KeyV" : "KeyM") || this.player.inVR) return;
      toggleMic();
    });
    this.micToggle = toggleMic;

    // Флаг PvP: на десктопе — клавиша P (в VR — строка в панели персонажа).
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyP" || this.player.inVR || !this.net?.online) return;
      this.net.sendPvp(!this.net.pvpOn);
    });

    // Зелье лечения на десктопе — X / 1 / F.
    window.addEventListener("keydown", (e) => {
      if (this.player.inVR || e.repeat) return;
      // ПК в третьем лице: 1 — автоатака, зелье — 3 (и X/F по-старому).
      const potionKey = this.pcThirdPerson ? "Digit3" : "Digit1";
      if (e.code !== "KeyX" && e.code !== potionKey && e.code !== "KeyF") return;
      const slot = this.inventory.slots.findIndex((s) => s.item === "potion" && s.count > 0);
      if (slot >= 0) this.inventory.use(slot);
    });

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.markStart();
      // Гарантия: VR-профиль включён ровно тогда, когда мы в шлеме — какие бы
      // события состояния XR ни пришли (или не пришли).
      if (this.player.inVR !== this.vrQualityOn) {
        if (this.player.inVR) this.applyVrQuality();
        else this.restoreFlatQuality();
      }
      this.zoneTick(dt, this.player.position, this.net?.worldClock ?? null);
      this.mark("zoneTick");
      // Автонаводка удара (только третье лицо на смартфоне) — до update(),
      // чтобы «глаза» взяли yaw. В VR не трогаем: там yaw крутит риг гарнитуры
      // и доворот к мобу воспринимается как «примагничивание взгляда».
      if (this.localAvatar && this.player.thirdPerson && (this.isTouch ? !this.pcTarget?.autoAttack : !this.pcTarget)) this.aimAssistTouch(dt);
      this.updatePcTarget(dt);
      this.updateTouchTarget(dt);
      this.player.update(dt);
      this.player.eyeForward.normalizeToRef(this.aim);
      this.mark("player");
      if (this.localAvatar) this.updateLocalAvatar(dt);
      if (this.pcThirdPerson) {
        const cp = this.player.renderCamera.position;
        const pp = this.player.position;
        fadeTreesOccluding(cp.x, cp.z, pp.x, pp.z);
      }
      this.mark("localAvatar");
      this.netMobs.update(dt, this.player.position, this.aim);
      this.mark("netMobs");
      const est = this.net?.room?.state;
      if (est && this.eventBeacon) {
        this.eventBeacon.set(est.eventKind, est.eventX, est.eventZ);
        this.eventBeacon.update(dt);
      }
      this.loot.update(dt, this.player.position);
      this.fishing?.update(dt);
      this.combat.update(dt);
      this.pcTarget?.update(this.combat.pcOutOfRange);
      this.mark("combat");
      this.updateSkillAbility(dt);
      this.combat.atkSpeedAffix = this.heldAtkSpeedMul();
      // Прицеливание луком/посохом: камера «в глаза», прицел, кнопка удара
      // управляет наводкой, кнопки зелья/рук прячутся.
      if (this.localAvatar) {
        const aim = this.combat.wantAim;
        this.player.setAiming(aim);
        this.hud.setAiming(aim);
        this.touchInput?.setAiming(aim);
        // Индикация накопления заряда: заливка кнопки ➤ + кольцо у прицела.
        const charge = aim ? this.combat.chargeLevel : 0;
        this.touchInput?.setFireCharge(charge);
        this.hud.setCharge(charge);
      }
      // Полоска маны в плоском режиме — только с посохом в руках.
      if (!this.player.inVR) {
        this.hud.setMana(
          this.manaMax > 0 ? this.combat.mana / this.manaMax : 0,
          MANA_ENABLED && this.combat.holdsStaff,
        );
      }
      if (this.pcHud) this.updatePcHud(dt);
      if (this.questWin) {
        // Подошёл к доске заданий — подсказка; отошёл — окно закрывается.
        const b = HUB.zones.questBoard;
        const pp = this.player.position;
        const near = Math.hypot(pp.x - b.x, pp.z - b.z) <= QUEST.boardReach;
        if (near && !this.nearQuestBoard && !this.player.inVR) this.notifyToast(this.isTouch ? "Доска заданий — тапни по ней" : "Доска заданий — нажми E");
        this.nearQuestBoard = near;
        const tv = HUB.zones.tavern;
        const nearT = Math.hypot(pp.x - tv.x, pp.z - tv.z) <= TAVERN_REACH;
        if (nearT && !this.nearTavern && !this.player.inVR) this.notifyToast(this.isTouch ? "Трактирщик — тапни по нему" : "Трактирщик — нажми E");
        this.nearTavern = nearT;
        const hu = HUB.zones.hunter;
        const nearH = Math.hypot(pp.x - hu.x, pp.z - hu.z) <= QUEST.boardReach;
        if (nearH && !this.nearHunter && !this.player.inVR) this.notifyToast(this.isTouch ? "Охотник — тапни по нему" : "Охотник — нажми E");
        this.nearHunter = nearH;
        this.questCompass?.update(pp.x, pp.z, this.player.cameraYaw);
        this.bangBoard?.update(dt);
        this.bangHunter?.update(dt);
      }
      this.hands.holding.left = this.combat.handOccupied("left");
      this.hands.holding.right = this.combat.handOccupied("right");
      this.hands.update(dt, daylightAt(LOADOUT.world.hour));
      this.mark("hands");
      this.syncNet(dt);
      this.mark("syncNet");
      this.updateVoice(dt);
      this.mark("voice");
      this.updateSmoothing();
      this.updateVrUi(dt);
      this.mark("vrUi");
      this.updateLowHealthVignette(dt);
      this.vrVignette?.tick(dt);
      this.vrWasted?.tick(dt);
      this.vrStars?.tick(dt);
      this.updateComfortVignette(dt);
      this.healCrossFx?.update(dt);
      this.crossFx.update(dt);
      this.healAura.update(dt);
      this.skillFx.update(dt);
      this.spellLights.setDaylight(dt, daylightAt(LOADOUT.world.hour));
      this.spellLights.setCrystal(
        this.combat.crystalWorldPos(),
        this.combat.crystalColor(),
        this.combat.chargeLevel,
      );
      const fl = this.netMobs.fireLight();
      this.spellLights.setFire(fl?.pos ?? null, fl?.power ?? 0, this.netMobs.fireBurn);
      this.mark("fx");
      this._botPos.length = 0;
      this._botFwd.length = 0;
      for (const av of this.avatars.values()) {
        if (!av.isBot) continue;
        this._botPos.push(av.position);
        this._botFwd.push(av.eyeForward);
      }
      // VR: свой факел перед собой, как у ботов, — если в руках не посох (у посоха свой свет от кристалла).
      if (this.player.inVR && !this.player.dead && !this.combat.holdsStaff) {
        this._botPos.push(this.player.eyePosition);
        this._botFwd.push(this.player.eyeForward);
      }
      this.botLights.update(
        dt,
        daylightAt(LOADOUT.world.hour),
        this.player.eyePosition,
        this._botPos,
        this._botFwd,
      );
      // Огни в шейдере земли/травы — ближайшие к своему герою, а не первые по порядку создания в сцене.
      this.lightFocus?.update(dt, this.player.position);
      this.mark("botLights");
      // Своя тень: игрок стоит «глазами», ноги ниже на eyeHeight.
      const eye = this.player.eyePosition;
      this.ownShadow.setEnabled(!this.player.dead);
      if (!this.player.dead) {
        this.ownShadow.place(eye.x, eye.y - PLAYER.eyeHeight, eye.z, 0.5);
      }
      this.applyWorldLoadoutIfChanged();
      this.updateHpBarFade();
      this.updateBossMusic();
      this.mark("rest");
      secEndFrame();
    });

    window.addEventListener("resize", () => this.engine.resize());
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
    this.applyOffFlags();
    if (new URLSearchParams(location.search).has("xrtest")) this.applyXrTestMode();
  }

  /**
   * `?xrtest=1` — ИСТИННО пустая сцена: прячем вообще все меши/свет, кроме
   * одного тестового кубика. Проверяет гипотезу «дело не в контенте, а в
   * самой настройке движка/XR с самого начала» — если и тут низкий fps,
   * значит баг не в контенте вообще, а в фундаменте (Engine/Scene/XR setup).
   */
  private applyXrTestMode(): void {
    const cube = MeshBuilder.CreateBox("xrTestCube", { size: 0.4 }, this.scene);
    const mat = new StandardMaterial("xrTestMat", this.scene);
    mat.diffuseColor = new Color3(1, 0.3, 0.3);
    cube.material = mat;
    cube.isPickable = false;
    // Висит перед головой — не зависит от того, где на карте игрок.
    this.scene.onBeforeRenderObservable.add(() => {
      const cam = this.scene.activeCamera;
      if (!cam) return;
      const f = cam.getDirection(Vector3.Forward());
      cube.position.copyFrom(cam.globalPosition).addInPlace(f.scale(2));
    });
    const run = (): void => {
      for (const m of this.scene.meshes) {
        if (m === cube || /^vrPerfHud$/.test(m.name)) continue;
        if (m.isEnabled()) m.setEnabled(false);
      }
      for (const l of this.scene.lights) l.setEnabled(l instanceof HemisphericLight);
      this.scene.fogEnabled = false;
      console.log(`[xrtest] мешей всего ${this.scene.meshes.length}, активен только xrTestCube`);
    };
    run();
    for (const ms of [1000, 3000, 6000, 10000]) setTimeout(run, ms);
  }

  /**
   * Диагностика: `?off=grass,fireflies,sky,trees,rocks,hub,mobs,bots` прячет
   * категории объектов, чтобы бинарным поиском найти, что роняет кадр в VR.
   * Повторяется — модели грузятся асинхронно.
   */
  private applyOffFlags(): void {
    const raw = new URLSearchParams(location.search).get("off") ?? (new URLSearchParams(location.search).has("lights") ? "-" : null);
    if (!raw) return;
    const off = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
    const rootNames = (m: { parent: unknown; name: string }): string[] => {
      const out: string[] = [];
      let n: unknown = m;
      while (n && typeof n === "object") {
        const nm = (n as { name?: string }).name;
        if (nm) out.push(nm);
        n = (n as { parent?: unknown }).parent;
      }
      return out;
    };
    const run = (): void => {
      let hidden = 0;
      for (const m of this.scene.meshes) {
        const names = rootNames(m).join("|");
        const mat = m.material?.name ?? "";
        const cats: string[] = [];
        if (/^grassBlade|^grassBush/.test(m.name)) cats.push("grass");
        if (/firefly/i.test(names)) cats.push("fireflies");
        if (/^stars$|^cloud|^skyDome$|^sun$/i.test(m.name)) cats.push("sky");
        if (/terrain|ground|^groundAo|hubGround|campGround/i.test(m.name + names)) cats.push("terrain");
        if (/bark|leaf|leav|Tree/i.test(mat + names)) cats.push("trees");
        if (/Rock/i.test(names)) cats.push("rocks");
        if (/hubFire/i.test(names) || /hubFire|hubGlow|hubSpark|hubCoal/i.test(m.name))
          cats.push("campfire");
        if (/\bhub\b|hub/i.test(names + m.name)) cats.push("hub");
        if (/\bmob\b/.test(names) || /monMush|monSlime|Bee|Frog|Cactoro|Orc/i.test(names + mat))
          cats.push("mobs");
        if (/avatar_/.test(names)) cats.push("bots");
        if (cats.some((c) => off.has(c)) && m.isEnabled()) {
          m.setEnabled(false);
          hidden++;
        }
      }
      if (off.has("fireflies")) this.fireflies.setLampBudget(0);
      // Диагностика света (GPU): ambient / sun — выключить источник; ?lights=N — потолок источников на материал.
      for (const l of this.scene.lights) {
        if ((off.has("ambient") && l.name === "ambient") || (off.has("sun") && l.name === "sun")) l.setEnabled(false);
      }
      const maxL = Number(new URLSearchParams(location.search).get("lights"));
      if (maxL > 0) for (const mt of this.scene.materials) if ((mt as { maxSimultaneousLights?: number }).maxSimultaneousLights !== undefined) (mt as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = maxL;
      // Кусты по имени TransformNode (на случай, если у мешей имена не говорящие).
      for (const [flag, node] of [
        ["campfire", "hubFire"],
        ["hub", "hub"],
      ] as const) {
        if (!off.has(flag)) continue;
        const t = this.scene.getTransformNodeByName(node);
        t?.getChildMeshes(false).forEach((cm) => {
          if (cm.isEnabled()) {
            cm.setEnabled(false);
            hidden++;
          }
        });
      }
      console.log(`[off] спрятано ${hidden} мешей категорий:`, [...off]);
    };
    run();
    for (const ms of [1500, 4000, 8000, 14000]) setTimeout(run, ms);
  }

  /** Готовность WebXR — экран входа ждёт её перед показом кнопки «Войти в VR». */
  xrReady: Promise<void> = Promise.resolve();

  /** Может ли это устройство в иммерсивный VR (шлем). Не виснет: таймаут 6 с. */
  async isVrAvailable(): Promise<boolean> {
    try {
      const xr = (navigator as { xr?: { isSessionSupported?(m: string): Promise<boolean> } }).xr;
      if (!xr?.isSessionSupported) {
        console.log("[xr] navigator.xr нет — VR недоступен");
        return false;
      }
      const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 6000));
      const ok = await Promise.race([xr.isSessionSupported("immersive-vr"), timeout]);
      console.log(`[xr] isSessionSupported(immersive-vr) = ${ok}`);
      return ok;
    } catch (e) {
      console.warn("[xr] проверка VR упала:", e);
      return false;
    }
  }

  get inVR(): boolean {
    return this.player.inVR;
  }

  /**
   * Запустить VR-сессию. Зовётся ИЗ обработчика клика без `await` перед этим —
   * иначе браузер теряет «жест пользователя» и `requestSession` отклоняется.
   * Поэтому `xrReady` дожидается экран входа, а тут только синхронная проверка.
   */
  /**
   * VR-экран входа идёт уже ПОСЛЕ buildZone (см. main.ts) — ночная подсветка
   * (пятерка ламп-светлячков + пара факелов у ботов, всё PointLight) заранее
   * под VR не подстроить. На деле шлем заметно слабее десктопа и рендерит
   * дважды (два глаза): те же источники, что на ПК почти бесплатны, в VR
   * ночью тормозили так, что было заметно — и пропадало ровно на рассвете,
   * когда обе системы гаснут. Гасим их совсем, как только вошли в VR.
   */
  private vrQualityOn = false;
  private applyVrQuality(): void {
    if (this.vrQualityOn) return;
    this.vrQualityOn = true;
    // Единственное, что режем в VR: ночные PointLight'ы (лампы светлячков +
    // факелы ботов). В шлеме каждый источник считается дважды (два глаза) и
    // ночью это ощутимо тормозило; днём они и так погашены. Всё остальное —
    // трава, разрешение, эффекты — на максимуме, как на десктопе.
    this.fireflies.setLampBudget(0);
    // Факелы героев ночью в VR оставляем, но не больше двух ближайших (каждый источник
    // считается на оба глаза); свет костра лагеря и заклинаний по-прежнему выключен.
    this.botLights.setBudget(2);
    vrLights.off = true;
    vrLights.spell = true; // свет посоха/огнешара ночью в VR — есть (костёр лагеря — нет)
    // ОТКЛЮЧЕНО по умолчанию: промежуточный gl.flush() (glFlushPacing) в браузере Quest приводит к тому, что
    // отрисовки ПОСЛЕ сброса пропадают (нет мобов, камней, крон деревьев, травы) — прежний «прирост fps» был
    // от недорисованного кадра. Включается только явным `?flush=<доля>` для диагностики.
    if (!this.flushPacing && new URLSearchParams(location.search).has("flush")) {
      this.flushPacing = installFlushPacing(this.engine, Number(new URLSearchParams(location.search).get("flush")));
    }
    // Гарантия нативного разрешения буфера глаза.
    if (this.engine.getHardwareScalingLevel() !== 1) this.engine.setHardwareScalingLevel(1);
    console.log("[xr] VR: ночные лампы off, разрешение нативное, остальное — максимум");
  }

  /** Вернуть всё при выходе из VR. */
  private restoreFlatQuality(): void {
    if (!this.vrQualityOn) return;
    this.vrQualityOn = false;
    this.fireflies.setLampBudget(Infinity); // дефолт — без ограничения
    this.botLights.setForceOff(false);
    vrLights.off = false;
    vrLights.spell = false;
    this.flushPacing?.dispose();
    this.flushPacing = null;
  }

  enterVR(): Promise<boolean> {
    if (!this.xr) return Promise.resolve(false);
    const base = this.xr.baseExperience;
    if (base.state === WebXRState.IN_XR) {
      this.applyVrQuality();
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (ok) this.applyVrQuality();
        resolve(ok);
      };
      // Резолвимся по ФАКТУ входа в XR, а не по промису enterXRAsync — тот на
      // части шлемов не резолвится, и экран входа завис бы навсегда (в VR его
      // всё равно не видно). Плюс страховка по таймауту.
      const obs = base.onStateChangedObservable.add((s) => {
        if (s === WebXRState.IN_XR) {
          base.onStateChangedObservable.remove(obs);
          done(true);
        }
      });
      setTimeout(() => {
        base.onStateChangedObservable.remove(obs);
        done(base.state === WebXRState.IN_XR);
      }, 15000);
      base.enterXRAsync("immersive-vr", "local-floor").catch((e: unknown) => {
        console.warn("не удалось войти в VR:", e);
        done(base.state === WebXRState.IN_XR);
      });
    });
  }

  /** Инициализация WebXR. Вход в VR — по кнопке с экрана входа (см. enterVR). */
  initXR(): Promise<void> {
    this.xrReady = this.setupXR();
    return this.xrReady;
  }

  private async setupXR(): Promise<void> {
    if (!("xr" in navigator)) return;
    // Разрешение буфера глаза. Babylon по умолчанию framebufferScaleFactor=1
    // (= «рекомендованное» браузером). `?fbscale=` переопределяет — только для
    // теста, по умолчанию НЕ трогаем, чтобы не загонять GPU в репроекцию.
    const qp = new URLSearchParams(location.search);
    const fsRaw = Number(qp.get("fbscale"));
    // По умолчанию в шлеме буфер глаза ×1.4 от рекомендованного (×2 упирался в GPU: фрагментов вдвое больше) и без MSAA: так картинка чётче и гладко без
    // сглаживания краёв (свой выбор игрока; по замерам MSAA почти не влияла на fps). `?fbscale=<0.5..2>`
    // меняет разрешение, `?aa=1` включает MSAA.
    const isHeadset = /OculusBrowser|Quest|PicoBrowser|Pico/i.test(navigator.userAgent);
    const fbScale =
      Number.isFinite(fsRaw) && fsRaw > 0 ? Math.min(2, Math.max(0.5, fsRaw)) : isHeadset ? 1.4 : 1;
    // ?noaa=1 — без MSAA у буфера глаза. Резолв MSAA на большом стерео-RT
    // может стоить 10-20 мс на GPU шлема даже при пустой сцене.
    // Браузер автономного шлема (Quest/Pico): режим Layers (multiview — один проход на
    // оба глаза) включён по умолчанию — это ~2× по CPU-части кадра. `?layers=0` — без него.
    // Сглаживание: MSAA (у Quest тайловая GPU — самый дешёвый вариант; FXAA/постпроцесс
    // в VR — отдельные полноэкранные проходы, их не используем). `?noaa=1` — выключить.
    const headsetBrowser = /OculusBrowser|Quest|PicoBrowser|Pico/i.test(navigator.userAgent);
    const aa = qp.has("aa") ? true : qp.has("noaa") ? false : !isHeadset;
    try {
      this.xr = await WebXRDefaultExperience.CreateAsync(this.scene, {
        floorMeshes: [this.ground],
        disableTeleportation: true,
        disablePointerSelection: true, // без лазера у контроллеров
        // Трекинг рук Babylon включает по умолчанию: 2×25 мешей-суставов в сцене и ~50 чтений поз
        // суставов из XR каждый кадр. Игра управляется контроллерами — не нужен.
        disableHandTracking: true,
        inputOptions: { doNotLoadControllerMeshes: true }, // рисуем свои кисти
        outputCanvasOptions: {
          // Полный набор — Babylon НЕ мержит с дефолтами, а заменяет целиком.
          canvasOptions: {
            antialias: aa,
            depth: true,
            stencil: true,
            alpha: true,
            framebufferScaleFactor: fbScale,
          },
        },
      });
    } catch (e) {
      console.warn("WebXR недоступен:", e);
      return;
    }

    // WebXR Layers + multiview: оба глаза за один проход (~1.5× по кадру), НО
    // на части сборок Quest-браузера с ним не входит в сессию — поэтому только
    // по явному `?layers=1`.
    if (qp.get("layers") !== "0" && (qp.has("layers") || headsetBrowser)) {
      try {
        this.xr.baseExperience.featuresManager.enableFeature(
          WebXRFeatureName.LAYERS,
          "latest",
          { preferMultiviewOnInit: true, projectionLayerInit: { antialias: aa, scaleFactor: fbScale } },
        );
        console.log("[xr] WebXR Layers включены (multiview)");
      } catch (e) {
        console.warn("[xr] WebXR Layers не включились:", e);
      }
    }

    // Своей кнопкой входа управляет экран входа. Штатную кнопку Babylon
    // прячем, но держим для ПОВТОРНОГО входа, если игрок вышел из VR.
    const overlay = this.xr.enterExitUI?.overlay;
    if (overlay) {
      overlay.style.top = "16px";
      overlay.style.right = "16px";
      overlay.style.bottom = "auto";
      overlay.style.display = "none";
    }

    const base = this.xr.baseExperience;
    base.onStateChangedObservable.add((state) => {
      if (overlay) overlay.style.display = state === WebXRState.NOT_IN_XR ? "" : "none";
      if (state === WebXRState.IN_XR) {
        this.sfx.resume();
        setGrassVr(true); // облегчённая трава в шлеме
        this.netMobs.fxRange = VR_FX_RANGE; // дальние снаряды/вспышки не рисуем
        this.applyVrQuality(); // на случай входа мимо enterVR() (штатная кнопка Babylon)
        this.requestMaxFrameRate();
        this.tuneXrRendering();
        this.player.enterXR(base.camera);
        this.xrInput = new XRInput(this.xr!);
        this.player.setInput(this.xrInput);
        this.hands.attach(this.xr!);
        this.buildVrUi();
      } else if (state === WebXRState.NOT_IN_XR) {
        setGrassVr(false);
        this.netMobs.fxRange = Infinity;
        // Убранное за спину НЕ роняем: в плоском режиме его не достать, но
        // при возврате в VR и при следующем входе оно на месте.
        this.player.exitXR();
        this.xrInput = null;
        this.player.setInput(this.defaultInput());
        this.scene.activeCamera = this.player.renderCamera;
        this.hands.detach(this.xr!);
        this.tearDownVrUi();
        this.restoreFlatQuality();
      }
    });
  }

  /**
   * Целевая частота кадров шлема. РАНЬШЕ просили максимум (120 на Quest 3) —
   * но приложение столько не тянет, и просьба о 120 только заставляет
   * композитор чаще репроецировать. Теперь по умолчанию 72 Гц (родной дефолт
   * Quest-браузера, самый стабильный), `?hz=90` / `?hz=120` — переопределить.
   */
  private requestMaxFrameRate(tries = 20): void {
    const retry = (ms: number): void => {
      if (tries > 0) setTimeout(() => this.requestMaxFrameRate(tries - 1), ms);
    };
    const sm = this.xr?.baseExperience.sessionManager;
    if (!sm || !sm.inXRSession) {
      retry(400);
      return;
    }
    const rates = sm.supportedFrameRates;
    if (!rates || rates.length === 0) {
      retry(400);
      return;
    }
    const want = Number(new URLSearchParams(location.search).get("hz")) || 72;
    const list = Array.from(rates).sort((a, b) => a - b);
    // Ближайшая поддерживаемая, не выше желаемой (иначе самая низкая).
    const target = [...list].reverse().find((r) => r <= want + 0.5) ?? list[0];
    if (!Number.isFinite(target) || Math.abs(target - (sm.currentFrameRate ?? 0)) < 1) {
      console.log(`[xr] частота кадров ${sm.currentFrameRate} Гц (цель ${target}) — ок`);
      return;
    }
    sm.updateTargetFrameRate(target)
      .then(() => console.log(`[xr] частота кадров -> ${target} Гц (было ${sm.currentFrameRate ?? "?"})`))
      .catch((e: unknown) => {
        console.warn("[xr] частоту кадров сменить не вышло:", e);
        retry(800);
      });
  }

  /**
   * Разовая донастройка рендера шлема после старта сессии: фиксированная
   * фовеация (периферия рендерится грубее — экономит GPU, глазом почти не
   * видно) и лог фактического разрешения буфера глаза, чтобы понимать,
   * упирается ли картинка в разрешение или в частоту кадров.
   */
  private tuneXrRendering(): void {
    const sm = this.xr?.baseExperience.sessionManager;
    if (!sm) return;
    try {
      // Лёгкая фиксированная фовеация: периферия чуть грубее (глазом почти не
      // видно), центр — как есть. `?fov=` переопределяет (0 — выкл, 1 — макс).
      if (sm.isFixedFoveationSupported) {
        sm.fixedFoveation = ffrLevel();
        console.log(`[xr] фиксированная фовеация = ${sm.fixedFoveation}`);
      }
      // Режим Layers (multiview): baseLayer нет, фовеация задаётся на самом слое
      // (по умолчанию там 0 — то есть выключена).
      else {
        const layer = (sm.session?.renderState as { layers?: { fixedFoveation?: number }[] })?.layers?.[0];
        if (layer && typeof layer.fixedFoveation === "number") {
          layer.fixedFoveation = ffrLevel();
          console.log(`[xr] фовеация слоя = ${layer.fixedFoveation}`);
        }
      }
    } catch (e) {
      console.warn("[xr] фовеацию задать не вышло:", e);
    }
    // Разрешение буфера глаза (после того как слой создан).
    setTimeout(() => {
      const layer = (sm.session?.renderState as { baseLayer?: XRWebGLLayer })?.baseLayer;
      if (layer) {
        console.log(
          `[xr] буфер глаза ${layer.framebufferWidth}×${layer.framebufferHeight}, ` +
            `частота ${sm.currentFrameRate ?? "?"} Гц`,
        );
      }
    }, 1500);
  }

  requestPointerLock(): void {
    if (this.isTouch || this.pcThirdPerson) return;
    // В новых браузерах возвращает Promise; в песочнице предпросмотра он
    // отклоняется (WrongDocumentError) — гасим, чтобы не было висящего reject.
    void Promise.resolve(this.canvas.requestPointerLock() as unknown).catch(() => {});
  }

  /**
   * Диагностика из консоли: какие кнопки контроллеров сейчас нажаты.
   * Если панель персонажа не открывается — зажми нужную кнопку, вызови
   * `game.vrButtons()` и поставь её индекс в LOADOUT.buttons.panelToggle.
   */
  vrButtons(): unknown {
    if (!this.xrInput) return "не в VR (или контроллеры ещё не подключились)";
    return this.xrInput.dumpButtons();
  }

  /**
   * Печатает текущие значения экипировки готовым блоком для вставки в
   * src/config/loadout.ts. Так подобранное (в т.ч. в шлеме) переносится в
   * файл — единственное надёжное место, не привязанное к адресу/браузеру.
   */
  printLoadout(): void {
    printLoadout();
  }

  private probe = { relight: 0, lightToggle: 0, matDirty: 0, lastLight: "", madWho: "" };
  /** Тайминги секций кадровой логики (мс, сглажено) — видно в ?perf=1/?fps=1. */
  private readonly secTimes: Record<string, number> = {};
  private secT0 = 0;
  private markStart(): void {
    this.secT0 = performance.now();
  }
  private mark(name: string): void {
    const t = performance.now();
    const dt = t - this.secT0;
    this.secTimes[name] = this.secTimes[name] === undefined ? dt : this.secTimes[name] * 0.85 + dt * 0.15;
    this.secT0 = t;
  }
  /** Считаем, кто дёргает свет/материалы каждый кадр (только под ?perf=1). */
  private installPerfProbes(): void {
    const p = this.probe;
    const scn = this.scene as unknown as {
      markAllMaterialsAsDirty: (f: number, cb?: unknown) => void;
    };
    const origMAD = scn.markAllMaterialsAsDirty.bind(this.scene);
    const flags: Record<number, number> = {};
    scn.markAllMaterialsAsDirty = (f: number, cb?: unknown) => {
      p.matDirty++;
      flags[f] = (flags[f] ?? 0) + 1;
      // Стек: показываем 3 «интересных» кадра (не Game/обёртку).
      const st = (new Error().stack ?? "")
        .split("\n")
        .slice(2, 12)
        .map((l) => l.trim().replace(/^at\s+/, "").replace(/https?:\/\/[^ )]+\//, ""))
        .filter((l) => l && !/markAllMaterialsAsDirty|installPerfProbes/.test(l));
      p.madWho =
        Object.entries(flags)
          .map(([k, v]) => `f${k}:${v}`)
          .join(" ") +
        " | " +
        st.slice(0, 3).join(" << ");
      return origMAD(f, cb);
    };
    // Патчим сеттеры BaseTexture, которые дёргают markAllMaterialsAsDirty —
    // показываем ИМЯ текстуры (nameTagTex / skyGrad / sayTex / …).
    try {
      const bt = this.scene.textures[0];
      if (bt) {
        let proto = Object.getPrototypeOf(bt) as object | null;
        while (proto && !Object.getOwnPropertyDescriptor(proto, "hasAlpha")) {
          proto = Object.getPrototypeOf(proto);
        }
        const d = proto && Object.getOwnPropertyDescriptor(proto, "hasAlpha");
        if (d?.set && d.get && proto) {
          const set = d.set;
          Object.defineProperty(proto, "hasAlpha", {
            get: d.get,
            set(this: { name?: string; _hasAlpha?: boolean }, v: boolean) {
              if (this._hasAlpha !== v) {
                p.madWho = `hasAlpha:${this.name ?? "?"}=${v}`;
              }
              set.call(this, v);
            },
          });
        }
      }
    } catch {
      /* не критично */
    }
    // setEnabled — идём вверх по цепочке прототипов до того, у кого он ЕСТЬ (Node).
    const anyLight = this.scene.lights[0];
    if (anyLight) {
      let proto = Object.getPrototypeOf(anyLight) as Record<string, unknown> | null;
      while (proto && !Object.prototype.hasOwnProperty.call(proto, "setEnabled")) {
        proto = Object.getPrototypeOf(proto);
      }
      const orig = proto?.setEnabled as ((v: boolean) => void) | undefined;
      if (proto && orig) {
        (proto as { setEnabled: (v: boolean) => void }).setEnabled = function (
          this: { getClassName?: () => string; name?: string },
          v: boolean,
        ) {
          const cn = this.getClassName?.() ?? "";
          if (/Light/.test(cn)) {
            p.lightToggle++;
            p.lastLight = `${this.name ?? "?"}=${v}`;
          }
          return orig.call(this, v);
        };
      }
    }
  }

  /** Какие шейдеры движок скомпилировал с прошлого вызова — ищем per-frame пересборку. */
  private diffEffects(): string[] {
    const cache = (this.engine as unknown as { _compiledEffects?: Record<string, unknown> })
      ._compiledEffects;
    if (!cache) return this.lastNewEffects;
    const added: string[] = [];
    for (const k of Object.keys(cache)) {
      if (!this.prevEffectKeys.has(k)) {
        this.prevEffectKeys.add(k);
        // Ключ = "<vertex>+<fragment>@<defines>". Имя шейдера + характерные define'ы.
        const at = k.indexOf("@");
        const name = at > 0 ? k.slice(0, at) : k;
        const defs = at > 0 ? k.slice(at + 1) : "";
        const flags = (defs.match(/#define (FOG|INSTANCES|INSTANCESCOLOR|CLIPPLANE\d?|LOGARITHMICDEPTH|NUM_BONE_INFLUENCERS \d|LIGHT\d|SHADOW\d|THIN_INSTANCES|MORPHTARGETS)\b/g) ?? [])
          .map((d) => d.replace("#define ", ""))
          .join(",");
        added.push(`${name} [${flags || defs.length + "б"}]`);
      }
    }
    if (added.length) this.lastNewEffects = [...this.lastNewEffects, ...added].slice(-8);
    return this.lastNewEffects;
  }

  /** Топ секций кадровой логики по мс — сглаженные тайминги markStart/mark. */
  private sectionsStr(): string {
    return Object.entries(this.secTimes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v.toFixed(1)}`)
      .join(" ");
  }

  /** Подсекции кода (?sec=1 или ?perf=1): в консоли `game.secReport()` — топ по мс на кадр. */
  secReport(top = 24): string {
    return secReport(top);
  }

  /** Диагностика производительности VR: `game.vrDiag()` из консоли. */
  vrDiag(): Record<string, unknown> {
    const sm = this.xr?.baseExperience.sessionManager;
    const layer = (sm?.session?.renderState as { baseLayer?: XRWebGLLayer } | undefined)?.baseLayer;
    if (this.lightPerf) {
      // Лёгкий режим (?fps=1): без обхода мешей и инструментовки.
      return {
        fps: Math.round(this.engine.getFps()),
        xrFrameRate: sm?.currentFrameRate ?? null,
        eyeBuffer: layer ? `${layer.framebufferWidth}x${layer.framebufferHeight}` : null,
        hardwareScaling: this.engine.getHardwareScalingLevel(),
        activeMeshes: this.scene.getActiveMeshes().length,
        totalMeshes: this.scene.meshes.length,
        sections: this.sectionsStr(),
      subSections: secReport(),
      };
    }
    const grass = this.scene.getMeshByName("grassBlade");
    // Разбивка активных мешей по «основе» имени (без цифр/координат/instance) —
    // видно поимённо, кто плодит меши.
    const active = this.scene.getActiveMeshes();
    const bucket: Record<string, number> = {};
    const stem = (name: string): string =>
      name
        .replace(/\s*\(.*$/, "") // "(instance of ...)"
        .replace(/[_.-]?-?\d[\d._-]*$/, "") // хвост из цифр/координат
        .replace(/\d+/g, "") // цифры внутри
        .trim() || "?";
    for (let i = 0; i < active.length; i++) {
      const m = active.data[i];
      if (!m) continue;
      const k = stem(m.name);
      bucket[k] = (bucket[k] ?? 0) + 1;
    }
    return {
      inVR: this.player.inVR,
      isTouch: this.isTouch,
      quality: this.quality,
      hardwareScaling: this.engine.getHardwareScalingLevel(),
      vrProfileOn: this.vrQualityOn,
      fps: Math.round(this.engine.getFps()),
      msFrame: this.perfInstr ? Math.round(this.perfInstr.frameTimeCounter.current) : null,
      msJS: this.perfInstr ? Math.round(this.perfInstr.interFrameTimeCounter.current) : null,
      msCull: this.perfInstr
        ? Math.round(this.perfInstr.activeMeshesEvaluationTimeCounter.current)
        : null,
      msRender: this.perfInstr ? Math.round(this.perfInstr.renderTimeCounter.current) : null,
      drawCalls: this.perfInstr?.drawCallsCounter.current ?? null,
      shaderMs: this.engInstr ? Math.round(this.engInstr.shaderCompilationTimeCounter.current) : null,
      shaderN: this.engInstr ? this.engInstr.shaderCompilationTimeCounter.count : null,
      probeMatDirty: this.probe.matDirty,
      probeLightToggle: this.probe.lightToggle,
      probeLastLight: this.probe.lastLight,
      probeMadWho: this.probe.madWho,
      probeRelight: `relight ${RELIGHT_STATS.count} (${RELIGHT_STATS.last})`,
      newEffects: this.diffEffects(),
      xrFrameRate: sm?.currentFrameRate ?? null,
      xrSupportedRates: sm?.supportedFrameRates ? Array.from(sm.supportedFrameRates) : null,
      eyeBuffer: layer ? `${layer.framebufferWidth}x${layer.framebufferHeight}` : null,
      fixedFoveation: sm?.fixedFoveation ?? null,
      grassEnabled: grass ? grass.isEnabled() : "нет меша",
      fxaa: !!this.fxaa,
      sharpen: !!this.sharpen,
      activeMeshes: active.length,
      totalMeshes: this.scene.meshes.length,
      lights: this.scene.lights.filter((l) => l.isEnabled()).length,
      byCategory: bucket,
      sections: this.sectionsStr(),
      subSections: secReport(),
    };
  }

  /**
   * Положение убранных за спину предметов (меч/лук/щит × левая/правая).
   * Меняется на лету: `game.stowConfig().sword.left.pos[2] = -0.2`.
   */
  stowConfig(): typeof STOW {
    return STOW;
  }

  // ---- VR-интерфейс ----

  private buildVrUi(): void {
    const cam = this.xr!.baseExperience.camera;

    // Полоса здоровья висит в мире, но следует за головой без наклона —
    // остаётся параллельной горизонту.
    this.hudAnchor = new TransformNode("hudAnchor", this.scene);
    const hp = LOADOUT.hud.hpPos;
    this.playerBar3D = new HealthBar3D(
      this.scene,
      this.hudAnchor,
      new Vector3(hp[0], hp[1], hp[2]), // положение правится в панели настройки
      0.675, // в 1.5 раза длиннее
      false,
      0.05, // вдвое тоньше
    );
    this.playerBar3D.set(this.player.hp / this.player.maxHp);
    this.fpsCounter?.attachVr(this.scene, this.hudAnchor, new Vector3(hp[0], hp[1], hp[2]));
    // Полоска маны — под здоровьем, чуть уже. Видна только когда в руках посох.
    this.manaBar3D = new HealthBar3D(
      this.scene,
      this.hudAnchor,
      new Vector3(hp[0], hp[1] - 0.075, hp[2]),
      0.5,
      false,
      0.035,
      "mana",
    );
    this.manaBar3D.setOpacity(0);

    this.vrHud = new VrHud(this.scene, this.hudAnchor);
    this.vrVignette = new VrVignette(this.scene);
    const headCam = this.xr?.baseExperience.camera ?? this.scene.activeCamera;
    this.vrWasted = new VrWasted(this.scene, headCam);
    this.vrStars = new VrStunStars(this.scene, headCam);
    this.comfortVignette = new ComfortVignette(this.scene, headCam);
    this.healCrossFx = new HealCrossFx(this.scene, this.player);

    if (this.showPerfHud || this.lightPerf) {
      if (this.showPerfHud && !this.lightPerf && !this.perfInstr) {
        this.installPerfProbes();
        this.perfInstr = new SceneInstrumentation(this.scene);
        this.perfInstr.captureActiveMeshesEvaluationTime = true;
        this.perfInstr.captureRenderTime = true;
        this.perfInstr.captureInterFrameTime = true;
        this.perfInstr.captureFrameTime = true;
        this.perfInstr.captureParticlesRenderTime = true;
        this.engInstr = new EngineInstrumentation(this.engine);
        this.engInstr.captureShaderCompilationTime = true;
      }
      this.perfHud = new VrPerfHud(this.scene, this.hudAnchor, this.lightPerf);
    }

    // Панели цепляются к кистям (или к контроллеру, если кисть ещё не создана).
    this.wristPanel = new WristMenu(
      this.scene,
      this.handNode("left", cam),
      this.progression,
      this.inventory,
    );
    // Выход из игры: спрашиваем «оставить бота?» — ответ уходит на сервер перед
    // выходом. Небольшая пауза перед самим leaveWorld() — без неё сообщение
    // setLeaveBot и последующий разрыв соединения уходят почти одновременно,
    // и на некоторых сетях/устройствах флаг не успевал долететь до сервера
    // раньше закрытия сокета (бот не оставался, хотя игрок отметил галочку).
    this.wristPanel.onExit = (keepBot) => {
      this.leaveBotOn = keepBot;
      if (this.net?.online) this.net.sendSetLeaveBot(keepBot);
      setTimeout(() => void this.leaveWorld(), 300);
    };
    this.wristPanel.onSkin = (skin) => this.net?.sendSetSkin(skin);
    this.wristPanel.onTogglePvp = () => {
      if (this.net?.online) this.net.sendPvp(!this.net.pvpOn);
    };
    this.wristPanel.onAction = (a) => this.menuWeaponAction(a);
    this.wristPanel.onQuestSelect = (it) => this.setQuestCompass(it);
    this.wristPanel.onEnchant = (id) => {
      this.vrEnchId = id;
      this.vrEnchAt = null; // поставим перед игроком в ближайшем кадре
      this.vrEnchResult = null;
      this.wristPanel?.hide();
      this.net?.sendPcInvOpen();
    };
    this.wristPanel.onTitle = (t) => this.net?.sendPcInvAct({ act: "title", id: t, idx: 0 });
    if (this.questData) this.wristPanel.setQuests(this.questData);
    this.loadoutPanel = new LoadoutPanel(this.scene, this.handNode("right", cam));
    // Перевод времени в панели уходит на сервер — часы общие для всей зоны.
    this.loadoutPanel.onWorldTime = (hour, auto) => this.net?.sendSetTime(hour, auto);
    this.loadoutPanel.onClearWorld = () => this.net?.sendClearWorld();
    // «Сохранить» онлайн: положения/свет — ВСЕМ (общая подгонка на сервере),
    // голос/сглаживание — по токену этого игрока/устройства. buildVrUi()
    // перевызывается на каждый вход в VR (не только один раз при загрузке
    // страницы) — раньше здесь стоял тернарник по net.online В МОМЕНТ ЭТОГО
    // ВЫЗОВА: если он совпадал с окном переподключения, onSaveServer навсегда
    // становился null до следующего входа в VR, хотя панель всё равно
    // показывала «сохранено ✓» (эта отметка чисто локальная). Проверяем
    // net.online внутри самого колбэка — на актуальном состоянии на момент нажатия.
    this.loadoutPanel.onSaveServer = () => {
      if (!this.net?.online) return;
      this.net.sendSetWorldLoadout(worldLoadoutSnapshot());
      this.net.sendLoadout(exportOverrides());
    };
  }

  private lastWorldLoadout = "";
  /** Общая подгонка с сервера — применяем, когда меняется (дёшево: сравнение строк). */
  private applyWorldLoadoutIfChanged(): void {
    const w = this.net?.worldLoadout ?? "{}";
    if (w === this.lastWorldLoadout) return;
    this.lastWorldLoadout = w;
    if (w && w !== "{}") applyWorldLoadout(w);
  }

  /** Ник этого игрока — задаётся из main.ts после входа. */
  setNick(nick: string): void {
    this.localNick = nick;
  }

  /** Вошли в мир (после экрана ввода ника). Заводим фоновую музыку. */
  enterWorld(): void {
    this.sfx.startMusic(TOWN_MUSIC, 0.065); // фон — только в мире
  }

  /** Админ (ADMIN_NICKS) — открывает панель настройки экипировки в VR. */
  private get isAdmin(): boolean {
    return isAdminNick(this.localNick);
  }

  private handNode(side: "left" | "right", fallback: Node): Node {
    return (
      this.hands.nodeFor(side) ??
      this.xr?.input.controllers.find((c) => c.inputSource.handedness === side)?.grip ??
      fallback
    );
  }

  private tearDownVrUi(): void {
    this.perfHud?.dispose();
    this.perfHud = null;
    this.fpsCounter?.dispose();
    this.fpsCounter = null;
    this.wristPanel?.dispose();
    this.wristPanel = null;
    this.loadoutPanel?.dispose();
    this.loadoutPanel = null;
    this.playerBar3D?.dispose();
    this.playerBar3D = null;
    this.manaBar3D?.dispose();
    this.manaBar3D = null;
    this.vrHud?.dispose();
    this.vrHud = null;
    this.vrCull?.dispose();
    this.vrCull = null;
    this.hudAnchor?.dispose();
    this.hudAnchor = null;
    this.vrVignette?.dispose();
    this.vrVignette = null;
    this.vrWasted?.dispose();
    this.vrWasted = null;
    this.vrStars?.dispose();
    this.vrStars = null;
    this.comfortVignette?.dispose();
    this.comfortVignette = null;
    this.healCrossFx?.dispose();
    this.healCrossFx = null;
  }

  private updateVrUi(dt: number): void {
    const cam = this.xr?.baseExperience.camera;
    if (this.hudAnchor && cam) {
      // Позиция головы + только рыскание: панель не заваливается вместе с обзором.
      this.hudAnchor.position.copyFrom(cam.globalPosition);
      const f = cam.getDirection(new Vector3(0, 0, 1));
      this.hudAnchor.rotation.set(0, Math.atan2(f.x, f.z), 0);
    }

    // Полоска жизней правится в панели настройки — подхватываем на лету.
    const hp = LOADOUT.hud.hpPos;
    this.playerBar3D?.moveTo(hp[0], hp[1], hp[2]);
    this.manaBar3D?.moveTo(hp[0], hp[1] - 0.075, hp[2]);
    // Баффы — строкой значков под полосками жизни/маны.
    this.vrHud?.placeBuffs(hp[0], hp[1] - 0.125, hp[2]);

    const inp = this.player.lastInput;
    if (inp.panelToggle) this.wristPanel?.toggle();
    this.wristPanel?.setPvp(this.net?.pvpOn ?? false);
    this.wristPanel?.setLeaveBot(this.leaveBotOn);
    if (this.wristPanel) {
      const h = this.combat.handsSnapshot();
      const self = this.net?.self;
      this.wristPanel.setHands(
        h.right ? ({ ...h.right, affix: self?.rightAffix || undefined } as WornWeapon) : null,
        h.left ? ({ ...h.left, affix: self?.leftAffix || undefined } as WornWeapon) : null,
      );
    }
    if (this.vrCull && this.vrCull.vr !== this.player.inVR) {
      this.vrCull.dispose();
      this.vrCull = null;
    }
    if (!this.vrCull) this.vrCull = new VrCull(this.scene, this.player.inVR); // деревья/камни вдали и пустые корни glTF — не считаем
    this.vrCull.update(dt, this.player.eyePosition, this.player.eyeForward);
    // Надписи в VR: затухание, «кто говорит» (голос игроков + озвучка чата — одним видом).
    if (this.vrHud) {
      this.vrHud.update(dt);
      const names: string[] = [];
      for (const id of this.voiceSpeakers) {
        const n = this.net?.room?.state.players.get(id)?.nick;
        if (n) names.push(n);
      }
      if (this.ttsNick) names.push(this.ttsNick);
      this.vrHud.setSpeakers(names);
    }
    // Слушаю ли озвучку чата Twitch: сообщаем серверу при смене (VR + настройка в меню).
    const wantTts = this.player.inVR && VR_SETTINGS.tts ? 1 : 0;
    if (wantTts !== this.ttsListenSent && this.net?.online) {
      this.ttsListenSent = wantTts;
      this.net.sendTtsListen(wantTts === 1);
      if (!wantTts) this.tts?.clear();
    }
    // Каст массового хила: стоим на месте.
    if (this.xrInput) this.xrInput.moveLocked = this.combat.chargingMass;
    if (this.wristPanel) {
      // Меню открыто — левый стик выбирает пункты, а не двигает героя.
      if (this.xrInput) this.xrInput.menuOpen = this.wristPanel.visible;
      this.wristPanel.setStowed(
        this.combat.stowedSnapshot().map((s) => ({ ...s }) as WornWeapon & { side: "left" | "right" }),
      );
      const wh = this.net?.warehouse;
      if (wh) this.wristPanel.setWarehouse(wh.list, wh.equipped);
      const ray = this.wristPanel.visible ? this.menuPointerRay() : null;
      // Пока правая рука — лазерная указка меню, её оружие и хваты «глухие».
      this.combat.uiLockHand = ray ? "right" : null;
      this.wristPanel.update({
        navX: inp.menuNavX,
        navY: inp.menuNavY,
        confirm: inp.uiConfirm,
        tabNext: inp.uiNext,
        ray,
        trigger: inp.rightTrigger,
        dt,
      });
    }
    try {
      this.updateVrPanels(inp);
    } catch (e) {
      // Сбой панели не должен рвать кадр; в журнал — один раз.
      if (!this.vrPanelErr) console.error("[vrPanels]", e);
      this.vrPanelErr = true;
    }
    this.perfHud?.update(dt, () => this.vrDiag());
    this.fpsCounter?.update(dt);

    // Панель настройки экипировки: открыть — только 5 нажатий B за 3 с
    // (чтобы случайно не всплывала). Открытую закрывает одиночный B.
    this.tuneClock += dt;
    if (inp.tuneToggle && this.isAdmin) {
      if (this.loadoutPanel?.visible) {
        this.loadoutPanel.toggle();
        this.tuneTaps.length = 0;
      } else if (!this.wristPanel?.visible) {
        this.tuneTaps.push(this.tuneClock);
        this.tuneTaps = this.tuneTaps.filter((t) => this.tuneClock - t <= 3);
        if (this.tuneTaps.length >= 5) {
          this.loadoutPanel?.toggle();
          this.tuneTaps.length = 0;
        }
      }
    }
    this.loadoutPanel?.update(inp.tuneNavY, inp.tuneDec, inp.tuneInc, inp.tuneStep, dt);
    // Пока панель настройки открыта, X/Y/A меняют значения (движение свободно).
    if (this.xrInput) this.xrInput.tuneOpen = this.loadoutPanel?.visible ?? false;

    // Панели цепляются к кистям, как только контроллеры появились.
    for (const [side, panel] of [
      ["left", this.wristPanel],
      ["right", this.loadoutPanel],
    ] as const) {
      const node = this.hands.nodeFor(side);
      if (node && panel && panel.anchor !== node) panel.reparent(node);
    }
  }

  /** Баннер события: обычный (плоский) HUD + панель в VR, где DOM не виден. */
  private notifyBanner(title: string, sub = "", tone: "warn" | "win" = "warn", loot?: LootItem[]): void {
    this.hud.banner(title, sub, tone, loot);
    this.pcHud?.log("event", sub ? `${title} — ${sub}` : title);
    this.vrHud?.showBanner(title, sub, tone);
  }

  private notifyToast(text: string): void {
    this.hud.toast(text);
    this.pcHud?.log("system", text);
    this.vrHud?.showToast(text);
  }

  /** Озвучка чата Twitch в VR (сервер шлёт только тем, кто включил в меню). */
  private playChatTts(url: string, nick: string): void {
    if (!this.player.inVR || !VR_SETTINGS.tts) return;
    const vol = (): number => 0.9 * this.sfx.masterVolume * VR_SETTINGS.sfx;
    if (this.tts) {
      this.tts.setVolume(vol());
      this.tts.enqueue(url, nick);
      return;
    }
    if (this.ttsLoading) return;
    this.ttsLoading = true;
    void this.sfx.resume();
    void import("../spectator/SpectatorTts").then(({ SpectatorTts }) => {
      const t = new SpectatorTts(this.sfx.audioContext(), vol());
      t.onSpeaking = (n) => {
        this.ttsNick = n ?? "";
      };
      this.tts = t;
      this.ttsLoading = false;
      t.enqueue(url, nick);
    });
  }

  /** Действия с оружием из меню на руке: склад ↔ рука/спина, обмен рука ↔ плечо, на землю, на лом. */
  private menuWeaponAction(a: MenuAction): void {
    // Переодевание во время рыбалки — сначала сматываем удочку (иначе она
    // оставалась в руке, а новое оружие пряталось/показывалось вперемешку).
    this.fishing?.cancel();
    const toast = (t: string): void => this.notifyToast(t);
    const fail = (err: string | null): boolean => {
      if (err) toast(err);
      return !!err;
    };
    switch (a.act) {
      case "toWarehouse":
        this.combat.removeToWarehouse(a.src, a.side);
        toast("Убрано на склад");
        return;
      case "handToBack":
        fail(this.combat.handToBack(a.side));
        return;
      case "backToHand":
        fail(this.combat.backToHand(a.side));
        return;
      case "whToBack":
        fail(this.combat.placeOnBackFromWarehouse(a.cls, a.tier, a.side));
        return;
      case "whToHand": {
        if (fail(this.combat.placeInHandFromWarehouse(a.cls, a.tier, a.side))) return;
        // Какой рукой держим — по ней сервер закрепляет именно этот инстанс (с его роллами).
        const h = this.combat.handsSnapshot();
        const hand = h.left?.cls === a.cls && h.left.tier === a.tier ? "left" : "right";
        this.net?.sendWarehouseAct({ id: a.id, act: "hand", hand });
        return;
      }
      case "drop":
      case "scrap": {
        // Если этот инстанс сейчас в руке — сначала убираем его из руки.
        const eq = this.net?.warehouse?.equipped;
        if (eq?.left === a.id) this.combat.removeToWarehouse("hand", "left");
        if (eq?.right === a.id) this.combat.removeToWarehouse("hand", "right");
        if (a.act === "drop") this.combat.suppressAutoPickup(); // не подбирать обратно, пока не отойдёшь
        this.net?.sendWarehouseAct({ id: a.id, act: a.act });
        toast(a.act === "scrap" ? "Разобрано на лом" : "Брошено на землю");
        return;
      }
    }
  }

  /** Окно снаряжения ПК-стиля (ПК и телефон; на телефоне — тап-меню и перетаскивание пальцем). */
  private makePcInventory(touch: boolean): PcInventory {
    const afterGear = (): void => {
      // Руки меняет клиент сразу, склад/закрепление — сервер чуть позже.
      window.setTimeout(() => this.pcInv?.refresh(), 250);
    };
    return new PcInventory({
      touch,
      request: () => this.net?.sendPcInvOpen(),
      useItem: (id) => {
        const slot = this.inventory.slots.findIndex((s) => s.item === id && s.count > 0);
        if (slot >= 0) this.inventory.use(slot);
      },
      act: (m) => this.net?.sendPcInvAct(m),
      hands: () => {
        const h = this.combat.handsSnapshot();
        return {
          left: h.left ? { cls: h.left.cls, tier: h.left.tier } : null,
          right: h.right ? { cls: h.right.cls, tier: h.right.tier } : null,
        };
      },
      equip: (w, side) => {
        // Рука — по виду предмета, а не по тому, на какой слот бросили:
        // щит — левая; лук/посох — правая (лук держат обе); меч — правая,
        // левая — только вторым мечом к мечу в правой. Иначе посох уезжал в
        // левую (где был лук), и потом щит уже некуда было взять.
        const h = this.combat.handsSnapshot();
        let hand: "left" | "right" = w.cls === "shield" ? "left" : "right";
        if (w.cls === "sword" && side === "left" && h.right?.cls === "sword") hand = "left";
        this.menuWeaponAction({ act: "whToHand", side: hand, id: w.id, cls: w.cls, tier: w.tier });
        afterGear();
      },
      toBag: (side) => {
        this.menuWeaponAction({ act: "toWarehouse", src: "hand", side });
        afterGear();
      },
      scrap: (w) => {
        this.menuWeaponAction({ act: "scrap", id: w.id, cls: w.cls, tier: w.tier });
        afterGear();
      },
      drop: (w) => {
        this.menuWeaponAction({ act: "drop", id: w.id, cls: w.cls, tier: w.tier });
        afterGear();
      },
    });
  }

  private readonly _menuRay = new Ray(Vector3.Zero(), Vector3.Forward(), 2);
  private readonly _panelRay = new Ray(Vector3.Zero(), Vector3.Forward(), 6);

  /** Луч правого контроллера (VR) — указка для панелей в мире. */
  private rightPointerRay(): { origin: Vector3; dir: Vector3 } | null {
    const right = this.xr?.input.controllers.find((c) => c.inputSource.handedness === "right");
    if (!right) return null;
    right.getWorldPointerRayToRef(this._panelRay);
    return { origin: this._panelRay.origin, dir: this._panelRay.direction };
  }

  /**
   * VR: у доски/Охотника/трактирщика перед ними открывается панель (подошёл —
   * открылась, отошёл — закрылась); рыбалка — панель перед игроком. Всё
   * нажимается лазером правой руки + курком.
   */
  private updateVrPanels(inp: { rightTrigger: boolean }): void {
    if (!this.player.inVR) {
      this.vrNpcPanel?.hide();
      this.vrFishPanel?.hide();
      this.vrEnchPanel?.hide();
      this.vrCompass?.update(Vector3.Zero(), 0, false);
      return;
    }
    const scene = this.scene;
    this.vrNpcPanel ??= new VrPanel(scene, "vrNpcPanel", 1024, 1400, 0.9);
    this.vrFishPanel ??= new VrPanel(scene, "vrFishPanel", 1024, 400, 0.8);
    if (!this.vrCompass) {
      this.vrCompass = new VrCompass(scene);
      this.vrCompass.set(this.vrCompassT);
    }
    {
      const cam = this.player.renderCamera;
      const f = cam.getDirection(Vector3.Forward());
      this.vrCompass.update(cam.globalPosition, Math.atan2(f.x, f.z), true);
    }
    const head = this.player.renderCamera.globalPosition;
    const p = this.player.position;
    const spots = [
      // Чуть ближе, чем «рядом» для кнопок: панель не должна всплывать на проходе.
      { kind: "board" as const, at: HUB.zones.questBoard, reach: QUEST.boardReach - 0.8 },
      { kind: "hunter" as const, at: HUB.zones.hunter, reach: QUEST.boardReach - 0.8 },
      { kind: "tavern" as const, at: HUB.zones.tavern, reach: TAVERN_REACH - 0.6 },
    ];
    const near = spots.find((sp) => Math.hypot(p.x - sp.at.x, p.z - sp.at.z) <= sp.reach) ?? null;
    const ray = this.rightPointerRay();
    let onPanel = false;
    const npc = this.vrNpcPanel;
    if (!near) {
      npc.hide();
      this.vrNpcKind = null;
    } else {
      if (this.vrNpcKind !== near.kind) {
        this.vrNpcKind = near.kind;
        if (near.kind === "tavern") this.net?.sendShopOpen();
        else this.net?.sendQuestOpen();
        const act = (m: QuestActMsg): void => this.net?.sendQuestAct(m);
        this.vrNote = null;
        npc.show((ui) => {
          if (near.kind === "board") drawBoard(ui, this.questData, act);
          else if (near.kind === "hunter") drawHunter(ui, this.questData, act);
          else drawShop(ui, this.shopData, (id) => this.net?.sendShopBuy(id));
          drawNote(ui, this.vrNoteText());
        });
      }
      // Между NPC и игроком, на уровне глаз, лицом к игроку.
      const dx = p.x - near.at.x;
      const dz = p.z - near.at.z;
      const d = Math.hypot(dx, dz) || 1;
      const k = Math.min(1.2, d * 0.5) / d;
      npc.place(new Vector3(near.at.x + dx * k, head.y - 0.05, near.at.z + dz * k), head);
      onPanel = npc.update(ray, inp.rightTrigger) || onPanel;
    }
    // Рыбалка.
    const fp = this.vrFishPanel;
    const fs = this.fishing?.vrState();
    if (!fs || fs.phase === "idle") {
      if (fp.visible) fp.hide();
    } else {
      if (!fp.visible) {
        fp.show((ui) => {
          const st = this.fishing?.vrState();
          if (st) drawFishing(ui, st, (m) => this.fishing?.choose(m), () => this.fishing?.cancel());
        });
        const fwd = this.player.renderCamera.getDirection(Vector3.Forward());
        const fl = Math.hypot(fwd.x, fwd.z) || 1;
        fp.place(new Vector3(head.x + (fwd.x / fl) * 1.1, head.y - 0.25, head.z + (fwd.z / fl) * 1.1), head);
      }
      fp.markDirty(); // мини-игра — живая метка
      const was = this.fishPrevTrig;
      onPanel = fp.update(ray, inp.rightTrigger) || onPanel;
      void was; // подсечку курком ведёт сама рыбалка (Fishing.update)
      // Подсечка рывком удочки вверх (правая рука быстро вверх) — как курок.
      if (fs.phase === "mini") {
        const right = this.xr?.input.controllers.find((c) => c.inputSource.handedness === "right");
        const node = right?.grip ?? right?.pointer;
        const now = performance.now();
        if (node) {
          const y = node.getAbsolutePosition().y;
          const dtS = (now - this.jerkAt) / 1000;
          if (this.jerkAt > 0 && dtS > 0 && dtS < 0.2) {
            const vy = (y - this.jerkY) / dtS;
            if (vy > 1.6 && now - this.jerkHitAt > 350) {
              this.jerkHitAt = now;
              this.fishing?.hit();
            }
          }
          this.jerkY = y;
          this.jerkAt = now;
        }
      } else this.jerkAt = 0;
      this.fishPrevTrig = inp.rightTrigger;
    }
    // Заточка.
    this.vrEnchPanel ??= new VrPanel(scene, "vrEnchPanel", 1024, 1024, 0.8);
    const ep = this.vrEnchPanel;
    if (!this.vrEnchId || (this.vrEnchAt && Vector3.Distance(this.vrEnchAt, p) > 3)) {
      if (ep.visible) ep.hide();
      this.vrEnchId = null;
    } else {
      if (!this.vrEnchAt) {
        this.vrEnchAt = p.clone();
        const fwd = this.player.renderCamera.getDirection(Vector3.Forward());
        const fl = Math.hypot(fwd.x, fwd.z) || 1;
        ep.place(new Vector3(head.x + (fwd.x / fl) * 1.0, head.y - 0.1, head.z + (fwd.z / fl) * 1.0), head);
        ep.show((ui) => {
          const id = this.vrEnchId ?? "";
          const wh = this.pcInvData;
          const inHand = !!wh && (wh.equipped.left === id || wh.equipped.right === id);
          drawEnchant(
            ui,
            wh,
            id,
            inHand,
            this.vrEnchResult,
            (idx) => {
              this.vrEnchResult = null;
              this.net?.sendPcInvAct({ act: "enchant", id, idx });
            },
            () => (this.vrEnchId = null),
          );
        });
      }
      onPanel = ep.update(ray, inp.rightTrigger) || onPanel;
    }
    if (onPanel) this.combat.uiLockHand = "right";
  }
  private fishPrevTrig = false;
  /** VR: рывок удочкой — прошлая высота правой руки и время. */
  private jerkY = 0;
  private jerkAt = 0;
  private jerkHitAt = 0;
  private vrPanelErr = false;
  /** VR: итог последнего действия у NPC — показываем в панели ~5 с (нет панели — тост). */
  private vrNote: { text: string; at: number } | null = null;
  private vrNoteSet(text: string): void {
    this.vrNote = { text, at: performance.now() };
    if (this.vrNpcPanel?.visible) this.vrNpcPanel.markDirty();
    else this.vrHud?.showToast(text);
  }
  private vrNoteText(): string | null {
    const n = this.vrNote;
    return n && performance.now() - n.at < 5000 ? n.text : null;
  }
  private vrCompass: VrCompass | null = null;
  private lightFocus: LightFocus | null = null;

  /** Компас к заданию (ПК/телефон — HTML, VR — стрелка перед игроком). null — выключить. */
  private setQuestCompass(q: TrackItem | null): void {
    if (!q) {
      this.questCompass?.set(null);
      this.vrCompass?.set(null);
      return;
    }
    const pp = this.player.position;
    // Готово — к месту сдачи (доска / Охотник); контракт недели — тоже к Охотнику.
    const toHunter = q.src !== "daily" && (q.done || q.src === "weekly");
    const pt = q.done || q.src === "weekly" ? (toHunter ? HUB.zones.hunter : HUB.zones.questBoard) : questPoint(q, pp.x, pp.z);
    const name = q.done || q.src === "weekly" ? (toHunter ? "Охотник" : "Доска заданий") : q.title;
    const t = { x: pt.x, z: pt.z, name };
    this.questCompass?.set(t);
    this.vrCompass?.set(t);
    this.vrCompassT = t;
  }
  private vrCompassT: { x: number; z: number; name: string } | null = null;

  /**
   * Лазер меню: появляется, когда правую руку поднесли к меню на левой руке
   * (ближе ~0.5 м к панели). Луч — указка правого контроллера.
   */
  private menuPointerRay(): { origin: Vector3; dir: Vector3 } | null {
    const panel = this.wristPanel;
    const right = this.xr?.input.controllers.find((c) => c.inputSource.handedness === "right");
    if (!panel || !right) return null;
    const node = right.grip ?? right.pointer;
    const hand = node?.getAbsolutePosition();
    if (!hand) return null;
    if (Vector3.Distance(hand, panel.mesh.getAbsolutePosition()) > 0.65) return null;
    right.getWorldPointerRayToRef(this._menuRay);
    return { origin: this._menuRay.origin, dir: this._menuRay.direction };
  }

  private lowHpT = 0;
  private tuneClock = 0;
  private tuneTaps: number[] = [];

  /** Постоянная красная виньетка: тем сильнее и быстрее пульсирует, чем меньше HP. */
  private updateLowHealthVignette(dt: number): void {
    const frac = this.player.hp / this.player.maxHp;
    this.vrVignette?.setHealth(frac);

    const t = VIGNETTE.lowHpFrom;
    const low = t <= 0 ? 0 : Math.max(0, Math.min(1, (t - frac) / t));
    this.lowHpT += dt * (3 + low * 4);
    const pulse = 1 + VIGNETTE.lowPulse * low * Math.sin(this.lowHpT);
    this.hud.setLowHealth(low * low * VIGNETTE.lowMaxAlpha * pulse);
  }

  /**
   * Чёрная виньетка при перемещении левым стиком (VR): сужает обзор на время
   * движения. Общий выключатель — на сервере (ставит админ в панели настроек).
   */
  private updateComfortVignette(dt: number): void {
    if (!this.comfortVignette) return; // существует только в VR
    // Личные настройки игрока (меню «Настройки»): виньетка по умолчанию вкл,
    // телепорт по умолчанию выкл. Общего (серверного) значения больше нет.
    const allowed = VR_SETTINGS.vignette;
    const teleport = VR_SETTINGS.teleport;
    this.player.setTeleportMode(teleport);

    const inp = this.player.lastInput;
    // Заявка: без плавности — любое, даже лёгкое отклонение стика включает
    // виньетку на полную сразу (при телепорте непрерывного движения нет —
    // тоннель не нужен, только блинк).
    const moving = !teleport && Math.hypot(inp.moveX, inp.moveY) > 0.02;
    // Поворот (snap-turn) — держим виньетку секунду после него.
    if (inp.lookYaw !== 0) this.vignetteTurnT = 0.25;
    else this.vignetteTurnT = Math.max(0, this.vignetteTurnT - dt);
    this.comfortVignette.tick(dt, moving || this.vignetteTurnT > 0, allowed);
    if (this.player.consumeTeleportBlink()) this.comfortVignette.blink();
  }

  private showHp(hp: number): void {
    this.hud.setHp(hp, this.player.maxHp);
    this.pcHud?.setHp(hp, this.player.maxHp);
    this.playerBar3D?.set(hp / this.player.maxHp);
    this.shownHp = hp;
  }
  private shownHp = -1;

  /**
   * Своё состояние с сервера: здоровье, смерть, прокачка.
   * Онлайн это единственный источник правды — клиент только отображает.
   */
  private serverHp = -1;
  /** Когда последний раз сработал вампиризм у себя — чтобы не рисовать зелёные крестики поверх красных. */
  private lastVampAt = 0;

  private syncSelf(dt: number, self: PlayerState): void {
    this.hud.setSkin(self.skin);
    this.wristPanel?.setSkin(self.skin);
    this.localAvatar?.setSkin(self.skin);
    this.mySkin = self.skin;
    // Крестики — по РОСТУ серверного HP (не клиентского: тот проседает
    // предсказанным уроном раньше патча, и рост назад читался как «лечение»).
    // Повышение уровня тоже подливает HP — там крестики оранжевые.
    const leveledUp = this.serverHp >= 0 && self.level > this.progression.level;
    if (leveledUp) this.healCrossFx?.burst(1, CROSS_ORANGE);
    if (
      !leveledUp &&
      this.serverHp > 0 &&
      self.hp - this.serverHp > 2 &&
      self.dead !== 1 &&
      !this.player.dead &&
      performance.now() - this.lastVampAt > 600
    ) {
      this.healCrossFx?.burst(Math.min(1, (self.hp - this.serverHp) / 30));
    }
    this.serverHp = self.hp;
    this.player.setHp(self.hp);
    const inTower = (self.towerFloor ?? 0) > 0; // в башне баффы не действуют — не показываем
    this.localAvatar?.setBuffed(!inTower && (self.buffSecs ?? 0) > 0);
    this.localAvatar?.setStunned(self.stunned === 1);
    this.vrStars?.setStunned(self.stunned === 1 && !self.dead);
    if (!this.pcHud) this.hud.setBuff(self.buffSecs ?? 0); // с рамкой героя баффы — значками в ней
    // «Тепло костра» (лагерь): сообщение при получении, значок с таймером на ПК.
    const camp = self.campBuffSecs ?? 0;
    this.localAvatar?.setCampWarm(!inTower && camp > 0);
    this.localAvatar?.setScrolls(!inTower && (self.scrollWindSecs ?? 0) > 0, !inTower && (self.scrollXpSecs ?? 0) > 0);
    this.player.speedMul = !inTower && (self.scrollWindSecs ?? 0) > 0 ? SCROLL.windMul : 1;
    if (camp > this.lastCampBuff + 60) this.notifyToast("🔥 Тепло костра: защита +20% на 10 минут");
    this.lastCampBuff = camp;
    const buffs = buffList(self);
    this.pcHud?.setBuffs(buffs);
    this.vrHud?.setBuffs(buffs);
    if (Math.abs(self.hp - this.shownHp) > 0.01) this.showHp(self.hp);
    // Мана: сервер — источник правды. Но пока копится заряд, клиент ведёт
    // свой отсчёт (сервер спишет ману только по факту каста), иначе
    // предсказание «мана кончилась на середине» не сработало бы.
    this.manaMax = self.maxMana;
    if (!this.combat.chargingMagic) this.combat.mana = self.mana;

    const dead = self.dead === 1;
    if (dead !== this.player.dead) {
      this.player.dead = dead;
      this.deathCountdown = dead ? RESPAWN.delay : 0;
      if (dead) {
        this.fishing?.cancel();
        this.hud.flashDamage(40);
        this.vrVignette?.flash(40);
        this.vrVignette?.setDeath(true);
        this.vrWasted?.setDead(true);
      } else {
        this.vrVignette?.setDeath(false);
        this.vrWasted?.setDead(false);
        // Единственное место, где реально снимаем экран смерти: self.dead —
        // источник правды. onRespawn раньше делал это тоже, сам по себе,
        // отдельным сообщением — если патч состояния приходил чуть позже
        // него, вот этот блок ловил уже устаревшее dead:1 и включал экран
        // смерти заново, уже без пары, которая его выключит.
        this.hud.setDead(false);
      }
    }
    if (dead) {
      this.deathCountdown = Math.max(0, this.deathCountdown - dt);
      this.hud.setDead(true, this.deathCountdown);
    }

    // Звук глотка — по подтверждённой сервером убыли, а не по нажатию:
    // на полном здоровье сервер зелье не тратит.
    const potions = this.potionCount();
    this.inventory.applyRemote(self.bag);
    const left = this.potionCount();
    if (left < potions) this.sfx.drink();

    // Прокачку применяем только при изменении: applyRemote перерисовывает панель.
    const p = this.progression;
    if (
      p.level !== self.level ||
      p.xp !== self.xp ||
      p.unspent !== self.unspent ||
      STAT_NAMES.some((k) => p.stats[k] !== self[k])
    ) {
      p.applyRemote({
        level: self.level,
        xp: self.xp,
        unspent: self.unspent,
        str: self.str,
        agi: self.agi,
        int: self.int,
        con: self.con,
        luc: self.luc,
        wis: self.wis,
      });
    }
  }

  /** Полоса здоровья: видна при уроне и пока не полное HP, иначе плавно гаснет. */
  private bossMusicOn = false;

  /** Рядом с живым боссом играет boss.mp3, вдали / после смерти — обычная. */
  private updateBossMusic(): void {
    let near = false;
    const mobs = this.net?.room?.state.mobs;
    if (mobs) {
      const p = this.player.position;
      mobs.forEach((m) => {
        if (m.kind !== "boss" || m.dead) return;
        const d = Math.hypot(m.x - p.x, m.z - p.z);
        // Гистерезис: заходим ближе musicRange, выходим дальше musicOut.
        if (d < BOSS.musicRange || (this.bossMusicOn && d < BOSS.musicOut)) near = true;
      });
    }
    if (near === this.bossMusicOn) return;
    this.bossMusicOn = near;
    this.sfx.setMusic(near ? BOSS_MUSIC : TOWN_MUSIC, near ? 0.095 : 0.065);
  }

  private updateHpBarFade(): void {
    const injured = this.player.hp < this.player.maxHp - 0.5;
    const t = this.player.sinceHurt;
    let opacity: number;
    if (injured || t < HUD.showTime) opacity = 1;
    else opacity = Math.max(0, 1 - (t - HUD.showTime) / HUD.fadeTime);
    this.hud.setOpacity(opacity);
    this.playerBar3D?.setOpacity(opacity);
    // Мана: показываем только с посохом в руках; ярче, пока копится заряд.
    if (this.manaBar3D) {
      const show = MANA_ENABLED && this.combat.holdsStaff;
      const bright = this.combat.chargingMagic || this.combat.mana < this.manaMax - 0.5;
      this.manaBar3D.setOpacity(show ? (bright ? 1 : opacity) : 0);
      this.manaBar3D.set(this.manaMax > 0 ? this.combat.mana / this.manaMax : 0);
    }
  }

  /** Тач-ввод (когда он активен) — Game дёргает setAiming при прицеливании. */
  private touchInput: TouchInput | null = null;
  /** Переключатель микрофона — для кнопки на экране (смартфон). */
  private micToggle: (() => void) | null = null;

  private defaultInput(): InputSource {
    if (!this.isTouch) {
      this.desktopInput = new DesktopInput(this.canvas, this.pcThirdPerson);
      return this.desktopInput;
    }
    this.touchInput = new TouchInput();
    // Умение лучника — прицел пальцем, как на ПК; меч/посох — как раньше, сразу.
    this.touchInput.abilityHook = () => {
      if (!this.aoeAim || this.combat.abilityKind !== "arrowRain" || this.combat.holdsStaff) return false;
      this.pcSkill();
      return true;
    };
    return this.touchInput;
  }

  /** ПК-экран: рамка героя, опыт, панель действий, карты, «+N опыта» в журнал. */
  private updatePcHud(dt: number): void {
    const h = this.pcHud!;
    const prog = this.progression;
    const kind = this.combat.abilityKind;
    const icon: WeaponIcon =
      kind === "stunBash" ? "sword" : kind === "arrowRain" ? "bow" : this.combat.holdsStaff ? "staff" : "fist";
    h.setIdentity(this.localNick || "Герой", prog.level, icon);
    this.pcPlates.level = prog.level;
    h.setUnspent(prog.unspent);
    h.setMana(this.manaMax > 0 ? this.combat.mana / this.manaMax : 0, MANA_ENABLED && this.combat.holdsStaff);
    h.setXp(prog.level, prog.xp / Math.max(1, prog.xpToNext()), prog.atMaxLevel);
    this.pcInv?.setXp(prog.level, prog.xp / Math.max(1, prog.xpToNext()), prog.atMaxLevel);
    h.setAutoAttack(!!this.pcTarget?.autoAttack);
    if (this.combat.holdsStaff) {
      const left = this.combat.massHealCdLeft;
      h.setSkill("massHeal", "Массовое лечение", left / (MAGIC.heal.massCooldown + 0.4), left);
    } else {
      h.setSkill(
        kind,
        kind === "stunBash" ? "Оглушающий удар" : kind === "arrowRain" ? "Град стрел" : null,
        kind && this.skillCdTotal > 0 ? this.skillCdLeft / this.skillCdTotal : 0,
        kind ? this.skillCdLeft : 0,
      );
    }
    let pots = 0;
    for (const s of this.inventory.slots) if (s.item === "potion") pots += s.count;
    h.setPotions(pots);

    // «+N опыта» / «Уровень N» — в журнал по изменению.
    const lx = this.pcLastXp;
    if (lx && prog.level === lx.level && prog.xp > lx.xp + 0.5) {
      h.log("xp", `+${Math.round(prog.xp - lx.xp).toLocaleString("ru-RU")} опыта`);
    } else if (lx && prog.level > lx.level) {
      h.log("xp", `Новый уровень: ${prog.level}!`);
    }
    this.pcLastXp = { level: prog.level, xp: prog.xp };

    const st = this.net?.room?.state;
    const p = this.player.position;
    const d: MapData = {
      px: p.x,
      pz: p.z,
      yaw: this.player.facing,
      camYaw: this.player.cameraYaw,
      players: [],
      mobs: [],
      event: st && st.eventKind ? { x: st.eventX, z: st.eventZ } : null,
      targetId: this.pcTarget?.targetId ?? null,
    };
    if (st) {
      const self = this.net?.sessionId;
      st.players.forEach((ps, id) => {
        if (id === self) return;
        d.players.push({ x: ps.head.x, z: ps.head.z, bot: id.startsWith("bot:"), nick: ps.nick });
      });
      st.mobs.forEach((m) => {
        if (m.dead || m.kind === "shard") return;
        d.mobs.push({ x: m.x, z: m.z, elite: !!m.mobName, boss: m.kind === "boss" });
      });
    }
    const hr = ((LOADOUT.world.hour % 24) + 24) % 24;
    const clock = `${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
    h.updateMaps(dt, d, clock);
  }

  /**
   * ПК «как в WoW»: клики/Tab/1 → цель и автоатака; при автоатаке герой сам
   * разворачивается к цели (если игрок не рулит ПКМ).
   */
  private updatePcTarget(dt: number): void {
    const pt = this.pcTarget;
    const di = this.desktopInput;
    if (!pt || !di) return;
    const cam = this.player.renderCamera;
    const click = di.takeClick();
    // Прицел града стрел: ЛКМ — применить в круг (если дотягиваемся), ПКМ — отмена.
    if (this.aoeAim?.active) {
      this.aoeAim.update(di.mouseX, di.mouseY, cam, this.player.position, SKILL.arrowRain.range);
      if (this.combat.abilityKind !== "arrowRain" || this.player.dead) this.aoeAim.cancel();
      else if (click?.button === 2) this.aoeAim.cancel();
      else if (click?.button === 0) {
        if (this.aoeAim.inRange) {
          this.castSkill("arrowRain", this.aoeAim.point.x, this.aoeAim.point.z);
          this.aoeAim.cancel();
        } else {
          this.notifyToast(`Слишком далеко — град стрел бьёт до ${SKILL.arrowRain.range} м`);
        }
      }
    } else if (click) {
      this.worldClick(click, cam);
    }
    if (di.takeTab()) pt.tab(cam);
    if (di.takeAttack()) pt.toggleAttack(cam);
    if (this.player.dead) pt.autoAttack = false;
    this.lootMarker?.update(dt, !!this.player.autoMove, (id) => this.loot.hasDrop(id));
    this.updatePcHover(dt);
    const seg = pt.segment();
    this.combat.pcTarget = seg;
    this.combat.pcAttack = pt.autoAttack && !!seg;
    this.updatePcChase(seg, pt.autoAttack);
    this.faceTarget(seg, pt.autoAttack);
  }

  /** Атакуем — герой всегда лицом к цели (и на бегу, и стоя, и под ПКМ). */
  private faceTarget(seg: { a: Vector3; b: Vector3 } | null, attacking: boolean): void {
    if (seg && attacking && !this.player.dead) {
      const cx = (seg.a.x + seg.b.x) / 2;
      const cz = (seg.a.z + seg.b.z) / 2;
      const p = this.player.position;
      const lock = this.player.faceLock ?? { x: cx, z: cz };
      lock.x = cx;
      lock.z = cz;
      this.player.faceLock = Math.hypot(cx - p.x, cz - p.z) < 80 ? lock : null;
    } else {
      this.player.faceLock = null;
    }
  }

  /**
   * Клик мышью (ПК) / тап (телефон) по миру: NPC лагеря, предмет на земле или
   * моб/игрок. Первый клик — выбрать, повторный / двойной / ПКМ — действие.
   */
  private worldClick(click: MouseClick, cam: Camera): void {
    // Табличка «Рыбачить» над берегом (телефон) — выбор режима рыбалки.
    const sign = this.fishing?.signPos();
    if (sign && this.pcTarget && this.pcTarget.pointAt(click.x, click.y, cam, this.canvas, [sign], 70) === 0) {
      this.fishing?.openChooser();
      return;
    }
    // Моб под курсором — выбор цели; иначе, может, оружие на земле:
    // двойной ЛКМ или ПКМ по нему — добежать и подобрать.
    // Лут мелкий и лежит там, где умирают мобы, — попадание по нему важнее моба рядом.
    const loot = this.lootAt(click.x, click.y);
    const npc = loot ? null : this.npcAt(click.x, click.y);
    if (npc) {
      // Первый клик — выбрать; повторный / двойной / ПКМ — подбежать и открыть окно.
      const now = performance.now();
      const go = this.npcSel === npc || click.button === 2 || now - this.lastNpcClick < 450;
      this.lastNpcClick = now;
      this.npcSel = npc;
      if (go) this.walkToNpc(npc);
    } else if (loot) {
      // Первый клик — выбрать предмет (обводка держится), повторный клик по
      // выбранному / двойной / ПКМ — добежать и поднять.
      const now = performance.now();
      const again = this.lootMarker?.selectedId === loot.id;
      const dbl = click.button === 0 && this.lastLootClick?.id === loot.id && now - this.lastLootClick.t < 450;
      this.lastLootClick = { id: loot.id, t: now };
      const mesh = this.loot.meshOf(loot.id);
      const go = again || dbl || click.button === 2;
      if (go) {
        this.pcChase = false;
        this.walkToLoot(loot.pos);
      }
      if (mesh) this.lootMarker?.show(loot.id, mesh, go, true);
    } else {
      // Клик мимо предмета — снять выбор предмета (если к нему не бежим).
      if (!this.player.autoMove) this.lootMarker?.hide();
      this.npcSel = null;
      this.pcTarget?.handleClick(click, cam, this.canvas);
    }
  }

  /**
   * Телефон: тап по мобу — цель (повторный тап — атаковать, герой подбегает и
   * бьёт сам, как на ПК), по NPC/доске — подбежать и открыть, по предмету —
   * выбрать / подбежать и поднять. Кнопки атаки при этом работают как раньше.
   */
  private updateTouchTarget(dt: number): void {
    const pt = this.pcTarget;
    const ti = this.touchInput;
    if (!pt || !ti || this.player.inVR) return;
    const cam = this.player.renderCamera;
    const tap = ti.takeTap();
    const r = this.canvas.getBoundingClientRect();
    const aim = this.aoeAim;
    if (aim?.active) {
      // Град стрел: круг под пальцем, отпустил — стреляем туда (как клик на ПК).
      ti.groundAim = true;
      const at = ti.aimXY;
      if (at) aim.update(at.x - r.left, at.y - r.top, cam, this.player.position, SKILL.arrowRain.range);
      if (this.combat.abilityKind !== "arrowRain" || this.player.dead) aim.cancel();
      else if (tap && at) {
        if (aim.inRange) {
          this.castSkill("arrowRain", aim.point.x, aim.point.z);
          aim.cancel();
        } else this.notifyToast(`Слишком далеко — град стрел бьёт до ${SKILL.arrowRain.range} м`);
      }
      if (!aim.active) {
        ti.groundAim = false;
        ti.aimXY = null;
      }
    } else if (tap) {
      ti.groundAim = false;
      this.worldClick({ x: tap.x - r.left, y: tap.y - r.top, button: 0 } as MouseClick, cam);
    }
    // Кнопка атаки: ближайший моб — цель и автоатака (как на ПК); никого рядом — бьём перед собой.
    // Рядом доска/Охотник/трактирщик или рыбалка — атака кнопкой не бьёт.
    const pp0 = this.player.position;
    const nearNpc = [
      [HUB.zones.questBoard, QUEST.boardReach],
      [HUB.zones.hunter, QUEST.boardReach],
      [HUB.zones.tavern, TAVERN_REACH],
    ].some(([z, r]) => Math.hypot(pp0.x - (z as { x: number }).x, pp0.z - (z as { z: number }).z) <= (r as number));
    const fishingNow = !!this.fishing?.active;
    ti.attackBlocked = nearNpc || fishingNow;
    if (ti.takeAttackTap() && !this.player.dead) {
      if (fishingNow) {
        // Мини-игра рыбалки: кнопка атаки — подсечка.
        if (this.fishing?.vrState().phase === "mini") this.fishing.hit();
      } else if (nearNpc && this.combat.interactHook?.()) {
        /* окно открыто */
      } else if (!pt.autoAttack && !nearNpc) {
        const p = this.player.position;
        pt.attackNearest(p.x, p.z, Math.max(12, this.combat.pcAttackRange() + 6));
      }
    }
    if (this.player.dead) pt.autoAttack = false;
    this.lootMarker?.update(dt, !!this.player.autoMove, (id) => this.loot.hasDrop(id));
    const seg = pt.segment();
    const auto = pt.autoAttack && !!seg;
    this.combat.pcTarget = seg;
    // Автоатака по цели — только пока она выбрана тапом; иначе обычные кнопки.
    this.combat.pcAuto = auto;
    this.combat.pcAttack = auto;
    this.updatePcChase(seg, pt.autoAttack);
    this.faceTarget(seg, pt.autoAttack);
  }

  private lastLootClick: { id: string; t: number } | null = null;
  /** ПК: выбранный мышью NPC/объект лагеря (трактирщик, доска заданий). */
  private npcSel: "tavern" | "board" | "hunter" | null = null;
  private lastNpcClick = 0;

  /** NPC лагеря под курсором (ПК): трактирщик или доска заданий. */
  private npcAt(x: number, y: number): "tavern" | "board" | "hunter" | null {
    if (!this.pcTarget || !this.questWin) return null;
    const t = HUB.zones.tavern;
    const b = HUB.zones.questBoard;
    const h = HUB.zones.hunter;
    const pts = [
      new Vector3(t.x, terrainHeight(t.x, t.z) + 1.1, t.z),
      new Vector3(b.x, terrainHeight(b.x, b.z) + 1.6, b.z),
      new Vector3(h.x, terrainHeight(h.x, h.z) + 1.1, h.z),
    ];
    const i = this.pcTarget.pointAt(x, y, this.player.renderCamera, this.canvas, pts, 60);
    return i === 0 ? "tavern" : i === 1 ? "board" : i === 2 ? "hunter" : null;
  }

  /** Добежать до NPC и открыть его окно (лавка / доска заданий). */
  private walkToNpc(which: "tavern" | "board" | "hunter"): void {
    const pt = which === "tavern" ? HUB.zones.tavern : which === "hunter" ? HUB.zones.hunter : HUB.zones.questBoard;
    const reach = which === "tavern" ? TAVERN_REACH : QUEST.boardReach;
    const open = (): void => {
      if (which === "tavern") this.shopWin?.open();
      else if (which === "hunter") this.hunterWin?.open();
      else this.questWin?.open();
    };
    const p = this.player.position;
    if (Math.hypot(p.x - pt.x, p.z - pt.z) <= reach) return open();
    this.pcChase = false;
    this.player.autoMove = { x: pt.x, z: pt.z, stop: reach - 0.8, onArrive: open };
  }

  /**
   * Ролл «скорость атаки» с того, что в руках: основное оружие + щит в другой
   * руке — как rolledAtkSpeedMul на сервере (для темпа удара/выстрела на клиенте).
   */
  private heldAtkSpeedMul(): number {
    const wh = this.net?.warehouse;
    if (!wh) return 1;
    const byId = (id: string | null) => (id ? wh.list.find((w) => w.id === id) : undefined);
    const r = byId(wh.equipped.right);
    const l = byId(wh.equipped.left);
    const main = r && r.cls !== "shield" ? r : l && l.cls !== "shield" ? l : undefined;
    const sh = r?.cls === "shield" ? r : l?.cls === "shield" ? l : undefined;
    return 1 + (main?.atkSpd ?? 0) + (sh?.atkSpd ?? 0);
  }

  /**
   * ПК: начал атаку (1, двойной клик, ПКМ, клик по рамке цели) — герой бежит
   * к цели, пока не окажется на дальности атаки своего оружия, и бьёт.
   * Цель отходит — догоняет. Игрок взялся за WASD — погоня прекращается
   * (автоатака остаётся, как в WoW).
   */
  private updatePcChase(seg: { a: Vector3; b: Vector3; radius: number } | null, attacking: boolean): void {
    const p = this.player.position;
    if (!this.pcChase || !attacking || !seg || this.player.dead) {
      if (this.pcChaseMoving) this.player.autoMove = null;
      this.pcChase = false;
      this.pcChaseMoving = false;
      return;
    }
    // Каст массового лечения — стоя: погоню не ведём, пока не дочитан.
    if (this.combat.massHealCasting) {
      if (this.pcChaseMoving) this.player.autoMove = null;
      this.pcChaseMoving = false;
      return;
    }
    const cx = (seg.a.x + seg.b.x) / 2;
    const cz = (seg.a.z + seg.b.z) / 2;
    const stop = this.combat.pcAttackRange() + seg.radius;
    const dist = Math.hypot(cx - p.x, cz - p.z);
    if (this.pcChaseMoving && !this.player.autoMove && dist > stop + 0.4) {
      // Бег оборвала клавиша движения — игрок рулит сам.
      this.pcChase = false;
      this.pcChaseMoving = false;
      return;
    }
    if (dist > stop) {
      this.player.autoMove = { x: cx, z: cz, stop, onArrive: () => {} };
      this.pcChaseMoving = true;
    } else if (this.pcChaseMoving) {
      this.player.autoMove = null;
      this.pcChaseMoving = false;
    }
  }

  /** Кнопка умения на ПК (2 / клик по ячейке): меч — оглушение, лук — прицел града, посох — масс-хил. */
  private pcSkill(): void {
    if (this.player.dead) return;
    if (this.combat.holdsStaff) {
      const err = this.combat.pcMassHeal();
      if (err) this.notifyToast(err);
      return;
    }
    const kind = this.combat.abilityKind;
    if (!kind) {
      this.notifyToast("У этого оружия нет умения");
      return;
    }
    if (kind === "arrowRain") {
      if (this.aoeAim?.active) {
        this.aoeAim.cancel();
        return;
      }
      if (this.skillCdLeft > 0) {
        this.castSkill(kind); // покажет «ещё не готов: N с»
        return;
      }
      this.aoeAim?.start(SKILL.arrowRain.radius);
      return;
    }
    this.castSkill(kind);
  }

  /** Клик по ячейке панели действий ПК — то же, что клавиша. */
  private pcSlot(key: string): void {
    if (key === "1") this.pcTarget?.toggleAttack(this.player.renderCamera);
    else if (key === "2") {
      this.pcSkill();
    } else if (key === "3") {
      const slot = this.inventory.slots.findIndex((s) => s.item === "potion" && s.count > 0);
      if (slot >= 0) this.inventory.use(slot);
      else this.notifyToast("Зелий нет");
    } else if (key === "E") {
      if (!this.combat.pickupNow()) this.notifyToast("Рядом нечего подобрать");
    }
  }

  /** Лут под курсором (ПК): оружие, щиты, банки. */
  private lootAt(x: number, y: number): { id: string; pos: Vector3; weapon: boolean; item: ItemId } | null {
    const ids: string[] = [];
    const pts: Vector3[] = [];
    const wpn: boolean[] = [];
    const its: ItemId[] = [];
    this.loot.forEachDrop((id, pos, weapon, item) => {
      ids.push(id);
      pts.push(pos.clone());
      wpn.push(weapon);
      its.push(item);
    });
    if (!pts.length || !this.pcTarget) return null;
    const i = this.pcTarget.pointAt(x, y, this.player.renderCamera, this.canvas, pts, 40);
    return i >= 0 ? { id: ids[i], pos: pts[i], weapon: wpn[i], item: its[i] } : null;
  }

  /** Подсказка и курсор под мышью (ПК): предмет на земле, моб или игрок. */
  private updatePcHover(dt: number): void {
    const hv = this.pcHover;
    const di = this.desktopInput;
    const pt = this.pcTarget;
    if (!hv || !di || !pt) return;
    this.hoverT -= dt;
    if (this.hoverT > 0) return;
    this.hoverT = 0.06;
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.left + di.mouseX;
    const sy = rect.top + di.mouseY;
    if (this.aoeAim?.active) {
      hv.set(null, sx, sy, "aim");
      return;
    }
    if (di.busy || !di.overCanvas || document.pointerLockElement) {
      hv.set(null, sx, sy, "default");
      return;
    }
    const cam = this.player.renderCamera;
    const npc = this.npcAt(di.mouseX, di.mouseY);
    if (npc) {
      const sel = this.npcSel === npc;
      hv.set(
        {
          title: npc === "tavern" ? "Трактирщик" : npc === "hunter" ? "Охотник" : "Доска заданий",
          titleColor: "#e8c26a",
          lines: [
            { text: npc === "tavern" ? "лавка за жетоны ◈" : npc === "hunter" ? "история лагеря и контракт недели" : "задания дня" },
            { text: sel ? "Клик — подойти и открыть" : "Клик — выбрать · ПКМ / двойной — открыть", color: "#8f8a7e" },
          ],
          cursor: sel ? "loot" : "default",
        },
        sx,
        sy,
      );
      return;
    }
    const loot = this.lootAt(di.mouseX, di.mouseY);
    if (loot) {
      const def = ITEMS[loot.item];
      const w = def.weapon;
      const color = !w ? "#e6e0d0" : w.tier === "legendary" ? "#c79bff" : w.tier === "gold" ? "#f5c542" : "#dedede";
      const info: HoverInfo = {
        title: w ? weaponDef(w.cls, w.tier).name : def.name,
        titleColor: color,
        lines: [
          ...(w ? [{ text: w.tier === "legendary" ? "уникальное" : w.tier === "gold" ? "золотое" : "обычное" }] : []),
          {
            text: this.lootMarker?.selectedId === loot.id ? "Клик — добежать и подобрать" : "Клик — выбрать",
            color: "#8f8a7e",
          },
        ],
        // Рука — только над уже выбранным предметом.
        cursor: this.lootMarker?.selectedId === loot.id ? "loot" : "default",
      };
      hv.set(info, sx, sy);
      return;
    }
    const id = pt.mobAt(di.mouseX, di.mouseY, cam, this.canvas);
    const st = this.net?.room?.state;
    if (!id || !st) {
      hv.set(null, sx, sy, "default");
      return;
    }
    const hero = this.progression.level;
    if (id.startsWith("@")) {
      const ps = st.players.get(id.slice(1));
      if (!ps) return hv.set(null, sx, sy, "default");
      const bot = id.startsWith("@bot:");
      const canHit = !!this.net?.pvpOn && ps.pvp === 1 && pt.targetId === id;
      hv.set(
        {
          title: ps.nick,
          titleColor: ps.pvp ? "#ff9a8e" : "#9fd0ff",
          lines: [
            { text: `Уровень ${ps.level} · ${bot ? "бот зрителя" : "игрок"}` },
            { text: `Здоровье ${Math.ceil(ps.hp)} / ${Math.ceil(ps.maxHp)}` },
            { text: ps.pvp ? "PvP включён" : "PvP выключен", color: ps.pvp ? "#ff9a8e" : "#8f8a7e" },
          ],
          cursor: canHit ? "attack" : "default",
        },
        sx,
        sy,
      );
      return;
    }
    const m = st.mobs.get(id);
    if (!m || m.dead) return hv.set(null, sx, sy, "default");
    const cfg = m.kind === "spitter" ? SPITTER_CFG : m.kind === "boss" ? BOSS_CFG : m.kind === "shard" ? SHARD_CFG : SLIME_CFG;
    const lvl = m.mobLevel || cfg.level;
    hv.set(
      {
        title: m.mobName || cfg.name,
        titleColor: m.kind === "boss" ? "#ff5a4a" : difficultyCss(lvl, hero),
        lines: [
          { text: m.kind === "boss" ? "Босс" : `Уровень ${lvl}${m.mobName ? " · элита" : ""}` },
          { text: `Здоровье ${Math.ceil(m.hp).toLocaleString("ru-RU")} / ${Math.ceil(m.maxHp).toLocaleString("ru-RU")}` },
          { text: pt.targetId === id ? "Клик — атаковать" : "Клик — выбрать · ПКМ — атаковать", color: "#8f8a7e" },
        ],
        // Меч — только над уже выбранным мобом.
        cursor: pt.targetId === id ? "attack" : "default",
      },
      sx,
      sy,
    );
  }

  /**
   * Добежать до предмета на земле (ПК, двойной клик / ПКМ). Оружие и банки
   * подбираются сами, как только подойдёшь (оружие — pcAutoPickup, банки — сервер),
   * так что бежим почти вплотную.
   */
  private walkToLoot(pos: Vector3): void {
    this.combat.clearAutoPickupBlock();
    this.player.autoMove = { x: pos.x, z: pos.z, stop: 0.6, onArrive: () => {} };
  }

  /** Смартфон: держать модель у ног игрока и гонять её анимации. */
  private updateLocalAvatar(dt: number): void {
    const av = this.localAvatar;
    if (!av) return;
    // Замах дёргает сам CombatSystem через onMeleeSwing — тут только поза.
    // Прицеливание → модель прячем (мы внутри неё).
    const p = this.player.position;
    av.update(
      dt,
      p.x,
      p.y,
      p.z,
      this.player.facing,
      this.player.planarSpeed,
      // Смерть — не прячем: модель играет клип смерти, как её видит спектатор.
      this.player.inVR || this.player.aiming,
    );
    av.setDead(this.player.dead);
  }

  /**
   * Пока держат «атаку» и почти не двигаются — плавно доворачиваем персонажа
   * к ближайшей цели в конусе перед ним. Удар в плоском бою летит по взгляду
   * «глаз», а те смотрят туда же, куда повёрнут персонаж.
   */
  /**
   * Активное умение оружия — воин «Оглушающий удар», лучник «Град стрел».
   * Клиент только отсчитывает кулдаун для кнопки; урон/контроль считает сервер,
   * а телеграф и FX прилетают эхом через playRemoteAct.
   */
  /** Применить умение: проверка готовности (иначе предупреждение) и отправка на сервер. */
  private castSkill(kind: "stunBash" | "arrowRain", x?: number, z?: number): void {
    if (this.player.dead || !this.net?.online) return;
    if (this.skillCdLeft > 0) {
      const name = kind === "stunBash" ? "Оглушающий удар" : "Град стрел";
      const now = performance.now();
      if (now - this.skillWarnAt > 1200) {
        this.skillWarnAt = now;
        this.notifyToast(`${name} ещё не готов: ${Math.ceil(this.skillCdLeft)} с`);
      }
      return;
    }
    const msg: { kind: "stunBash" | "arrowRain"; x?: number; z?: number } = { kind };
    if (kind === "arrowRain") {
      if (x !== undefined && z !== undefined) {
        msg.x = x;
        msg.z = z;
      } else {
        const hl = Math.hypot(this.aim.x, this.aim.z) || 1;
        const p = this.player.position;
        msg.x = p.x + (this.aim.x / hl) * SKILL.arrowRain.range;
        msg.z = p.z + (this.aim.z / hl) * SKILL.arrowRain.range;
      }
    }
    this.net.sendSkill(msg);
    if (this.player.inVR) this.sfx.bowRelease(1); // отклик жеста, как у массового хила
    this.skillCdTotal = kind === "stunBash" ? SKILL.stunBash.cooldown : SKILL.arrowRain.cooldown;
    this.skillCdLeft = this.skillCdTotal;
  }

  private skillWarnAt = 0;

  private updateSkillAbility(dt: number): void {
    if (this.skillCdLeft > 0) this.skillCdLeft = Math.max(0, this.skillCdLeft - dt);
    const kind = this.combat.abilityKind;
    const inp = this.player.lastInput;
    if (inp.ability && this.pcThirdPerson) this.pcSkill();
    else if (inp.ability && kind) this.castSkill(kind);
    // Индикатор готовности на кнопке умения (телефон) и на запястье (VR).
    const frac = kind ? this.skillCdLeft / this.skillCdTotal : -1;
    this.touchInput?.setSkillCd(frac);
    this.wristPanel?.setSkillCd(frac);
  }

  private aimAssistTouch(dt: number): void {
    if (!this.player.thirdPerson) return; // только смартфонное третье лицо, не VR
    if (this.player.aiming) return; // сам целится — не мешаем
    if (!this.player.lastInput.primaryAction || this.player.dead) return;
    if (this.player.planarSpeed > 1.5) return; // бежит — целится сам, куда бежит
    const eye = this.player.eyePosition;
    const fy = this.player.facing;
    const fdx = Math.sin(fy);
    const fdz = Math.cos(fy);
    let best: { x: number; z: number } | null = null;
    let bestD = 7; // м, дальность автонаводки
    for (const t of this.targets) {
      if (!t.alive) continue;
      const s = t.hitSegment();
      const cx = (s.a.x + s.b.x) / 2;
      const cz = (s.a.z + s.b.z) / 2;
      const dx = cx - eye.x;
      const dz = cz - eye.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 || d > bestD) continue;
      // Косинус угла между «вперёд» и направлением на цель ≥ cos(70°).
      if ((dx * fdx + dz * fdz) / d < 0.34) continue;
      bestD = d;
      best = { x: cx, z: cz };
    }
    if (best) this.player.faceTowards(best.x, best.z, dt);
  }

  // ---- сеть: чужие игроки ----

  private saveTimer: number | null = null;
  private saveDebounce: number | null = null;
  private unsubProgress: (() => void) | null = null;

  /** Подключить сетевого клиента (уже в комнате). Аватары чужих + сейв персонажа. */
  attachNet(net: NetClient): void {
    this.net = net;
    net.onChar = (data) => this.applyChar(data);
    net.onMobHit = (dmg, fromX, fromZ, by, stunSec, knockback, byMob) =>
      this.takeMobHit(dmg, fromX, fromZ, by, stunSec, knockback, byMob);
    net.onRespawn = (x, y, z) => {
      this.player.teleportTo(x, y, z);
      this.hud.flashDamage(20);
      // player.dead / hud.setDead(false) сюда не пишем: это делает syncSelf
      // по self.dead — иначе, если патч состояния приходит чуть позже этого
      // сообщения, следующий тик ловит устаревшее dead:1 и включает экран
      // смерти заново, уже без пары, которая его снова выключит (баг: после
      // возрождения красная виньетка и счётчик оставались на экране).
    };
    net.onLevelUp = (lvl) => this.levelUpFx(lvl);
    net.onBossEvent = (kind, by, _loot, lootItems) => {
      if (kind === "spawn") {
        this.notifyBanner("Босс появился", "Багровый слизень вышел на охоту", "warn");
        this.sfx.bossHorn();
      } else {
        const sub = by ? `Решающий удар: ${by}` : "";
        this.notifyBanner("Босс повержен!", sub, "win", lootItems);
        this.sfx.bossFanfare();
      }
    };
    net.onWorldEvent = (phase, name, x, z, loot) => {
      const hunt = name === "Охота";
      if (phase === "start") {
        this.notifyBanner(
          hunt ? "Охота на элиту!" : `${name}!`,
          hunt ? "В мире объявился Огнекрылый дракон — редкая добыча" : "К бою — отбейте волну мобов",
          "warn",
        );
        this.sfx.bossHorn();
      } else if (phase === "win") {
        this.notifyBanner(
          hunt ? "Огнекрылый дракон повержен" : `${name} отражено`,
          hunt
            ? "Легендарка в эпицентре · участникам — ×2 опыт и урон"
            : "Награда в эпицентре · участникам — благословение: ×2 опыт и урон на 15 мин",
          "win",
          loot,
        );
        this.sfx.bossFanfare();
      } else {
        this.notifyBanner(hunt ? "Огнекрылый дракон улетел" : `${name} утихло`, "", "warn");
      }
      void x;
      void z;
    };
    net.onPickupFeed = (m) => {
      if (m.nick === this.localNick) return; // своё — уже в «Подобрано»
      this.pcHud?.log("loot", `подобрал ${m.item}`, m.nick, m.tier === "legendary" ? "#c79bff" : "#f5c542");
    };
    net.onKillFeed = (by, victim) => {
      if (victim) this.pcHud?.log("kill", by ? `🗡️ ${victim}` : `${victim} пал`, by || undefined);
    };
    net.onChatLine = (m) => this.pcHud?.log("chat", m.text, m.nick);
    // Цифры урона над мобами — все платформы, выключатель в меню.
    net.onDmgHits = (msg) => {
      // Журнал урона (ПК): свои попадания — «Вы нанесли N: <моб>».
      const self = net.sessionId;
      if (this.pcHud) {
        for (const h of msg.hits) {
          if (h.by !== self || !h.mob) continue;
          const m = net.room?.state.mobs.get(h.mob);
          const name = m?.mobName || (m?.kind === "spitter" ? SPITTER_CFG.name : m?.kind === "boss" ? BOSS_CFG.name : m?.kind === "shard" ? SHARD_CFG.name : SLIME_CFG.name);
          this.pcHud.log("damage", `Вы нанесли ${h.dmg.toLocaleString("ru-RU")} урона: ${name}`, undefined, "#e8e2d2");
        }
      }
      if (!VR_SETTINGS.dmgNumbers) return;
      const pp = this.player.position;
      const vr = this.player.inVR;
      for (const h of msg.hits) {
        if (vr && Math.hypot(h.x - pp.x, h.z - pp.z) > VR_FX_RANGE) continue;
        this.crossFx.damageNumber(h.x, h.y, h.z, h.dmg);
      }
    };
    net.onPcInvData = (d) => {
      this.pcInvData = d;
      this.pcInv?.setData(d);
      this.vrEnchPanel?.markDirty();
    };
    net.onShopData = (d) => {
      this.shopData = d;
      // VR: итог покупки (что потрачено / что получено) — плашкой в самой панели трактирщика.
      if (d.msg && this.player.inVR) this.vrNoteSet(d.msg);
      this.shopWin?.setData(d);
      this.vrNpcPanel?.markDirty();
    };
    net.onQuestData = (d) => {
      // VR: прогресс задания (убил / поймал) — строкой в шлеме, без захода в меню.
      if (this.player.inVR && this.questData) {
        const before = new Map(trackItems(this.questData).map((it) => [it.key, it.progress]));
        for (const it of trackItems(d)) {
          const was = before.get(it.key);
          if (was !== undefined && was !== it.progress) this.vrHud?.showToast(`${it.title}: ${it.progress}`);
        }
      }
      this.questData = d;
      if (d.msg && this.player.inVR) this.vrNoteSet(d.msg);
      this.vrNpcPanel?.markDirty();
      if (this.wristPanel) {
        this.wristPanel.setQuests(d);
        // Компас из VR-меню: задание сдали — выключаем, стало готово — ведём к сдаче.
        const key = this.wristPanel.compassKey;
        if (key) {
          const it = trackItems(d).find((x) => x.key === key);
          if (!it) this.wristPanel.compassKey = null;
          this.setQuestCompass(it ?? null);
        }
      }
      this.questWin?.setData(d);
      this.hunterWin?.setData(d);
      this.questTracker?.setData(d);
      const claimable = d.slots.some((s, i) => s.done && !s.claimed && (i >= 3 || d.dailyTaken));
      this.bangBoard?.set(!d.dailyTaken || claimable || (d.picksLeft > 0 && d.offers.length > 0));
      const st = d.story;
      const w = d.weekly;
      this.bangHunter?.set(!!st && (!st.taken || st.done) || !w.taken || (w.done && !w.claimed));
    };
    if (this.questWin) window.setTimeout(() => net.sendQuestOpen(), 1500);
    net.onPcInvResult = (r) => {
      this.pcInv?.onResult(r);
      if (r.enchant && this.vrEnchId) {
        const e = r.enchant;
        this.vrEnchResult = e.up
          ? { up: true, text: `Успех! ${e.label} (+${e.gain}) · −${e.cost} лома` }
          : { up: false, text: `Не вышло… −${e.cost} лома` };
        this.sfx.pickup();
        this.net?.sendPcInvOpen();
      }
      if (!r.enchant) this.notifyToast(r.text);
    };
    net.onWarehouse = () => this.pcInv?.refresh();
    net.onPicked = (item, count) => {
      this.sfx.pickup();
      this.localAvatar?.pickup();
      const w = ITEMS[item].weapon;
      if (w) {
        const d = weaponDef(w.cls, w.tier);
        this.sfx.levelUp();
        const inHands = this.combat.handsSnapshot();
        const held = inHands.left?.tier === w.tier && inHands.left.cls === w.cls ? true : inHands.right?.tier === w.tier && inHands.right.cls === w.cls;
        if (this.pcThirdPerson && !held) {
          this.notifyToast(`В сумке: ${d.name} (C — надеть)`);
          this.pcInv?.refresh();
        } else {
          this.notifyToast(w.cls === "shield" ? d.name : `${d.name}: урон ×${d.mult}`);
        }
      } else {
        this.notifyToast(`Подобрано: ${ITEMS[item].name}${count > 1 ? ` ×${count}` : ""}`);
      }
    };

    this.fishing = createFishing(
      this.scene,
      this.player,
      this.combat,
      net,
      (text) => this.notifyToast(text),
      () => (this.player.inVR ? "vr" : this.isTouch ? "touch" : "pc"),
    );

    // Онлайн здоровьем и прокачкой владеет сервер.
    this.player.netControlled = true;
    this.progression.onSpendRequest = (stat) => net.sendSpend(stat);
    this.inventory.onUseRequest = (slot) => net.sendUseItem(slot);
    this.combat.nearestWorldWeapon = (pos) => this.loot.nearestWeapon(pos);
    this.combat.onTakeWorldWeapon = (id, hand) => net.sendTakeWeapon(id, hand ?? undefined);
    this.combat.makeWeaponMesh = (cls, tier) =>
      makeWeaponMesh(this.scene, cls as WeaponClass, tier);
    this.combat.onWeaponLanded = (cls, tier, x, z, hand) =>
      net.sendDropWeapon({ cls, tier, x, z, hand: hand ?? undefined });
    this.combat.onSoundEvent = (kind, x, y, z) => net.sendAct(kind, x, y, z);
    this.combat.onCast = (msg) => net.sendCast(msg);
    this.combat.onLowMana = () => {
      if (MANA_ENABLED) this.notifyToast("Не хватает маны");
    };
    this.combat.onVrSkill = (kind, x, z) => this.castSkill(kind, x, z);
    this.combat.onMassHealCooldown = (sec) => this.notifyToast(`Массовый хил перезаряжается: ${Math.ceil(sec)} с`);
    this.combat.onMassHealStart = (x, y, z) => this.healAura.burst(x, y, z, BOT.healRadius, BOT.healCastTime);
    this.combat.nearestAlly = (pos) => {
      let best: { id: string; pos: Vector3 } | null = null;
      let bd = 1.2;
      for (const [id, av] of this.avatars) {
        const d = Vector3.Distance(pos, av.position);
        if (d < bd) {
          bd = d;
          best = { id, pos: av.position.clone() };
        }
      }
      return best;
    };

    // Звук соседа — играем объёмно от его аватара / точки события.
    net.onAct = (k, x, y, z, id, d, mobId, x2, z2) => this.playRemoteAct(k, x, y, z, id, d, mobId, x2, z2);
    net.onTtsPlay = (m) => this.playChatTts(m.url, m.nick);
    net.onBotSay = (id, text) => this.avatars.get(id)?.say(text);
    net.onEmote = (id, emote) => this.avatars.get(id)?.playEmote(emote);

    // PvP: сервер подтвердил (или отклонил) переключение флага.
    net.onPvp = (on, wait) => {
      if (wait !== undefined) {
        this.notifyToast(`Выйти из PvP можно через ${wait} с — недавно был бой`);
      } else {
        this.notifyToast(
          on
            ? "PvP включён — игроки с PvP могут тебя атаковать"
            : "PvP выключен",
        );
      }
    };

    // Сервер перезапустился / связь оборвалась — переподключаемся на месте.
    net.onConnectionLost = () => this.notifyToast("Связь потеряна — переподключаюсь…");
    // Зашли этим же ником в другом месте — нас намеренно выгнали, не
    // переподключаемся; короткая пауза, чтобы игрок успел увидеть тост,
    // и назад на экран входа (соединение уже закрыто сервером).
    net.onKicked = () => {
      this.notifyToast("Вошли под этим ником в другом месте — выход");
      this.saveNow();
      setTimeout(() => window.location.reload(), 1500);
    };
    net.onReconnected = (room) => {
      this.lastSentPlat = 0; // новая сессия на сервере — платформу нужно сообщить заново
      this.attachRoom(room);
      this.handsKey = ""; // заново сообщить серверу, что в руках и за спиной
      this.ttsListenSent = -1; // и снова — слушаю ли озвучку чата
      this.saveNow();
      this.notifyToast("Снова в игре");
    };
    if (net.room) this.attachRoom(net.room);

    // Голос: спрашиваем микрофон и связываемся с теми, кто уже в комнате.
    this.voice.send = (m) => net.sendRtc(m);
    this.voice.sendVoice = (t, d) => net.sendVoice(t, d);
    net.onRtc = (m) => void this.voice.handle(m);
    net.onVoice = (id, t, d) => this.voice.onVoicePacket(id, t, d);
    void this.voice.start(net.sessionId).then((ok) => {
      if (!ok) {
        // Отказ в разрешении — частый случай на телефоне, говорим прямо и не
        // пугаем потом «мешает VPN» (см. onPeerFailed).
        this.voiceWarned = this.voice.micDenied;
        this.notifyToast(
          this.voice.micDenied
            ? "Микрофон выключен: не дано разрешение в браузере"
            : `Голос выключен: ${this.voice.micError ?? "нет микрофона"}`,
        );
        return;
      }
      this.notifyToast("Микрофон готов");
      // Смартфон: кнопка выключения микрофона в верхнем ряду.
      if (this.isTouch && this.micToggle) {
        this.hud.enableMicButton(() => LOADOUT.voice.mic !== 0, this.micToggle);
      }
      for (const id of this.avatars.keys()) this.voice.addPeer(id);
    });

    // Автосейв: раз в 30 с, при изменении прогресса (с задержкой) и перед выходом.
    this.saveTimer = window.setInterval(() => this.saveNow(), 30_000);
    this.unsubProgress = this.progression.onChange(() => {
      if (this.saveDebounce) window.clearTimeout(this.saveDebounce);
      this.saveDebounce = window.setTimeout(() => this.saveNow(), 1500);
    });
    window.addEventListener("beforeunload", this.beforeUnload);

    // Только теперь, когда фабрики мешей и колбэки на месте, разбираем
    // персонажа с сервера: иначе восстанавливать оружие было бы нечем.
    net.flushChar();
  }

  /**
   * Подписки на комнату: мобы, лут, аватары чужих. Зовётся при входе и при
   * КАЖДОМ переподключении (комната после рестарта сервера — новая).
   */
  private attachRoom(room: Room<ZoneState>): void {
    this.netMobs.attach(room);
    this.loot.attach(room);

    for (const a of this.avatars.values()) this.dropAvatar(a);
    this.avatars.clear();

    const players = room.state.players;
    const add = (id: string): void => {
      if (id === this.net?.sessionId || this.avatars.has(id)) return;
      const p = players.get(id);
      if (!p) return;
      const av = new RemoteAvatar(
        this.scene,
        id,
        p.nick,
        p.mode,
        (cls, tier) => makeWeaponMesh(this.scene, cls, tier),
        this.isTouch ? 2 : 1, // плашка ника крупнее на мелком экране
      );
      // PvP: чужой аватар — цель для оружия (сервер решит, пройдёт ли урон).
      av.onHit = (weapon, dir) => this.report?.(id, "player", weapon, dir.x, dir.z);
      this.targets.push(av);
      this.avatars.set(id, av);
      this.voice.addPeer(id);
    };
    players.onAdd((_p, id) => add(id), true); // true — сработает и для уже вошедших
    players.onRemove((_p, id) => {
      const av = this.avatars.get(id);
      if (av) this.dropAvatar(av);
      this.avatars.delete(id);
      this.voice.removePeer(id);
    });
  }

  /** Убрать аватар из целей и уничтожить. */
  private dropAvatar(av: RemoteAvatar): void {
    const i = this.targets.indexOf(av);
    if (i >= 0) this.targets.splice(i, 1);
    av.dispose();
  }

  private readonly beforeUnload = (): void => this.saveNow();

  private charApplied = false;

  /** Где этот токен стоял в прошлый раз. null — первый вход, отдадим своё. */
  /** Звук чужого действия — объёмно от точки события (у аватара соседа). */
  private playRemoteAct(
    k: ActKind,
    x: number,
    y: number,
    z: number,
    id: string,
    d?: number,
    mobId?: string,
    x2in?: number,
    z2in?: number,
  ): void {
    // VR: дальше VR_FX_RANGE боевых эффектов (скиллы, лечение, удары, криты, звуки) не рисуем вовсе — бережём шлем.
    if (this.player.inVR) {
      const pp = this.player.position;
      if (Math.hypot(x - pp.x, z - pp.z) > VR_FX_RANGE) return;
    }
    const at = { x, y, z };
    switch (k) {
      case "swing":
        this.sfx.swordSwing(at);
        this.avatars.get(id)?.playSwing();
        break;
      case "step":
        this.sfx.at(at, () => this.sfx.footstep(0.85));
        break;
      case "drink":
        this.sfx.at(at, () => this.sfx.drink());
        this.crossFx.burst(x, y, z, 5, W_GREEN);
        break;
      case "levelUp":
        this.sfx.at(at, () => this.sfx.levelUp());
        this.crossFx.burst(x, y, z, 9, W_ORANGE);
        break;
      case "magicHit": {
        // Магический удар (Костяной призрак): призрачная дымка на задетом герое.
        const av = this.avatars.get(id);
        const p = av ? av.position : { x, y, z };
        this.skillFx.wraithPuff(p.x, p.y - 0.9, p.z, 0.55, true);
        break;
      }
      case "healHit": {
        // Массовое лечение дошло до героя: зелёные крестики на нём самом.
        const av = this.avatars.get(id);
        const p = av ? av.position : { x, y, z };
        this.crossFx.burst(p.x, p.y - 0.3, p.z, 6, W_GREEN);
        break;
      }
      case "healAura":
        // Бот-лекарь начал каст: круг по земле + купол на всё время каста.
        this.healAura.burst(x, y, z, BOT.healRadius, BOT.healCastTime);
        this.sfx.at(at, () => this.sfx.levelUp());
        break;
      case "breathMark":
      case "breathHit":
        this.skillFx.breathCone(x, y, z, x2in ?? x, z2in ?? z, d ?? 1, k === "breathHit");
        if (k === "breathHit") this.sfx.at({ x, y, z }, () => this.sfx.groundBash());
        break;
      case "pullMark":
      case "pullHit": {
        // Спрут парит (~1.6 м над землёй) — щупальце от него к груди героя.
        const x2 = x2in ?? x;
        const z2 = z2in ?? z;
        this.skillFx.tentacle(x2, y + 1.6, z2, x, y + 1.1, z, k === "pullMark" ? (d ?? PULL.windup) : 0.35, k === "pullHit");
        if (k === "pullHit") this.sfx.at({ x, y, z }, () => this.sfx.swordHit());
        break;
      }
      case "sporeMark":
        this.skillFx.sporeZone(x, y, z, SPORE.radius, d ?? SPORE.windup, SPORE.duration);
        setTimeout(() => this.sfx.at({ x, y, z }, () => this.sfx.groundBash()), (d ?? SPORE.windup) * 1000);
        break;
      case "blinkOut":
        this.skillFx.wraithPuff(x, y, z, d ?? BLINK.fade, false);
        break;
      case "blinkIn":
        this.skillFx.wraithPuff(x, y, z, 0.6, true);
        this.sfx.at({ x, y, z }, () => this.sfx.swordHit());
        break;
      case "chargeMark":
      case "chargeHit":
        // Адский демон: полоса тарана — телеграф, потом вспышка по всей полосе.
        this.skillFx.breathCone(x, y, z, x2in ?? x, z2in ?? z, k === "chargeMark" ? (d ?? CHARGE.windup) : 0.4, k === "chargeHit");
        if (k === "chargeHit") this.sfx.at({ x: x2in ?? x, y, z: z2in ?? z }, () => this.sfx.groundBash());
        break;
      case "reflectOn":
        // Ледяной демон: синий щит на всё время отражения.
        this.skillFx.wraithPuff(x, y + 0.6, z, d ?? REFLECT.duration, false);
        break;
      case "chiefHeal":
        // Костяной вождь лечит себя и соседей — зелёный купол.
        this.healAura.burst(x, y, z, CHIEF_HEAL.radius, 1.2);
        this.sfx.at({ x, y, z }, () => this.sfx.levelUp());
        break;
      case "freezeMark":
        // Ледяной демон: волна по кругу под героем — через d с заморозка.
        this.skillFx.stunBash(x, y, z, FREEZE.radius, d ?? FREEZE.windup);
        break;
      case "freezeHit":
        this.skillFx.wraithPuff(x, y - 0.8, z, 1.2, true);
        this.sfx.at({ x, y, z }, () => this.sfx.groundBash());
        break;
      case "spikeMark":
        // Костяной вождь: красная волна под героем — через d с шипы.
        this.skillFx.stunBash(x, y, z, SPIKES.radius, d ?? SPIKES.windup);
        break;
      case "spikeHit":
        this.sfx.at({ x, y, z }, () => this.sfx.groundBash());
        break;
      case "stunBash":
        this.skillFx.stunBash(x, y, z, BOT.stunRadius, d ?? BOT.stunCastTime);
        // Звук — в момент активации умения (а не в конце замаха, как раньше по stunHit).
        this.sfx.at(at, () => this.sfx.groundBash());
        break;
      case "stunHit":
        // Звук перенесён на начало (stunBash); само оглушение считает сервер.
        break;
      case "swordHit":
        this.sfx.at(at, () => this.sfx.swordHit());
        break;
      case "vampHit": {
        // Красные крестики — на самом герое (кто подпитался), а не на мобе; у
        // себя — ещё и перед глазами (красные вместо зелёных от роста HP).
        if (id === this.net?.sessionId) {
          this.lastVampAt = performance.now();
          this.healCrossFx?.burst(0.2, W_RED, 0.4); // меньше крестиков от вампиризма (было 0.7 → 8 шт, теперь 5)
        } else {
          const av = this.avatars.get(id);
          if (av) this.crossFx.burst(av.position.x, av.position.y - 0.4, av.position.z, 2, W_RED, 0.4);
          else this.crossFx.burst(x, y, z, 2, W_RED, 0.4);
        }
        break;
      }
      case "arrowRain":
        this.skillFx.arrowRain(x, y, z, BOT.rainRadius, d ?? BOT.rainCastTime, SKILL.arrowRain.duration);
        this.avatars.get(id)?.playEmote("cheer");
        this.sfx.at(at, () => this.sfx.arrowVolley());
        break;
      case "rainTick":
        // Очередной залп по области: звук не прерывается все 3 секунды града.
        this.sfx.at(at, () => this.sfx.arrowVolley());
        break;
      case "bow":
        this.sfx.at(at, () => this.sfx.bowRelease(0.8));
        // Отдельного клипа натяга у бота нет — берём взмах: рука дёргается,
        // читается как выстрел. Лучше, чем застывшая поза.
        this.avatars.get(id)?.playSwing();
        break;
      case "crit":
        // Критический выстрел: красная огненная вспышка на мобе + звук огнешара.
        this.crossFx.critMark(x, y + 0.4, z);
        this.sfx.arrowCrit(at);
        break;
      case "arrowHit":
        this.sfx.at(at, () => this.sfx.arrowHit("wood", 0.8));
        break;
      case "hurt":
        this.sfx.at(at, () => this.sfx.playerHurt());
        this.avatars.get(id)?.playHitReact();
        break;
      case "dodge":
        // x,y,z — источник удара (моб), не увернувшийся; см. hurtPlayer.
        // mobId есть — моб мог убежать вперёд за время задержки, следуем за ним.
        this.crossFx.missText(x, y - 1, z, MISS_FX_DELAY, this.missFollowMob(mobId));
        break;
      case "blockShield":
        this.sfx.at(at, () => this.sfx.block(1));
        break;
      case "blockSword":
        this.sfx.at(at, () => this.sfx.block(0.5));
        break;
      case "pickup":
        this.avatars.get(id)?.playPickup();
        break;
      case "jump":
        this.avatars.get(id)?.playEmote("jump");
        break;
    }
  }

  private applyChar(data: CharMsg): void {
    // На переподключении сервер снова шлёт char — но игрока с места не дёргаем.
    if (this.charApplied) {
      if (!data) return;
      this.saveNow(); // сразу закрепить актуальную позицию за токеном
      return;
    }
    this.charApplied = true;
    if (!data) {
      this.saveNow();
      return;
    }
    this.player.restoreState(data);
    // Оружие, которое было в руках и за спиной, возвращаем на место.
    if (data.held) this.combat.restoreHeld(data.held);
    if (data.stowed?.length) this.combat.restoreStowed(data.stowed);
    // Настройки панели с сервера — главнее локальных.
    if (data.overrides && Object.keys(data.overrides).length) importOverrides(data.overrides);
    if (data.leaveBot !== undefined) {
      this.leaveBotOn = data.leaveBot;
      this.hud.setLeaveBot(data.leaveBot);
    }
  }

  /**
   * Сглаживание краёв кадра (FXAA).
   *
   * Трава нарисована по принципу «пиксель есть или нет», поэтому её края
   * идут лесенкой, и обычное сглаживание геометрии тут не помогает.
   * Пост-обработка сглаживает уже готовый кадр. Она цепляется к активной
   * камере, а в VR камера другая — поэтому проверяем каждый кадр, но
   * пересоздаём только при смене камеры или настройки.
   */
  private updateSmoothing(): void {
    const cam = this.scene.activeCamera;
    // В VR пост-обработка (FXAA + шарпен) идёт двумя полноэкранными проходами
    // в стерео на слабом GPU шлема — снимаем совсем, сглаживание даёт MSAA
    // самого буфера глаза (antialias у XR-слоя).
    if (this.player.inVR) {
      if (this.fxaa) this.dropSmoothing();
      if (this.sharpen) this.dropSharpen();
      return;
    }
    const wantFxaa = LOADOUT.gfx.smooth !== 0 && !!cam;
    if (wantFxaa && this.fxaaCam !== cam) {
      this.dropSmoothing();
      this.fxaa = new FxaaPostProcess("fxaa", 1, cam!);
      this.fxaaCam = cam;
    } else if (!wantFxaa && this.fxaa) {
      this.dropSmoothing();
    }

    // Резкость — после сглаживания, на той же камере.
    const wantSharp = this.sharpenAmount > 0 && !!cam;
    if (wantSharp && this.sharpenCam !== cam) {
      this.dropSharpen();
      this.sharpen = new SharpenPostProcess("sharpen", 1, cam!);
      this.sharpen.edgeAmount = this.sharpenAmount;
      this.sharpen.colorAmount = 1;
      this.sharpenCam = cam;
    } else if (!wantSharp && this.sharpen) {
      this.dropSharpen();
    } else if (this.sharpen) {
      this.sharpen.edgeAmount = this.sharpenAmount;
    }
  }

  private dropSharpen(): void {
    if (!this.sharpen) return;
    if (this.sharpenCam) this.sharpen.dispose(this.sharpenCam);
    else this.sharpen.dispose();
    this.sharpen = null;
    this.sharpenCam = null;
  }

  /**
   * Снять пост-обработку с камеры.
   *
   * dispose() без камеры не отцепляет её от списка камеры: остаётся пустой
   * слот, а при следующем включении набирается второй проход. Поэтому
   * камеру передаём явно.
   */
  private dropSmoothing(): void {
    if (!this.fxaa) return;
    if (this.fxaaCam) this.fxaa.dispose(this.fxaaCam);
    else this.fxaa.dispose();
    this.fxaa = null;
    this.fxaaCam = null;
  }

  /** Голос: подхватываем настройки и отдаём положение слушателя. */
  private updateVoice(dt: number): void {
    // «Уши» игрока для объёмных звуков (моб, взмах, плевок) — всегда, не только
    // когда включён пространственный голос.
    this.sfx.setListener(this.player.eyePosition, this.player.eyeForward, UP);
    this.voice.micEnabled = LOADOUT.voice.mic !== 0;
    this.voice.setSpatial(LOADOUT.voice.spatial !== 0);
    this.voice.update(dt);
  }

  /** Сколько зелий в сумке — суммой по всем ячейкам. */
  private potionCount(): number {
    let n = 0;
    for (const s of this.inventory.slots) if (s.item === "potion") n += s.count;
    return n;
  }

  private levelUpFx(level: number): void {
    this.sfx.levelUp();
    const spd = this.progression.attackSpeed;
    this.notifyToast(
      `Уровень ${level}! Больше HP, маны, урона и скорости` +
        (spd > 1.02 ? ` · атака ×${spd.toFixed(2)}` : "") +
        ` · +1 очко`,
    );
  }

  /**
   * Сервер сообщил об ударе: урон уже посчитан с учётом щита и меча,
   * клиент только играет эффекты. HP придёт состоянием.
   */
  private takeMobHit(
    dmg: number,
    fromX: number,
    fromZ: number,
    by: BlockedBy,
    stunSec?: number,
    knockback?: number,
    byMob?: string,
  ): void {
    const eye = this.player.eyePosition;
    const dir = new Vector3(eye.x - fromX, 0, eye.z - fromZ);
    if (dir.lengthSquared() > 1e-6) dir.normalize();
    else dir.set(0, 0, 1);
    if (by === 3) {
      // Увернулся: ни урона, ни станa/отбрасывания — «MISS» над источником
      // удара, но не раньше, чем замах/выстрел визуально долетит. Моб мог
      // убежать вперёд за это время — следуем за ним, а не за застывшей точкой.
      this.crossFx.missText(fromX, eye.y - 1, fromZ, MISS_FX_DELAY, this.missFollowMob(byMob));
      return;
    }
    if (by !== 0) this.combat.playBlock(by);
    if (stunSec) this.player.applyStun(stunSec);
    if (knockback) this.player.applyKnockback(dir.x, dir.z, knockback);
    if (dmg <= 0) return;
    // Сообщение приходит раньше патча состояния — снимаем HP сразу, чтобы
    // полоса и виньетка не отставали. syncSelf() тут же всё сверит с сервером.
    this.player.setHp(this.player.hp - dmg);
    this.player.hurtFx(dmg, dir);
  }

  /** Резолвер для WorldCrossFx.missText: живая точка над мобом id, или null. */
  private missFollowMob(id?: string): (() => { x: number; y: number; z: number } | null) | null {
    if (!id) return null;
    return () => {
      const m = this.netMobs.getMob(id);
      if (!m) return null;
      const c = m.center();
      return { x: c.x, y: c.y - 1, z: c.z };
    };
  }

  private saveNow(): void {
    if (!this.net?.online) return;
    const msg: SaveMsg = this.player.snapshotState();
    this.net.sendSave(msg);
  }

  /**
   * Выйти из мира — на экран входа. Сохраняемся, выходим из VR и
   * перезагружаем страницу: так не остаётся полуразобранного состояния.
   * Сам разрыв соединения сервер ловит в onLeave и тоже пишет сейв.
   */
  async leaveWorld(): Promise<void> {
    this.saveNow();
    // Явный уход (consented=true) — иначе сервер видит обрыв связи и держит
    // игрока в мире/у спектатора ~20с (allowReconnection) на любой платформе.
    try {
      await this.net?.disconnect();
    } catch {
      /* всё равно перезагружаемся ниже */
    }
    try {
      await raceTimeout(this.xr?.baseExperience.exitXRAsync(), 2000);
    } catch {
      /* уже вне XR или зависла XR-сессия — не блокируем выход */
    }
    window.location.reload();
  }

  private detachNet(): void {
    this.lastSentPlat = 0;
    if (this.saveTimer !== null) window.clearInterval(this.saveTimer);
    if (this.saveDebounce !== null) window.clearTimeout(this.saveDebounce);
    window.removeEventListener("beforeunload", this.beforeUnload);
    this.unsubProgress?.();
    this.saveTimer = this.saveDebounce = null;
    this.unsubProgress = null;
    this.netMobs.detach();
    this.loot.detach();
    this.voice.dispose();
    this.voice.send = null;
    this.voice.sendVoice = null;
    this.inventory.onUseRequest = null;
    this.inventory.clear();
    this.combat.nearestWorldWeapon = null;
    this.combat.onTakeWorldWeapon = null;
    this.combat.makeWeaponMesh = null;
    this.combat.onWeaponLanded = null;
    this.combat.onSoundEvent = null;
    this.combat.onCast = null;
    this.combat.onLowMana = null;
    this.combat.onMassHealStart = null;
    this.combat.onVrSkill = null;
    this.combat.onMassHealCooldown = null;
    this.combat.nearestAlly = null;
    this.player.netControlled = false;
    this.player.dead = false;
    this.progression.onSpendRequest = null;
    this.hud.setDead(false);
    if (this.net) {
      this.net.onChar = null;
      this.net.onMobHit = null;
      this.net.onRespawn = null;
      this.net.onLevelUp = null;
      this.net.onBossEvent = null;
      this.net.onWorldEvent = null;
      this.net.onPicked = null;
      this.net.onPickupFeed = null;
      this.net.onKillFeed = null;
      this.net.onChatLine = null;
      this.net.onDmgHits = null;
      this.net.onPcInvData = null;
      this.net.onQuestData = null;
      this.net.onShopData = null;
      this.net.onPcInvResult = null;
      this.net.onWarehouse = null;
      this.net.onRtc = null;
      this.net.onAct = null;
      this.net.onTtsPlay = null;
      this.net.onBotSay = null;
      this.net.onEmote = null;
      this.net.onVoice = null;
      this.net.onPvp = null;
      this.net.onConnectionLost = null;
      this.net.onReconnected = null;
      this.net.onKicked = null;
      void this.net.disconnect(); // остановить попытки переподключения
    }
    for (const a of this.avatars.values()) this.dropAvatar(a);
    this.avatars.clear();
    this.net = null;
  }

  /** Каждый кадр: отдать свой транспорт, применить чужой. */
  private handsCheckN = 0;
  private avTick = 0;
  private syncNet(dt: number): void {
    const net = this.net;
    if (!net?.online || !net.room) {
      // Идёт переподключение — держим всё как есть, мир просто замирает.
      if (net?.busyReconnecting) return;
      if (this.avatars.size || this.net) this.detachNet();
      return;
    }

    const m = this.moveMsg;
    m.mode = this.player.inVR ? "vr" : "flat";
    // Платформа (значок у ника) — не в каждом пакете, а только при первой отправке в сессии и
    // при смене (вход/выход из VR): сервер хранит её в состоянии игрока.
    const plat = this.player.inVR ? 3 : this.isTouch ? 2 : 1;
    if (plat !== this.lastSentPlat) {
      m.plat = plat;
      this.lastSentPlat = plat;
    } else {
      m.plat = undefined;
    }
    const g = this.combat.guardState();
    m.guard.sx = g.sx;
    m.guard.sz = g.sz;
    m.guard.wx = g.wx;
    m.guard.wz = g.wz;
    writeXf(m.head, this.player.eyePosition, this.player.eyeRotation);
    if (m.mode === "vr") {
      const l = this.hands.nodeFor("left");
      const r = this.hands.nodeFor("right");
      if (l) writeXf(m.handL, l.getAbsolutePosition(), l.absoluteRotationQuaternion);
      if (r) writeXf(m.handR, r.getAbsolutePosition(), r.absoluteRotationQuaternion);
    }
    const now = performance.now();
    net.sendMove(now, m);

    // Что в руках — только когда поменялось: по этому сервер считает урон. Проверяем раз в 3 кадра (~80–100 мс):
    // снимки и ключ — это массивы и строки на каждый кадр (мусор для GC), а смена оружия куда реже.
    if ((this.handsCheckN++ % 3) === 0) {
      const hands = this.combat.handsSnapshot();
      const stowed = this.combat.stowedSnapshot();
      const key =
        `${hands.left?.cls ?? ""}:${hands.left?.tier ?? ""}|${hands.right?.cls ?? ""}:${hands.right?.tier ?? ""}` +
        `|${stowed.map((s) => `${s.side}:${s.cls}:${s.tier}`).sort().join(",")}`;
      if (key !== this.handsKey) {
        this.handsKey = key;
        net.sendHands({
          left: hands.left as { cls: WeaponClass; tier: WeaponTier } | null,
          right: hands.right as { cls: WeaponClass; tier: WeaponTier } | null,
          stowed,
        });
      }
    }

    const self = net.self;
    if (self) this.syncSelf(dt, self);
    const myPvp = self?.pvp === 1;

    const players = net.room.state.players;
    // Удалённые герои дальше 25 м — через кадр (по очереди: половина в чётный кадр, половина в нечётный); ближние — каждый кадр.
    const eye = this.player.eyePosition;
    this.avTick++;
    let ai = 0;
    for (const [id, avatar] of this.avatars) {
      ai++;
      const ap = avatar.position;
      const dx = ap.x - eye.x;
      const dz = ap.z - eye.z;
      if (dx * dx + dz * dz > 625 && ((ai + this.avTick) & 1) === 1) continue;
      const p = players.get(id);
      if (p) avatar.push(now, p);
      avatar.setMyPvp(myPvp);
      avatar.update(now);
    }

    this.updateSpecMarker(net.room.state);
  }

  /** Метка камеры стрима (Ф10) — видна, только пока и подключён спектатор, и её не спрятали с пульта. */
  private readonly _specPos = new Vector3();
  private readonly _specTgt = new Vector3();

  private updateSpecMarker(st: ZoneState): void {
    if (!this.specMarker) return;
    const show = st.specActive === 1 && st.specVisible === 1;
    if (show !== this.specMarkerShown) {
      this.specMarkerShown = show;
      this.specMarker.setEnabled(show);
    }
    const rays = st.specRaysVisible === 1;
    if (rays !== this.specRaysShown) {
      this.specRaysShown = rays;
      this.specMarker.setRaysEnabled(rays);
    }
    if (show) {
      this._specPos.set(st.specX, st.specY, st.specZ);
      this._specTgt.set(st.specTX, st.specTY, st.specTZ);
      this.specMarker.setPose(this._specPos, this._specTgt);
    }
  }

  private hapticBoth(): void {
    for (const hand of ["left", "right"] as const) {
      const pad = this.xr?.input.controllers.find((c) => c.inputSource.handedness === hand)
        ?.inputSource.gamepad as
        | { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] }
        | undefined;
      pad?.hapticActuators?.[0]?.pulse?.(0.7, 120);
    }
  }
}

/** Мировая вертикаль — ориентация слушателя для звука по месту. */
const UP = new Vector3(0, 1, 0);

/**
 * Задержка «MISS» после уворота: сервер решает попадание/промах В МОМЕНТ
 * замаха/выстрела (не когда он визуально долетел) — ждём, чтобы текст не
 * всплывал раньше, чем атака отыграет.
 */
const MISS_FX_DELAY = 0.35;

function zeros7(): Xf7 {
  return [0, 0, 0, 0, 0, 0, 1];
}

function writeXf(dst: Xf7, pos: Vector3, q: Quaternion): void {
  dst[0] = pos.x;
  dst[1] = pos.y;
  dst[2] = pos.z;
  dst[3] = q.x;
  dst[4] = q.y;
  dst[5] = q.z;
  dst[6] = q.w;
}
