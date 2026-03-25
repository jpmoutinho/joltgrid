/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Point {
  x: number;
  y: number;
}

interface GameObject {
  pos: Point;
  vel: Point;
  radius: number;
  color: string;
  isDead?: boolean;
  deathTime?: number;
  deathPos?: Point;
  killingSegment?: { p1: Point, p2: Point };
  lastRespawnTime?: number;
  lastPowerTime?: number;
  burstEffect?: { startTime: number; pos: Point };
  dashEffect?: { startTime: number; startPos: Point; endPos: Point };
  trail: Point[];
}

interface Collectible {
  pos: Point;
  radius: number;
  id: number;
  createdAt: number;
}

interface CollectionEffect {
  pos: Point;
  startTime: number;
  color: string;
}

interface PlacedDot {
  pos: Point;
  radius: number;
  id: number;
  playerId: 'blue' | 'red';
  createdAt: number;
}

interface GameConfig {
  joltDistance: number;
  moveSpeed: number;
  killLimit: number;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGains: (GainNode | null)[] = [null, null];
  private engineOscs: (OscillatorNode[] | null)[] = [null, null];
  private synthLoopKick: AudioBufferSourceNode | null = null;
  private synthLoopSnare: AudioBufferSourceNode | null = null;
  private synthLoopBass: AudioBufferSourceNode | null = null;
  private synthLoopPad: AudioBufferSourceNode | null = null;
  private synthLoopExtraSnare: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private kickGain: GainNode | null = null;
  private snareGain: GainNode | null = null;
  private extraSnareGain: GainNode | null = null;
  private bassGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private isInitialized = false;
  private musicEnabled = true;
  private bpm = 140;

  init(bpm: number = 140) {
    if (this.isInitialized) return;
    this.bpm = bpm;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Master gain for overall volume control
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.4;

    // Add a compressor to prevent clipping and "glue" the sounds together
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
    compressor.knee.setValueAtTime(30, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

    this.masterGain.connect(compressor);
    compressor.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicEnabled ? 1.0 : 0.0;
    this.musicGain.connect(this.masterGain);

    this.kickGain = this.ctx.createGain();
    this.snareGain = this.ctx.createGain();
    this.extraSnareGain = this.ctx.createGain();
    this.bassGain = this.ctx.createGain();
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0.3; // Quiet ambient layer

    this.kickGain.connect(this.musicGain);
    this.snareGain.connect(this.musicGain);
    this.extraSnareGain.connect(this.musicGain);
    this.bassGain.connect(this.musicGain);
    this.padGain.connect(this.musicGain);

    this.isInitialized = true;
    this.startSynthLoop();
    this.resume();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(enabled ? 1.0 : 0.0, this.ctx.currentTime, 0.1);
    }
  }

  updateMusicComponent(component: 'kick' | 'snare' | 'bass' | 'pad' | 'extraSnare', enabled: boolean) {
    const gainNode = component === 'kick' ? this.kickGain : 
                     component === 'snare' ? this.snareGain : 
                     component === 'bass' ? this.bassGain : 
                     component === 'extraSnare' ? this.extraSnareGain :
                     this.padGain;
    if (this.ctx && gainNode) {
      gainNode.gain.setTargetAtTime(enabled ? 1.0 : 0.0, this.ctx.currentTime, 0.1);
    }
  }

  setBPM(bpm: number) {
    this.bpm = bpm;
    if (this.ctx && this.synthLoopKick && this.synthLoopSnare && this.synthLoopBass && this.synthLoopPad && this.synthLoopExtraSnare) {
      const rate = bpm / 140;
      this.synthLoopKick.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
      this.synthLoopSnare.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
      this.synthLoopExtraSnare.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
      this.synthLoopBass.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
      this.synthLoopPad.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
    }
  }

  private startSynthLoop() {
    if (!this.ctx || !this.masterGain) return;
    
    const sampleRate = this.ctx.sampleRate;
    const baseBpm = 140;
    const beatLen = Math.floor(sampleRate * (60 / baseBpm));
    const stepLen = Math.floor(beatLen / 4);
    const loopLen = beatLen * 16; // 4 bars loop
    
    const kickBuf = this.ctx.createBuffer(1, loopLen, sampleRate);
    const snareBuf = this.ctx.createBuffer(1, loopLen, sampleRate);
    const extraSnareBuf = this.ctx.createBuffer(1, loopLen, sampleRate);
    const bassBuf = this.ctx.createBuffer(1, loopLen, sampleRate);
    const padBuf = this.ctx.createBuffer(1, loopLen, sampleRate);

    const kickData = kickBuf.getChannelData(0);
    const snareData = snareBuf.getChannelData(0);
    const extraSnareData = extraSnareBuf.getChannelData(0);
    const bassData = bassBuf.getChannelData(0);
    const padData = padBuf.getChannelData(0);
    
    // Simple noise generator for percussion
    const noise = new Float32Array(loopLen);
    for (let i = 0; i < loopLen; i++) noise[i] = Math.random() * 2 - 1;

    let thumpPhase = 0;
    let bassPhase = 0;
    let padPhases = [0, 0, 0]; // Root, Fifth, Octave
    let lastStep = -1;

    for (let i = 0; i < loopLen; i++) {
      const step = Math.floor(i / stepLen);
      const stepPos = (i % stepLen) / stepLen;

      // Reset phases at the start of a new note for maximum "punch" and consistency
      if (step !== lastStep) {
        if (step % 4 === 0) thumpPhase = 0;
        const bassPattern = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1];
        if (bassPattern[step % 16] === 1) bassPhase = 0;
        lastStep = step;
      }

      // --- SUB THUMP (Replaces Kick) ---
      // Consistent 4/4 driving beat
      if (step % 4 === 0) {
        // Deep sub-bass sweep: 60Hz down to 30Hz
        const thumpFreq = 60 * Math.exp(-stepPos * 8) + 30;
        thumpPhase += (thumpFreq * 2 * Math.PI) / sampleRate;
        kickData[i] = Math.sin(thumpPhase) * 0.8 * Math.exp(-stepPos * 4);
      }

      // --- SNARE ---
      // Muted, lower-pitched snare for rhythm
      const snarePattern = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
      if (snarePattern[step % 16] === 1) {
        const snareNoise = noise[i] * 0.1 * Math.exp(-stepPos * 15);
        const snareBody = Math.sin(140 * (i % stepLen) / sampleRate * 2 * Math.PI) * 0.05 * Math.exp(-stepPos * 12);
        snareData[i] = snareNoise + snareBody;

        // Extra snappy snare layer
        const snapNoise = noise[i] * 0.15 * Math.exp(-stepPos * 25);
        const snapBody = Math.sin(220 * (i % stepLen) / sampleRate * 2 * Math.PI) * 0.1 * Math.exp(-stepPos * 20);
        extraSnareData[i] = snapNoise + snapBody;
      }

      // --- BASS ---
      const bassPattern = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1];
      const bassFreq = (step % 64 < 32) ? 55 : 48.99; // A1 or G1
      if (bassPattern[step % 16] === 1) {
        bassPhase += (bassFreq * 2 * Math.PI) / sampleRate;
        let val = 0;
        for (let h = 1; h < 3; h++) { // Minimal harmonics for pure sub feel
          val += Math.sin(bassPhase * h) / h;
        }
        val = Math.max(-0.8, Math.min(0.8, val * 2.0));
        bassData[i] = val * 0.15 * (1 - stepPos * 0.5);
      }

      // --- AMBIENT PAD ---
      // Continuous soft chord following the bass root
      const padFreqs = [bassFreq * 2, bassFreq * 3, bassFreq * 4]; // Octave, Octave+Fifth, Two Octaves
      let padVal = 0;
      for (let p = 0; p < padPhases.length; p++) {
        padPhases[p] += (padFreqs[p] * 2 * Math.PI) / sampleRate;
        padVal += Math.sin(padPhases[p]);
      }
      padData[i] = (padVal / 3) * 0.08;
    }
    
    this.synthLoopKick = this.ctx.createBufferSource();
    this.synthLoopKick.buffer = kickBuf;
    this.synthLoopKick.loop = true;
    this.synthLoopKick.connect(this.kickGain!);

    this.synthLoopSnare = this.ctx.createBufferSource();
    this.synthLoopSnare.buffer = snareBuf;
    this.synthLoopSnare.loop = true;
    this.synthLoopSnare.connect(this.snareGain!);

    this.synthLoopExtraSnare = this.ctx.createBufferSource();
    this.synthLoopExtraSnare.buffer = extraSnareBuf;
    this.synthLoopExtraSnare.loop = true;
    this.synthLoopExtraSnare.connect(this.extraSnareGain!);

    this.synthLoopBass = this.ctx.createBufferSource();
    this.synthLoopBass.buffer = bassBuf;
    this.synthLoopBass.loop = true;
    this.synthLoopBass.connect(this.bassGain!);

    this.synthLoopPad = this.ctx.createBufferSource();
    this.synthLoopPad.buffer = padBuf;
    this.synthLoopPad.loop = true;
    this.synthLoopPad.connect(this.padGain!);

    const startTime = this.ctx.currentTime + 0.1;
    this.synthLoopKick.start(startTime);
    this.synthLoopSnare.start(startTime);
    this.synthLoopExtraSnare.start(startTime);
    this.synthLoopBass.start(startTime);
    this.synthLoopPad.start(startTime);

    // Set initial playback rate based on current BPM
    const rate = this.bpm / 140;
    this.synthLoopKick.playbackRate.setValueAtTime(rate, startTime);
    this.synthLoopSnare.playbackRate.setValueAtTime(rate, startTime);
    this.synthLoopExtraSnare.playbackRate.setValueAtTime(rate, startTime);
    this.synthLoopBass.playbackRate.setValueAtTime(rate, startTime);
    this.synthLoopPad.playbackRate.setValueAtTime(rate, startTime);
  }

  playCoin() {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playJolt() {
    // Jolt sound removed as per user request, using music thumps instead
  }

  playKill() {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  playDash() {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playBurst() {
    if (!this.ctx || !this.masterGain) return;
    
    // Menacing low-end thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.4);
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
    
    // Add some noise for texture
    const noiseNode = this.ctx.createBufferSource();
    const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    noiseNode.buffer = noiseBuf;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    
    osc.connect(gain);
    noiseNode.connect(noiseGain);
    noiseGain.connect(filter);
    gain.connect(this.masterGain);
    filter.connect(this.masterGain);
    
    osc.start();
    noiseNode.start();
    osc.stop(this.ctx.currentTime + 0.5);
    noiseNode.stop(this.ctx.currentTime + 0.5);
  }

  updateEngine(playerIdx: number, velocity: number) {
    if (!this.ctx || !this.masterGain) return;
    
    if (!this.engineOscs[playerIdx]) {
      const oscs = [
        this.ctx.createOscillator(), 
        this.ctx.createOscillator(),
        this.ctx.createOscillator()
      ];
      const gain = this.ctx.createGain();
      
      // Melodic chord: A1 (55Hz), E2 (82.4Hz), A2 (110Hz)
      oscs[0].type = 'sine';     // Root
      oscs[1].type = 'sine';     // Fifth
      oscs[2].type = 'triangle'; // Octave + harmonics
      
      oscs[1].detune.value = 4;  // Slight detune for thickness
      oscs[2].detune.value = -4;
      
      gain.gain.value = 0;
      
      oscs.forEach(o => {
        o.connect(gain);
        o.start();
      });
      
      gain.connect(this.masterGain);
      this.engineOscs[playerIdx] = oscs;
      this.engineGains[playerIdx] = gain;
    }

    const oscs = this.engineOscs[playerIdx]!;
    const gain = this.engineGains[playerIdx]!;
    
    // Deep melodic hum that subtly shifts with velocity
    const baseFreq = 55 + velocity * 5; 
    oscs[0].frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.2);
    oscs[1].frequency.setTargetAtTime(baseFreq * 1.5, this.ctx.currentTime, 0.2);
    oscs[2].frequency.setTargetAtTime(baseFreq * 2.0, this.ctx.currentTime, 0.2);
    
    const targetGain = Math.min(0.04, velocity * 0.008);
    gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.2);
  }

  playGameOver() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    
    // Deep, dramatic chord
    const freqs = [55, 82.4, 110, 164.8]; // A1, E2, A2, E3
    freqs.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.5, now + 2);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 3);
      
      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2000, now);
      filter.frequency.exponentialRampToValueAtTime(100, now + 2);
      
      osc.connect(gain);
      gain.connect(filter);
      filter.connect(this.masterGain!);
      
      osc.start(now);
      osc.stop(now + 3);
    });
  }
}

const soundManager = new SoundManager();

type GameState = 'menu' | 'playing' | 'paused' | 'gameOver';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, _setGameState] = useState<GameState>('menu');
  const [introDone, setIntroDone] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const gameStateRef = useRef<GameState>('menu');
  
  const handleStartAudio = (initialState: GameState = 'menu') => {
    soundManager.init(140);
    soundManager.resume();
    soundManager.setMusicEnabled(true);
    setMusicEnabled(true);
    // Start with only snare and bass for the menu, thump joins in mission
    soundManager.updateMusicComponent('kick', initialState === 'playing');
    soundManager.updateMusicComponent('extraSnare', initialState === 'playing');
    soundManager.updateMusicComponent('snare', true);
    soundManager.updateMusicComponent('bass', true);
    soundManager.updateMusicComponent('pad', true);
    setAudioStarted(true);
  };

  const handleRevertToIntro = () => {
    setIntroDone(false);
    setAudioStarted(false);
    soundManager.setMusicEnabled(false);
  };

  const toggleMusic = () => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    soundManager.setMusicEnabled(next);
    soundManager.resume();
  };

  const setGameState = (s: GameState) => {
    if (s === 'playing' && !audioStarted) {
      handleStartAudio('playing');
    } else if (audioStarted) {
      soundManager.resume();
      // Thump and extra snare only play during mission
      soundManager.updateMusicComponent('kick', s === 'playing');
      soundManager.updateMusicComponent('extraSnare', s === 'playing');
    }
    _setGameState(s);
    gameStateRef.current = s;
  };

  const [config, _setConfig] = useState<GameConfig>({
    joltDistance: 250,
    moveSpeed: 0.3,
    killLimit: 10
  });
  const configRef = useRef<GameConfig>(config);
  const setConfig = (c: GameConfig | ((prev: GameConfig) => GameConfig)) => {
    if (typeof c === 'function') {
      const next = c(configRef.current);
      _setConfig(next);
      configRef.current = next;
    } else {
      _setConfig(c);
      configRef.current = c;
    }
  };
  const [scores, _setScores] = useState({ blue: 0, red: 0, blueKills: 0, redKills: 0 });
  const scoresRef = useRef(scores);
  const setScores = (s: any | ((prev: any) => any)) => {
    let next;
    if (typeof s === 'function') {
      next = s(scoresRef.current);
    } else {
      next = s;
    }
    _setScores(next);
    scoresRef.current = next;

    // Check for win condition
    const limit = configRef.current.killLimit;
    if (limit > 0 && gameStateRef.current === 'playing') {
      if (next.blueKills >= limit || next.redKills >= limit) {
        const winnerColor = next.blueKills >= limit ? 'blue' : 'red';
        setWinner(winnerColor);
        soundManager.playGameOver();
        
        // Delay the actual game over screen
        setTimeout(() => {
          setGameState('gameOver');
        }, 1000);
      }
    }
  };
  const resetGame = (goToMenu: boolean = false) => {
    collectiblesRef.current = [];
    for (let i = 0; i < 5; i++) spawnCollectible(window.innerWidth, window.innerHeight);
    playersRef.current.forEach((p, idx) => {
      p.pos = getSpawnPos(idx === 0 ? 'blue' : 'red', window.innerWidth, window.innerHeight);
      p.vel = { x: 0, y: 0 };
      p.isDead = false;
      p.trail = [];
      p.deathTime = undefined;
      p.deathPos = undefined;
      p.killingSegment = undefined;
    });
    placedDotsRef.current = [];
    connectionsRef.current = { blue: [], red: [] };
    _setScores({ blue: 0, red: 0, blueKills: 0, redKills: 0 });
    scoresRef.current = { blue: 0, red: 0, blueKills: 0, redKills: 0 };
    setWinner(null);
    if (goToMenu) {
      setGameState('menu');
    } else {
      setGameState('playing');
      lastHeartbeatRef.current = performance.now();
    }
  };

  const [dashCooldowns, setDashCooldowns] = useState({ blue: 1, red: 1 });
  const [winner, setWinner] = useState<'blue' | 'red' | null>(null);
  
  // Game state refs to avoid re-renders on every frame
  const playersRef = useRef<GameObject[]>([
    {
      pos: { x: 300, y: 300 },
      vel: { x: 0, y: 0 },
      radius: 12,
      color: '#3b82f6', // blue-500
      trail: [],
      isDead: false,
      lastDashTime: 0
    },
    {
      pos: { x: 500, y: 300 },
      vel: { x: 0, y: 0 },
      radius: 12,
      color: '#ef4444', // red-500
      trail: [],
      isDead: false,
      lastDashTime: 0
    }
  ]);
  
  const collectiblesRef = useRef<Collectible[]>([]);
  const collectionEffectsRef = useRef<CollectionEffect[]>([]);
  const placedDotsRef = useRef<PlacedDot[]>([]);
  const connectionsRef = useRef<{ blue: {p1: Point, p2: Point}[], red: {p1: Point, p2: Point}[] }>({
    blue: [],
    red: []
  });
  const keysRef = useRef<Record<string, boolean>>({});
  const lastTimeRef = useRef<number>(0);
  const lastHeartbeatRef = useRef<number>(0);
  const nextCollectibleIdRef = useRef(0);
  const nextPlacedDotIdRef = useRef(0);

  // Constants
  const ACCELERATION = 0.3; // Slower motion
  const FRICTION = 0.95;
  const MAX_COLLECTIBLES = 10;
  const HEARTBEAT_INTERVAL = 2000;
  const JOLT_DURATION = 300;
  const getSafeZoneRadius = () => configRef.current.joltDistance * 0.55;
  const DASH_COOLDOWN = 5000; // 5 seconds
  const DASH_DISTANCE = 120;
  const DASH_DURATION = 300; // Animation duration
  const POWER_COOLDOWN = 5000; // Shared cooldown
  const BURST_DISTANCE = DASH_DISTANCE;
  const BURST_DURATION = 600; // Longer animation for "impressive" feel
  const RESPAWN_DELAY = 2000; // 2 seconds

  const getSpawnPos = (playerId: 'blue' | 'red', width: number, height: number) => {
    if (playerId === 'blue') return { x: width * 0.1, y: height / 2 };
    return { x: width * 0.9, y: height / 2 };
  };

  // Helper for point-to-segment distance
  const distToSegment = (p: Point, v: Point, w: Point) => {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2);
  };

  const updateConnections = (dots: PlacedDot[], height: number) => {
    const threshold = configRef.current.joltDistance;
    const thresholdSq = threshold * threshold;
    const blueConns: {p1: Point, p2: Point}[] = [];
    const redConns: {p1: Point, p2: Point}[] = [];
    
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const d1 = dots[i];
        const d2 = dots[j];
        if (d1.playerId !== d2.playerId) continue;

        const dx = d1.pos.x - d2.pos.x;
        const dy = d1.pos.y - d2.pos.y;
        const distSq = dx * dx + dy * dy;
        
        if (distSq < thresholdSq) {
          if (d1.playerId === 'blue') blueConns.push({ p1: d1.pos, p2: d2.pos });
          else redConns.push({ p1: d1.pos, p2: d2.pos });
        }
      }
    }
    connectionsRef.current = { blue: blueConns, red: redConns };
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      
      if (key === 'escape' && gameStateRef.current === 'playing') {
        setGameState('paused');
        return;
      }
      if (key === 'escape' && gameStateRef.current === 'paused') {
        setGameState('playing');
        return;
      }

      if (gameStateRef.current !== 'playing') return;

      keysRef.current[key] = true;

      // Handle dot placement
      if (key === '1' || key === 'i') {
        const playerId = key === '1' ? 'blue' : 'red';
        const playerIdx = playerId === 'blue' ? 0 : 1;
        const player = playersRef.current[playerIdx];

        // Check safe zones
        const blueSpawn = getSpawnPos('blue', window.innerWidth, window.innerHeight);
        const redSpawn = getSpawnPos('red', window.innerWidth, window.innerHeight);
        
        const distToBlueSafe = Math.sqrt((player.pos.x - blueSpawn.x)**2 + (player.pos.y - blueSpawn.y)**2);
        const distToRedSafe = Math.sqrt((player.pos.x - redSpawn.x)**2 + (player.pos.y - redSpawn.y)**2);

        const safeRadius = getSafeZoneRadius();
        if (distToBlueSafe < safeRadius || distToRedSafe < safeRadius) {
          return; // Cannot place in safe zones
        }

        setScores(current => {
          if (current[playerId] > 0) {
            const newDot = {
              pos: { ...playersRef.current[playerIdx].pos },
              radius: 6,
              id: nextPlacedDotIdRef.current++,
              playerId,
              createdAt: performance.now()
            };
            
            // Add new connections for this dot
            const threshold = configRef.current.joltDistance;
            const thresholdSq = threshold * threshold;
            for (const existingDot of placedDotsRef.current) {
              if (existingDot.playerId !== playerId) continue;
              const dx = newDot.pos.x - existingDot.pos.x;
              const dy = newDot.pos.y - existingDot.pos.y;
              const distSq = dx * dx + dy * dy;
              if (distSq < thresholdSq) {
                connectionsRef.current[playerId].push({ p1: newDot.pos, p2: existingDot.pos });
              }
            }
            
            placedDotsRef.current.push(newDot);
            return { ...current, [playerId]: current[playerId] - 1 };
          }
          return current;
        });
      }

      // Handle burst
      if (key === '2' || key === 'o') {
        const playerId = key === '2' ? 'blue' : 'red';
        const playerIdx = playerId === 'blue' ? 0 : 1;
        const adversaryIdx = playerId === 'blue' ? 1 : 0;
        const player = playersRef.current[playerIdx];
        const adversary = playersRef.current[adversaryIdx];
        const time = performance.now();

        // Check shared power cooldown
        if (player.lastPowerTime && time - player.lastPowerTime < POWER_COOLDOWN) {
          return;
        }

        player.lastPowerTime = time;
        player.burstEffect = { startTime: time, pos: { ...player.pos } };
        soundManager.playBurst();
      }

      // Handle dash
      if (key === '3' || key === 'p') {
        const playerId = key === '3' ? 'blue' : 'red';
        const playerIdx = playerId === 'blue' ? 0 : 1;
        const player = playersRef.current[playerIdx];
        const time = performance.now();

        // Check shared power cooldown
        if (player.lastPowerTime && time - player.lastPowerTime < POWER_COOLDOWN) {
          return;
        }

        // Check if moving
        const speed = Math.sqrt(player.vel.x ** 2 + player.vel.y ** 2);
        if (speed < 0.1) return;

        // Calculate dash
        const dirX = player.vel.x / speed;
        const dirY = player.vel.y / speed;
        
        const startPos = { ...player.pos };
        player.pos.x += dirX * DASH_DISTANCE;
        player.pos.y += dirY * DASH_DISTANCE;
        const endPos = { ...player.pos };

        player.lastPowerTime = time;
        player.dashEffect = { startTime: time, startPos, endPos };
        
        soundManager.playDash();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const spawnCollectible = (width: number, height: number) => {
    if (collectiblesRef.current.length < MAX_COLLECTIBLES) {
      const margin = 50;
      collectiblesRef.current.push({
        pos: {
          x: margin + Math.random() * (width - margin * 2),
          y: margin + Math.random() * (height - margin * 2)
        },
        radius: 6,
        id: nextCollectibleIdRef.current++,
        createdAt: performance.now()
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // Update player positions if they are in the menu
      if (gameStateRef.current === 'menu') {
        playersRef.current[0].pos = getSpawnPos('blue', canvas.width, canvas.height);
        playersRef.current[1].pos = getSpawnPos('red', canvas.width, canvas.height);
      }

      // Re-calculate connections based on new height
      updateConnections(placedDotsRef.current, canvas.height);
    };

    window.addEventListener('resize', resize);
    resize();

    const update = (time: number) => {
      if (gameStateRef.current !== 'playing') {
        lastTimeRef.current = time;
        requestAnimationFrame(update);
        return;
      }

      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;

      const keys = keysRef.current;

      // Heartbeat logic (synchronized with BPM: every 2 beats = every 2nd thump)
      const joltDelay = (60 / 140) * 2 * 1000;
      if (time - lastHeartbeatRef.current > joltDelay) {
        lastHeartbeatRef.current = time;
        if (placedDotsRef.current.length > 0) {
          soundManager.playJolt();
        }
      }
      const joltProgress = time - lastHeartbeatRef.current;
      const isJolting = joltProgress < JOLT_DURATION;
      const isDeadly = joltProgress > JOLT_DURATION * 0.33 && joltProgress < JOLT_DURATION * 0.66;

      // Respawn dead players after delay
      playersRef.current.forEach((player, idx) => {
        if (player.isDead && player.deathTime && time - player.deathTime > RESPAWN_DELAY) {
          player.isDead = false;
          player.pos = getSpawnPos(idx === 0 ? 'blue' : 'red', canvas.width, canvas.height);
          player.vel = { x: 0, y: 0 };
          player.lastRespawnTime = time;
          player.deathTime = undefined;
        }
      });

      // Update both players
      playersRef.current.forEach((player, idx) => {
        if (player.isDead) {
          soundManager.updateEngine(idx, 0);
          return;
        }

        const vel = Math.sqrt(player.vel.x ** 2 + player.vel.y ** 2);
        soundManager.updateEngine(idx, vel);

        let ax = 0;
        let ay = 0;

        if (idx === 0) { // Blue Player (WASD)
          if (keys['w']) ay -= configRef.current.moveSpeed;
          if (keys['s']) ay += configRef.current.moveSpeed;
          if (keys['a']) ax -= configRef.current.moveSpeed;
          if (keys['d']) ax += configRef.current.moveSpeed;
        } else { // Red Player (Arrows)
          if (keys['arrowup']) ay -= configRef.current.moveSpeed;
          if (keys['arrowdown']) ay += configRef.current.moveSpeed;
          if (keys['arrowleft']) ax -= configRef.current.moveSpeed;
          if (keys['arrowright']) ax += configRef.current.moveSpeed;
        }

        player.vel.x += ax;
        player.vel.y += ay;
        player.vel.x *= FRICTION;
        player.vel.y *= FRICTION;
        player.pos.x += player.vel.x;
        player.pos.y += player.vel.y;

        // Update trail
        player.trail.push({ x: player.pos.x, y: player.pos.y });
        if (player.trail.length > 20) {
          player.trail.shift();
        }

        // Boundary checks
        if (player.pos.x < player.radius) {
          player.pos.x = player.radius;
          player.vel.x *= -0.5;
        }
        if (player.pos.x > canvas.width - player.radius) {
          player.pos.x = canvas.width - player.radius;
          player.vel.x *= -0.5;
        }
        if (player.pos.y < player.radius) {
          player.pos.y = player.radius;
          player.vel.y *= -0.5;
        }
        if (player.pos.y > canvas.height - player.radius) {
          player.pos.y = canvas.height - player.radius;
          player.vel.y *= -0.5;
        }
      });

      // Collision detection with collectibles
      const remainingCollectibles: Collectible[] = [];
      let blueCollected = 0;
      let redCollected = 0;

      for (const item of collectiblesRef.current) {
        let collected = false;
        for (let i = 0; i < playersRef.current.length; i++) {
          const p = playersRef.current[i];
          const dx = p.pos.x - item.pos.x;
          const dy = p.pos.y - item.pos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < p.radius + item.radius) {
            if (i === 0) blueCollected++;
            else redCollected++;
            collected = true;
            
            // Add collection effect
            collectionEffectsRef.current.push({
              pos: { ...item.pos },
              startTime: time,
              color: i === 0 ? '#3b82f6' : '#ef4444'
            });
            break;
          }
        }
        if (!collected) remainingCollectibles.push(item);
      }

      if (blueCollected > 0 || redCollected > 0) {
        setScores(prev => ({
          ...prev,
          blue: prev.blue + blueCollected,
          red: prev.red + redCollected
        }));
        collectiblesRef.current = remainingCollectibles;
        soundManager.playCoin();
      }

      // Update power cooldowns for UI
      setDashCooldowns({
        blue: Math.max(0, Math.min(1, (time - (playersRef.current[0].lastPowerTime || 0)) / POWER_COOLDOWN)),
        red: Math.max(0, Math.min(1, (time - (playersRef.current[1].lastPowerTime || 0)) / POWER_COOLDOWN))
      });

      // Spawn new collectibles
      if (Math.random() < 0.02) {
        spawnCollectible(canvas.width, canvas.height);
      }

      // Collect opposing player's dots when jolt is inactive
      if (!isJolting) {
        let dotsChanged = false;
        const remainingDots: PlacedDot[] = [];
        let blueDotBonus = 0;
        let redDotBonus = 0;

        for (const dot of placedDotsRef.current) {
          let collected = false;
          for (let i = 0; i < playersRef.current.length; i++) {
            const p = playersRef.current[i];
            if (p.isDead) continue;
            
            const pId = i === 0 ? 'blue' : 'red';
            if (dot.playerId === pId) continue; // Can't collect own dots

            const dx = p.pos.x - dot.pos.x;
            const dy = p.pos.y - dot.pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < p.radius + dot.radius) {
              if (i === 0) blueDotBonus++;
              else redDotBonus++;
              collected = true;
              dotsChanged = true;
              break;
            }
          }
          if (!collected) remainingDots.push(dot);
        }

        if (dotsChanged) {
          placedDotsRef.current = remainingDots;
          setScores(prev => ({
            ...prev,
            blue: prev.blue + blueDotBonus,
            red: prev.red + redDotBonus
          }));
          updateConnections(placedDotsRef.current, canvas.height);
          soundManager.playCoin();
        }
      }

      // Update collection effects
      collectionEffectsRef.current = collectionEffectsRef.current.filter(effect => {
        const age = time - effect.startTime;
        return age < 500; // 500ms duration
      });

      // Update burst collisions
      playersRef.current.forEach((player, idx) => {
        if (player.burstEffect && time - player.burstEffect.startTime < BURST_DURATION) {
          const progress = (time - player.burstEffect.startTime) / BURST_DURATION;
          // Use the same radius calculation as in the drawing logic
          const currentRadius = progress * BURST_DISTANCE * 1.2;
          const adversaryIdx = idx === 0 ? 1 : 0;
          const adversary = playersRef.current[adversaryIdx];
          
          if (!adversary.isDead) {
            const adversarySpawn = getSpawnPos(adversaryIdx === 0 ? 'blue' : 'red', canvas.width, canvas.height);
            const inSafeZone = Math.sqrt((adversary.pos.x - adversarySpawn.x) ** 2 + (adversary.pos.y - adversarySpawn.y) ** 2) < getSafeZoneRadius();

            const dx = adversary.pos.x - player.burstEffect.pos.x;
            const dy = adversary.pos.y - player.burstEffect.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // Ring thickness for collision
            const ringThickness = 15;
            if (!inSafeZone && Math.abs(dist - currentRadius) < ringThickness + adversary.radius) {
              const playerId = idx === 0 ? 'blue' : 'red';
              setScores((prev: any) => ({
                ...prev,
                [playerId === 'blue' ? 'red' : 'blue']: 0,
                [playerId === 'blue' ? 'blueKills' : 'redKills']: prev[playerId === 'blue' ? 'blueKills' : 'redKills'] + 1
              }));
              adversary.isDead = true;
              adversary.deathTime = time;
              adversary.deathPos = { ...adversary.pos };
              adversary.killingSegment = { p1: player.burstEffect.pos, p2: adversary.pos }; 
              soundManager.playKill();
            }
          }
        }
      });

      // Draw
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw background grid (Neon Synth Aesthetic)
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.15)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw Safe Zones
      const blueSpawn = getSpawnPos('blue', canvas.width, canvas.height);
      const redSpawn = getSpawnPos('red', canvas.width, canvas.height);
      const safeRadius = getSafeZoneRadius();
      
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      
      // Blue Safe Zone
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
      ctx.beginPath();
      ctx.arc(blueSpawn.x, blueSpawn.y, safeRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fill();

      // Red Safe Zone
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.beginPath();
      ctx.arc(redSpawn.x, redSpawn.y, safeRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
      ctx.fill();
      
      ctx.setLineDash([]);

      // Draw electric jolts and check for kills
      if (isJolting) {
        const opacity = 1 - (joltProgress / JOLT_DURATION);
        const KILL_THRESHOLD = 8; // Distance from line to be killed
        
        // Blue jolts
        if (connectionsRef.current.blue.length > 0) {
          ctx.strokeStyle = `rgba(59, 130, 246, ${opacity * (isDeadly ? 1 : 0.4)})`;
          ctx.lineWidth = isDeadly ? 6 : 2;
          ctx.shadowBlur = (isDeadly ? 20 : 5) * opacity;
          ctx.shadowColor = '#3b82f6';
          ctx.beginPath();
          for (const conn of connectionsRef.current.blue) {
            ctx.moveTo(conn.p1.x, conn.p1.y);
            ctx.lineTo(conn.p2.x, conn.p2.y);
            
            // Check if Red player (idx 1) is hit by Blue jolt
            const redPlayer = playersRef.current[1];
            const redSpawn = getSpawnPos('red', canvas.width, canvas.height);
            const inSafeZone = Math.sqrt((redPlayer.pos.x - redSpawn.x) ** 2 + (redPlayer.pos.y - redSpawn.y) ** 2) < getSafeZoneRadius();
            
            if (isDeadly && !redPlayer.isDead && !inSafeZone && distToSegment(redPlayer.pos, conn.p1, conn.p2) < KILL_THRESHOLD + redPlayer.radius) {
              setScores(prev => ({ ...prev, red: 0, blueKills: prev.blueKills + 1 }));
              redPlayer.isDead = true;
              redPlayer.deathTime = time;
              redPlayer.deathPos = { ...redPlayer.pos };
              redPlayer.killingSegment = conn;
              soundManager.playKill();
            }
          }
          ctx.stroke();
        }

        // Red jolts
        if (connectionsRef.current.red.length > 0) {
          ctx.strokeStyle = `rgba(239, 68, 68, ${opacity * (isDeadly ? 1 : 0.4)})`;
          ctx.lineWidth = isDeadly ? 6 : 2;
          ctx.shadowBlur = (isDeadly ? 20 : 5) * opacity;
          ctx.shadowColor = '#ef4444';
          ctx.beginPath();
          for (const conn of connectionsRef.current.red) {
            ctx.moveTo(conn.p1.x, conn.p1.y);
            ctx.lineTo(conn.p2.x, conn.p2.y);

            // Check if Blue player (idx 0) is hit by Red jolt
            const bluePlayer = playersRef.current[0];
            const blueSpawn = getSpawnPos('blue', canvas.width, canvas.height);
            const inSafeZone = Math.sqrt((bluePlayer.pos.x - blueSpawn.x) ** 2 + (bluePlayer.pos.y - blueSpawn.y) ** 2) < getSafeZoneRadius();

            if (isDeadly && !bluePlayer.isDead && !inSafeZone && distToSegment(bluePlayer.pos, conn.p1, conn.p2) < KILL_THRESHOLD + bluePlayer.radius) {
              setScores(prev => ({ ...prev, blue: 0, redKills: prev.redKills + 1 }));
              bluePlayer.isDead = true;
              bluePlayer.deathTime = time;
              bluePlayer.deathPos = { ...bluePlayer.pos };
              bluePlayer.killingSegment = conn;
              soundManager.playKill();
            }
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // Draw collectibles (Golden Yellow with Pulsating Glow)
      const glowScale = 0.5 + 0.5 * Math.sin(time / 200);
      const SPAWN_ANIM_DURATION = 400;

      for (const item of collectiblesRef.current) {
        let radius = item.radius;
        const age = time - item.createdAt;
        
        if (age < SPAWN_ANIM_DURATION) {
          const progress = age / SPAWN_ANIM_DURATION;
          // Elastic pop-in
          const scale = Math.sin(progress * Math.PI * 0.5) * 1.2;
          radius *= scale;
        }

        ctx.fillStyle = '#fbbf24'; // amber-400
        ctx.beginPath();
        ctx.arc(item.pos.x, item.pos.y, Math.max(0.1, radius), 0, Math.PI * 2);
        ctx.fill();
        
        ctx.shadowBlur = (10 + 15 * glowScale) * (radius / item.radius);
        ctx.shadowColor = '#f59e0b'; // amber-500
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw collection effects
      for (const effect of collectionEffectsRef.current) {
        const age = time - effect.startTime;
        const progress = age / 500;
        const radius = Math.max(0.1, 6 + progress * 30);
        const opacity = Math.max(0, 1 - progress);
        
        ctx.strokeStyle = effect.color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw placed dots
      const PLACEMENT_EFFECT_DURATION = 300;

      for (const item of placedDotsRef.current) {
        ctx.fillStyle = item.playerId === 'blue' ? '#3b82f6' : '#ef4444';
        
        let radius = item.radius;
        const age = time - item.createdAt;
        
        // Handle placement effect
        if (age < PLACEMENT_EFFECT_DURATION) {
          const progress = age / PLACEMENT_EFFECT_DURATION;
          // Pulse effect: expand then contract
          const scale = 1 + Math.sin(Math.PI * progress) * 1.2;
          radius *= scale;
          
          // Add a little glow during placement
          ctx.shadowBlur = 15 * Math.sin(Math.PI * progress);
          ctx.shadowColor = ctx.fillStyle;
        }

        // Handle jolt effect (expand then contract)
        if (isJolting) {
          const progress = joltProgress / JOLT_DURATION;
          const scale = 1 + Math.sin(Math.PI * progress) * 1.5;
          radius *= scale;
          
          // Add extra glow during jolt
          ctx.shadowBlur = Math.max(ctx.shadowBlur || 0, 20 * Math.sin(Math.PI * progress));
          ctx.shadowColor = ctx.fillStyle;
        }

        ctx.beginPath();
        ctx.arc(item.pos.x, item.pos.y, Math.max(0.1, radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw players
      playersRef.current.forEach(player => {
        const RESPAWN_EFFECT_DURATION = 500;
        
        // Draw trail
        if (!player.isDead) {
          player.trail.forEach((p, i) => {
            const opacity = (i / player.trail.length) * 0.5;
            const size = Math.max(0.1, player.radius * (0.3 + (i / player.trail.length) * 0.7));
            ctx.fillStyle = player.color;
            ctx.globalAlpha = opacity;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.globalAlpha = 1.0;
        }

        if (player.isDead && player.deathPos && player.killingSegment) {
          const opacity = 1 - (joltProgress / JOLT_DURATION);
          ctx.save();
          ctx.globalAlpha = opacity;
          
          // Draw connecting jolt to the line that killed them
          const v = player.killingSegment.p1;
          const w = player.killingSegment.p2;
          const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
          let t = ((player.deathPos.x - v.x) * (w.x - v.x) + (player.deathPos.y - v.y) * (w.y - v.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          const nx = v.x + t * (w.x - v.x);
          const ny = v.y + t * (w.y - v.y);
          
          ctx.strokeStyle = player.color === '#3b82f6' ? '#ef4444' : '#3b82f6'; // Color of the killing jolt
          ctx.lineWidth = 3;
          ctx.shadowBlur = 10;
          ctx.shadowColor = ctx.strokeStyle;
          ctx.beginPath();
          ctx.moveTo(player.deathPos.x, player.deathPos.y);
          ctx.lineTo(nx, ny);
          ctx.stroke();

          // Draw fading player dot
          ctx.fillStyle = player.color;
          ctx.beginPath();
          ctx.arc(player.deathPos.x, player.deathPos.y, player.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (!player.isDead) {
          // Draw respawn burst effect
          if (player.lastRespawnTime && time - player.lastRespawnTime < RESPAWN_EFFECT_DURATION) {
            const progress = (time - player.lastRespawnTime) / RESPAWN_EFFECT_DURATION;
            const burstRadius = Math.max(0.1, player.radius * (1 + progress * 3));
            const burstOpacity = Math.max(0, 1 - progress);
            
            ctx.save();
            ctx.strokeStyle = player.color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = burstOpacity;
            ctx.beginPath();
            ctx.arc(player.pos.x, player.pos.y, burstRadius, 0, Math.PI * 2);
            ctx.stroke();
            
            // Inner glow
            ctx.shadowBlur = 20 * burstOpacity;
            ctx.shadowColor = player.color;
            ctx.stroke();
            ctx.restore();
          }

          // Draw dash effect
          if (player.dashEffect && time - player.dashEffect.startTime < DASH_DURATION) {
            const progress = (time - player.dashEffect.startTime) / DASH_DURATION;
            const opacity = 1 - progress;
            
            ctx.save();
            ctx.strokeStyle = player.color;
            ctx.lineWidth = player.radius * 2 * (1 - progress);
            ctx.globalAlpha = opacity * 0.5;
            ctx.beginPath();
            ctx.moveTo(player.dashEffect.startPos.x, player.dashEffect.startPos.y);
            ctx.lineTo(player.dashEffect.endPos.x, player.dashEffect.endPos.y);
            ctx.stroke();
            
            // Add some particles along the path
            for (let i = 0; i < 5; i++) {
              const t = Math.random();
              const px = player.dashEffect.startPos.x + (player.dashEffect.endPos.x - player.dashEffect.startPos.x) * t;
              const py = player.dashEffect.startPos.y + (player.dashEffect.endPos.y - player.dashEffect.startPos.y) * t;
              ctx.fillStyle = player.color;
              ctx.globalAlpha = opacity * Math.random();
              ctx.beginPath();
              ctx.arc(px, py, Math.random() * 3, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }

          // Draw burst effect
          if (player.burstEffect && time - player.burstEffect.startTime < BURST_DURATION) {
            const progress = (time - player.burstEffect.startTime) / BURST_DURATION;
            const opacity = 1 - progress;
            
            ctx.save();
            
            // Multiple rings for a "shockwave" feel
            for (let r = 0; r < 3; r++) {
              const ringProgress = Math.max(0, progress - r * 0.15);
              if (ringProgress <= 0) continue;
              
              const radius = ringProgress * BURST_DISTANCE * 1.2;
              const ringOpacity = (1 - ringProgress) * opacity;
              
              ctx.strokeStyle = player.color;
              ctx.lineWidth = 6 * (1 - ringProgress);
              ctx.globalAlpha = ringOpacity;
              ctx.beginPath();
              ctx.arc(player.burstEffect.pos.x, player.burstEffect.pos.y, radius, 0, Math.PI * 2);
              ctx.stroke();
              
              // Glow
              ctx.shadowBlur = 30 * ringOpacity;
              ctx.shadowColor = player.color;
              ctx.stroke();
            }
            
            // Central distortion flash
            const flashRadius = (1 - progress) * player.radius * 4;
            ctx.fillStyle = 'white';
            ctx.globalAlpha = opacity * 0.3;
            ctx.beginPath();
            ctx.arc(player.burstEffect.pos.x, player.burstEffect.pos.y, flashRadius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
          }

          ctx.fillStyle = player.color;
          ctx.beginPath();
          ctx.arc(player.pos.x, player.pos.y, player.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });

      requestAnimationFrame(update);
    };

    // Initial spawn
    if (gameStateRef.current === 'playing') {
      for (let i = 0; i < 5; i++) spawnCollectible(canvas.width, canvas.height);
    }

    const animationId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);



  return (
    <div className="relative w-full h-screen bg-gray-50 overflow-hidden font-sans">
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-none"
      />
      
      {gameState === 'menu' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white p-8 text-center z-50 overflow-auto">
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
            backgroundImage: `linear-gradient(to right, #3b82f6 1px, transparent 1px), linear-gradient(to bottom, #3b82f6 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            transform: 'perspective(500px) rotateX(60deg) translateY(0)',
            transformOrigin: 'top'
          }} />
          
          <div className="relative z-10 flex flex-col items-center justify-center w-full min-h-full">
            {!introDone ? (
              <motion.div 
                layoutId="logo-container"
                className="cursor-pointer group"
                onClick={() => {
                  setIntroDone(true);
                  handleStartAudio();
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <motion.h1 
                  layoutId="logo-text"
                  className="text-8xl md:text-9xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-blue-400 to-purple-600 drop-shadow-[0_0_30px_rgba(59,130,246,0.8)] group-hover:drop-shadow-[0_0_50px_rgba(59,130,246,1)] transition-all duration-500"
                >
                  JOLT GRID
                </motion.h1>
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-xs font-mono tracking-[0.8em] text-blue-400 uppercase opacity-50 mt-4 group-hover:opacity-100 transition-opacity"
                >
                  Click to Initialize
                </motion.p>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center gap-12 max-w-4xl w-full py-12">
                <motion.div 
                  layoutId="logo-container"
                  className="space-y-2 cursor-pointer group"
                  onClick={handleRevertToIntro}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <motion.h1 
                    layoutId="logo-text"
                    className="text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-blue-400 to-purple-600 drop-shadow-[0_0_20px_rgba(59,130,246,0.6)] group-hover:drop-shadow-[0_0_30px_rgba(59,130,246,0.8)] transition-all duration-300"
                  >
                    JOLT GRID
                  </motion.h1>
                  <p className="text-xs font-mono tracking-[0.5em] text-blue-400 uppercase opacity-70 group-hover:opacity-100 transition-opacity">
                    Neural Combat Simulation v1.1.0
                  </p>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.8 }}
                  className="w-full flex flex-col items-center gap-12"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-lg">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 space-y-6">
                      <div className="flex justify-center">
                        <div className="text-[10px] font-black text-blue-400 tracking-[0.2em] uppercase">Player 01</div>
                      </div>
                      <div className="space-y-3 font-mono">
                        <div className="flex justify-between items-center border-b border-blue-500/10 pb-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Move</span>
                          <span className="text-sm font-black italic text-blue-400">WASD</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-blue-500/10 pb-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Place</span>
                          <span className="text-sm font-black text-blue-400">1</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-blue-500/10 pb-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Burst</span>
                          <span className="text-sm font-black text-blue-400">2</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Dash</span>
                          <span className="text-sm font-black text-blue-400">3</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 space-y-6">
                      <div className="flex justify-center">
                        <div className="text-[10px] font-black text-red-400 tracking-[0.2em] uppercase">Player 02</div>
                      </div>
                      <div className="space-y-3 font-mono">
                        <div className="flex justify-between items-center border-b border-red-500/10 pb-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Move</span>
                          <span className="text-sm font-black italic text-red-400">ARROWS</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-red-500/10 pb-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Place</span>
                          <span className="text-sm font-black text-red-400">I</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-red-500/10 pb-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Burst</span>
                          <span className="text-sm font-black text-red-400">O</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Dash</span>
                          <span className="text-sm font-black text-red-400">P</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-6 w-full max-w-xs">
                    <div className="flex gap-3 justify-center">
                      {audioStarted && (
                        <>
                          <button 
                            onClick={() => setShowConfig(true)}
                            className="w-14 h-14 flex items-center justify-center rounded-2xl bg-gray-900/50 border border-gray-700 text-gray-400 hover:text-white hover:border-blue-500/50 transition-all active:scale-90"
                            title="Configuration"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button 
                            onClick={toggleMusic}
                            className={`w-14 h-14 flex items-center justify-center rounded-2xl border transition-all active:scale-90 ${
                              musicEnabled 
                                ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' 
                                : 'bg-gray-900/50 border-gray-700 text-gray-500'
                            }`}
                            title={musicEnabled ? "Disable Music" : "Enable Music"}
                          >
                            {musicEnabled ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                            )}
                          </button>
                        </>
                      )}
                    </div>

                    {!audioStarted ? (
                      <button 
                        onClick={handleStartAudio}
                        className="group relative px-8 py-6 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest rounded-3xl transition-all shadow-[0_0_30px_rgba(59,130,246,0.4)] active:scale-95 overflow-hidden"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                        INITIALIZE AUDIO
                      </button>
                    ) : (
                      <button 
                        onClick={() => {
                          resetGame(false);
                        }}
                        className="group relative px-8 py-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-black uppercase tracking-widest rounded-3xl transition-all shadow-[0_0_40px_rgba(59,130,246,0.5)] hover:shadow-[0_0_60px_rgba(59,130,246,0.7)] hover:scale-105 active:scale-95 overflow-hidden"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/10" />
                        START MISSION
                      </button>
                    )}
                    
                    <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.4em]">
                      Authorized Personnel Only
                    </p>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        </div>
      )}

      {showConfig && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-xl z-[60] p-4">
          <div className="w-full max-w-md bg-gray-900 border border-blue-500/30 rounded-[2rem] shadow-[0_0_50px_rgba(59,130,246,0.2)] overflow-hidden">
            <div className="p-8 space-y-8">
              <div className="flex justify-between items-center border-b border-gray-800 pb-4">
                <h3 className="text-xl font-black italic tracking-tighter text-blue-400 uppercase">System Config</h3>
                <button 
                  onClick={() => setShowConfig(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              
              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-mono text-blue-400 uppercase tracking-widest">
                    <span>Jolt Range</span>
                    <span className="text-white">{config.joltDistance}px</span>
                  </div>
                  <input 
                    type="range" min="100" max="500" step="10"
                    value={config.joltDistance}
                    onChange={(e) => setConfig(prev => ({ ...prev, joltDistance: parseInt(e.target.value) }))}
                    className="w-full accent-blue-500 bg-gray-800 h-1.5 rounded-full appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-mono text-blue-400 uppercase tracking-widest">
                    <span>Move Speed</span>
                    <span className="text-white">{config.moveSpeed.toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0.1" max="1.0" step="0.05"
                    value={config.moveSpeed}
                    onChange={(e) => setConfig(prev => ({ ...prev, moveSpeed: parseFloat(e.target.value) }))}
                    className="w-full accent-blue-500 bg-gray-800 h-1.5 rounded-full appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-mono text-blue-400 uppercase tracking-widest">
                    <span>Kill Limit</span>
                    <span className="text-white">{config.killLimit === 0 ? 'Unlimited' : `${config.killLimit} Kills`}</span>
                  </div>
                  <input 
                    type="range" min="0" max="20" step="1"
                    value={config.killLimit}
                    onChange={(e) => setConfig(prev => ({ ...prev, killLimit: parseInt(e.target.value) }))}
                    className="w-full accent-blue-500 bg-gray-800 h-1.5 rounded-full appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <button 
                onClick={() => setShowConfig(false)}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest rounded-xl transition-all active:scale-95"
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'paused' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50">
          <div className="w-72 p-8 bg-gray-900/80 border border-blue-500/30 rounded-3xl shadow-[0_0_50px_rgba(59,130,246,0.2)] flex flex-col gap-4">
            <div className="space-y-1 mb-4">
              <h2 className="text-center text-2xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-blue-400 to-purple-600">
                PAUSED
              </h2>
              <div className="h-px w-full bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
            </div>
            
            <button 
              onClick={() => setGameState('playing')}
              className="w-full bg-blue-600/20 border border-blue-500/40 text-blue-400 py-4 rounded-xl font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all active:scale-95"
            >
              Resume
            </button>
            <button 
              onClick={() => resetGame(true)}
              className="w-full bg-red-600/10 border border-red-500/20 text-red-400/70 py-4 rounded-xl font-bold uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all active:scale-95"
            >
              Abort Mission
            </button>
          </div>
        </div>
      )}

      {gameState === 'gameOver' && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-[100] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-2xl p-12 bg-gray-900/50 border-y border-blue-500/20 flex flex-col items-center gap-12 relative"
            >
              {/* Decorative Background Elements */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent" />
              </div>

              <div className="space-y-4 text-center relative">
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-xs font-mono tracking-[1em] text-blue-400 uppercase opacity-50"
                >
                  Simulation Terminated
                </motion.div>
                
                <motion.h2 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.4, type: 'spring' }}
                  className={`text-7xl md:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${
                    winner === 'blue' ? 'from-blue-400 to-blue-600' : 'from-red-400 to-red-600'
                  } drop-shadow-[0_0_30px_rgba(59,130,246,0.5)]`}
                >
                  {winner === 'blue' ? 'BLUE' : 'RED'} VICTOR
                </motion.h2>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="flex justify-center gap-8 mt-8"
                >
                  <div className="text-center">
                    <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Blue Kills</div>
                    <div className="text-3xl font-black text-blue-400">{scores.blueKills}</div>
                  </div>
                  <div className="w-px h-12 bg-gray-800" />
                  <div className="text-center">
                    <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Red Kills</div>
                    <div className="text-3xl font-black text-red-400">{scores.redKills}</div>
                  </div>
                </motion.div>
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className="flex flex-col sm:flex-row gap-4 w-full max-w-md"
              >
                <button 
                  onClick={() => resetGame(false)}
                  className="flex-1 group relative px-8 py-5 bg-blue-600 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-[0_0_30px_rgba(59,130,246,0.3)] hover:shadow-[0_0_50px_rgba(59,130,246,0.5)] hover:scale-105 active:scale-95 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                  Restart
                </button>
                <button 
                  onClick={() => resetGame(true)}
                  className="flex-1 px-8 py-5 bg-gray-800 border border-gray-700 text-gray-400 font-black uppercase tracking-widest rounded-2xl hover:bg-gray-700 hover:text-white transition-all active:scale-95"
                >
                  Quit
                </button>
              </motion.div>

              <div className="text-[10px] font-mono text-gray-700 uppercase tracking-[0.5em] mt-4">
                Neural Link Severed
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {gameState !== 'menu' && (
        <>
          <div className="absolute top-8 left-8 pointer-events-none flex flex-col gap-2">
            <div className="bg-black/60 backdrop-blur-md border border-blue-500/30 px-4 py-2 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.2)] flex items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">AMMO</div>
              <div className="text-xl font-black text-blue-500 tabular-nums">{scores.blue}</div>
              <div className="w-px h-4 bg-blue-500/30" />
              <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">KILLS</div>
              <div className="text-xl font-black text-blue-500 tabular-nums">{scores.blueKills}</div>
            </div>
            <div className="bg-black/60 backdrop-blur-md border border-blue-500/30 px-4 py-2 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.2)] flex items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">POWER:</div>
              <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full"
                  style={{ 
                    width: `${dashCooldowns.blue * 100}%`,
                    backgroundColor: dashCooldowns.blue >= 1 ? '#3b82f6' : '#4b5563'
                  }}
                />
              </div>
            </div>
          </div>

          <div className="absolute top-8 right-8 pointer-events-none flex flex-col gap-2 items-end">
            <div className="bg-black/60 backdrop-blur-md border border-red-500/30 px-4 py-2 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.2)] flex items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-red-400">AMMO</div>
              <div className="text-xl font-black text-red-500 tabular-nums">{scores.red}</div>
              <div className="w-px h-4 bg-red-500/30" />
              <div className="text-[10px] font-bold uppercase tracking-widest text-red-400">KILLS</div>
              <div className="text-xl font-black text-red-500 tabular-nums">{scores.redKills}</div>
            </div>
            <div className="bg-black/60 backdrop-blur-md border border-red-500/30 px-4 py-2 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.2)] flex items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-red-400">POWER:</div>
              <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full"
                  style={{ 
                    width: `${dashCooldowns.red * 100}%`,
                    backgroundColor: dashCooldowns.red >= 1 ? '#ef4444' : '#4b5563'
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

