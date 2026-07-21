#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
מחולל נתונים סינתטי לדשבורד הגיוס — הדגמה פומבית (GitHub Pages).

**נתונים מומצאים לחלוטין.** אין כאן שום נגיעה במאגר האמיתי, בשום אקסל ובשום
קובץ אמת — רק random עם seed קבוע, כדי שהתוצאה תהיה זהה בכל ריצה.

מייצר לתיקיית data/:
  candidates.json — 60,000 מועמדים (6,000 בהליך), עמודות קומפקטיות (קודים + היסטים)
  events.json     — הפסקות הליך / מסירי מועמדות (90% / 10%)
  meta.json       — ממדים, שמות טווחים, יעדי SLA, מדדים, צפי, סטטוס ותאריכי עדכון

הרצה:  python3 gen_data.py
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(20260721)

OUT = Path(__file__).resolve().parent / "data"
OUT.mkdir(exist_ok=True)

BASE = date(2025, 7, 1)          # יום 0 של ההיסטים
TODAY = date(2026, 7, 15)        # "נכון לתאריך" של דוח 'פעילים'
SNAP_OFF = (TODAY - BASE).days

TOTAL = 60_000
IN_PROCESS = 6_000

# ---- ממדים ----
ROLES = ["חוקר", "בלש", "מנהלה"]                       # נגזר מה'דרישה'
SUPERGROUPS = {"שטח": ["חוקר", "בלש"], "מנהלה": ["מנהלה"]}

# 10 היחידות (נדב, סופי) — למג"ב הנתח הגדול ביותר, השאר קטנים ממנו.
UNITS = ["צפון", "חוף", "מרכז", 'ת"א', "ירושלים", "דרום",
         'מג"ב', 'אח"ם', 'מטא"ר', 'ש"י']
UNIT_W = {"צפון": 10, "חוף": 8, "מרכז": 13, 'ת"א': 9, "ירושלים": 8,
          "דרום": 11, 'מג"ב': 24, 'אח"ם': 7, 'מטא"ר': 6, 'ש"י': 6}
# מקדם עומס לכל יחידה — מזיז את התפלגות ימי-ההמתנה, וכך נורות ה-SLA נבדלות
# בין היחידות. מג"ב וש"י עמוסות (יותר אדום), מטא"ר/אח"ם מהירות (יותר ירוק).
UNIT_LOAD = {"צפון": 1.0, "חוף": 0.85, "מרכז": 1.15, 'ת"א': 1.05, "ירושלים": 0.9,
             "דרום": 1.2, 'מג"ב': 1.45, 'אח"ם': 0.7, 'מטא"ר': 0.65, 'ש"י': 1.3}

STAGES = ["הגשה בלבד", "אחרי בדיקת קבצים", "אחרי זימון מקוון", 'אחרי דפ"ר',
          "אחרי ראיון/רופא", 'אחרי מרכ"ה/אישיות', 'אחרי קב"ט', 'אחרי יחב"מ']
STAGE_RANGE = {"הגשה בלבד": 1, "אחרי בדיקת קבצים": 1, "אחרי זימון מקוון": 1,
               'אחרי דפ"ר': 2, "אחרי ראיון/רופא": 3, 'אחרי מרכ"ה/אישיות': 4,
               'אחרי קב"ט': 5, 'אחרי יחב"מ': 5}
# התפלגות השלב בקרב מי שבהליך — כובד לשלבים המוקדמים (טווח 1 הגדול ביותר)
STAGE_W_IN = {"הגשה בלבד": 10, "אחרי בדיקת קבצים": 30, "אחרי זימון מקוון": 14,
              'אחרי דפ"ר': 10, "אחרי ראיון/רופא": 12, 'אחרי מרכ"ה/אישיות': 12,
              'אחרי קב"ט': 7, 'אחרי יחב"מ': 5}
# משך אופייני (חציון גס) של המתנה בכל שלב, בימים — בסיס לרעש
STAGE_BASE_DAYS = {"הגשה בלבד": 24, "אחרי בדיקת קבצים": 34, "אחרי זימון מקוון": 20,
                   'אחרי דפ"ר': 14, "אחרי ראיון/רופא": 22, 'אחרי מרכ"ה/אישיות': 18,
                   'אחרי קב"ט': 20, 'אחרי יחב"מ': 26}

# יעדי SLA (target_days) — החציון ההיסטורי לכל טווח (v5.1: X אחד לכל שלב)
RANGE_NAMES = {1: 'הגשה → דפ"ר', 2: 'דפ"ר → רמה (ראיון/רופא)',
               3: 'רמה → אישיות/מרכז הערכה', 4: 'אישיות/מרכז הערכה → קב"ט',
               5: 'קב"ט → גיוס'}
RANGE_TARGET = {1: 32, 2: 10, 3: 16, 4: 8, 5: 24}
# לחץ לכל טווח — מזיז את הנורה הכוללת כך שתהיה תערובת (לא כולן זהות):
# טווח 3 מהיר (ירוק), טווחים 2/4 עמוסים (אדום/צהוב), 1/5 באמצע.
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

r_idx = {r: i for i, r in enumerate(ROLES)}
u_idx = {u: i for i, u in enumerate(UNITS)}
s_idx = {s: i for i, s in enumerate(STAGES)}


def wpick(weights: dict):
    keys = list(weights)
    return random.choices(keys, weights=[weights[k] for k in keys])[0]


def half_of(off):
    """תקופה לפי תאריך העוגן (היסט מ-BASE)."""
    d = BASE + timedelta(days=off)
    if d.year == 2025:
        return "2025H2" if d.month >= 7 else "2025H1"
    return "2026H1"


# ---------------------------------------------------------------------------
# מועמדים
# ---------------------------------------------------------------------------
cands = []                       # שורות קומפקטיות
in_flags = []                    # מי בהליך (למחולל האירועים והצפי)
in_ids = random.sample(range(TOTAL), IN_PROCESS)
in_set = set(in_ids)

for cid in range(TOTAL):
    unit = wpick(UNIT_W)
    load = UNIT_LOAD[unit]
    # מנהלה מעט יותר נפוצה במטה, שטח (חוקר/בלש) ביחידות המבצעיות
    if unit in ('אח"ם', 'מטא"ר', 'ש"י'):
        role = wpick({"חוקר": 45, "בלש": 20, "מנהלה": 35})
    else:
        role = wpick({"חוקר": 42, "בלש": 40, "מנהלה": 18})
    station = 1 if random.random() < 0.62 else 0
    in_proc = cid in in_set

    # ימי ההמתנה נמדדים ביחס ליעד ה-SLA של הטווח, עם מקדם עומס היחידה:
    # יחידה מהירה (load<1) -> רוב המועמדים מתחת ליעד (ירוק), עמוסה (load>1) ->
    # רבים חורגים (אדום). כך נורות ה-SLA נותנות תערובת אמיתית ופער בין יחידות.
    if in_proc:
        stage = wpick(STAGE_W_IN)
        b = STAGE_RANGE[stage]
        tgt = RANGE_TARGET[b]
        if random.random() < 0.05:          # זנב "תקועים" — יוצר ממתינים מעל 90 יום
            days = int(tgt * random.uniform(2.6, 5.2) * load)
        else:
            mean = 0.5 * tgt * load * RANGE_PRESSURE[b]
            days = max(1, int(random.gammavariate(2.4, mean / 2.4)))
        last_off = SNAP_OFF - random.randint(0, min(days, 20))
    else:
        # היסטוריים: חלק גויסו (שלב מתקדם), חלק נעצרו בדרך
        if random.random() < 0.45:
            stage = 'אחרי יחב"מ'
        else:
            stage = wpick({s: STAGE_W_IN[s] for s in STAGES})
        tgt = RANGE_TARGET[STAGE_RANGE[stage]]
        days = max(1, int(random.gammavariate(2.4, 0.62 * tgt * load / 2.4)))
        last_off = random.randint(0, SNAP_OFF - 1)

    # anchor: לרוב יש הגשה; ~8% "ללא הגשה" (נכנסו דרך בדיקת קבצים)
    has_sub = random.random() > 0.08
    anchor_off = max(0, last_off - days)
    cands.append([cid, r_idx[role], u_idx[unit], station, s_idx[stage],
                  days, last_off, 1 if in_proc else 0,
                  anchor_off if has_sub else -1])
    in_flags.append(in_proc)

# ---------------------------------------------------------------------------
# צפי — מצטבר לפי תפקיד × יחידה × יעד × שבוע (תומך בסינון תפקיד/מחוז)
# ---------------------------------------------------------------------------
# לכל מועמד בהליך, תרומת-תוחלת ליעד 'קב"ט' ו'גיוס' באחד מ-4 השבועות.
STAGE_FC = {   # stage -> [(target, week, prob), ...]
    'אחרי יחב"מ':        [("גיוס", 1, 0.82)],
    'אחרי קב"ט':         [("גיוס", 3, 0.70)],
    'אחרי מרכ"ה/אישיות':  [('קב"ט', 2, 0.85), ("גיוס", 4, 0.58)],
    "אחרי ראיון/רופא":    [('קב"ט', 4, 0.60)],
}
fc = {}   # (role, unit, target, week) -> [expected, pipeline]
for row, is_in in zip(cands, in_flags):
    if not is_in:
        continue
    stage = STAGES[row[4]]
    role = ROLES[row[1]]
    unit = UNITS[row[2]]
    for target, week, prob in STAGE_FC.get(stage, []):
        p = max(0.0, min(1.0, prob + random.uniform(-0.08, 0.08)))
        key = (role, unit, target, week)
        cell = fc.setdefault(key, [0.0, 0])
        cell[0] += p
        cell[1] += 1
forecast = [{"role": k[0], "district": k[1], "target": k[2], "week": k[3],
             "expected": round(v[0], 3), "pipeline": v[1]} for k, v in fc.items()]

# ---------------------------------------------------------------------------
# אירועים — 90% הפסקות הליך · 10% מסירי מועמדות
# ---------------------------------------------------------------------------
N_STOPS = 9_000
N_WITHDRAW = 1_000
# שלב-בעת-האירוע — כובד לשלבים המוקדמים/אמצע (שם נושרים)
STAGE_W_EVENT = {"הגשה בלבד": 8, "אחרי בדיקת קבצים": 26, "אחרי זימון מקוון": 16,
                 'אחרי דפ"ר': 16, "אחרי ראיון/רופא": 14, 'אחרי מרכ"ה/אישיות': 12,
                 'אחרי קב"ט': 5, 'אחרי יחב"מ': 3}
events = []   # [cid, kind(0=withdraw,1=stop), date_off, reason_idx, stage_idx, in_proc]


def rand_event_row(cid, kind, reason_idx):
    stage = wpick(STAGE_W_EVENT)
    date_off = random.randint(0, SNAP_OFF)
    return [cid, kind, date_off, reason_idx, s_idx[stage],
            1 if in_flags[cid] else 0]


# מסירי מועמדות — שורה אחת לכל מועמד (dedup); reason_idx = -1 => 'הסיר מועמדות'
wd_ids = random.sample(range(TOTAL), N_WITHDRAW)
for cid in wd_ids:
    events.append(rand_event_row(cid, 0, -1))

# הפסקות כלליות — שורה לכל אירוע, למועמד יכולות להיות כמה
for _ in range(N_STOPS):
    cid = random.randrange(TOTAL)
    events.append(rand_event_row(cid, 1, random.randrange(len(STOP_REASONS))))

# ---------------------------------------------------------------------------
# כתיבה
# ---------------------------------------------------------------------------
candidates = {
    "cols": ["id", "role", "district", "station", "stage",
             "days", "last", "inproc", "anchor"],
    "rows": cands,
}
events_obj = {
    "cols": ["id", "kind", "date", "reason", "stage", "inproc"],
    "rows": events,
}
meta = {
    "base_date": BASE.isoformat(),
    "snapshot_off": SNAP_OFF,
    "roles": ROLES,
    "supergroups": SUPERGROUPS,
    "units": UNITS,
    "stages": STAGES,
    "stage_range": {s: STAGE_RANGE[s] for s in STAGES},
    "ranges": [{"no": n, "name": RANGE_NAMES[n], "target": RANGE_TARGET[n]}
               for n in range(1, 6)],
    "metrics": [{"metric": m, "heb": h} for m, h in METRICS],
    "range_stage_map": {   # מדד -> שלבים (או "__ALL__")
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
    "forecast": forecast,
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
        {"name": "ייצוא כל המועמדים לפי זמנים – 5 שלבים",
         "desc": "פיבוט משך כל טווח לכל מועמד."},
        {"name": "ייצוא כל המועמדים לפי זמנים – 11 שלבים",
         "desc": "כל 11 המדדים הגולמיים לכל מועמד."},
        {"name": "ייצוא לפי מחוז",
         "desc": "רשימת המועמדים של מחוז נבחר.", "requires_district": True},
        {"name": "דוח חריגות לפי 5 שלבים",
         "desc": "החורגים מיעד ה-SLA, לפי זמן בהליך יורד."},
    ],
}

for name, obj in [("candidates.json", candidates), ("events.json", events_obj),
                  ("meta.json", meta)]:
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False,
                                       separators=(",", ":")), encoding="utf-8")

print("candidates:", len(cands), "| events:", len(events),
      "| in_process:", sum(in_flags), "| forecast rows:", len(forecast))
for name in ("candidates.json", "events.json", "meta.json"):
    kb = (OUT / name).stat().st_size / 1024
    print(f"  data/{name}: {kb:,.0f} KB")
