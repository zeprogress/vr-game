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
	public partial class SlotState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public SlotState() { }
		[Type(0, "string")]
		public string item = default(string);

		[Type(1, "uint16")]
		public ushort count = default(ushort);

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

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(item): __itemChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(count): __countChange?.Invoke((ushort) change.Value, (ushort) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
