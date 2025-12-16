import React, { useState, memo } from 'react';
import { GameState } from '../types';
import { INSTRUCTIONS, COLORS } from '../constants';
import { RefreshCw, Info, AlertTriangle, Image as ImageIcon, SwitchCamera, ChevronDown, ChevronUp, ZoomIn, ZoomOut, Play, Minus, Plus } from 'lucide-react';

interface GameOverlayProps {
  gameState: GameState;
  participantCount: number;
  winnerCount: number;
  timer: number;
  maxDuration?: number; 
  onReset: () => void;
  onStartDetection?: () => void;
  onConfirmParticipants: () => void;
  warningMessage?: string | null;
  onOpenGallery?: () => void;
  galleryCount?: number;
  onToggleCamera?: () => void;
  zoomCapabilities?: { min: number, max: number, step: number } | null;
  currentZoom?: number;
  onZoomChange?: (value: number) => void;
  onUpdateWinnerCount?: (delta: number) => void;
}

// Custom Icon for Hand Gesture (Clean Outline)
const HandGestureIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2C12.55 2 13 2.45 13 3V12H14V5C14 4.45 14.45 4 15 4C15.55 4 16 4.45 16 5V12H17V7C17 6.45 17.45 6 18 6C18.55 6 19 6.45 19 7V15C19 18.87 15.87 22 12 22C8.13 22 5 18.87 5 15V9C5 8.45 5.45 8 6 8C6.55 8 7 8.45 7 9V16H8V3C8 2.45 8.45 2 9 2C9.55 2 10 2.45 10 3V12H11V3C11 2.45 11.45 2 12 2Z" />
  </svg>
);

const GameOverlay: React.FC<GameOverlayProps> = memo(({
  gameState,
  participantCount,
  winnerCount,
  timer,
  maxDuration = 3, 
  onReset,
  onStartDetection,
  onConfirmParticipants,
  warningMessage,
  onOpenGallery,
  galleryCount = 0,
  onToggleCamera,
  zoomCapabilities,
  currentZoom = 1,
  onZoomChange,
  onUpdateWinnerCount
}) => {
  const [isInstructionExpanded, setIsInstructionExpanded] = useState(true);

  const isHolding = gameState === GameState.WAIT_FOR_FISTS_READY;
  const isDetecting = gameState === GameState.DETECT_PARTICIPANTS;
  const isSetup = gameState === GameState.SETUP;

  const CIRCUMFERENCE = 377;
  const progress = Math.min(timer / maxDuration, 1);
  const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress);
  const displayTime = Math.ceil(maxDuration - timer);
  
  const canStart = participantCount > winnerCount;

  // Setup Screen Overlay
  if (isSetup) {
      return (
        <div className="absolute inset-0 z-50 flex items-center justify-center safe-area-inset bg-black/60 backdrop-blur-md animate-fade-in">
           <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-3xl p-8 flex flex-col items-center gap-8 shadow-2xl">
               <div className="text-center">
                   <h1 className="text-3xl font-black text-yellow-400 mb-2">LUCKY DRAW AR</h1>
                   <p className="text-gray-400 text-sm">이번 게임의 당첨 인원을 설정해주세요.</p>
               </div>

               <div className="flex flex-col items-center gap-3 w-full">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">WINNERS</span>
                    <div className="flex items-center justify-between w-full px-8">
                       <button 
                          onClick={() => onUpdateWinnerCount && onUpdateWinnerCount(-1)}
                          className="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-95"
                       >
                          <Minus className="w-8 h-8" />
                       </button>
                       <span className="text-6xl font-black text-white tabular-nums tracking-tighter">
                          {winnerCount}
                       </span>
                       <button 
                          onClick={() => onUpdateWinnerCount && onUpdateWinnerCount(1)}
                          className="w-16 h-16 rounded-full bg-yellow-400 hover:bg-yellow-300 text-black flex items-center justify-center shadow-[0_0_20px_rgba(250,204,21,0.4)] transition-all active:scale-95"
                       >
                          <Plus className="w-8 h-8" />
                       </button>
                    </div>
               </div>

               <button 
                   onClick={onStartDetection}
                   className="w-full py-4 bg-white text-black font-bold text-lg rounded-xl hover:bg-gray-100 active:scale-95 transition-all flex items-center justify-center gap-2 mt-4"
               >
                   <Play className="w-5 h-5 fill-black" /> 게임 시작
               </button>
           </div>
        </div>
      );
  }

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-10 safe-area-inset">
      
      {/* Top Section */}
      <div className="w-full flex justify-between items-start p-4 pt-6 relative shrink-0">
         <div className="flex-1 flex justify-center pt-2">
            {warningMessage ? (
               <div className="animate-bounce-short bg-red-500/90 text-white px-4 py-1.5 rounded-full shadow-lg backdrop-blur flex items-center gap-2">
                   <AlertTriangle className="w-4 h-4" />
                   <span className="text-xs font-bold">{warningMessage}</span>
               </div>
            ) : (
                <>
                   {isDetecting && !canStart && (
                       <div className="bg-red-500/80 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg backdrop-blur">
                          최소 {winnerCount + 1}명이 필요합니다
                       </div>
                   )}
                   {isDetecting && canStart && (
                       <div className="bg-yellow-400 text-black px-5 py-2.5 rounded-full text-sm font-bold shadow-[0_0_20px_rgba(250,204,21,0.6)] flex items-center gap-3 animate-pulse border-2 border-white/20">
                          <HandGestureIcon className="w-5 h-5" />
                          <span>손바닥을 2번 뒤집어 시작하기</span>
                       </div>
                   )}
                   {gameState === GameState.SHOW_WINNER && (
                       <div className="bg-blue-600/80 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg backdrop-blur animate-pulse border border-white/20">
                          손을 활짝 펼쳐 당첨 여부를 확인하세요!
                       </div>
                   )}
                </>
            )}
         </div>

         <div className="absolute top-4 right-4 pointer-events-auto">
            {onToggleCamera && (
                <button 
                  onClick={onToggleCamera}
                  className="relative w-12 h-12 bg-black/40 hover:bg-white/20 backdrop-blur-md rounded-full text-white border border-white/10 transition-all active:scale-95 shadow-lg flex items-center justify-center"
                  aria-label="카메라 전환"
                >
                  <SwitchCamera className="w-6 h-6" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                     <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                  </div>
                </button>
            )}
         </div>
      </div>

      {/* Center Feedback (Responsive Centering) */}
      <div className="flex-1 flex flex-col items-center justify-center pointer-events-none relative w-full pb-32">
        
        {isDetecting && (
          <div className="flex flex-col items-center gap-6">
             <div className="flex flex-col items-center gap-2">
                <span className="text-8xl font-black text-yellow-400 drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] tracking-tighter leading-none">
                  {participantCount}명
                </span>
                <span className="text-2xl text-white font-bold drop-shadow-md mt-2">감지됨</span>
             </div>

             {/* Winner Count Display Only */}
             <div className="bg-black/40 backdrop-blur-md rounded-full px-5 py-2 border border-white/10 shadow-lg flex items-center gap-2">
                <span className="text-xs text-white/60 font-bold uppercase">당첨 인원</span>
                <span className="text-lg font-black text-white">{winnerCount}명</span>
             </div>
          </div>
        )}

        {isHolding && timer > 0 && (
           <div className="flex items-center justify-center">
             <div className="relative flex items-center justify-center w-40 h-40">
               <svg className="absolute w-full h-full transform -rotate-90" viewBox="0 0 140 140">
                 <circle cx="70" cy="70" r="60" fill="transparent" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
                 <circle 
                    cx="70" cy="70" r="60" 
                    fill="transparent" 
                    stroke={COLORS.primary} 
                    strokeWidth="8" 
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={strokeDashoffset}
                    className="transition-[stroke-dashoffset] duration-200 linear"
                    strokeLinecap="round"
                 />
               </svg>
               <span className="text-7xl font-black text-white drop-shadow-lg z-10">
                 {displayTime}
               </span>
             </div>
           </div>
        )}
      </div>

      {/* Bottom Bar (Docked Bottom Sheet) */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-auto shrink-0">
        <div className={`
            bg-gray-900/90 backdrop-blur-xl border-t border-white/10 
            rounded-t-2xl transition-all duration-300 ease-spring shadow-[0_-10px_40px_rgba(0,0,0,0.5)]
            ${isInstructionExpanded ? 'pb-[calc(env(safe-area-inset-bottom)+1.5rem)]' : 'pb-[env(safe-area-inset-bottom)]'}
        `}>
          {/* Toggle Header */}
          <div 
             className="flex justify-between items-center px-6 py-3 cursor-pointer h-12"
             onClick={() => setIsInstructionExpanded(!isInstructionExpanded)}
          >
             <div className="flex items-center gap-2 text-white">
                <Info className="w-4 h-4 text-yellow-400" />
                <span className="font-bold text-sm">
                   진행 안내
                </span>
             </div>
             <button className="text-white/50 hover:text-white p-1">
                {isInstructionExpanded ? <ChevronDown className="w-5 h-5"/> : <ChevronUp className="w-5 h-5"/>}
             </button>
          </div>

          {/* Content */}
          {isInstructionExpanded && (
             <div className="px-5 pb-2 animate-fade-in">
                <div className="mb-6 leading-relaxed text-center font-medium text-gray-200">
                   {isDetecting ? (
                       <div className="flex flex-col gap-2 items-center">
                         <div className="flex items-center gap-2 text-yellow-400 mb-1">
                             <HandGestureIcon className="w-6 h-6" />
                             <span className="font-bold text-lg">시작 제스처</span>
                         </div>
                         <p className="text-lg text-white/90">
                            시작하려면 대표 1명이 손바닥을 <br/>
                            <span className="text-yellow-400 font-bold underline underline-offset-4">빠르게 2번</span> 뒤집어주세요
                         </p>
                       </div>
                   ) : (
                       <p className="text-lg">{INSTRUCTIONS[gameState]}</p>
                   )}
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
                    <div className="w-full">
                        {isDetecting ? (
                           <>
                             {zoomCapabilities ? (
                                <div className="w-full bg-white/5 border border-white/5 rounded-2xl h-[56px] px-4 flex items-center gap-3">
                                   <ZoomOut className="w-5 h-5 text-white/50" />
                                   <div className="flex-1 relative h-6 flex items-center">
                                       <div className="absolute inset-0 flex justify-between items-center px-1 pointer-events-none opacity-20">
                                           {Array.from({length: 11}).map((_, i) => (
                                               <div key={i} className={`w-[1px] bg-white ${i % 5 === 0 ? 'h-3' : 'h-1.5'}`}></div>
                                           ))}
                                       </div>
                                       <input 
                                          type="range" 
                                          min={zoomCapabilities.min} 
                                          max={zoomCapabilities.max} 
                                          step={zoomCapabilities.step} 
                                          value={currentZoom}
                                          onChange={(e) => onZoomChange && onZoomChange(parseFloat(e.target.value))}
                                          className="w-full h-full opacity-0 absolute z-20 cursor-pointer"
                                       />
                                       <div className="w-full h-0.5 bg-white/20 rounded-full relative z-10 overflow-visible">
                                           <div 
                                              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-yellow-400 rounded-full shadow-[0_0_10px_rgba(250,204,21,0.5)] transition-all flex items-center justify-center"
                                              style={{ 
                                                  left: `${((currentZoom - zoomCapabilities.min) / (zoomCapabilities.max - zoomCapabilities.min)) * 100}%`,
                                                  transform: 'translate(-50%, -50%)'
                                              }}
                                           />
                                            <div 
                                              className="absolute top-[-25px] -translate-x-1/2 bg-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap"
                                              style={{ 
                                                  left: `${((currentZoom - zoomCapabilities.min) / (zoomCapabilities.max - zoomCapabilities.min)) * 100}%`
                                              }}
                                            >
                                               {currentZoom.toFixed(1)}x
                                            </div>
                                       </div>
                                   </div>
                                   <ZoomIn className="w-5 h-5 text-white/50" />
                                </div>
                             ) : (
                                <div className="w-full bg-white/5 text-white/30 font-bold py-4 rounded-2xl border border-white/5 flex items-center justify-center text-sm">
                                    {canStart ? "제스처로 시작할 수 있습니다" : "인원 모으는 중..."}
                                </div>
                             )}
                           </>
                        ) : (
                           <>
                            {gameState === GameState.SHOW_WINNER ? (
                                <button 
                                    onClick={onOpenGallery}
                                    className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                                >
                                    <ImageIcon className="w-5 h-5" /> 결과 보기 
                                    {galleryCount > 0 && <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">{galleryCount}</span>}
                                </button>
                            ) : (
                               <div className="w-full bg-white/5 text-white/50 py-4 rounded-2xl border border-white/5 flex items-center justify-center text-sm">
                                  제스처를 인식하고 있습니다...
                               </div>
                            )}
                           </>
                        )}
                    </div>

                    {isDetecting ? (
                         <button 
                             onClick={onConfirmParticipants}
                             disabled={!canStart}
                             className={`
                                h-[56px] px-6 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all min-w-[80px]
                                ${canStart 
                                   ? 'bg-yellow-400 border-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.4)] hover:bg-yellow-300 active:scale-95' 
                                   : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'}
                             `}
                         >
                             <Play className={`w-5 h-5 ${canStart ? 'fill-black' : ''}`} />
                             <span className="text-xs whitespace-nowrap font-bold">시작</span>
                         </button>
                    ) : (
                        <button 
                            onClick={onReset}
                            className="h-[56px] px-6 bg-white/10 hover:bg-white/20 text-white rounded-2xl border border-white/10 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all min-w-[80px]"
                        >
                            <RefreshCw className="w-5 h-5" />
                            <span className="text-xs whitespace-nowrap">다시 시작</span>
                        </button>
                    )}
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default GameOverlay;
