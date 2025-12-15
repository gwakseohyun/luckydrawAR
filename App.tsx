import React, { useState, useEffect, useCallback, useRef } from 'react';
import CameraLayer from './components/CameraLayer';
import GameOverlay from './components/GameOverlay';
import { GameState, DetectedHand } from './types';
import { X, RefreshCw, Info, Image as ImageIcon, ZoomIn } from 'lucide-react';

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
  // Grace period ref to prevent timer flickering when tracking is lost briefly
  const lastValidConditionTimeRef = useRef<number>(0);
  
  // To prevent flickering numbers from resetting the timer instantly
  const candidateWinnerCountRef = useRef<number | null>(null);
  
  // Capture Logic
  const [shouldCapture, setShouldCapture] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [capturedWinnerIds, setCapturedWinnerIds] = useState<Set<number>>(new Set());
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null); // For Lightbox

  // Gesture Tracking Refs
  const handGestureStates = useRef<Map<number, GestureState>>(new Map());
  
  // Safety Refs
  const lastStateChangeTimeRef = useRef<number>(Date.now());
  const participantCountRef = useRef(participantCount);

  useEffect(() => { participantCountRef.current = participantCount; }, [participantCount]);

  // Initialize
  useEffect(() => {
    setGameState(GameState.DETECT_PARTICIPANTS);
  }, []);

  // State Change Handler with Cooldown Tracking
  const changeState = useCallback((newState: GameState) => {
    setGameState(newState);
    lastStateChangeTimeRef.current = Date.now();
    
    // Reset transient logic refs
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
    
    // Transition
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

  // Central Game Loop
  useEffect(() => {
    const now = Date.now();
    const timeSinceStateChange = now - lastStateChangeTimeRef.current;
    
    // CRITICAL FIX: State Entry Cooldown
    // Ignore all logic for the first 1.0 second after a state change.
    // This allows users to read instructions and prevents accidental instant triggers 
    // from previous hand positions.
    if (timeSinceStateChange < 1000) {
       return; 
    }

    // --- Gesture Detection Logic (Global Reset / Confirm) ---
    const isGestureAllowed = !isGalleryOpen && !selectedImage && timer === 0;

    // Only allow gestures for DETECT_PARTICIPANTS (Confirm)
    if (isGestureAllowed && gameState === GameState.DETECT_PARTICIPANTS) {
      detectedHands.forEach((hand, index) => {
        let gState = handGestureStates.current.get(index) || { step: 0, lastTime: now };
        
        // Timeout for gesture steps (1.2s limit between flips)
        if (gState.step > 0 && now - gState.lastTime > 1200) { 
          gState = { step: 0, lastTime: now };
        }

        const facing = hand.facing;
        let nextStep = gState.step;

        // Sequence: Palm -> Back -> Palm -> Back
        if (gState.step === 0) {
          if (facing === 'Palm') nextStep = 1;
        } else if (gState.step === 1) { 
          if (facing === 'Back') nextStep = 2; 
        } else if (gState.step === 2) { 
          if (facing === 'Palm') nextStep = 3;
        } else if (gState.step === 3) { 
          if (facing === 'Back') {
             nextStep = 0; 
             // ACTION TRIGGER
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

    // Stop game logic if gallery is showing
    if (isGalleryOpen || selectedImage) return;

    // --- Helper for Timer Logic with Grace Period ---
    const updateTimerWithGracePeriod = (conditionMet: boolean, requiredTimeMs: number, onSuccess: () => void) => {
       // Update UI Max Timer for consistency
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
          // Condition failed. Check grace period (500ms).
          if (now - lastValidConditionTimeRef.current > 500) {
             // Truly failed
             holdStartTimeRef.current = null;
             setTimer(0);
          } else {
             // Within grace period: Keep timer value frozen, don't reset immediately
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
        // Step 2: Everyone makes a fist
        const fistCount = detectedHands.filter(h => h.isFist).length;
        const total = detectedHands.length;
        const condition = total > 0 && (fistCount / total) >= 0.8;

        // Corrected: Use 3.0 seconds as requested.
        updateTimerWithGracePeriod(condition, 3000, () => {
           changeState(GameState.SET_WINNER_COUNT);
        });
        break;
      }

      case GameState.SET_WINNER_COUNT: {
        // Step 3: Show fingers for count
        const totalFingers = detectedHands.reduce((acc, hand) => acc + hand.fingerCount, 0);
        const maxAllowed = Math.max(1, participantCount - 1);
        const isValidCount = totalFingers >= 1 && totalFingers <= maxAllowed;

        if (totalFingers === 0) setWarningMessage("최소 1명 이상이어야 합니다.");
        else if (totalFingers >= participantCount) setWarningMessage(`참가자 수(${participantCount}명)보다 적어야 합니다.`);
        else setWarningMessage(null);

        const isCountStable = isValidCount && candidateWinnerCountRef.current === totalFingers;

        if (isValidCount && candidateWinnerCountRef.current !== totalFingers) {
           // If number changes, reset instantly (no grace period for changing values)
           candidateWinnerCountRef.current = totalFingers;
           holdStartTimeRef.current = now;
           lastValidConditionTimeRef.current = now;
           setTimer(0);
           setWinnerCount(totalFingers);
        } else {
           // Fix: Use 3.0 seconds here. This is a critical setting that needs stability.
           updateTimerWithGracePeriod(isCountStable, 3000, () => {
              setWinnerCount(totalFingers);
              changeState(GameState.WAIT_FOR_FISTS_PRE_DRAW);
           });
        }
        break;
      }

      case GameState.WAIT_FOR_FISTS_PRE_DRAW: {
        // Step 4: Final Fist before draw
        const fistCount = detectedHands.filter(h => h.isFist).length;
        const total = detectedHands.length;
        const condition = total > 0 && (fistCount / total) >= 0.8;

        // Fix: Use 3.0 seconds here to build suspense and ensure readiness.
        updateTimerWithGracePeriod(condition, 3000, () => {
             changeState(GameState.DRAWING);
             setTimeout(() => {
                performDraw();
             }, 1000);
        });
        break;
      }
      
      case GameState.DRAWING:
        break;

      case GameState.SHOW_WINNER: {
        // Instant Capture Logic
        let newCaptureTriggered = false;
        const newCapturedIds = new Set(capturedWinnerIds);

        winningHandIndices.forEach(winnerIndex => {
           if (winnerIndex < detectedHands.length) {
              const hand = detectedHands[winnerIndex];
              // If winner is Open Hand AND not captured
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
    
    // Shuffle
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
          gameState={gameState} 
          onHandsUpdate={setDetectedHands} 
          winningHandIndices={winningHandIndices}
          triggerCapture={shouldCapture}
          onCaptureComplete={handleCaptureComplete}
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
        />

        {/* Winner Gallery Popup Modal */}
        {isGalleryOpen && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in p-8">
            
            <h2 className="text-4xl font-black text-white mb-6 drop-shadow-lg flex items-center gap-3">
              🎉 당첨 결과 갤러리 🎉
            </h2>

            {/* Gallery Grid */}
            <div className={`w-full max-w-6xl max-h-[70vh] overflow-y-auto grid gap-4 p-4 ${galleryImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3'}`}>
               {galleryImages.map((src, idx) => (
                 <div 
                    key={idx} 
                    className="relative rounded-2xl overflow-hidden shadow-2xl border-2 border-yellow-400 aspect-video group cursor-zoom-in"
                    onClick={() => setSelectedImage(src)}
                 >
                    <img 
                      src={src} 
                      alt={`Winner Moment ${idx + 1}`} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ZoomIn className="text-white w-10 h-10 drop-shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                       <span className="text-white font-bold">순간 포착 #{idx + 1}</span>
                    </div>
                 </div>
               ))}
               
               {galleryImages.length === 0 && (
                  <div className="col-span-full text-white/50 text-center py-20 text-xl">
                     아직 포착된 당첨 순간이 없습니다.
                  </div>
               )}
            </div>
            
            <div className="mt-8 flex flex-col items-center gap-4">
               <div className="flex gap-4">
                 <button 
                   onClick={handleReset}
                   className="flex items-center gap-2 px-8 py-4 bg-yellow-400 hover:bg-yellow-500 text-black text-xl font-bold rounded-full shadow-xl transition-all hover:shadow-2xl active:scale-95"
                 >
                   <RefreshCw className="w-6 h-6" /> 다시 시작하기
                 </button>
                 
                 <button 
                   onClick={() => setIsGalleryOpen(false)}
                   className="flex items-center gap-2 px-6 py-4 bg-white/20 hover:bg-white/30 text-white font-bold rounded-full backdrop-blur-md transition-colors"
                 >
                   <X className="w-6 h-6" /> 닫기
                 </button>
               </div>
            </div>
          </div>
        )}

        {/* Lightbox (Full Screen Image View) */}
        {selectedImage && (
           <div 
             className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
             onClick={() => setSelectedImage(null)}
           >
              <div className="relative max-w-full max-h-full">
                 <img 
                   src={selectedImage} 
                   alt="Full Screen" 
                   className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl border border-gray-800"
                 />
                 <button 
                   className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                   onClick={(e) => {
                      e.stopPropagation();
                      setSelectedImage(null);
                   }}
                 >
                    <X className="w-8 h-8" />
                 </button>
              </div>
           </div>
        )}
        
      </div>
    </div>
  );
};

export default App;