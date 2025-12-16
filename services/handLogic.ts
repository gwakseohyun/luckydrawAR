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
  let fingersUp = 0;
  
  // Thumb logic (Same as before)
  const thumbTip = landmarks[THUMB_TIP];
  const thumbIp = landmarks[THUMB_IP];
  const thumbMcp = landmarks[THUMB_MCP];
  
  const dThumbTipPinky = distanceSq(thumbTip, pinkyMcp);
  const dThumbIpPinky = distanceSq(thumbIp, pinkyMcp);
  
  // Thumb is extended if tip is far from pinky base AND angle suggests extension
  // Simplified: Check if tip is further from wrist than MCP
  const dThumbTipWrist = distanceSq(thumbTip, wrist);
  const dThumbMcpWrist = distanceSq(thumbMcp, wrist);
  
  // If thumb tip is significantly further from wrist than MCP, it's out.
  if (dThumbTipWrist > dThumbMcpWrist * 1.1) {
     fingersUp++;
  }

  // Other 4 fingers
  for (const [mcpIdx, pipIdx, _, tipIdx] of FINGERS_INDICES) {
    const tip = landmarks[tipIdx];
    const mcp = landmarks[mcpIdx];

    const dTipWrist = distanceSq(tip, wrist);
    const dMcpWrist = distanceSq(mcp, wrist);

    // If tip is further from wrist than MCP * ratio, it's open.
    if (dTipWrist > dMcpWrist * 1.3) {
      fingersUp++;
    }
  }

  // --- 3. Fist Detection (Ratio Based) ---
  // A fist is defined by the 4 main fingers being curled in.
  // We check the ratio of (Wrist->Tip) / (Wrist->MCP).
  // If Ratio is close to 1.0 (or less), it's folded.
  // If Ratio is significantly > 1.0, it's extended.
  
  let foldedFingersCount = 0;
  for (const [mcpIdx, _, __, tipIdx] of FINGERS_INDICES) {
      const tip = landmarks[tipIdx];
      const mcp = landmarks[mcpIdx];
      
      const distTipWrist = distance(tip, wrist);
      const distMcpWrist = distance(mcp, wrist);

      // Threshold:
      // If Tip is not significantly further than MCP (e.g., less than 1.4x distance),
      // we consider it folded or at least "not extended".
      // A full extension is usually > 1.8x. A loose fist is ~1.2x.
      if (distTipWrist < distMcpWrist * 1.4) {
          foldedFingersCount++;
      }
  }

  // Robust Fist Condition:
  // If at least 3 of the 4 main fingers are folded, it is a fist.
  // We ignore the thumb because thumb placement in a fist varies wildly (tucked in, wrapped around, sticking up).
  // We also ignore the "facing" check for fist, as a fist looks like a fist from both sides.
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
