import React, { useEffect, useRef } from 'react';
import { analyzeHand, getSortedHands } from '../services/handLogic';
import { DetectedHand, GameState, HandLandmark } from '../types';
import { COLORS } from '../constants';

interface Results {
  image: CanvasImageSource;
  multiHandLandmarks: HandLandmark[][];
  multiHandedness: Array<{ label: 'Left' | 'Right', score: number }>;
}

interface CameraLayerProps {
  gameState: GameState;
  onHandsUpdate: (hands: DetectedHand[]) => void;
  winningHandIndices: number[];
  triggerCapture: boolean;
  onCaptureComplete: (images: string[]) => void;
}

declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

const lerp = (start: number, end: number, t: number) => {
  return start * (1 - t) + end * t;
};

const CameraLayer: React.FC<CameraLayerProps> = ({ 
  gameState, 
  onHandsUpdate, 
  winningHandIndices,
  triggerCapture,
  onCaptureComplete
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const gameStateRef = useRef(gameState);
  const winningIndicesRef = useRef(winningHandIndices);
  const triggerCaptureRef = useRef(triggerCapture);

  // Keep track of sorted hands for capturing logic
  const currentHandsRef = useRef<DetectedHand[]>([]);
  
  // Ref for visual smoothing of AR elements
  const visualSmoothMapRef = useRef<Map<number, {x: number, y: number}>>(new Map());

  // Ref for logic smoothing (to prevent sort jitter)
  const prevFrameCentroidsRef = useRef<{x: number, y: number}[]>([]);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { winningIndicesRef.current = winningHandIndices; }, [winningHandIndices]);
  useEffect(() => { triggerCaptureRef.current = triggerCapture; }, [triggerCapture]);

  useEffect(() => {
    let hands: any = null;
    let camera: any = null;
    let isCancelled = false;

    const initCamera = async () => {
      const videoElement = videoRef.current;
      const canvasElement = canvasRef.current;
      
      if (!window.Hands || !window.Camera) {
        if (!isCancelled) setTimeout(initCamera, 100);
        return;
      }

      if (!videoElement || !canvasElement) return;

      const Hands = window.Hands;
      const Camera = window.Camera;
      const canvasCtx = canvasElement.getContext('2d');
      if (!canvasCtx) return;

      const onResults = (results: Results) => {
        if (isCancelled) return;

        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;

        // 1. Draw Video (Mirrored manually to keep text normal)
        canvasCtx.save();
        canvasCtx.translate(canvasElement.width, 0);
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.restore();

        // 2. Process Hands & Stabilize
        const detectedHands: DetectedHand[] = [];
        if (results.multiHandLandmarks) {
          results.multiHandLandmarks.forEach((landmarks: HandLandmark[], index: number) => {
            const label = results.multiHandedness && results.multiHandedness[index] 
              ? results.multiHandedness[index].label 
              : 'Right';
            const handData = analyzeHand(landmarks, index, label);
            detectedHands.push(handData);
          });
        }

        // Apply Smoothing to detectedHands centroids based on previous frame
        if (prevFrameCentroidsRef.current.length > 0 && detectedHands.length > 0) {
           detectedHands.forEach(hand => {
              // Find closest previous centroid
              let closestIdx = -1;
              let minDist = Infinity;
              
              prevFrameCentroidsRef.current.forEach((prev, idx) => {
                 const d = Math.sqrt(Math.pow(hand.centroid.x - prev.x, 2) + Math.pow(hand.centroid.y - prev.y, 2));
                 if (d < minDist) {
                    minDist = d;
                    closestIdx = idx;
                 }
              });

              // If match found within reasonable distance (e.g. 0.2 screen width), smooth it
              if (closestIdx !== -1 && minDist < 0.2) {
                 const prev = prevFrameCentroidsRef.current[closestIdx];
                 // Smooth X coordinate heavily to prevent jitter
                 hand.centroid.x = lerp(prev.x, hand.centroid.x, 0.3); // 0.3 means 30% new, 70% old
                 hand.centroid.y = lerp(prev.y, hand.centroid.y, 0.3);
              }
           });
        }

        // Save current smoothed centroids for next frame
        prevFrameCentroidsRef.current = detectedHands.map(h => ({ x: h.centroid.x, y: h.centroid.y }));

        // Now Sort based on the STABILIZED centroids
        let sortedHands = getSortedHands(detectedHands);
        
        // REVERSE order because we mirrored the display. 
        // Original: Left(0) to Right(1) in source.
        // Mirrored Display: Right Side to Left Side.
        // We want Array Index 0 to be Left Side of Screen.
        sortedHands = sortedHands.reverse();

        currentHandsRef.current = sortedHands;
        onHandsUpdate(sortedHands);

        // 3. Draw AR Elements
        const currentGameState = gameStateRef.current;
        const currentWinners = winningIndicesRef.current;
        const visualSmoothMap = visualSmoothMapRef.current;

        sortedHands.forEach((hand, sortedIndex) => {
          // Mirror the X coordinate for the overlay
          const targetX = (1 - hand.centroid.x) * canvasElement.width;
          const targetY = hand.centroid.y * canvasElement.height;

          // Visual Smoothing (for the Ball/Text rendering)
          let prevPos = visualSmoothMap.get(sortedIndex);
          if (!prevPos) prevPos = { x: targetX, y: targetY };

          const smoothX = lerp(prevPos.x, targetX, 0.2);
          const smoothY = lerp(prevPos.y, targetY, 0.2);
          visualSmoothMap.set(sortedIndex, { x: smoothX, y: smoothY });

          const isWinner = currentWinners.includes(sortedIndex);
          drawHandOverlay(canvasCtx, smoothX, smoothY, hand, currentGameState, sortedIndex, isWinner);
        });

        // Cleanup unused visual map entries
        if (visualSmoothMap.size > sortedHands.length) {
           for (let i = sortedHands.length; i < visualSmoothMap.size + 5; i++) {
             visualSmoothMap.delete(i);
           }
        }

        // 4. Handle Capture
        if (triggerCaptureRef.current) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvasElement.width;
          tempCanvas.height = canvasElement.height;
          const tCtx = tempCanvas.getContext('2d');

          if (tCtx) {
            // Draw only the canvas (which contains mirrored video + normal text)
            tCtx.drawImage(canvasElement, 0, 0);
            const fullScreenImage = tempCanvas.toDataURL('image/png');
            onCaptureComplete([fullScreenImage]);
          }
          triggerCaptureRef.current = false; 
        }

        canvasCtx.restore();
      };

      hands = new Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 10,
        modelComplexity: 1,
        minDetectionConfidence: 0.8, 
        minTrackingConfidence: 0.8,
      });

      hands.onResults(onResults);

      if (videoElement) {
        camera = new Camera(videoElement, {
          onFrame: async () => {
            if (hands) await hands.send({ image: videoElement });
          },
          facingMode: 'user',
          width: 1280,  // Set high resolution
          height: 720
        });
        
        try {
           await camera.start();
        } catch (err) {
           console.error("Camera start error:", err);
        }
      }
    };

    initCamera();

    return () => {
      isCancelled = true;
      if (camera) camera.stop();
      if (hands) hands.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-3xl shadow-2xl bg-black">
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover" />
    </div>
  );
};

function drawHandOverlay(
  ctx: CanvasRenderingContext2D, 
  x: number, 
  y: number, 
  hand: DetectedHand, 
  state: GameState, 
  sortedIndex: number,
  isWinner: boolean
) {
  const size = 100;
  ctx.lineWidth = 4;
  
  if (state === GameState.SHOW_WINNER && isWinner) {
     if (!hand.isFist) {
        drawWinnerBall(ctx, x, y);
     }
  } else if (state === GameState.DETECT_PARTICIPANTS) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, 15);
      drawLabel(ctx, x, y - size/2 - 20, `#${sortedIndex + 1}`, COLORS.primary);
  } else if (state === GameState.WAIT_FOR_FISTS_READY || state === GameState.WAIT_FOR_FISTS_PRE_DRAW) {
      const color = hand.isFist ? COLORS.success : COLORS.accent;
      ctx.strokeStyle = color;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, 15);
      
      if (!hand.isFist) {
        drawLabel(ctx, x, y + size/2 + 20, "주먹 쥐세요", COLORS.accent);
      }
  } else if (state === GameState.SET_WINNER_COUNT) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, 15);
      drawLabel(ctx, x, y - size/2 - 20, `${hand.fingerCount}명`, COLORS.primary);
  }
}

function drawWinnerBall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const radius = 40; 
  
  const gradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 1.5);
  gradient.addColorStop(0, 'rgba(255, 234, 0, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 234, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.5, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = COLORS.primary;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#000000';
  ctx.font = '900 16px Pretendard';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WINNER', x, y);
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bgColor: string) {
  ctx.font = 'bold 16px Pretendard';
  const metrics = ctx.measureText(text);
  const padding = 10;
  const bgW = metrics.width + padding * 2;
  const bgH = 30;

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x - bgW / 2, y - bgH / 2, bgW, bgH, 8);
  ctx.fill();

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export default CameraLayer;