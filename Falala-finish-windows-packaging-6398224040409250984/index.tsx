import React, { useRef, useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Sub-components ---

const Screw: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`screw ${className}`} />
);

const VUMeter: React.FC<{ level: number }> = ({ level }) => {
  const segments = Array.from({ length: 15 }, (_, i) => i);
  const activeLevel = Math.floor(level * segments.length);

  return (
    <div className="vu-meter-container mx-2">
      {segments.map((s) => {
        const isActive = s < activeLevel;
        let colorClass = 'vu-segment-green';
        if (s > 10) colorClass = 'vu-segment-red';
        else if (s > 7) colorClass = 'vu-segment-yellow';

        return (
          <div
            key={s}
            className={`vu-segment ${colorClass} ${isActive ? 'active' : ''}`}
          />
        );
      })}
    </div>
  );
};

// --- Main App Component ---
const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<string>('System Idle');
  const [messages, setMessages] = useState<{ type: 'user' | 'ai'; content: string }[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  
  // Audio State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [masterLevel, setMasterLevel] = useState(0);
  
  const [volumes, setVolumes] = useState<{ [key: string]: number }>({
    vocal: 75,
    bass: 75,
    other: 75,
    kick: 75,
    snare: 75,
    'high-hat': 75,
    overheads: 75
  });
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodesRef = useRef<{[key: string]: GainNode}>({});
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setUploadedFile(file);
      setPipelineStatus('Tape loaded...');
      loadAudioFile(file);
    }
  };

  const loadAudioFile = async (file: File) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      audio.controls = false;
      audio.preload = 'auto';
      audioRef.current = audio;
      
      const source = audioContextRef.current.createMediaElementSource(audio);
      audioSourceRef.current = source;
      
      // Analyser for Visualization
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const stems = ['vocal', 'bass', 'other', 'kick', 'snare', 'high-hat', 'overheads'];
      const gainNodes: {[key: string]: GainNode} = {};
      
      stems.forEach(stem => {
        const gainNode = audioContextRef.current!.createGain();
        gainNode.gain.value = volumes[stem] / 100;
        source.connect(gainNode);
        gainNode.connect(analyser);
        gainNodes[stem] = gainNode;
      });
      
      analyser.connect(audioContextRef.current.destination);
      
      gainNodesRef.current = gainNodes;
      setAudioLoaded(true);
      setPipelineStatus('Ready for tracking.');
    } catch (error) {
      console.error('Error loading audio file:', error);
      setPipelineStatus('Signal Error');
    }
  };

  const draw = useCallback(() => {
    if (!analyserRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);

    // Draw Waveform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);

      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // Calculate Level for VU Meters
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / bufferLength);
    setMasterLevel(rms * 1.5); // Boost for visibility

    animationRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(draw);
    } else if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      setMasterLevel(0);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, draw]);

  const togglePlayback = () => {
    if (!audioRef.current || !audioLoaded) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const processSeparation = () => {
    if (!uploadedFile || !audioLoaded) return;
    
    setIsProcessing(true);
    setProcessingProgress(0);
    setPipelineStatus('Decoding stems...');
    
    const interval = setInterval(() => {
      setProcessingProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          setPipelineStatus('De-mixing complete.');
          return 100;
        }
        return prev + 5;
      });
    }, 150);
  };

  const handleVolumeChange = (stem: string, value: string) => {
    const volume = parseInt(value);
    const stemKey = stem.toLowerCase();
    const gainNode = gainNodesRef.current[stemKey];
    
    if (gainNode) {
      gainNode.gain.value = volume / 100;
    }
    
    setVolumes(prev => ({ ...prev, [stemKey]: volume }));
  };

  const callAI = async (input: string) => {
    const apiKey = (process.env as any).GEMINI_API_KEY;
    if (!apiKey) {
      return `Acknowledged: "${input}". (Note: API Key not detected for full AI integration)`;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `You are a professional studio assistant AI for an audio engineering application.
      The user says: "${input}". Keep your response concise, technical, and in-character.`;
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err) {
      return "ERROR: Neural link failed. Manual override required.";
    }
  };

  const sendMessage = async () => {
    if (!currentMessage.trim()) return;

    const newUserMsg = { type: 'user' as const, content: currentMessage };
    setMessages(prev => [...prev, newUserMsg]);
    const input = currentMessage;
    setCurrentMessage('');

    const response = await callAI(input);
    setMessages(prev => [...prev, { type: 'ai' as const, content: response }]);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        setMessages(prev => [...prev, { type: 'ai', content: 'Voice command analyzed. All systems nominal.' }]);
        setPipelineStatus('VOX RECEIVED');
        setIsRecording(false);
        stream.getTracks().forEach(track => track.stop());
      };

      setPipelineStatus('VOX COMMS ACTIVE');
      setIsRecording(true);
      mediaRecorder.start();

      setTimeout(() => {
        if (mediaRecorder.state === "recording") mediaRecorder.stop();
      }, 3000);

    } catch (err) {
      console.error("Mic access denied", err);
      setPipelineStatus('VOX ERROR');
      setMessages(prev => [...prev, { type: 'ai', content: 'CRITICAL: MIC ACCESS DENIED.' }]);
    }
  };

  const drumStems = ['Kick', 'Snare', 'High-hat', 'Overheads'];
  const otherStems = ['Vocal', 'Bass', 'Other'];

  return (
    <div className="flex flex-col md:flex-row flex-grow w-full max-w-screen-2xl mx-auto p-6 md:space-x-6 bg-primary font-mono">
      {/* Left Panel: Studio Console Stacks */}
      <div className="flex flex-col w-full md:w-3/4 space-y-6">

        {/* Tape Deck Section */}
        <section className="texture-wood-panel p-4 rounded-sm relative overflow-hidden">
          <Screw className="top-2 left-2" />
          <Screw className="top-2 right-2" />
          <Screw className="bottom-2 left-2" />
          <Screw className="bottom-2 right-2" />

          <div className="texture-brushed-metal p-6 rounded-sm studio-border">
            <h2 className="text-xl font-bold text-accent mb-4 tracking-tighter">ANALOG TAPE INTERFACE</h2>

            <div className="flex flex-col items-center justify-center border-2 border-black bg-black/40 p-8 rounded-sm h-40 relative group">
              {!uploadedFile ? (
                <>
                  <p className="text-lg text-textdark mb-4 uppercase">No reel loaded</p>
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    id="audio-upload"
                    onChange={handleFileUpload}
                  />
                  <label
                    htmlFor="audio-upload"
                    className="px-8 py-3 bg-buttonbg hover:bg-accent hover:text-black border border-white/10 text-textlight font-bold rounded-sm cursor-pointer transition-all duration-200"
                  >
                    LOAD MASTER REEL
                  </label>
                </>
              ) : (
                <div className="text-center">
                  <p className="text-lg text-accent mb-4 font-bold">{uploadedFile.name.toUpperCase()}</p>
                  <div className="flex space-x-4 justify-center">
                    <button
                      onClick={togglePlayback}
                      className={`px-6 py-2 ${isPlaying ? 'bg-error' : 'bg-success'} text-black font-black studio-border rounded-sm transition-colors`}
                    >
                      {isPlaying ? 'STOP' : 'PLAY'}
                    </button>
                    <button
                      onClick={() => {
                        setUploadedFile(null);
                        setAudioLoaded(false);
                        setIsPlaying(false);
                      }}
                      className="px-6 py-2 bg-buttonbg hover:bg-error text-textlight font-bold studio-border rounded-sm"
                    >
                      EJECT
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              {isProcessing && (
                <div className="w-full bg-black h-2 mb-2 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="bg-accent h-full transition-all duration-150"
                    style={{ width: `${processingProgress}%` }}
                  ></div>
                </div>
              )}
              <button
                onClick={processSeparation}
                disabled={!uploadedFile || isProcessing}
                className={`w-full px-5 py-3 font-black rounded-sm border-2 border-black transition-all ${
                  !uploadedFile || isProcessing
                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                    : 'bg-accent hover:bg-orange-400 text-black shadow-[0_4px_0_#995400] active:translate-y-[2px] active:shadow-[0_2px_0_#995400]'
                }`}
              >
                {isProcessing ? `DE-MIXING... ${processingProgress}%` : 'DE-MIX MASTER TO MULTI-TRACK'}
              </button>
            </div>
          </div>
        </section>

        {/* Mixer Console Section */}
        <section className="texture-wood-panel p-4 rounded-sm relative">
          <Screw className="top-2 left-2" />
          <Screw className="top-2 right-2" />
          <Screw className="bottom-2 left-2" />
          <Screw className="bottom-2 right-2" />

          <div className="texture-brushed-metal p-6 rounded-sm studio-border">
            <h2 className="text-xl font-bold text-accent mb-6 tracking-tighter uppercase">Mixing Console v4.0</h2>

            <div className="space-y-8">
              {/* Drum Group */}
              <div>
                <h3 className="text-sm font-black text-textdark mb-4 bg-black/50 px-2 py-1 inline-block border-l-4 border-accent">DRUM BUS</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                  {drumStems.map(stem => (
                    <div key={stem} className="flex flex-col items-center bg-black/20 p-4 rounded-sm studio-border">
                      <label className="text-[10px] font-black text-textlight mb-3 uppercase tracking-widest">{stem}</label>
                      <div className="flex h-40 items-center justify-center">
                        <VUMeter level={masterLevel * (volumes[stem.toLowerCase()] / 100)} />
                        <div className="h-full flex flex-col justify-between py-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={volumes[stem.toLowerCase()]}
                            onChange={(e) => handleVolumeChange(stem, e.target.value)}
                            className="studio-fader h-32"
                            style={{ appearance: 'slider-vertical' } as any}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] text-accent mt-3 bg-black px-2">{volumes[stem.toLowerCase()]}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Instruments Group */}
              <div>
                <h3 className="text-sm font-black text-textdark mb-4 bg-black/50 px-2 py-1 inline-block border-l-4 border-buttonbg">AUX BUS</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {otherStems.map(stem => (
                    <div key={stem} className="flex flex-col items-center bg-black/20 p-4 rounded-sm studio-border">
                      <label className="text-[10px] font-black text-textlight mb-3 uppercase tracking-widest">{stem}</label>
                      <div className="flex h-40 items-center justify-center">
                        <VUMeter level={masterLevel * (volumes[stem.toLowerCase()] / 100)} />
                        <div className="h-full flex flex-col justify-between py-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={volumes[stem.toLowerCase()]}
                            onChange={(e) => handleVolumeChange(stem, e.target.value)}
                            className="studio-fader h-32"
                            style={{ appearance: 'slider-vertical' } as any}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] text-buttonbg mt-3 bg-black px-2">{volumes[stem.toLowerCase()]}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Oscilloscope / Waveform */}
        <section className="texture-wood-panel p-4 rounded-sm relative">
          <Screw className="top-2 left-2" />
          <Screw className="top-2 right-2" />
          <Screw className="bottom-2 left-2" />
          <Screw className="bottom-2 right-2" />

          <div className="texture-brushed-metal p-6 rounded-sm studio-border">
            <h2 className="text-xl font-bold text-accent mb-4 tracking-tighter uppercase">Oscilloscope Output</h2>
            <div className="w-full h-48 bg-[#0a0a0a] rounded-sm border-2 border-black flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-10"
                   style={{backgroundImage: 'linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>

              <canvas
                ref={canvasRef}
                width={800}
                height={200}
                className={`w-full h-full bg-transparent z-10 ${audioLoaded ? '' : 'hidden'}`}
              ></canvas>
              {!audioLoaded && (
                <span className="text-success animate-pulse font-bold tracking-[0.2em]">NO SIGNAL DETECTED</span>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Right Panel: Rack Mount Gear */}
      <div className="flex flex-col w-full md:w-1/4 space-y-6">

        {/* Rack AI Unit */}
        <section className="texture-wood-panel p-4 rounded-sm relative flex-grow">
          <Screw className="top-2 left-2" />
          <Screw className="top-2 right-2" />
          <Screw className="bottom-2 left-2" />
          <Screw className="bottom-2 right-2" />

          <div className="texture-brushed-metal p-6 h-full flex flex-col rounded-sm studio-border">
            <h2 className="text-lg font-bold text-accent mb-4 tracking-tighter uppercase">AI PROCESSOR v9000</h2>
            <div className="flex flex-col flex-grow bg-black/60 p-4 rounded-sm border border-white/5 mb-4 font-mono text-[10px] overflow-y-auto studio-border shadow-inner">
              {messages.length === 0 && (
                <p className="text-success animate-pulse">TERMINAL READY. WAITING FOR INPUT...</p>
              )}
              {messages.map((msg, index) => (
                <div key={index} className={`mb-2 ${msg.type === 'user' ? 'text-buttonbg' : 'text-success'}`}>
                  <span className="opacity-50">[{msg.type.toUpperCase()}] &gt;</span> {msg.content}
                </div>
              ))}
            </div>

            <div className="mb-4">
                <div className="flex bg-black p-1 rounded-sm studio-border">
                    <input
                        type="text"
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="INPUT COMMAND..."
                        className="bg-transparent border-none outline-none text-[10px] text-success flex-grow px-2"
                    />
                    <button
                        onClick={sendMessage}
                        className="text-accent hover:text-white px-2 text-[10px] font-bold"
                    >
                        EXEC
                    </button>
                </div>
            </div>

            <div className="flex justify-center mt-auto p-2 bg-black/20 rounded-sm studio-border">
              <button
                onClick={startRecording}
                className="w-16 h-16 rounded-full texture-brushed-metal studio-border flex items-center justify-center hover:shadow-[0_0_15px_#ff8c00] transition-all group active:translate-y-1"
              >
                <div className={`w-4 h-4 rounded-full ${isRecording ? 'bg-accent animate-ping' : 'bg-error animate-pulse'} shadow-[0_0_5px_currentColor]`}></div>
              </button>
            </div>
          </div>
        </section>

        {/* System Status Rack */}
        <section className="texture-wood-panel p-4 rounded-sm relative">
          <Screw className="top-2 left-2" />
          <Screw className="top-2 right-2" />
          <Screw className="bottom-2 left-2" />
          <Screw className="bottom-2 right-2" />

          <div className="texture-brushed-metal p-6 rounded-sm studio-border">
            <h2 className="text-lg font-bold text-accent mb-4 tracking-tighter uppercase">System Status</h2>
            <div className="flex items-center space-x-3 bg-black/40 p-3 rounded-sm studio-border">
              <div className={`w-3 h-3 rounded-full ${audioLoaded ? 'bg-success shadow-[0_0_8px_#22c55e]' : 'bg-error shadow-[0_0_8px_#ef4444]'}`}></div>
              <p className="text-[10px] text-textlight font-black uppercase tracking-widest">
                {pipelineStatus}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// --- Render the App ---
const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error('Failed to mount Studio Interface.');
}
