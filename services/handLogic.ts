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

// Euclidean distance
const distance = (p1: HandLandmark, p2: HandLandmark): number => {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
};

export const analyzeHand = (landmarks: HandLandmark[], index: number, handednessLabel: 'Left' | 'Right', stableId: number = -1): DetectedHand => {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[5];
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
  // A finger is "Extended" if Tip is significantly further from Wrist than PIP.
  // Using 1.1 multiplier for robustness (Tip must be > 110% of PIP distance).
  
  let fingersUp = 0;
  
  // Thumb (Special Case)
  const thumbTip = landmarks[THUMB_TIP];
  const thumbMcp = landmarks[THUMB_MCP];
  const dThumbTipWrist = distanceSq(thumbTip, wrist);
  const dThumbMcpWrist = distanceSq(thumbMcp, wrist);
  
  // Thumb extended check
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
  // We ignore the thumb for Fist detection because thumb position varies (tucked/side/up).
  // We strictly check the other 4 fingers (Index, Middle, Ring, Pinky).
  // A finger is "Folded" if it is NOT extended.
  // Ideally, for a fist, the Tip should be close to the palm, so Tip-Wrist < PIP-Wrist usually.
  // But strictly, if it's just "not extended" (dTipWrist <= dPipWrist * 1.2), we count it as potentially folded.
  
  let foldedFingersCount = 0;
  for (const [mcpIdx, pipIdx, _, tipIdx] of FINGERS_INDICES) {
      const tip = landmarks[tipIdx];
      const pip = landmarks[pipIdx];
      
      const dTipWrist = distanceSq(tip, wrist);
      const dPipWrist = distanceSq(pip, wrist);

      // We use a slightly generous threshold for "Folded". 
      // If the tip is NOT significantly extended (less than 1.3x PIP dist), we treat it as folded/curled.
      if (dTipWrist < dPipWrist * 1.3) {
          foldedFingersCount++;
      }
  }

  // Definition of Fist:
  // At least 3 out of the 4 main fingers must be folded.
  // This allows for "Pointing" (1 finger up) to be NOT a fist, 
  // but "Loose Fist" (fingers curled but not tight) to BE a fist.
  const isFist = foldedFingersCount >= 3;

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
