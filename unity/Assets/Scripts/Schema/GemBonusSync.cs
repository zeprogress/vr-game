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
	public partial class GemBonusSync : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public GemBonusSync() { }
		[Type(0, "uint16")]
		public ushort str = default(ushort);

		[Type(1, "uint16")]
		public ushort agi = default(ushort);

		[Type(2, "uint16")]
		public ushort @int = default(ushort);

		[Type(3, "uint16")]
		public ushort con = default(ushort);

		[Type(4, "uint16")]
		public ushort luc = default(ushort);

		[Type(5, "uint16")]
		public ushort wis = default(ushort);

		[Type(6, "float32")]
		public float skRad = default(float);

		[Type(7, "float32")]
		public float skDur = default(float);

		[Type(8, "float32")]
		public float skCd = default(float);

		/*
		 * Support for individual property change callbacks below...
		 */

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

		protected event PropertyChangeHandler<float> __skRadChange;
		public Action OnSkRadChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skRad));
			__skRadChange += __handler;
			if (__immediate && this.skRad != default(float)) { __handler(this.skRad, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skRad));
				__skRadChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __skDurChange;
		public Action OnSkDurChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skDur));
			__skDurChange += __handler;
			if (__immediate && this.skDur != default(float)) { __handler(this.skDur, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skDur));
				__skDurChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __skCdChange;
		public Action OnSkCdChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.skCd));
			__skCdChange += __handler;
			if (__immediate && this.skCd != default(float)) { __handler(this.skCd, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(skCd));
				__skCdChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(str): __strChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(agi): __agiChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(@int): __intChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(con): __conChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(luc): __lucChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(wis): __wisChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(skRad): __skRadChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(skDur): __skDurChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(skCd): __skCdChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
