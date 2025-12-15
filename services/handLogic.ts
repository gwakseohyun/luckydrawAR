
import { HandLandmark, DetectedHand } from "../types";

// MediaPipe Hands Landmark Indices
const WRIST = 0;
const THUMB_TIP = 4;
const THUMB_IP = 3;
const THUMB_MCP = 2;

// Finger Indices (MCP, PIP, DIP, TIP)
const FINGERS_INDICES = [
  [5, 6, 7, 8],   // Index
  [9, 10, 11, 12], // Middle
  [13, 14, 15, 16], // Ring
  [17, 18, 19, 20]  // Pinky
];

// Optimized squared distance calculation to avoid expensive Math.sqrt in hot loops
const distanceSq = (p1: HandLandmark, p2: HandLandmark): number => {
  return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
};

export const analyzeHand = (landmarks: HandLandmark[], index: number, handednessLabel: 'Left' | 'Right', stableId: number = -1): DetectedHand => {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  // --- 1. Detect Facing (Palm vs Back) ---
  // Using Cross Product of vectors (Wrist->Index) x (Wrist->Pinky)
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
  
  // Pre-calculate Wrist distance for reference
  // We use MCP as a stable anchor for length comparison
  
  for (const [mcpIdx, pipIdx, dipIdx, tipIdx] of FINGERS_INDICES) {
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];
    const mcp = landmarks[mcpIdx];

    // Distance Squared comparisons are faster
    const dTipWrist = distanceSq(tip, wrist);
    const dPipWrist = distanceSq(pip, wrist);
    const dMcpWrist = distanceSq(mcp, wrist);

    // Logic: A finger is "Extended" if the Tip is significantly further from the wrist than the PIP joint.
    // AND the Tip is further than the MCP joint.
    // 1.1 multiplier means Tip needs to be 10% further out than PIP (Standard extension)
    // Used 1.05 previously, but 1.1 is safer to avoid jitter on half-bent fingers.
    if (dTipWrist > dPipWrist * 1.1 && dTipWrist > dMcpWrist) {
      fingersUp++;
    }
  }

  // --- 3. Thumb Detection ---
  const thumbTip = landmarks[THUMB_TIP];
  const thumbIp = landmarks[THUMB_IP];
  const thumbMcp = landmarks[THUMB_MCP];

  // Thumb logic needs real distances for ratio comparison
  // Optimization: Only use sqrt here where necessary
  const dThumbTipIndexMcp = (thumbTip.x - indexMcp.x)**2 + (thumbTip.y - indexMcp.y)**2;
  const dThumbIpIndexMcp = (thumbIp.x - indexMcp.x)**2 + (thumbIp.y - indexMcp.y)**2;
  const dThumbTipPinky = (thumbTip.x - pinkyMcp.x)**2 + (thumbTip.y - pinkyMcp.y)**2;
  const dThumbIpPinky = (thumbIp.x - pinkyMcp.x)**2 + (thumbIp.y - pinkyMcp.y)**2;

  // 1. Thumb is NOT tucked (Tip further from Pinky than IP)
  const isNotTucked = dThumbTipPinky > dThumbIpPinky;
  // 2. Thumb is extending OUT (Tip further from Index MCP than IP)
  // Using squared comparison, so 1.1 threshold becomes 1.1^2 = 1.21
  const isExtendedOut = dThumbTipIndexMcp > dThumbIpIndexMcp * 1.2;

  if (isNotTucked && isExtendedOut) {
      fingersUp++;
  }

  // --- 4. Fist Detection (Refined) ---
  // A "Fist" strictly means the 4 main fingers are folded. 
  // We ignore the thumb for the 'isFist' state to prevent errors where
  // users tuck their thumb in or leave it out while making a fist.
  // So: If Index, Middle, Ring, Pinky are ALL folded (count contribution was 0), it's a fist.
  
  // However, we already counted 'fingersUp' including thumb.
  // Let's re-verify just the 4 fingers for the "Fist" flag.
  let mainFingersExtended = 0;
  for (const [mcpIdx, pipIdx, dipIdx, tipIdx] of FINGERS_INDICES) {
      const tip = landmarks[tipIdx];
      const pip = landmarks[pipIdx];
      const dTipWrist = distanceSq(tip, wrist);
      const dPipWrist = distanceSq(pip, wrist);
      
      // Use a slightly more lenient threshold for "is this finger definitely NOT folded?"
      // If Tip is further than PIP * 1.0 (just barely extended), we count it.
      if (dTipWrist > dPipWrist) {
          mainFingersExtended++;
      }
  }

  // Final Verdict:
  // Fist = 0 main fingers extended. (Strict).
  // This solves "1 finger point = Fist" bug. Pointing will have mainFingersExtended >= 1.
  const isFist = mainFingersExtended === 0;

  // Centroid
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

