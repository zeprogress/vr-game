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
	public partial class TreeBonusSync : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public TreeBonusSync() { }
		[Type(0, "float32")]
		public float dmg = default(float);

		[Type(1, "float32")]
		public float atk = default(float);

		[Type(2, "float32")]
		public float crit = default(float);

		[Type(3, "float32")]
		public float critDmg = default(float);

		[Type(4, "float32")]
		public float dodge = default(float);

		[Type(5, "float32")]
		public float move = default(float);

		[Type(6, "float32")]
		public float hp = default(float);

		[Type(7, "float32")]
		public float physDef = default(float);

		[Type(8, "float32")]
		public float magDef = default(float);

		[Type(9, "float32")]
		public float regen = default(float);

		[Type(10, "float32")]
		public float block = default(float);

		[Type(11, "float32")]
		public float vamp = default(float);

		[Type(12, "float32")]
		public float pierce = default(float);

		[Type(13, "float32")]
		public float cd = default(float);

		[Type(14, "float32")]
		public float skill = default(float);

		[Type(15, "float32")]
		public float magic = default(float);

		[Type(16, "float32")]
		public float heal = default(float);

		/*
		 * Support for individual property change callbacks below...
		 */

		protected event PropertyChangeHandler<float> __dmgChange;
		public Action OnDmgChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.dmg));
			__dmgChange += __handler;
			if (__immediate && this.dmg != default(float)) { __handler(this.dmg, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(dmg));
				__dmgChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __atkChange;
		public Action OnAtkChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.atk));
			__atkChange += __handler;
			if (__immediate && this.atk != default(float)) { __handler(this.atk, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(atk));
				__atkChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __critChange;
		public Action OnCritChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.crit));
			__critChange += __handler;
			if (__immediate && this.crit != default(float)) { __handler(this.crit, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(crit));
				__critChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __critDmgChange;
		public Action OnCritDmgChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.critDmg));
			__critDmgChange += __handler;
			if (__immediate && this.critDmg != default(float)) { __handler(this.critDmg, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(critDmg));
				__critDmgChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __dodgeChange;
		public Action OnDodgeChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.dodge));
			__dodgeChange += __handler;
			if (__immediate && this.dodge != default(float)) { __handler(this.dodge, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(dodge));
				__dodgeChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __moveChange;
		public Action OnMoveChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.move));
			__moveChange += __handler;
			if (__immediate && this.move != default(float)) { __handler(this.move, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(move));
				__moveChange -= __handler;
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

		protected event PropertyChangeHandler<float> __physDefChange;
		public Action OnPhysDefChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.physDef));
			__physDefChange += __handler;
			if (__immediate && this.physDef != default(float)) { __handler(this.physDef, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(physDef));
				__physDefChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __magDefChange;
		public Action OnMagDefChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.magDef));
			__magDefChange += __handler;
			if (__immediate && this.magDef != default(float)) { __handler(this.magDef, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(magDef));
				__magDefChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __regenChange;
		public Action OnRegenChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.regen));
			__regenChange += __handler;
			if (__immediate && this.regen != default(float)) { __handler(this.regen, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(regen));
				__regenChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __blockChange;
		public Action OnBlockChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.block));
			__blockChange += __handler;
			if (__immediate && this.block != default(float)) { __handler(this.block, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(block));
				__blockChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __vampChange;
		public Action OnVampChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.vamp));
			__vampChange += __handler;
			if (__immediate && this.vamp != default(float)) { __handler(this.vamp, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(vamp));
				__vampChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __pierceChange;
		public Action OnPierceChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.pierce));
			__pierceChange += __handler;
			if (__immediate && this.pierce != default(float)) { __handler(this.pierce, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(pierce));
				__pierceChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __cdChange;
		public Action OnCdChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cd));
			__cdChange += __handler;
			if (__immediate && this.cd != default(float)) { __handler(this.cd, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cd));
				__cdChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __skillChange;
		public Action OnSkillChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skill));
			__skillChange += __handler;
			if (__immediate && this.skill != default(float)) { __handler(this.skill, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skill));
				__skillChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __magicChange;
		public Action OnMagicChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.magic));
			__magicChange += __handler;
			if (__immediate && this.magic != default(float)) { __handler(this.magic, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(magic));
				__magicChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __healChange;
		public Action OnHealChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.heal));
			__healChange += __handler;
			if (__immediate && this.heal != default(float)) { __handler(this.heal, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(heal));
				__healChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(dmg): __dmgChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(atk): __atkChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(crit): __critChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(critDmg): __critDmgChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(dodge): __dodgeChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(move): __moveChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(hp): __hpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(physDef): __physDefChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(magDef): __magDefChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(regen): __regenChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(block): __blockChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(vamp): __vampChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(pierce): __pierceChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(cd): __cdChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(skill): __skillChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(magic): __magicChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(heal): __healChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
