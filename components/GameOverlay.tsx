
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
      <div className="w-full flex justify-between items-start p-4 pt-6 relative">
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
                       <div className="bg-black/40 text-white/90 px-4 py-1.5 rounded-full text-xs font-medium border border-white/10 backdrop-blur">
                          손바닥을 빠르게 뒤집으면 진행됩니다
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

      {/* Center Feedback */}
      <div className="flex-1 flex flex-col items-center justify-start pt-32 pointer-events-none relative pb-20">
        
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
           <div className="flex items-center justify-center mt-10">
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

      {/* Bottom Bar */}
      <div className="w-full p-4 pb-10 md:pb-4 pointer-events-auto">
        <div className={`
            bg-black/70 backdrop-blur-xl border border-white/10 rounded-3xl 
            transition-all duration-300 ease-spring shadow-2xl
            ${isInstructionExpanded ? 'p-5' : 'p-3'}
        `}>
          <div 
             className="flex justify-between items-center cursor-pointer"
             onClick={() => setIsInstructionExpanded(!isInstructionExpanded)}
          >
             <div className="flex items-center gap-2 text-white">
                <Info className="w-4 h-4 text-yellow-400" />
                <span className="font-bold text-sm">
                   진행 안내
                </span>
             </div>
             <button className="text-white/50 hover:text-white">
                {isInstructionExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronUp className="w-4 h-4"/>}
             </button>
          </div>

          {isInstructionExpanded && (
             <div className="mt-4 text-sm text-gray-200">
                <div className="mb-4 leading-relaxed text-center font-medium">
                   {isDetecting ? (
                       <>
                         <p>카메라에 손바닥을 보여주세요.</p>
                         <p className="text-white/70 text-xs mt-1">2명 이상 모이면 게임을 시작할 수 있습니다.</p>
                       </>
                   ) : (
                       <p>{INSTRUCTIONS[gameState]}</p>
                   )}
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                    <div className="w-full">
                        {isDetecting ? (
                           <>
                             {zoomCapabilities ? (
                                <div className="w-full bg-white/5 border border-white/5 rounded-xl h-[48px] px-4 flex items-center gap-3">
                                   <ZoomOut className="w-4 h-4 text-white/50" />
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
                                   <ZoomIn className="w-4 h-4 text-white/50" />
                                </div>
                             ) : (
                                <div className="w-full bg-white/5 text-white/30 font-bold py-3 rounded-xl border border-white/5 flex items-center justify-center text-xs">
                                    {canStart ? "시작 버튼을 눌러주세요" : "인원 모으는 중..."}
                                </div>
                             )}
                           </>
                        ) : (
                           <>
                            {gameState === GameState.SHOW_WINNER ? (
                                <button 
                                    onClick={onOpenGallery}
                                    className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                                >
                                    <ImageIcon className="w-4 h-4" /> 결과 보기 
                                    {galleryCount > 0 && <span className="bg-red-600 text-white text-[10px] px-1.5 rounded-full">{galleryCount}</span>}
                                </button>
                            ) : (
                               <div className="w-full bg-white/5 text-white/50 py-3 rounded-xl border border-white/5 flex items-center justify-center text-xs">
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
                                h-full px-5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all min-w-[70px] py-2
                                ${canStart 
                                   ? 'bg-yellow-400 border-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.4)] hover:bg-yellow-300 active:scale-95' 
                                   : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'}
                             `}
                         >
                             <Play className={`w-4 h-4 mt-0.5 ${canStart ? 'fill-black' : ''}`} />
                             <span className="text-[10px] whitespace-nowrap font-bold">시작</span>
                         </button>
                    ) : (
                        <button 
                            onClick={onReset}
                            className="h-full px-5 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all min-w-[70px] py-2"
                        >
                            <RefreshCw className="w-4 h-4 mt-0.5" />
                            <span className="text-[10px] whitespace-nowrap">다시 시작</span>
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
