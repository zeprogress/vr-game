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
	public partial class DummyState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public DummyState() { }
		[Type(0, "float32")]
		public float x = default(float);

		[Type(1, "float32")]
		public float y = default(float);

		[Type(2, "float32")]
		public float z = default(float);

		[Type(3, "float32")]
		public float hp = default(float);

		[Type(4, "uint8")]
		public byte dead = default(byte);

		[Type(5, "uint16")]
		public ushort hurtSeq = default(ushort);

		/*
		 * Support for individual property change callbacks below...
		 */

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

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(x): __xChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(y): __yChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(z): __zChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(hp): __hpChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(dead): __deadChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(hurtSeq): __hurtSeqChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
