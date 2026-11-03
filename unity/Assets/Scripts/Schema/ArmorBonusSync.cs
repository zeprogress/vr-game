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
	public partial class ArmorBonusSync : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public ArmorBonusSync() { }
		[Type(0, "float32")]
		public float hp = default(float);

		[Type(1, "float32")]
		public float physDef = default(float);

		[Type(2, "float32")]
		public float magDef = default(float);

		[Type(3, "float32")]
		public float regen = default(float);

		[Type(4, "float32")]
		public float dodge = default(float);

		[Type(5, "float32")]
		public float move = default(float);

		[Type(6, "float32")]
		public float atk = default(float);

		[Type(7, "float32")]
		public float ht = default(float);

		[Type(8, "float32")]
		public float hr = default(float);

		[Type(9, "float32")]
		public float hm = default(float);

		/*
		 * Support for individual property change callbacks below...
		 */

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

		protected event PropertyChangeHandler<float> __htChange;
		public Action OnHtChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ht));
			__htChange += __handler;
			if (__immediate && this.ht != default(float)) { __handler(this.ht, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ht));
				__htChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __hrChange;
		public Action OnHrChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hr));
			__hrChange += __handler;
			if (__immediate && this.hr != default(float)) { __handler(this.hr, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hr));
				__hrChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __hmChange;
		public Action OnHmChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.hm));
			__hmChange += __handler;
			if (__immediate && this.hm != default(float)) { __handler(this.hm, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(hm));
				__hmChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(hp): __hpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(physDef): __physDefChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(magDef): __magDefChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(regen): __regenChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(dodge): __dodgeChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(move): __moveChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(atk): __atkChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(ht): __htChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(hr): __hrChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(hm): __hmChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
