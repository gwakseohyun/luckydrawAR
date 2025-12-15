
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
  winningStableIds: number[]; // CHANGED: Now using Stable IDs to lock the winner to a specific hand
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
const MAX_TRACKING_DISTANCE = 0.25; // Increased slightly to track fast movements better
const FRAME_PERSISTENCE_THRESHOLD = 5; // Hand must be detected for 5 frames to be valid (Debounce)
const MAX_MISSING_FRAMES = 10; // Keep ID alive for 10 frames if lost (Anti-flicker)

let nextStableId = 0;

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
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  
  // Zoom State
  const zoomStateRef = useRef<{ type: 'native' | 'digital', current: number }>({ type: 'digital', current: 1 });

  // Logic Refs
  const gameStateRef = useRef(gameState);
  const winningIdsRef = useRef(winningStableIds);
  const triggerCaptureRef = useRef(triggerCapture);
  
  // Data Refs
  const detectedHandsRef = useRef<DetectedHand[]>([]);
  
  // Robust Tracking Refs
  // Stores history of tracks: { id, centroid, lastSeenTime, frameCount, missingCount }
  const tracksRef = useRef<{
      id: number;
      centroid: {x: number, y: number};
      lastSeen: number;
      frameCount: number; // How many consecutive frames seen
      missingCount: number; // How many frames missing since last seen
  }[]>([]);

  const visualSmoothMapRef = useRef<Map<number, {x: number, y: number}>>(new Map());
  
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
          track.applyConstraints({
              advanced: [{ zoom: zoom }] as any
          }).catch(e => {
              console.debug("Native zoom apply failed", e);
          });
       }
    }
  }));

  useEffect(() => {
    // Prevent initialization until user interacts
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
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
           // Skip strict check
        }

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
            try {
              await videoTrack.applyConstraints({
                 advanced: [{ zoom: minZoom }] as any
              });
            } catch (e) {
              console.debug("Failed to force reset zoom", e);
            }
            const settings = videoTrack.getSettings ? (videoTrack.getSettings() as any) : {};
            const currentZoom = settings.zoom || minZoom;
            zoomStateRef.current = { type: 'native', current: currentZoom };
            
            if (onZoomInit) {
                onZoomInit(capabilities.zoom.min, capabilities.zoom.max, capabilities.zoom.step, currentZoom);
            }
        } else {
            zoomStateRef.current = { type: 'digital', current: 1 };
            if (onZoomInit) {
                onZoomInit(1, 3, 0.1, 1);
            }
        }

        video.onloadedmetadata = () => {
           video.play()
             .then(() => {
                if (!isCancelled) setIsStreamReady(true);
             })
             .catch(e => {
                console.error("Play error", e);
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

        // Draw AR Overlays
        const hands = detectedHandsRef.current;
        const currentGameState = gameStateRef.current;
        const currentWinningIds = winningIdsRef.current;
        const visualSmoothMap = visualSmoothMapRef.current;

        if (hands.length > 0) {
           hands.forEach((hand, sortedIndex) => {
              const targetX = hand.centroid.x * canvas.width;
              const targetY = hand.centroid.y * canvas.height;

              let prevPos = visualSmoothMap.get(hand.stableId);
              if (!prevPos) prevPos = { x: targetX, y: targetY };

              const smoothX = lerp(prevPos.x, targetX, 0.4);
              const smoothY = lerp(prevPos.y, targetY, 0.4);
              visualSmoothMap.set(hand.stableId, { x: smoothX, y: smoothY });

              // FIX: Determine winner based on Stable ID, not Index
              const isWinner = currentWinningIds.includes(hand.stableId);
              
              drawHandOverlay(ctx, smoothX, smoothY, hand, currentGameState, sortedIndex, isWinner);
           });
           
           const currentIds = new Set(hands.map(h => h.stableId));
           for (const id of visualSmoothMap.keys()) {
              if (!currentIds.has(id)) {
                 visualSmoothMap.delete(id);
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
             minDetectionConfidence: 0.7, 
             minTrackingConfidence: 0.7
          });

          hands.onResults((results: Results) => {
             if (isLoadingModel) setIsLoadingModel(false);
             isDetectingRef.current = false;

             const now = Date.now();
             
             // --- Advanced Tracking Logic ---
             
             // 1. Prepare inputs from MediaPipe
             const inputCentroids: {x: number, y: number, index: number}[] = [];
             if (results.multiHandLandmarks) {
                results.multiHandLandmarks.forEach((landmarks, i) => {
                   inputCentroids.push({x: landmarks[9].x, y: landmarks[9].y, index: i});
                });
             }

             // 2. Match inputs to existing tracks
             const activeTracks = tracksRef.current;
             const matchedInputIndices = new Set<number>();
             
             // Mark all tracks as missing first
             activeTracks.forEach(t => t.missingCount++);

             // Greedy matching (can be improved to Hungarian Algo if needed, but greedy is fast)
             activeTracks.forEach(track => {
                 let closestInputIdx = -1;
                 let minDst = MAX_TRACKING_DISTANCE;

                 inputCentroids.forEach((input, idx) => {
                     if (matchedInputIndices.has(idx)) return;
                     const dst = Math.sqrt(Math.pow(track.centroid.x - input.x, 2) + Math.pow(track.centroid.y - input.y, 2));
                     if (dst < minDst) {
                         minDst = dst;
                         closestInputIdx = idx;
                     }
                 });

                 if (closestInputIdx !== -1) {
                     // Found a match: Update track
                     track.centroid.x = inputCentroids[closestInputIdx].x;
                     track.centroid.y = inputCentroids[closestInputIdx].y;
                     track.lastSeen = now;
                     track.frameCount++;
                     track.missingCount = 0;
                     matchedInputIndices.add(closestInputIdx);
                     
                     // Store the media pipe index for analysis
                     (track as any)._tempMpIndex = inputCentroids[closestInputIdx].index;
                 } else {
                     // Track lost this frame
                     track.frameCount = 0; // Reset consecutive count if tracking is lost? No, just stop incrementing.
                 }
             });

             // 3. Create new tracks for unmatched inputs
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

             // 4. Filter tracks
             // - Remove tracks missing for too long
             // - Only return tracks that have persisted for > FRAME_PERSISTENCE_THRESHOLD (Ghost Hand Fix)
             let validTracks = activeTracks.filter(t => t.missingCount < MAX_MISSING_FRAMES);
             tracksRef.current = validTracks; // Update state

             const finalHands: DetectedHand[] = [];
             
             validTracks.forEach(track => {
                 // Only expose this hand if it has been seen consistently
                 // AND it was actually updated this frame (missingCount === 0)
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

             // 5. Sort for display (Visual Order: Left to Right)
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
      {/* Error Overlay */}
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

      {/* Initial Permission / Loading Overlay */}
      {(!isStreamReady || isLoadingModel) && !errorMessage && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black p-6 animate-fade-in text-center safe-area-inset">
            
            {!userConfirmed ? (
                /* 1. First Step: Custom Permission Primer */
                <>
                    <div className="relative mb-8">
                       <div className="absolute inset-0 bg-yellow-400/20 rounded-full animate-ping blur-xl"></div>
                       <div className="relative bg-gray-900 p-8 rounded-full border border-yellow-400/30 shadow-[0_0_30px_rgba(250,204,21,0.2)]">
                           <Camera className="w-12 h-12 text-yellow-400" />
                       </div>
                    </div>
                    
                    <h2 className="text-2xl font-bold text-white mb-3">
                       카메라 사용 안내
                    </h2>
                    
                    <p className="text-gray-400 text-sm leading-relaxed max-w-xs mx-auto mb-8">
                       게임 진행을 위해 카메라 권한이 필요합니다.<br/>
                       아래 버튼을 누른 후 팝업에서 <span className="text-yellow-400 font-bold">'허용'</span>을 선택해주세요.
                    </p>

                    <button 
                        onClick={() => setUserConfirmed(true)}
                        className="group relative flex items-center justify-center gap-3 px-8 py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-lg rounded-2xl shadow-[0_0_20px_rgba(250,204,21,0.4)] transition-all active:scale-95 w-full max-w-xs"
                    >
                        <Play className="w-5 h-5 fill-black" />
                        시작하기
                    </button>
                </>
            ) : (
                /* 2. Second Step: Loading State (Waiting for System Prompt or Model) */
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
                     <p className="text-gray-500 text-xs">
                        잠시만 기다려주세요
                     </p>
                </>
            )}
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
  // Dynamic scaling based on the smallest screen dimension (Landscape height or Portrait width)
  const minDimension = Math.min(ctx.canvas.width, ctx.canvas.height);
  
  // Box size approx 25% of the smallest screen dimension
  const size = minDimension * 0.25; 
  const strokeWidth = Math.max(2, minDimension * 0.008); // Scale stroke
  const cornerRadius = size * 0.2; // Rounded corners relative to box
  
  ctx.lineWidth = strokeWidth;
  
  // Calculate relative offset for labels
  const labelOffset = size * 0.5 + 20 + (minDimension * 0.02);

  if (state === GameState.SHOW_WINNER && isWinner) {
     if (!hand.isFist) {
        drawWinnerBall(ctx, x, y, minDimension);
     }
  } else if (state === GameState.DETECT_PARTICIPANTS) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      drawLabel(ctx, x, y - labelOffset, `#${sortedIndex + 1}`, COLORS.primary, minDimension);
  } else if (state === GameState.WAIT_FOR_FISTS_READY || state === GameState.WAIT_FOR_FISTS_PRE_DRAW) {
      const color = hand.isFist ? COLORS.success : COLORS.accent;
      ctx.strokeStyle = color;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      if (!hand.isFist) {
        drawLabel(ctx, x, y + labelOffset, "주먹 쥐세요", COLORS.accent, minDimension);
      }
  } else if (state === GameState.SET_WINNER_COUNT) {
      ctx.strokeStyle = COLORS.primary;
      drawRoundedRect(ctx, x - size/2, y - size/2, size, size, cornerRadius);
      drawLabel(ctx, x, y - labelOffset, `${hand.fingerCount}명`, COLORS.primary, minDimension);
  }
}

function drawWinnerBall(ctx: CanvasRenderingContext2D, x: number, y: number, minDimension: number) {
  // Winner ball is roughly 15% radius (30% diameter) of min screen dimension
  const radius = minDimension * 0.15;
  const fontSize = Math.max(16, minDimension * 0.05); // Scale font
  
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
  // Scale font size based on screen
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
  ctx.fillText(text, x, y + 1); // +1 for visual centering
}
