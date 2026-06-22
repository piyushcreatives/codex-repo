import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in lib.dom for all targets).
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Live, in-browser transcription of the LOCAL participant's speech during a call,
 * using the Web Speech API. Captures the current user's microphone only (it cannot
 * read remote WebRTC audio), so notes reflect what *this* user said. Auto-restarts
 * across the browser's silence timeouts while the call is active.
 */
export function useCallNotes({
  active,
  enabled,
  speaker,
  onFinalText,
}: {
  active: boolean;
  enabled: boolean;
  speaker: string;
  onFinalText?: (text: string, at: string) => void;
}) {
  const supported = typeof window !== "undefined" && !!getRecognitionCtor();
  const [isRecording, setIsRecording] = useState(false);
  const [liveText, setLiveText] = useState("");
  const transcriptRef = useRef(""); // accumulated final lines
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRunRef = useRef(false);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;
  const onFinalTextRef = useRef(onFinalText);
  onFinalTextRef.current = onFinalText;

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    setIsRecording(false);
    setLiveText("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recognitionRef.current) return;

    const rec = new Ctor();
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = (result[0]?.transcript || "").trim();
        if (!text) continue;
        if (result.isFinal) {
          const at = new Date().toISOString();
          const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          transcriptRef.current += `[${stamp}] ${speakerRef.current}: ${text}\n`;
          onFinalTextRef.current?.(text, at);
        } else {
          interim += text + " ";
        }
      }
      setLiveText(interim.trim());
    };

    rec.onerror = () => {
      // Ignore transient errors (no-speech, aborted) — onend will restart if needed.
    };

    rec.onend = () => {
      // Chrome stops recognition after a silence; restart while the call is live.
      if (shouldRunRef.current && recognitionRef.current === rec) {
        try {
          rec.start();
        } catch {
          /* will retry on next end */
        }
      }
    };

    recognitionRef.current = rec;
    shouldRunRef.current = true;
    try {
      rec.start();
      setIsRecording(true);
    } catch {
      /* start() throws if already running */
    }
  }, []);

  // Drive recording from call-active + feature-enabled.
  useEffect(() => {
    if (active && enabled && supported) start();
    else stop();
  }, [active, enabled, supported, start, stop]);

  // Cleanup on unmount.
  useEffect(() => () => stop(), [stop]);

  const getTranscript = useCallback(() => transcriptRef.current.trim(), []);
  const reset = useCallback(() => {
    transcriptRef.current = "";
    setLiveText("");
  }, []);

  return { supported, isRecording, liveText, getTranscript, reset };
}
