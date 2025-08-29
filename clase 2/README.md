# 🚀 Taller Práctico — Sesión 2: Chatbot/Agente con Lógica y Datos (Make & Cancel)

Este repositorio acompaña la **Sesión 2 (2 horas)** del taller. En esta clase conectarás tu bot de **Amazon Lex V2** con **AWS Lambda** y **Amazon DynamoDB** para **agendar** y **cancelar** citas usando únicamente **dos intents**: `MakeBooking` y `CancelBooking`. Trabajaremos con **clave compuesta** en DynamoDB (`pk`, `sk`) y un **único Lambda** de fulfillment.

> La sesión parte de un bot básico (Sesión 1). Si no lo hiciste, crea al menos un bot con intents/slots y la ventana de test activa.

---

## 🧭 Contenido
- [Agenda](#-agenda-2-horas)
- [Arquitectura](#-arquitectura)
- [Prerrequisitos](#-prerrequisitos)
- [Paso a paso](#-paso-a-paso)
  - [1) DynamoDB: tabla y seed de horarios](#1-dynamodb-tabla-y-seed-de-horarios)
  - [2) IAM: rol para Lambda](#2-iam-rol-para-lambda)
  - [3) Lambda: fulfillment (make & cancel)](#3-lambda-fulfillment-make--cancel)
  - [4) Lex: intents, slots y code hook](#4-lex-intents-slots-y-code-hook)
  - [5) Pruebas end-to-end](#5-pruebas-end-to-end)
- [Ejercicios guiados](#-ejercicios-guiados)
- [Solución de problemas](#-solución-de-problemas)
- [Recursos útiles](#-recursos-útiles)
- [Licencia](#-licencia)

---

## ⏱ Agenda (2 horas)

| Etapa                                         | Objetivo |
|-----------------------------------------------|----------|
| 1. Introducción + repaso (Lex día 1)          | Recordar intents/slots, Build/Test y alias |
| 2. DynamoDB (tabla + seed)                    | Preparar almacenamiento y horario |
| 3. IAM (rol Lambda)                           | Permisos mínimos (CRUD tabla + logs) |
| 4. Lambda (fulfillment: make & cancel)        | Crear/cancelar citas y validar horario |
| 5. Lex (intents/slots + hook)                 | Conectar intents al Lambda (Fulfillment) |
| 6. Pruebas E2E                                | Agendar/cancelar y verificar en la tabla |
| 7. Cierre + retos                              | Extensiones y buenas prácticas |

---

## 🧱 Arquitectura

Lex (intents + slots) → **Lambda** (fulfillment) → **DynamoDB** (citas)

- **Lex V2** recolecta **slots** y llama a **Lambda** por **Fulfillment**.  
- **Lambda** valida horario, detecta colisiones y **escribe/borra** en **DynamoDB**.  
- **Respuesta** a Lex con `Close` (fin del flujo de intent).

---

## ✅ Prerrequisitos

- Bot básico en **Lex V2** (Sesión 1).  
- Acceso en la consola a **Lex**, **Lambda**, **DynamoDB** y **CloudWatch Logs**.  
- Región sugerida: `us-east-1` (puedes usar otra).

---

## 🛠 Paso a paso

### 1) DynamoDB: tabla y seed de horarios

1. **DynamoDB → Tables → Create table**  
   - **Table name:** `WorkshopAppointments`  
   - **Partition key:** `pk` *(String)*  
   - **Sort key:** `sk` *(String)*  
   - **Create** (deja defaults).  
2. **Seed de horario** (para validar apertura/cierre):  
   - **Explore table → Create item**  
     ```json
     {
       "pk": "INFO",
       "sk": "HOURS",
       "open": "09:00",
       "close": "18:00",
       "slotMinutes": 30
     }
     ```

> Diseño PK/SK con prefijos (`SHOP#`, `CUSTOMER#`, `APPT#…`) para **patrones de acceso** eficientes. Este patrón de tabla única es común en DynamoDB.

---

### 2) IAM: rol para Lambda

1. **IAM → Roles → Create role → AWS service → Lambda**  
2. Adjunta **AWSLambdaBasicExecutionRole** (logs).  
3. Agrega **Inline policy** (ajusta región/cuenta si no es `us-east-1`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoCrudOnWorkshopAppointments",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:GetItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:<TU_ACCOUNT_ID>:table/WorkshopAppointments"
    }
  ]
}
```
**Role name:** `workshop-lex-lambda-role`

---

### 3) Lambda: fulfillment (make & cancel)

Crea una función **Python 3.12** con el siguiente código (adaptado del ejemplo: **solo** `MakeBooking` y `CancelBooking`).

1. **Lambda → Create function → Author from scratch**  
   - **Name:** `workshop-appointments-fulfillment`  
   - **Runtime:** `Python 3.12`  
   - **Execution role:** `workshop-lex-lambda-role`  
2. **Configuration → Environment variables → Add:** `TABLE_NAME = WorkshopAppointments`  
3. **Code → Deploy** con:

```python
# lambda_function.py
import os, json, uuid, datetime
import boto3
from boto3.dynamodb.conditions import Key

DDB = boto3.resource("dynamodb").Table(os.getenv("TABLE_NAME", "WorkshopAppointments"))

def _close(intent_name, text):
    # Lex V2 Close response
    return {
        "sessionState": {
            "dialogAction": {"type": "Close"},
            "intent": {"name": intent_name, "state": "Fulfilled"},
        },
        "messages": [{"contentType": "PlainText", "content": text}],
    }

def _get_slot(event, name):
    slots = event["sessionState"]["intent"].get("slots") or {}
    v = slots.get(name)
    return v and v.get("value", {}).get("interpretedValue")

def _hours():
    it = DDB.get_item(Key={"pk": "INFO", "sk": "HOURS"}).get("Item")
    return it or {"open":"09:00","close":"18:00","slotMinutes":30}

def _parse_time(s):  # "HH:MM" -> datetime.time
    h, m = map(int, s.split(":"))
    return datetime.time(h, m)

def _iter_slots(day, t_open, t_close, minutes):
    cur = datetime.datetime.combine(day, t_open)
    end = datetime.datetime.combine(day, t_close)
    while cur <= end:
        yield cur.time().strftime("%H:%M")
        cur += datetime.timedelta(minutes=minutes)

def make_booking(intent_name, event):
    shop = _get_slot(event, "ShopId") or "Main"
    service = (_get_slot(event, "Service") or "Mantenimiento").title()
    date_s = _get_slot(event, "Date")
    time_s = _get_slot(event, "Time")
    name = _get_slot(event, "Name") or "Cliente"
    phone = _get_slot(event, "Phone")
    plate = _get_slot(event, "Plate") or "-"
    if not (date_s and time_s and phone):
        return _close(intent_name, "Me faltan datos (fecha, hora y teléfono).")

    # Validar horario y colisión
    hrs = _hours()
    t_open, t_close = _parse_time(hrs["open"]), _parse_time(hrs["close"])
    if not (hrs["open"] <= time_s <= hrs["close"]):
        return _close(intent_name, f"Nuestro horario es {hrs['open']} a {hrs['close']}.")

    appt_id = "A-" + uuid.uuid4().hex[:8].upper()
    shop_pk = f"SHOP#{shop}"
    sk = f"APPT#{date_s}#{time_s}#{appt_id}"

    # Chequear colisión exacta en ese horario
    q = DDB.query(
        KeyConditionExpression=Key("pk").eq(shop_pk) & Key("sk").begins_with(f"APPT#{date_s}#{time_s}#")
    )
    if q.get("Items"):
        return _close(intent_name, "Ese horario ya está tomado. ¿Quieres otro?")

    # Escribir dos items: por SHOP y por CUSTOMER
    DDB.put_item(Item={
        "pk": shop_pk, "sk": sk,
        "service": service, "date": date_s, "time": time_s,
        "name": name, "phone": phone, "plate": plate
    })
    DDB.put_item(Item={
        "pk": f"CUSTOMER#{phone}", "sk": sk,
        "service": service, "date": date_s, "time": time_s,
        "name": name, "shop": shop, "plate": plate
    })
    msg = f"Listo {name}. Reservé {service} el {date_s} a las {time_s}. Tu ID es {appt_id}."
    return _close(intent_name, msg)

def cancel_booking(intent_name, event):
    appt_id = _get_slot(event, "AppointmentId")
    phone = _get_slot(event, "Phone")
    date_s = _get_slot(event, "Date")
    shop = _get_slot(event, "ShopId") or "Main"

    items_to_del = []
    if appt_id:
        # Buscar por SHOP y por CUSTOMER usando begins_with
        shop_pk = f"SHOP#{shop}"
        q1 = DDB.query(KeyConditionExpression=Key("pk").eq(shop_pk) & Key("sk").begins_with(f"APPT#"))
        for it in q1.get("Items", []):
            if it["sk"].endswith(appt_id):
                items_to_del.append(("SHOP", it))
        # Buscar en CUSTOMER
        if phone:
            q2 = DDB.query(KeyConditionExpression=Key("pk").eq(f"CUSTOMER#{phone}") & Key("sk").begins_with("APPT#"))
            for it in q2.get("Items", []):
                if it["sk"].endswith(appt_id):
                    items_to_del.append(("CUST", it))
    elif phone and date_s:
        # Cancelar la primera cita del cliente ese día
        q = DDB.query(
            KeyConditionExpression=Key("pk").eq(f"CUSTOMER#{phone}") & Key("sk").begins_with(f"APPT#{date_s}#")
        )
        if q.get("Items"):
            items_to_del.append(("CUST", q["Items"][0]))
    else:
        return _close(intent_name, "Indica el ID de la cita, o teléfono y fecha.")

    if not items_to_del:
        return _close(intent_name, "No encontré la cita a cancelar.")

    # Borrar en ambas particiones si es posible
    deleted = 0
    for _, it in items_to_del:
        DDB.delete_item(Key={"pk": it["pk"], "sk": it["sk"]})
        deleted += 1
    msg = "Cita cancelada." if deleted else "No se pudo cancelar."
    return _close(intent_name, msg)

def check_availability(intent_name, event):
    shop = _get_slot(event, "ShopId") or "Main"
    service = (_get_slot(event, "Service") or "Mantenimiento").title()
    date_s = _get_slot(event, "Date")
    if not date_s:
        return _close(intent_name, "¿Para qué fecha necesitas disponibilidad?")
    hrs = _hours()
    day = datetime.date.fromisoformat(date_s)
    taken = set()

    q = DDB.query(
        KeyConditionExpression=Key("pk").eq(f"SHOP#{shop}") & Key("sk").begins_with(f"APPT#{date_s}#")
    )
    for it in q.get("Items", []):
        taken.add(it["time"])
    slots = [
        t for t in _iter_slots(day, _parse_time(hrs["open"]), _parse_time(hrs["close"]), int(hrs.get("slotMinutes", 30)))
        if t not in taken
    ]
    if not slots:
        return _close(intent_name, f"No hay horarios disponibles el {date_s}.")
    msg = f"Disponibilidad para {service} el {date_s}: " + ", ".join(slots[:10]) + "."
    return _close(intent_name, msg)

def opening_hours(intent_name, event):
    hrs = _hours()
    return _close(intent_name, f"Atendemos de {hrs['open']} a {hrs['close']}.")

def lambda_handler(event, context):
    intent = event["sessionState"]["intent"]["name"]
    if intent == "MakeBooking":
        return make_booking(intent, event)
    if intent == "CancelBooking":
        return cancel_booking(intent, event)
    if intent == "CheckAvailability":
        return check_availability(intent, event)
    if intent == "OpeningHours":
        return opening_hours(intent, event)
    return _close(intent, "Puedo ayudarte a reservar, cancelar, ver horarios y disponibilidad.")

```

> **Notas:**  
> - Respuestas a Lex con `Close` cierran el flujo del intent.  
> - Se usa `Query` + `begins_with` sobre la **sort key** (`sk`) para detectar colisiones/buscar por prefijo.  
> - Los ítems duplicados en **SHOP** y **CUSTOMER** facilitan búsquedas por negocio.

---

### 4) Lex: intents, slots y code hook

Crea/ajusta **dos intents** con **estos nombres exactos** (coinciden con el código): `MakeBooking`, `CancelBooking`.

**A. Intent `MakeBooking`**  
- **Utterances** (ejemplos):  
  - “quiero reservar”, “agendar una cita”, “haz una reserva”, “quiero agendar mantenimiento”, “reservar para mañana a las 10”
- **Slots** *(usa estos **nombres** exactos)*:  
  - `Date` → `AMAZON.Date` → Prompt: “¿Qué fecha te conviene? (AAAA-MM-DD)”  
  - `Time` → `AMAZON.Time` → Prompt: “¿A qué hora?”  
  - `Phone` → `AMAZON.PhoneNumber` → Prompt: “¿Tu teléfono de contacto?”  
  - `Name` → `AMAZON.FirstName` → Prompt: “¿A nombre de quién reservo?” *(opcional)*  
  - `Service` → `AMAZON.AlphaNumeric` → Prompt: “¿Qué servicio? (ej., Mantenimiento)” *(opcional)*  
  - `Plate` → `AMAZON.AlphaNumeric` → Prompt: “¿Placa del vehículo?” *(opcional)*  
  - `ShopId` → `AMAZON.AlphaNumeric` → Prompt: “¿En qué sede?” *(opcional; default “Main”)*
- **Code hook**: **Fulfillment** = `workshop-appointments-fulfillment` (solo fulfillment; **no** uses validation hook).  
- **Closing response**: deja que **Lambda** responda.

**B. Intent `CancelBooking`**  
- **Utterances**: “cancelar cita”, “anular mi reserva”, “quiero cancelar”  
- **Slots** *(nombres exactos)*:  
  - `AppointmentId` → `AMAZON.AlphaNumeric` → Prompt: “¿Cuál es el ID de la cita?” *(recomendado)*  
  - **Alternativa si no hay ID**: `Phone` (`AMAZON.PhoneNumber`) + `Date` (`AMAZON.Date`) *(opcionales)*  
  - `ShopId` (`AMAZON.AlphaNumeric`, opc.)  
- **Code hook**: **Fulfillment** = `workshop-appointments-fulfillment`.  
- **Closing response**: Lambda responde.

**Build** el bot y **prueba** en la ventana de test.

---

### 5) Pruebas end-to-end

- **MakeBooking (happy path):**  
  “Quiero reservar el 2025-09-01 a las 10:00” → completa `Phone` y opcionales → ver respuesta con **ID** (p. ej., `A-ABC12345`).  
- **Colisión:** intenta agendar **misma fecha/hora** en la misma `ShopId` → el bot debe sugerir cambiar hora.  
- **CancelBooking por ID:** “cancelar cita” → `AppointmentId` → respuesta “Cita cancelada.”  
- **Ver datos:** DynamoDB → `WorkshopAppointments` → **Explore table** → ítems `SHOP#...` y `CUSTOMER#...`.

---

## 🧪 Ejercicios guiados

1) **Validación extra:** fuerza que `Service` ∈ {Mantenimiento, Diagnóstico}. Si no, responde con sugerencias.  
2) **Sedes:** agrega `ShopId` en utterances y prueba reservas/cancelaciones para sedes diferentes.  
3) **Confirmación previa:** agrega confirm prompts en `MakeBooking` antes de cerrar.

---

## 🆘 Solución de problemas

- **AccessDenied a DynamoDB:** revisa ARN en la *inline policy* y el nombre real de la tabla.  
- **No se invoca la Lambda:** verifica que activaste **Fulfillment code hook** en ambos intents y **Build**.  
- **Slots no se llenan:** confirma **slot types** (Date/Time/Phone/FirstName) y prompts claros.  
- **IDs inconsistentes:** recuerda que se generan con prefijo `A-` y 8 hex en mayúscula.

---

## 🔗 Recursos útiles

- **Formato de evento/respuesta en Lex V2 (Close, ElicitSlot, Delegate):**  
  - https://docs.aws.amazon.com/lexv2/latest/dg/lambda-input-format.html  
  - https://docs.aws.amazon.com/lexv2/latest/dg/lambda-response-format.html
- **Built-in slot types (Date, Time, Phone, FirstName):**  
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slots.html  
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-time.html  
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-phone.html  
  - https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-first-name.html
- **DynamoDB + Boto3 (Table, put_item, delete_item, query):**  
  - https://boto3.amazonaws.com/v1/documentation/api/latest/guide/dynamodb.html  
  - https://docs.aws.amazon.com/code-library/latest/ug/python_3_dynamodb_code_examples.html
- **Diseño de tabla única (PK/SK, patrones de acceso):**  
  - https://aws.amazon.com/blogs/compute/creating-a-single-table-design-with-amazon-dynamodb/
- **IAM CRUD para una tabla específica:**  
  - https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/iam-policy-example-data-crud.html

---

## 📄 Licencia

Este material se publica con licencia **MIT**. Puedes usarlo y adaptarlo libremente.
