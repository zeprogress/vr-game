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
	public partial class PlayerState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public PlayerState() { }
		[Type(0, "string")]
		public string nick = default(string);

		[Type(1, "string")]
		public string mode = default(string);

		[Type(2, "uint8")]
		public byte skin = default(byte);

		[Type(3, "ref", typeof(Xf))]
		public Xf head = new Xf();

		[Type(4, "ref", typeof(Xf))]
		public Xf handL = new Xf();

		[Type(5, "ref", typeof(Xf))]
		public Xf handR = new Xf();

		[Type(6, "float32")]
		public float hp = default(float);

		[Type(7, "float32")]
		public float maxHp = default(float);

		[Type(8, "uint8")]
		public byte dead = default(byte);

		[Type(9, "uint8")]
		public byte pvp = default(byte);

		[Type(10, "uint16")]
		public ushort level = default(ushort);

		[Type(11, "float64")]
		public double xp = default(double);

		[Type(12, "uint16")]
		public ushort unspent = default(ushort);

		[Type(13, "uint16")]
		public ushort str = default(ushort);

		[Type(14, "uint16")]
		public ushort agi = default(ushort);

		[Type(15, "uint16")]
		public ushort @int = default(ushort);

		[Type(16, "float32")]
		public float mana = default(float);

		[Type(17, "float32")]
		public float maxMana = default(float);

		[Type(18, "uint16")]
		public ushort buffSecs = default(ushort);

		[Type(19, "uint16")]
		public ushort campBuffSecs = default(ushort);

		[Type(20, "uint16")]
		public ushort scrollXpSecs = default(ushort);

		[Type(21, "string")]
		public string title = default(string);

		[Type(22, "uint16")]
		public ushort scrollWindSecs = default(ushort);

		[Type(23, "uint8")]
		public byte stunned = default(byte);

		[Type(24, "uint8")]
		public byte rooted = default(byte);

		[Type(25, "uint8")]
		public byte camPrio = default(byte);

		[Type(26, "uint8")]
		public byte catLife = default(byte);

		[Type(27, "uint8")]
		public byte fishing = default(byte);

		[Type(28, "string")]
		public string leftCls = default(string);

		[Type(29, "string")]
		public string leftTier = default(string);

		[Type(30, "string")]
		public string rightCls = default(string);

		[Type(31, "string")]
		public string rightTier = default(string);

		[Type(32, "string")]
		public string leftAffix = default(string);

		[Type(33, "string")]
		public string rightAffix = default(string);

		[Type(34, "boolean")]
		public bool leftRc = default(bool);

		[Type(35, "boolean")]
		public bool rightRc = default(bool);

		[Type(36, "array", typeof(ArraySchema<SlotState>))]
		public ArraySchema<SlotState> bag = new ArraySchema<SlotState>();

		[Type(37, "uint8")]
		public byte towerFloor = default(byte);

		[Type(38, "uint8")]
		public byte towerMobsLeft = default(byte);

		[Type(39, "uint16")]
		public ushort towerTimeSec = default(ushort);

		[Type(40, "uint8")]
		public byte towerMobsTotal = default(byte);

		[Type(41, "uint8")]
		public byte towerBossActive = default(byte);

		[Type(42, "float32")]
		public float towerBossHpFrac = default(float);

		[Type(43, "uint8")]
		public byte plat = default(byte);

		[Type(44, "uint16")]
		public ushort con = default(ushort);

		[Type(45, "uint16")]
		public ushort luc = default(ushort);

		[Type(46, "uint16")]
		public ushort wis = default(ushort);

		[Type(47, "string")]
		public string skill1 = default(string);

		[Type(48, "string")]
		public string skill2 = default(string);

		[Type(49, "uint8")]
		public byte crySecs = default(byte);

		[Type(50, "uint8")]
		public byte plagueSecs = default(byte);

		[Type(51, "uint8")]
		public byte abyssSecs = default(byte);

		[Type(52, "uint8")]
		public byte smokeSecs = default(byte);

		[Type(53, "uint8")]
		public byte ghostSecs = default(byte);

		[Type(54, "uint8")]
		public byte runSecs = default(byte);

		[Type(55, "uint8")]
		public byte focusStacks = default(byte);

		[Type(56, "uint8")]
		public byte cryKind = default(byte);

		[Type(57, "ref", typeof(GemBonusSync))]
		public GemBonusSync gb = new GemBonusSync();

		[Type(58, "ref", typeof(ArmorBonusSync))]
		public ArmorBonusSync ab = new ArmorBonusSync();

		[Type(59, "ref", typeof(TreeBonusSync))]
		public TreeBonusSync tb = new TreeBonusSync();

		[Type(60, "uint16")]
		public ushort kpm = default(ushort);

		/*
		 * Support for individual property change callbacks below...
		 */

		protected event PropertyChangeHandler<string> __nickChange;
		public Action OnNickChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.nick));
			__nickChange += __handler;
			if (__immediate && this.nick != default(string)) { __handler(this.nick, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(nick));
				__nickChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __modeChange;
		public Action OnModeChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.mode));
			__modeChange += __handler;
			if (__immediate && this.mode != default(string)) { __handler(this.mode, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(mode));
				__modeChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __skinChange;
		public Action OnSkinChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skin));
			__skinChange += __handler;
			if (__immediate && this.skin != default(byte)) { __handler(this.skin, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skin));
				__skinChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<Xf> __headChange;
		public Action OnHeadChange(PropertyChangeHandler<Xf> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.head));
			__headChange += __handler;
			if (__immediate && this.head != null) { __handler(this.head, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(head));
				__headChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<Xf> __handLChange;
		public Action OnHandLChange(PropertyChangeHandler<Xf> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.handL));
			__handLChange += __handler;
			if (__immediate && this.handL != null) { __handler(this.handL, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(handL));
				__handLChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<Xf> __handRChange;
		public Action OnHandRChange(PropertyChangeHandler<Xf> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.handR));
			__handRChange += __handler;
			if (__immediate && this.handR != null) { __handler(this.handR, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(handR));
				__handRChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __hpChange;
		public Action OnHpChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hp));
			__hpChange += __handler;
			if (__immediate && this.hp != default(float)) { __handler(this.hp, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hp));
				__hpChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __maxHpChange;
		public Action OnMaxHpChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.maxHp));
			__maxHpChange += __handler;
			if (__immediate && this.maxHp != default(float)) { __handler(this.maxHp, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(maxHp));
				__maxHpChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __deadChange;
		public Action OnDeadChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.dead));
			__deadChange += __handler;
			if (__immediate && this.dead != default(byte)) { __handler(this.dead, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(dead));
				__deadChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __pvpChange;
		public Action OnPvpChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.pvp));
			__pvpChange += __handler;
			if (__immediate && this.pvp != default(byte)) { __handler(this.pvp, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(pvp));
				__pvpChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __levelChange;
		public Action OnLevelChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.level));
			__levelChange += __handler;
			if (__immediate && this.level != default(ushort)) { __handler(this.level, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(level));
				__levelChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<double> __xpChange;
		public Action OnXpChange(PropertyChangeHandler<double> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.xp));
			__xpChange += __handler;
			if (__immediate && this.xp != default(double)) { __handler(this.xp, default(double)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(xp));
				__xpChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __unspentChange;
		public Action OnUnspentChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.unspent));
			__unspentChange += __handler;
			if (__immediate && this.unspent != default(ushort)) { __handler(this.unspent, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(unspent));
				__unspentChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __strChange;
		public Action OnStrChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.str));
			__strChange += __handler;
			if (__immediate && this.str != default(ushort)) { __handler(this.str, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(str));
				__strChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __agiChange;
		public Action OnAgiChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.agi));
			__agiChange += __handler;
			if (__immediate && this.agi != default(ushort)) { __handler(this.agi, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(agi));
				__agiChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __intChange;
		public Action OnIntChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.@int));
			__intChange += __handler;
			if (__immediate && this.@int != default(ushort)) { __handler(this.@int, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(@int));
				__intChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __manaChange;
		public Action OnManaChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.mana));
			__manaChange += __handler;
			if (__immediate && this.mana != default(float)) { __handler(this.mana, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(mana));
				__manaChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __maxManaChange;
		public Action OnMaxManaChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.maxMana));
			__maxManaChange += __handler;
			if (__immediate && this.maxMana != default(float)) { __handler(this.maxMana, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(maxMana));
				__maxManaChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __buffSecsChange;
		public Action OnBuffSecsChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.buffSecs));
			__buffSecsChange += __handler;
			if (__immediate && this.buffSecs != default(ushort)) { __handler(this.buffSecs, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(buffSecs));
				__buffSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __campBuffSecsChange;
		public Action OnCampBuffSecsChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.campBuffSecs));
			__campBuffSecsChange += __handler;
			if (__immediate && this.campBuffSecs != default(ushort)) { __handler(this.campBuffSecs, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(campBuffSecs));
				__campBuffSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __scrollXpSecsChange;
		public Action OnScrollXpSecsChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.scrollXpSecs));
			__scrollXpSecsChange += __handler;
			if (__immediate && this.scrollXpSecs != default(ushort)) { __handler(this.scrollXpSecs, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(scrollXpSecs));
				__scrollXpSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __titleChange;
		public Action OnTitleChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.title));
			__titleChange += __handler;
			if (__immediate && this.title != default(string)) { __handler(this.title, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(title));
				__titleChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __scrollWindSecsChange;
		public Action OnScrollWindSecsChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.scrollWindSecs));
			__scrollWindSecsChange += __handler;
			if (__immediate && this.scrollWindSecs != default(ushort)) { __handler(this.scrollWindSecs, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(scrollWindSecs));
				__scrollWindSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __stunnedChange;
		public Action OnStunnedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.stunned));
			__stunnedChange += __handler;
			if (__immediate && this.stunned != default(byte)) { __handler(this.stunned, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(stunned));
				__stunnedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __rootedChange;
		public Action OnRootedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.rooted));
			__rootedChange += __handler;
			if (__immediate && this.rooted != default(byte)) { __handler(this.rooted, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(rooted));
				__rootedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __camPrioChange;
		public Action OnCamPrioChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.camPrio));
			__camPrioChange += __handler;
			if (__immediate && this.camPrio != default(byte)) { __handler(this.camPrio, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(camPrio));
				__camPrioChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __catLifeChange;
		public Action OnCatLifeChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.catLife));
			__catLifeChange += __handler;
			if (__immediate && this.catLife != default(byte)) { __handler(this.catLife, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(catLife));
				__catLifeChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __fishingChange;
		public Action OnFishingChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.fishing));
			__fishingChange += __handler;
			if (__immediate && this.fishing != default(byte)) { __handler(this.fishing, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(fishing));
				__fishingChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __leftClsChange;
		public Action OnLeftClsChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.leftCls));
			__leftClsChange += __handler;
			if (__immediate && this.leftCls != default(string)) { __handler(this.leftCls, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(leftCls));
				__leftClsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __leftTierChange;
		public Action OnLeftTierChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.leftTier));
			__leftTierChange += __handler;
			if (__immediate && this.leftTier != default(string)) { __handler(this.leftTier, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(leftTier));
				__leftTierChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __rightClsChange;
		public Action OnRightClsChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.rightCls));
			__rightClsChange += __handler;
			if (__immediate && this.rightCls != default(string)) { __handler(this.rightCls, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(rightCls));
				__rightClsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __rightTierChange;
		public Action OnRightTierChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.rightTier));
			__rightTierChange += __handler;
			if (__immediate && this.rightTier != default(string)) { __handler(this.rightTier, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(rightTier));
				__rightTierChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __leftAffixChange;
		public Action OnLeftAffixChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.leftAffix));
			__leftAffixChange += __handler;
			if (__immediate && this.leftAffix != default(string)) { __handler(this.leftAffix, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(leftAffix));
				__leftAffixChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __rightAffixChange;
		public Action OnRightAffixChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.rightAffix));
			__rightAffixChange += __handler;
			if (__immediate && this.rightAffix != default(string)) { __handler(this.rightAffix, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(rightAffix));
				__rightAffixChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<bool> __leftRcChange;
		public Action OnLeftRcChange(PropertyChangeHandler<bool> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.leftRc));
			__leftRcChange += __handler;
			if (__immediate && this.leftRc != default(bool)) { __handler(this.leftRc, default(bool)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(leftRc));
				__leftRcChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<bool> __rightRcChange;
		public Action OnRightRcChange(PropertyChangeHandler<bool> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.rightRc));
			__rightRcChange += __handler;
			if (__immediate && this.rightRc != default(bool)) { __handler(this.rightRc, default(bool)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(rightRc));
				__rightRcChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ArraySchema<SlotState>> __bagChange;
		public Action OnBagChange(PropertyChangeHandler<ArraySchema<SlotState>> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.bag));
			__bagChange += __handler;
			if (__immediate && this.bag != null) { __handler(this.bag, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(bag));
				__bagChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __towerFloorChange;
		public Action OnTowerFloorChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.towerFloor));
			__towerFloorChange += __handler;
			if (__immediate && this.towerFloor != default(byte)) { __handler(this.towerFloor, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(towerFloor));
				__towerFloorChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __towerMobsLeftChange;
		public Action OnTowerMobsLeftChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.towerMobsLeft));
			__towerMobsLeftChange += __handler;
			if (__immediate && this.towerMobsLeft != default(byte)) { __handler(this.towerMobsLeft, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(towerMobsLeft));
				__towerMobsLeftChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __towerTimeSecChange;
		public Action OnTowerTimeSecChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.towerTimeSec));
			__towerTimeSecChange += __handler;
			if (__immediate && this.towerTimeSec != default(ushort)) { __handler(this.towerTimeSec, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(towerTimeSec));
				__towerTimeSecChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __towerMobsTotalChange;
		public Action OnTowerMobsTotalChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.towerMobsTotal));
			__towerMobsTotalChange += __handler;
			if (__immediate && this.towerMobsTotal != default(byte)) { __handler(this.towerMobsTotal, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(towerMobsTotal));
				__towerMobsTotalChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __towerBossActiveChange;
		public Action OnTowerBossActiveChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.towerBossActive));
			__towerBossActiveChange += __handler;
			if (__immediate && this.towerBossActive != default(byte)) { __handler(this.towerBossActive, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(towerBossActive));
				__towerBossActiveChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __towerBossHpFracChange;
		public Action OnTowerBossHpFracChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.towerBossHpFrac));
			__towerBossHpFracChange += __handler;
			if (__immediate && this.towerBossHpFrac != default(float)) { __handler(this.towerBossHpFrac, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(towerBossHpFrac));
				__towerBossHpFracChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __platChange;
		public Action OnPlatChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.plat));
			__platChange += __handler;
			if (__immediate && this.plat != default(byte)) { __handler(this.plat, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(plat));
				__platChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __conChange;
		public Action OnConChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.con));
			__conChange += __handler;
			if (__immediate && this.con != default(ushort)) { __handler(this.con, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(con));
				__conChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __lucChange;
		public Action OnLucChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.luc));
			__lucChange += __handler;
			if (__immediate && this.luc != default(ushort)) { __handler(this.luc, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(luc));
				__lucChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __wisChange;
		public Action OnWisChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.wis));
			__wisChange += __handler;
			if (__immediate && this.wis != default(ushort)) { __handler(this.wis, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(wis));
				__wisChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __skill1Change;
		public Action OnSkill1Change(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skill1));
			__skill1Change += __handler;
			if (__immediate && this.skill1 != default(string)) { __handler(this.skill1, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skill1));
				__skill1Change -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __skill2Change;
		public Action OnSkill2Change(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skill2));
			__skill2Change += __handler;
			if (__immediate && this.skill2 != default(string)) { __handler(this.skill2, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skill2));
				__skill2Change -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __crySecsChange;
		public Action OnCrySecsChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.crySecs));
			__crySecsChange += __handler;
			if (__immediate && this.crySecs != default(byte)) { __handler(this.crySecs, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(crySecs));
				__crySecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __plagueSecsChange;
		public Action OnPlagueSecsChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.plagueSecs));
			__plagueSecsChange += __handler;
			if (__immediate && this.plagueSecs != default(byte)) { __handler(this.plagueSecs, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(plagueSecs));
				__plagueSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __abyssSecsChange;
		public Action OnAbyssSecsChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.abyssSecs));
			__abyssSecsChange += __handler;
			if (__immediate && this.abyssSecs != default(byte)) { __handler(this.abyssSecs, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(abyssSecs));
				__abyssSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __smokeSecsChange;
		public Action OnSmokeSecsChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.smokeSecs));
			__smokeSecsChange += __handler;
			if (__immediate && this.smokeSecs != default(byte)) { __handler(this.smokeSecs, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(smokeSecs));
				__smokeSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __ghostSecsChange;
		public Action OnGhostSecsChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ghostSecs));
			__ghostSecsChange += __handler;
			if (__immediate && this.ghostSecs != default(byte)) { __handler(this.ghostSecs, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ghostSecs));
				__ghostSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __runSecsChange;
		public Action OnRunSecsChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.runSecs));
			__runSecsChange += __handler;
			if (__immediate && this.runSecs != default(byte)) { __handler(this.runSecs, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(runSecs));
				__runSecsChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __focusStacksChange;
		public Action OnFocusStacksChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.focusStacks));
			__focusStacksChange += __handler;
			if (__immediate && this.focusStacks != default(byte)) { __handler(this.focusStacks, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(focusStacks));
				__focusStacksChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __cryKindChange;
		public Action OnCryKindChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cryKind));
			__cryKindChange += __handler;
			if (__immediate && this.cryKind != default(byte)) { __handler(this.cryKind, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cryKind));
				__cryKindChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<GemBonusSync> __gbChange;
		public Action OnGbChange(PropertyChangeHandler<GemBonusSync> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.gb));
			__gbChange += __handler;
			if (__immediate && this.gb != null) { __handler(this.gb, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(gb));
				__gbChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ArmorBonusSync> __abChange;
		public Action OnAbChange(PropertyChangeHandler<ArmorBonusSync> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ab));
			__abChange += __handler;
			if (__immediate && this.ab != null) { __handler(this.ab, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ab));
				__abChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<TreeBonusSync> __tbChange;
		public Action OnTbChange(PropertyChangeHandler<TreeBonusSync> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.tb));
			__tbChange += __handler;
			if (__immediate && this.tb != null) { __handler(this.tb, null); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(tb));
				__tbChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __kpmChange;
		public Action OnKpmChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.kpm));
			__kpmChange += __handler;
			if (__immediate && this.kpm != default(ushort)) { __handler(this.kpm, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(kpm));
				__kpmChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(nick): __nickChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(mode): __modeChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(skin): __skinChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(head): __headChange?.Invoke((Xf) change.Value, (Xf) change.PreviousValue); break;
				case nameof(handL): __handLChange?.Invoke((Xf) change.Value, (Xf) change.PreviousValue); break;
				case nameof(handR): __handRChange?.Invoke((Xf) change.Value, (Xf) change.PreviousValue); break;
				case nameof(hp): __hpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(maxHp): __maxHpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(dead): __deadChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(pvp): __pvpChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(level): __levelChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(xp): __xpChange?.Invoke((double) change.Value, (double) change.PreviousValue); break;
				case nameof(unspent): __unspentChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(str): __strChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(agi): __agiChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(@int): __intChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(mana): __manaChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(maxMana): __maxManaChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(buffSecs): __buffSecsChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(campBuffSecs): __campBuffSecsChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(scrollXpSecs): __scrollXpSecsChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(title): __titleChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(scrollWindSecs): __scrollWindSecsChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(stunned): __stunnedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(rooted): __rootedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(camPrio): __camPrioChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(catLife): __catLifeChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(fishing): __fishingChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(leftCls): __leftClsChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(leftTier): __leftTierChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(rightCls): __rightClsChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(rightTier): __rightTierChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(leftAffix): __leftAffixChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(rightAffix): __rightAffixChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(leftRc): __leftRcChange?.Invoke((bool) change.Value, (bool) change.PreviousValue); break;
				case nameof(rightRc): __rightRcChange?.Invoke((bool) change.Value, (bool) change.PreviousValue); break;
				case nameof(bag): __bagChange?.Invoke((ArraySchema<SlotState>) change.Value, (ArraySchema<SlotState>) change.PreviousValue); break;
				case nameof(towerFloor): __towerFloorChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(towerMobsLeft): __towerMobsLeftChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(towerTimeSec): __towerTimeSecChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(towerMobsTotal): __towerMobsTotalChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(towerBossActive): __towerBossActiveChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(towerBossHpFrac): __towerBossHpFracChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(plat): __platChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(con): __conChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(luc): __lucChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(wis): __wisChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(skill1): __skill1Change?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(skill2): __skill2Change?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(crySecs): __crySecsChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(plagueSecs): __plagueSecsChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(abyssSecs): __abyssSecsChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(smokeSecs): __smokeSecsChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(ghostSecs): __ghostSecsChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(runSecs): __runSecsChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(focusStacks): __focusStacksChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(cryKind): __cryKindChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(gb): __gbChange?.Invoke((GemBonusSync) change.Value, (GemBonusSync) change.PreviousValue); break;
				case nameof(ab): __abChange?.Invoke((ArmorBonusSync) change.Value, (ArmorBonusSync) change.PreviousValue); break;
				case nameof(tb): __tbChange?.Invoke((TreeBonusSync) change.Value, (TreeBonusSync) change.PreviousValue); break;
				case nameof(kpm): __kpmChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
