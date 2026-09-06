/**
 * Голоса Fish Audio для озвучки чата на стриме. reference_id — id голосовой
 * модели на fish.audio. Набор проверен (звучат по-русски прилично).
 *
 * На будущее: зритель в чате сможет выбрать себе голос сам — тогда сервер
 * будет держать карту ник → ref, а этот список станет меню выбора.
 */
export interface TtsVoice {
  ref: string;
  name: string;
}

export const TTS_VOICES: readonly TtsVoice[] = [
  { ref: "c4ec5839e2044150aad40ac193a602f1", name: "Володарский" },
  { ref: "567d30e800cc4dd6a331411c7f970a47", name: "Паша Техник" },
  { ref: "4d72cce58e0b479e8aa135d8c1829edd", name: "Патрик Стар" },
  { ref: "5b99cb3218ee4f1a8090fbbca8c95241", name: "Морти" },
  { ref: "bc8eb8dcdc184763b0a769ee03275724", name: "Жириновский" },
  { ref: "205c5c4aadde43d2809636ad19773e6c", name: "Стэтхэм" },
  { ref: "493790cdb9c841f299e883478fb1b6a5", name: "СССР" },
  { ref: "e43f5f43e2df470a855dad3e0f2f369b", name: "Морфеус" },
  { ref: "558fa6f5859d4c55adbc830c076ba445", name: "Тянка" },
  { ref: "54076f8bfbc54979ad33764278e5e635", name: "Микки Маус" },
];

export const TTS_DEFAULT_VOICE = TTS_VOICES[0].ref;

export function isTtsVoice(ref: string): boolean {
  return TTS_VOICES.some((v) => v.ref === ref);
}
