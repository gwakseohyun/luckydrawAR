import React from 'react';
import { GameState } from '../types';
import { INSTRUCTIONS, COLORS } from '../constants';
import { RefreshCw, Camera, Users, Trophy, Info, AlertTriangle, Image as ImageIcon } from 'lucide-react';

interface GameOverlayProps {
  gameState: GameState;
  participantCount: number;
  winnerCount: number;
  timer: number;
  maxDuration?: number; // Added to support variable timer lengths (e.g. 2s vs 3s)
  onReset: () => void;
  onConfirmParticipants: () => void;
  warningMessage?: string | null;
  onOpenGallery?: () => void;
  galleryCount?: number;
}

const GameOverlay: React.FC<GameOverlayProps> = ({
  gameState,
  participantCount,
  winnerCount,
  timer,
  maxDuration = 3, // Default to 3 if not provided
  onReset,
  onConfirmParticipants,
  warningMessage,
  onOpenGallery,
  galleryCount = 0
}) => {
  
  const isHolding = 
    gameState === GameState.SET_WINNER_COUNT || 
    gameState === GameState.WAIT_FOR_FISTS_READY ||
    gameState === GameState.WAIT_FOR_FISTS_PRE_DRAW;

  // Calculate progress for the circle stroke
  // Circumference of radius 60 is approx 377
  const CIRCUMFERENCE = 377;
  const progress = Math.min(timer / maxDuration, 1);
  const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress);
  
  // Display remaining time (e.g., 3, 2, 1)
  // We ceil it so it shows "3" immediately, then "2" after 1s passed.
  const displayTime = Math.ceil(maxDuration - timer);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10">
      
      {/* Top Bar */}
      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg">
          <Camera className="w-5 h-5 text-black" />
          <span className="font-bold text-black">Lucky Draw AR</span>
        </div>
        
        <div className="flex items-center gap-2">
           {gameState !== GameState.IDLE && (
            <div className="flex items-center gap-2 bg-green-100 px-3 py-1 rounded-full border border-green-300">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
               <span className="text-xs font-bold text-green-700">Live</span>
            </div>
           )}
           <button 
             onClick={onReset}
             className="pointer-events-auto p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors shadow-md"
           >
              <RefreshCw className="w-5 h-5 text-gray-700" />
           </button>
        </div>
      </div>

      {/* Center Feedback (Timer/Counts) */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none w-full">
        
        {/* WARNING MESSAGE BANNER */}
        {warningMessage && (
           <div className="absolute -top-32 left-1/2 transform -translate-x-1/2 w-max max-w-[90vw] animate-bounce-short z-50">
             <div className="bg-red-600 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 border-2 border-red-400">
                <AlertTriangle className="w-8 h-8 flex-shrink-0" />
                <span className="text-xl font-bold whitespace-nowrap">{warningMessage}</span>
             </div>
           </div>
        )}

        {/* Count Display during detection */}
        {gameState === GameState.DETECT_PARTICIPANTS && (
          <div className="flex flex-col items-center animate-bounce-short">
             <span className="text-8xl font-black text-yellow-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]">
               {participantCount}명
             </span>
             <span className="text-2xl text-white font-bold drop-shadow-md">감지됨</span>
             {participantCount < 2 && participantCount > 0 && (
                <div className="mt-2 bg-red-500/80 px-4 py-1 rounded-full text-white text-sm font-bold">
                  최소 2명이 필요합니다
                </div>
             )}
          </div>
        )}

        {/* Hold Timer */}
        {isHolding && timer > 0 && (
           <div className="flex items-center justify-center">
             <div className="relative flex items-center justify-center w-40 h-40">
               <svg className="absolute w-full h-full transform -rotate-90" viewBox="0 0 140 140">
                 <circle cx="70" cy="70" r="60" fill="transparent" stroke="rgba(255,255,255,0.3)" strokeWidth="10" />
                 <circle 
                    cx="70" cy="70" r="60" 
                    fill="transparent" 
                    stroke={COLORS.primary} 
                    strokeWidth="10" 
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
        
        {/* Winner Count Set Feedback */}
        {gameState === GameState.SET_WINNER_COUNT && winnerCount > 0 && !warningMessage && (
           <div className="mt-8 flex flex-col items-center gap-2">
             <div className="bg-black/60 backdrop-blur px-6 py-2 rounded-xl border border-yellow-400/50 inline-block">
               <span className="text-yellow-400 font-bold text-xl">{winnerCount}명 추첨 예정</span>
             </div>
             <p className="text-white/80 text-sm drop-shadow-md">
               (최대 {Math.max(1, participantCount - 1)}명까지 가능)
             </p>
           </div>
        )}
        
        {/* Celebration Text for SHOW_WINNER */}
        {gameState === GameState.SHOW_WINNER && (
          <div className="flex flex-col items-center">
             <div className="bg-yellow-100 text-yellow-800 px-4 py-1 rounded-full text-sm font-bold mb-4 shadow-lg flex items-center gap-1">
               <Trophy className="w-4 h-4" /> 추첨 완료
             </div>
             <h1 className="text-5xl md:text-6xl font-black text-white drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] mb-2">
               당첨을 축하합니다!
             </h1>
             <p className="text-white/90 text-lg drop-shadow-md mb-6">화면 속 손바닥 위의 황금볼을 확인하세요.</p>
             
             {/* View Gallery Button */}
             <button 
                onClick={onOpenGallery}
                className="pointer-events-auto flex items-center gap-3 bg-white hover:bg-gray-100 text-black px-8 py-4 rounded-full shadow-2xl transition-transform hover:scale-105 active:scale-95 border-4 border-yellow-400"
             >
                <div className="relative">
                   <ImageIcon className="w-6 h-6" />
                   {galleryCount > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border border-white">
                        {galleryCount}
                      </span>
                   )}
                </div>
                <span className="text-xl font-bold">당첨 결과 화면 보기</span>
             </button>
          </div>
        )}
      </div>

      {/* Bottom Control / Instruction Bar */}
      <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto">
        
        {/* Instruction Bubble */}
        <div className="bg-white/95 backdrop-blur-xl px-8 py-6 rounded-3xl shadow-2xl text-center border border-white/50 w-full transition-all duration-500">
           {gameState === GameState.DETECT_PARTICIPANTS ? (
             <div className="flex flex-col items-center gap-3">
               <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-1">
                 <Users className="w-6 h-6 text-yellow-600" />
               </div>
               <h2 className="text-2xl font-bold text-gray-900">
                 참가 인원 설정
               </h2>
               <p className="text-gray-500 mb-2">
                 카메라를 향해 손바닥을 펼쳐주세요. (최소 2명)
               </p>
               
               {/* TIP Included Here */}
               <div className="bg-gray-100 rounded-lg px-3 py-2 text-xs text-gray-600 flex items-center gap-2 mt-2">
                  <Info className="w-4 h-4 text-gray-400" />
                  <span>Tip: 손바닥↔손등을 빠르게 두 번 뒤집으면(✋🤚✋🤚) 인원이 확정됩니다.</span>
               </div>

               {participantCount >= 2 && (
                 <div className="flex flex-col gap-2 items-center mt-2">
                   <button 
                     onClick={onConfirmParticipants}
                     className="pointer-events-auto bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 px-8 rounded-full shadow-lg transition-transform active:scale-95 flex items-center gap-2"
                   >
                     참가자 {participantCount}명 확정 <Users className="w-4 h-4"/>
                   </button>
                 </div>
               )}
             </div>
           ) : (
             <div>
               <h2 className="text-xl md:text-2xl font-bold text-gray-800 animate-fade-in">
                 {INSTRUCTIONS[gameState]}
               </h2>
               
               {gameState === GameState.SHOW_WINNER && (
                  <>
                    <div className="mt-4 flex gap-3 justify-center">
                       <button 
                          onClick={onReset}
                          className="pointer-events-auto bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-8 rounded-full shadow-lg transition-transform active:scale-95"
                        >
                         처음으로
                       </button>
                    </div>
                  </>
               )}
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default GameOverlay;