"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  FileText,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AiQuotaStatus, InvoiceRecord } from "@/types/invoice";

interface ReferencedInvoiceChip {
  id: string;
  vendor_name: string | null;
  file_name: string;
  grand_total: number;
  currency: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  spokenSummary?: string;
  isVoiceInput?: boolean;
  model?: string | null;
  ttsSource?: "gemini" | "browser" | null;
  referencedInvoices?: ReferencedInvoiceChip[];
}

interface InvoiceAiAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  invoices: InvoiceRecord[];
  focusInvoiceId: string;
  onFocusInvoiceChange: (invoiceId: string) => void;
  aiStatus: AiQuotaStatus;
  onAiStatusChange: (nextStatus: AiQuotaStatus) => void;
  onOpenInvoice: (invoiceId: string) => void;
}

const VOICE_OPTIONS = [
  { id: "Kore", label: "Kore (متزن وواضح)" },
  { id: "Zephyr", label: "Zephyr (هادئ)" },
  { id: "Puck", label: "Puck (سريع)" },
  { id: "Aoede", label: "Aoede (دافئ)" },
];

const QUICK_PROMPTS = [
  "كم إجمالي المشتريات والضريبة في جميع فواتيري؟",
  "ما أغلى 3 أصناف اشتريتها حتى الآن؟",
  "هل هناك فواتير فيها فرق حسابي أو بانتظار المراجعة؟",
  "لخّص فواتير المشتريات الأخيرة بشكل مختصر",
];

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function InvoiceAiAssistant({
  isOpen,
  onClose,
  invoices,
  focusInvoiceId,
  onFocusInvoiceChange,
  aiStatus,
  onAiStatusChange,
  onOpenInvoice,
}: InvoiceAiAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Voice Input & Output controls
  const [autoSpeakReply, setAutoSpeakReply] = useState(true);
  const [continuousVoice, setContinuousVoice] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("Kore");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  // Refs for cleanup and media control
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const stopAudioPlayback = useCallback(() => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.onended = null;
      activeAudioRef.current.onerror = null;
      activeAudioRef.current = null;
    }
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }, []);

  const cleanupRecorder = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
    setRecording(false);
    setRecordingSeconds(0);
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecorder();
      stopAudioPlayback();
    };
  }, [cleanupRecorder, stopAudioPlayback]);

  const handleAudioFinished = useCallback(
    (allowAutoContinue: boolean) => {
      setSpeakingMessageId(null);
      if (allowAutoContinue && continuousVoice) {
        setTimeout(() => {
          void startRecordingRef.current();
        }, 420);
      }
    },
    [continuousVoice]
  );

  const speakWithBrowserFallback = useCallback(
    (text: string, messageId: string, allowAutoContinue: boolean) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        handleAudioFinished(false);
        return;
      }

      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ar-SA";
      utterance.rate = 1.0;
      const voices = synth.getVoices();
      const arabicVoice = voices.find((v) => v.lang.toLowerCase().startsWith("ar"));
      if (arabicVoice) {
        utterance.voice = arabicVoice;
      }

      setSpeakingMessageId(messageId);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ttsSource: "browser" } : m))
      );

      utterance.onend = () => handleAudioFinished(allowAutoContinue);
      utterance.onerror = () => handleAudioFinished(false);
      synth.speak(utterance);
    },
    [handleAudioFinished]
  );

  const speakText = useCallback(
    async (text: string, messageId: string, allowAutoContinue = false) => {
      if (!text.trim()) return;
      stopAudioPlayback();
      setSpeakingMessageId(messageId);

      try {
        const resp = await fetch("/api/chat/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceName: selectedVoice }),
        });

        if (!resp.ok) {
          speakWithBrowserFallback(text, messageId, allowAutoContinue);
          return;
        }

        const audioBlob = await resp.blob();
        const objectUrl = URL.createObjectURL(audioBlob);
        activeObjectUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        activeAudioRef.current = audio;

        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, ttsSource: "gemini" } : m))
        );

        audio.onended = () => {
          stopAudioPlayback();
          handleAudioFinished(allowAutoContinue);
        };
        audio.onerror = () => {
          stopAudioPlayback();
          speakWithBrowserFallback(text, messageId, allowAutoContinue);
        };

        await audio.play();
      } catch {
        speakWithBrowserFallback(text, messageId, allowAutoContinue);
      }
    },
    [handleAudioFinished, selectedVoice, speakWithBrowserFallback, stopAudioPlayback]
  );

  const sendTurn = useCallback(
    async (payload: { text?: string; audioBlob?: Blob }) => {
      const cleanText = payload.text?.trim() ?? "";
      const hasAudio = Boolean(payload.audioBlob && payload.audioBlob.size > 0);
      if (!cleanText && !hasAudio) return;

      stopAudioPlayback();
      setErrorMsg(null);
      setSending(true);

      const userBubbleId = createMessageId();
      const historyPayload = messages.slice(-10).map((m) => ({ role: m.role, text: m.text }));

      setMessages((prev) => [
        ...prev,
        {
          id: userBubbleId,
          role: "user",
          text: cleanText || "🎙️ جاري فهم سؤالك الصوتي...",
          isVoiceInput: hasAudio,
        },
      ]);
      if (cleanText) setInputText("");

      try {
        let resp: Response;
        if (hasAudio && payload.audioBlob) {
          const form = new FormData();
          const ext = payload.audioBlob.type.includes("mp4") ? "m4a" : "webm";
          form.append("audio", payload.audioBlob, `voice-query.${ext}`);
          if (cleanText) form.append("message", cleanText);
          if (focusInvoiceId) form.append("focusInvoiceId", focusInvoiceId);
          form.append("history", JSON.stringify(historyPayload));
          resp = await fetch("/api/chat", { method: "POST", body: form });
        } else {
          resp = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: cleanText,
              focusInvoiceId: focusInvoiceId || null,
              history: historyPayload,
            }),
          });
        }

        const data = await resp.json();
        if (data.ai_status) {
          onAiStatusChange(data.ai_status);
        }
        if (!resp.ok) {
          throw new Error(data.error || "تعذر الحصول على رد من المساعد.");
        }

        const transcriptText =
          typeof data.transcript === "string" && data.transcript.trim()
            ? data.transcript.trim()
            : null;

        if (transcriptText) {
          setMessages((prev) =>
            prev.map((m) => (m.id === userBubbleId ? { ...m, text: transcriptText } : m))
          );
        }

        const assistantId = createMessageId();
        const spokenText = String(data.spoken_summary || data.answer_text || "");
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: "model",
          text: String(data.answer_text || ""),
          spokenSummary: spokenText,
          model: data.model ?? null,
          referencedInvoices: Array.isArray(data.referencedInvoices)
            ? data.referencedInvoices
            : [],
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (autoSpeakReply || hasAudio) {
          await speakText(spokenText, assistantId, hasAudio && continuousVoice);
        }
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== userBubbleId));
        setErrorMsg(err instanceof Error ? err.message : "فشل الاتصال بالمساعد الذكي.");
      } finally {
        setSending(false);
      }
    },
    [
      autoSpeakReply,
      continuousVoice,
      focusInvoiceId,
      messages,
      onAiStatusChange,
      speakText,
      stopAudioPlayback,
    ]
  );

  const startRecording = useCallback(async () => {
    if (sending || recording) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("المتصفح الحالي لا يدعم تسجيل الصوت من الميكروفون.");
      return;
    }

    stopAudioPlayback();
    setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg",
      ];
      const supportedMime =
        typeof MediaRecorder !== "undefined"
          ? preferredTypes.find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || supportedMime || "audio/webm";
        const recordedBlob = new Blob(chunksRef.current, { type: mime });
        cleanupRecorder();
        if (recordedBlob.size > 0) {
          void sendTurn({ audioBlob: recordedBlob });
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((sec) => sec + 1);
      }, 1000);
    } catch {
      cleanupRecorder();
      setErrorMsg("تعذر الوصول للميكروفون. تأكد من منح المتصفح إذن الميكروفون.");
    }
  }, [cleanupRecorder, recording, sendTurn, sending, stopAudioPlayback]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  const stopAndSendRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  };

  if (!isOpen) return null;

  const canChat = aiStatus.enabled && aiStatus.available;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="المساعد الذكي والصوتي للفواتير"
    >
      <div className="flex h-full w-full max-w-2xl flex-col border-r border-slate-800 bg-[#080d1a] shadow-2xl">
        {/* Drawer Header */}
        <div className="border-b border-slate-800/90 bg-slate-900/75 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">مساعد الفواتير الصوتي والذكي</h2>
                <p className="text-xs text-slate-400">
                  اسأل عن المبالغ، الضرائب، الموردين والأصناف كتابةً أو صوتيًا ويرد عليك بالصوت
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                cleanupRecorder();
                stopAudioPlayback();
                onClose();
              }}
              aria-label="إغلاق المحادثة"
              className="rounded-xl border border-slate-700 bg-slate-800/80 p-2 text-slate-300 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scope & Voice Preferences Bar */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <select
              value={focusInvoiceId}
              onChange={(e) => onFocusInvoiceChange(e.target.value)}
              aria-label="نطاق الفواتير"
              className="max-w-[220px] rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="">جميع الفواتير ({invoices.length})</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.vendor_name || inv.file_name} ({inv.grand_total.toFixed(2)} {inv.currency})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                if (autoSpeakReply) stopAudioPlayback();
                setAutoSpeakReply((v) => !v);
              }}
              className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 font-medium transition ${
                autoSpeakReply
                  ? "border-violet-400/50 bg-violet-500/15 text-violet-200"
                  : "border-slate-700 bg-slate-900 text-slate-400"
              }`}
              title="تشغيل أو إيقاف الرد الصوتي التلقائي"
            >
              {autoSpeakReply ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
              <span>{autoSpeakReply ? "رد صوتي تلقائي" : "صامت"}</span>
            </button>

            <button
              type="button"
              onClick={() => setContinuousVoice((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 font-medium transition ${
                continuousVoice
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                  : "border-slate-700 bg-slate-900 text-slate-400"
              }`}
              title="فتح الميكروفون تلقائيًا للدور التالي بعد انتهاء المساعد من الكلام"
            >
              <Mic className="h-3.5 w-3.5" />
              <span>محادثة متواصلة</span>
            </button>

            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              aria-label="صوت المساعد"
              className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  stopAudioPlayback();
                  setMessages([]);
                }}
                className="mr-auto inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-400 hover:text-white"
                title="مسح المحادثة الحالية"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Messages Feed */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl border border-indigo-400/30 bg-indigo-500/10 text-indigo-300">
                <Sparkles className="h-7 w-7" />
              </div>
              <h3 className="text-base font-bold text-white">تحدّث مع فواتيرك بالعربية</h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                يمكنك كتابة سؤالك أو الضغط على زر الميكروفون للتحدث مباشرة، وسيرد عليك المساعد
                بالأرقام الدقيقة من فواتيرك مع نطق الإجابة بالصوت.
              </p>

              <div className="mt-5 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={!canChat || sending}
                    onClick={() => void sendTurn({ text: q })}
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-right text-xs text-slate-200 transition hover:border-indigo-400/50 hover:bg-indigo-500/10 disabled:opacity-45"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              const isSpeakingThis = speakingMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? "items-start" : "items-end"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      isUser
                        ? "border border-indigo-400/30 bg-indigo-500/15 text-white"
                        : "glass-card border-slate-700/80 text-slate-100"
                    }`}
                  >
                    {msg.isVoiceInput && (
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-indigo-300">
                        <Mic className="h-3 w-3" />
                        <span>رسالة صوتية</span>
                      </div>
                    )}

                    <p className="whitespace-pre-wrap">{msg.text}</p>

                    {!isUser && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isSpeakingThis) {
                                stopAudioPlayback();
                              } else {
                                void speakText(msg.spokenSummary || msg.text, msg.id, false);
                              }
                            }}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                              isSpeakingThis
                                ? "border-rose-400/50 bg-rose-500/15 text-rose-200"
                                : "border-violet-400/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25"
                            }`}
                          >
                            {isSpeakingThis ? (
                              <>
                                <Square className="h-3 w-3" />
                                <span>إيقاف الصوت</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="h-3 w-3" />
                                <span>استماع</span>
                              </>
                            )}
                          </button>

                          {msg.model && (
                            <span className="font-mono text-[10px] text-slate-500">
                              {msg.model}
                            </span>
                          )}
                          {msg.ttsSource && (
                            <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400">
                              {msg.ttsSource === "gemini" ? "صوت Gemini" : "صوت المتصفح"}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {msg.referencedInvoices && msg.referencedInvoices.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {msg.referencedInvoices.map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => onOpenInvoice(chip.id)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-indigo-200 hover:border-indigo-400/60"
                          >
                            <FileText className="h-3 w-3" />
                            <span>
                              {chip.vendor_name || chip.file_name} (
                              {chip.grand_total.toFixed(2)} {chip.currency})
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex justify-end">
              <div className="glass-card rounded-2xl px-4 py-3 text-xs text-indigo-200">
                جاري تحليل الفواتير وإعداد الرد...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input + Mic Controls */}
        <div className="border-t border-slate-800/90 bg-slate-900/75 p-4">
          {errorMsg && (
            <p className="mb-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {errorMsg}
            </p>
          )}

          {recording && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/50 bg-rose-500/15 px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="h-3 w-3 animate-ping rounded-full bg-rose-400" />
                <span className="text-xs font-bold text-rose-100">
                  جاري التسجيل الصوتي... تحدث الآن ({recordingSeconds} ثانية)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cleanupRecorder}
                  className="rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={stopAndSendRecording}
                  className="btn-ai-ready rounded-lg px-3 py-1 text-xs font-bold"
                >
                  إرسال الصوت
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputText.trim() && !sending) {
                void sendTurn({ text: inputText });
              }
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              disabled={!canChat || sending}
              onClick={() => {
                if (recording) {
                  stopAndSendRecording();
                } else {
                  void startRecording();
                }
              }}
              title={
                recording
                  ? "اضغط لإيقاف التسجيل وإرسال السؤال الصوتي"
                  : canChat
                    ? "تحدث بصوتك مع المساعد عن الفواتير"
                    : "المساعد الصوتي متوقف مؤقتًا لعدم توفر رصيد AI"
              }
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition ${
                recording
                  ? "border border-rose-400 bg-rose-500 text-white shadow-lg shadow-rose-500/35"
                  : canChat
                    ? "btn-ai-ready"
                    : "btn-ai-unavailable"
              }`}
            >
              {recording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            <input
              type="text"
              value={inputText}
              disabled={!canChat || sending || recording}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                canChat
                  ? "اكتب سؤالك عن الفواتير أو اضغط الميكروفون للتحدث..."
                  : "لا يوجد رصيد AI متاح حاليًا — يمكنك فحص الرصيد من أعلى الصفحة"
              }
              className="h-11 flex-1 rounded-2xl border border-slate-700 bg-slate-950/90 px-4 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={!canChat || sending || recording || !inputText.trim()}
              aria-label="إرسال السؤال"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition ${
                canChat && inputText.trim() ? "btn-ai-ready" : "btn-ai-unavailable"
              }`}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
