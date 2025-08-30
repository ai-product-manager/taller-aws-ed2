/****************************************************
 * Reemplaza los valores de CONFIG y abre index.html
 * en un servidor local (no file://). Ej: npx serve
 ****************************************************/

// /*********** CONFIG — REEMPLAZA ESTOS VALORES ***********/
// const REGION = "XXXX";                      // Tu región AWS
// const IDENTITY_POOL_ID = "us-east-1:xxxx-....";  // Cognito Identity Pool (guest)
// const BOT_ID = "XXXXXXXXXX";                     // Lex V2 bot ID
// const BOT_ALIAS_ID = "YYYYYYYYYY";               // Lex V2 bot Alias ID (publicado)
// const LOCALE_ID = "es_419";                      // Locale del alias (Español LatAm)
// const VOICE_ID = "Mia";                          // Voz LatAm (es-MX). Alternativas: "Andrés", "Lupe", etc.
// /*******************************************************/

const $log = document.getElementById("log");
const $input = document.getElementById("userInput");
const $send = document.getElementById("sendBtn");
const $reset = document.getElementById("resetBtn");

/** Utilidad: imprime texto simple en el "log" */
function addMsg(line) {
  const div = document.createElement("div");
  div.textContent = line;
  $log.appendChild(div);
  $log.scrollTop = $log.scrollHeight;
}

/** 1) CREDENCIALES EN NAVEGADOR (recomendado por AWS)
 * ---------------------------------------------------
 * Se usan credenciales temporales vía Cognito Identity Pools
 * (guest access) — sin exponer llaves en el browser.
 *
 * Doc: AWS SDK v2 en navegador + CognitoIdentityCredentials. 
 * - Using Cognito in browser: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-browser-credentials-cognito.html
 * - Getting started in browser: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/getting-started-browser.html
 */
AWS.config.region = REGION;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({ IdentityPoolId: IDENTITY_POOL_ID });

// (Opcional) Log detallado de llamadas del SDK a la consola.
// Útil para ver params/errores de cada request.
AWS.config.logger = console; 

/** 2) CLIENTES: Lex Runtime V2 + Polly */
const lex = new AWS.LexRuntimeV2({ region: REGION });
const polly = new AWS.Polly({ region: REGION });

/** 3) SESIONES EN LEX
 * --------------------
 * Mantener el mismo sessionId entre mensajes hace que el bot
 * "recuerde" slots/estado hasta que expire el timeout (por defecto 5 min, configurable hasta 24h en el bot).
 * - Managing sessions: https://docs.aws.amazon.com/lexv2/latest/dg/managing-sessions.html
 * - Session timeout: https://docs.aws.amazon.com/lexv2/latest/dg/context-mgmt-session-timeout.html
 */
const SESSION_KEY = "lexSessionId";
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
}
addMsg("Session ID: " + sessionId);

/** Helper: renovar credenciales (tras cambios de IAM/políticas) */
function refreshCreds() {
  return new Promise((res, rej) =>
    AWS.config.credentials.refresh(err => (err ? rej(err) : res()))
  );
}

/** 4) ENVIAR TEXTO A LEX (RecognizeText)
 * ---------------------------------------
 * API runtime principal para bots de texto en Lex V2.
 * Devuelve messages[] (texto a mostrar al usuario).
 * Doc API: https://docs.aws.amazon.com/lexv2/latest/APIReference/API_runtime_RecognizeText.html
 */
async function sendToLex(text) {
  const params = {
    botAliasId: BOT_ALIAS_ID,
    botId: BOT_ID,
    localeId: LOCALE_ID,
    sessionId,   // MISMO sessionId en cada turno
    text
  };
  const resp = await lex.recognizeText(params).promise(); 
  const messages = (resp.messages || []).map(m => m.content).join(" ");
  return messages || "(No tengo respuesta por ahora.)";
}

/** 5) SINTETIZAR VOZ CON POLLY (SynthesizeSpeech)
 * ------------------------------------------------
 * Convierte el texto en audio MP3 y lo reproduce.
 * - Si la voz soporta Engine "neural" en tu región, úsalo (mejor calidad).
 * - Si falla "neural", caemos a "standard".
 * Doc API voice/engine: https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
 */
async function synthesizeAndPlay(text) {
  // Intentar con neural
  const base = { Text: text, OutputFormat: "mp3", VoiceId: VOICE_ID };
  try {
    const data = await polly.synthesizeSpeech({ ...base, Engine: "neural" }).promise(); 
    return playAudio(data.AudioStream);
  } catch (e) {
    console.warn("Neural no disponible, usando estándar:", e.message);
    const data = await polly.synthesizeSpeech(base).promise();
    return playAudio(data.AudioStream);
  }
}

/** 6) Reproduce el AudioStream (ArrayBuffer) */
function playAudio(audioStream) {
  if (!audioStream) return;
  const blob = new Blob([audioStream], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  return audio.play();
}

/** 7) Flujo al pulsar Enviar */
$send.addEventListener("click", async () => {
  const text = $input.value.trim();
  if (!text) return;

  addMsg("me: " + text);
  $send.disabled = true;
  $input.disabled = true;
  try {
    // Asegura credenciales activas antes del request
    await refreshCreds(); 

    // 1) Texto -> Lex
    const reply = await sendToLex(text);

    // 2) Mostrar respuesta
    addMsg("bot: " + reply);

    // 3) Texto -> Voz (Polly)
    await synthesizeAndPlay(reply);

  } catch (e) {
    console.error(e);
    addMsg("⚠️ Error: " + (e.message || "Fallo Lex/Polly"));

  } finally {
    $send.disabled = false;
    $input.disabled = false;
    $input.value = "";
    $input.focus();
  }
});

/** 8) Reiniciar la sesión (nuevo sessionId) */
$reset.addEventListener("click", () => {
  AWS.config.credentials.clearCachedId?.(); // opcional: fuerza nuevas credenciales
  localStorage.removeItem(SESSION_KEY);
  sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
  addMsg("🔄 Nueva sesión: " + sessionId);
});

// Enfoca la caja de texto al cargar
$input.focus();