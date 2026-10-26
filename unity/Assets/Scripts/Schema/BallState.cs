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
	public partial class BallState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public BallState() { }
		[Type(0, "float32")]
		public float x = default(float);

		[Type(1, "float32")]
		public float y = default(float);

		[Type(2, "float32")]
		public float z = default(float);

		[Type(3, "float32")]
		public float vx = default(float);

		[Type(4, "float32")]
		public float vy = default(float);

		[Type(5, "float32")]
		public float vz = default(float);

		[Type(6, "uint8")]
		public byte boss = default(byte);

		[Type(7, "uint8")]
		public byte k = default(byte);

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

		protected event PropertyChangeHandler<float> __vxChange;
		public Action OnVxChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.vx));
			__vxChange += __handler;
			if (__immediate && this.vx != default(float)) { __handler(this.vx, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(vx));
				__vxChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __vyChange;
		public Action OnVyChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.vy));
			__vyChange += __handler;
			if (__immediate && this.vy != default(float)) { __handler(this.vy, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(vy));
				__vyChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __vzChange;
		public Action OnVzChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.vz));
			__vzChange += __handler;
			if (__immediate && this.vz != default(float)) { __handler(this.vz, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(vz));
				__vzChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __bossChange;
		public Action OnBossChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.boss));
			__bossChange += __handler;
			if (__immediate && this.boss != default(byte)) { __handler(this.boss, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(boss));
				__bossChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __kChange;
		public Action OnKChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.k));
			__kChange += __handler;
			if (__immediate && this.k != default(byte)) { __handler(this.k, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(k));
				__kChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(x): __xChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(y): __yChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(z): __zChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(vx): __vxChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(vy): __vyChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(vz): __vzChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(boss): __bossChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(k): __kChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
