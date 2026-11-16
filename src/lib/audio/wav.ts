/**
 * Wrap headerless 16-bit LE PCM audio from Gemini TTS into a standard RIFF/WAV container
 * so HTML5 <audio> can play it natively in any browser.
 */
export function parseSampleRateFromMime(mimeType?: string | null, fallback = 24_000): number {
  if (!mimeType) return fallback;
  const match = mimeType.match(/rate=(\d{4,6})/i);
  if (!match) return fallback;
  const rate = Number.parseInt(match[1], 10);
  return Number.isFinite(rate) && rate >= 8_000 && rate <= 192_000 ? rate : fallback;
}

export function isWavContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  );
}

export function pcm16ToWav(
  pcmBytes: Buffer,
  sampleRate = 24_000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBytes]);
}

export function ensureWavAudio(
  rawBytes: Buffer,
  mimeType?: string | null
): { buffer: Buffer; mimeType: "audio/wav" } {
  if (isWavContainer(rawBytes)) {
    return { buffer: rawBytes, mimeType: "audio/wav" };
  }
  const sampleRate = parseSampleRateFromMime(mimeType, 24_000);
  return {
    buffer: pcm16ToWav(rawBytes, sampleRate, 1, 16),
    mimeType: "audio/wav",
  };
}
