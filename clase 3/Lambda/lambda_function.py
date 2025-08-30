# lambda_function.py
import os, json, uuid, datetime
import boto3
from boto3.dynamodb.conditions import Key

DDB = boto3.resource("dynamodb").Table(os.getenv("TABLE_NAME", "WorkshopAppointments"))

# ---------- Helpers de respuesta Lex V2 ----------
def _elicit_slot(event, slot_to_elicit, msg):
    intent = event["sessionState"]["intent"]
    return {
        "sessionState": {
            "dialogAction": {"type": "ElicitSlot", "slotToElicit": slot_to_elicit},
            "intent": intent,
        },
        "messages": [{"contentType": "PlainText", "content": msg}],
    }

def _delegate(event):
    intent = event["sessionState"]["intent"]
    return {
        "sessionState": {
            "dialogAction": {"type": "Delegate"},
            "intent": intent,
        }
    }

def _close(intent_name, text):
    return {
        "sessionState": {
            "dialogAction": {"type": "Close"},
            "intent": {"name": intent_name, "state": "Fulfilled"},
        },
        "messages": [{"contentType": "PlainText", "content": text}],
    }

# ---------- Utilidades comunes ----------
def _get_slot(event, name):
    slots = event["sessionState"]["intent"].get("slots") or {}
    v = slots.get(name)
    return v and v.get("value", {}).get("interpretedValue")

def _hours():
    it = DDB.get_item(Key={"pk": "INFO", "sk": "HOURS"}).get("Item")
    return it or {"open": "09:00", "close": "18:00", "slotMinutes": 30}

def _parse_time(s):  # "HH:MM" -> datetime.time
    h, m = map(int, s.split(":"))
    return datetime.time(h, m)

def _iter_slots(day, t_open, t_close, minutes):
    cur = datetime.datetime.combine(day, t_open)
    end = datetime.datetime.combine(day, t_close)
    while cur <= end:
        yield cur.time().strftime("%H:%M")
        cur += datetime.timedelta(minutes=minutes)

def _taken_times(shop, date_s):
    q = DDB.query(
        KeyConditionExpression=Key("pk").eq(f"SHOP#{shop}")
        & Key("sk").begins_with(f"APPT#{date_s}#")
    )
    return {it["time"] for it in q.get("Items", [])}

def _suggest_times(shop, date_s, limit=3):
    hrs = _hours()
    day = datetime.date.fromisoformat(date_s)
    taken = _taken_times(shop, date_s)
    all_slots = list(
        _iter_slots(
            day,
            _parse_time(hrs["open"]),
            _parse_time(hrs["close"]),
            int(hrs.get("slotMinutes", 30)),
        )
    )
    return [t for t in all_slots if t not in taken][:limit]

# ---------- Validación en DialogCodeHook (MakeBooking) ----------
def _validate_make_booking(event):
    shop = _get_slot(event, "ShopId") or "Main"
    service = (_get_slot(event, "Service") or "Mantenimiento").title()
    date_s = _get_slot(event, "Date")
    time_s = _get_slot(event, "Time")
    phone = _get_slot(event, "Phone")
    name   = _get_slot(event, "Name")

    # 1) Completar requeridos con guía y sugerencias
    if not date_s:
        return _elicit_slot(event, "Date", "¿Para qué fecha?")
    if not time_s:
        sug = _suggest_times(shop, date_s) if date_s else []
        hint = f" Por ejemplo: {', '.join(sug)}." if sug else ""
        return _elicit_slot(event, "Time", "¿A qué hora te conviene?" + hint)
    if not phone:
        return _elicit_slot(event, "Phone", "¿Tu teléfono de contacto?")
    if not name:
        return _elicit_slot(event, "Name", "¿Cuál es tu nombre?")

    # 2) Reglas: horario de atención
    hrs = _hours()
    if not (hrs["open"] <= time_s <= hrs["close"]):
        return _elicit_slot(
            event,
            "Time",
            f"Atendemos de {hrs['open']} a {hrs['close']}. ¿Qué hora prefieres dentro de ese rango?",
        )

    # 3) Fecha válida y lead time de 2h si es para hoy
    try:
        day = datetime.date.fromisoformat(date_s)
    except Exception:
        return _elicit_slot(event, "Date", "La fecha no se entiende. Usa AAAA-MM-DD.")
    now = datetime.datetime.now()
    if day == now.date():
        hh, mm = map(int, time_s.split(":"))
        appt_dt = datetime.datetime(now.year, now.month, now.day, hh, mm)
        if appt_dt < now + datetime.timedelta(hours=2):
            return _elicit_slot(event, "Time", "Para hoy necesitamos 2 horas de anticipación. ¿Otra hora?")

    # 4) Colisión exacta
    shop_pk = f"SHOP#{shop}"
    q = DDB.query(
        KeyConditionExpression=Key("pk").eq(shop_pk)
        & Key("sk").begins_with(f"APPT#{date_s}#{time_s}#")
    )
    if q.get("Items"):
        sug = _suggest_times(shop, date_s)
        hint = f" Disponibilidad: {', '.join(sug)}." if sug else ""
        return _elicit_slot(event, "Time", "Ese horario ya está tomado." + hint)

    # 5) Todo OK → que Lex continúe el diálogo
    return _delegate(event)

# ---------- Intents ----------
def make_booking(intent_name, event):
    # Dialog phase: validar/sugerir sin escribir en DB
    if event.get("invocationSource") == "DialogCodeHook":
        return _validate_make_booking(event)

    # Fulfillment: crear la cita
    shop = _get_slot(event, "ShopId") or "Main"
    service = (_get_slot(event, "Service") or "Mantenimiento").title()
    date_s = _get_slot(event, "Date")
    time_s = _get_slot(event, "Time")
    name = _get_slot(event, "Name")
    phone = _get_slot(event, "Phone")
    plate = _get_slot(event, "Plate")

    if not (date_s and time_s and phone):
        return _close(intent_name, "Me faltan datos (fecha, hora y teléfono).")

    hrs = _hours()
    if not (hrs["open"] <= time_s <= hrs["close"]):
        return _close(intent_name, f"Nuestro horario es {hrs['open']} a {hrs['close']}.")

    appt_id = "A-" + uuid.uuid4().hex[:8].upper()
    shop_pk = f"SHOP#{shop}"
    sk = f"APPT#{date_s}#{time_s}#{appt_id}"

    # Chequeo de colisión final por seguridad
    q = DDB.query(
        KeyConditionExpression=Key("pk").eq(shop_pk)
        & Key("sk").begins_with(f"APPT#{date_s}#{time_s}#")
    )
    if q.get("Items"):
        return _close(intent_name, "Ese horario ya está tomado. Intenta otro, por favor.")

    # Escribir dos vistas: por SHOP y por CUSTOMER
    DDB.put_item(
        Item={
            "pk": shop_pk,
            "sk": sk,
            "service": service,
            "date": date_s,
            "time": time_s,
            "name": name,
            "phone": phone,
            "plate": plate,
        }
    )
    DDB.put_item(
        Item={
            "pk": f"CUSTOMER#{phone}",
            "sk": sk,
            "service": service,
            "date": date_s,
            "time": time_s,
            "name": name,
            "shop": shop,
            "plate": plate,
        }
    )
    msg = f"✅ Listo {name}. Reservé {service} el {date_s} a las {time_s}. Tu ID es {appt_id}."
    return _close(intent_name, msg)

def cancel_booking(intent_name, event):
    appt_id = _get_slot(event, "AppointmentId")
    phone = _get_slot(event, "Phone")
    date_s = _get_slot(event, "Date")
    shop = _get_slot(event, "ShopId") or "Main"

    items_to_del = []
    if appt_id:
        shop_pk = f"SHOP#{shop}"
        q1 = DDB.query(
            KeyConditionExpression=Key("pk").eq(shop_pk) & Key("sk").begins_with("APPT#")
        )
        for it in q1.get("Items", []):
            if it["sk"].endswith(appt_id):
                items_to_del.append(("SHOP", it))
        if phone:
            q2 = DDB.query(
                KeyConditionExpression=Key("pk").eq(f"CUSTOMER#{phone}")
                & Key("sk").begins_with("APPT#")
            )
            for it in q2.get("Items", []):
                if it["sk"].endswith(appt_id):
                    items_to_del.append(("CUST", it))
    elif phone and date_s:
        q = DDB.query(
            KeyConditionExpression=Key("pk").eq(f"CUSTOMER#{phone}")
            & Key("sk").begins_with(f"APPT#{date_s}#")
        )
        if q.get("Items"):
            items_to_del.append(("CUST", q["Items"][0]))
    else:
        return _close(intent_name, "Indica el ID de la cita, o teléfono y fecha.")

    if not items_to_del:
        return _close(intent_name, "No encontré la cita a cancelar.")

    deleted = 0
    for _, it in items_to_del:
        DDB.delete_item(Key={"pk": it["pk"], "sk": it["sk"]})
        deleted += 1
    msg = "Cita cancelada." if deleted else "No se pudo cancelar."
    return _close(intent_name, msg)

# ---------- Router ----------
def lambda_handler(event, context):
    intent = event["sessionState"]["intent"]["name"]
    if intent == "MakeBooking":
        return make_booking(intent, event)
    if intent == "CancelBooking":
        return cancel_booking(intent, event)
    return _close(intent, "Solo manejo reservar y cancelar citas.")
