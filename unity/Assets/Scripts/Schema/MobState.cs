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
	public partial class MobState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public MobState() { }
		[Type(0, "string")]
		public string kind = default(string);

		[Type(1, "float32")]
		public float x = default(float);

		[Type(2, "float32")]
		public float y = default(float);

		[Type(3, "float32")]
		public float z = default(float);

		[Type(4, "float32")]
		public float yaw = default(float);

		[Type(5, "float32")]
		public float hp = default(float);

		[Type(6, "float32")]
		public float maxHp = default(float);

		[Type(7, "uint8")]
		public byte dead = default(byte);

		[Type(8, "uint8")]
		public byte grounded = default(byte);

		[Type(9, "uint16")]
		public ushort hurtSeq = default(ushort);

		[Type(10, "uint16")]
		public ushort attackSeq = default(ushort);

		[Type(11, "uint8")]
		public byte attackKind = default(byte);

		[Type(12, "float32")]
		public float hurtDx = default(float);

		[Type(13, "float32")]
		public float hurtDz = default(float);

		[Type(14, "float32")]
		public float scale = default(float);

		[Type(15, "string")]
		public string model = default(string);

		[Type(16, "string")]
		public string mobName = default(string);

		[Type(17, "string")]
		public string info = default(string);

		[Type(18, "uint8")]
		public byte mobLevel = default(byte);

		[Type(19, "float32")]
		public float windup = default(float);

		[Type(20, "uint16")]
		public ushort slamSeq = default(ushort);

		[Type(21, "uint8")]
		public byte enraged = default(byte);

		[Type(22, "uint8")]
		public byte reflecting = default(byte);

		[Type(23, "uint8")]
		public byte charging = default(byte);

		[Type(24, "uint8")]
		public byte stunned = default(byte);

		[Type(25, "uint8")]
		public byte burning = default(byte);

		[Type(26, "uint8")]
		public byte bleeding = default(byte);

		[Type(27, "uint8")]
		public byte pinned = default(byte);

		[Type(28, "uint8")]
		public byte marked = default(byte);

		[Type(29, "uint8")]
		public byte under = default(byte);

		[Type(30, "uint8")]
		public byte armor = default(byte);

		[Type(31, "uint8")]
		public byte resPhys = default(byte);

		[Type(32, "uint8")]
		public byte resRanged = default(byte);

		[Type(33, "uint8")]
		public byte resMagic = default(byte);

		[Type(34, "uint8")]
		public byte resDodge = default(byte);

		[Type(35, "uint8")]
		public byte phase = default(byte);

		/*
		 * Support for individual property change callbacks below...
		 */

		protected event PropertyChangeHandler<string> __kindChange;
		public Action OnKindChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.kind));
			__kindChange += __handler;
			if (__immediate && this.kind != default(string)) { __handler(this.kind, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(kind));
				__kindChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __xChange;
		public Action OnXChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.x));
			__xChange += __handler;
			if (__immediate && this.x != default(float)) { __handler(this.x, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(x));
				__xChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __yChange;
		public Action OnYChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.y));
			__yChange += __handler;
			if (__immediate && this.y != default(float)) { __handler(this.y, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(y));
				__yChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __zChange;
		public Action OnZChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.z));
			__zChange += __handler;
			if (__immediate && this.z != default(float)) { __handler(this.z, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(z));
				__zChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __yawChange;
		public Action OnYawChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.yaw));
			__yawChange += __handler;
			if (__immediate && this.yaw != default(float)) { __handler(this.yaw, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(yaw));
				__yawChange -= __handler;
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

		protected event PropertyChangeHandler<byte> __groundedChange;
		public Action OnGroundedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.grounded));
			__groundedChange += __handler;
			if (__immediate && this.grounded != default(byte)) { __handler(this.grounded, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(grounded));
				__groundedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __hurtSeqChange;
		public Action OnHurtSeqChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hurtSeq));
			__hurtSeqChange += __handler;
			if (__immediate && this.hurtSeq != default(ushort)) { __handler(this.hurtSeq, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hurtSeq));
				__hurtSeqChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __attackSeqChange;
		public Action OnAttackSeqChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.attackSeq));
			__attackSeqChange += __handler;
			if (__immediate && this.attackSeq != default(ushort)) { __handler(this.attackSeq, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(attackSeq));
				__attackSeqChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __attackKindChange;
		public Action OnAttackKindChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.attackKind));
			__attackKindChange += __handler;
			if (__immediate && this.attackKind != default(byte)) { __handler(this.attackKind, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(attackKind));
				__attackKindChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __hurtDxChange;
		public Action OnHurtDxChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hurtDx));
			__hurtDxChange += __handler;
			if (__immediate && this.hurtDx != default(float)) { __handler(this.hurtDx, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hurtDx));
				__hurtDxChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __hurtDzChange;
		public Action OnHurtDzChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hurtDz));
			__hurtDzChange += __handler;
			if (__immediate && this.hurtDz != default(float)) { __handler(this.hurtDz, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hurtDz));
				__hurtDzChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __scaleChange;
		public Action OnScaleChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.scale));
			__scaleChange += __handler;
			if (__immediate && this.scale != default(float)) { __handler(this.scale, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(scale));
				__scaleChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __modelChange;
		public Action OnModelChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.model));
			__modelChange += __handler;
			if (__immediate && this.model != default(string)) { __handler(this.model, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(model));
				__modelChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __mobNameChange;
		public Action OnMobNameChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.mobName));
			__mobNameChange += __handler;
			if (__immediate && this.mobName != default(string)) { __handler(this.mobName, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(mobName));
				__mobNameChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __infoChange;
		public Action OnInfoChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.info));
			__infoChange += __handler;
			if (__immediate && this.info != default(string)) { __handler(this.info, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(info));
				__infoChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __mobLevelChange;
		public Action OnMobLevelChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.mobLevel));
			__mobLevelChange += __handler;
			if (__immediate && this.mobLevel != default(byte)) { __handler(this.mobLevel, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(mobLevel));
				__mobLevelChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __windupChange;
		public Action OnWindupChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.windup));
			__windupChange += __handler;
			if (__immediate && this.windup != default(float)) { __handler(this.windup, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(windup));
				__windupChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __slamSeqChange;
		public Action OnSlamSeqChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.slamSeq));
			__slamSeqChange += __handler;
			if (__immediate && this.slamSeq != default(ushort)) { __handler(this.slamSeq, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(slamSeq));
				__slamSeqChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __enragedChange;
		public Action OnEnragedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.enraged));
			__enragedChange += __handler;
			if (__immediate && this.enraged != default(byte)) { __handler(this.enraged, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(enraged));
				__enragedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __reflectingChange;
		public Action OnReflectingChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.reflecting));
			__reflectingChange += __handler;
			if (__immediate && this.reflecting != default(byte)) { __handler(this.reflecting, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(reflecting));
				__reflectingChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __chargingChange;
		public Action OnChargingChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.charging));
			__chargingChange += __handler;
			if (__immediate && this.charging != default(byte)) { __handler(this.charging, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(charging));
				__chargingChange -= __handler;
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

		protected event PropertyChangeHandler<byte> __burningChange;
		public Action OnBurningChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.burning));
			__burningChange += __handler;
			if (__immediate && this.burning != default(byte)) { __handler(this.burning, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(burning));
				__burningChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __bleedingChange;
		public Action OnBleedingChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.bleeding));
			__bleedingChange += __handler;
			if (__immediate && this.bleeding != default(byte)) { __handler(this.bleeding, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(bleeding));
				__bleedingChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __pinnedChange;
		public Action OnPinnedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.pinned));
			__pinnedChange += __handler;
			if (__immediate && this.pinned != default(byte)) { __handler(this.pinned, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(pinned));
				__pinnedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __markedChange;
		public Action OnMarkedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.marked));
			__markedChange += __handler;
			if (__immediate && this.marked != default(byte)) { __handler(this.marked, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(marked));
				__markedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __underChange;
		public Action OnUnderChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.under));
			__underChange += __handler;
			if (__immediate && this.under != default(byte)) { __handler(this.under, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(under));
				__underChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __armorChange;
		public Action OnArmorChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.armor));
			__armorChange += __handler;
			if (__immediate && this.armor != default(byte)) { __handler(this.armor, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(armor));
				__armorChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __resPhysChange;
		public Action OnResPhysChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.resPhys));
			__resPhysChange += __handler;
			if (__immediate && this.resPhys != default(byte)) { __handler(this.resPhys, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(resPhys));
				__resPhysChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __resRangedChange;
		public Action OnResRangedChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.resRanged));
			__resRangedChange += __handler;
			if (__immediate && this.resRanged != default(byte)) { __handler(this.resRanged, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(resRanged));
				__resRangedChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __resMagicChange;
		public Action OnResMagicChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.resMagic));
			__resMagicChange += __handler;
			if (__immediate && this.resMagic != default(byte)) { __handler(this.resMagic, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(resMagic));
				__resMagicChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __resDodgeChange;
		public Action OnResDodgeChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.resDodge));
			__resDodgeChange += __handler;
			if (__immediate && this.resDodge != default(byte)) { __handler(this.resDodge, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(resDodge));
				__resDodgeChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __phaseChange;
		public Action OnPhaseChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.phase));
			__phaseChange += __handler;
			if (__immediate && this.phase != default(byte)) { __handler(this.phase, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(phase));
				__phaseChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(kind): __kindChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(x): __xChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(y): __yChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(z): __zChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(yaw): __yawChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(hp): __hpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(maxHp): __maxHpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(dead): __deadChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(grounded): __groundedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(hurtSeq): __hurtSeqChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(attackSeq): __attackSeqChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(attackKind): __attackKindChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(hurtDx): __hurtDxChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(hurtDz): __hurtDzChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(scale): __scaleChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(model): __modelChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(mobName): __mobNameChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(info): __infoChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(mobLevel): __mobLevelChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(windup): __windupChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(slamSeq): __slamSeqChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(enraged): __enragedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(reflecting): __reflectingChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(charging): __chargingChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(stunned): __stunnedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(burning): __burningChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(bleeding): __bleedingChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(pinned): __pinnedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(marked): __markedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(under): __underChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(armor): __armorChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(resPhys): __resPhysChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(resRanged): __resRangedChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(resMagic): __resMagicChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(resDodge): __resDodgeChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(phase): __phaseChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
