# [FICTIONAL] WRITER notes — en-1

- Seed: 20261001 (Python `random`, set for reproducibility; the data are hand-specified tables in gen/generate.py). "Today": 2026-10-01.
- Generate: `python3 -I gen/generate.py` in this folder. Check: `python3 -I gen/check.py`.
- Facility: Hollinmere Energy Recovery Facility (invented), 2 lines x 150 t/day, 13 pieces of equipment, 42 works (40 chart marks-based works + 2 log-only repairs).

Layouts and why
- Star chart (.xlsx, sheet "10yr Plan"): what an English-speaking (UK-style) EfW plant's asset team keeps as a "10-year planned maintenance schedule": Ref / System-Equipment / Tag No. / Line / Year installed / Maintenance task / Interval, then one column per financial year ("2019/20" style, because UK public bodies and contractors write years that way), Remarks on the right. Years up to last year sit under "ACTUAL", future years under "PLAN"; the current year keeps separate Plan and Actual columns because planners update it after each outage without losing the original plan. Letters X / P instead of symbols because English sheets usually use letters. Extra tasks for the same equipment are written on a continuation row with the name left blank, as people do in hand-kept sheets. A small "Revision log" sheet as is usual for controlled documents.
- Work log (.csv): a CMMS "closed work orders" export, as maintenance systems produce: a title and export line before the header, one row per work order, DD/MM/YYYY dates, crew size and total man-hours, free-text comments, a record-count footer. Asset names were typed by hand so they drift from the chart names. A long job can be raised as two work orders.
- Answer conventions: xlsx records by sheet and row; CSV records by physical line (title = 1, header = 4; the record with an embedded line break starts at line 15). Chart marks recorded literally ("X", "P"); in 2026/27, a row with both columns filled has marks ["P", "X"] (left to right). man_day_hours = 8; manDays = man-hours / 8, or men x days, or the stated estimate. World days = calendar days start to end inclusive. Work attributes used: OVERHAUL, REPLACE, INSPECTION, REPAIR. The plant-wide 3-yearly inspection is precision = true and lists all 13 equipment.

Answer format revision (after the measuring tool's schema)
- Record `kind` is now only "item" (equipment rows, task/continuation rows, the plant-wide row, CSV work rows) or "parent" (numbered system heading rows). The former per-row type is kept in `fields.row_type` (item / task / plant-wide / group / work). Title, header, legend, note, footer and revision-log rows no longer get records.
- `equipment[].names` has one string per file (the most frequent spelling in that file); other spellings are in `name_variants`.
- Answers were rewritten with `python3 -I gen/generate.py --answers-only`, which does not touch files/ (sha256 of files/ checked unchanged).
