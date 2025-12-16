import { HandLandmark, DetectedHand } from "../types";

// MediaPipe Hands Landmark Indices
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;

const INDEX_MCP = 5;
const INDEX_TIP = 8;

// Finger Indices (MCP, PIP, DIP, TIP)
const FINGERS_INDICES = [
  [5, 6, 7, 8],   // Index
  [9, 10, 11, 12], // Middle
  [13, 14, 15, 16], // Ring
  [17, 18, 19, 20]  // Pinky
];

// Optimized squared distance calculation
const distanceSq = (p1: HandLandmark, p2: HandLandmark): number => {
  return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
};

// Euclidean distance
const distance = (p1: HandLandmark, p2: HandLandmark): number => {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
};

export const analyzeHand = (landmarks: HandLandmark[], index: number, handednessLabel: 'Left' | 'Right', stableId: number = -1): DetectedHand => {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[INDEX_MCP];
  const pinkyMcp = landmarks[17];

  // --- 1. Detect Facing (Palm vs Back) ---
  const v1x = indexMcp.x - wrist.x;
  const v1y = indexMcp.y - wrist.y;
  const v2x = pinkyMcp.x - wrist.x;
  const v2y = pinkyMcp.y - wrist.y;
  const crossZ = v1x * v2y - v1y * v2x;

  const facing: 'Palm' | 'Back' = handednessLabel === 'Right' 
    ? (crossZ < -0.0001 ? 'Palm' : 'Back') 
    : (crossZ > 0.0001 ? 'Palm' : 'Back');

  // --- 2. Count Fingers (Extension Logic) ---
  let fingersUp = 0;
  
  // Thumb (Special Case)
  const thumbTip = landmarks[THUMB_TIP];
  const thumbMcp = landmarks[THUMB_MCP];
  const dThumbTipWrist = distanceSq(thumbTip, wrist);
  const dThumbMcpWrist = distanceSq(thumbMcp, wrist);
  
  if (dThumbTipWrist > dThumbMcpWrist * 1.1) {
     fingersUp++;
  }

  // Other 4 fingers
  for (const [mcpIdx, pipIdx, _, tipIdx] of FINGERS_INDICES) {
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];

    const dTipWrist = distanceSq(tip, wrist);
    const dPipWrist = distanceSq(pip, wrist);

    // Extension Check
    if (dTipWrist > dPipWrist * 1.1) {
      fingersUp++;
    }
  }

  // --- 3. Fist Detection (Strict Fold Check) ---
  let foldedFingersCount = 0;
  for (const [mcpIdx, pipIdx, _, tipIdx] of FINGERS_INDICES) {
      const tip = landmarks[tipIdx];
      const pip = landmarks[pipIdx];
      
      const dTipWrist = distanceSq(tip, wrist);
      const dPipWrist = distanceSq(pip, wrist);

      if (dTipWrist < dPipWrist * 1.3) {
          foldedFingersCount++;
      }
  }
  const isFist = foldedFingersCount >= 3;

  // --- 4. OK Sign Detection (Pinch) ---
  // Distance between Thumb Tip (4) and Index Tip (8)
  const indexTip = landmarks[INDEX_TIP];
  const pinchDistSq = distanceSq(thumbTip, indexTip);
  
  // Reference Scale: Wrist to Index MCP squared
  // This normalizes for distance from camera
  const refScaleSq = distanceSq(wrist, indexMcp);

  // Threshold: If pinch distance is very small relative to hand size
  // 0.08 is an empirical threshold for squared distance ratio (approx 0.28 linear)
  const isOk = pinchDistSq < (refScaleSq * 0.08);

  const centroid = {
    x: landmarks[9].x, 
    y: landmarks[9].y
  };

  return {
    id: index,
    stableId: stableId !== -1 ? stableId : index,
    landmarks,
    handedness: handednessLabel,
    facing,
    isFist,
    isOk,
    fingerCount: fingersUp,
    centroid
  };
};

export const getSortedHands = (hands: DetectedHand[]) => {
  return [...hands].sort((a, b) => a.centroid.x - b.centroid.x);
};
