/**
 * RTTS AudioCaptureProcessor
 *
 * Runs on the high-priority audio rendering thread (AudioWorklet).
 * Converts Float32 input samples to Int16 PCM and sends chunks
 * to the main thread via postMessage.
 *
 * Frame size: 320 samples ≈ 20ms at 16kHz
 */

class RttsAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._frameSize = options.processorOptions?.frameSize ?? 320;
    this._buffer = new Int16Array(this._frameSize);
    this._writePos = 0;
    this._chunkCount = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      // Clamp and quantize to signed 16-bit integer
      this._buffer[this._writePos++] =
        s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767);

      if (this._writePos >= this._frameSize) {
        // Send a copy to the main thread
        this.port.postMessage({
          type: 'pcm',
          buffer: this._buffer.slice(0).buffer,
          sampleCount: this._frameSize,
          chunkIndex: this._chunkCount++,
        });
        this._writePos = 0;
      }
    }

    return true;
  }
}

registerProcessor('rtts-audio-processor', RttsAudioProcessor);
