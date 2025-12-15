import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { analyzeHand, getSortedHands } from '../services/handLogic';
import { DetectedHand, GameState, HandLandmark, CameraLayerHandle } from '../types';
import { COLORS } from '../constants';
import { AlertTriangle, Loader2, RefreshCcw } from 'lucide-react';

interface Results {
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
  }
}

const lerp = (start: number, end: number, t: number) => {
  return start * (1 - t) + end * t;
};

const CameraLayer = forwardRef<CameraLayerHandle, CameraLayerProps>(({ 
  gameState, 
  onHandsUpdate, 
  winningHandIndices,
  triggerCapture,
  onCaptureComplete
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // UI States
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(true);
  
  // Camera State
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // Logic Refs
  const gameStateRef = useRef(gameState);
  const winningIndicesRef = useRef(winningHandIndices);
  const triggerCaptureRef = useRef(triggerCapture);
  
  // Data Refs
  const detectedHandsRef = useRef<DetectedHand[]>([]);
  const prevFrameCentroidsRef = useRef<{x: number, y: number}[]>([]);
  const visualSmoothMapRef = useRef<Map<number, {x: number, y: number}>>(new Map());
  
  // Loop Control Refs
  const renderReqRef = useRef<number>(0);
  const detectReqRef = useRef<number>(0);
  const handsRef = useRef<any>(null);
  const isDetectingRef = useRef<boolean>(false);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { winningIndicesRef.current = winningHandIndices; }, [winningHandIndices]);
  useEffect(() => { triggerCaptureRef.current = triggerCapture; }, [triggerCapture]);

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  useImperativeHandle(ref, () => ({
    toggleCamera
  }));

  useEffect(() => {
    let isCancelled = false;

    const initSystem = async () => {
      setErrorMessage(null);
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      // 1. Camera Setup
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
           // Skip strict check for simpler mobile compatibility, rely on catch
        }

        // Stop existing tracks if any
        if (video.srcObject) {
          const stream = video.srcObject as MediaStream;
          stream.getTracks().forEach(t => t.stop());
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingMode
          },
          audio: false
        });
        
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
           video.play()
             .catch(e => {
                setErrorMessage("화면을 터치하여 카메라를 시작해주세요.");
             });
        };
      } catch (e: any) {
        console.error(e);
        let msg = `카메라 오류: ${e.name}`;
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
           msg = "카메라 권한이 거부되었습니다. 설정에서 허용해주세요.";
        } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
           msg = "카메라를 찾을 수 없습니다.";
        } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
           msg = "카메라를 다른 앱이 사용 중이거나 하드웨어 오류입니다.";
        } else if (!window.isSecureContext) {
           msg = "보안 연결(HTTPS)이 필요합니다.";
        }
        setErrorMessage(msg);
        return;
      }

      // 2. Render Loop (Decoupled - Always Runs)
      const render = () => {
        if (isCancelled) return;

        if (video.readyState >= 2) {
           if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
           }

           // Draw Video
           ctx.save();
           
           // Mirror only if user facing
           if (facingMode === 'user') {
             ctx.translate(canvas.width, 0);
             ctx.scale(-1, 1);
           }
           
           ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
           ctx.restore();
        }

        // Draw AR Overlays
        const hands = detectedHandsRef.current;
        const currentGameState = gameStateRef.current;
        const currentWinners = winningIndicesRef.current;
        const visualSmoothMap = visualSmoothMapRef.current;

        if (hands.length > 0) {
           hands.forEach((hand, sortedIndex) => {
              // Calculate coordinates based on mirroring
              let targetX = hand.centroid.x * canvas.width;
              if (facingMode === 'user') {
                 targetX = (1 - hand.centroid.x) * canvas.width;
              }
              
              const targetY = hand.centroid.y * canvas.height;

              let prevPos = visualSmoothMap.get(sortedIndex);
              if (!prevPos) prevPos = { x: targetX, y: targetY };

              const smoothX = lerp(prevPos.x, targetX, 0.4);
              const smoothY = lerp(prevPos.y, targetY, 0.4);
              visualSmoothMap.set(sortedIndex, { x: smoothX, y: smoothY });

              const isWinner = currentWinners.includes(sortedIndex);
              drawHandOverlay(ctx, smoothX, smoothY, hand, currentGameState, sortedIndex, isWinner);
           });
           
           if (visualSmoothMap.size > hands.length) {
              for (let i = hands.length; i < visualSmoothMap.size + 5; i++) {
                 visualSmoothMap.delete(i);
              }
           }
        }

        if (triggerCaptureRef.current) {
           try {
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = canvas.width;
              tempCanvas.height = canvas.height;
              const tCtx = tempCanvas.getContext('2d');
              if (tCtx) {
                 tCtx.drawImage(canvas, 0, 0);
                 onCaptureComplete([tempCanvas.toDataURL('image/png')]);
              }
           } catch (e) {}
           triggerCaptureRef.current = false;
        }

        renderReqRef.current = requestAnimationFrame(render);
      };
      
      // Cancel previous loops if exists
      if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current);
      renderReqRef.current = requestAnimationFrame(render);

      // 3. AI Model Setup
      if (!handsRef.current) { 
          if (!window.Hands) {
             let attempts = 0;
             while (!window.Hands && attempts < 50) {
                await new Promise(r => setTimeout(r, 200));
                attempts++;
             }
             if (!window.Hands) {
                setErrorMessage("AI 모델 스크립트를 불러오지 못했습니다.");
                return;
             }
          }

          const Hands = window.Hands;
          const hands = new Hands({
             locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
          });

          hands.setOptions({
             maxNumHands: 4, 
             modelComplexity: 0, 
             minDetectionConfidence: 0.5,
             minTrackingConfidence: 0.5
          });

          hands.onResults((results: Results) => {
             if (isLoadingModel) {
                setIsLoadingModel(false);
             }
             isDetectingRef.current = false;

             const rawHands: DetectedHand[] = [];
             if (results.multiHandLandmarks) {
                results.multiHandLandmarks.forEach((landmarks: HandLandmark[], index: number) => {
                   const label = results.multiHandedness && results.multiHandedness[index] 
                      ? results.multiHandedness[index].label 
                      : 'Right';
                   rawHands.push(analyzeHand(landmarks, index, label));
                });
             }
             
             let sorted = [...rawHands];
             if (facingMode === 'user') {
                sorted.sort((a, b) => b.centroid.x - a.centroid.x); // Descending for mirrored
             } else {
                sorted.sort((a, b) => a.centroid.x - b.centroid.x); // Ascending for normal
             }
             
             // Logic Smoothing
             if (prevFrameCentroidsRef.current.length > 0 && sorted.length > 0) {
                sorted.forEach(hand => {
                   let closestIdx = -1;
                   let minDist = Infinity;
                   prevFrameCentroidsRef.current.forEach((prev, idx) => {
                      const d = Math.sqrt(Math.pow(hand.centroid.x - prev.x, 2) + Math.pow(hand.centroid.y - prev.y, 2));
                      if (d < minDist) { minDist = d; closestIdx = idx; }
                   });
                   if (closestIdx !== -1 && minDist < 0.2) {
                      const prev = prevFrameCentroidsRef.current[closestIdx];
                      hand.centroid.x = lerp(prev.x, hand.centroid.x, 0.5);
                      hand.centroid.y = lerp(prev.y, hand.centroid.y, 0.5);
                   }
                });
             }
             prevFrameCentroidsRef.current = sorted.map(h => ({ x: h.centroid.x, y: h.centroid.y }));

             detectedHandsRef.current = sorted;
             onHandsUpdate(sorted);
          });
          handsRef.current = hands;
      }

      // 4. Detection Loop
      const detect = async () => {
         if (isCancelled) return;
         if (video.readyState >= 2 && handsRef.current && !isDetectingRef.current) {
            isDetectingRef.current = true;
            try {
               await handsRef.current.send({ image: video });
            } catch (e) {
               isDetectingRef.current = false;
            }
         }
         detectReqRef.current = requestAnimationFrame(detect);
      };
      
      if (detectReqRef.current) cancelAnimationFrame(detectReqRef.current);
      detectReqRef.current = requestAnimationFrame(detect);
    };

    initSystem();

    return () => {
      isCancelled = true;
      if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current);
      if (detectReqRef.current) cancelAnimationFrame(detectReqRef.current);
      if (videoRef.current && videoRef.current.srcObject) {
         const stream = videoRef.current.srcObject as MediaStream;
         stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [facingMode]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-3xl shadow-2xl bg-black">
      {errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/90 p-6 text-center">
           <div className="flex flex-col items-center gap-4">
              <AlertTriangle className="w-12 h-12 text-red-500" />
              <p className="text-white text-lg font-bold">오류가 발생했습니다</p>
              <div className="bg-gray-800 p-4 rounded text-left w-full overflow-auto max-h-40">
                <p className="text-red-300 font-mono text-xs">{errorMessage}</p>
              </div>
              <button 
                onClick={() => window.location.reload()}
                className="mt-4 px-6 py-2 bg-white text-black font-bold rounded-full flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" /> 다시 시도
              </button>
           </div>
        </div>
      )}

      {isLoadingModel && !errorMessage && (
        <div className="absolute top-4 left-4 z-40 bg-black/60 backdrop-blur px-4 py-2 rounded-full flex items-center gap-3 border border-white/20">
           <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
           <span className="text-white text-sm font-bold">AI 모델 준비 중...</span>
        </div>
      )}

      <video 
        ref={videoRef} 
        className="absolute top-0 left-0 w-full h-full object-cover -z-10 opacity-0" 
        playsInline 
        muted 
        autoPlay 
      />
      
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 w-full h-full object-cover" 
      />
    </div>
  );
});

export default CameraLayer;

function drawHandOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, hand: DetectedHand, state: GameState, sortedIndex: number, isWinner: boolean) {
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
