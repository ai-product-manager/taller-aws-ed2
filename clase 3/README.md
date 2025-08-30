# 🎙️ Taller Práctico — Sesión 3: Agente Multicanal (Voz con Polly) + Texto

Esta sesión (2 horas) añade **voz** a tu bot de **Amazon Lex V2** usando **Amazon Polly**, para crear una **demo web** accesible por **texto + audio**. Usaremos **Cognito Identity Pool** para credenciales temporales en el navegador y el **AWS SDK for JavaScript v3** para invocar **Lex (RecognizeText)** y **Polly (SynthesizeSpeech)**.

> Basado en la clase 3 del PPT (agente multicanal con Polly, Cognito y demo web).

---

## 🧭 Contenido
- [Agenda (2 horas)](#-agenda-2-horas)
- [Arquitectura](#-arquitectura)
- [Prerrequisitos](#-prerrequisitos)
- [Paso a paso](#-paso-a-paso)
  - [1) Probar Amazon Polly en consola](#1-probar-amazon-polly-en-consola)
  - [2) Cognito Identity Pool (credenciales de navegador)](#2-cognito-identity-pool-credenciales-de-navegador)
  - [3) IAM: permisos mínimos (Lex + Polly)](#3-iam-permisos-mínimos-lex--polly)
  - [4) Interfaz Web: HTML + JS (Lex ↔ Polly)](#4-interfaz-web-html--js-lex--polly)
  - [5) Pruebas end-to-end](#5-pruebas-end-to-end)
- [Ejercicios guiados](#-ejercicios-guiados)
- [Solución de problemas](#-solución-de-problemas)
- [Recursos útiles](#-recursos-útiles)
- [Licencia](#-licencia)

---

## ⏱ Agenda (2 horas)

| Etapa                                               | Objetivo |
|-----------------------------------------------------|----------|
| 1. Repaso + objetivo (multicanal)                   | Qué añadimos respecto a Sesión 2 |
| 2. Polly (consola, voces, neural)                   | Entender voces/engine y probar síntesis |
| 3. Cognito Identity Pool                            | Credenciales temporales en browser |
| 4. IAM (permisos mínimos Lex/Polly)                 | Habilitar RecognizeText + SynthesizeSpeech |
| 5. Demo Web (HTML + JS con SDK v3)                  | Chat por texto y salida de voz |
| 6. Pruebas E2E + Accesibilidad                      | Validar y comentar usos inclusivos |
| 7. Cierre + retos                                   | Extensiones y buenas prácticas |

---

## 🧱 Arquitectura

**Navegador** (HTML/JS) → **Cognito Identity Pool** (credenciales) → **Lex V2 (RecognizeText)** → (respuesta texto) → **Polly (SynthesizeSpeech)** → **Audio**

- Para más detalle ver el archivo [arquitectura.mmd](arquitectura.mmd)
- **Lex V2** interpreta el texto y devuelve mensajes.  
- **Polly** convierte el texto de la respuesta en **audio** (MP3) con una voz elegida.  
- En el **browser** reproducimos el audio con `<audio>`.

---

## ✅ Prerrequisitos

- Un **bot Lex V2** con **alias activo** (de la sesión anterior). Necesitas: `botId`, `botAliasId`, `localeId`, `region`.  
- Acceso en consola a **Polly**, **Cognito**, **IAM**.  
- Editor de texto y un **servidor estático** (o abre el HTML localmente).

> Tip: documenta tus IDs (botId/aliasId/localeId) para pegarlos en el código.

---

## 🛠 Paso a paso

### 1) Probar Amazon Polly en consola

1. Ve a **Amazon Polly → Text-to-Speech**. Escribe un texto corto (“Hola, probando Polly”) y **elige una voz**. Para español, opciones comunes:  
   - **es-MX**: *Mia*, *Andrés* (ambas con motor **Neural** en regiones soportadas).  
   - **es-US**: *Lupe*, *Penélope*, *Miguel*, *Pedro*.  
   - **es-ES**: *Lucia*, *Conchita*, *Enrique*, etc.  
2. Reproduce y confirma que tu región tiene el motor **Neural** para esa voz. Si no, usa **Standard**.

> Consulta la **tabla oficial de voces** y la sección de **Neural voices** para disponibilidad/soporte.  

---

### 2) Cognito Identity Pool (credenciales de navegador)

1. **Cognito → Federated Identities → Create identity pool**.  
2. (Para demo) **Enable access to unauthenticated identities** → **Create pool**.  
3. Cognito crea **dos roles** en IAM (authenticated/unauthenticated). Copia el **IdentityPoolId**.  
4. Usaremos el **rol de “unauthenticated”** para permitir solo **Lex runtime** y **Polly** desde el navegador.

---

### 3) IAM: permisos mínimos (Lex + Polly)

Edita la **inline policy** del **rol “unauthenticated”** del Identity Pool. Reemplaza `REGION`, `ACCOUNT_ID`, `BOT_ID`, `ALIAS_ID`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLexRuntimeOnAlias",
      "Effect": "Allow",
      "Action": [
        "lex:RecognizeText",
        "lex:GetSession",
        "lex:PutSession",
        "lex:DeleteSession"
      ],
      "Resource": "arn:aws:lex:REGION:ACCOUNT_ID:bot-alias/BOT_ID/ALIAS_ID"
    },
    {
      "Sid": "AllowPollySynthesize",
      "Effect": "Allow",
      "Action": "polly:SynthesizeSpeech",
      "Resource": "*"
    }
  ]
}
```

> **Notas**  
> - El **ARN** de Lex runtime apunta a un **bot-alias** (`bot-alias/BOT_ID/ALIAS_ID`).  
> - Para **Polly**, `SynthesizeSpeech` suele requerir `Resource: "*"`.  
> - Alternativa **resource-based policy**: puedes agregar una política **en el alias del bot** que **permita** a tu **rol** invocar `lex:RecognizeText` (útil para escenarios cross-account).

---

### 4) Interfaz Web: HTML + JS (Lex ↔ Polly)

Crea `index.html` y pega este ejemplo tanto el HTML y código Javascript. Cambia los valores de `REGION`, `IDENTITY_POOL_ID`, `BOT_ID`, `BOT_ALIAS_ID`, `LOCALE_ID` y la `voiceId` (por ejemplo **"Mia"** o **"Lupe"**).

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Demo Lex + Polly (mínima)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <h1>Demo básica: Amazon Lex (texto) + Amazon Polly (voz)</h1>

  <!-- Área de conversación simple -->
  <div id="log" aria-live="polite"></div>

  <!-- Entrada y botón -->
  <input id="userInput" type="text" placeholder="Escribe aquí…">
  <button id="sendBtn">Enviar</button>
  <button id="resetBtn">Reiniciar sesión</button>

  <!-- Carga del SDK v2 para navegador -->
  <script src="https://sdk.amazonaws.com/js/aws-sdk-2.1692.0.min.js"></script>

  <!-- Tu lógica JS (solo funcionalidad) -->
  <script src="./webapp.js"></script>
</body>
</html>
```

```js
/****************************************************
 * Reemplaza los valores de CONFIG y abre index-plain.html
 * en un servidor local (no file://). Ej: npx serve
 ****************************************************/

// /*********** CONFIG — REEMPLAZA ESTOS VALORES ***********/
// const REGION = "us-east-1";                      // Tu región AWS
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
```

> **Por qué v3 + Cognito:** en el navegador, el SDK v3 usa `CognitoIdentityCredentials` para obtener **credenciales temporales** y firmar las llamadas a **Lex Runtime** y **Polly**. `RecognizeText` devuelve los **mensajes** del bot; `SynthesizeSpeech` genera **audio** (MP3) para reproducir en el método `playAudio`.

---

### 5) Pruebas end-to-end

1. Abre el HTML en tu navegador (o sirve el archivo con un servidor estático).  
2. Escribe: “Hola, quiero reservar mañana a las 10” (o el intent que tenga tu bot).  
3. Deberías ver el texto del bot en el panel y **oír la respuesta** con la voz elegida.  
4. Cambia `voiceId` a otra voz/idioma y repite.

---

## 🧪 Ejercicios guiados

1) **Selector de idioma**: agrega más voces y un dropdown de **locale** para bots multilenguaje.  
2) **SSML**: habilita `<speak>` con pausas, énfasis y pronunciación.  
3) **Accesibilidad**: botón **“repetir audio”** y atajos de teclado (enter, espacio).  
4) **Seguridad**: mueve a **Authenticated role** y mapea usuarios si vas a publicar.

---

## 🆘 Solución de problemas

- **`AccessDenied` en `lex:RecognizeText`**: revisa el **ARN** del **bot-alias** en la policy y el **rol** del Identity Pool. Opción: **resource-based policy** en el **alias** que permita a ese rol usar `RecognizeText`.  
- **`polly:SynthesizeSpeech` falla en `neural`**: la voz/región puede no soportar **Neural**; intenta **`Engine: "standard"`**.  
- **Credenciales no se cargan**: valida `IdentityPoolId` y **región** en el código, y que el rol tenga las **políticas** descritas.  
- **No se oye audio**: revisa que devuelva `AudioStream` (MP3) y que el navegador permita reproducción automática (usa el botón **Play** del `<audio>`).

---

## 🔗 Recursos útiles

- **Lex V2 runtime `RecognizeText` (estructura de petición/respuesta)**:
  - https://docs.aws.amazon.com/lexv2/latest/APIReference/API_runtime_RecognizeText.html
- **SDK v3 en navegador + `CognitoIdentityCredentials`**:
  - https://docs.aws.amazon.com/en_us/sdk-for-javascript/v2/developer-guide/loading-browser-credentials-cognito.html
- **Polly `SynthesizeSpeech` (v3 y API)**  
  - https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
- **Voces disponibles y motor Neural**:
  - https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html

---

## 📄 Licencia

Este material se publica con licencia **MIT**. Puedes usarlo y adaptarlo libremente.
