import { SPECTATE } from "#shared/constants";
export { CAM_TUNE_KEYS, isCamTuneKey, type CamTuneKey } from "#shared/camTune";

/**
 * Плавность камеры рендерящего спектатора — живая подгонка с пульта («Камера: плавность»).
 * Ставки в 1/с (как SPECTATE): чем больше, тем камера резче следует за героем. Читается каждый кадр.
 */
export const CAM_TUNE: { eyeSmooth: number; botCamPosSmooth: number; botCamFwdSmooth: number } = {
  eyeSmooth: SPECTATE.eyeSmooth,
  botCamPosSmooth: SPECTATE.botCamPosSmooth,
  botCamFwdSmooth: SPECTATE.botCamFwdSmooth,
};
export const CAM_TUNE_DEFAULT: Readonly<typeof CAM_TUNE> = { ...CAM_TUNE };
