import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, memo } from 'react';
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
  onStreamReady?: () => void;
}

declare global {
  interface Window {
    Hands: any;
  }
}

const lerp = (start: number, end: number, t: number) => {
  return start * (1 - t) + end * t;
};

// --- Advanced Tracking Configuration ---
const MAX_TRACKING_DISTANCE = 0.4; // Increased allowance for fast movement
const DUPLICATE_HAND_THRESHOLD = 0.05; // Tightened threshold (5% of screen) to prevent merging adjacent hands
const FRAME_PERSISTENCE_THRESHOLD = 1; 
const MAX_MISSING_FRAMES = 30; // Increased to keep ID alive longer (approx 1 sec at 30fps)

// Visual Smoothing
const POS_SMOOTHING_FACTOR = 0.5; 
const FIST_CONFIDENCE_THRESHOLD = 0.6; 
const FIST_CONFIDENCE_DECAY = 0.25; 

const GAME_LOGIC_UPDATE_INTERVAL_MS = 30; // Faster updates

let nextStableId = 1000; 

interface VisualState {
  x: number;
  y: number;
  lastSeen: number;
  fistConfidence: number; 
  isVisuallyFist: boolean;
}

interface TrackedHand {
    id: number;
    centroid: {x: number, y: number};
    velocity: {dx: number, dy: number}; 
    lastSeen: number;
    frameCount: number; 
    missingCount: number;
    label: 'Left' | 'Right';
    _tempMpIndex?: number; 
}

const CameraLayer = memo(forwardRef<CameraLayerHandle, CameraLayerProps>(({ 
  gameState, 
  onHandsUpdate, 
  winningStableIds, 
  triggerCapture, 
  onCaptureComplete,
  onZoomInit,
  onStreamReady
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
  
  // Performance Throttling Refs
  const lastLogicUpdateTimeRef = useRef<number>(0);
  const lastHandCountRef = useRef<number>(0);
  
  // Data Refs
  const detectedHandsRef = useRef<DetectedHand[]>([]);
  
  // Robust Tracking Refs
  const tracksRef = useRef<TrackedHand[]>([]);

  // Visual Smoothing Map
  const visualStateMapRef = useRef<Map<number, VisualState>>(new Map());
  
  // Loop Control Refs
  const renderReqRef = useRef<number>(0);
  const detectReqRef = useRef<number>(0);
  const handsRef = useRef<any>(null);
  const isDetectingRef = useRef<boolean>(false);
  const frameCounterRef = useRef<number>(0);

  // Sync Props
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
           video.play().then(() => { 
               if (!isCancelled) {
                   setIsStreamReady(true);
                   if (onStreamReady) onStreamReady();
               }
           })
             .catch(e => setErrorMessage("화면을 터치하여 카메라를 시작해주세요."));
        };
      } catch (e: any) {
        setErrorMessage("카메라 권한을 확인해주세요.");
        return;
      }

      const render = () => {
        if (isCancelled) return;
        frameCounterRef.current++;

        if (video.readyState >= 2) {
           const dpr = Math.min(window.devicePixelRatio || 1, 2);
           const displayWidth = Math.floor(window.innerWidth * dpr);
           const displayHeight = Math.floor(window.innerHeight * dpr);

           if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
              canvas.width = displayWidth;
              canvas.height = displayHeight;
           }

           const zoom = zoomStateRef.current;
           const vw = video.videoWidth;
           const vh = video.videoHeight;
           const cw = canvas.width;
           const ch = canvas.height;

           const videoRatio = vw / vh;
           const canvasRatio = cw / ch;
           
           let sWidth, sHeight, sx, sy;

           if (canvasRatio > videoRatio) {
               sWidth = vw;
               sHeight = vw / canvasRatio;
           } else {
               sHeight = vh;
               sWidth = vh * canvasRatio;
           }

           const zoomLevel = zoom.type === 'digital' ? Math.max(1, zoom.current) : 1;
           sWidth /= zoomLevel;
           sHeight /= zoomLevel;

           sx = (vw - sWidth) / 2;
           sy = (vh - sHeight) / 2;

           ctx.save();
           if (facingMode === 'user') {
             ctx.translate(canvas.width, 0);
             ctx.scale(-1, 1);
           }

           ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
           ctx.restore();
        }

        const hands = detectedHandsRef.current;
        const currentGameState = gameStateRef.current;
        const currentWinningIds = winningIdsRef.current;
        const visualMap = visualStateMapRef.current;
        const now = Date.now();

        // Detect current hands
        hands.forEach((hand, idx) => {
           let vState = visualMap.get(hand.stableId);
           const targetX = hand.centroid.x * canvas.width;
           const targetY = hand.centroid.y * canvas.height;

           if (!vState) {
              vState = { 
                  x: targetX, 
                  y: targetY, 
                  lastSeen: now, 
                  fistConfidence: hand.isFist ? 1.0 : 0.0,
                  isVisuallyFist: hand.isFist
              };
           } else {
              vState.x = lerp(vState.x, targetX, POS_SMOOTHING_FACTOR);
              vState.y = lerp(vState.y, targetY, POS_SMOOTHING_FACTOR);
              vState.lastSeen = now;

              const targetConf = hand.isFist ? 1.0 : 0.0;
              vState.fistConfidence = lerp(vState.fistConfidence, targetConf, FIST_CONFIDENCE_DECAY);
              
              if (vState.isVisuallyFist && vState.fistConfidence < (1 - FIST_CONFIDENCE_THRESHOLD)) {
                  vState.isVisuallyFist = false;
              } else if (!vState.isVisuallyFist && vState.fistConfidence > FIST_CONFIDENCE_THRESHOLD) {
                  vState.isVisuallyFist = true;
              }
           }
           visualMap.set(hand.stableId, vState);

           const isWinner = currentWinningIds.includes(hand.stableId);
           drawHandOverlay(ctx, vState.x, vState.y, hand, currentGameState, idx, isWinner, vState.isVisuallyFist);
        });

        // ----------------------------------------------------------------------
        // FIX: Persistent Winner Ghost Logic
        // If we are in SHOW_WINNER state, we check for any winning ID that isn't currently detected.
        // We draw the winner ball at its last known location forever (until reset).
        // ----------------------------------------------------------------------
        if (currentGameState === GameState.SHOW_WINNER) {
            currentWinningIds.forEach(winId => {
                const isCurrentlyDetected = hands.some(h => h.stableId === winId);
                if (!isCurrentlyDetected) {
                    const vState = visualMap.get(winId);
                    if (vState) {
                        // REMOVED TIME CHECK: if (now - vState.lastSeen < 1500)
                        // Always draw ghost for winner
                        if (!vState.isVisuallyFist) {
                            drawWinnerBall(ctx, vState.x, vState.y, Math.min(canvas.width, canvas.height), true);
                        }
                    }
                }
            });
        }

        // Cleanup Logic: Don't remove Winning IDs from visual map
        if (frameCounterRef.current % 60 === 0) {
            for (const [id, state] of visualMap.entries()) {
                // If it's a winner, don't expire it from memory
                if (currentWinningIds.includes(id)) continue;
                
                if (now - state.lastSeen > 5000) {
                    visualMap.delete(id);
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
      
      if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current);
      renderReqRef.current = requestAnimationFrame(render);

      if (!handsRef.current) { 
          if (!window.Hands) {
             let attempts = 0;
             while (!window.Hands && attempts < 50) {
                await new Promise(r => setTimeout(r, 200));
                attempts++;
             }
             if (!window.Hands) {
                setErrorMessage("AI 모델 로드 실패");
                return;
             }
          }

          const Hands = window.Hands;
          const hands = new Hands({
             locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
          });

          hands.setOptions({
             maxNumHands: 20, 
             modelComplexity: 1, 
             minDetectionConfidence: 0.5, // Lowered slightly to improve recall
             minTrackingConfidence: 0.5
          });

          hands.onResults((results: Results) => {
             if (isLoadingModel) setIsLoadingModel(false);
             isDetectingRef.current = false;
             const now = Date.now();

             const rawInputs: {x: number, y: number, index: number, label: 'Left' | 'Right'}[] = [];
             if (results.multiHandLandmarks) {
                results.multiHandLandmarks.forEach((landmarks, i) => {
                   const label = results.multiHandedness && results.multiHandedness[i] 
                                ? results.multiHandedness[i].label 
                                : 'Right';
                   rawInputs.push({x: landmarks[9].x, y: landmarks[9].y, index: i, label});
                });
             }

             // Deduplication
             const uniqueInputs: typeof rawInputs = [];
             const processedIndices = new Set<number>();

             for (let i = 0; i < rawInputs.length; i++) {
                 if (processedIndices.has(i)) continue;
                 const handA = rawInputs[i];
                 let bestCandidate = handA;
                 processedIndices.add(i);

                 for (let j = i + 1; j < rawInputs.length; j++) {
                     if (processedIndices.has(j)) continue;
                     const handB = rawInputs[j];
                     const dist = Math.sqrt((handA.x - handB.x)**2 + (handA.y - handB.y)**2);
                     
                     if (dist < DUPLICATE_HAND_THRESHOLD) {
                         processedIndices.add(j); 
                     }
                 }
                 uniqueInputs.push(bestCandidate);
             }

             const activeTracks = tracksRef.current;
             
             activeTracks.forEach(t => {
                 t.missingCount++;
                 t.centroid.x += t.velocity.dx;
                 t.centroid.y += t.velocity.dy;
             });

             const matches: {trackIdx: number, inputIdx: number, cost: number}[] = [];
             
             activeTracks.forEach((track, trackIdx) => {
                 uniqueInputs.forEach((input, inputIdx) => {
                     const dist = Math.sqrt((track.centroid.x - input.x)**2 + (track.centroid.y - input.y)**2);
                     
                     // FIX: Reduced handedness penalty dramatically.
                     // Fists often have unstable handedness in MediaPipe. 
                     // Position is the primary truth.
                     const handednessPenalty = (track.label !== input.label) ? 0.05 : 0; 
                     
                     if (dist < MAX_TRACKING_DISTANCE) {
                         const cost = dist + handednessPenalty;
                         matches.push({trackIdx, inputIdx, cost});
                     }
                 });
             });

             matches.sort((a, b) => a.cost - b.cost);

             const matchedTrackIndices = new Set<number>();
             const matchedInputIndices = new Set<number>();

             matches.forEach(({trackIdx, inputIdx}) => {
                 if (matchedTrackIndices.has(trackIdx) || matchedInputIndices.has(inputIdx)) return;
                 
                 const track = activeTracks[trackIdx];
                 const input = uniqueInputs[inputIdx];
                 
                 const vx = input.x - track.centroid.x;
                 const vy = input.y - track.centroid.y;
                 track.velocity.dx = track.velocity.dx * 0.5 + vx * 0.5;
                 track.velocity.dy = track.velocity.dy * 0.5 + vy * 0.5;

                 track.centroid.x = input.x;
                 track.centroid.y = input.y;
                 track.lastSeen = now;
                 track.frameCount++;
                 track.missingCount = 0;
                 track._tempMpIndex = input.index;
                 track.label = input.label; 

                 matchedTrackIndices.add(trackIdx);
                 matchedInputIndices.add(inputIdx);
             });

             uniqueInputs.forEach((input, idx) => {
                 if (!matchedInputIndices.has(idx)) {
                     activeTracks.push({
                         id: nextStableId++,
                         centroid: {x: input.x, y: input.y},
                         velocity: {dx: 0, dy: 0},
                         lastSeen: now,
                         frameCount: 1,
                         missingCount: 0,
                         label: input.label,
                         _tempMpIndex: input.index 
                     });
                 }
             });

             const keptTracks = activeTracks.filter(t => t.missingCount < MAX_MISSING_FRAMES);
             tracksRef.current = keptTracks;

             const finalHands: DetectedHand[] = [];
             
             keptTracks.forEach(track => {
                 if (track.missingCount === 0 && track._tempMpIndex !== undefined && results.multiHandLandmarks[track._tempMpIndex]) {
                     if (track.frameCount >= FRAME_PERSISTENCE_THRESHOLD) {
                         const landmarks = results.multiHandLandmarks[track._tempMpIndex];
                         const handData = analyzeHand(landmarks, track._tempMpIndex, track.label, track.id);
                         finalHands.push(handData);
                     }
                 }
             });

             finalHands.sort((a, b) => a.centroid.x - b.centroid.x);
             
             detectedHandsRef.current = finalHands;

             const shouldUpdate = 
                 finalHands.length !== lastHandCountRef.current || 
                 (now - lastLogicUpdateTimeRef.current > GAME_LOGIC_UPDATE_INTERVAL_MS);

             if (shouldUpdate) {
                lastHandCountRef.current = finalHands.length;
                lastLogicUpdateTimeRef.current = now;
                onHandsUpdate(finalHands);
             }
          });
          handsRef.current = hands;
      }

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
    <div className="relative w-full h-full overflow-hidden shadow-2xl bg-black">
      {errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black p-6 text-center">
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
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black p-6 text-center">
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
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover z-0" />
    </div>
  );
}));

export default CameraLayer;

function drawHandOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, hand: DetectedHand, state: GameState, sortedIndex: number, isWinner: boolean, isVisuallyFist: boolean) {
  const minDimension = Math.min(ctx.canvas.width, ctx.canvas.height);
  const size = minDimension * 0.25; 
  const strokeWidth = Math.max(2, minDimension * 0.008); 
  const cornerRadius = size * 0.2; 
  
  ctx.lineWidth = strokeWidth;
  const labelOffset = size * 0.5 + 20 + (minDimension * 0.02);

  if (state === GameState.SHOW_WINNER && isWinner) {
     if (!isVisuallyFist) {
        drawWinnerBall(ctx, x, y, minDimension, false);
     }
  } else if (state === GameState.DETECT_PARTICIPANTS) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      drawLabel(ctx, x, y - labelOffset, `#${sortedIndex + 1}`, COLORS.primary, minDimension);
  } else if (state === GameState.WAIT_FOR_FISTS_READY) {
      const color = isVisuallyFist ? COLORS.success : COLORS.accent;
      ctx.strokeStyle = color;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      if (!isVisuallyFist) {
        drawLabel(ctx, x, y + labelOffset, "주먹 쥐세요", COLORS.accent, minDimension);
      }
  }
}

function drawWinnerBall(ctx: CanvasRenderingContext2D, x: number, y: number, minDimension: number, isGhost: boolean) {
  const radius = minDimension * 0.15;
  const fontSize = Math.max(16, minDimension * 0.05); 
  
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
