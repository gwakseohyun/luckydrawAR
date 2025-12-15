import React, { useState } from 'react';
import { GameState } from '../types';
import { INSTRUCTIONS, COLORS } from '../constants';
import { RefreshCw, Camera, Users, Trophy, Info, AlertTriangle, Image as ImageIcon, SwitchCamera, ChevronDown, ChevronUp } from 'lucide-react';

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

  const CIRCUMFERENCE = 377;
  const progress = Math.min(timer / maxDuration, 1);
  const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress);
  const displayTime = Math.ceil(maxDuration - timer);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-10 safe-area-inset">
      
      {/* Top Bar - Compact & Transparent */}
      <div className="w-full flex justify-between items-start p-4 bg-gradient-to-b from-black/80 to-transparent pb-12">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
          <Camera className="w-4 h-4 text-white" />
          <span className="font-bold text-white text-sm">Lucky Draw</span>
           {gameState !== GameState.IDLE && (
              <div className="flex items-center gap-1 ml-1 border-l border-white/20 pl-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                 <span className="text-[10px] font-bold text-green-400">LIVE</span>
              </div>
           )}
        </div>
        
        <div className="flex items-center gap-3">
           {onToggleCamera && (
             <button 
               onClick={onToggleCamera}
               className="pointer-events-auto p-2.5 bg-black/40 hover:bg-white/20 backdrop-blur-md rounded-full text-white border border-white/10 transition-all active:scale-95"
               aria-label="카메라 전환"
             >
               <SwitchCamera className="w-5 h-5" />
             </button>
           )}
           <button 
             onClick={onReset}
             className="pointer-events-auto p-2.5 bg-black/40 hover:bg-white/20 backdrop-blur-md rounded-full text-white border border-white/10 transition-all active:scale-95"
             aria-label="초기화"
           >
              <RefreshCw className="w-5 h-5" />
           </button>
        </div>
      </div>

      {/* Center Feedback (Timer/Counts) - Optimized for visibility */}
      <div className="flex-1 flex flex-col items-center justify-center pointer-events-none relative">
        
        {/* Warning Toast */}
        {warningMessage && (
           <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 w-max max-w-[90vw] animate-bounce-short z-50">
             <div className="bg-red-500/90 text-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 backdrop-blur-sm">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span className="font-bold text-sm">{warningMessage}</span>
             </div>
           </div>
        )}

        {/* Big Counter */}
        {gameState === GameState.DETECT_PARTICIPANTS && (
          <div className="flex flex-col items-center">
             <span className="text-8xl font-black text-yellow-400 drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] tracking-tighter">
               {participantCount}
             </span>
             <span className="text-xl text-white font-bold drop-shadow-md -mt-2">명 감지됨</span>
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
        
        {/* Winner Reveal */}
        {gameState === GameState.SHOW_WINNER && (
          <div className="flex flex-col items-center animate-fade-in p-6 bg-black/40 backdrop-blur-sm rounded-3xl border border-white/10 mx-4">
             <Trophy className="w-12 h-12 text-yellow-400 mb-2 drop-shadow-glow" />
             <h1 className="text-4xl md:text-5xl font-black text-white drop-shadow-lg text-center mb-2">
               당첨 축하!
             </h1>
             <p className="text-white/80 text-sm mb-6 text-center">황금볼을 확인하세요!</p>
             
             <button 
                onClick={onOpenGallery}
                className="pointer-events-auto flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-black px-6 py-3 rounded-full shadow-xl transition-transform active:scale-95"
             >
                <div className="relative">
                   <ImageIcon className="w-5 h-5" />
                   {galleryCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full border border-white font-bold">
                        {galleryCount}
                      </span>
                   )}
                </div>
                <span className="text-base font-bold">결과 보기</span>
             </button>
          </div>
        )}
      </div>

      {/* Bottom Bar - Mobile Friendly HUD */}
      <div className="w-full p-4 pointer-events-auto">
        <div className={`
            bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl 
            transition-all duration-300 ease-spring
            ${isInstructionExpanded ? 'p-4' : 'p-3'}
        `}>
          {/* Header / Toggle */}
          <div 
             className="flex justify-between items-center cursor-pointer"
             onClick={() => setIsInstructionExpanded(!isInstructionExpanded)}
          >
             <div className="flex items-center gap-2 text-white">
                <Info className="w-4 h-4 text-yellow-400" />
                <span className="font-bold text-sm">
                   {gameState === GameState.DETECT_PARTICIPANTS ? "참가 인원 설정" : "게임 진행 안내"}
                </span>
             </div>
             <button className="text-white/50 hover:text-white">
                {isInstructionExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronUp className="w-4 h-4"/>}
             </button>
          </div>

          {/* Expanded Content */}
          {isInstructionExpanded && (
             <div className="mt-3 text-sm text-gray-200">
                <p className="mb-3 leading-relaxed">
                   {gameState === GameState.DETECT_PARTICIPANTS 
                      ? "카메라에 손바닥을 보여주세요. 2명 이상 모이면 게임을 시작할 수 있습니다." 
                      : INSTRUCTIONS[gameState]}
                </p>

                {gameState === GameState.DETECT_PARTICIPANTS && (
                   <div className="bg-white/10 rounded-lg p-2 text-xs text-gray-300 flex items-start gap-2 mb-3">
                      <span className="mt-0.5 text-yellow-400">💡</span>
                      <span>Tip: 손바닥과 손등을 빠르게 두 번 뒤집으면(✋🤚✋🤚) 버튼 없이 바로 시작됩니다.</span>
                   </div>
                )}
             </div>
          )}
          
          {/* Action Button Area */}
          {gameState === GameState.DETECT_PARTICIPANTS && (
             <div className={`mt-2 ${!isInstructionExpanded ? 'hidden' : 'block'}`}>
                {participantCount >= 2 ? (
                   <button 
                     onClick={onConfirmParticipants}
                     className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                   >
                     {participantCount}명으로 시작하기 <Users className="w-4 h-4"/>
                   </button>
                ) : (
                   <button disabled className="w-full bg-white/10 text-white/40 font-bold py-3 rounded-xl border border-white/5 cursor-not-allowed text-xs">
                     최소 2명이 필요합니다
                   </button>
                )}
             </div>
           )}

           {gameState === GameState.SHOW_WINNER && isInstructionExpanded && (
               <button 
                  onClick={onReset}
                  className="w-full mt-2 bg-white/20 hover:bg-white/30 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
               >
                  새로운 게임 시작
               </button>
           )}
        </div>
      </div>

    </div>
  );
};

export default GameOverlay;
