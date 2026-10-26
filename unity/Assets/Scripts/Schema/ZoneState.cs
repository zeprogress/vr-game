// 
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
// 
// GENERATED USING @colyseus/schema 2.0.37
// 

using Colyseus.Schema;
using Action = System.Action;
#if UNITY_5_3_OR_NEWER
using UnityEngine.Scripting;
#endif

namespace ZepSchema {
	public partial class ZoneState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public ZoneState() { }
		[Type(0, "float32")]
		public float hour = default(float);

		[Type(1, "uint8")]
		public byte dayAuto = default(byte);

		[Type(2, "uint8")]
		public byte comfortVignette = default(byte);

		[Type(3, "uint8")]
		public byte mobsOn = default(byte);

		[Type(4, "uint8")]
		public byte teleportMove = default(byte);

		[Type(5, "float32")]
		public float specX = default(float);

		[Type(6, "float32")]
		public float specY = default(float);

		[Type(7, "float32")]
		public float specZ = default(float);

		[Type(8, "float32")]
		public float specTX = default(float);

		[Type(9, "float32")]
		public float specTY = default(float);

		[Type(10, "float32")]
		public float specTZ = default(float);

		[Type(11, "uint8")]
		public byte specActive = default(byte);

		[Type(12, "uint8")]
		public byte specVisible = default(byte);

		[Type(13, "uint8")]
		public byte specRaysVisible = default(byte);

		[Type(14, "uint8")]
		public byte specVoice = default(byte);

		[Type(15, "uint8")]
		public byte dmgNumbers = default(byte);

		[Type(16, "uint8")]
		public byte specMusicVol = default(byte);

		[Type(17, "uint8")]
		public byte specSfxVol = default(byte);

		[Type(18, "uint8")]
		public byte specEventVol = default(byte);

		[Type(19, "uint8")]
		public byte ttsOn = default(byte);

		[Type(20, "string")]
		public string ttsVoice = default(string);

		[Type(21, "string")]
		public string worldLoadout = default(string);

		[Type(22, "string")]
		public string cqTitle = default(string);

		[Type(23, "uint16")]
		public ushort cqGot = default(ushort);

		[Type(24, "uint16")]
		public ushort cqNeed = default(ushort);

		[Type(25, "uint16")]
		public ushort cqSecs = default(ushort);

		[Type(26, "uint8")]
		public byte eventKind = default(byte);

		[Type(27, "float32")]
		public float eventX = default(float);

		[Type(28, "float32")]
		public float eventZ = default(float);

		[Type(29, "uint8")]
		public byte eventLeft = default(byte);

		[Type(30, "uint8")]
		public byte catPhase = default(byte);

		[Type(31, "uint8")]
		public byte catLo = default(byte);

		[Type(32, "uint8")]
		public byte catHi = default(byte);

		[Type(33, "string")]
		public string catRoute = default(string);

		[Type(34, "uint8")]
		public byte catLives = default(byte);

		[Type(35, "uint16")]
		public ushort catLeft = default(ushort);

		[Type(36, "uint8")]
		public byte catParty = default(byte);

		[Type(37, "uint8")]
		public byte catStage = default(byte);

		[Type(38, "uint8")]
		public byte catFinal = default(byte);

		[Type(39, "string")]
		public string catBoss = default(string);

		[Type(40, "string")]
		public string catThemes = default(string);

		[Type(41, "float32")]
		public float catShrineX = default(float);

		[Type(42, "float32")]
		public float catShrineZ = default(float);

		[Type(43, "int8")]
		public sbyte catShrine = default(sbyte);

		[Type(44, "ref", typeof(RaidSync))]
		public RaidSync raid = new RaidSync();

		[Type(45, "map", typeof(MapSchema<PlayerState>))]
		public MapSchema<PlayerState> players = new MapSchema<PlayerState>();

		[Type(46, "map", typeof(MapSchema<MobState>))]
		public MapSchema<MobState> mobs = new MapSchema<MobState>();

		[Type(47, "map", typeof(MapSchema<DummyState>))]
		public MapSchema<DummyState> dummies = new MapSchema<DummyState>();

		[Type(48, "map", typeof(MapSchema<BallState>))]
		public MapSchema<BallState> balls = new MapSchema<BallState>();

		[Type(49, "map", typeof(MapSchema<BoltState>))]
		public MapSchema<BoltState> bolts = new MapSchema<BoltState>();

		[Type(50, "map", typeof(MapSchema<DropState>))]
		public MapSchema<DropState> drops = new MapSchema<DropState>();

		/*
		 * Support for individual property change callbacks below...
		 */

		protected event PropertyChangeHandler<float> __hourChange;
		public Action OnHourChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hour));
			__hourChange += __handler;
			if (__immediate && this.hour != default(float)) { __handler(this.hour, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hour));
				__hourChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __dayAutoChange;
		public Action OnDayAutoChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.dayAuto));
			__dayAutoChange += __handler;
			if (__immediate && this.dayAuto != default(byte)) { __handler(this.dayAuto, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(dayAuto));
				__dayAutoChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __comfortVignetteChange;
		public Action OnComfortVignetteChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.comfortVignette));
			__comfortVignetteChange += __handler;
			if (__immediate && this.comfortVignette != default(byte)) { __handler(this.comfortVignette, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(comfortVignette));
				__comfortVignetteChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __mobsOnChange;
		public Action OnMobsOnChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.mobsOn));
			__mobsOnChange += __handler;
			if (__immediate && this.mobsOn != default(byte)) { __handler(this.mobsOn, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(mobsOn));
				__mobsOnChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __teleportMoveChange;
		public Action OnTeleportMoveChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.teleportMove));
			__teleportMoveChange += __handler;
			if (__immediate && this.teleportMove != default(byte)) { __handler(this.teleportMove, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(teleportMove));
				__teleportMoveChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __specXChange;
		public Action OnSpecXChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specX));
			__specXChange += __handler;
			if (__immediate && this.specX != default(float)) { __handler(this.specX, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specX));
				__specXChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __specYChange;
		public Action OnSpecYChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specY));
			__specYChange += __handler;
			if (__immediate && this.specY != default(float)) { __handler(this.specY, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specY));
				__specYChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __specZChange;
		public Action OnSpecZChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specZ));
			__specZChange += __handler;
			if (__immediate && this.specZ != default(float)) { __handler(this.specZ, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specZ));
				__specZChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __specTXChange;
		public Action OnSpecTXChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specTX));
			__specTXChange += __handler;
			if (__immediate && this.specTX != default(float)) { __handler(this.specTX, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specTX));
				__specTXChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __specTYChange;
		public Action OnSpecTYChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specTY));
			__specTYChange += __handler;
			if (__immediate && this.specTY != default(float)) { __handler(this.specTY, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specTY));
				__specTYChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __specTZChange;
		public Action OnSpecTZChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specTZ));
			__specTZChange += __handler;
			if (__immediate && this.specTZ != default(float)) { __handler(this.specTZ, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specTZ));
				__specTZChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specActiveChange;
		public Action OnSpecActiveChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specActive));
			__specActiveChange += __handler;
			if (__immediate && this.specActive != default(byte)) { __handler(this.specActive, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specActive));
				__specActiveChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specVisibleChange;
		public Action OnSpecVisibleChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specVisible));
			__specVisibleChange += __handler;
			if (__immediate && this.specVisible != default(byte)) { __handler(this.specVisible, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specVisible));
				__specVisibleChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specRaysVisibleChange;
		public Action OnSpecRaysVisibleChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specRaysVisible));
			__specRaysVisibleChange += __handler;
			if (__immediate && this.specRaysVisible != default(byte)) { __handler(this.specRaysVisible, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specRaysVisible));
				__specRaysVisibleChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specVoiceChange;
		public Action OnSpecVoiceChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specVoice));
			__specVoiceChange += __handler;
			if (__immediate && this.specVoice != default(byte)) { __handler(this.specVoice, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specVoice));
				__specVoiceChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __dmgNumbersChange;
		public Action OnDmgNumbersChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.dmgNumbers));
			__dmgNumbersChange += __handler;
			if (__immediate && this.dmgNumbers != default(byte)) { __handler(this.dmgNumbers, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(dmgNumbers));
				__dmgNumbersChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specMusicVolChange;
		public Action OnSpecMusicVolChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specMusicVol));
			__specMusicVolChange += __handler;
			if (__immediate && this.specMusicVol != default(byte)) { __handler(this.specMusicVol, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specMusicVol));
				__specMusicVolChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specSfxVolChange;
		public Action OnSpecSfxVolChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specSfxVol));
			__specSfxVolChange += __handler;
			if (__immediate && this.specSfxVol != default(byte)) { __handler(this.specSfxVol, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specSfxVol));
				__specSfxVolChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __specEventVolChange;
		public Action OnSpecEventVolChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.specEventVol));
			__specEventVolChange += __handler;
			if (__immediate && this.specEventVol != default(byte)) { __handler(this.specEventVol, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(specEventVol));
				__specEventVolChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __ttsOnChange;
		public Action OnTtsOnChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ttsOn));
			__ttsOnChange += __handler;
			if (__immediate && this.ttsOn != default(byte)) { __handler(this.ttsOn, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ttsOn));
				__ttsOnChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __ttsVoiceChange;
		public Action OnTtsVoiceChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ttsVoice));
			__ttsVoiceChange += __handler;
			if (__immediate && this.ttsVoice != default(string)) { __handler(this.ttsVoice, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ttsVoice));
				__ttsVoiceChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __worldLoadoutChange;
		public Action OnWorldLoadoutChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.worldLoadout));
			__worldLoadoutChange += __handler;
			if (__immediate && this.worldLoadout != default(string)) { __handler(this.worldLoadout, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(worldLoadout));
				__worldLoadoutChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __cqTitleChange;
		public Action OnCqTitleChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cqTitle));
			__cqTitleChange += __handler;
			if (__immediate && this.cqTitle != default(string)) { __handler(this.cqTitle, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cqTitle));
				__cqTitleChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __cqGotChange;
		public Action OnCqGotChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cqGot));
			__cqGotChange += __handler;
			if (__immediate && this.cqGot != default(ushort)) { __handler(this.cqGot, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cqGot));
				__cqGotChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __cqNeedChange;
		public Action OnCqNeedChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cqNeed));
			__cqNeedChange += __handler;
			if (__immediate && this.cqNeed != default(ushort)) { __handler(this.cqNeed, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cqNeed));
				__cqNeedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __cqSecsChange;
		public Action OnCqSecsChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cqSecs));
			__cqSecsChange += __handler;
			if (__immediate && this.cqSecs != default(ushort)) { __handler(this.cqSecs, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cqSecs));
				__cqSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __eventKindChange;
		public Action OnEventKindChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.eventKind));
			__eventKindChange += __handler;
			if (__immediate && this.eventKind != default(byte)) { __handler(this.eventKind, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(eventKind));
				__eventKindChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __eventXChange;
		public Action OnEventXChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.eventX));
			__eventXChange += __handler;
			if (__immediate && this.eventX != default(float)) { __handler(this.eventX, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(eventX));
				__eventXChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __eventZChange;
		public Action OnEventZChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.eventZ));
			__eventZChange += __handler;
			if (__immediate && this.eventZ != default(float)) { __handler(this.eventZ, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(eventZ));
				__eventZChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __eventLeftChange;
		public Action OnEventLeftChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.eventLeft));
			__eventLeftChange += __handler;
			if (__immediate && this.eventLeft != default(byte)) { __handler(this.eventLeft, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(eventLeft));
				__eventLeftChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catPhaseChange;
		public Action OnCatPhaseChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catPhase));
			__catPhaseChange += __handler;
			if (__immediate && this.catPhase != default(byte)) { __handler(this.catPhase, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catPhase));
				__catPhaseChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catLoChange;
		public Action OnCatLoChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catLo));
			__catLoChange += __handler;
			if (__immediate && this.catLo != default(byte)) { __handler(this.catLo, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catLo));
				__catLoChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catHiChange;
		public Action OnCatHiChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catHi));
			__catHiChange += __handler;
			if (__immediate && this.catHi != default(byte)) { __handler(this.catHi, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catHi));
				__catHiChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __catRouteChange;
		public Action OnCatRouteChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catRoute));
			__catRouteChange += __handler;
			if (__immediate && this.catRoute != default(string)) { __handler(this.catRoute, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catRoute));
				__catRouteChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catLivesChange;
		public Action OnCatLivesChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catLives));
			__catLivesChange += __handler;
			if (__immediate && this.catLives != default(byte)) { __handler(this.catLives, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catLives));
				__catLivesChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __catLeftChange;
		public Action OnCatLeftChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catLeft));
			__catLeftChange += __handler;
			if (__immediate && this.catLeft != default(ushort)) { __handler(this.catLeft, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catLeft));
				__catLeftChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catPartyChange;
		public Action OnCatPartyChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catParty));
			__catPartyChange += __handler;
			if (__immediate && this.catParty != default(byte)) { __handler(this.catParty, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catParty));
				__catPartyChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catStageChange;
		public Action OnCatStageChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catStage));
			__catStageChange += __handler;
			if (__immediate && this.catStage != default(byte)) { __handler(this.catStage, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catStage));
				__catStageChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catFinalChange;
		public Action OnCatFinalChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catFinal));
			__catFinalChange += __handler;
			if (__immediate && this.catFinal != default(byte)) { __handler(this.catFinal, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catFinal));
				__catFinalChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __catBossChange;
		public Action OnCatBossChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catBoss));
			__catBossChange += __handler;
			if (__immediate && this.catBoss != default(string)) { __handler(this.catBoss, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catBoss));
				__catBossChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __catThemesChange;
		public Action OnCatThemesChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catThemes));
			__catThemesChange += __handler;
			if (__immediate && this.catThemes != default(string)) { __handler(this.catThemes, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catThemes));
				__catThemesChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __catShrineXChange;
		public Action OnCatShrineXChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catShrineX));
			__catShrineXChange += __handler;
			if (__immediate && this.catShrineX != default(float)) { __handler(this.catShrineX, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catShrineX));
				__catShrineXChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __catShrineZChange;
		public Action OnCatShrineZChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catShrineZ));
			__catShrineZChange += __handler;
			if (__immediate && this.catShrineZ != default(float)) { __handler(this.catShrineZ, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catShrineZ));
				__catShrineZChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<sbyte> __catShrineChange;
		public Action OnCatShrineChange(PropertyChangeHandler<sbyte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catShrine));
			__catShrineChange += __handler;
			if (__immediate && this.catShrine != default(sbyte)) { __handler(this.catShrine, default(sbyte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catShrine));
				__catShrineChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<RaidSync> __raidChange;
		public Action OnRaidChange(PropertyChangeHandler<RaidSync> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.raid));
			__raidChange += __handler;
			if (__immediate && this.raid != null) { __handler(this.raid, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(raid));
				__raidChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<MapSchema<PlayerState>> __playersChange;
		public Action OnPlayersChange(PropertyChangeHandler<MapSchema<PlayerState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.players));
			__playersChange += __handler;
			if (__immediate && this.players != null) { __handler(this.players, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(players));
				__playersChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<MapSchema<MobState>> __mobsChange;
		public Action OnMobsChange(PropertyChangeHandler<MapSchema<MobState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.mobs));
			__mobsChange += __handler;
			if (__immediate && this.mobs != null) { __handler(this.mobs, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(mobs));
				__mobsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<MapSchema<DummyState>> __dummiesChange;
		public Action OnDummiesChange(PropertyChangeHandler<MapSchema<DummyState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.dummies));
			__dummiesChange += __handler;
			if (__immediate && this.dummies != null) { __handler(this.dummies, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(dummies));
				__dummiesChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<MapSchema<BallState>> __ballsChange;
		public Action OnBallsChange(PropertyChangeHandler<MapSchema<BallState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.balls));
			__ballsChange += __handler;
			if (__immediate && this.balls != null) { __handler(this.balls, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(balls));
				__ballsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<MapSchema<BoltState>> __boltsChange;
		public Action OnBoltsChange(PropertyChangeHandler<MapSchema<BoltState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.bolts));
			__boltsChange += __handler;
			if (__immediate && this.bolts != null) { __handler(this.bolts, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(bolts));
				__boltsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<MapSchema<DropState>> __dropsChange;
		public Action OnDropsChange(PropertyChangeHandler<MapSchema<DropState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.drops));
			__dropsChange += __handler;
			if (__immediate && this.drops != null) { __handler(this.drops, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(drops));
				__dropsChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(hour): __hourChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(dayAuto): __dayAutoChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(comfortVignette): __comfortVignetteChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(mobsOn): __mobsOnChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(teleportMove): __teleportMoveChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specX): __specXChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(specY): __specYChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(specZ): __specZChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(specTX): __specTXChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(specTY): __specTYChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(specTZ): __specTZChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(specActive): __specActiveChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specVisible): __specVisibleChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specRaysVisible): __specRaysVisibleChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specVoice): __specVoiceChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(dmgNumbers): __dmgNumbersChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specMusicVol): __specMusicVolChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specSfxVol): __specSfxVolChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(specEventVol): __specEventVolChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(ttsOn): __ttsOnChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(ttsVoice): __ttsVoiceChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(worldLoadout): __worldLoadoutChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(cqTitle): __cqTitleChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(cqGot): __cqGotChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(cqNeed): __cqNeedChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(cqSecs): __cqSecsChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(eventKind): __eventKindChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(eventX): __eventXChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(eventZ): __eventZChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(eventLeft): __eventLeftChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catPhase): __catPhaseChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catLo): __catLoChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catHi): __catHiChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catRoute): __catRouteChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(catLives): __catLivesChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catLeft): __catLeftChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(catParty): __catPartyChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catStage): __catStageChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catFinal): __catFinalChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catBoss): __catBossChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(catThemes): __catThemesChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(catShrineX): __catShrineXChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(catShrineZ): __catShrineZChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(catShrine): __catShrineChange?.Invoke((sbyte) change.Value, (sbyte) change.PreviousValue); break;
				case nameof(raid): __raidChange?.Invoke((RaidSync) change.Value, (RaidSync) change.PreviousValue); break;
				case nameof(players): __playersChange?.Invoke((MapSchema<PlayerState>) change.Value, (MapSchema<PlayerState>) change.PreviousValue); break;
				case nameof(mobs): __mobsChange?.Invoke((MapSchema<MobState>) change.Value, (MapSchema<MobState>) change.PreviousValue); break;
				case nameof(dummies): __dummiesChange?.Invoke((MapSchema<DummyState>) change.Value, (MapSchema<DummyState>) change.PreviousValue); break;
				case nameof(balls): __ballsChange?.Invoke((MapSchema<BallState>) change.Value, (MapSchema<BallState>) change.PreviousValue); break;
				case nameof(bolts): __boltsChange?.Invoke((MapSchema<BoltState>) change.Value, (MapSchema<BoltState>) change.PreviousValue); break;
				case nameof(drops): __dropsChange?.Invoke((MapSchema<DropState>) change.Value, (MapSchema<DropState>) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
