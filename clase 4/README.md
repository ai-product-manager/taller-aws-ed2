# 🎙️ Taller Práctico — **Sesión 4**: Agente Web Multicanal + Knowledge Base (RAG) y Agentic (Bedrock)

Esta sesión (2 horas) lleva tu bot de **Amazon Lex V2** al navegador (**texto + voz** con **Amazon Polly**) y añade **dos intents generativos** de Bedrock en Lex:  
- **AMAZON.QnAIntent** para respuestas con **RAG** desde **Knowledge base for Amazon Bedrock**.  
- **AMAZON.BedrockAgentIntent** para delegar a un **Bedrock Agent** con **Action Groups** (invoca una API/Lambda y ejecuta acciones).  

> Mantenemos el bot con `MakeBooking` y `CancelBooking` (Lambda) y agregamos los dos intents de Bedrock **sin tocar** tu función. Publicaremos una **demo web** en **S3 Static Website**.

---

## 🧭 Contenido
- [Agenda (2 horas)](#-agenda-2-horas)
- [Arquitectura](#-arquitectura)
- [Prerrequisitos](#-prerrequisitos)
- [Paso a paso](#-paso-a-paso)
  - [1) Crear Knowledge Base (Bedrock) con PDFs](#1-crear-knowledge-base-bedrock-con-pdfs)
  - [2) Agregar QnAIntent (RAG) en Lex](#2-agregar-qnaintent-rag-en-lex)
  - [3) Agregar BedrockAgentIntent (Agent) en Lex](#3-agregar-bedrockagentintent-agent-en-lex)
  - [4) App Web: HTML + JS (Lex ↔ Polly)](#4-app-web-html--js-lex--polly)
  - [5) Publicar en S3 Static Website](#5-publicar-en-s3-static-website)
  - [6) Pruebas end-to-end](#6-pruebas-end-to-end)
- [Ejercicios guiados](#-ejercicios-guiados)
- [Solución de problemas](#-solución-de-problemas)
- [Recursos útiles](#-recursos-útiles)
- [Licencia](#-licencia)

---

## ⏱ Agenda (2 horas)

| Etapa | Objetivo |
|------|----------|
| 1. Repaso + IAM | Confirmar bot/alias activos y roles correctos |
| 2. KB (Bedrock) | Crear/sincronizar Knowledge Base y obtener **KB ID** |
| 3. QnAIntent | Añadir **AMAZON.QnAIntent** y enlazar KB |
| 4. AgentIntent | Añadir **AMAZON.BedrockAgentIntent** y enlazar **Agent alias** |
| 5. Web (Lex + Polly) | Demo HTML/JS: `RecognizeText` + `SynthesizeSpeech` + `sessionId` |
| 6. Deploy | Subir a **S3 Static Website** y probar |
| 7. Cierre | Q&A + próximos pasos |

---

## 🧱 Arquitectura

**Navegador** (HTML/JS) → **Cognito Identity Pool** (credenciales temporales) → **Lex Runtime V2 (RecognizeText)** → (respuesta) → **Polly (SynthesizeSpeech)** → **Audio**  
**Lex V2** también puede:  
- Delegar preguntas a **QnAIntent** (busca en **Knowledge Base for Amazon Bedrock** y responde).  
- Delegar tareas a **Bedrock Agent** mediante **BedrockAgentIntent** (razona y **ejecuta acciones** vía Action Group + Lambda).

---

## ✅ Prerrequisitos

- Bot **Lex V2** con intents `MakeBooking` y `CancelBooking` y un **alias** publicado.  
- Acceso a **Amazon Bedrock** (modelos activados), **Knowledge Bases** y **Agents**.  
- **Cognito Identity Pool** para credenciales del navegador (rol *unauth*, solo demo).  
- **S3** (hosting estático) o **Amplify Hosting**.

---

## 🛠 Paso a paso

### 1) Crear Knowledge Base (Bedrock) con PDFs

**Archivos sugeridos para el corpus (subir a S3):**  
- **Kia**: [knowledge_base_kia_surquillo.pdf](sandbox:/mnt/data/knowledge_base_kia_surquillo.pdf)  

1. **Bedrock → Builder tools → Knowledge bases → Create**.  
2. Selecciona **Bedrock managed vector store** (simple para taller).  
3. **Data source**: S3 → indica el bucket/prefijo donde subiste los PDF (ej.: `s3://kb-autos/vehiculos/`).  
4. Elige un **modelo de embeddings** (ej.: *Titan Text Embeddings v2*).  
5. Crea la KB y ejecuta **Data Source → Sync** para indexar. Anota el **Knowledge base ID**.
6. Prueba la KB en **Test Knowledge Base**

> Tips:
> - Para demos, el store gestionado reduce fricción; en producción podrías usar OpenSearch/Aurora según latencia.  
> - Sube más PDFs/FAQs y re-ejecuta **Sync** cuando quieras ampliar la cobertura.
> - Utiliza un usuario IAM ya que tendrás este error con un usuario root: `Knowledge Base creation with a root user is not supported. Please sign-in with an IAM user or IAM role and try again.`

---

### 2) Agregar QnAIntent (RAG) en Lex

1. **Lex V2 → Bot (locale) → Generative AI configurations → Configure → Create QnA intent.**  
2. Selecciona **Knowledge base for Amazon Bedrock** y pega el **KB ID**.  
3. (Opcional) Configúralo como **QA**.  
4. **Build** y **publica el alias**.

---

### 3) App Web: HTML + JS (Lex ↔ Polly)

**Credenciales (browser):** crea **Cognito Identity Pool** con rol *unauthenticated* (demo) y concédele mínimos permisos a **Lex Runtime** y **Polly**.

**Policy ejemplo (rol unauth del Identity Pool):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LexRuntime",
      "Effect": "Allow",
      "Action": ["lex:RecognizeText","lex:GetSession","lex:DeleteSession"],
      "Resource": "arn:aws:lex:REGION:ACCOUNT_ID:bot-alias/BOT_ID/ALIAS_ID"
    },
    {
      "Sid": "PollySynth",
      "Effect": "Allow",
      "Action": ["polly:SynthesizeSpeech"],
      "Resource": "*"
    }
  ]
}
```

**`index.html`**
```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Asistente Taller Mecánico (Lex + Polly)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link href="webapp.css" rel="stylesheet" type="text/css">
</head>
<body>
  <header>
    <h1>Asistente Taller Mecánico (Lex + Polly)</h1>
  </header>

  <main>
    <div class="card">
      <div class="tips">
        Escribe un mensaje para comenzar. Ejemplos:
        <ul>
          <li>Quiero reservar mantenimiento mañana a las 10</li>
          <li>¿Qué horarios tienen hoy?</li>
          <li>Cancela mi cita A-12345678</li>
        </ul>
      </div>

      <div class="toolbar">
        <span class="pill"><input type="checkbox" id="voice" checked> 🔊 Voz</span>
        <span class="pill small" id="sessionPill">session: —</span>
        <button id="resetBtn" class="small" style="background:#334155;border-color:#334155">Reiniciar sesión</button>
      </div>

      <div id="chat" class="chat"></div>
    </div>
  </main>

  <div class="inputbar">
    <div class="input">
      <input id="userInput" type="text" placeholder="Ej: Quiero reservar mantenimiento mañana a las 10" />
      <button id="sendBtn">Enviar</button>
    </div>
  </div>

  <!-- AWS SDK v2 (browser) -->
  <script src="https://sdk.amazonaws.com/js/aws-sdk-2.1692.0.min.js"></script>
  <!-- Tu lógica -->
  <script src="./webapp.js"></script>
</body>
</html>
```

**`webapp.css`**
```css
:root {
  --bg: #0b0d10;
  --card: #12161b;
  --muted: #8ca3b0;
  --text: #eaf2f8;
  --accent: #22c55e;
  --bubble: #1b222a;
  --me: #2b3340;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f8fb;
    --card: #ffffff;
    --muted: #667085;
    --text: #0b1220;
    --accent: #16a34a;
    --bubble: #f1f5f9;
    --me: #e2e8f0;
  }
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 system-ui, Segoe UI, Roboto, Arial;
}
header {
  position: sticky;
  top: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.35), transparent),
    var(--bg);
  backdrop-filter: blur(8px);
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
h1 {
  margin: 0;
  font-size: 18px;
}
main {
  max-width: 900px;
  margin: 0 auto;
  padding: 12px 20px 96px;
}
.card {
  background: var(--card);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 14px;
}
.tips {
  color: var(--muted);
  font-size: 14px;
}
.chat {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.msg {
  max-width: 80%;
  padding: 10px 12px;
  border-radius: 14px;
}
.bot {
  background: var(--bubble);
  border-top-left-radius: 4px;
}
.me {
  background: var(--me);
  border-top-right-radius: 4px;
  margin-left: auto;
}
.row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.pill {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--bubble);
  color: var(--muted);
  font-size: 12px;
}
.inputbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--card);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px 20px;
}
.input {
  display: flex;
  gap: 10px;
  max-width: 900px;
  margin: 0 auto;
}
input[type="text"] {
  flex: 1;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--bubble);
  color: var(--text);
  outline: none;
}
button {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--accent);
  color: white;
  font-weight: 600;
  cursor: pointer;
}
button[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.small {
  font-size: 12px;
}
```

**`webapp.js`** (SDK v3 desde CDN + Web Speech API)
```js
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

```

---

### 4) Publicar en S3 Static Website

1. **S3 → Bucket → Properties → Static website hosting → Enable**, define `index.html`.  
2. Deshabilitar el **Block pubic access**
2. **Permissions** (demo): agrega **bucket policy** de lectura pública.  
3. Sube `index.html` y `app.js` y abre el **endpoint** del sitio.

Ejemplo de *bucket policy* (solo demo):
```json
{
  "Version":"2012-10-17",
  "Statement":[{
    "Sid":"PublicReadGetObject",
    "Effect":"Allow",
    "Principal":"*",
    "Action":["s3:GetObject"],
    "Resource":["arn:aws:s3:::TU_BUCKET/*"]
  }]
}
```

---

### 5) Pruebas end-to-end

- **Transaccional (Lambda):** “Quiero reservar mañana a las 10 para cambio de aceite”.  
- **Cancelación:** “Cancela mi cita A-1234ABCD.”  
- **QnA (RAG):** “Horarios de atención”.  
- **Agent (agentic):** “Es feriado el 28 de julio del 2025 en Perú“.

---

## 🧪 Ejercicios guiados

1) Añade nuevos documentos a la **KB** y repite **Sync**; valida citas y especificaciones.  
2) Crea un segundo **Agent** con un *Action Group* y compáralo.  
3) Añade **SSML** en Polly (`<break>`, `emphasis`, `prosody`) para mejorar entonación.

---

## 🆘 Solución de problemas

- **403 desde navegador:** revisa **rol unauth** (ARN `bot-alias` correcto) y `polly:SynthesizeSpeech`.  
- **QnAIntent no responde:** comprueba **KB ID**, estado de **Sync** y permisos `bedrock:RetrieveAndGenerate`.  
- **AgentIntent falla:** valida `bedrock:InvokeAgent` y **ARN del agent-alias**; revisa OpenAPI y permisos de la Lambda.  
- **No hay audio:** revisa `Engine`/`VoiceId` y *autoplay* del navegador.  
- **CORS:** considera **Amplify Hosting** o un proxy controlado.

---

## 🔗 Recursos útiles

- **AMAZON.QnAIntent** (RAG con Knowledge Base): docs y configuración.  
- **AMAZON.BedrockAgentIntent** (Agentes Bedrock + acciones).  
- **Knowledge Bases** (stores, ingest, permisos y *managed vector store*).  
- **Action Groups** (OpenAPI + Lambda) para agentes.  
- **Lex Runtime V2 `RecognizeText`** (SDK v3).  
- **Polly `SynthesizeSpeech`** (SDK v3).  
- **S3 Static Website** (hosting estático).

---

## 📄 Licencia

Este material se publica con licencia **MIT**. Puedes usarlo y adaptarlo libremente.