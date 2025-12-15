import React, { useState } from 'react';
import { GameState } from '../types';
import { INSTRUCTIONS, COLORS } from '../constants';
import { RefreshCw, Users, Info, AlertTriangle, Image as ImageIcon, SwitchCamera, ChevronDown, ChevronUp } from 'lucide-react';

interface GameOverlayProps {
  gameState: GameState;
  participantCount: number;
  winnerCount: number;
  timer: number;
  maxDuration?: number; 
  onReset: () => void;
  onConfirmParticipants: () => void;
  warningMessage?: string | null;
  onOpenGallery?: () => void;
  galleryCount?: number;
  onToggleCamera?: () => void;
}

const GameOverlay: React.FC<GameOverlayProps> = ({
  gameState,
  participantCount,
  winnerCount,
  timer,
  maxDuration = 3, 
  onReset,
  onConfirmParticipants,
  warningMessage,
  onOpenGallery,
  galleryCount = 0,
  onToggleCamera
}) => {
  const [isInstructionExpanded, setIsInstructionExpanded] = useState(true);

  const isHolding = 
    gameState === GameState.SET_WINNER_COUNT || 
    gameState === GameState.WAIT_FOR_FISTS_READY ||
    gameState === GameState.WAIT_FOR_FISTS_PRE_DRAW;

  const isDetecting = gameState === GameState.DETECT_PARTICIPANTS;

  const CIRCUMFERENCE = 377;
  const progress = Math.min(timer / maxDuration, 1);
  const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress);
  const displayTime = Math.ceil(maxDuration - timer);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-10 safe-area-inset">
      
      {/* Top Section: Tips, Warnings, Camera Toggle */}
      <div className="w-full flex justify-between items-start p-4 pt-6">
         {/* Top Left/Center Dynamic Info */}
         <div className="flex-1 flex justify-center">
            {warningMessage ? (
               <div className="animate-bounce-short bg-red-500/90 text-white px-4 py-1.5 rounded-full shadow-lg backdrop-blur flex items-center gap-2">
                   <AlertTriangle className="w-4 h-4" />
                   <span className="text-xs font-bold">{warningMessage}</span>
               </div>
            ) : (
                <>
                   {isDetecting && participantCount < 2 && (
                       <div className="bg-red-500/80 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg backdrop-blur">
                          최소 2명이 필요합니다
                       </div>
                   )}
                   {isDetecting && participantCount >= 2 && (
                       <div className="bg-black/40 text-white/90 px-4 py-1.5 rounded-full text-xs font-medium border border-white/10 backdrop-blur">
                          손바닥을 빠르게 뒤집으면 진행됩니다
                       </div>
                   )}
                </>
            )}
         </div>

         {/* Camera Toggle with Live Indicator */}
         <div className="absolute top-4 right-4 pointer-events-auto">
            {onToggleCamera && (
                <button 
                  onClick={onToggleCamera}
                  className="relative p-3 bg-black/40 hover:bg-white/20 backdrop-blur-md rounded-full text-white border border-white/10 transition-all active:scale-95 shadow-lg"
                  aria-label="카메라 전환"
                >
                  <SwitchCamera className="w-6 h-6" />
                  {/* Live Indicator inside the lens area */}
                  <span className="absolute top-3 right-3 w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                </button>
            )}
         </div>
      </div>

      {/* Center Feedback (Timer/Counts) */}
      <div className="flex-1 flex flex-col items-center justify-center pointer-events-none relative pb-20">
        
        {/* Big Counter */}
        {isDetecting && (
          <div className="flex flex-col items-center">
             <span className="text-8xl font-black text-yellow-400 drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] tracking-tighter">
               {participantCount}명
             </span>
             <span className="text-2xl text-white font-bold drop-shadow-md -mt-2">감지됨</span>
          </div>
        )}

        {/* Hold Timer */}
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
        
        {/* Step 3 Count Feedback */}
        {gameState === GameState.SET_WINNER_COUNT && winnerCount > 0 && !warningMessage && (
           <div className="mt-8 flex flex-col items-center gap-1">
             <div className="bg-black/60 backdrop-blur px-5 py-2 rounded-full border border-yellow-400/30">
               <span className="text-yellow-400 font-bold text-2xl">{winnerCount}명</span>
               <span className="text-white text-lg ml-2">추첨 예정</span>
             </div>
           </div>
        )}
      </div>

      {/* Bottom Bar - Mobile Friendly HUD */}
      <div className="w-full p-4 pointer-events-auto">
        <div className={`
            bg-black/70 backdrop-blur-xl border border-white/10 rounded-3xl 
            transition-all duration-300 ease-spring shadow-2xl
            ${isInstructionExpanded ? 'p-5' : 'p-3'}
        `}>
          {/* Header / Toggle */}
          <div 
             className="flex justify-between items-center cursor-pointer"
             onClick={() => setIsInstructionExpanded(!isInstructionExpanded)}
          >
             <div className="flex items-center gap-2 text-white">
                <Info className="w-4 h-4 text-yellow-400" />
                <span className="font-bold text-sm">
                   {isDetecting ? "참가 인원 설정" : "게임 진행 안내"}
                </span>
             </div>
             <button className="text-white/50 hover:text-white">
                {isInstructionExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronUp className="w-4 h-4"/>}
             </button>
          </div>

          {/* Expanded Content */}
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

                {/* Actions Grid */}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                    {/* Primary Action */}
                    <div className="w-full">
                        {isDetecting && (
                           <>
                             {participantCount >= 2 ? (
                               <button 
                                 onClick={onConfirmParticipants}
                                 className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                               >
                                 {participantCount}명으로 시작하기 <Users className="w-4 h-4"/>
                               </button>
                            ) : (
                               <div className="w-full bg-white/5 text-white/30 font-bold py-3 rounded-xl border border-white/5 flex items-center justify-center text-xs">
                                 인원 모으는 중...
                               </div>
                            )}
                           </>
                        )}
                        
                        {gameState === GameState.SHOW_WINNER && (
                            <button 
                                onClick={onOpenGallery}
                                className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <ImageIcon className="w-4 h-4" /> 결과 보기 
                                {galleryCount > 0 && <span className="bg-red-600 text-white text-[10px] px-1.5 rounded-full">{galleryCount}</span>}
                            </button>
                        )}

                        {!isDetecting && gameState !== GameState.SHOW_WINNER && (
                           <div className="w-full bg-white/5 text-white/50 py-3 rounded-xl border border-white/5 flex items-center justify-center text-xs">
                              제스처를 인식하고 있습니다...
                           </div>
                        )}
                    </div>

                    {/* Secondary Action (Reset) */}
                    <button 
                        onClick={onReset}
                        className="h-full px-4 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all min-w-[70px]"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span className="text-[10px]">다시 시작</span>
                    </button>
                </div>
             </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default GameOverlay;
