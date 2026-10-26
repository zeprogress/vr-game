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
	public partial class DropState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public DropState() { }
		[Type(0, "string")]
		public string item = default(string);

		[Type(1, "uint16")]
		public ushort count = default(ushort);

		[Type(2, "float32")]
		public float x = default(float);

		[Type(3, "float32")]
		public float y = default(float);

		[Type(4, "float32")]
		public float z = default(float);

		[Type(5, "uint8")]
		public byte aegis = default(byte);

		/*
		 * Support for individual property change callbacks below...
		 */

		protected event PropertyChangeHandler<string> __itemChange;
		public Action OnItemChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.item));
			__itemChange += __handler;
			if (__immediate && this.item != default(string)) { __handler(this.item, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(item));
				__itemChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<ushort> __countChange;
		public Action OnCountChange(PropertyChangeHandler<ushort> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.count));
			__countChange += __handler;
			if (__immediate && this.count != default(ushort)) { __handler(this.count, default(ushort)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(count));
				__countChange -= __handler;
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

		protected event PropertyChangeHandler<byte> __aegisChange;
		public Action OnAegisChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.aegis));
			__aegisChange += __handler;
			if (__immediate && this.aegis != default(byte)) { __handler(this.aegis, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(aegis));
				__aegisChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(item): __itemChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(count): __countChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				case nameof(x): __xChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(y): __yChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(z): __zChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(aegis): __aegisChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
