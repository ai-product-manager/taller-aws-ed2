# 🆕 Taller Práctico: Amazon Lex V2 — Tu Primer Chatbot/Agente

Este repositorio acompaña la sesión **100% práctica** dedicada a **Amazon Lex V2**. Construirás un **chatbot/agente desde cero** usando únicamente la **consola de AWS** (sin Lambda ni integraciones). Al final, tendrás un bot funcional con intents, slots, fallback y publicación mediante **versiones** y **alias**.

---

## 🧭 Contenido
- [Agenda](#-agenda-2-horas)
- [Prerrequisitos](#-prerrequisitos)
- [Paso a paso](#-paso-a-paso)
  - [1) Crear el bot y el locale](#1-crear-el-bot-y-el-locale)
  - [2) Intent “Saludo”](#2-intent-saludo)
  - [3) Intent con slots “Registro”](#3-intent-con-slots-registro)
  - [4) Fallback, Build y Test](#4-fallback-build-y-test)
  - [5) Versiones y alias](#5-versiones-y-alias)
- [Mini‑retos](#-mini-retos)
- [Solución de problemas](#-solución-de-problemas)
- [Recursos útiles](#-recursos-útiles)
- [Licencia](#-licencia)

---

## ⏱ Agenda (2 horas)

| Etapa                        | Objetivo |
|-----------------------------|----------|
| 1. Introducción y conceptos | Entender bot, intent, utterance, slot, build, test |
| 2. Crear bot y locale       | Crear bot vacío en español (es_419) |
| 3. Intent **Saludo**        | Añadir utterances, respuesta y probar en consola |
| 4. Intent con **slots**     | Capturar nombre, email y teléfono (built‑in slots) |
| 5. Fallback + ajustes       | Configurar fallback y (opcional) umbral de confianza |
| 6. Versiones y alias        | Publicar versión y crear alias `dev` |
| 7. Mini‑retos guiados       | Afianzar NLU y práctica con slot type personalizado |

---

## ✅ Prerrequisitos

- Cuenta de **AWS** con acceso a **Amazon Lex V2**.
- Región sugerida: `us-east-1` (puedes usar otra si deseas).
- Permisos para crear y editar Bots en Lex V2.

> **Glosario rápido**: *Intent* (objetivo del usuario), *Utterance* (frase de ejemplo), *Slot* (dato que se pide), *Build* (compilar el modelo), *Alias* (puntero a una versión), *Fallback* (respuesta cuando no se entiende la intención).

---

## 🛠 Paso a paso

### 1) Crear el bot y el locale

1. En la **AWS Console** abre **Amazon Lex V2** → **Bots** → **Create bot** → **Create a blank bot**.  
2. **Name**: `taller-lex-bot`  
3. **Language/locale**: **Spanish (Latin America) — `es_419`**.  
4. Acepta el **rol IAM** recomendado por Lex.  
5. Haz clic en **Create bot**.

> *Tip:* El bot inicia en estado **Draft** (borrador). Todo cambio requiere presionar **Build** para que el modelo se actualice y pueda probarse en la consola.

---

### 2) Intent “Saludo”

1. En el menú izquierdo → **Intents** → **Add intent** → **Add empty intent**.  
2. **Intent name**: `SaludoIntent`  
3. **Sample utterances** (copia y pega estas líneas):  
   ```
   hola
   buenas
   qué tal
   buen día
   hola bot
   buenas tardes
   hola, ¿estás ahí?
   un saludo
   hola asistente
   buenas noches
   cómo estás
   necesito ayuda
   tengo una consulta
   saludos
   ```
4. **Closing response** → **Add message** → **Plain text**:
   ```
   ¡Hola! Soy tu asistente de pruebas.
   Puedo registrarte o resolver dudas. ¿Qué te gustaría hacer?
   ```
5. **Save** → **Build** (arriba a la derecha).  
6. **Test** en la ventana lateral con entradas como “hola”, “qué tal”, etc.

---

### 3) Intent con slots “Registro”

1. **Add intent** → **Add empty intent** → **Name**: `RegistroIntent`  
2. **Sample utterances** (ejemplos para pegar):  
   ```
   quiero registrarme
   me anoto
   dejar mis datos
   toma mi contacto
   quiero darte mi email
   quiero compartir mi telefono
   necesito registrarme
   anótame por favor
   me gustaría registrarme
   ```
3. **Slots** → **Add slot** (crear tres):

   - **Name:** `firstName` — **Slot type:** `AMAZON.FirstName`  
     **Prompt:** `¿Cuál es tu nombre?`

   - **Name:** `emailAddress` — **Slot type:** `AMAZON.EmailAddress`  
     **Prompt:** `¿Cuál es tu correo?`

   - **Name:** `phoneNumber` — **Slot type:** `AMAZON.PhoneNumber`  
     **Prompt:** `¿Cuál es tu teléfono?`

4. **Slot priority** (orden): `firstName` → `emailAddress` → `phoneNumber`.  
5. (Opcional) **Confirmation**:
   ```
   Voy a registrar: {firstName}, {emailAddress}, {phoneNumber}. ¿Confirmas?
   ```
6. **Closing response**:
   ```
   ¡Gracias {firstName}! Te contactaremos en {emailAddress} o {phoneNumber}.
   ```
7. **Save** → **Build** → **Test** con “quiero registrarme” y completa los datos.

> *Notas:* Los *built‑in slots* validan formatos comunes (p. ej., email/teléfono) y ayudan a guiar la re‑pregunta si la entrada no encaja. Si una utterance no activa el intent esperado, añade más frases variadas y vuelve a **Build**.

---

### 4) Fallback, Build y Test

- Tu bot incluye un **AMAZON.FallbackIntent** (viene por defecto).  
- Ábrelo y configura el mensaje de respuesta, por ejemplo:
  ```
  No estoy seguro de haber entendido.
  Puedo saludarte o registrarte. ¿Qué deseas hacer?
  ```
- **Save** → **Build** → **Test** con entradas aleatorias (p. ej., `asdfg registro`).  
- (Opcional) Ajusta el **confidence score threshold** del locale si el fallback se activa muy pronto o muy tarde.

---

### 5) Versiones y alias

1. **Versions** → **Create version** (por ejemplo, `v1`).  
2. **Aliases** → **Create alias** → **Name:** `dev` → **Version:** `v1`.  
3. Usa **Draft** para editar y **Version + Alias** para exponer un estado estable del bot en integraciones futuras.

---

## 🧪 Mini‑retos

- **Reto A (NLU):** agrega 5–10 utterances nuevas a `RegistroIntent`, luego **Build** y repite pruebas.  
- **Reto B (Custom slot):** crea un *slot type* `CanalContacto` con valores:  
  - `email` (sinónimos: correo, mail)  
  - `teléfono` (sinónimos: celular, móvil)  
  - `whatsapp` (sinónimos: wasap, whats)  
  Úsalo en un intent “PreferenciaContactoIntent” con el prompt:  
  ```
  ¿Prefieres que te contactemos por email, teléfono o whatsapp?
  ```

---

## 🆘 Solución de problemas

- **El intent no clasifica bien:** añade más **utterances** variadas y vuelve a **Build**.  
- **Slots no se llenan correctamente:** revisa que uses los **built‑in slot types** apropiados y que los **prompts** sean claros.  
- **El fallback aparece demasiado:** ajusta el **confidence score threshold** del idioma (locale).  
- **Olvidé dar Build:** cada cambio requiere **Build** para reflejarse en pruebas.

---

## 🔗 Recursos útiles

- Conceptos clave de Lex V2 (cómo funciona, intents, slots, fallback):  
  - https://docs.aws.amazon.com/lexv2/latest/dg/how-it-works.html
- Locales soportados (incluye `es_419` – Spanish LATAM):  
  - https://docs.aws.amazon.com/lexv2/latest/dg/how-languages.html
- Built‑in slot types (Email, Teléfono, Nombres):  
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slots.html
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-email.html
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-first-name.html
- Fallback intent (integrado por defecto):  
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-intent-fallback.html
  - https://docs.aws.amazon.com/lexv2/latest/dg/add-intents.html
- Versiones y alias (publicación y control de despliegue):  
  - https://docs.aws.amazon.com/lexv2/latest/dg/versions-aliases.html
  - https://docs.aws.amazon.com/lexv2/latest/APIReference/API_CreateBotAlias.html

---

## 📄 Licencia

Este material se publica con licencia **MIT**. Usa y adapta libremente citando la fuente cuando corresponda.
