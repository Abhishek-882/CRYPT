"use client";

import React, { useRef, useState, useEffect } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  ExternalLink,
  Film,
  Sparkles,
  ShieldCheck,
  Zap,
  Activity,
  Layers,
} from "lucide-react";

interface IntroVideoPlayerProps {
  className?: string;
}

export default function IntroVideoPlayer({ className = "" }: IntroVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Synchronize fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setHasStarted(true);
        })
        .catch((err) => {
          console.warn("Video play interrupted:", err);
        });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const restartVideo = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current
      .play()
      .then(() => {
        setIsPlaying(true);
        setHasStarted(true);
      })
      .catch(() => {});
  };

  const requestFullscreen = () => {
    const target = containerRef.current || videoRef.current;
    if (!target) return;
    if (!document.fullscreenElement) {
      target.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <section
      data-aos="fade-up"
      className={`w-full max-w-5xl mx-auto px-4 md:px-8 py-6 ${className}`}
      aria-label="Platform Intro Video"
    >
      {/* Outer Chassis */}
      <div
        ref={containerRef}
        className="relative rounded-2xl bg-[#0b0b0e] border border-zinc-800/90 hover:border-amber-500/40 transition-colors shadow-2xl shadow-black/80 overflow-hidden group"
      >
        {/* Terminal Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#101014] border-b border-zinc-800/80 text-xs select-none">
          <div className="flex items-center space-x-3">
            {/* Window control dots */}
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 border border-rose-600/40" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 border border-amber-600/40" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 border border-emerald-600/40" />
            </div>

            <div className="flex items-center space-x-2 pl-1 font-mono">
              <Film className="w-3.5 h-3.5 text-accent-amber" />
              <span className="font-bold text-zinc-200 uppercase tracking-wider text-[11px]">
                INTRO // MASTER PLATFORM WALKTHROUGH
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 font-mono text-[10px]">
            <span className="hidden sm:inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/20 font-bold">
              <Sparkles className="w-2.5 h-2.5" />
              <span>1080P HD</span>
            </span>

            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
              STEREO AUDIO
            </span>

            <a
              href="/walkthrough.mp4"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open walkthrough video in new tab"
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors border border-zinc-700/60"
              title="Open video in full separate tab"
            >
              <ExternalLink className="w-3 h-3 text-zinc-400" />
              <span className="hidden sm:inline">Direct Link</span>
            </a>
          </div>
        </div>

        {/* Video Player Frame */}
        <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            src="/walkthrough.mp4"
            poster="/og-preview.svg"
            preload="none"
            playsInline
            controls
            onPlay={() => {
              setIsPlaying(true);
              setHasStarted(true);
            }}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setHasStarted(false);
            }}
            onError={() => setHasError(true)}
            className="w-full h-full object-contain focus:outline-none"
          >
            {/* Fallback for legacy browsers */}
            Your browser does not support the video tag. You can{" "}
            <a href="/walkthrough.mp4" className="underline text-accent-amber">
              download or view the walkthrough video directly here
            </a>
            .
          </video>

          {/* Initial Big Play Overlay (shown before user clicks play) */}
          {!hasStarted && !hasError && (
            <div
              onClick={togglePlay}
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-black/40 z-10 p-4"
              role="button"
              tabIndex={0}
              aria-label="Play Walkthrough Intro Video"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  togglePlay();
                }
              }}
            >
              {/* Pulsing Play Button */}
              <div className="relative flex items-center justify-center group-hover:scale-105 transition-transform">
                <div className="absolute -inset-3 rounded-full bg-amber-500/20 blur-md animate-pulse" />
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-amber-500 to-amber-400 text-zinc-950 flex items-center justify-center shadow-2xl shadow-amber-500/40 ring-4 ring-amber-400/30">
                  <Play className="w-7 h-7 sm:w-9 sm:h-9 fill-zinc-950 translate-x-0.5" />
                </div>
              </div>

              <div className="mt-4 text-center space-y-1">
                <div className="text-base sm:text-lg font-black tracking-wide text-zinc-100 font-mono">
                  WATCH MASTER PLATFORM WALKTHROUGH
                </div>
                <div className="text-xs sm:text-sm text-zinc-300 font-mono">
                  Dual-Venue Basis Arbitrage • 453-Coin Matrix • 24/7 Autopilot Bot
                </div>
                <div className="text-[11px] text-accent-amber/90 font-mono pt-1">
                  Click to start playback with full audio & controls
                </div>
              </div>
            </div>
          )}

          {/* Error notice if file fails */}
          {hasError && (
            <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
              <div className="text-rose-400 font-bold text-sm">Video Stream Notice</div>
              <p className="text-xs text-zinc-400 max-w-md">
                If inline video playback is restricted on your browser, you can access the master video file directly.
              </p>
              <a
                href="/walkthrough.mp4"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-accent-amber text-zinc-950 font-bold text-xs uppercase hover:bg-amber-400 transition-colors"
              >
                Open Walkthrough Video
              </a>
            </div>
          )}
        </div>

        {/* Tactical Feature Callouts Footer */}
        <div className="bg-[#0e0e12] border-t border-zinc-800/80 px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-mono text-zinc-300">
          <div className="flex items-center space-x-2">
            <Activity className="w-3.5 h-3.5 text-accent-amber flex-shrink-0" />
            <div>
              <span className="text-zinc-500 block text-[9px] uppercase">Execution</span>
              <strong className="text-zinc-200">Simultaneous Hedging</strong>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Layers className="w-3.5 h-3.5 text-accent-cyan flex-shrink-0" />
            <div>
              <span className="text-zinc-500 block text-[9px] uppercase">Market Scale</span>
              <strong className="text-zinc-200">453+ Mutual Pairs</strong>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Zap className="w-3.5 h-3.5 text-accent-emerald flex-shrink-0" />
            <div>
              <span className="text-zinc-500 block text-[9px] uppercase">Autopilot</span>
              <strong className="text-zinc-200">24/7 Daemon Loop</strong>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-3.5 h-3.5 text-accent-amber flex-shrink-0" />
            <div>
              <span className="text-zinc-500 block text-[9px] uppercase">Security</span>
              <strong className="text-zinc-200">AES-256 Vault</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
