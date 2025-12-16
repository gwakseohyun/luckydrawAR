import React, { useState, useEffect, useCallback, useRef } from 'react';
import CameraLayer from './components/CameraLayer';
import GameOverlay from './components/GameOverlay';
import { GameState, DetectedHand, CameraLayerHandle } from './types';
import { X, RefreshCw, ZoomIn, Download, Maximize2 } from 'lucide-react';

// Gesture Steps: 0 (Idle) -> 1 (Palm) -> 2 (Back) -> 3 (Palm) -> 4 (Back/Trigger)
interface GestureState {
  step: number;
  lastTime: number;
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.IDLE);
  const [participantCount, setParticipantCount] = useState(0);
  const [winnerCount, setWinnerCount] = useState(1);
  const [detectedHands, setDetectedHands] = useState<DetectedHand[]>([]);
  const [winningStableIds, setWinningStableIds] = useState<number[]>([]);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  
  // Logic Timers
  const [timer, setTimer] = useState(0); // in seconds
  const [maxTimerDuration, setMaxTimerDuration] = useState(3);
  
  const holdStartTimeRef = useRef<number | null>(null);
  const lastValidConditionTimeRef = useRef<number>(0);
  
  // Capture Logic
  const [shouldCapture, setShouldCapture] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [capturedWinnerIds, setCapturedWinnerIds] = useState<Set<number>>(new Set());
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null); 
  const captureTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Zoom Logic
  const [zoomCaps, setZoomCaps] = useState<{min: number, max: number, step: number} | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(1);

  // Gesture Tracking Refs
  const handGestureStates = useRef<Map<number, GestureState>>(new Map());
  const handFacingHistory = useRef<Map<number, { facing: 'Palm' | 'Back', since: number }>>(new Map());
  const lastStateChangeTimeRef = useRef<number>(Date.now());
  const participantCountRef = useRef(participantCount);
  
  // Camera Ref
  const cameraLayerRef = useRef<CameraLayerHandle>(null);

  useEffect(() => { participantCountRef.current = participantCount; }, [participantCount]);

  const changeState = useCallback((newState: GameState) => {
    setGameState(newState);
    lastStateChangeTimeRef.current = Date.now();
    
    holdStartTimeRef.current = null;
    lastValidConditionTimeRef.current = 0;
    setTimer(0);
    setWarningMessage(null);
  }, []);

  const handleStreamReady = useCallback(() => {
    setGameState(prev => {
        // Transition to SETUP only if we are currently in IDLE (waiting for permissions)
        if (prev === GameState.IDLE) {
            return GameState.SETUP;
        }
        return prev;
    });
  }, []);

  const handleReset = useCallback(() => {
    // Reset goes back to SETUP to allow changing winner count
    changeState(GameState.SETUP);
    setParticipantCount(0);
    // Don't reset winnerCount here, keep the user's preference
    setWinningStableIds([]);
    setGalleryImages([]);
    setCapturedWinnerIds(new Set());
    setIsGalleryOpen(false);
    setSelectedImage(null);
    setShouldCapture(false);
    handGestureStates.current.clear();
    handFacingHistory.current.clear();
    captureTimeoutsRef.current.forEach(t => clearTimeout(t));
    captureTimeoutsRef.current.clear();
  }, [changeState]);

  const handleStartDetection = useCallback(() => {
     changeState(GameState.DETECT_PARTICIPANTS);
  }, [changeState]);

  const handleConfirmParticipants = useCallback(() => {
    // Ensure participants > winnerCount
    if (participantCountRef.current <= winnerCount) {
        setWarningMessage(`참가자는 ${winnerCount + 1}명 이상이어야 합니다.`);
        return;
    }

    setGameState(prev => {
      if (prev === GameState.DETECT_PARTICIPANTS) {
        lastStateChangeTimeRef.current = Date.now();
        return GameState.WAIT_FOR_FISTS_READY;
      }
      return prev;
    });
  }, [winnerCount]);

  const updateWinnerCount = useCallback((delta: number) => {
    setWinnerCount(prev => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (next > 20) return 20; // Cap at 20 or reasonable max
      return next;
    });
  }, []);

  const handleCaptureComplete = useCallback((images: string[]) => {
    if (images.length > 0) {
       setGalleryImages(prev => [...prev, ...images]);
    }
    setShouldCapture(false);
  }, []);

  const downloadImage = (src: string, index: number) => {
    try {
      const link = document.createElement('a');
      link.href = src;
      link.download = `lucky-draw-winner-${index + 1}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Download failed", e);
    }
  };

  const handleToggleCamera = useCallback(() => {
    if (cameraLayerRef.current) {
       cameraLayerRef.current.toggleCamera();
    }
  }, []);

  const handleZoomInit = useCallback((min: number, max: number, step: number, current: number) => {
    setZoomCaps({min, max, step});
    setCurrentZoom(current);
  }, []);

  const handleZoomChange = useCallback((val: number) => {
    setCurrentZoom(val);
    if (cameraLayerRef.current) {
        cameraLayerRef.current.setZoom(val);
    }
  }, []);

  // Central Game Loop
  useEffect(() => {
    const now = Date.now();
    const timeSinceStateChange = now - lastStateChangeTimeRef.current;
    
    if (timeSinceStateChange < 300) {
       return; 
    }

    const isGestureAllowed = !isGalleryOpen && !selectedImage && timer === 0;

    // Gesture control for Confirm
    if (isGestureAllowed && gameState === GameState.DETECT_PARTICIPANTS) {
      // 1. Cleanup Stale Histories
      const currentStableIds = new Set(detectedHands.map(h => h.stableId));
      for (const id of handFacingHistory.current.keys()) {
          if (!currentStableIds.has(id)) {
              handFacingHistory.current.delete(id);
              handGestureStates.current.delete(id);
          }
      }

      detectedHands.forEach((hand) => {
        // --- STABILITY CHECK ---
        // Prevents noise from rapidly toggling states.
        // We only trust the 'facing' if it has been consistent for STABILITY_THRESHOLD ms.
        let history = handFacingHistory.current.get(hand.stableId);
        
        if (!history || history.facing !== hand.facing) {
            // State changed or new hand, reset timer
            handFacingHistory.current.set(hand.stableId, { facing: hand.facing, since: now });
            return; // Wait for stability
        }

        const STABILITY_THRESHOLD = 150; // ms
        if (now - history.since < STABILITY_THRESHOLD) {
            return; // Not stable enough yet
        }

        // --- GESTURE LOGIC ---
        // Only use the stable facing value
        const stableFacing = history.facing;
        let gState = handGestureStates.current.get(hand.stableId) || { step: 0, lastTime: now };
        
        // Timeout for gesture sequence (2000ms)
        if (gState.step > 0 && now - gState.lastTime > 2000) { 
          gState = { step: 0, lastTime: now };
        }

        let nextStep = gState.step;

        if (gState.step === 0) {
          if (stableFacing === 'Palm') nextStep = 1;
        } else if (gState.step === 1) { 
          if (stableFacing === 'Back') nextStep = 2; 
        } else if (gState.step === 2) { 
          if (stableFacing === 'Palm') nextStep = 3;
        } else if (gState.step === 3) { 
          if (stableFacing === 'Back') {
             nextStep = 0; 
             // Trigger action
             if (gameState === GameState.DETECT_PARTICIPANTS) {
                if (detectedHands.length > winnerCount) handleConfirmParticipants();
             }
          }
        }

        if (nextStep !== gState.step) {
          handGestureStates.current.set(hand.stableId, { step: nextStep, lastTime: now });
        }
      });
    }

    if (isGalleryOpen || selectedImage) return;

    const updateTimerWithGracePeriod = (conditionMet: boolean, requiredTimeMs: number, onSuccess: () => void) => {
       if (maxTimerDuration !== requiredTimeMs / 1000) {
          setMaxTimerDuration(requiredTimeMs / 1000);
       }

       if (conditionMet) {
          lastValidConditionTimeRef.current = now;
          if (!holdStartTimeRef.current) holdStartTimeRef.current = now;
          
          const elapsed = now - holdStartTimeRef.current;
          setTimer(elapsed / 1000);

          if (elapsed > requiredTimeMs) {
             onSuccess();
          }
       } else {
          // Grace period of 1000ms
          if (now - lastValidConditionTimeRef.current > 1000) {
             holdStartTimeRef.current = null;
             setTimer(0);
          }
       }
    };

    if (detectedHands.length === 0) {
      if (gameState === GameState.DETECT_PARTICIPANTS) {
        setParticipantCount(0);
      }
    }

    switch (gameState) {
      case GameState.DETECT_PARTICIPANTS:
        if (detectedHands.length > 0) {
           setParticipantCount(detectedHands.length);
        }
        break;

      case GameState.WAIT_FOR_FISTS_READY: {
        const fistCount = detectedHands.filter(h => h.isFist).length;
        const total = detectedHands.length;
        const isAllParticipantsVisible = total >= participantCount;
        const isAllFists = fistCount >= participantCount;
        
        const condition = isAllFists && (total >= participantCount);

        if (!isAllParticipantsVisible) {
           setWarningMessage(`참가자 ${participantCount}명이 모두 보여야 합니다.`);
        } else if (!isAllFists) {
           setWarningMessage("모두 주먹을 쥐어주세요.");
        } else {
           setWarningMessage(null);
        }

        updateTimerWithGracePeriod(condition, 3000, () => {
             changeState(GameState.DRAWING);
             performDraw();
        });
        break;
      }
      
      case GameState.DRAWING:
        break;

      case GameState.SHOW_WINNER: {
        detectedHands.forEach(hand => {
           if (winningStableIds.includes(hand.stableId)) {
               const id = hand.stableId;
               if (!hand.isFist && !capturedWinnerIds.has(id)) {
                  if (!captureTimeoutsRef.current.has(id)) {
                      const timeout = setTimeout(() => {
                          setCapturedWinnerIds(prev => {
                              const next = new Set(prev);
                              next.add(id);
                              return next;
                          });
                          setShouldCapture(true);
                          captureTimeoutsRef.current.delete(id);
                      }, 500); 
                      captureTimeoutsRef.current.set(id, timeout);
                  }
               } 
               else if (hand.isFist) {
                   if (captureTimeoutsRef.current.has(id)) {
                       clearTimeout(captureTimeoutsRef.current.get(id));
                       captureTimeoutsRef.current.delete(id);
                   }
               }
           }
        });
        break;
      }
    }
  }, [detectedHands, gameState, winnerCount, participantCount, handleConfirmParticipants, handleReset, changeState, isGalleryOpen, winningStableIds, capturedWinnerIds, timer, selectedImage, maxTimerDuration]);

  const performDraw = () => {
    const currentHandCount = detectedHands.length;
    const poolSize = currentHandCount > 0 ? currentHandCount : participantCount;
    const countToSelect = Math.min(winnerCount, poolSize);
    
    const indices = Array.from({ length: poolSize }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    const winningIndices = indices.slice(0, countToSelect);
    
    const winningIds = winningIndices.map(idx => {
       if (detectedHands[idx]) return detectedHands[idx].stableId;
       return -1;
    }).filter(id => id !== -1);
    
    setWinningStableIds(winningIds);
    changeState(GameState.SHOW_WINNER);
  };

  return (
    <div className="fixed inset-0 w-full h-full bg-gray-100 flex items-center justify-center overflow-hidden">
      <div className="relative w-full h-full max-w-[1920px] max-h-[1080px] bg-black shadow-2xl overflow-hidden">
        
        <CameraLayer 
          ref={cameraLayerRef}
          gameState={gameState} 
          onHandsUpdate={setDetectedHands} 
          winningStableIds={winningStableIds}
          triggerCapture={shouldCapture}
          onCaptureComplete={handleCaptureComplete}
          onZoomInit={handleZoomInit}
          onStreamReady={handleStreamReady}
        />
        
        <GameOverlay 
          gameState={gameState}
          participantCount={participantCount}
          winnerCount={winnerCount}
          timer={timer}
          maxDuration={maxTimerDuration} 
          onReset={handleReset}
          onStartDetection={handleStartDetection}
          onConfirmParticipants={handleConfirmParticipants}
          warningMessage={warningMessage}
          onOpenGallery={() => setIsGalleryOpen(true)}
          galleryCount={galleryImages.length}
          onToggleCamera={handleToggleCamera}
          zoomCapabilities={zoomCaps}
          currentZoom={currentZoom}
          onZoomChange={handleZoomChange}
          onUpdateWinnerCount={updateWinnerCount}
        />

        {isGalleryOpen && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/95 animate-fade-in p-6 safe-area-inset">
            <div className={`w-full max-w-4xl max-h-[70vh] overflow-y-auto grid gap-3 p-1 ${galleryImages.length === 1 ? 'grid-cols-1 max-w-sm' : 'grid-cols-2 md:grid-cols-3'}`}>
               {galleryImages.map((src, idx) => (
                 <div 
                    key={idx} 
                    className="relative cursor-pointer group rounded-xl overflow-hidden border border-white/10 bg-gray-900 shadow-xl"
                    onClick={() => setSelectedImage(src)}
                 >
                    <img 
                      src={src} 
                      alt={`Winner Moment ${idx + 1}`} 
                      className="w-full h-auto object-contain" 
                    />
                    
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-8 flex items-end justify-between opacity-100">
                       <div className="flex items-center gap-1.5 text-white/90">
                          <Maximize2 className="w-3.5 h-3.5" />
                          <span className="text-[11px] font-medium tracking-tight">크게 보기 / 저장</span>
                       </div>
                       <span className="text-white/40 text-[10px] font-mono border border-white/10 px-1.5 rounded">
                          #{idx + 1}
                       </span>
                    </div>
                 </div>
               ))}
               {galleryImages.length === 0 && (
                  <div className="col-span-full text-white/50 text-center py-20 text-lg">
                     아직 포착된 당첨 순간이 없습니다.
                  </div>
               )}
            </div>
            <div className="mt-6 w-full max-w-xs flex flex-col gap-3">
                 <button 
                   onClick={handleReset}
                   className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-black text-lg font-bold rounded-xl shadow-lg active:scale-95 whitespace-nowrap"
                 >
                   <RefreshCw className="w-5 h-5" /> 처음으로
                 </button>
                 <button 
                   onClick={() => setIsGalleryOpen(false)}
                   className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white/20 hover:bg-white/30 text-white font-bold rounded-xl backdrop-blur-md transition-colors whitespace-nowrap"
                 >
                   <X className="w-5 h-5" /> 닫기
                 </button>
            </div>
          </div>
        )}

        {selectedImage && (
           <div 
             className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center animate-fade-in safe-area-inset"
             onClick={() => setSelectedImage(null)}
           >
              <div className="relative w-full h-full flex items-center justify-center p-4">
                 <img 
                   src={selectedImage} 
                   alt="Full Screen" 
                   className="max-w-full max-h-full object-contain shadow-2xl"
                 />
                 <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 w-full max-w-md justify-center px-4">
                     <button 
                       className="flex-1 bg-white text-black h-14 rounded-full hover:bg-gray-200 transition-all font-bold flex items-center justify-center gap-2 shadow-lg active:scale-95 whitespace-nowrap min-w-[120px]"
                       onClick={(e) => {
                          e.stopPropagation();
                          const idx = galleryImages.indexOf(selectedImage);
                          downloadImage(selectedImage, idx !== -1 ? idx : 0);
                       }}
                     >
                        <Download className="w-5 h-5" /> 저장하기
                     </button>
                     <button 
                       className="flex-1 bg-white/20 text-white h-14 rounded-full hover:bg-white/30 transition-all backdrop-blur-md font-bold flex items-center justify-center gap-2 min-w-[100px]"
                       onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImage(null);
                       }}
                     >
                        <X className="w-5 h-5" /> 닫기
                     </button>
                 </div>
              </div>
           </div>
        )}
      </div>
    </div>
  );
};

export default App;
