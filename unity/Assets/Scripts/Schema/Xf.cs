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
	public partial class Xf : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public Xf() { }
		[Type(0, "float32")]
		public float x = default(float);

		[Type(1, "float32")]
		public float y = default(float);

		[Type(2, "float32")]
		public float z = default(float);

		[Type(3, "float32")]
		public float qx = default(float);

		[Type(4, "float32")]
		public float qy = default(float);

		[Type(5, "float32")]
		public float qz = default(float);

		[Type(6, "float32")]
		public float qw = default(float);

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

		protected event PropertyChangeHandler<float> __qxChange;
		public Action OnQxChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.qx));
			__qxChange += __handler;
			if (__immediate && this.qx != default(float)) { __handler(this.qx, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(qx));
				__qxChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __qyChange;
		public Action OnQyChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.qy));
			__qyChange += __handler;
			if (__immediate && this.qy != default(float)) { __handler(this.qy, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(qy));
				__qyChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __qzChange;
		public Action OnQzChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.qz));
			__qzChange += __handler;
			if (__immediate && this.qz != default(float)) { __handler(this.qz, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(qz));
				__qzChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __qwChange;
		public Action OnQwChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.qw));
			__qwChange += __handler;
			if (__immediate && this.qw != default(float)) { __handler(this.qw, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(qw));
				__qwChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(x): __xChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(y): __yChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(z): __zChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(qx): __qxChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(qy): __qyChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(qz): __qzChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(qw): __qwChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
