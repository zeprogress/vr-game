/** Плавность камеры стрима (пульт «Камера: плавность»): ключи ставок в 1/с, общие для пульта, спектатора и сервера. */
export const CAM_TUNE_KEYS = ["eyeSmooth", "botCamPosSmooth", "botCamFwdSmooth"] as const;
export type CamTuneKey = (typeof CAM_TUNE_KEYS)[number];

export function isCamTuneKey(k: unknown): k is CamTuneKey {
  return typeof k === "string" && (CAM_TUNE_KEYS as readonly string[]).includes(k);
}
