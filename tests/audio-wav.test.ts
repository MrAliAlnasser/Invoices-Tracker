import { describe, expect, it } from "vitest";
import {
  ensureWavAudio,
  isWavContainer,
  parseSampleRateFromMime,
  pcm16ToWav,
} from "@/lib/audio/wav";

describe("PCM to WAV audio utilities", () => {
  it("parses sample rates from Gemini PCM mime strings with safe bounds", () => {
    expect(parseSampleRateFromMime("audio/L16;codec=pcm;rate=24000")).toBe(24_000);
    expect(parseSampleRateFromMime("audio/pcm;rate=16000")).toBe(16_000);
    expect(parseSampleRateFromMime(null)).toBe(24_000);
    expect(parseSampleRateFromMime("audio/pcm;rate=9999999")).toBe(24_000);
  });

  it("prepends valid 44-byte RIFF/WAV header to raw 16-bit PCM data", () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
    const wrapped = ensureWavAudio(pcm, "audio/L16;codec=pcm;rate=24000");

    expect(wrapped.mimeType).toBe("audio/wav");
    expect(wrapped.buffer.length).toBe(44 + pcm.length);
    expect(isWavContainer(wrapped.buffer)).toBe(true);
    expect(wrapped.buffer.readUInt32LE(24)).toBe(24_000);
    expect(wrapped.buffer.readUInt32LE(40)).toBe(pcm.length);
  });

  it("leaves already wrapped RIFF/WAV buffers intact without double headers", () => {
    const pcm = Buffer.from([10, 20, 30, 40]);
    const wav = pcm16ToWav(pcm, 24_000);
    const out = ensureWavAudio(wav, "audio/wav");

    expect(out.buffer.length).toBe(wav.length);
    expect(out.buffer.equals(wav)).toBe(true);
  });
});
