"use client";

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

export default function ReelsCutterPage() {
  // ─── Auth ───────────────────────────────────────────────
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  // ─── App State ──────────────────────────────────────────
  const [loaded, setLoaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [segments, setSegments] = useState<{ start: number; end: number | null }[] | null>(null);
  
  const ffmpegRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ─── Check session ──────────────────────────────────────
  useEffect(() => {
    if (document.cookie.includes('session_access=granted')) {
      setAuthorized(true);
      loadFFmpeg();
    }
  }, []);

  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return;
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    ffmpeg.on('progress', ({ progress }) => setProgress(Math.round(progress * 100)));
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    setLoaded(true);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthorized(true);
      loadFFmpeg();
    } else {
      setLoginError(true);
      setPassword('');
      setTimeout(() => setLoginError(false), 2000);
    }
    setLoginLoading(false);
  };

  // ─── File Handling ──────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setSegments(null);
      setProgress(0);
      setStatus("Ready");
    }
  };

  const onMetadataLoaded = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  // ─── Whisper Analysis ───────────────────────────────────
  const analyzeVideo = async () => {
    if (!videoFile || !loaded) return;
    setProcessing(true);
    setStatus("Extracting Audio...");
    try {
      const { fetchFile } = await import('@ffmpeg/util');
      const ffmpeg = ffmpegRef.current;
      const inputName = 'temp_audio_in.mov';
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
      await ffmpeg.exec(['-i', inputName, '-vn', '-ar', '16000', '-ac', '1', 'whisper.mp3']);
      const audioData = await ffmpeg.readFile('whisper.mp3');
      const audioBlob = new Blob([(audioData as any).buffer], { type: 'audio/mpeg' });

      setStatus("Whisper is Thinking...");
      const form = new FormData();
      form.append('video', audioBlob, 'audio.mp3');
      const res = await fetch('/api/whisper', { method: 'POST', body: form });
      const data = await res.json();
      
      if (data.segments) {
        setSegments(data.segments);
        setStatus("Review Your Edit");
      }
    } catch (e) {
      console.error(e);
      setStatus("Error processing audio");
    } finally {
      setProcessing(false);
    }
  };

  // ─── Rendering ──────────────────────────────────────────
  const renderVideo = async () => {
    if (!segments || !videoFile) return;
    setProcessing(true);
    setStatus("Rendering Master Copy...");
    try {
      const { fetchFile } = await import('@ffmpeg/util');
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mov', await fetchFile(videoFile));

      let filter = "";
      let concat = "";
      segments.forEach((seg, i) => {
        const end = seg.end ? seg.end : duration;
        filter += `[0:v]trim=start=${seg.start}:end=${end},setpts=PTS-STARTPTS[v${i}];`;
        filter += `[0:a]atrim=start=${seg.start}:end=${end},asetpts=PTS-STARTPTS[a${i}];`;
        concat += `[v${i}][a${i}]`;
      });
      filter += `${concat}concat=n=${segments.length}:v=1:a=1[vraw][outa];[vraw]fps=30,scale=1080:-2[outv]`;

      await ffmpeg.exec([
        '-i', 'input.mov', '-filter_complex', filter,
        '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-crf', '22', 'out.mp4'
      ]);

      const data = await ffmpeg.readFile('out.mp4');
      const url = URL.createObjectURL(new Blob([(data as any).buffer], { type: 'video/mp4' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `deVee_Reel_${Date.now()}.mp4`;
      a.click();
    } catch (e) {
      console.error(e);
      setStatus("Render Failed");
    } finally {
      setProcessing(false);
    }
  };

  // ─── Timeline Logic ─────────────────────────────────────
  const seekTo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // UI Components
  const LabelFooter = () => (
    <div className="w-full py-6 flex flex-col items-center gap-2 opacity-40">
      <p className="text-[7px] tracking-[0.3em] font-light uppercase">Powered By deVee Boutique Label</p>
      <Image src="/label_logo.jpg" alt="deVee" width={30} height={30} className="rounded-full grayscale" />
    </div>
  );

  if (!authorized) {
    return (
      <main className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-8">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          <input 
            type="password" 
            placeholder="ACCESS KEY" 
            className="w-full bg-white/5 border border-white/10 p-4 text-center tracking-widest text-[10px] text-white rounded-2xl"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="w-full bg-[#D4AF37] p-4 rounded-2xl text-black font-black text-[10px] uppercase tracking-widest">Login</button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white flex flex-col items-center p-4">
      {/* Header */}
      <div className="flex flex-col items-center mb-8 pt-4">
        <Image src="/logo.png" alt="Logo" width={90} height={30} className="mb-2" />
        <h1 className="text-[10px] tracking-[0.6em] font-bold uppercase italic text-[#D4AF37]">Reels Cutter Pro</h1>
      </div>

      <div className="w-full max-w-[600px] space-y-6">
        
        {/* Preview Section */}
        <div className="relative aspect-[9/16] w-full max-w-[320px] mx-auto bg-black rounded-[30px] overflow-hidden border border-white/10 shadow-2xl">
          {videoUrl ? (
            <video 
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={onMetadataLoaded}
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
              className="w-full h-full object-cover"
              playsInline
              controls={false}
              onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()}
            />
          ) : (
            <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-white/[0.02] transition-colors">
              <span className="text-[10px] tracking-widest text-white/30 uppercase">Upload Video</span>
              <input type="file" className="hidden" onChange={handleFileUpload} accept="video/*" />
            </label>
          )}
          
          {/* Status Overlay */}
          {processing && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
              <div className="w-12 h-12 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-[9px] tracking-widest uppercase font-bold text-[#D4AF37]">{status}</p>
            </div>
          )}
        </div>

        {/* Timeline Section */}
        {videoUrl && duration > 0 && (
          <div className="space-y-4">
            <div className="relative h-12 bg-white/5 rounded-xl border border-white/10 overflow-hidden cursor-crosshair"
                 onClick={(e) => {
                   const rect = e.currentTarget.getBoundingClientRect();
                   const x = e.clientX - rect.left;
                   seekTo((x / rect.width) * duration);
                 }}>
              
              {/* Segments Visualization */}
              {segments?.map((seg, i) => (
                <div 
                  key={i}
                  className="absolute h-full bg-[#D4AF37]/40 border-x border-[#D4AF37]/60"
                  style={{
                    left: `${(seg.start / duration) * 100}%`,
                    width: `${(( (seg.end || duration) - seg.start) / duration) * 100}%`
                  }}
                />
              ))}

              {/* Playhead */}
              <div 
                className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-10 shadow-[0_0_10px_red]"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            </div>

            <div className="flex justify-between items-center px-2">
              <span className="text-[9px] font-mono text-white/40">{currentTime.toFixed(2)}s</span>
              <span className="text-[9px] font-mono text-white/40">{duration.toFixed(2)}s</span>
            </div>

            {/* Controls */}
            {!segments ? (
              <button 
                onClick={analyzeVideo}
                disabled={processing}
                className="w-full py-4 bg-white/10 hover:bg-[#D4AF37] hover:text-black transition-all rounded-2xl text-[10px] font-black uppercase tracking-widest"
              >
                Analyze with Whisper
              </button>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => videoRef.current?.play()} className="py-3 bg-white/5 rounded-xl text-[9px] uppercase tracking-widest">Play Preview</button>
                  <button onClick={() => videoRef.current?.pause()} className="py-3 bg-white/5 rounded-xl text-[9px] uppercase tracking-widest">Pause</button>
                </div>
                
                <button 
                  onClick={renderVideo}
                  disabled={processing}
                  className="w-full py-5 bg-[#D4AF37] text-black rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] shadow-[0_20px_50px_rgba(212,175,55,0.2)]"
                >
                  Export 1080p Master
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <LabelFooter />
    </main>
  );
}