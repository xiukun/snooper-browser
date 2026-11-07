(() => {
  // src/lib/models.ts
  var SOURCE_LANGUAGES = [
    { code: "auto", label: "\u81EA\u52A8\u68C0\u6D4B", short: "AUTO" },
    { code: "zh", label: "\u7B80\u4F53\u4E2D\u6587", short: "ZH" },
    { code: "en", label: "English", short: "EN" }
  ];
  var TARGET_LANGUAGES = [
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
  var LANGUAGES = [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES.filter(
    (target) => !SOURCE_LANGUAGES.some((source) => source.code === target.code)
  )];

  // src/lib/transcription-request.ts
  function buildTranscriptionFormData(input) {
    const form = new FormData();
    form.append("model", input.model);
    form.append("file", input.file, "segment.wav");
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (input.sourceLang !== "auto") form.append("language", input.sourceLang);
    return form;
  }

  // src/ext/offscreen/audio.ts
  var TARGET_SAMPLE_RATE = 16e3;
  var FRAME_SIZE = 320;
  var MIN_SEGMENT_DURATION_MS = 800;
  var MAX_SEGMENT_DURATION_MS = 4e3;
  var SILENCE_THRESHOLD_MS = 500;
  var SILENCE_RMS_THRESHOLD = 0.045;
  var MAX_QUEUE_SIZE = 3;
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

  // src/ext/offscreen/api.ts
  var LANG_NAMES = {};
  for (const lang of LANGUAGES) {
    LANG_NAMES[lang.code] = lang.label;
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
  async function transcribeAudio(wavBlob, config, sourceLang) {
    const { provider, route } = validateRoute(config, "audio");
    const form = buildTranscriptionFormData({
      model: route.model,
      file: wavBlob,
      sourceLang
    });
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
  function buildTranslatePrompt(options, text) {
    const source = LANG_NAMES[options.source || "auto"] || "\u81EA\u52A8\u68C0\u6D4B";
    const target = LANG_NAMES[options.target || "zh"] || "\u7B80\u4F53\u4E2D\u6587";
    const contextBlock = options.context ? `\u3010\u4E0A\u4E0B\u6587\uFF08\u6700\u8FD1\u7684\u5B57\u5E55\uFF09\u3011
${options.context}

` : "";
    return [
      `\u4F60\u662F\u4E00\u540D\u4E13\u4E1A\u7684\u540C\u58F0\u4F20\u8BD1\u5458\u3002\u6E90\u8BED\u8A00\uFF1A${source}\uFF1B\u76EE\u6807\u8BED\u8A00\uFF1A${target}\u3002`,
      "\u5C06\u4E0B\u9762\u7684\u5185\u5BB9\u7FFB\u8BD1\u4E3A\u76EE\u6807\u8BED\u8A00\u3002\u53EA\u8F93\u51FA\u8BD1\u6587\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u91CD\u590D\u539F\u6587\u3002",
      "\u4FDD\u6301\u53E3\u8BED\u5316\u3001\u7B80\u6D01\u3001\u9002\u5408\u4F5C\u4E3A\u5B9E\u65F6\u5B57\u5E55\u663E\u793A\u3002",
      contextBlock ? `\u6CE8\u610F\u4FDD\u6301\u4E0E\u4E0A\u4E0B\u6587\u7684\u8FDE\u8D2F\u6027\uFF0C\u4E13\u6709\u540D\u8BCD\u524D\u540E\u4E00\u81F4\u3002
${contextBlock}` : "",
      "",
      text
    ].filter(Boolean).join("\n");
  }
  function cleanTranslation(value) {
    return value.trim().replace(/^["“「『]([\s\S]*)["”」』]$/, "$1").trim();
  }
  async function translateTextStream(text, options) {
    if (!text) return "";
    const { onDelta } = options;
    const { provider, route } = validateRoute(options.config, "llm");
    const promptText = buildTranslatePrompt(options, text);
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
    return cleanTranslation(fullTranslation);
  }
  async function translateTextSync(text, options) {
    if (!text) return "";
    const { provider, route } = validateRoute(options.config, "llm");
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
                text: buildTranslatePrompt(options, text)
              }
            ]
          }
        ],
        temperature: 0.12,
        max_tokens: 512,
        stream: false
      })
    });
    return cleanTranslation(extractChatText(json));
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

  // src/lib/passthrough.ts
  var HAN = new RegExp("\\p{Script=Han}", "u");
  var HIRAGANA_KATAKANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  var HANGUL = new RegExp("\\p{Script=Hangul}", "u");
  var LATIN = new RegExp("\\p{Script=Latin}", "u");
  function detectLanguage(text) {
    const chars = Array.from(text);
    if (chars.length === 0) return null;
    let han = 0;
    let kana = 0;
    let hangul = 0;
    let latin = 0;
    for (const char of chars) {
      if (HIRAGANA_KATAKANA.test(char)) kana++;
      else if (HANGUL.test(char)) hangul++;
      else if (HAN.test(char)) han++;
      else if (LATIN.test(char)) latin++;
    }
    const scriptChars = han + kana + hangul + latin;
    if (scriptChars * 2 <= chars.length) return null;
    if (kana > 0) return "ja";
    if (hangul > 0) return "ko";
    if (han > 0) return "zh";
    if (latin > 0) return "en";
    return null;
  }
  function shouldSkipTranslation(sourceLang, targetLang, transcription) {
    if (!transcription || !transcription.trim()) return false;
    const effectiveSource = sourceLang === "auto" ? detectLanguage(transcription) : sourceLang;
    if (!effectiveSource) return false;
    return effectiveSource === targetLang;
  }

  // src/lib/asr-guard.ts
  var STOCK_LINES = [
    // English
    /^(who are you|i need to go eat|i'?ll reach out to you|thank you for watching|thanks for watching|thanks? for (liking|subscribing)|please subscribe|like and subscribe|see you (next|in the next) (time|video))(?:[\s.!?…]*)$/i,
    /^(one[,.\s]+two[,.\s]+three[,.\s]+four[,.\s]+five[,.\s]+six[,.\s]+seven[,.\s]+eight[,.\s]+nine[,.\s]+ten|一[、,，\s]+二[、,，\s]+三[、,，\s]+四[、,，\s]+五[、,，\s]+六[、,，\s]+七[、,，\s]+八[、,，\s]+九[、,，\s]+十|一二三四五六七八九十)[.!?…。]*$/i,
    /^(subtitles? (by|provided by)|captions? by|transcri(bed|ption) by)\b.*$/i,
    /^(amara\.org|www\.amara\.org).*$/i,
    // Chinese: `\b` never matches between CJK characters, so these use explicit
    // anchors instead. The 「订阅」 CTA is only dropped when it *is* the whole
    // line, otherwise a real sentence like 「订阅号怎么注册」 disappears.
    /^(请不吝?点赞|请大家?点赞|点赞[、,，]?\s*订阅|感谢(您的)?观看|谢谢观看)/,
    /^(请?订阅|关注我们)[\s!！。.,，]*$/,
    /^(字幕由|字幕提供|本字幕由|字幕组)/,
    /^(明镜与点点|点点栏目)/,
    // Japanese
    /^(ご視聴ありがとうございました|チャンネル登録|高評価).*$/
  ];
  var ANNOTATION_ONLY = /^[\[(（【]?\s*(whistle|music|silence|blank_?audio|inaudible|noise|applause|laughter|sighs?|音乐|掌声|笑声|静音|無音)\s*[\])）】]?$/i;
  var NO_CONTENT = /^(?:[0-9\s.,，、:：;；!！?？'"“”‘’()（）\-—–_*/\\|]+|[.…·\s]+)$/;
  var DEGENERATE_RUN = /(.)\1{7,}/u;
  function normalize(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  function normalizeEnglish(text) {
    return normalize(text).toLowerCase().replace(/[^a-z]+/g, " ").trim();
  }
  var GENERIC_BURST_LINES = /* @__PURE__ */ new Set(["what s up", "keep it up", "thank you"]);
  var COUNTING_BURST_LINE = "one two three four five six seven eight nine ten";
  var GENERIC_BURST_LINES_ZH = /* @__PURE__ */ new Set(["\u8C22\u8C22", "\u52A0\u6CB9"]);
  var COUNTING_BURST_LINE_ZH = "\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341";
  function normalizeChineseCounting(text) {
    return normalize(text).replace(/[、,，\s。.!！?？…]/g, "");
  }
  function isLikelyAsrHallucination(text) {
    const t = normalize(text);
    if (!t) return true;
    const bare = t.replace(/^[\s"'“”‘’(\[（【]+|[\s"'“”‘’)\]）】。.!！?？…]+$/g, "");
    if (!bare) return true;
    if (ANNOTATION_ONLY.test(t)) return true;
    if (NO_CONTENT.test(t)) return true;
    if (STOCK_LINES.some((re) => re.test(bare))) return true;
    if (DEGENERATE_RUN.test(t)) return true;
    return false;
  }
  function isLikelyAsrHallucinationSequence(history, text) {
    if (isLikelyAsrHallucination(text)) return true;
    const current = normalizeEnglish(text);
    if (GENERIC_BURST_LINES.has(current)) {
      return history.slice(-4).some((candidate) => normalizeEnglish(candidate) === COUNTING_BURST_LINE);
    }
    const bareZh = normalize(text).replace(/[。.!！?？…\s]+$/g, "");
    if (GENERIC_BURST_LINES_ZH.has(bareZh)) {
      return history.slice(-4).some((candidate) => normalizeChineseCounting(candidate) === COUNTING_BURST_LINE_ZH);
    }
    return false;
  }

  // src/lib/audio-segments.ts
  var SPEECH_RMS_THRESHOLD = 0.012;
  var MIN_SPEECH_MS = 320;
  var SPEECH_PAD_MS = 120;
  function computeRMS(buffer) {
    if (buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const normalized = buffer[i] / 32768;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / buffer.length);
  }
  function speechDurationMs(frameRms, frameLens, sampleRate) {
    let ms = 0;
    for (let i = 0; i < frameRms.length; i++) {
      if (frameRms[i] >= SPEECH_RMS_THRESHOLD) {
        const len = frameLens[i] ?? 0;
        ms += len / sampleRate * 1e3;
      }
    }
    return ms;
  }
  function trimToSpeechBounds(pcm, frameRms, frameLens, sampleRate) {
    if (frameRms.length === 0) return pcm;
    let first = -1;
    let last = -1;
    for (let i = 0; i < frameRms.length; i++) {
      if (frameRms[i] >= SPEECH_RMS_THRESHOLD) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return pcm;
    const frameMs = frameLens[0] ? frameLens[0] / sampleRate * 1e3 : 20;
    const pad = Math.max(0, Math.ceil(SPEECH_PAD_MS / frameMs));
    first = Math.max(0, first - pad);
    last = Math.min(frameRms.length - 1, last + pad);
    let startSample = 0;
    for (let i = 0; i < first; i++) startSample += frameLens[i] ?? 0;
    let endSample = startSample;
    for (let i = first; i <= last; i++) endSample += frameLens[i] ?? 0;
    endSample = Math.min(endSample, pcm.length);
    return endSample > startSample ? pcm.slice(startSample, endSample) : pcm;
  }

  // src/ext/offscreen/capture.ts
  var WORKLET_PATH = chrome.runtime.getURL("audio-worklet.js");
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
      aborted: false,
      videoEl: null,
      frameRms: [],
      frameLens: [],
      audioSilent: false,
      recentAsrCandidates: []
    };
    captureSessions.set(tabId, session);
    ensureKeepAlive();
    try {
      const audioConstraints = {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      };
      const videoConstraints = {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 5
        }
      };
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: videoConstraints
        });
      } catch (videoErr) {
        console.warn("[RTTS] video track unavailable, falling back to audio only:", videoErr);
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });
      }
      session.mediaStream = mediaStream;
      for (const track of mediaStream.getTracks()) {
        track.addEventListener("ended", () => {
          const current = captureSessions.get(tabId);
          if (!current || current.aborted || current.generation !== generation) return;
          chrome.runtime.sendMessage({
            type: "CAPTURE_ENDED",
            tabId,
            generation,
            reason: track.kind
          }).catch(() => {
          });
          stopTabCapture(tabId);
        });
      }
      if (mediaStream.getVideoTracks().length > 0) {
        const videoEl = document.createElement("video");
        videoEl.srcObject = mediaStream;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none";
        document.body.appendChild(videoEl);
        videoEl.play().catch(() => {
        });
        session.videoEl = videoEl;
      }
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
    if (session.videoEl) {
      session.videoEl.pause();
      session.videoEl.srcObject = null;
      session.videoEl.remove();
      session.videoEl = null;
    }
    if (session.mediaStream) {
      session.mediaStream.getTracks().forEach((track) => track.stop());
    }
    await Promise.allSettled([
      session.audioCtx && session.audioCtx.state !== "closed" ? session.audioCtx.close() : Promise.resolve(),
      session.monitorAudioCtx && session.monitorAudioCtx.state !== "closed" ? session.monitorAudioCtx.close() : Promise.resolve()
    ]);
    captureSessions.delete(tabId);
    stopKeepAliveIfIdle();
  }
  function onPcmChunk(tabId, msg) {
    const session = captureSessions.get(tabId);
    if (!session || session.aborted) return;
    const pcmData = new Int16Array(msg.buffer);
    session.pcmBuffer.push(pcmData);
    session.lastChunkTime = Date.now();
    const rms = computeRMS(pcmData);
    session.frameRms.push(rms);
    session.frameLens.push(pcmData.length);
    checkSegment(tabId);
  }
  function trimBufferToMax(session, maxMs) {
    const maxSamples = Math.floor(TARGET_SAMPLE_RATE * maxMs / 1e3);
    let total = session.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0);
    while (total > maxSamples && session.pcmBuffer.length > 1) {
      const first = session.pcmBuffer[0];
      const excess = total - maxSamples;
      if (first.length <= excess) {
        session.pcmBuffer.shift();
        session.frameRms.shift();
        session.frameLens.shift();
        total -= first.length;
      } else {
        const kept = first.slice(excess);
        session.pcmBuffer[0] = kept;
        session.frameLens[0] = kept.length;
        total = maxSamples;
      }
    }
  }
  function reportAudioState(session, silent) {
    if (session.audioSilent === silent) return;
    session.audioSilent = silent;
    chrome.runtime.sendMessage({
      type: "CAPTURE_AUDIO_STATE",
      tabId: session.tabId,
      generation: session.generation,
      silent
    }).catch(() => {
    });
  }
  function checkSegment(tabId) {
    const session = captureSessions.get(tabId);
    if (!session || session.aborted) return;
    if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) {
      trimBufferToMax(session, MAX_SEGMENT_DURATION_MS);
      return;
    }
    const now = Date.now();
    const segmentDuration = now - session.segmentStartTime;
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
  async function finalizeSegment(tabId) {
    const session = captureSessions.get(tabId);
    if (!session) return;
    if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) return;
    const segmentStartTime = session.segmentStartTime;
    const rawPcm = concatPcm(session.pcmBuffer);
    const frameRms = session.frameRms;
    const frameLens = session.frameLens;
    const speechMs = speechDurationMs(frameRms, frameLens, TARGET_SAMPLE_RATE);
    const trimmedPcm = trimToSpeechBounds(rawPcm, frameRms, frameLens, TARGET_SAMPLE_RATE);
    session.pcmBuffer = [];
    session.frameRms = [];
    session.frameLens = [];
    session.segmentStartTime = Date.now();
    session.isSilent = false;
    session.lastSilenceTime = 0;
    if (speechMs < MIN_SPEECH_MS) {
      reportAudioState(session, true);
      return;
    }
    reportAudioState(session, false);
    const pcmData = trimmedPcm;
    const durationMs = pcmData.length / TARGET_SAMPLE_RATE * 1e3;
    if (durationMs < 300) return;
    session.pendingTranscriptions++;
    try {
      const wavBlob = createWavBlob(pcmData, TARGET_SAMPLE_RATE);
      const t0 = performance.now();
      const transcription = await transcribeAudio(wavBlob, session.config, session.sourceLang);
      if (session.aborted) return;
      if (!transcription) return;
      console.log("[RTTS] ASR segment:", {
        text: transcription,
        durationMs: Math.round(durationMs),
        speechMs,
        sourceLang: session.sourceLang
      });
      const isHallucination = isLikelyAsrHallucinationSequence(
        session.recentAsrCandidates,
        transcription
      );
      if (isHallucination) {
        console.warn("[RTTS] dropped likely ASR hallucination:", {
          text: transcription,
          durationMs: Math.round(durationMs),
          speechMs,
          recentCandidates: [...session.recentAsrCandidates]
        });
        session.recentAsrCandidates = [
          ...session.recentAsrCandidates.slice(-5),
          transcription
        ];
        return;
      }
      session.recentAsrCandidates = [];
      const asrLatency = Math.round(performance.now() - t0);
      if (shouldSkipTranslation(session.sourceLang, session.targetLang, transcription)) {
        const passthroughLatency = Math.round(performance.now() - t0 + (Date.now() - segmentStartTime));
        if (session.aborted) return;
        console.log("[RTTS] subtitle emitted:", {
          source: transcription,
          target: transcription,
          passthrough: true
        });
        chrome.runtime.sendMessage({
          type: "CAPTURE_SUBTITLE",
          tabId,
          generation: session.generation,
          at: segmentStartTime,
          endedAt: Date.now(),
          source: transcription,
          target: transcription,
          latency: passthroughLatency
        }).catch(() => {
        });
        return;
      }
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
      console.log("[RTTS] subtitle emitted:", {
        source: transcription,
        target: translation,
        passthrough: false
      });
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
  async function captureVideoFrame(tabId) {
    const sess = captureSessions.get(tabId);
    if (!sess || sess.aborted || !sess.videoEl) {
      return { ok: false, error: "\u6CA1\u6709\u53EF\u7528\u7684\u89C6\u9891\u5E27" };
    }
    try {
      const video = sess.videoEl;
      for (let attempt = 0; attempt < 12; attempt++) {
        if (video.readyState >= 2 && video.videoWidth > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (video.readyState >= 2) {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const requestFrame = video.requestVideoFrameCallback;
          if (typeof requestFrame === "function") {
            try {
              requestFrame.call(video, () => finish());
            } catch {
            }
          }
          setTimeout(finish, 400);
        });
      }
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return { ok: false, error: "\u5F55\u5236\u4E2D\u7684\u89C6\u9891\u5E27\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" };
      }
      const canvas = document.createElement("canvas");
      let w = video.videoWidth;
      let h = video.videoHeight;
      const maxW = 1600;
      if (w > maxW) {
        h = Math.round(h * maxW / w);
        w = maxW;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      return { ok: true, dataUrl, width: w, height: h };
    } catch (err) {
      return { ok: false, error: err.message || "\u5E27\u6355\u83B7\u5931\u8D25" };
    }
  }
  var keepAliveTimer = null;
  function ensureKeepAlive() {
    if (keepAliveTimer !== null) return;
    keepAliveTimer = setInterval(() => {
      for (const [tabId, session] of captureSessions) {
        try {
          chrome.runtime.sendMessage({
            type: "CAPTURE_KEEPALIVE",
            tabId,
            generation: session.generation
          }).catch(() => {
          });
        } catch {
        }
      }
    }, 15e3);
  }
  function stopKeepAliveIfIdle() {
    if (captureSessions.size === 0 && keepAliveTimer !== null) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  // src/ext/offscreen.ts
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
      case "GET_CAPTURE_SESSIONS": {
        const sessions = {};
        for (const [tabId, session] of captureSessions) {
          sessions[String(tabId)] = session.generation;
        }
        sendResponse({
          ok: true,
          tabIds: Array.from(captureSessions.keys()),
          sessions
        });
        return false;
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
      case "CAPTURE_FRAME": {
        captureVideoFrame(message.tabId).then((result) => sendResponse(result)).catch((err) => sendResponse({ ok: false, error: err.message || "\u5E27\u6355\u83B7\u5931\u8D25" }));
        return true;
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
