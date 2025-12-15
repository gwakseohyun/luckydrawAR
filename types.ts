
export enum GameState {
  IDLE = 'IDLE', // Waiting for camera permission
  SETUP = 'SETUP', // Set winner count manually with blurred background
  DETECT_PARTICIPANTS = 'DETECT_PARTICIPANTS', // Step 1: Count hands
  WAIT_FOR_FISTS_READY = 'WAIT_FOR_FISTS_READY', // Step 2: Everyone make a fist (Ready to Draw)
  DRAWING = 'DRAWING', // Step 3: Randomizing
  SHOW_WINNER = 'SHOW_WINNER', // Step 4: Reveal winner
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface DetectedHand {
  id: number; // Index in the raw results array (volatile)
  stableId: number; // Persistent ID tracked over time
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

export interface CameraLayerHandle {
  toggleCamera: () => void;
  setZoom: (zoom: number) => void;
}

