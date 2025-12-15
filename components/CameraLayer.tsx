import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { analyzeHand } from '../services/handLogic';
import { DetectedHand, GameState, HandLandmark, CameraLayerHandle } from '../types';
import { COLORS } from '../constants';
import { AlertTriangle, Loader2, RefreshCcw, Camera, Play } from 'lucide-react';

interface Results {
  multiHandLandmarks: HandLandmark[][];
  multiHandedness: Array<{ label: 'Left' | 'Right', score: number }>;
}

interface CameraLayerProps {
  gameState: GameState;
  onHandsUpdate: (hands: DetectedHand[]) => void;
  winningStableIds: number[]; 
  triggerCapture: boolean;
  onCaptureComplete: (images: string[]) => void;
  onZoomInit?: (min: number, max: number, step: number, current: number) => void;
}

declare global {
  interface Window {
    Hands: any;
  }
}

const lerp = (start: number, end: number, t: number) => {
  return start * (1 - t) + end * t;
};

// Tracking Configuration
const MAX_TRACKING_DISTANCE = 0.3; // Increased to handle faster motion
const FRAME_PERSISTENCE_THRESHOLD = 3; // Reduced slightly for faster response
const MAX_MISSING_FRAMES = 15; // Increased persistence to hold ID longer during glitches

// Visual Stabilization Config
const POS_SMOOTHING_FACTOR = 0.3; // Lower = smoother but more lag
const FIST_CONFIDENCE_THRESHOLD = 0.6; // Threshold to switch state
const FIST_CONFIDENCE_DECAY = 0.2; // How fast state changes

let nextStableId = 0;

interface VisualState {
  x: number;
  y: number;
  lastSeen: number;
  fistConfidence: number; // 0.0 (Open) to 1.0 (Fist)
  isVisuallyFist: boolean; // Smoothed state
}

const CameraLayer = forwardRef<CameraLayerHandle, CameraLayerProps>(({ 
  gameState, 
  onHandsUpdate, 
  winningStableIds, 
  triggerCapture,
  onCaptureComplete,
  onZoomInit
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  
  // UI States
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(true);
  const [isStreamReady, setIsStreamReady] = useState<boolean>(false);
  const [userConfirmed, setUserConfirmed] = useState<boolean>(false);
  
  // Camera State
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // Zoom State
  const zoomStateRef = useRef<{ type: 'native' | 'digital', current: number }>({ type: 'digital', current: 1 });

  // Logic Refs
  const gameStateRef = useRef(gameState);
  const winningIdsRef = useRef(winningStableIds);
  const triggerCaptureRef = useRef(triggerCapture);
  
  // Data Refs
  const detectedHandsRef = useRef<DetectedHand[]>([]);
  
  // Robust Tracking Refs
  const tracksRef = useRef<{
      id: number;
      centroid: {x: number, y: number};
      lastSeen: number;
      frameCount: number; 
      missingCount: number; 
  }[]>([]);

  // Visual Smoothing Map (Persists even if hand is briefly lost)
  const visualStateMapRef = useRef<Map<number, VisualState>>(new Map());
  
  // Loop Control Refs
  const renderReqRef = useRef<number>(0);
  const detectReqRef = useRef<number>(0);
  const handsRef = useRef<any>(null);
  const isDetectingRef = useRef<boolean>(false);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { winningIdsRef.current = winningStableIds; }, [winningStableIds]);
  useEffect(() => { triggerCaptureRef.current = triggerCapture; }, [triggerCapture]);

  useImperativeHandle(ref, () => ({
    toggleCamera: () => {
       setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
       setIsStreamReady(false);
    },
    setZoom: (zoom: number) => {
       zoomStateRef.current.current = zoom;
       if (zoomStateRef.current.type === 'native' && videoTrackRef.current) {
          const track = videoTrackRef.current;
          track.applyConstraints({ advanced: [{ zoom: zoom }] as any }).catch(console.debug);
       }
    }
  }));

  useEffect(() => {
    if (!userConfirmed) return;

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
        if (video.srcObject) {
          const stream = video.srcObject as MediaStream;
          stream.getTracks().forEach(t => t.stop());
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        
        video.srcObject = stream;
        const videoTrack = stream.getVideoTracks()[0];
        videoTrackRef.current = videoTrack;

        const capabilities = videoTrack.getCapabilities ? (videoTrack.getCapabilities() as any) : {};
        if (capabilities.zoom && capabilities.zoom.min !== capabilities.zoom.max) {
            const minZoom = capabilities.zoom.min;
            try { await videoTrack.applyConstraints({ advanced: [{ zoom: minZoom }] as any }); } catch (e) {}
            const settings = videoTrack.getSettings ? (videoTrack.getSettings() as any) : {};
            const currentZoom = settings.zoom || minZoom;
            zoomStateRef.current = { type: 'native', current: currentZoom };
            if (onZoomInit) onZoomInit(capabilities.zoom.min, capabilities.zoom.max, capabilities.zoom.step, currentZoom);
        } else {
            zoomStateRef.current = { type: 'digital', current: 1 };
            if (onZoomInit) onZoomInit(1, 3, 0.1, 1);
        }

        video.onloadedmetadata = () => {
           video.play().then(() => { if (!isCancelled) setIsStreamReady(true); })
             .catch(e => setErrorMessage("화면을 터치하여 카메라를 시작해주세요."));
        };
      } catch (e: any) {
        setErrorMessage("카메라 권한을 확인해주세요.");
        return;
      }

      // 2. Render Loop
      const render = () => {
        if (isCancelled) return;

        if (video.readyState >= 2) {
           if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
           }

           const zoom = zoomStateRef.current;
           ctx.save();
           if (facingMode === 'user') {
             ctx.translate(canvas.width, 0);
             ctx.scale(-1, 1);
           }

           if (zoom.type === 'native') {
               ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
           } else {
               const z = zoom.current;
               const safeZ = Math.max(1, z);
               const vw = video.videoWidth;
               const vh = video.videoHeight;
               const cropW = vw / safeZ;
               const cropH = vh / safeZ;
               const cropX = (vw - cropW) / 2;
               const cropY = (vh - cropH) / 2;
               ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
           }
           ctx.restore();
        }

        // --- Draw AR Overlays ---
        const hands = detectedHandsRef.current;
        const currentGameState = gameStateRef.current;
        const currentWinningIds = winningIdsRef.current;
        const visualMap = visualStateMapRef.current;
        const now = Date.now();

        // 1. Update Visual State for detected hands
        hands.forEach((hand, idx) => {
           let vState = visualMap.get(hand.stableId);
           const targetX = hand.centroid.x * canvas.width;
           const targetY = hand.centroid.y * canvas.height;

           if (!vState) {
              // New hand
              vState = { 
                  x: targetX, 
                  y: targetY, 
                  lastSeen: now, 
                  fistConfidence: hand.isFist ? 1.0 : 0.0,
                  isVisuallyFist: hand.isFist
              };
           } else {
              // Smooth Position
              vState.x = lerp(vState.x, targetX, POS_SMOOTHING_FACTOR);
              vState.y = lerp(vState.y, targetY, POS_SMOOTHING_FACTOR);
              vState.lastSeen = now;

              // Smooth Fist State (Debounce)
              const targetConf = hand.isFist ? 1.0 : 0.0;
              vState.fistConfidence = lerp(vState.fistConfidence, targetConf, FIST_CONFIDENCE_DECAY);
              
              // Hysteresis for toggle
              if (vState.isVisuallyFist && vState.fistConfidence < (1 - FIST_CONFIDENCE_THRESHOLD)) {
                  vState.isVisuallyFist = false;
              } else if (!vState.isVisuallyFist && vState.fistConfidence > FIST_CONFIDENCE_THRESHOLD) {
                  vState.isVisuallyFist = true;
              }
           }
           visualMap.set(hand.stableId, vState);

           // Draw Active Hands
           const isWinner = currentWinningIds.includes(hand.stableId);
           // Use the smoothed 'isVisuallyFist' instead of raw 'isFist' to prevent flickering
           drawHandOverlay(ctx, vState.x, vState.y, hand, currentGameState, idx, isWinner, vState.isVisuallyFist);
        });

        // 2. Handle "Ghost" Winners (Winner hands that were lost briefly)
        if (currentGameState === GameState.SHOW_WINNER) {
            currentWinningIds.forEach(winId => {
                const isCurrentlyDetected = hands.some(h => h.stableId === winId);
                if (!isCurrentlyDetected) {
                    const vState = visualMap.get(winId);
                    // Draw ghost if seen recently (e.g., within 0.8s)
                    if (vState && (now - vState.lastSeen < 800)) {
                        // Draw winner ball at last known pos
                        // We pass a dummy hand object or just draw the ball directly
                        if (!vState.isVisuallyFist) {
                            drawWinnerBall(ctx, vState.x, vState.y, Math.min(canvas.width, canvas.height), true);
                        }
                    }
                }
            });
        }

        // Cleanup old visual states
        for (const [id, state] of visualMap.entries()) {
            if (now - state.lastSeen > 2000) {
                visualMap.delete(id);
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
                setErrorMessage("AI 모델 스크립트 로드 실패");
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
             minDetectionConfidence: 0.6, 
             minTrackingConfidence: 0.6
          });

          hands.onResults((results: Results) => {
             if (isLoadingModel) setIsLoadingModel(false);
             isDetectingRef.current = false;

             const now = Date.now();
             
             // --- Improved Tracking Logic (Hungarian-like Greedy Matching) ---
             
             // 1. Prepare inputs
             const inputCentroids: {x: number, y: number, index: number}[] = [];
             if (results.multiHandLandmarks) {
                results.multiHandLandmarks.forEach((landmarks, i) => {
                   inputCentroids.push({x: landmarks[9].x, y: landmarks[9].y, index: i});
                });
             }

             const activeTracks = tracksRef.current;
             
             // Increment missing count for all tracks first
             activeTracks.forEach(t => t.missingCount++);

             // 2. Calculate all possible distances
             const matches: {trackIdx: number, inputIdx: number, dist: number}[] = [];
             
             activeTracks.forEach((track, trackIdx) => {
                 inputCentroids.forEach((input, inputIdx) => {
                     const dist = Math.sqrt(Math.pow(track.centroid.x - input.x, 2) + Math.pow(track.centroid.y - input.y, 2));
                     if (dist < MAX_TRACKING_DISTANCE) {
                         matches.push({trackIdx, inputIdx, dist});
                     }
                 });
             });

             // 3. Sort matches by distance (ascending) to assign best fits first
             matches.sort((a, b) => a.dist - b.dist);

             // 4. Assign matches
             const matchedTrackIndices = new Set<number>();
             const matchedInputIndices = new Set<number>();

             matches.forEach(({trackIdx, inputIdx}) => {
                 if (matchedTrackIndices.has(trackIdx) || matchedInputIndices.has(inputIdx)) return;
                 
                 // Match found
                 const track = activeTracks[trackIdx];
                 const input = inputCentroids[inputIdx];
                 
                 track.centroid.x = input.x;
                 track.centroid.y = input.y;
                 track.lastSeen = now;
                 track.frameCount++;
                 track.missingCount = 0;
                 // @ts-ignore
                 track._tempMpIndex = input.index;

                 matchedTrackIndices.add(trackIdx);
                 matchedInputIndices.add(inputIdx);
             });

             // 5. Create new tracks for unmatched inputs
             inputCentroids.forEach((input, idx) => {
                 if (!matchedInputIndices.has(idx)) {
                     activeTracks.push({
                         id: nextStableId++,
                         centroid: {x: input.x, y: input.y},
                         lastSeen: now,
                         frameCount: 1,
                         missingCount: 0,
                         // @ts-ignore
                         _tempMpIndex: input.index 
                     });
                 }
             });

             // 6. Filter & Export
             let validTracks = activeTracks.filter(t => t.missingCount < MAX_MISSING_FRAMES);
             tracksRef.current = validTracks;

             const finalHands: DetectedHand[] = [];
             
             validTracks.forEach(track => {
                 // Persistence check: wait until confirmed for a few frames to avoid ghost hands
                 if (track.frameCount >= FRAME_PERSISTENCE_THRESHOLD && track.missingCount === 0) {
                     const mpIndex = (track as any)._tempMpIndex;
                     if (mpIndex !== undefined && results.multiHandLandmarks[mpIndex]) {
                         const landmarks = results.multiHandLandmarks[mpIndex];
                         const label = results.multiHandedness && results.multiHandedness[mpIndex] 
                                      ? results.multiHandedness[mpIndex].label 
                                      : 'Right';
                         
                         const handData = analyzeHand(landmarks, mpIndex, label, track.id);
                         finalHands.push(handData);
                     }
                 }
             });

             // Sort Left to Right for UI index consistency
             finalHands.sort((a, b) => a.centroid.x - b.centroid.x);

             detectedHandsRef.current = finalHands;
             onHandsUpdate(finalHands);
          });
          handsRef.current = hands;
      }

      // 4. Detection Loop
      const detect = async () => {
         if (isCancelled) return;
         if (video.readyState >= 2 && handsRef.current && !isDetectingRef.current) {
            isDetectingRef.current = true;
            try {
               await handsRef.current.send({ image: canvas });
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
    };
  }, [facingMode, userConfirmed]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-3xl shadow-2xl bg-black">
      {errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black p-6 text-center animate-fade-in">
           <div className="flex flex-col items-center gap-4 max-w-sm">
              <div className="bg-red-500/10 p-4 rounded-full border border-red-500/20">
                 <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-white text-xl font-bold">오류가 발생했습니다</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-2">{errorMessage}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-white text-black font-bold rounded-xl flex items-center gap-2 hover:bg-gray-100 transition-colors"
              >
                <RefreshCcw className="w-4 h-4" /> 다시 시도
              </button>
           </div>
        </div>
      )}

      {(!isStreamReady || isLoadingModel) && !errorMessage && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black p-6 animate-fade-in text-center safe-area-inset">
            {!userConfirmed ? (
                <>
                    <div className="relative mb-8">
                       <div className="absolute inset-0 bg-yellow-400/20 rounded-full animate-ping blur-xl"></div>
                       <div className="relative bg-gray-900 p-8 rounded-full border border-yellow-400/30 shadow-[0_0_30px_rgba(250,204,21,0.2)]">
                           <Camera className="w-12 h-12 text-yellow-400" />
                       </div>
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">카메라 사용 안내</h2>
                    <p className="text-gray-400 text-sm leading-relaxed max-w-xs mx-auto mb-8">
                       게임 진행을 위해 카메라 권한이 필요합니다.<br/>
                       아래 버튼을 누른 후 팝업에서 <span className="text-yellow-400 font-bold">'허용'</span>을 선택해주세요.
                    </p>
                    <button 
                        onClick={() => setUserConfirmed(true)}
                        className="group relative flex items-center justify-center gap-3 px-8 py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-lg rounded-2xl shadow-[0_0_20px_rgba(250,204,21,0.4)] transition-all active:scale-95 w-full max-w-xs"
                    >
                        <Play className="w-5 h-5 fill-black" /> 시작하기
                    </button>
                </>
            ) : (
                <>
                     <div className="relative mb-8">
                        <div className="absolute inset-0 bg-yellow-400/10 rounded-full blur-xl"></div>
                        <div className="relative bg-gray-900 p-6 rounded-full border border-white/10">
                            <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
                        </div>
                     </div>
                     <h2 className="text-xl font-bold text-white mb-2">
                        {isStreamReady ? "AI 모델 로딩 중..." : "카메라 연결 중..."}
                     </h2>
                     <p className="text-gray-500 text-xs">잠시만 기다려주세요</p>
                </>
            )}
        </div>
      )}

      <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover -z-10 opacity-0" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover" />
    </div>
  );
});

export default CameraLayer;

function drawHandOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, hand: DetectedHand, state: GameState, sortedIndex: number, isWinner: boolean, isVisuallyFist: boolean) {
  const minDimension = Math.min(ctx.canvas.width, ctx.canvas.height);
  const size = minDimension * 0.25; 
  const strokeWidth = Math.max(2, minDimension * 0.008); 
  const cornerRadius = size * 0.2; 
  
  ctx.lineWidth = strokeWidth;
  const labelOffset = size * 0.5 + 20 + (minDimension * 0.02);

  if (state === GameState.SHOW_WINNER && isWinner) {
     // Use smoothed 'isVisuallyFist' to prevent flickering balls
     if (!isVisuallyFist) {
        drawWinnerBall(ctx, x, y, minDimension, false);
     }
  } else if (state === GameState.DETECT_PARTICIPANTS) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      drawLabel(ctx, x, y - labelOffset, `#${sortedIndex + 1}`, COLORS.primary, minDimension);
  } else if (state === GameState.WAIT_FOR_FISTS_READY || state === GameState.WAIT_FOR_FISTS_PRE_DRAW) {
      const color = isVisuallyFist ? COLORS.success : COLORS.accent;
      ctx.strokeStyle = color;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      if (!isVisuallyFist) {
        drawLabel(ctx, x, y + labelOffset, "주먹 쥐세요", COLORS.accent, minDimension);
      }
  } else if (state === GameState.SET_WINNER_COUNT) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      drawLabel(ctx, x, y - labelOffset, `${hand.fingerCount}명`, COLORS.primary, minDimension);
  }
}

function drawWinnerBall(ctx: CanvasRenderingContext2D, x: number, y: number, minDimension: number, isGhost: boolean) {
  const radius = minDimension * 0.15;
  const fontSize = Math.max(16, minDimension * 0.05); 
  
  // Ghost fading
  ctx.globalAlpha = isGhost ? 0.6 : 1.0;

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
  ctx.lineWidth = Math.max(2, minDimension * 0.01);
  ctx.stroke();
  
  ctx.fillStyle = '#000000';
  ctx.font = `900 ${fontSize}px Pretendard`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WINNER', x, y);

  ctx.globalAlpha = 1.0;
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

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bgColor: string, minDimension: number) {
  const fontSize = Math.max(14, minDimension * 0.045); 
  ctx.font = `bold ${fontSize}px Pretendard`;
  const metrics = ctx.measureText(text);
  const paddingH = fontSize * 0.6;
  const paddingV = fontSize * 0.4;
  const bgW = metrics.width + paddingH * 2;
  const bgH = fontSize + paddingV * 2;
  
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x - bgW / 2, y - bgH / 2, bgW, bgH, bgH * 0.3);
  ctx.fill();
  
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}
