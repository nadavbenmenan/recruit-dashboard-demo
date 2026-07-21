#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
מחולל נתונים סינתטי לדשבורד הגיוס — הדגמה פומבית (GitHub Pages).

**נתונים מומצאים לחלוטין.** אין נגיעה במאגר האמיתי, בשום אקסל ובשום קובץ אמת —
רק random עם seed קבוע, כדי שהתוצאה תהיה זהה בכל ריצה.

מייצר לתיקיית data/:
  candidates.json — 60,000 מועמדים (6,000 בהליך), עמודות קומפקטיות (קודים + היסטים)
  events.json     — הפסקות הליך / מסירי מועמדות (90% / 10%)
  meta.json       — ממדים, שמות טווחים, יעדי SLA, מדדים, בסיס-צפי, סטטוס ותאריכי עדכון

הרצה:  python3 gen_data.py
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(20260721)

OUT = Path(__file__).resolve().parent / "data"
OUT.mkdir(exist_ok=True)

# חלון הפעילות: 1.1.2026 – 30.6.2026. התאריכים מתפלגים נורמלית בתוכו.
BASE = date(2026, 1, 1)          # יום 0
WIN = 180                        # עד 30.6.26
TODAY = date(2026, 7, 15)        # "נכון לתאריך" של דוח 'פעילים'
SNAP_OFF = (TODAY - BASE).days

TOTAL = 60_000
IN_PROCESS = 6_000

# ---- ממדים ----
ROLES = ["חוקר", "בלש", "סייר", "מנהלה"]                 # נגזר מה'דרישה'
SUPERGROUPS = {"שטח": ["חוקר", "בלש", "סייר"], "מנהלה": ["מנהלה"]}

# 10 היחידות (נדב, סופי) — למג"ב הנתח הגדול ביותר, השאר קטנים ממנו.
UNITS = ["צפון", "חוף", "מרכז", 'ת"א', "ירושלים", "דרום",
         'מג"ב', 'אח"ם', 'מטא"ר', 'ש"י']
UNIT_W = {"צפון": 10, "חוף": 8, "מרכז": 13, 'ת"א': 9, "ירושלים": 8,
          "דרום": 11, 'מג"ב': 24, 'אח"ם': 7, 'מטא"ר': 6, 'ש"י': 6}
# מקדם עומס — מזיז את התפלגות ימי-ההמתנה, וכך נורות ה-SLA נבדלות בין היחידות.
UNIT_LOAD = {"צפון": 1.0, "חוף": 0.85, "מרכז": 1.15, 'ת"א': 1.05, "ירושלים": 0.9,
             "דרום": 1.2, 'מג"ב': 1.45, 'אח"ם': 0.7, 'מטא"ר': 0.65, 'ש"י': 1.3}
# היסט מרכז-הזמן לכל יחידה (ימים) — כדי שהתפלגות התאריכים תשתנה בין היחידות
# ("מעניין"): כל יחידה מגיעה לשיא בחודש אחר בתוך החלון.
UNIT_SHIFT = {"צפון": -25, "חוף": 10, "מרכז": 0, 'ת"א': 20, "ירושלים": -10,
              "דרום": 15, 'מג"ב': -30, 'אח"ם': 30, 'מטא"ר': 5, 'ש"י': -5}
ROLE_SHIFT = {"חוקר": 0, "בלש": 12, "סייר": -12, "מנהלה": 6}

STAGES = ["הגשה בלבד", "אחרי בדיקת קבצים", "אחרי זימון מקוון", 'אחרי דפ"ר',
          "אחרי ראיון/רופא", 'אחרי מרכ"ה/אישיות', 'אחרי קב"ט', 'אחרי יחב"מ']
STAGE_RANGE = {"הגשה בלבד": 1, "אחרי בדיקת קבצים": 1, "אחרי זימון מקוון": 1,
               'אחרי דפ"ר': 2, "אחרי ראיון/רופא": 3, 'אחרי מרכ"ה/אישיות': 4,
               'אחרי קב"ט': 5, 'אחרי יחב"מ': 5}
STAGE_W_IN = {"הגשה בלבד": 10, "אחרי בדיקת קבצים": 30, "אחרי זימון מקוון": 14,
              'אחרי דפ"ר': 10, "אחרי ראיון/רופא": 12, 'אחרי מרכ"ה/אישיות': 12,
              'אחרי קב"ט': 7, 'אחרי יחב"מ': 5}

RANGE_NAMES = {1: 'הגשה → דפ"ר', 2: 'דפ"ר → רמה (ראיון/רופא)',
               3: 'רמה → אישיות/מרכז הערכה', 4: 'אישיות/מרכז הערכה → קב"ט',
               5: 'קב"ט → גיוס'}
RANGE_TARGET = {1: 32, 2: 10, 3: 16, 4: 8, 5: 24}
# לחץ לכל טווח — מזיז את הנורה הכוללת לתערובת (לא כולן זהות).
RANGE_PRESSURE = {1: 0.95, 2: 1.35, 3: 0.7, 4: 1.5, 5: 1.0}

METRICS = [
    ("a", 'הגשה → גיוס'), ("b", 'הגשה → דפ"ר'), ("c", 'דפ"ר → ראיון'),
    ("d", 'ראיון → מרכ"ה'), ("e", 'ראיון → אישיות'), ("f", 'מרכ"ה → קב"ט'),
    ("g", 'מרכ"ה → יחב"מ'), ("h", 'אישיות → קב"ט'), ("i", 'אישיות → יחב"מ'),
    ("j", 'קב"ט → יחב"מ'), ("k", 'יחב"מ → גיוס'),
]
WAITING = [5, 15, 30, 60, 100]

STOP_REASONS = ["לא ענה לפניות", "לא עמד בתנאי סף", "נכשל במבחן מיון",
                "בחר להפסיק מרצון", "אי-התאמה לתפקיד", "חוסר זמינות",
                "סיבה רפואית", "לא הופיע ליום מיון", "עבר להליך אחר",
                "בעיית רישום פלילי"]

# צפי — 5 שלבים, שורה לכל שלב. current_stage ממופה לאחד מהם.
FC_STAGES = ["מבחן מקוון", "ראיון מאבחנת", "מרכז הערכה", 'קב"ט', "גיוס"]
STAGE_TO_FC = {"הגשה בלבד": "מבחן מקוון", "אחרי בדיקת קבצים": "מבחן מקוון",
               "אחרי זימון מקוון": "מבחן מקוון", 'אחרי דפ"ר': "ראיון מאבחנת",
               "אחרי ראיון/רופא": "ראיון מאבחנת", 'אחרי מרכ"ה/אישיות': "מרכז הערכה",
               'אחרי קב"ט': 'קב"ט', 'אחרי יחב"מ': "גיוס"}
# שיעור צמיחה חזוי לכל שלב — תמיד 10%–15% (הדגמה, בלי קשר לנתוני אמת).
FC_GROWTH = {s: round(random.uniform(0.10, 0.15), 3) for s in FC_STAGES}

r_idx = {r: i for i, r in enumerate(ROLES)}
u_idx = {u: i for i, u in enumerate(UNITS)}
s_idx = {s: i for i, s in enumerate(STAGES)}


def wpick(weights: dict):
    keys = list(weights)
    return random.choices(keys, weights=[weights[k] for k in keys])[0]


def norm_off(mean, sd=42):
    """היסט-יום בתוך החלון, מהתפלגות נורמלית (clamp ל-0..WIN)."""
    return max(0, min(WIN, int(random.gauss(mean, sd))))


# ---------------------------------------------------------------------------
# מועמדים
# ---------------------------------------------------------------------------
cands = []
in_flags = []
in_ids = random.sample(range(TOTAL), IN_PROCESS)
in_set = set(in_ids)

for cid in range(TOTAL):
    unit = wpick(UNIT_W)
    load = UNIT_LOAD[unit]
    if unit in ('אח"ם', 'מטא"ר', 'ש"י'):
        role = wpick({"חוקר": 38, "בלש": 18, "סייר": 14, "מנהלה": 30})
    else:
        role = wpick({"חוקר": 30, "בלש": 28, "סייר": 30, "מנהלה": 12})
    station = 1 if random.random() < 0.62 else 0
    in_proc = cid in in_set

    # שלב + ימי המתנה (SLA) — כמו קודם, ביחס ליעד הטווח ולעומס היחידה.
    if in_proc:
        stage = wpick(STAGE_W_IN)
        b = STAGE_RANGE[stage]
        tgt = RANGE_TARGET[b]
        if random.random() < 0.05:
            days = int(tgt * random.uniform(2.6, 5.2) * load)
        else:
            mean = 0.5 * tgt * load * RANGE_PRESSURE[b]
            days = max(1, int(random.gammavariate(2.4, mean / 2.4)))
    else:
        if random.random() < 0.45:
            stage = 'אחרי יחב"מ'
        else:
            stage = wpick({s: STAGE_W_IN[s] for s in STAGES})
        tgt = RANGE_TARGET[STAGE_RANGE[stage]]
        days = max(1, int(random.gammavariate(2.4, 0.62 * tgt * load / 2.4)))

    # תאריכי פעילות/הגשה — התפלגות נורמלית על החלון, עם היסט לפי יחידה ותפקיד.
    mean = 90 + UNIT_SHIFT[unit] + ROLE_SHIFT[role]
    last_off = norm_off(mean, 42)
    has_sub = random.random() > 0.08
    anchor_off = max(0, last_off - random.randint(5, 40)) if has_sub else -1

    cands.append([cid, r_idx[role], u_idx[unit], station, s_idx[stage],
                  days, last_off, 1 if in_proc else 0, anchor_off])
    in_flags.append(in_proc)

# ---------------------------------------------------------------------------
# בסיס-צפי — ספירת מי-שבהליך לכל (שלב-צפי × תפקיד × יחידה)
# ---------------------------------------------------------------------------
fbase = {}
for row, is_in in zip(cands, in_flags):
    if not is_in:
        continue
    fc = STAGE_TO_FC[STAGES[row[4]]]
    key = (fc, ROLES[row[1]], UNITS[row[2]])
    fbase[key] = fbase.get(key, 0) + 1
forecast_base = [{"stage": k[0], "role": k[1], "district": k[2], "count": v}
                 for k, v in fbase.items()]

# ---------------------------------------------------------------------------
# אירועים — 90% הפסקות הליך · 10% מסירי מועמדות; תאריכים נורמליים ומעניינים
# ---------------------------------------------------------------------------
N_STOPS = 9_000
N_WITHDRAW = 1_000
STAGE_W_EVENT = {"הגשה בלבד": 8, "אחרי בדיקת קבצים": 26, "אחרי זימון מקוון": 16,
                 'אחרי דפ"ר': 16, "אחרי ראיון/רופא": 14, 'אחרי מרכ"ה/אישיות': 12,
                 'אחרי קב"ט': 5, 'אחרי יחב"מ': 3}
events = []


def rand_event_row(cid, kind, reason_idx):
    stage = wpick(STAGE_W_EVENT)
    unit = UNITS[cands[cid][2]]
    role = ROLES[cands[cid][1]]
    # תאריך נורמלי עם היסט לפי יחידה+תפקיד, והסרות מוקדמות-מעט מהפסקות.
    mean = 90 + UNIT_SHIFT[unit] + ROLE_SHIFT[role] + (-12 if kind == 0 else 8)
    date_off = norm_off(mean, 40)
    return [cid, kind, date_off, reason_idx, s_idx[stage],
            1 if in_flags[cid] else 0]


wd_ids = random.sample(range(TOTAL), N_WITHDRAW)
for cid in wd_ids:
    events.append(rand_event_row(cid, 0, -1))
for _ in range(N_STOPS):
    cid = random.randrange(TOTAL)
    events.append(rand_event_row(cid, 1, random.randrange(len(STOP_REASONS))))

# ---------------------------------------------------------------------------
# כתיבה
# ---------------------------------------------------------------------------
candidates = {"cols": ["id", "role", "district", "station", "stage",
                       "days", "last", "inproc", "anchor"], "rows": cands}
events_obj = {"cols": ["id", "kind", "date", "reason", "stage", "inproc"],
              "rows": events}
meta = {
    "base_date": BASE.isoformat(),
    "window_days": WIN,
    "snapshot_off": SNAP_OFF,
    "roles": ROLES,
    "supergroups": SUPERGROUPS,
    "units": UNITS,
    "stages": STAGES,
    "stage_range": {s: STAGE_RANGE[s] for s in STAGES},
    "ranges": [{"no": n, "name": RANGE_NAMES[n], "target": RANGE_TARGET[n]}
               for n in range(1, 6)],
    "metrics": [{"metric": m, "heb": h} for m, h in METRICS],
    "range_stage_map": {
        "a": "__ALL__",
        "b": ["הגשה בלבד", "אחרי בדיקת קבצים", "אחרי זימון מקוון"],
        "c": ['אחרי דפ"ר'], "d": ["אחרי ראיון/רופא"], "e": ["אחרי ראיון/רופא"],
        "f": ['אחרי מרכ"ה/אישיות'], "g": ['אחרי מרכ"ה/אישיות'],
        "h": ['אחרי מרכ"ה/אישיות'], "i": ['אחרי מרכ"ה/אישיות'],
        "j": ['אחרי קב"ט'], "k": ['אחרי יחב"מ'],
    },
    "waiting": WAITING,
    "reasons": STOP_REASONS,
    "withdraw_reason": "הסיר מועמדות",
    "forecast_stages": FC_STAGES,
    "forecast_growth": FC_GROWTH,
    "forecast_base": forecast_base,
    "status": {"loaded": True, "snapshot_date": TODAY.isoformat(),
               "in_file": IN_PROCESS, "in_process": IN_PROCESS, "all": TOTAL,
               "mode_all": "כולם", "mode_in": "בהליך"},
    "file_updates": [
        {"type": "statuses", "label": "פעילים", "file_date": "2026-07-15", "source_file": "פעילים 15.7 (הדגמה)"},
        {"type": "submissions", "label": "הגשות", "file_date": "2026-07-14", "source_file": "הגשות 14.7 (הדגמה)"},
        {"type": "activities", "label": "פעילויות", "file_date": "2026-07-14", "source_file": "פעילויות 14.7 (הדגמה)"},
        {"type": "stops", "label": "הפסקת הליך", "file_date": "2026-07-13", "source_file": "הפסקות 13.7 (הדגמה)"},
    ],
    "reports": [
        {"name": "ייצוא כל המועמדים לפי זמנים – 5 שלבים", "desc": "פיבוט משך כל טווח לכל מועמד."},
        {"name": "ייצוא כל המועמדים לפי זמנים – 11 שלבים", "desc": "כל 11 המדדים הגולמיים לכל מועמד."},
        {"name": "ייצוא לפי מחוז", "desc": "רשימת המועמדים של מחוז נבחר.", "requires_district": True},
        {"name": "דוח חריגות לפי 5 שלבים", "desc": "החורגים מיעד ה-SLA, לפי זמן בהליך יורד."},
    ],
}

for name, obj in [("candidates.json", candidates), ("events.json", events_obj),
                  ("meta.json", meta)]:
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False,
                                       separators=(",", ":")), encoding="utf-8")

print("candidates:", len(cands), "| events:", len(events),
      "| in_process:", sum(in_flags), "| forecast_base rows:", len(forecast_base))
print("roles:", ROLES)
print("forecast growth:", FC_GROWTH)
for name in ("candidates.json", "events.json", "meta.json"):
    print(f"  data/{name}: {(OUT/name).stat().st_size/1024:,.0f} KB")
