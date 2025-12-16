
import { HandLandmark, DetectedHand } from "../types";

// MediaPipe Hands Landmark Indices
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;

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

export const analyzeHand = (landmarks: HandLandmark[], index: number, handednessLabel: 'Left' | 'Right', stableId: number = -1): DetectedHand => {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  // --- 1. Detect Facing (Palm vs Back) ---
  // Using Cross Product of vectors (Wrist->Index) x (Wrist->Pinky)
  // Z-coordinate check determines palm direction relative to camera
  const v1x = indexMcp.x - wrist.x;
  const v1y = indexMcp.y - wrist.y;
  const v2x = pinkyMcp.x - wrist.x;
  const v2y = pinkyMcp.y - wrist.y;
  const crossZ = v1x * v2y - v1y * v2x;

  const facing: 'Palm' | 'Back' = handednessLabel === 'Right' 
    ? (crossZ < 0 ? 'Palm' : 'Back') 
    : (crossZ > 0 ? 'Palm' : 'Back');

  // --- 2. Count Fingers (Index to Pinky) ---
  let fingersUp = 0;
  
  for (const [mcpIdx, pipIdx, _, tipIdx] of FINGERS_INDICES) {
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];
    const mcp = landmarks[mcpIdx];

    // Distance Squared comparisons
    const dTipWrist = distanceSq(tip, wrist);
    const dPipWrist = distanceSq(pip, wrist);
    const dMcpWrist = distanceSq(mcp, wrist);

    // Logic: A finger is "Extended" if Tip is further from wrist than PIP (by 10% margin) AND Tip is further than MCP.
    if (dTipWrist > dPipWrist * 1.1 && dTipWrist > dMcpWrist) {
      fingersUp++;
    }
  }

  // --- 3. Thumb Detection ---
  const thumbTip = landmarks[THUMB_TIP];
  const thumbIp = landmarks[THUMB_IP];
  
  // Thumb logic needs real distances ratio comparison, but we can do it with squares
  // 1.1 threshold squared is ~1.21
  const dThumbTipIndexMcp = distanceSq(thumbTip, indexMcp);
  const dThumbIpIndexMcp = distanceSq(thumbIp, indexMcp);
  const dThumbTipPinky = distanceSq(thumbTip, pinkyMcp);
  const dThumbIpPinky = distanceSq(thumbIp, pinkyMcp);

  // 1. Thumb is NOT tucked (Tip further from Pinky than IP)
  const isNotTucked = dThumbTipPinky > dThumbIpPinky;
  // 2. Thumb is extending OUT (Tip further from Index MCP than IP)
  const isExtendedOut = dThumbTipIndexMcp > dThumbIpIndexMcp * 1.2;

  if (isNotTucked && isExtendedOut) {
      fingersUp++;
  }

  // --- 4. Fist Detection (Refined) ---
  // Fist = 0 main fingers extended. (Strict).
  // We re-verify main fingers with a slightly more lenient threshold for "foldedness" check.
  let mainFingersExtended = 0;
  for (const [_, pipIdx, __, tipIdx] of FINGERS_INDICES) {
      const tip = landmarks[tipIdx];
      const pip = landmarks[pipIdx];
      
      // If Tip is further than PIP (even slightly), it's not fully folded
      if (distanceSq(tip, wrist) > distanceSq(pip, wrist)) {
          mainFingersExtended++;
      }
  }

  const isFist = mainFingersExtended === 0;

  // Centroid (approximate palm center)
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
    fingerCount: fingersUp,
    centroid
  };
};

export const getSortedHands = (hands: DetectedHand[]) => {
  return [...hands].sort((a, b) => a.centroid.x - b.centroid.x);
};
