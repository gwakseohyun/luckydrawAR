
import { HandLandmark, DetectedHand } from "../types";

// MediaPipe Hands Landmark Indices
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_FINGER_MCP = 5;
const INDEX_FINGER_PIP = 6;
const INDEX_FINGER_DIP = 7;
const INDEX_FINGER_TIP = 8;
const MIDDLE_FINGER_MCP = 9;
const MIDDLE_FINGER_PIP = 10;
const MIDDLE_FINGER_DIP = 11;
const MIDDLE_FINGER_TIP = 12;
const RING_FINGER_MCP = 13;
const RING_FINGER_PIP = 14;
const RING_FINGER_DIP = 15;
const RING_FINGER_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_DIP = 19;
const PINKY_TIP = 20;

const FINGERS = [
  [INDEX_FINGER_MCP, INDEX_FINGER_PIP, INDEX_FINGER_DIP, INDEX_FINGER_TIP],
  [MIDDLE_FINGER_MCP, MIDDLE_FINGER_PIP, MIDDLE_FINGER_DIP, MIDDLE_FINGER_TIP],
  [RING_FINGER_MCP, RING_FINGER_PIP, RING_FINGER_DIP, RING_FINGER_TIP],
  [PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP],
];

// Calculate distance between two landmarks
const distance = (p1: HandLandmark, p2: HandLandmark): number => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

export const analyzeHand = (landmarks: HandLandmark[], index: number, handednessLabel: 'Left' | 'Right', stableId: number = -1): DetectedHand => {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[INDEX_FINGER_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];

  // --- 1. Detect Facing (Palm vs Back) ---
  const v1 = { x: indexMcp.x - wrist.x, y: indexMcp.y - wrist.y };
  const v2 = { x: pinkyMcp.x - wrist.x, y: pinkyMcp.y - wrist.y };
  const crossZ = v1.x * v2.y - v1.y * v2.x;

  let facing: 'Palm' | 'Back' = 'Palm';
  if (handednessLabel === 'Right') {
    facing = crossZ < 0 ? 'Palm' : 'Back';
  } else {
    facing = crossZ > 0 ? 'Palm' : 'Back';
  }

  // --- 2. Count Fingers (Index to Pinky) ---
  let fingersUp = 0;
  let foldedFingersCount = 0;

  for (const [mcp, pip, dip, tip] of FINGERS) {
    const distTipWrist = distance(landmarks[tip], wrist);
    const distPipWrist = distance(landmarks[pip], wrist);
    const distMcpWrist = distance(landmarks[mcp], wrist);
    
    // Geometric check: Extended if Tip is significantly further than PIP from Wrist
    // And Tip is further than MCP. 
    // Relaxed multiplier slightly to 1.05 to be more responsive
    if (distTipWrist > distPipWrist * 1.05 && distTipWrist > distMcpWrist) {
      fingersUp++;
    } else {
      foldedFingersCount++;
    }
  }

  // --- 3. Thumb Detection (Refined) ---
  const thumbTip = landmarks[THUMB_TIP];
  const thumbIp = landmarks[THUMB_IP];
  const thumbMcp = landmarks[THUMB_MCP];
  
  // Logic: Is the thumb extending OUT away from the hand?
  // We compare the Tip distance to Index MCP vs IP distance to Index MCP.
  const distThumbTipIndexMcp = distance(thumbTip, indexMcp);
  const distThumbIpIndexMcp = distance(thumbIp, indexMcp);
  
  // Also check if it's tucked towards Pinky
  const distThumbTipPinky = distance(thumbTip, pinkyMcp);
  const distThumbIpPinky = distance(thumbIp, pinkyMcp);
  
  // Condition A: Thumb is NOT tucked (Tip is further from Pinky than IP is)
  const isNotTucked = distThumbTipPinky > distThumbIpPinky;

  // Condition B: Thumb is extending AWAY from Index (Tip is further from Index base than IP is)
  const isExtendedOut = distThumbTipIndexMcp > distThumbIpIndexMcp * 1.1;

  // Final Thumb Up Check
  const isThumbUp = isNotTucked && isExtendedOut;

  if (isThumbUp) {
      fingersUp++;
  }

  // --- 4. Fist Detection Strategy (Improved) ---
  // Previous strict logic: const isFist = foldedFingersCount === 4;
  
  // NEW RELAXED LOGIC:
  // If fewer than 2 fingers are up, we consider it a Fist (Rock).
  // This handles cases where the user thinks they are making a fist but the thumb is sticking out.
  // Conversely, if 2 or more fingers are up, it is definitely NOT a fist (it's Open/Scissors).
  // This fixes the "Winner Ball Not Showing" bug when hand is opened.
  const isFist = fingersUp < 2;

  // Centroid (approximate palm center)
  const centroid = {
    x: landmarks[9].x, 
    y: landmarks[9].y
  };

  return {
    id: index,
    stableId: stableId !== -1 ? stableId : index, // Fallback to index if no ID provided
    landmarks,
    handedness: handednessLabel,
    facing,
    isFist,
    fingerCount: fingersUp,
    centroid
  };
};

export const getSortedHands = (hands: DetectedHand[]) => {
  // Sort hands by X coordinate (Left to Right on screen)
  return [...hands].sort((a, b) => a.centroid.x - b.centroid.x);
};

