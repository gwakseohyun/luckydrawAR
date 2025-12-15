import React, { useState, useEffect, useCallback, useRef } from 'react';
import CameraLayer from './components/CameraLayer';
import GameOverlay from './components/GameOverlay';
import { GameState, DetectedHand, CameraLayerHandle } from './types';
import { X, RefreshCw, Info, Image as ImageIcon, ZoomIn, Download } from 'lucide-react';

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
  const [winningHandIndices, setWinningHandIndices] = useState<number[]>([]);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  
  // Logic Timers
  const [timer, setTimer] = useState(0); // in seconds
  const [maxTimerDuration, setMaxTimerDuration] = useState(3); // Dynamic max duration for UI
  
  const holdStartTimeRef = useRef<number | null>(null);
  const lastValidConditionTimeRef = useRef<number>(0);
  const candidateWinnerCountRef = useRef<number | null>(null);
  
  // Capture Logic
  const [shouldCapture, setShouldCapture] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [capturedWinnerIds, setCapturedWinnerIds] = useState<Set<number>>(new Set());
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null); 

  // Zoom Logic
  const [zoomCaps, setZoomCaps] = useState<{min: number, max: number, step: number} | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(1);

  // Gesture Tracking Refs
  const handGestureStates = useRef<Map<number, GestureState>>(new Map());
  
  const lastStateChangeTimeRef = useRef<number>(Date.now());
  const participantCountRef = useRef(participantCount);
  
  // Camera Ref
  const cameraLayerRef = useRef<CameraLayerHandle>(null);

  useEffect(() => { participantCountRef.current = participantCount; }, [participantCount]);

  useEffect(() => {
    setGameState(GameState.DETECT_PARTICIPANTS);
  }, []);

  const changeState = useCallback((newState: GameState) => {
    setGameState(newState);
    lastStateChangeTimeRef.current = Date.now();
    
    holdStartTimeRef.current = null;
    candidateWinnerCountRef.current = null;
    lastValidConditionTimeRef.current = 0;
    setTimer(0);
    setWarningMessage(null);
  }, []);

  const handleReset = useCallback(() => {
    changeState(GameState.DETECT_PARTICIPANTS);
    setParticipantCount(0);
    setWinnerCount(1);
    setWinningHandIndices([]);
    setGalleryImages([]);
    setCapturedWinnerIds(new Set());
    setIsGalleryOpen(false);
    setSelectedImage(null);
    setShouldCapture(false);
    handGestureStates.current.clear();
  }, [changeState]);

  const handleConfirmParticipants = useCallback(() => {
    if (participantCountRef.current < 2) return;
    setGameState(prev => {
      if (prev === GameState.DETECT_PARTICIPANTS) {
        lastStateChangeTimeRef.current = Date.now();
        return GameState.WAIT_FOR_FISTS_READY;
      }
      return prev;
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

  const handleZoomChange = (val: number) => {
    setCurrentZoom(val);
    if (cameraLayerRef.current) {
        cameraLayerRef.current.setZoom(val);
    }
  };

  // Central Game Loop
  useEffect(() => {
    const now = Date.now();
    const timeSinceStateChange = now - lastStateChangeTimeRef.current;
    
    if (timeSinceStateChange < 1000) {
       return; 
    }

    const isGestureAllowed = !isGalleryOpen && !selectedImage && timer === 0;

    if (isGestureAllowed && gameState === GameState.DETECT_PARTICIPANTS) {
      detectedHands.forEach((hand, index) => {
        let gState = handGestureStates.current.get(index) || { step: 0, lastTime: now };
        
        if (gState.step > 0 && now - gState.lastTime > 1200) { 
          gState = { step: 0, lastTime: now };
        }

        const facing = hand.facing;
        let nextStep = gState.step;

        if (gState.step === 0) {
          if (facing === 'Palm') nextStep = 1;
        } else if (gState.step === 1) { 
          if (facing === 'Back') nextStep = 2; 
        } else if (gState.step === 2) { 
          if (facing === 'Palm') nextStep = 3;
        } else if (gState.step === 3) { 
          if (facing === 'Back') {
             nextStep = 0; 
             if (gameState === GameState.DETECT_PARTICIPANTS) {
                if (detectedHands.length >= 2) handleConfirmParticipants();
             }
          }
        }

        if (nextStep !== gState.step) {
          handGestureStates.current.set(index, { step: nextStep, lastTime: now });
        } else {
           handGestureStates.current.set(index, gState);
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
          if (now - lastValidConditionTimeRef.current > 500) {
             holdStartTimeRef.current = null;
             setTimer(0);
          }
       }
    };

    if (detectedHands.length === 0) {
      if (gameState === GameState.DETECT_PARTICIPANTS) {
        setParticipantCount(0);
      }
      if (gameState === GameState.WAIT_FOR_FISTS_READY || gameState === GameState.WAIT_FOR_FISTS_PRE_DRAW) {
         setWarningMessage(`참가자 ${participantCount}명이 모두 보여야 합니다.`);
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
        
        // Check 1: Are all participants on screen?
        const isAllParticipantsVisible = total >= participantCount;
        
        // Check 2: Are all of them making a fist?
        const isAllFists = fistCount >= participantCount;
        
        const condition = isAllParticipantsVisible && isAllFists;

        if (!isAllParticipantsVisible) {
           setWarningMessage(`참가자 ${participantCount}명이 모두 보여야 합니다.`);
        } else if (!isAllFists) {
           setWarningMessage("모두 주먹을 쥐어주세요.");
        } else {
           setWarningMessage(null);
        }

        updateTimerWithGracePeriod(condition, 3000, () => {
           changeState(GameState.SET_WINNER_COUNT);
        });
        break;
      }

      case GameState.SET_WINNER_COUNT: {
        const totalFingers = detectedHands.reduce((acc, hand) => acc + hand.fingerCount, 0);
        const maxAllowed = Math.max(1, participantCount - 1);
        const isValidCount = totalFingers >= 1 && totalFingers <= maxAllowed;

        if (totalFingers === 0) setWarningMessage("최소 1명 이상이어야 합니다.");
        else if (totalFingers >= participantCount) setWarningMessage(`참가자 수(${participantCount}명)보다 적어야 합니다.`);
        else setWarningMessage(null);

        const isCountStable = isValidCount && candidateWinnerCountRef.current === totalFingers;

        if (isValidCount && candidateWinnerCountRef.current !== totalFingers) {
           candidateWinnerCountRef.current = totalFingers;
           holdStartTimeRef.current = now;
           lastValidConditionTimeRef.current = now;
           setTimer(0);
           setWinnerCount(totalFingers);
        } else {
           updateTimerWithGracePeriod(isCountStable, 3000, () => {
              setWinnerCount(totalFingers);
              changeState(GameState.WAIT_FOR_FISTS_PRE_DRAW);
           });
        }
        break;
      }

      case GameState.WAIT_FOR_FISTS_PRE_DRAW: {
        const fistCount = detectedHands.filter(h => h.isFist).length;
        const total = detectedHands.length;
        
        const isAllParticipantsVisible = total >= participantCount;
        const isAllFists = fistCount >= participantCount;
        
        const condition = isAllParticipantsVisible && isAllFists;

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
        let newCaptureTriggered = false;
        const newCapturedIds = new Set(capturedWinnerIds);

        winningHandIndices.forEach(winnerIndex => {
           if (winnerIndex < detectedHands.length) {
              const hand = detectedHands[winnerIndex];
              if (!hand.isFist && !capturedWinnerIds.has(winnerIndex)) {
                 newCapturedIds.add(winnerIndex);
                 newCaptureTriggered = true;
              }
           }
        });

        if (newCaptureTriggered) {
           setCapturedWinnerIds(newCapturedIds);
           setShouldCapture(true);
        }
        break;
      }
    }
  }, [detectedHands, gameState, winnerCount, participantCount, handleConfirmParticipants, handleReset, changeState, isGalleryOpen, winningHandIndices, capturedWinnerIds, timer, selectedImage, maxTimerDuration]);

  const performDraw = () => {
    const currentHandCount = detectedHands.length;
    const poolSize = currentHandCount > 0 ? currentHandCount : participantCount;
    const countToSelect = Math.min(winnerCount, poolSize);
    
    const indices = Array.from({ length: poolSize }, (_, i) => i);
    
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    const winners = indices.slice(0, countToSelect);
    setWinningHandIndices(winners);
    changeState(GameState.SHOW_WINNER);
  };

  return (
    <div className="w-screen h-screen bg-gray-100 flex items-center justify-center relative">
      <div className="relative w-full h-full max-w-[1920px] max-h-[1080px] bg-black shadow-2xl overflow-hidden">
        
        <CameraLayer 
          ref={cameraLayerRef}
          gameState={gameState} 
          onHandsUpdate={setDetectedHands} 
          winningHandIndices={winningHandIndices}
          triggerCapture={shouldCapture}
          onCaptureComplete={handleCaptureComplete}
          onZoomInit={handleZoomInit}
        />
        
        <GameOverlay 
          gameState={gameState}
          participantCount={participantCount}
          winnerCount={winnerCount}
          timer={timer}
          maxDuration={maxTimerDuration} 
          onReset={handleReset}
          onConfirmParticipants={handleConfirmParticipants}
          warningMessage={warningMessage}
          onOpenGallery={() => setIsGalleryOpen(true)}
          galleryCount={galleryImages.length}
          onToggleCamera={handleToggleCamera}
          zoomCapabilities={zoomCaps}
          currentZoom={currentZoom}
          onZoomChange={handleZoomChange}
        />

        {isGalleryOpen && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/95 animate-fade-in p-6">
            <div className={`w-full max-w-4xl max-h-[70vh] overflow-y-auto grid gap-1 p-0 ${galleryImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3'}`}>
               {galleryImages.map((src, idx) => (
                 <div 
                    key={idx} 
                    className="relative aspect-video group cursor-pointer"
                    onClick={() => setSelectedImage(src)}
                 >
                    <img 
                      src={src} 
                      alt={`Winner Moment ${idx + 1}`} 
                      className="w-full h-full object-cover transition-opacity hover:opacity-90" 
                    />
                    <div className="absolute bottom-2 right-2 bg-black/50 px-2 py-0.5 text-white text-xs font-mono">
                       #{idx + 1}
                    </div>
                 </div>
               ))}
               {galleryImages.length === 0 && (
                  <div className="col-span-full text-white/50 text-center py-20 text-lg">
                     아직 포착된 당첨 순간이 없습니다.
                  </div>
               )}
            </div>
            <div className="mt-8 w-full max-w-xs flex flex-col gap-3">
                 <button 
                   onClick={handleReset}
                   className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-black text-lg font-bold rounded-xl shadow-lg active:scale-95 whitespace-nowrap"
                 >
                   <RefreshCw className="w-5 h-5" /> 다시 시작하기
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
             className="absolute inset-0 z-50 bg-black flex items-center justify-center animate-fade-in"
             onClick={() => setSelectedImage(null)}
           >
              <div className="relative w-full h-full flex items-center justify-center p-4">
                 <img 
                   src={selectedImage} 
                   alt="Full Screen" 
                   className="max-w-full max-h-full object-contain"
                 />
                 <div className="absolute top-4 right-4 flex gap-3">
                     <button 
                       className="bg-black/50 text-white p-3 rounded-full hover:bg-black/70 transition-colors backdrop-blur-md"
                       onClick={(e) => {
                          e.stopPropagation();
                          const idx = galleryImages.indexOf(selectedImage);
                          downloadImage(selectedImage, idx !== -1 ? idx : 0);
                       }}
                     >
                        <Download className="w-6 h-6" />
                     </button>
                     <button 
                       className="bg-black/50 text-white p-3 rounded-full hover:bg-black/70 transition-colors backdrop-blur-md"
                       onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImage(null);
                       }}
                     >
                        <X className="w-6 h-6" />
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
