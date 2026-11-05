(() => {
  // src/lib/models.ts
  var LANGUAGES = [
    { code: "auto", label: "\u81EA\u52A8\u68C0\u6D4B", short: "AUTO" },
    { code: "zh", label: "\u7B80\u4F53\u4E2D\u6587", short: "ZH" },
    { code: "en", label: "English", short: "EN" },
    { code: "ja", label: "\u65E5\u672C\u8A9E", short: "JA" },
    { code: "ko", label: "\uD55C\uAD6D\uC5B4", short: "KO" },
    { code: "fr", label: "Fran\xE7ais", short: "FR" },
    { code: "de", label: "Deutsch", short: "DE" },
    { code: "es", label: "Espa\xF1ol", short: "ES" },
    { code: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", short: "RU" },
    { code: "ar", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", short: "AR" },
    { code: "pt", label: "Portugu\xEAs", short: "PT" }
  ];

  // src/ext/offscreen.ts
  var WORKLET_PATH = chrome.runtime.getURL("audio-worklet.js");
  var TARGET_SAMPLE_RATE = 16e3;
  var FRAME_SIZE = 320;
  var MIN_SEGMENT_DURATION_MS = 800;
  var MAX_SEGMENT_DURATION_MS = 4e3;
  var SILENCE_THRESHOLD_MS = 500;
  var SILENCE_RMS_THRESHOLD = 0.045;
  var MAX_QUEUE_SIZE = 3;
  var LANG_NAMES = {};
  for (const lang of LANGUAGES) {
    LANG_NAMES[lang.code] = lang.label;
  }
  function createWavBlob(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.byteLength;
    const bufferSize = 44 + dataSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, bufferSize - 8, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);
    new Int16Array(buffer, 44).set(pcmData);
    return new Blob([buffer], { type: "audio/wav" });
  }
  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
  function computeRMS(buffer) {
    if (buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const normalized = buffer[i] / 32768;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / buffer.length);
  }
  function validateRoute(config, capability) {
    if (!config || !config.routes || !config.providers) {
      throw new Error("\u914D\u7F6E\u7F3A\u5931");
    }
    const route = config.routes[capability];
    if (!route) throw new Error(`\u80FD\u529B "${capability}" \u672A\u914D\u7F6E\u8DEF\u7531`);
    const provider = config.providers.find((p) => p.id === route.providerId);
    if (!provider) throw new Error(`\u670D\u52A1\u5546 "${route.providerId}" \u672A\u627E\u5230`);
    if (!provider.baseUrl) throw new Error(`\u670D\u52A1\u5546 "${provider.name}" \u7F3A\u5C11 Base URL`);
    if (!provider.apiKey) throw new Error(`\u670D\u52A1\u5546 "${provider.name}" \u7F3A\u5C11 API Key`);
    if (!route.model) throw new Error(`\u80FD\u529B "${capability}" \u672A\u9009\u62E9\u6A21\u578B`);
    return { provider, route };
  }
  async function apiFetch(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        if (text) {
          try {
            const json = JSON.parse(text);
            msg = json.error?.message || json.message || text.slice(0, 240);
          } catch {
            msg = text.slice(0, 240);
          }
        }
      } catch {
      }
      throw new Error(msg);
    }
    return res.json();
  }
  function extractSSEDelta(json) {
    if (json.choices && Array.isArray(json.choices) && json.choices[0]) {
      const delta = json.choices[0].delta;
      if (delta && typeof delta.content === "string" && delta.content.length > 0) {
        return delta.content;
      }
      if (json.choices[0].finish_reason) return null;
    }
    if (typeof json.text === "string" && json.text.length > 0) return json.text;
    if (typeof json.content === "string" && json.content.length > 0) return json.content;
    if (json.segments && Array.isArray(json.segments) && json.segments.length > 0) {
      return json.segments.map((s) => s.text || "").join(" ");
    }
    return null;
  }
  async function streamSSE(url, options, callbacks) {
    const { onDelta, onDone, onError, signal, allowNonStreamingFallback = true } = callbacks;
    let response;
    try {
      response = await fetch(url, { ...options, signal });
    } catch (err) {
      if (err.name === "AbortError") {
        onDone();
        return;
      }
      onError(err);
      return;
    }
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
      }
      onError(new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`));
      return;
    }
    const isStream = !!response.body;
    if (!isStream) {
      try {
        const text = await response.text();
        if (allowNonStreamingFallback) {
          try {
            const json = JSON.parse(text);
            const content = extractSSEDelta(json);
            if (content) {
              onDelta(content);
              onDone();
              return;
            }
          } catch {
          }
          if (text && text.length > 0) {
            onDelta(text);
          }
        } else if (text && text.length > 0) {
          onDelta(text);
        }
      } catch (err) {
        onError(err);
        return;
      }
      onDone();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamDone = false;
    let lastDataTime = Date.now();
    try {
      while (!streamDone) {
        if (Date.now() - lastDataTime > 3e4) {
          onError(new Error("SSE stream timeout (30s no data)"));
          reader.cancel();
          return;
        }
        let result;
        try {
          result = await reader.read();
        } catch (err) {
          if (err.name === "AbortError") {
            onDone();
            return;
          }
          throw err;
        }
        const { done, value } = result;
        streamDone = done;
        if (value) {
          lastDataTime = Date.now();
          buffer += decoder.decode(value, { stream: true });
        }
        if (streamDone && !buffer) break;
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          if (!part.trim()) continue;
          let dataContent = null;
          for (const line of part.split("\n")) {
            if (line.startsWith("data: ")) {
              dataContent = line.slice(6).trim();
            }
            if (!line.startsWith("data:") && !line.startsWith(":") && line.trim().startsWith("{")) {
              try {
                JSON.parse(line.trim());
                dataContent = line.trim();
              } catch {
              }
            }
          }
          if (dataContent === null || dataContent === "") continue;
          if (dataContent === "[DONE]") {
            onDone();
            return;
          }
          try {
            const json = JSON.parse(dataContent);
            const delta = extractSSEDelta(json);
            if (delta !== null && delta !== void 0) {
              onDelta(delta);
            }
          } catch {
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        onDone();
        return;
      }
      onError(err);
      return;
    }
    onDone();
  }
  var captureSessions = /* @__PURE__ */ new Map();
  var MAX_CONTEXT_ENTRIES = 5;
  function getContextSummary(session) {
    const ctx = session.recentContext || [];
    if (ctx.length === 0) return "";
    return ctx.slice(-MAX_CONTEXT_ENTRIES).map((c, i) => `[${i + 1}] ${c.source || "(silence)"} \u2192 ${c.target || "(silence)"}`).join("\n");
  }
  function pushContext(session, source, target) {
    if (!session.recentContext) session.recentContext = [];
    session.recentContext.push({ source, target });
    if (session.recentContext.length > MAX_CONTEXT_ENTRIES * 2) {
      session.recentContext = session.recentContext.slice(-MAX_CONTEXT_ENTRIES);
    }
  }
  async function startTabCapture({ tabId, streamId, sourceLang, targetLang, config, generation }) {
    await stopTabCapture(tabId);
    const session = {
      tabId,
      generation,
      sourceLang,
      targetLang,
      config: JSON.parse(JSON.stringify(config)),
      mediaStream: null,
      audioCtx: null,
      monitorAudioCtx: null,
      workletNode: null,
      pcmBuffer: [],
      lastChunkTime: 0,
      segmentStartTime: Date.now(),
      lastSilenceTime: 0,
      isSilent: false,
      pendingTranscriptions: 0,
      currentAskController: null,
      aborted: false
    };
    captureSessions.set(tabId, session);
    try {
      session.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId
          }
        },
        video: false
      });
      session.audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      session.monitorAudioCtx = new AudioContext();
      const sourceNode = session.audioCtx.createMediaStreamSource(session.mediaStream);
      await session.audioCtx.audioWorklet.addModule(WORKLET_PATH);
      session.workletNode = new AudioWorkletNode(session.audioCtx, "rtts-audio-processor", {
        processorOptions: { frameSize: FRAME_SIZE }
      });
      session.workletNode.port.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === "pcm") {
          onPcmChunk(tabId, msg);
        }
      };
      sourceNode.connect(session.workletNode);
      const monitorSource = session.monitorAudioCtx.createMediaStreamSource(session.mediaStream);
      const monitorGain = session.monitorAudioCtx.createGain();
      monitorGain.gain.value = 1;
      monitorSource.connect(monitorGain);
      monitorGain.connect(session.monitorAudioCtx.destination);
      chrome.runtime.sendMessage({
        type: "CAPTURE_STARTED",
        tabId,
        generation
      });
      return { ok: true };
    } catch (err) {
      await stopTabCapture(tabId);
      throw err;
    }
  }
  function onPcmChunk(tabId, msg) {
    const session = captureSessions.get(tabId);
    if (!session) return;
    const pcmData = new Int16Array(msg.buffer);
    session.pcmBuffer.push(pcmData);
    session.lastChunkTime = Date.now();
    checkSegment(tabId);
  }
  function checkSegment(tabId) {
    const session = captureSessions.get(tabId);
    if (!session || session.aborted) return;
    const now = Date.now();
    const segmentDuration = now - session.segmentStartTime;
    const pcmLength = session.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0);
    if (segmentDuration < MIN_SEGMENT_DURATION_MS) return;
    const recentPcm = getRecentPcm(session, TARGET_SAMPLE_RATE * 0.2);
    const rms = computeRMS(recentPcm);
    if (rms < SILENCE_RMS_THRESHOLD) {
      if (!session.isSilent) {
        session.isSilent = true;
        session.lastSilenceTime = now;
      } else if (now - session.lastSilenceTime >= SILENCE_THRESHOLD_MS) {
        finalizeSegment(tabId);
      }
    } else {
      session.isSilent = false;
      session.lastSilenceTime = 0;
    }
    if (segmentDuration >= MAX_SEGMENT_DURATION_MS) {
      finalizeSegment(tabId);
    }
  }
  function getRecentPcm(session, durationMs) {
    const samplesNeeded = Math.floor(TARGET_SAMPLE_RATE * (durationMs / 1e3));
    const allPcm = concatPcm(session.pcmBuffer);
    if (allPcm.length <= samplesNeeded) return allPcm;
    return allPcm.slice(allPcm.length - samplesNeeded);
  }
  function concatPcm(buffers) {
    const totalLen = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Int16Array(totalLen);
    let offset = 0;
    for (const buf of buffers) {
      result.set(buf, offset);
      offset += buf.length;
    }
    return result;
  }
  async function transcribeAudioStream(wavBlob, config) {
    const { provider, route } = validateRoute(config, "audio");
    const form = new FormData();
    form.append("model", route.model);
    form.append("file", wavBlob, "segment.wav");
    form.append("response_format", "verbose_json");
    form.append("stream", "true");
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    let fullText = "";
    let hasError = false;
    await streamSSE(
      `${baseUrl}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: form
      },
      {
        onDelta: (delta) => {
          fullText += delta;
        },
        onDone: () => {
        },
        onError: (err) => {
          hasError = true;
        },
        allowNonStreamingFallback: true
      }
    );
    if (hasError && !fullText) {
      return await transcribeAudioSync(wavBlob, config);
    }
    return fullText.trim();
  }
  async function transcribeAudioSync(wavBlob, config) {
    const { provider, route } = validateRoute(config, "audio");
    const form = new FormData();
    form.append("model", route.model);
    form.append("file", wavBlob, "segment.wav");
    form.append("response_format", "json");
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    const json = await apiFetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: form
    });
    return (json.text || "").trim();
  }
  async function translateTextStream(text, options) {
    if (!text) return "";
    const { onDelta } = options;
    const config = options.config;
    const { provider, route } = validateRoute(config, "llm");
    const source = LANG_NAMES[options.source || "auto"] || "\u81EA\u52A8\u68C0\u6D4B";
    const target = LANG_NAMES[options.target || "zh"] || "\u7B80\u4F53\u4E2D\u6587";
    const contextBlock = options.context ? `\u3010\u4E0A\u4E0B\u6587\uFF08\u6700\u8FD1\u7684\u5B57\u5E55\uFF09\u3011
${options.context}

` : "";
    const promptText = [
      `\u4F60\u662F\u4E00\u540D\u4E13\u4E1A\u7684\u540C\u58F0\u4F20\u8BD1\u5458\u3002\u6E90\u8BED\u8A00\uFF1A${source}\uFF1B\u76EE\u6807\u8BED\u8A00\uFF1A${target}\u3002`,
      "\u5C06\u4E0B\u9762\u7684\u5185\u5BB9\u7FFB\u8BD1\u4E3A\u76EE\u6807\u8BED\u8A00\u3002\u53EA\u8F93\u51FA\u8BD1\u6587\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u91CD\u590D\u539F\u6587\u3002",
      "\u4FDD\u6301\u53E3\u8BED\u5316\u3001\u7B80\u6D01\u3001\u9002\u5408\u4F5C\u4E3A\u5B9E\u65F6\u5B57\u5E55\u663E\u793A\u3002",
      contextBlock ? `\u6CE8\u610F\u4FDD\u6301\u4E0E\u4E0A\u4E0B\u6587\u7684\u8FDE\u8D2F\u6027\uFF0C\u4E13\u6709\u540D\u8BCD\u524D\u540E\u4E00\u81F4\u3002
${contextBlock}` : "",
      "",
      text
    ].filter(Boolean).join("\n");
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    let fullTranslation = "";
    let hasError = false;
    await streamSSE(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: route.model,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: promptText }]
            }
          ],
          temperature: 0.12,
          max_tokens: 512,
          stream: true
        })
      },
      {
        onDelta: (delta) => {
          fullTranslation += delta;
          if (onDelta) onDelta(delta);
        },
        onDone: () => {
        },
        onError: (err) => {
          console.warn("[RTTS] Translation SSE failed, falling back:", err.message);
          hasError = true;
        },
        allowNonStreamingFallback: true
      }
    );
    if (hasError && !fullTranslation) {
      fullTranslation = await translateTextSync(text, options);
      if (onDelta && fullTranslation) {
        onDelta(fullTranslation);
      }
    }
    return fullTranslation.trim().replace(/^["“「『]([\s\S]*)["”」』]$/, "$1").trim();
  }
  async function translateTextSync(text, options) {
    if (!text) return "";
    const config = options.config;
    const { provider, route } = validateRoute(config, "llm");
    const source = LANG_NAMES[options.source || "auto"] || "\u81EA\u52A8\u68C0\u6D4B";
    const target = LANG_NAMES[options.target || "zh"] || "\u7B80\u4F53\u4E2D\u6587";
    const contextBlock = options.context ? `\u3010\u4E0A\u4E0B\u6587\uFF08\u6700\u8FD1\u7684\u5B57\u5E55\uFF09\u3011
${options.context}

` : "";
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    const json = await apiFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: route.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `\u4F60\u662F\u4E00\u540D\u4E13\u4E1A\u7684\u540C\u58F0\u4F20\u8BD1\u5458\u3002\u6E90\u8BED\u8A00\uFF1A${source}\uFF1B\u76EE\u6807\u8BED\u8A00\uFF1A${target}\u3002`,
                  "\u5C06\u4E0B\u9762\u7684\u5185\u5BB9\u7FFB\u8BD1\u4E3A\u76EE\u6807\u8BED\u8A00\u3002\u53EA\u8F93\u51FA\u8BD1\u6587\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u91CD\u590D\u539F\u6587\u3002",
                  "\u4FDD\u6301\u53E3\u8BED\u5316\u3001\u7B80\u6D01\u3001\u9002\u5408\u4F5C\u4E3A\u5B9E\u65F6\u5B57\u5E55\u663E\u793A\u3002",
                  contextBlock ? `\u6CE8\u610F\u4FDD\u6301\u4E0E\u4E0A\u4E0B\u6587\u7684\u8FDE\u8D2F\u6027\uFF0C\u4E13\u6709\u540D\u8BCD\u524D\u540E\u4E00\u81F4\u3002
${contextBlock}` : "",
                  "",
                  text
                ].filter(Boolean).join("\n")
              }
            ]
          }
        ],
        temperature: 0.12,
        max_tokens: 512,
        stream: false
      })
    });
    const answer = extractChatText(json);
    return answer.trim().replace(/^["“「『]([\s\S]*)["”」』]$/, "$1").trim();
  }
  async function finalizeSegment(tabId) {
    const session = captureSessions.get(tabId);
    if (!session) return;
    if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) return;
    const segmentStartTime = session.segmentStartTime;
    const pcmData = concatPcm(session.pcmBuffer);
    session.pcmBuffer = [];
    session.segmentStartTime = Date.now();
    session.isSilent = false;
    session.lastSilenceTime = 0;
    const durationMs = pcmData.length / TARGET_SAMPLE_RATE * 1e3;
    if (durationMs < 300) return;
    session.pendingTranscriptions++;
    try {
      const wavBlob = createWavBlob(pcmData, TARGET_SAMPLE_RATE);
      const t0 = performance.now();
      const transcription = await transcribeAudioStream(wavBlob, session.config);
      if (session.aborted) return;
      if (!transcription) return;
      const asrLatency = Math.round(performance.now() - t0);
      const contextSummary = getContextSummary(session);
      chrome.runtime.sendMessage({
        type: "CAPTURE_SUBTITLE_STREAMING",
        tabId,
        generation: session.generation,
        at: segmentStartTime,
        source: transcription,
        partialTarget: "",
        latency: asrLatency
      });
      let fullTranslation = "";
      const translation = await translateTextStream(transcription, {
        source: session.sourceLang,
        target: session.targetLang,
        config: session.config,
        context: contextSummary,
        onDelta: (delta) => {
          if (session.aborted) return;
          fullTranslation += delta;
          const currentLatency = Math.round(
            performance.now() - t0 + (Date.now() - segmentStartTime)
          );
          chrome.runtime.sendMessage({
            type: "CAPTURE_SUBTITLE_STREAMING",
            tabId,
            generation: session.generation,
            at: segmentStartTime,
            source: transcription,
            partialTarget: fullTranslation,
            latency: currentLatency
          }).catch(() => {
          });
        }
      });
      const totalLatency = Math.round(
        performance.now() - t0 + (Date.now() - segmentStartTime)
      );
      if (transcription && translation) {
        pushContext(session, transcription, translation);
      }
      if (session.aborted) return;
      chrome.runtime.sendMessage({
        type: "CAPTURE_SUBTITLE",
        tabId,
        generation: session.generation,
        at: segmentStartTime,
        endedAt: Date.now(),
        source: transcription,
        target: translation,
        latency: totalLatency
      });
    } catch (err) {
      if (session.aborted) return;
      console.warn("[RTTS] finalizeSegment error:", err.message);
      chrome.runtime.sendMessage({
        type: "CAPTURE_SUBTITLE_STREAMING",
        tabId,
        generation: session.generation,
        at: segmentStartTime,
        source: "",
        partialTarget: "",
        latency: 0
      }).catch(() => {
      });
      chrome.runtime.sendMessage({
        type: "CAPTURE_ERROR",
        tabId,
        generation: session.generation,
        error: err.message
      });
    } finally {
      session.pendingTranscriptions--;
    }
  }
  async function askQuestion({ question, context, config, sourceLang, targetLang, signal }) {
    const { provider, route } = validateRoute(config, "llm");
    const source = LANG_NAMES[sourceLang || "auto"] || "\u81EA\u52A8\u68C0\u6D4B";
    const target = LANG_NAMES[targetLang || "zh"] || "\u7B80\u4F53\u4E2D\u6587";
    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    const json = await apiFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: route.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `\u4F60\u662F\u4E00\u4E2A\u89C6\u9891\u4F34\u5B66\u52A9\u624B\u3002\u89C6\u9891\u97F3\u9891\u7684\u8BED\u8A00\uFF1A${source}\uFF1B\u5B57\u5E55\u76EE\u6807\u8BED\u8A00\uFF1A${target}\u3002`,
                  "",
                  context ? `\u3010\u6700\u8FD1\u7684\u5B57\u5E55\u4E0A\u4E0B\u6587\u3011
${context}
` : "",
                  "\u8BF7\u57FA\u4E8E\u4EE5\u4E0A\u5B57\u5E55\u5185\u5BB9\u56DE\u7B54\u7528\u6237\u7684\u95EE\u9898\u3002\u7528\u7B80\u4F53\u4E2D\u6587\u56DE\u7B54\uFF0C\u4FDD\u6301\u7B80\u6D01\u51C6\u786E\u3002",
                  "",
                  `\u3010\u7528\u6237\u63D0\u95EE\u3011
${question}`
                ].join("\n")
              }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 2048,
        stream: false
      }),
      signal
    });
    return extractChatText(json).trim();
  }
  function extractChatText(json) {
    const choice = json.choices?.[0];
    if (choice?.message?.content) {
      if (typeof choice.message.content === "string") return choice.message.content;
      return choice.message.content.map((p) => p.text || "").join("");
    }
    if (choice?.text) return choice.text;
    if (json.output_text) return json.output_text;
    const output = json.output?.flatMap((item) => item.content || []).map((p) => p.text || "").join("");
    return output || "";
  }
  async function stopTabCapture(tabId) {
    const session = captureSessions.get(tabId);
    if (!session) return;
    session.aborted = true;
    if (session.currentAskController) {
      session.currentAskController.abort();
      session.currentAskController = null;
    }
    if (session.workletNode) {
      session.workletNode.port.onmessage = null;
      session.workletNode.disconnect();
      session.workletNode = null;
    }
    if (session.audioCtx && session.audioCtx.state !== "closed") {
      await session.audioCtx.close();
    }
    if (session.monitorAudioCtx && session.monitorAudioCtx.state !== "closed") {
      await session.monitorAudioCtx.close();
    }
    if (session.mediaStream) {
      session.mediaStream.getTracks().forEach((track) => track.stop());
    }
    captureSessions.delete(tabId);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.target && message.target !== "offscreen") return false;
    switch (message.type) {
      case "START_CAPTURE": {
        const { tabId, streamId, sourceLang, targetLang, config, generation } = message;
        startTabCapture({ tabId, streamId, sourceLang, targetLang, config, generation }).then((result) => sendResponse(result)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      case "STOP_CAPTURE": {
        const tabId = message.tabId;
        stopTabCapture(tabId).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      case "SET_LANG": {
        const tabId = message.tabId;
        const session = captureSessions.get(tabId);
        if (session) {
          if (message.sourceLang) session.sourceLang = message.sourceLang;
          if (message.targetLang) session.targetLang = message.targetLang;
        }
        sendResponse({ ok: true });
        return false;
      }
      case "ASK_QUESTION": {
        const { tabId, question, requestId, generation, config, context, sourceLang, targetLang } = message;
        const session = captureSessions.get(tabId);
        if (!session || session.generation !== generation) {
          sendResponse({ ok: false, error: "\u4F1A\u8BDD\u5DF2\u8FC7\u671F" });
          return false;
        }
        if (session.currentAskController) session.currentAskController.abort();
        const controller = new AbortController();
        session.currentAskController = controller;
        askQuestion({ question, context: context || "", config, sourceLang, targetLang, signal: controller.signal }).then((answer) => {
          if (controller.signal.aborted) return;
          session.currentAskController = null;
          sendResponse({ ok: true, answer, requestId });
        }).catch((err) => {
          if (err.name === "AbortError") return;
          session.currentAskController = null;
          sendResponse({ ok: false, error: err.message, requestId });
        });
        return true;
      }
      default:
        sendResponse({ ok: false, error: `\u672A\u77E5\u6D88\u606F\u7C7B\u578B: ${message.type}` });
        return false;
    }
  });
  setInterval(() => {
    for (const tabId of captureSessions.keys()) {
      checkSegment(tabId);
    }
  }, 200);
  console.log("[RTTS] Offscreen document v0.5 (TS) initialized");
})();
