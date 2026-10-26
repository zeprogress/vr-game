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
	public partial class RaidSync : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve] 
#endif
public RaidSync() { }
		[Type(0, "uint8")]
		public byte ph = default(byte);

		[Type(1, "float32")]
		public float ang = default(float);

		[Type(2, "float32")]
		public float w = default(float);

		[Type(3, "float32")]
		public float drift = default(float);

		[Type(4, "float32")]
		public float edge = default(float);

		[Type(5, "float32")]
		public float gap = default(float);

		[Type(6, "uint8")]
		public byte on = default(byte);

		[Type(7, "float32")]
		public float o0 = default(float);

		[Type(8, "float32")]
		public float o1 = default(float);

		[Type(9, "float32")]
		public float o2 = default(float);

		[Type(10, "int8")]
		public sbyte vert = default(sbyte);

		[Type(11, "uint8")]
		public byte tide = default(byte);

		[Type(12, "uint8")]
		public byte tear = default(byte);

		[Type(13, "uint8")]
		public byte pull = default(byte);

		[Type(14, "uint8")]
		public byte breath = default(byte);

		[Type(15, "string")]
		public string cracks = default(string);

		[Type(16, "uint8")]
		public byte crackOn = default(byte);

		/*
		 * Support for individual property change callbacks below...
		 */

		protected event PropertyChangeHandler<byte> __phChange;
		public Action OnPhChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ph));
			__phChange += __handler;
			if (__immediate && this.ph != default(byte)) { __handler(this.ph, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ph));
				__phChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __angChange;
		public Action OnAngChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.ang));
			__angChange += __handler;
			if (__immediate && this.ang != default(float)) { __handler(this.ang, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(ang));
				__angChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __wChange;
		public Action OnWChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.w));
			__wChange += __handler;
			if (__immediate && this.w != default(float)) { __handler(this.w, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(w));
				__wChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __driftChange;
		public Action OnDriftChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.drift));
			__driftChange += __handler;
			if (__immediate && this.drift != default(float)) { __handler(this.drift, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(drift));
				__driftChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __edgeChange;
		public Action OnEdgeChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.edge));
			__edgeChange += __handler;
			if (__immediate && this.edge != default(float)) { __handler(this.edge, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(edge));
				__edgeChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __gapChange;
		public Action OnGapChange(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.gap));
			__gapChange += __handler;
			if (__immediate && this.gap != default(float)) { __handler(this.gap, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(gap));
				__gapChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __onChange;
		public Action OnOnChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.on));
			__onChange += __handler;
			if (__immediate && this.on != default(byte)) { __handler(this.on, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(on));
				__onChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __o0Change;
		public Action OnO0Change(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.o0));
			__o0Change += __handler;
			if (__immediate && this.o0 != default(float)) { __handler(this.o0, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(o0));
				__o0Change -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __o1Change;
		public Action OnO1Change(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.o1));
			__o1Change += __handler;
			if (__immediate && this.o1 != default(float)) { __handler(this.o1, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(o1));
				__o1Change -= __handler;
			};
		}

		protected event PropertyChangeHandler<float> __o2Change;
		public Action OnO2Change(PropertyChangeHandler<float> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.o2));
			__o2Change += __handler;
			if (__immediate && this.o2 != default(float)) { __handler(this.o2, default(float)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(o2));
				__o2Change -= __handler;
			};
		}

		protected event PropertyChangeHandler<sbyte> __vertChange;
		public Action OnVertChange(PropertyChangeHandler<sbyte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.vert));
			__vertChange += __handler;
			if (__immediate && this.vert != default(sbyte)) { __handler(this.vert, default(sbyte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(vert));
				__vertChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __tideChange;
		public Action OnTideChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.tide));
			__tideChange += __handler;
			if (__immediate && this.tide != default(byte)) { __handler(this.tide, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(tide));
				__tideChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __tearChange;
		public Action OnTearChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.tear));
			__tearChange += __handler;
			if (__immediate && this.tear != default(byte)) { __handler(this.tear, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(tear));
				__tearChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __pullChange;
		public Action OnPullChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.pull));
			__pullChange += __handler;
			if (__immediate && this.pull != default(byte)) { __handler(this.pull, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(pull));
				__pullChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __breathChange;
		public Action OnBreathChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.breath));
			__breathChange += __handler;
			if (__immediate && this.breath != default(byte)) { __handler(this.breath, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(breath));
				__breathChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<string> __cracksChange;
		public Action OnCracksChange(PropertyChangeHandler<string> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.cracks));
			__cracksChange += __handler;
			if (__immediate && this.cracks != default(string)) { __handler(this.cracks, default(string)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(cracks));
				__cracksChange -= __handler;
			};
		}

		protected event PropertyChangeHandler<byte> __crackOnChange;
		public Action OnCrackOnChange(PropertyChangeHandler<byte> __handler, bool __immediate = true) {
			if (__callbacks == null) { __callbacks = new SchemaCallbacks(); }
			__callbacks.AddPropertyCallback(nameof(this.crackOn));
			__crackOnChange += __handler;
			if (__immediate && this.crackOn != default(byte)) { __handler(this.crackOn, default(byte)); }
			return () => {
				__callbacks.RemovePropertyCallback(nameof(crackOn));
				__crackOnChange -= __handler;
			};
		}

		protected override void TriggerFieldChange(DataChange change) {
			switch (change.Field) {
				case nameof(ph): __phChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(ang): __angChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(w): __wChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(drift): __driftChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(edge): __edgeChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(gap): __gapChange?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(on): __onChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(o0): __o0Change?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(o1): __o1Change?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(o2): __o2Change?.Invoke((float) change.Value, (float) change.PreviousValue); break;
				case nameof(vert): __vertChange?.Invoke((sbyte) change.Value, (sbyte) change.PreviousValue); break;
				case nameof(tide): __tideChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(tear): __tearChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(pull): __pullChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(breath): __breathChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				case nameof(cracks): __cracksChange?.Invoke((string) change.Value, (string) change.PreviousValue); break;
				case nameof(crackOn): __crackOnChange?.Invoke((byte) change.Value, (byte) change.PreviousValue); break;
				default: break;
			}
		}
	}
}
