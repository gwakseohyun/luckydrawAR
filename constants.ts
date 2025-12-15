import { GameState } from "./types";

export const COLORS = {
  primary: '#FFEA00', // Bright Yellow
  secondary: '#111111', // Dark Black
  accent: '#FF4D4D', // Red for errors/recording
  success: '#00E676', // Green
  text: '#FFFFFF',
  textDark: '#1F2937',
};

export const INSTRUCTIONS: Record<GameState, string> = {
  [GameState.IDLE]: "카메라 권한을 허용하고 시작해주세요.",
  [GameState.DETECT_PARTICIPANTS]: "참가자들은 손바닥을 펼쳐 화면에 보여주세요.",
  [GameState.WAIT_FOR_FISTS_READY]: "준비되었다면 모두 주먹을 쥐어주세요.",
  [GameState.SET_WINNER_COUNT]: "총 추첨할 인원 수만큼 손가락을 펴고 3초간 유지하세요.",
  [GameState.WAIT_FOR_FISTS_PRE_DRAW]: "추첨을 시작합니다. 다시 주먹을 쥐어주세요.",
  [GameState.DRAWING]: "추첨 중...",
  [GameState.SHOW_WINNER]: "손을 활짝 펼쳐 당첨 여부를 확인하세요!",
};

export const HOLD_DURATION_MS = 3000;
export const ANIMATION_DELAY_MS = 2000;
