export enum GameState {
  IDLE = 'IDLE', // Waiting for camera
  DETECT_PARTICIPANTS = 'DETECT_PARTICIPANTS', // Step 1: Count hands
  WAIT_FOR_FISTS_READY = 'WAIT_FOR_FISTS_READY', // Step 2: Everyone make a fist
  SET_WINNER_COUNT = 'SET_WINNER_COUNT', // Step 3: Show fingers to set winner count
  WAIT_FOR_FISTS_PRE_DRAW = 'WAIT_FOR_FISTS_PRE_DRAW', // Step 4: Ready for draw
  DRAWING = 'DRAWING', // Step 5: Randomizing
  SHOW_WINNER = 'SHOW_WINNER', // Step 6: Reveal winner
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface DetectedHand {
  id: number; // Index in the results array
  landmarks: HandLandmark[];
  handedness: 'Left' | 'Right';
  facing: 'Palm' | 'Back';
  isFist: boolean;
  fingerCount: number;
  centroid: { x: number; y: number };
}

export interface GameContextType {
  gameState: GameState;
  participantCount: number;
  winnerCount: number;
  winners: number[]; // Indices of winning hands
  timer: number;
  maxTimer: number;
}