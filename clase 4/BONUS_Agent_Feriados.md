
# 🧪 Taller – Día 4 · **Bedrock Agent + Lex (BedrockAgentIntent)** · Regla “No agendar en feriados”

Este README te guía a crear un **Agent de Amazon Bedrock** con un **Action Group** que consulta la **API pública Nager.Date** (feriados) y a integrarlo con **Amazon Lex V2** usando el intent incorporado **AMAZON.BedrockAgentIntent**. Ideal para talleres mecánicos: **no agendar citas** en feriados y sugerir otra fecha.

---

## 🧱 Arquitectura mínima

Lex (AMAZON.BedrockAgentIntent) → **Bedrock Agent** → **Action Group** (OpenAPI + Lambda) → **Nager.Date**

```
Usuario ──► Lex ──► BedrockAgentIntent ──► Agent ──► Action Group (OpenAPI + Lambda)
                                              ╰────► GET https://date.nager.at/api/v3/PublicHolidays/{year}/{countryCode}
                                                                              (opcional query: date=AAAA-MM-DD)
```

---

## ✅ Prerrequisitos

1) **Misma región** para **Lex**, **Bedrock (Agent)** y **Lambda** (ej. `us-east-1`).  
2) **Modelo del Agent habilitado** en Bedrock.
3) Rol del alias del **bot de Lex** con permisos mínimos para invocar el Agent (y KB si aplica):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["bedrock:InvokeAgent"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["bedrock:RetrieveAndGenerate"], "Resource": "*" }
  ]
}
```
> Referencias: **BedrockAgentIntent** y habilitación en **Generative AI** para el *locale*.  
> https://docs.aws.amazon.com/lexv2/latest/dg/built-in-intent-bedrockagent.html  
> https://docs.aws.amazon.com/lexv2/latest/dg/bedrock-agent-intent-genai.html

---

## 1) Crea la **Lambda** del Action Group (Python 3.12)

Esta Lambda consulta **Nager.Date** para saber si una **fecha (AAAA-MM-DD)** es **feriado** en un país (código ISO-3166 alfa-2: PE, MX, US, etc.).  
**API pública:** https://date.nager.at/Api

> Si pones la Lambda en una **VPC privada**, dale salida a Internet (NAT). Lo más sencillo para el taller es **sin VPC**.

`lambda_function.py`
```python
import json, urllib.request, datetime

BASE = "https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"

def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "AgentWorkshop/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))

def _resp(event, status, body):
    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event.get("actionGroup", "NagerPublicHolidays"),
            "apiPath": event.get("apiPath", "/api/v3/PublicHolidays/{year}/{countryCode}"),
            "httpMethod": event.get("httpMethod", "GET"),
            "httpStatusCode": status,
            "responseBody": {"application/json": {"body": json.dumps(body)}},
        },
        "sessionAttributes": event.get("sessionAttributes", {}),
        "promptSessionAttributes": event.get("promptSessionAttributes", {}),
    }

def lambda_handler(event, context):
    # Evento estándar de Agents → Action Group (OpenAPI + Lambda)
    params = {p["name"]: p.get("value") for p in event.get("parameters", [])}
    year = params.get("year")
    country = params.get("countryCode")
    date_str = params.get("date")  # opcional AAAA-MM-DD

    if not year or not country:
        return _resp(event, 400, {"error": "year y countryCode son requeridos"})

    url = BASE.format(year=year, country=country)
    try:
        holidays = _get(url)  # array [{ date, localName, name, ... }]
        result = {"year": year, "countryCode": country, "count": len(holidays)}

        if date_str:
            result["queryDate"] = date_str
            match = next((h for h in holidays if h.get("date") == date_str), None)
            result["isHoliday"] = bool(match)
            result["holidayName"] = match.get("localName") or match.get("name") if match else None

        return _resp(event, 200, result)
    except Exception as e:
        return _resp(event, 500, {"error": str(e)})
```

**Prueba rápida de la Lambda (evento simulado del Agent):**
```json
{
  "actionGroup": "NagerPublicHolidays",
  "apiPath": "/api/v3/PublicHolidays/{year}/{countryCode}",
  "httpMethod": "GET",
  "parameters": [
    {"name": "year", "value": "2025"},
    {"name": "countryCode", "value": "PE"}
  ]
}
```

**Permisos de Agent hacia Lambda:**

```bash
aws lambda add-permission \
  --region us-east-1 \
  --function-name arn:aws:lambda:us-east-1:654654520205:function:LambdaHoliday \
  --statement-id AllowBedrockAgentInvoke \
  --action lambda:InvokeFunction \
  --principal bedrock.amazonaws.com \
  --source-account 654654520205 \
  --source-arn arn:aws:bedrock:us-east-1:654654520205:agent/<AGENT_ID>
```

---

## 2) Prepara el **OpenAPI** del Action Group

Crea el Action Group con **Use OpenAPI schema** (puedes pegar el YAML o subirlo a S3).  
**Guía:** https://docs.aws.amazon.com/bedrock/latest/userguide/agents-api-schema.html

`openapi.yaml`
```yaml
openapi: 3.0.0
info:
  title: Nager Public Holidays
  version: "1.0.0"
  description: API pública para listar feriados por país y año, y validar si una fecha específica es feriado.

paths:
  /api/v3/PublicHolidays/{year}/{countryCode}:
    description: Lista los feriados de un país en un año determinado y permite validar una fecha concreta.
    get:
      summary: Lista feriados (y validación opcional de una fecha)
      description: >
        Devuelve los feriados públicos para el país y año indicados. Si se envía el
        parámetro opcional "date" (AAAA-MM-DD), el servicio puede usarse para verificar
        si esa fecha es feriado y el nombre del feriado.
      operationId: listPublicHolidays
      parameters:
        - in: path
          name: year
          required: true
          description: Año a consultar (por ejemplo 2025).
          schema:
            type: integer
            minimum: 1900
            maximum: 2100
        - in: path
          name: countryCode
          required: true
          description: Código ISO-3166-1 alfa-2 del país (p. ej., PE, MX, US).
          schema:
            type: string
            minLength: 2
            maxLength: 2
        - in: query
          name: date
          required: false
          description: Fecha a validar con formato AAAA-MM-DD; si se envía, la respuesta indicará si es feriado.
          schema:
            type: string
            pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      responses:
        "200":
          description: Respuesta con la lista de feriados y/o el resultado de validación de fecha.
          content:
            application/json:
              schema:
                type: object
                properties:
                  year:
                    type: string
                    description: Año consultado.
                  countryCode:
                    type: string
                    description: Código del país consultado.
                  count:
                    type: integer
                    description: Número total de feriados en ese año.
                  queryDate:
                    type: string
                    description: Fecha consultada (si se envió).
                  isHoliday:
                    type: boolean
                    description: true si queryDate es feriado; false en caso contrario.
                  holidayName:
                    type: string
                    description: Nombre del feriado para queryDate (si corresponde).

```

---

## 3) Crea el **Agent** en Amazon Bedrock

1. **Bedrock → Agents → Create agent**.  
   - **Foundation model:** *Claude 3 Haiku* o *Claude 3 Sonnet* (habilita acceso si aún no).  
   - **Instruction:** “Eres un asistente de taller. Antes de confirmar una cita, valida si la fecha propuesta es feriado en el país del cliente usando el Action Group de feriados y, si lo es, sugiere otra fecha.”  
2. **Action groups → Add**  
   - **Name:** `NagerPublicHolidays`  
   - **API schema:** *Use OpenAPI schema* → pega `openapi.yaml`.  
   - **Lambda function:** selecciona la Lambda creada.  
3. **Guard & Prepare** el Agent y crea un **Alias**.  

**Formato del evento/response** del Agent para Lambda:  
https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html

---

## 4) Integra el Agent en **Lex** con **AMAZON.BedrockAgentIntent**

1. Abre tu bot en **Lex V2** → **Generative AI** → **Enable Bedrock Agent Intent** (por *locale*).  
2. **Add → Bedrock Agent intent** y selecciona **Agent** + **Agent Alias**.  
3. **Invocación explícita** con *utterances*, por ejemplo:  
     - “¿El **{Date}** es feriado en **{CountryCode}**?”  
     - “Valida si **{Date}** en **{CountryCode}** es feriado antes de agendar.”  
4. **Build** y **Publica** el alias del bot.

---

## 5) Pruebas (desde el tester de Lex)

**Prompts:**
- “¿El **2025-09-01** es feriado en **Perú**?”

**Esperado:** El Bedrock Agent invoca el **Action Group → Lambda**, que llama a **Nager.Date** y responde `isHoliday=true/false` y `holidayName`. 

**Doc de la API:** https://date.nager.at/Api

---

## 6) Consejos y solución de problemas

- **The model arn provided is not supported** → elige un **modelo de texto** soportado por Agents (Claude 3) **en tu misma región** y confirma que tienes **Model access**:  
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html  
- **El Agent no puede llamar a la API** → si la Lambda está en VPC privada, agrega **NAT**; o más simple: ejecútala **sin VPC**.  
- **No se activa BedrockAgentIntent** → habilita **Generative AI** en el *locale* y añade el built-in intent; selecciona Agent + Alias:  
  https://docs.aws.amazon.com/lexv2/latest/dg/bedrock-agent-intent-genai.html  
- **Conflicto de fallbacks** → solo **un** generativo **sin utterances** por *locale* (QnA/Kendra/Agent). Añade utterances a los demás o elimínalos.  
- **Intent confidence/alternatives** → si el bot no enruta como esperas, revisa *Interpretations* y *confidence scores*:  
  https://docs.aws.amazon.com/lexv2/latest/dg/using-intent-confidence-scores.html

---

## 7) (Opcional) Conectar con tu `MakeBooking`

Deja **BedrockAgentIntent** como **fallback** o con utterances de validación; una vez validado, continúa con `MakeBooking` para elicitar `Date/Time/Phone`. Si lo prefieres, maneja la lógica desde tu Lambda de fulfillment.

---

## 📚 Referencias

- **Nager.Date – Public Holiday API:** https://date.nager.at/Api  
- **Bedrock Agents – Lambda (evento y respuesta):** https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html  
- **Definir OpenAPI para Action Groups:** https://docs.aws.amazon.com/bedrock/latest/userguide/agents-api-schema.html  
- **Crear alias del Agent:** https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent-proc.html  
- **BedrockAgentIntent (Lex):** https://docs.aws.amazon.com/lexv2/latest/dg/built-in-intent-bedrockagent.html  
- **Habilitar Bedrock Agent Intent en Lex:** https://docs.aws.amazon.com/lexv2/latest/dg/bedrock-agent-intent-genai.html  
- **Confidence scores e interpretaciones (Lex):** https://docs.aws.amazon.com/lexv2/latest/dg/using-intent-confidence-scores.html  

---

> © Taller Agentes en AWS — Día 4. Puedes reutilizar este README libremente con atribución.
