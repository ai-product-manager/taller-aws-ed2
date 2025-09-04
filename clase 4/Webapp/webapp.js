AWS.config.logger = console;

// /*********** CONFIG — REEMPLAZA ESTOS VALORES ***********/
// const REGION = "XXXX";                      // Tu región AWS
// const IDENTITY_POOL_ID = "us-east-1:xxxx-....";  // Cognito Identity Pool (guest)
// const BOT_ID = "XXXXXXXXXX";                     // Lex V2 bot ID
// const BOT_ALIAS_ID = "YYYYYYYYYY";               // Lex V2 bot Alias ID (publicado)
// const LOCALE_ID = "es_419";                      // Locale del alias (Español LatAm)
// const VOICE_ID = "Mia";                          // Voz LatAm (es-MX). Alternativas: "Andrés", "Lupe", etc.
// /*******************************************************/

const chat = document.getElementById("chat");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const voiceToggle = document.getElementById("voice");
const resetBtn = document.getElementById("resetBtn");
const sessionPill = document.getElementById("sessionPill");

// === UI helpers ===
function addMsg(text, who = "bot") {
  const div = document.createElement("div");
  div.className = `msg ${who === "me" ? "me" : "bot"}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}
function setBusy(b) { sendBtn.disabled = b; input.disabled = b; }

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// === SESSION: persistimos un sessionId por usuario ===
const SESSION_KEY = "lexSessionId";
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
}
sessionPill.textContent = `session: ${sessionId.slice(0,8)}…`;

// === AWS SDK v2 — credenciales (Cognito guest) y clientes ===
AWS.config.region = REGION;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({ IdentityPoolId: IDENTITY_POOL_ID });

// Log detallado a la consola (útil para depurar llamadas del SDK)
AWS.config.logger = console; 

const lex = new AWS.LexRuntimeV2({ region: REGION });
const polly = new AWS.Polly({ region: REGION });

// Helpers de credenciales
function clearCached() { AWS.config.credentials.clearCachedId?.(); }
function refreshCreds() {
  return new Promise((res, rej) => 
    AWS.config.credentials.refresh(err => err ? rej(err) : res())
  );
}

// Llamada a Lex V2 — RecognizeText
async function sendToLex(text) {
  const params = {
    botAliasId: BOT_ALIAS_ID,
    botId: BOT_ID,
    localeId: LOCALE_ID,
    sessionId,      // MISMO sessionId en cada turno
    text
  };
  const resp = await lex.recognizeText(params).promise(); 
  const messages = (resp.messages || []).map(m => m.content);
  return messages.join(" ") || "No tengo respuesta por ahora.";
}

// Voz con Polly
async function synthesizeAndPlay(text) {
  if (!voiceToggle.checked) return;
  const p = { Text: text, OutputFormat: "mp3", VoiceId: VOICE_ID };
  try {
    const data = await polly.synthesizeSpeech({ ...p, Engine: "neural" }).promise(); 
    return playAudio(data.AudioStream);
  } catch (e) {
    console.warn("Neural no disponible, usando estándar:", e.message);
    const data = await polly.synthesizeSpeech(p).promise();
    return playAudio(data.AudioStream);
  }
}

// Reproduce el AudioStream (ArrayBuffer) 
function playAudio(audioStream) {
  if (!audioStream) return;
  const blob = new Blob([audioStream], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  return audio.play();
}

// Eventos UI
sendBtn.addEventListener("click", async () => {
  const text = input.value.trim();
  if (!text) return;
  
  addMsg(text, "me");
  setBusy(true);
  try {
    await refreshCreds();
    const reply = await sendToLex(text);
    addMsg(reply, "bot");
    await synthesizeAndPlay(reply);
  } catch (e) {
    console.error(e);
    addMsg("⚠️ Error: " + (e.message || "Fallo al llamar Lex/Polly"), "bot");
  } finally {
    setBusy(false);
    input.value = "";
    input.focus();
  }
});

resetBtn.addEventListener("click", () => {
  clearCached();
  localStorage.removeItem(SESSION_KEY);
  sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
  sessionPill.textContent = `session: ${sessionId.slice(0,8)}…`;
  addMsg("🔄 Nueva sesión iniciada.", "bot");
});

// Enfocar al iniciar
input.focus();
